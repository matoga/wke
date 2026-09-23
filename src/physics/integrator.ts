/**
 * Adaptive Dormand–Prince 5(4) integrator with terminal event detection on
 * k_p(τ) = stopKpFraction · k_p,0, located by bisection on the Hermite dense
 * output. The right-hand side is injected, so every kinetic model shares it.
 */

import { PEAK_DEPTH, peakMomentumFromF } from './descriptors';
import type { RhsDiagnostics, RhsFunction } from './rhs';

export type Termination = 'target' | 'tauMax' | 'steps' | 'pole' | 'nonfinite' | 'stopped';

// --- Dormand–Prince 5(4) tableau -------------------------------------------
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
// error = b − b̂
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920,
      E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

export interface Snapshot {
  tau: number;
  /**
   * Index on the absolute sampling lattice, in units of LATTICE_UNIT of
   * absolute dimensionless time; absent for event states (stage crossings,
   * the final state).
   */
  lattice?: number;
  /** collision-weighted loop dressing and rate-weighted histogram of M at this state's step */
  loop?: number;
  mHist?: number[] | null;
  t_s: number;
  kp_um_inv: number;
  /** q(k, t) = k² f / (2π² n₀), normalized so ∫ q dk = 1 at t = 0 */
  q: Float64Array;
  dN_over_N: number;
  dE_over_E: number;
  /** 'initial' | '0.90' | '0.75' | '0.50' | 'sample' | 'final' */
  stage: string;
}

export interface IntegrationResult {
  termination: Termination;
  terminationMessage: string | null;
  /** lattice stride at the end of the run (see LATTICE_UNIT) */
  latticeStride: number;
  reachedTarget: boolean;
  tauTarget: number | null;
  dtTarget_s: number | null;
  snapshots: Snapshot[];
  /** per accepted step; `loop` is the collision-weighted loop dressing, `pole` the pole indicator */
  kpTrack: { tau: number[]; t_s: number[]; kp: number[]; loop: number[]; pole: number[] };
  /** k_p at the requested `tauEval` times, from the dense output */
  evalTrack: { tau: number[]; t_s: number[]; kp: number[] };
  nSteps: number;
  nRhs: number;
  nRejected: number;
  wallTime_ms: number;
  maxDN: number;
  maxDE: number;
  /** raw occupation at the end of this segment; hand it back in to extend the run */
  finalF: Float64Array;
  finalTau: number;
}

export interface IntegrationConfig {
  rhs: RhsFunction;
  /** state grid p and its trapezoid weights */
  grid: Float64Array;
  gridWeights: Float64Array;
  /** physical time unit t₀ [s] */
  t0_s: number;
  /** healing length ξ [μm] */
  xi_um: number;
  /** initial peak wavevector [μm⁻¹] */
  kp0_um_inv: number;
  /** terminal k_p/k_p,0 ratio; defaults to the calibrated half-time target */
  stopKpFraction?: number;
  /** initial occupation f(p) on the state grid */
  f0: Float64Array;
  tauMax: number;
  rtol?: number;
  atol?: number;
  /** number of evenly spaced snapshots saved for the timeline slider */
  nSnapshots?: number;
  /** unused; kept for callers that still pass it */
  snapshotIntervalTau?: number;
  /**
   * Absolute sampling lattice. Saved states sit at multiples of
   * stride × LATTICE_UNIT of absolute time offsetTau + τ; a continuation
   * passes the previous segment's end and stride so both share one lattice.
   */
  lattice?: { offsetTau: number; stride: number };
  /** accepted-step budget; defaults to the global safety limit */
  maxSteps?: number;
  /**
   * When false, integration runs for the full `tauMax` without checking for
   * the kp0/2 crossing or the 0.90/0.75/0.50 stage markers. Used to extend an
   * already-finished run further in time ("Continue simulating").
   */
  haltOnHalf?: boolean;
  /**
   * Dimensionless times at which to report k_p from the dense output. Use this
   * to compare against another integrator's trajectory: k_p(τ) hops by a grid
   * cell whenever the spectral argmax moves, so interpolating a step-resolution
   * track across such a hop is meaningless: the state must be evaluated at the
   * requested τ itself.
   */
  tauEval?: ArrayLike<number>;
  onProgress?: (info: { pct: number; tau: number; kp: number; nSteps: number; nRhs: number; diag: RhsDiagnostics }) => void;
  /** Copies of accepted states for the UI; never used by the solver. */
  onLive?: (snapshot: Snapshot, stride: number) => void;
  shouldStop?: () => boolean;
  /** peak-estimator depth (see PEAK_DEPTH); 0 is the three-point parabola */
  peakDepth?: number;
  /** minimum wall time between progress callbacks (ms) */
  progressInterval_ms?: number;
}

