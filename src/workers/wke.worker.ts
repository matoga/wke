/**
 * WKE Web Worker.
 *
 * Owns the collision geometry (which depends only on the grid and on ncal) and
 * runs the integrator off the main thread. The geometry is cached across runs
 * keyed on ncal, so re-running with the same physical parameters — or switching
 * kernel — skips the ~100 ms rebuild.
 *
 * Also remembers the raw occupation state each kernel finished with, so a
 * 'continue' request can resume the same trajectory further in time without
 * the main thread having to round-trip 500 floats it has no other use for.
 */

import { logarithmicGrid, interpolateQ, normalizeQ, trapz } from '../physics/grid';
import { buildGeometry } from '../physics/collision';
import type { CollisionGeometry, KernelType } from '../physics/collision';
import { computeScales } from '../physics/scales';
import { peakMomentumFromF, DESCRIPTOR_GRID } from '../physics/descriptors';
import { buildInitialF, runWKE } from '../physics/integrator';
import type { IntegrationResult } from '../physics/integrator';
import { SPECIES, DEFAULT_SPECIES_KEY, P_MIN, P_MAX, N_GRID, NQ_LOW, NQ_HIGH } from '../physics/constants';
import type { WKERequest, WKEProgress, WKEResult, WKEError } from '../types/wke';

const P_GRID = logarithmicGrid(P_MIN, P_MAX, N_GRID);
const P_COLL_MAX = P_MAX / Math.SQRT2;

let cache: { ncal: number; geom: CollisionGeometry } | null = null;
const lastF: Partial<Record<KernelType, Float64Array>> = {};
// A continuation intentionally gets the same accepted-step budget as the
// original run. Its physical duration may shrink as the adaptive integrator
// chooses smaller steps near a singular feature, while wall-clock work stays
// comparable. Timeline sampling remains at the initial run's time cadence.
const continuationSteps: Partial<Record<KernelType, number>> = {};
const snapshotIntervals: Partial<Record<KernelType, number>> = {};
const continuationRtol: Partial<Record<KernelType, number>> = {};

function geometryFor(ncal: number, post: (m: WKEProgress) => void, runId: string): CollisionGeometry {
  if (cache && Math.abs(cache.ncal / ncal - 1) < 1e-12) return cache.geom;
  post({ type: 'progress', runId, phase: 'geometry', pct: 0 });
  const geom = buildGeometry(P_GRID, P_COLL_MAX, ncal, NQ_LOW, NQ_HIGH);
  cache = { ncal, geom };
  return geom;
}

function post(m: WKEProgress | WKEResult | WKEError): void {
  self.postMessage(m);
}

function toResultMessage(
  runId: string, kernel: KernelType, continuation: boolean,
  result: IntegrationResult, k_um_inv: Float64Array, kp0_um_inv: number,
  scales: { xi_um: number; t0_s: number; ncal: number; na_um2: number; density_um3: number },
  geom: CollisionGeometry, gridCoverage: number,
): WKEResult {
  return {
    type: 'result',
    runId,
    kernel,
    continuation,
    k_um_inv: Array.from(k_um_inv),
    kp0_um_inv,
    reachedHalf: result.reachedHalf,
    tauHalf: result.tauHalf,
    dtHalf_s: result.dtHalf_s,
    snapshots: result.snapshots.map((s) => ({
      tau: s.tau,
      t_s: s.t_s,
      kp_um_inv: s.kp_um_inv,
      q: Array.from(s.q),
      dN_over_N: s.dN_over_N,
      dE_over_E: s.dE_over_E,
      stage: s.stage,
    })),
    kpTrack: { t_s: result.kpTrack.t_s, kp: result.kpTrack.kp },
    scales,
    nSteps: result.nSteps,
    nRhs: result.nRhs,
    nRejected: result.nRejected,
    wallTime_ms: result.wallTime_ms,
    geometry_ms: geom.buildTime_ms,
    nEvents: geom.nEvents,
    gridCoverage,
    maxDN: result.maxDN,
    maxDE: result.maxDE,
  };
}

self.onmessage = (e: MessageEvent<WKERequest>) => {
  const req = e.data;
  if (req.type === 'cancel') return;

  const { runId, kernel } = req;

  try {
    const species = SPECIES[req.speciesKey] ?? SPECIES[DEFAULT_SPECIES_KEY];
    const scales = computeScales(req.density_um3, req.a_a0, species);
    const geom = geometryFor(scales.ncal, post, runId);

    const k_um_inv = new Float64Array(N_GRID);
    for (let i = 0; i < N_GRID; i++) k_um_inv[i] = P_GRID[i] / scales.xi_um;

    const onProgress = ({ pct, tau, kp, nSteps }: { pct: number; tau: number; kp: number; nSteps: number }) =>
      post({ type: 'progress', runId, phase: 'integrating', pct, tau, kp, nSteps });

    if (req.type === 'run') {
      // The solver grid is fixed in p, so a strongly non-reference ξ can move
      // it off the spectrum's support. Report how much weight survives the
      // transfer rather than silently renormalizing a truncated profile.
      const qOnSolver = interpolateQ(
        Array.from(DESCRIPTOR_GRID), req.q, k_um_inv, { lower: 'power-law' },
      );
      const gridCoverage = trapz(qOnSolver, k_um_inv);
      const qSolver = normalizeQ(qOnSolver, k_um_inv);
      const f0 = buildInitialF(qSolver, k_um_inv, req.density_um3);
      const kp0 = peakMomentumFromF(k_um_inv, f0);

      const result = runWKE({
        kernel, geom, t0_s: scales.t0_s, xi_um: scales.xi_um,
        kp0_um_inv: kp0, f0, tauMax: req.tauMax, rtol: req.rtol, atol: req.rtol * 1e-3,
        nSnapshots: req.nSnapshots,
        onProgress,
      });

      lastF[kernel] = result.finalF;
      continuationSteps[kernel] = result.nSteps;
      snapshotIntervals[kernel] = req.tauMax / req.nSnapshots;
      continuationRtol[kernel] = req.rtol;
      post(toResultMessage(
        runId, kernel, false, result, k_um_inv, kp0,
        { ...scales, density_um3: req.density_um3 }, geom, gridCoverage,
      ));
      return;
    }

    // req.type === 'continue'
    const f0 = lastF[kernel];
    if (!f0) throw new Error(`no ${kernel} run to continue`);
    const maxSteps = continuationSteps[kernel];
    const snapshotIntervalTau = snapshotIntervals[kernel];
    const rtol = continuationRtol[kernel];
    if (!maxSteps || !snapshotIntervalTau || !rtol) throw new Error(`no run metadata to continue for ${kernel}`);

    const result = runWKE({
      kernel, geom, t0_s: scales.t0_s, xi_um: scales.xi_um,
      kp0_um_inv: req.kp0_um_inv, f0,
      // Infinity means the accepted-step budget, rather than elapsed time,
      // ends a post-half continuation. A pre-half continuation still stops at
      // the half-peak event.
      tauMax: Infinity,
      rtol, atol: rtol * 1e-3,
      haltOnHalf: !req.alreadyHalved,
      nSnapshots: req.nSnapshots,
      snapshotIntervalTau,
      maxSteps,
      onProgress,
    });

    lastF[kernel] = result.finalF;
    post(toResultMessage(
      runId, kernel, true, result, k_um_inv, req.kp0_um_inv,
      { ...scales, density_um3: req.density_um3 }, geom, 1,
    ));
  } catch (err) {
    post({
      type: 'error',
      runId,
      kernel,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
