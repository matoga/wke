/**
 * Manual convergence benchmark (not part of `npm test`).
 *
 *   npx tsx scripts/convergence-bench.ts
 *
 * Runs the bare classical WKE on test spectra with increasingly fine grids and
 * quadrature and reports the stop time and the k_p(t) track relative to the
 * finest configuration.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { logarithmicGrid, interpolateQ, normalizeQ } from '../src/physics/grid';
import { buildGeometry } from '../src/physics/collision';
import { computeScales } from '../src/physics/scales';
import { PEAK_DEPTH, peakMomentumFromF } from '../src/physics/descriptors';
const DEPTH = process.env.PEAK_DEPTH ? Number(process.env.PEAK_DEPTH) : PEAK_DEPTH;
import { buildInitialF, runWKE } from '../src/physics/integrator';
import { makeBareRhs } from '../src/physics/rhs';
import { SPECIES, P_MIN, solverPMax } from '../src/physics/constants';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(resolve(HERE, '../shared-data/fixtures.json'), 'utf8'));

interface Config { name: string; nGrid: number; nq: number; panels: number; rtol: number }

const mode = process.argv[2] ?? 'full';
const configs: Config[] = mode === 'grids'
  ? [
    { name: 'grid 400 / 12x2', nGrid: 400, nq: 12, panels: 2, rtol: 1e-8 },
    { name: 'grid 500 / 12x2', nGrid: 500, nq: 12, panels: 2, rtol: 1e-8 },
    { name: 'grid 700 / 12x2', nGrid: 700, nq: 12, panels: 2, rtol: 1e-8 },
    { name: 'grid 1000 / 12x2', nGrid: 1000, nq: 12, panels: 2, rtol: 1e-8 },
    { name: 'grid 1400 / 12x2', nGrid: 1400, nq: 12, panels: 2, rtol: 1e-8 },
    { name: 'grid 1000 / 8x2', nGrid: 1000, nq: 8, panels: 2, rtol: 1e-8 },
    { name: 'grid 1000 / 12x3', nGrid: 1000, nq: 12, panels: 3, rtol: 1e-8 },
    { name: 'grid 1000 / 16x4', nGrid: 1000, nq: 16, panels: 4, rtol: 1e-9 },
    { name: 'grid 2000 / 12x2', nGrid: 2000, nq: 12, panels: 2, rtol: 1e-9 },
  ]
  : mode === 'study'
  ? [
    { name: 'grid 500 / 16x4', nGrid: 500, nq: 16, panels: 4, rtol: 1e-9 },
    { name: 'grid 700 / 16x4', nGrid: 700, nq: 16, panels: 4, rtol: 1e-9 },
    { name: 'grid 1000 / 16x4', nGrid: 1000, nq: 16, panels: 4, rtol: 1e-9 },
    { name: 'grid 1000 / 12x2', nGrid: 1000, nq: 12, panels: 2, rtol: 1e-9 },
    { name: 'grid 1000 / 12x3', nGrid: 1000, nq: 12, panels: 3, rtol: 1e-9 },
    { name: 'grid 1400 / 16x4', nGrid: 1400, nq: 16, panels: 4, rtol: 1e-9 },
  ]
  : mode === 'ref'
  ? [
    { name: '500/16x2', nGrid: 500, nq: 16, panels: 2, rtol: 1e-7 },
    { name: '1000/16x4', nGrid: 1000, nq: 16, panels: 4, rtol: 1e-9 },
  ]
  : (mode === 'quick')
  ? [
    { name: 'parity 500/16x1', nGrid: 500, nq: 16, panels: 1, rtol: 1e-7 },
    { name: '500/16x2', nGrid: 500, nq: 16, panels: 2, rtol: 1e-7 },
  ]
  : [
    { name: 'draft 300/12x1', nGrid: 300, nq: 12, panels: 1, rtol: 1e-5 },
    { name: 'parity 500/16x1', nGrid: 500, nq: 16, panels: 1, rtol: 1e-7 },
    { name: '500/8x2', nGrid: 500, nq: 8, panels: 2, rtol: 1e-7 },
    { name: '500/12x2', nGrid: 500, nq: 12, panels: 2, rtol: 1e-7 },
    { name: '500/16x2', nGrid: 500, nq: 16, panels: 2, rtol: 1e-7 },
    { name: '500/8x4', nGrid: 500, nq: 8, panels: 4, rtol: 1e-7 },
    { name: '700/16x2', nGrid: 700, nq: 16, panels: 2, rtol: 1e-8 },
    { name: '700/12x4', nGrid: 700, nq: 12, panels: 4, rtol: 1e-8 },
    { name: '1000/16x4', nGrid: 1000, nq: 16, panels: 4, rtol: 1e-9 },
  ];

const only = process.argv[3];
const allCases = [
  { key: 'gaussian (reference na)', density: 2.8331, a: 50, profile: fixtures.profiles[0] },
  { key: 'measured (reference na)', density: 2.8331, a: 50, profile: fixtures.profiles[2] },
  { key: 'gaussian (4x na)', density: 2.8331, a: 200, profile: fixtures.profiles[0] },
];
const cases = only ? allCases.filter((c) => c.key.startsWith(only)) : allCases;

for (const c of cases) {
  console.log(`\n== ${c.key}`);
  const scales = computeScales(c.density, c.a, SPECIES.K39);
  const pMax = solverPMax(scales.xi_um);
  const results: Array<{ cfg: Config; t: number; track: number[]; tEval: number[]; events: number; ms: number }> = [];
  // Evaluate k_p on a common time axis: 40 points up to the parity half-time.
  let tEvalTau: number[] | null = null;
  for (const cfg of configs.slice().reverse()) {
    const grid = logarithmicGrid(P_MIN, pMax, cfg.nGrid);
    const k = Float64Array.from(grid, (p) => p / scales.xi_um);
    const q = normalizeQ(interpolateQ(c.profile.raw_k, c.profile.raw_q, k), k);
    const f0 = buildInitialF(q, k, c.density);
    const geom = buildGeometry(grid, pMax / Math.SQRT2, { nqLow: cfg.nq, nqHigh: cfg.nq, panels: cfg.panels });
    const res0 = tEvalTau ? null : await runWKE({
      rhs: makeBareRhs(geom, 'classical', scales.ncal), grid, gridWeights: geom.weights,
      t0_s: scales.t0_s, xi_um: scales.xi_um, kp0_um_inv: peakMomentumFromF(k, f0, DEPTH), f0, peakDepth: DEPTH,
      tauMax: 4000, rtol: cfg.rtol, atol: cfg.rtol * 1e-3,
    });
    if (res0) tEvalTau = Array.from({ length: 40 }, (_, i) => (res0.tauTarget! * (i + 1)) / 41);
    const res = await runWKE({
      rhs: makeBareRhs(geom, 'classical', scales.ncal), grid, gridWeights: geom.weights,
      t0_s: scales.t0_s, xi_um: scales.xi_um, kp0_um_inv: peakMomentumFromF(k, f0, DEPTH), f0, peakDepth: DEPTH,
      tauMax: 4000, rtol: cfg.rtol, atol: cfg.rtol * 1e-3, tauEval: tEvalTau!,
    });
    if (res.termination !== 'target') console.log(`  ${cfg.name}: ${res.termination} ${res.terminationMessage ?? ''} steps=${res.nSteps}`);
    results.push({ cfg, t: res.dtTarget_s ?? NaN, track: res.evalTrack.kp, tEval: tEvalTau!, events: geom.nEvents, ms: res.wallTime_ms + geom.buildTime_ms });
  }
  const ref = results[0];
  for (const r of results.slice().reverse()) {
    let worst = 0;
    for (let i = 0; i < r.track.length; i++) worst = Math.max(worst, Math.abs(r.track[i] / ref.track[i] - 1));
    console.log(
      `${r.cfg.name.padEnd(18)} t_half=${(r.t * 1e3).toFixed(4)} ms  rel=${(r.t / ref.t - 1).toExponential(2).padStart(9)}  ` +
      `max|dkp/kp|=${worst.toExponential(2)}  events=${r.events}  ${(r.ms / 1000).toFixed(1)} s`,
    );
  }
}