/** Lattice unit of absolute dimensionless time; strides are powers of two times this. */
export const LATTICE_UNIT = 2 ** -30;
/** The lattice stride doubles whenever more than this many samples would cover the run. */
export const LATTICE_MAX = 256;

const STAGE_FRACTIONS: Array<[number, string]> = [
  [0.9, '0.90'],
  [0.75, '0.75'],
  [0.5, '0.50'],
];

/** Dimensionless number moment ∫ p² f dp. */
function numberMoment(p: Float64Array, w: Float64Array, f: Float64Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += w[i] * p[i] * p[i] * f[i];
  return s;
}

/** Dimensionless energy moment ∫ p⁴ f dp. */
function energyMoment(p: Float64Array, w: Float64Array, f: Float64Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) {
    const p2 = p[i] * p[i];
    s += w[i] * p2 * p2 * f[i];
  }
  return s;
}

/**
 * Build f(p) from a normalized q(k), then rescale so the discrete density
 * moment reproduces `density_um3` exactly.
 */
export function buildInitialF(
  q: Float64Array,
  k_um_inv: Float64Array,
  density_um3: number,
): Float64Array {
  const n = q.length;
  const f = new Float64Array(n);
  const twoPi2 = 2 * Math.PI * Math.PI;
  for (let i = 0; i < n; i++) {
    f[i] = (twoPi2 * density_um3 * q[i]) / (k_um_inv[i] * k_um_inv[i]);
  }
  // dens = ∫ k² f dk / (2π²)  (trapezoid on the physical grid)
  let dens = 0;
  for (let i = 0; i < n - 1; i++) {
    const yi = k_um_inv[i] * k_um_inv[i] * f[i];
    const yj = k_um_inv[i + 1] * k_um_inv[i + 1] * f[i + 1];
    dens += 0.5 * (yi + yj) * (k_um_inv[i + 1] - k_um_inv[i]);
  }
  dens /= twoPi2;
  if (dens > 0) {
    const scale = density_um3 / dens;
    for (let i = 0; i < n; i++) f[i] *= scale;
  }
  return f;
}

export async function runWKE(config: IntegrationConfig): Promise<IntegrationResult> {
  const wall0 = performance.now();
  const {
    rhs: rhsFn, grid: p, gridWeights: wq, t0_s, xi_um, kp0_um_inv, f0, tauMax,
    rtol = 1e-7, atol = 1e-10, nSnapshots = 40, snapshotIntervalTau,
    maxSteps = 200000, tauEval, onProgress, onLive, shouldStop, progressInterval_ms = 150,
    lattice = { offsetTau: 0, stride: 1 },
    haltOnHalf = true, stopKpFraction = 0.5, peakDepth = PEAK_DEPTH,
  } = config;

  const n = f0.length;

  const k_um_inv = new Float64Array(n);
  for (let i = 0; i < n; i++) k_um_inv[i] = p[i] / xi_um;

  const twoPi2 = 2 * Math.PI * Math.PI;
  const n0 = numberMoment(p, wq, f0);
  const e0 = energyMoment(p, wq, f0);
  // density used to normalize the reported q(k, t)
  let dens0 = 0;
  for (let i = 0; i < n - 1; i++) {
    const yi = k_um_inv[i] * k_um_inv[i] * f0[i];
    const yj = k_um_inv[i + 1] * k_um_inv[i + 1] * f0[i + 1];
    dens0 += 0.5 * (yi + yj) * (k_um_inv[i + 1] - k_um_inv[i]);
  }
  dens0 /= twoPi2;

  let nRhs = 0;
  const rhs = (f: Float64Array, out: Float64Array): RhsDiagnostics | Promise<RhsDiagnostics> => {
    nRhs++;
    return rhsFn(f, out);
  };

  const alloc = () => new Float64Array(n);
  const k1 = alloc(), k2 = alloc(), k3 = alloc(), k4 = alloc(), k5 = alloc(), k6 = alloc(), k7 = alloc();
  const yTmp = alloc();

  let y = f0.slice();
  let tau = 0;
  if (!(stopKpFraction > 0 && stopKpFraction < 1)) {
    throw new Error('stopKpFraction must be between 0 and 1');
  }
  const halfTarget = kp0_um_inv * stopKpFraction;

  const kpOf = (f: Float64Array) => peakMomentumFromF(k_um_inv, f, peakDepth);

  const snapshots: Snapshot[] = [];
  const kpTrack = {
    tau: [] as number[], t_s: [] as number[], kp: [] as number[], loop: [] as number[], pole: [] as number[],
  };
  const evalTrack = { tau: [] as number[], t_s: [] as number[], kp: [] as number[] };
  let evalIdx = 0;
  let maxDN = 0;
  let maxDE = 0;

  // Diagnostics of the step a saved state belongs to (the right-hand side at
  // the end of that step), attached to the state for display.
  let snapDiag: RhsDiagnostics | null = null;
  const makeSnapshot = (t: number, f: Float64Array, stage: string, trackDrift = true): Snapshot => {
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      q[i] = (k_um_inv[i] * k_um_inv[i] * f[i]) / (twoPi2 * dens0);
    }
    const dN = (numberMoment(p, wq, f) - n0) / n0;
    const dE = (energyMoment(p, wq, f) - e0) / e0;
    if (trackDrift) {
      maxDN = Math.max(maxDN, Math.abs(dN));
      maxDE = Math.max(maxDE, Math.abs(dE));
    }
    return {
      tau: t, t_s: t * t0_s, kp_um_inv: kpOf(f), q, dN_over_N: dN, dE_over_E: dE, stage,
      loop: snapDiag?.loopDressing, mHist: snapDiag?.mHist,
    };
  };

  const offsetTau = lattice.offsetTau;
  let stride = lattice.stride;
  const first = makeSnapshot(0, y, 'initial');
  if (offsetTau === 0) first.lattice = 0;
  snapshots.push(first);

  const stageFractions = STAGE_FRACTIONS.filter(([frac]) => frac > stopKpFraction - 1e-12);
  if (!stageFractions.some(([frac]) => Math.abs(frac - stopKpFraction) < 1e-12)) {
    stageFractions.push([stopKpFraction, stopKpFraction.toFixed(3)]);
  }
  const pendingStages = haltOnHalf
    ? stageFractions.map(([frac, label]) => ({ target: frac * kp0_um_inv, label, done: false }))
    : [];

  // Initial step size: a small fraction of the expected timescale.
  let diag = await rhs(y, k1);
  snapDiag = diag;
  first.loop = diag.loopDressing;
  first.mHist = diag.mHist;
  onLive?.(first, stride);
  kpTrack.tau.push(0); kpTrack.t_s.push(0); kpTrack.kp.push(kpOf(y));
  kpTrack.loop.push(diag.loopDressing); kpTrack.pole.push(diag.poleIndicator);
  let termination: Termination | null = null;
  let terminationMessage: string | null = null;
  if (diag.stop) {
    termination = 'pole';
    terminationMessage = diag.stop;
  }
  const hInit = Number.isFinite(tauMax) ? tauMax / 2000 : 1;
  let h = hInit;
  {
    let scale = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.abs(y[i]);
      scale = Math.max(scale, Math.abs(k1[i]) / sc);
    }
    if (scale > 0) h = Math.min(h, 0.01 / scale);
  }
  const hMax = Number.isFinite(tauMax) ? tauMax / 20 : Infinity;
  let lastProgress = performance.now();

  let nSteps = 0;
  let nRejected = 0;
  let consecutiveRejects = 0;
  let reachedHalf = false;
  let tauHalf: number | null = null;
  let halfStateF: Float64Array | null = null;
  let kpPrev = kpOf(y);

  // States are saved on an absolute lattice so every segment of a run, and
  // the live view, hold the same frames.
  void nSnapshots; void snapshotIntervalTau;

  while (termination === null && tau < tauMax && nSteps < maxSteps && !(haltOnHalf && reachedHalf)) {
    if (shouldStop?.()) { termination = 'stopped'; break; }
    if (tau + h > tauMax) h = tauMax - tau;
    if (consecutiveRejects > 60 || !(h > 0)) {
      termination = 'nonfinite';
      terminationMessage = 'Step size collapsed; the kinetic equation became too stiff to continue.';
      break;
    }

    // --- one DOPRI5 stage sweep ---
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * A21 * k1[i];
    await rhs(yTmp, k2);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    await rhs(yTmp, k3);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    await rhs(yTmp, k4);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    await rhs(yTmp, k5);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    await rhs(yTmp, k6);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
    const diagNew = await rhs(yTmp, k7);

    // error estimate
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yTmp[i]));
      const r = e / sc;
      err += r * r;
    }
    err = Math.sqrt(err / n);

    if (!Number.isFinite(err)) {
      nRejected++;
      consecutiveRejects++;
      h *= 0.2;
      continue;
    }
    if (err > 1) {
      nRejected++;
      consecutiveRejects++;
      h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      continue;
    }
    consecutiveRejects = 0;

    const tauNew = tau + h;
    const kpNew = kpOf(yTmp);
    snapDiag = diagNew;

    // --- terminal event: kp crosses kp0/2 downwards ---
    if (haltOnHalf && kpPrev > halfTarget && kpNew <= halfTarget) {
      tauHalf = bisectEvent(y, yTmp, k1, k7, tau, h, kpOf, halfTarget, n);
      // y/yTmp/k1/k7 describe *this* step only; the exact state must be taken
      // here, before the loop advances past it below.
      halfStateF = hermite(y, yTmp, k1, k7, tau, h, tauHalf, n);
      reachedHalf = true;
    }

    // --- stage crossings, located the same way ---
    for (const st of pendingStages) {
      if (!st.done && kpPrev > st.target && kpNew <= st.target) {
        const tc = bisectEvent(y, yTmp, k1, k7, tau, h, kpOf, st.target, n);
        const snap = makeSnapshot(tc, hermite(y, yTmp, k1, k7, tau, h, tc, n), st.label);
        snapshots.push(snap);
        onLive?.(snap, stride);
        st.done = true;
      }
    }

    // --- dense output at the requested evaluation times ---
    if (tauEval) {
      while (evalIdx < tauEval.length && tauEval[evalIdx] <= tauNew + 1e-15) {
        const te = tauEval[evalIdx];
        if (te >= tau - 1e-15) {
          const fe = te <= tau ? y : hermite(y, yTmp, k1, k7, tau, h, te, n);
          evalTrack.tau.push(te);
          evalTrack.t_s.push(te * t0_s);
          evalTrack.kp.push(kpOf(fe));
        }
        evalIdx++;
      }
    }

    // --- lattice samples, evaluated on dense output ---
    // If this step contains the terminal event, stop at it: the final state
    // below is the exact event state.
    const sampleEnd = reachedHalf && tauHalf !== null ? tauHalf : tauNew;
    {
      const absEnd = offsetTau + sampleEnd;
      let dt = stride * LATTICE_UNIT;
      if (absEnd / dt > LATTICE_MAX) {
        while (absEnd / dt > LATTICE_MAX) { stride *= 2; dt *= 2; }
        for (let i = snapshots.length - 1; i >= 0; i--) {
          const idx = snapshots[i].lattice;
          if (idx !== undefined && idx % stride !== 0) snapshots.splice(i, 1);
        }
      }
      let m = Math.floor((offsetTau + tau) / dt + 1e-9) + 1;
      while (m * dt - offsetTau <= sampleEnd * (1 + 1e-14)) {
        const tl = m * dt - offsetTau;
        if (tl > tau) {
          const snap = makeSnapshot(tl, hermite(y, yTmp, k1, k7, tau, h, tl, n), 'sample');
          snap.lattice = m * stride;
          snapshots.push(snap);
          onLive?.(snap, stride);
        }
        m++;
      }
    }

    tau = tauNew;
    y.set(yTmp);
    k1.set(k7); // FSAL
    kpPrev = kpNew;
    nSteps++;
    diag = diagNew;

    kpTrack.tau.push(tau);
    kpTrack.t_s.push(tau * t0_s);
    kpTrack.kp.push(kpNew);
    kpTrack.loop.push(diag.loopDressing);
    kpTrack.pole.push(diag.poleIndicator);

    if (diag.stop && !reachedHalf) {
      termination = 'pole';
      terminationMessage = diag.stop;
    }

    if (onProgress) {
      const now = performance.now();
      if (now - lastProgress >= progressInterval_ms) {
        lastProgress = now;
        const pct = haltOnHalf
          ? Math.min(1, Math.max(0, (kp0_um_inv - kpNew) / (kp0_um_inv - halfTarget)))
          : Math.min(1, nSteps / maxSteps);
        onProgress({ pct, tau, kp: kpNew, nSteps, nRhs, diag });
        // Let the worker receive Stop even when the RHS falls back to a local,
        // synchronous implementation whose awaited calls only yield microtasks.
        if (shouldStop) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    if (!reachedHalf) {
      h = Math.min(hMax, h * Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
    }
  }

  let finalF: Float64Array = y;
  let finalTau = tau;
  if (haltOnHalf && reachedHalf && tauHalf !== null && halfStateF !== null) {
    finalF = halfStateF;
    finalTau = tauHalf;
    snapshots.push(makeSnapshot(tauHalf, finalF, 'final'));
  } else {
    snapshots.push(makeSnapshot(tau, y, 'final'));
  }

  // Snapshots may be produced slightly out of order across stage/sample paths.
  snapshots.sort((a, b) => a.tau - b.tau);
  onLive?.(snapshots[snapshots.length - 1], stride);

  if (termination === null) {
    if (haltOnHalf && reachedHalf) termination = 'target';
    else if (nSteps >= maxSteps) termination = 'steps';
    else termination = 'tauMax';
  }

  return {
    termination,
    terminationMessage,
    latticeStride: stride,
    reachedTarget: reachedHalf,
    tauTarget: tauHalf,
    dtTarget_s: tauHalf !== null ? tauHalf * t0_s : null,
    snapshots,
    kpTrack,
    evalTrack,
    nSteps,
    nRhs,
    nRejected,
    wallTime_ms: performance.now() - wall0,
    maxDN,
    maxDE,
    finalF,
    finalTau,
  };
}

/** Cubic Hermite interpolation of the state within an accepted step. */
function hermite(
  y0: Float64Array, y1: Float64Array,
  f0: Float64Array, f1: Float64Array,
  t0: number, h: number, t: number, n: number,
): Float64Array {
  const out = new Float64Array(n);
  if (h === 0) { out.set(y0); return out; }
  const s = (t - t0) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  for (let i = 0; i < n; i++) {
    out[i] = h00 * y0[i] + h * h10 * f0[i] + h01 * y1[i] + h * h11 * f1[i];
  }
  return out;
}

/**
 * Locate the time at which kp(t) = target inside an accepted step, by
 * bisection on the Hermite dense output.
 */
function bisectEvent(
  y0: Float64Array, y1: Float64Array,
  f0: Float64Array, f1: Float64Array,
  t0: number, h: number,
  kpOf: (f: Float64Array) => number,
  target: number,
  n: number,
): number {
  let lo = t0;
  let hi = t0 + h;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    const fm = hermite(y0, y1, f0, f1, t0, h, mid, n);
    if (kpOf(fm) > target) lo = mid; else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}
