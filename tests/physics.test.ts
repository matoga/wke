/**
 * Physics suite for the bare kinetic equation, spectrum handling and the
 * solver pipeline.
 *
 * Reference numbers come from `shared-data/fixtures.json`, produced by an
 * independent reference solver that uses the "parity" quadrature. The parity
 * checks prove the port is faithful; the accuracy-level checks prove the
 * user-facing levels converge. Run with `npm test`.
 */

import { logarithmicGrid, interpolateQ, normalizeQ, trapz } from '../src/physics/grid';
import { leggauss, gaussLegendreLog, interpolationMap } from '../src/physics/quadrature';
import { buildGeometry } from '../src/physics/collision';
import type { KernelType } from '../src/physics/collision';
import { computeScales } from '../src/physics/scales';
import {
  INPUT_GRID, computeDescriptors, countModes, peakMomentum, peakMomentumFromF,
} from '../src/physics/descriptors';
import { buildInitialF, runWKE } from '../src/physics/integrator';
import { makeBarePartial, makeBareRhs } from '../src/physics/rhs';
import { deriveSystem, cylinderVolume } from '../src/physics/parameters';
import { prepareFromText, prepareSpectrum } from '../src/physics/spectrum';
import { exportTrajectory } from '../src/physics/export';
import { PRESETS } from '../src/physics/presets';
import { PRECISION } from '../src/physics/precision';
import { localBackend, runSimulation } from '../src/physics/simulate';
import { SPECIES, BOHR_RADIUS_UM, P_MIN, P_MAX, N_GRID, REFERENCE_XI_UM, solverPMax } from '../src/physics/constants';
import type { WKERunRequest } from '../src/types/wke';
import { absClose, check, loadData, note, relClose, report, section } from './harness';

const fixtures = loadData('fixtures.json');
const META = fixtures.metadata;

interface Fixture {
  key: string;
  raw_k: number[];
  raw_q: number[];
  kp0_um_inv: number;
  mean_k_um_inv: number;
  fwhm_um_inv: number;
  dt_half_classical_s: number;
  dt_half_quantum_s: number;
  trajectory_classical: { t_s: number[]; kp: number[] };
  trajectory_quantum: { t_s: number[]; kp: number[] };
}
const profiles: Fixture[] = fixtures.profiles;

const PARITY = PRECISION.parity;
const parityQuad = { nqLow: PARITY.nqLow, nqHigh: PARITY.nqHigh, panels: PARITY.panels };

// ------------------------------------------------------------ quadrature ---

section('Quadrature and interpolation');
{
  for (const n of [4, 8, 16]) {
    const { x, w } = leggauss(n);
    const deg = 2 * n - 1;
    let got = 0;
    for (let i = 0; i < n; i++) got += w[i] * Math.pow(x[i], deg - 1);
    relClose(`leggauss(${n}) exact to degree ${deg}`, got, 2 / deg, 1e-13);
  }
  const { w } = leggauss(24);
  relClose('leggauss(24) weights sum to 2', w.reduce((a, b) => a + b, 0), 2, 1e-14);
  const { w: lw } = gaussLegendreLog(0.3, 7.5, 16);
  relClose('gaussLegendreLog integrates dp', lw.reduce((a, b) => a + b, 0), 7.5 - 0.3, 1e-10);

  const grid = logarithmicGrid(0.01, 20, 64);
  const logGrid = Float64Array.from(grid, Math.log);
  const f = Float64Array.from(grid, (p) => 3 * Math.log(p) + 1);
  const { idx, alpha } = interpolationMap(logGrid, 1.234);
  relClose('interpolationMap is exact for f linear in log p',
    (1 - alpha) * f[idx] + alpha * f[idx + 1], 3 * Math.log(1.234) + 1, 1e-12);
}

// ------------------------------------------------------------------ units ---

section('Units and scales');
{
  relClose('a₀ to μm', 50 * BOHR_RADIUS_UM, 50 * 5.29177210903e-5, 1e-15);
  const s = computeScales(META.density_um3, META.scattering_length_a0, SPECIES.K39);
  relClose('ξ matches reference', s.xi_um, META.xi_um, 1e-12);
  relClose('t₀ matches reference', s.t0_s, META.t0_s, 1e-12);
  relClose('N_cal matches reference', s.ncal, META.ncal, 1e-12);
  relClose('na matches reference', s.na_um2, META.na_ref_um2, 1e-12);
  relClose('ξ closed form 1/√(8πna)', s.xi_um, 1 / Math.sqrt(8 * Math.PI * META.density_um3 * s.a_um), 1e-12);

  const neg = computeScales(META.density_um3, -META.scattering_length_a0, SPECIES.K39);
  check('attractive a: sign is −1', neg.sign === -1, `sign=${neg.sign}`);
  relClose('attractive a: ξ uses |a|', neg.xi_um, s.xi_um, 1e-15);
  relClose('attractive a: t₀ uses |a|', neg.t0_s, s.t0_s, 1e-15);
  relClose('attractive a: signed na', neg.na_um2, -s.na_um2, 1e-15);

  relClose('reference conditions retain canonical p_max', solverPMax(REFERENCE_XI_UM), P_MAX, 1e-14);
  relClose('weak coupling retains reference physical k_max',
    solverPMax(2.5 * REFERENCE_XI_UM) / (2.5 * REFERENCE_XI_UM), P_MAX / REFERENCE_XI_UM, 1e-14);
}

// ------------------------------------------------------ collision operator ---

section('Collision operator');

const pGrid = logarithmicGrid(P_MIN, P_MAX, N_GRID);
const geom = buildGeometry(pGrid, P_MAX / Math.SQRT2, parityQuad);
check('parity event table size matches reference', geom.nEvents === META.n_events,
  `events=${geom.nEvents} reference=${META.n_events}`);
const kSolver = Float64Array.from(pGrid, (p) => p / META.xi_um);
{
  let worst = 0;
  for (let i = 0; i < N_GRID; i++) worst = Math.max(worst, Math.abs(INPUT_GRID[i] / kSolver[i] - 1));
  check('input grid == Standard solver grid at the reference ξ', worst < 1e-12, `max rel=${worst.toExponential(2)}`);

  // Partitioned tables must add up to the full right-hand side.
  const q = normalizeQ(interpolateQ(profiles[0].raw_k, profiles[0].raw_q, kSolver), kSolver);
  const f0 = buildInitialF(q, kSolver, META.density_um3);
  const full = new Float64Array(N_GRID);
  makeBarePartial(geom, 'classical', META.ncal)(f0, full);
  const summed = new Float64Array(N_GRID);
  let events = 0;
  for (let off = 0; off < 3; off++) {
    const g = buildGeometry(pGrid, P_MAX / Math.SQRT2, parityQuad, { stride: 3, offset: off });
    events += g.nEvents;
    const part = new Float64Array(N_GRID);
    makeBarePartial(g, 'classical', META.ncal)(f0, part);
    for (let i = 0; i < N_GRID; i++) summed[i] += part[i];
  }
  let worstP = 0, scaleP = 0;
  for (let i = 0; i < N_GRID; i++) {
    worstP = Math.max(worstP, Math.abs(summed[i] - full[i]));
    scaleP = Math.max(scaleP, Math.abs(full[i]));
  }
  check('three partitions hold every event once', events === geom.nEvents, `${events} vs ${geom.nEvents}`);
  check('partitioned right-hand sides add up to the full one', worstP <= 1e-13 * scaleP,
    `max |Δ|/max|C| = ${(worstP / scaleP).toExponential(2)}`);
}

// ---------------------------------------------------------- descriptors ---

section('Descriptors');
for (const p of profiles) {
  const d = computeDescriptors(Float64Array.from(p.raw_k), Float64Array.from(p.raw_q), 0);
  relClose(`${p.key}: ∫q dk = 1`, d.normIntegral, 1, 1e-10);
  relClose(`${p.key}: k_p,0`, d.kp0_um_inv, p.kp0_um_inv, 1e-10);
  relClose(`${p.key}: ⟨k⟩`, d.mean_k_um_inv, p.mean_k_um_inv, 1e-10);
  relClose(`${p.key}: FWHM`, d.fwhm_um_inv, p.fwhm_um_inv, 1e-10);
}

section('Presets');
{
  const presets = loadData('presets.json');
  for (const rec of presets.profiles) {
    const prepared = PRESETS.find((x) => x.key === rec.key)!.load();
    const d = computeDescriptors(prepared.k, prepared.q, 0);
    relClose(`preset ${rec.key}: k_p,0`, d.kp0_um_inv, rec.descriptors.kp0_um_inv, 1e-9);
  }
  check('Gaussian shell preset carries a formula',
    Boolean(PRESETS.find((preset) => preset.key === 'gaussian_shell')?.formula), 'typeset definition');
  for (const [key, points, cutoff] of [
    ['measured_b', 174, 4], ['measured_c1', 37, 4], ['measured_c2', 39, 4], ['measured_c3', 49, 6],
  ] as const) {
    const preset = PRESETS.find((item) => item.key === key);
    check(`${key} preset is available`, preset != null, key);
    if (!preset) continue;
    const prepared = preset.load();
    check(`${key} retains measured points`, prepared.raw.k_um_inv.length === points, `points=${prepared.raw.k_um_inv.length}`);
    check(`${key} obeys its k cutoff`, Math.max(...prepared.raw.k_um_inv) <= cutoff, `k_max=${Math.max(...prepared.raw.k_um_inv)}`);
    check(`${key} uses n_k convention`, prepared.raw.convention === 'n_k', prepared.raw.convention);
    check(`${key} is nonnegative and normalized`,
      prepared.q.every((value) => value >= 0) && Math.abs(trapz(prepared.q, prepared.k) - 1) < 1e-10,
      `min q=${Math.min(...prepared.q)}`);
    check(`${key} hides import notes`, preset.hideImportNotes === true, 'curated data');
  }
}

// ------------------------------------------------------ spectrum import ---

section('Spectrum import conventions');
{
  const lines = ['k_um_inv,n_k'];
  for (let i = 1; i <= 60; i++) lines.push(`${(i * 0.1).toFixed(4)},1.0`);
  const s = prepareFromText(lines.join('\n'), 'n_k', 'flat n_k', 'paste');
  const mid = Math.floor(s.raw.k_um_inv.length / 2);
  relClose('n_k convention applies 4π k²', s.qRaw[mid] / s.qRaw[mid - 1],
    (s.raw.k_um_inv[mid] / s.raw.k_um_inv[mid - 1]) ** 2, 1e-12);
  check('n_k header detected', s.raw.detectedColumns?.[1] === 'n_k', `got ${s.raw.detectedColumns?.join(',')}`);

  const truncated = prepareSpectrum({
    k_um_inv: [0.1, 0.2, 0.3, 0.4], values: [2, 2, 2, 2],
    convention: 'n_k', label: 'truncated flat n_k', source: 'paste', warnings: [],
  });
  relClose('missing low-k n_k is held constant', truncated.q[0] / truncated.q[1],
    (truncated.k[0] / truncated.k[1]) ** 2, 1e-12);
  const truncatedShell = prepareSpectrum({
    k_um_inv: [0.1, 0.2, 0.3, 0.4], values: [2, 2, 2, 2],
    convention: 'Nk_over_N', label: 'truncated shell data', source: 'paste', warnings: [],
  });
  relClose('missing low-k shell data also preserves finite n_k', truncatedShell.q[0] / truncatedShell.q[1],
    (truncatedShell.k[0] / truncatedShell.k[1]) ** 2, 1e-12);

  const measured = PRESETS.find((preset) => preset.key === 'measured_a')!.load();
  relClose('padded low-k region of a measured preset restores finite n_k',
    measured.q[0] / measured.k[0] ** 2, measured.q[1] / measured.k[1] ** 2, 1e-12);

  const shiftedLowGrid = Float64Array.from([0.025, 0.05, 0.1]);
  relClose('solver transfer continues finite n_k as q ∝ k²',
    interpolateQ([0.1, 0.2, 0.3], [0.01, 0.04, 0.09], shiftedLowGrid, { lower: 'power-law' })[0], 0.000625, 1e-12);
  relClose('solver transfer continues μ = 0 Bose q as constant',
    interpolateQ([0.1, 0.2, 0.3], [1, 1, 1], shiftedLowGrid, { lower: 'power-law' })[0], 1, 1e-12);

  const topHat = PRESETS.find((preset) => preset.key === 'nk_top_hat')!.load();
  const belowHat = topHat.raw.k_um_inv.findIndex((k) => k >= 1);
  const aboveHat = topHat.raw.k_um_inv.findIndex((k) => k >= 2.3);
  relClose('n_k top-hat is constant below k_p', topHat.raw.values[belowHat], topHat.raw.values[0], 1e-12);
  check('n_k top-hat vanishes above k_p', topHat.raw.values[aboveHat] === 0, `n_k=${topHat.raw.values[aboveHat]}`);

  const base = profiles[0];
  const a = prepareSpectrum({ k_um_inv: base.raw_k, values: base.raw_q, convention: 'Nk_over_N', label: 'a', source: 'preset', warnings: [] });
  const b = prepareSpectrum({ k_um_inv: base.raw_k, values: base.raw_q.map((v) => v * 1000), convention: 'Nk_over_N', label: 'b', source: 'preset', warnings: [] });
  let worst = 0;
  for (let i = 0; i < a.q.length; i++) worst = Math.max(worst, Math.abs(a.q[i] - b.q[i]));
  check('N_k/N convention is scale invariant', worst < 1e-15, `max |Δq|=${worst.toExponential(2)}`);
  const asNk = prepareSpectrum({ k_um_inv: base.raw_k, values: base.raw_q, convention: 'n_k', label: 'c', source: 'preset', warnings: [] });
  const dA = computeDescriptors(a.k, a.q);
  const dN = computeDescriptors(asNk.k, asNk.q);
  check('conventions are not interchangeable', Math.abs(dA.kp0_um_inv / dN.kp0_um_inv - 1) > 0.01,
    `k_p ${dA.kp0_um_inv.toFixed(4)} vs ${dN.kp0_um_inv.toFixed(4)} μm⁻¹`);
}

section('Trajectory export');
{
  const exported = exportTrajectory(Float64Array.from([1, 2]), [{ t_s: 0, q: [0.25, 0.75] }, { t_s: 0.5, q: [0.5, 0.5] }], 3);
  const lines = exported.csv.split('\n');
  check('trajectory export has k,n_k,time header', lines[0] === 'k_um_inv,n_k,time_s', lines[0]);
  check('trajectory export emits every k at every time', exported.rows === 4 && exported.curves === 2,
    `rows=${exported.rows} curves=${exported.curves}`);
  relClose('trajectory n_k matches the occupation conversion', Number(lines[1].split(',')[1]), 0.25 * 2 * Math.PI ** 2 * 3, 1e-9);
}

section('Peak detection');
{
  check('a one-point ripple is not a separate mode', countModes(Float64Array.from([0, 0.2, 0.20001, 0.2, 1, 0.5, 0])) === 1, '1% prominence');
  check('a distinct secondary peak remains a mode', countModes(Float64Array.from([0, 0.3, 0.5, 0.1, 1, 0.5, 0])) === 2, 'retained');
}

// ------------------------------------------------------------ parameters ---

section('System parameters');
{
  const n = META.density_um3;
  const N = 1e5;
  const base = { speciesKey: 'K39', L_um: null, aspect: null, density_um3: null, a_a0: 50 };
  const nv = deriveSystem({ ...base, mode: 'N_V', N, V_um3: N / n });
  relClose('N, V → n', nv.density_um3!, n, 1e-12);
  relClose('N, V, a → na', nv.na_um2!, META.na_ref_um2, 1e-12);
  const cyl = deriveSystem({ ...base, mode: 'N_cylinder', N, V_um3: null, L_um: 40, aspect: 0.5 });
  relClose('cylinder V = π(ρL)²L', cyl.V_um3!, Math.PI * 20 * 20 * 40, 1e-14);
  relClose('cylinderVolume helper', cylinderVolume(40, 0.5), Math.PI * 20 * 20 * 40, 1e-14);
  const dens = deriveSystem({ ...base, mode: 'density', N: null, V_um3: null, density_um3: n, a_a0: -50 });
  relClose('density mode keeps the sign of a', dens.na_um2!, -META.na_ref_um2, 1e-12);
  check('attractive a is accepted', dens.errors.length === 0, dens.errors.join('; '));
  const zero = deriveSystem({ ...base, mode: 'density', N: null, V_um3: null, density_um3: n, a_a0: 0 });
  check('a = 0 is rejected before a run', zero.na_um2 === null && zero.errors.length === 1, zero.errors.join('; '));
}

// --------------------------------------------------- parity with reference ---

section('Bare solver vs reference (parity quadrature)');

const HALF_TIME_TOL = 0.01;
const timings: Array<{ key: string; kernel: KernelType; ms: number; steps: number }> = [];

for (const p of profiles) {
  const qSolver = normalizeQ(interpolateQ(p.raw_k, p.raw_q, kSolver), kSolver);
  const f0 = buildInitialF(qSolver, kSolver, META.density_um3);
  // The reference solver defines k_p by the three-point parabola (depth 0).
  const kpF = peakMomentumFromF(kSolver, f0, 0);
  relClose(`${p.key}: k_p,0 from f == from q`, kpF, peakMomentum(Float64Array.from(p.raw_k), Float64Array.from(p.raw_q), 0), 1e-10);
  relClose(`${p.key}: k_p,0 from f vs reference`, kpF, p.kp0_um_inv, 1e-10);
  const kk = Float64Array.from(kSolver, (k, i) => k * k * f0[i]);
  relClose(`${p.key}: density from f`, trapz(kk, kSolver) / (2 * Math.PI ** 2), META.density_um3, 1e-12);

  for (const kernel of ['classical', 'quantum'] as KernelType[]) {
    const traj = kernel === 'classical' ? p.trajectory_classical : p.trajectory_quantum;
    const res = await runWKE({
      rhs: makeBareRhs(geom, kernel, META.ncal), grid: pGrid, gridWeights: geom.weights,
      t0_s: META.t0_s, xi_um: META.xi_um, kp0_um_inv: kpF, f0, peakDepth: 0,
      tauMax: 400, rtol: 1e-7, atol: 1e-10,
      tauEval: traj.t_s.map((t: number) => t / META.t0_s),
    });
    timings.push({ key: p.key, kernel, ms: res.wallTime_ms, steps: res.nSteps });
    const want = kernel === 'classical' ? p.dt_half_classical_s : p.dt_half_quantum_s;
    check(`${p.key}: ${kernel} reached k_p,0/2`, res.reachedTarget && res.termination === 'target', `${res.termination}`);
    relClose(`${p.key}: ${kernel} Δt₁ᐟ₂`, res.dtTarget_s!, want, HALF_TIME_TOL);
    const stages = res.snapshots.filter((s) => s.stage !== 'sample').map((s) => s.stage);
    check(`${p.key}: ${kernel} stage snapshots`, ['initial', '0.90', '0.75', '0.50'].every((s) => stages.includes(s)), stages.join(' '));
    let worst = 0;
    let checked = 0;
    for (let i = 0; i < res.evalTrack.kp.length && i < traj.kp.length; i++) {
      worst = Math.max(worst, Math.abs(res.evalTrack.kp[i] / traj.kp[i] - 1));
      checked++;
    }
    check(`${p.key}: ${kernel} k_p(t) checkpoints (${checked})`, checked >= 20 && worst < 2e-3, `max rel=${worst.toExponential(2)}`);
  }
}

const gaussian = profiles[0];
const qGauss = normalizeQ(interpolateQ(gaussian.raw_k, gaussian.raw_q, kSolver), kSolver);
const fGauss = buildInitialF(qGauss, kSolver, META.density_um3);
const kpGauss = peakMomentumFromF(kSolver, fGauss, 0);
const parityRun = (extra: Partial<Parameters<typeof runWKE>[0]>) => runWKE({
  rhs: makeBareRhs(geom, 'classical', META.ncal), grid: pGrid, gridWeights: geom.weights,
  t0_s: META.t0_s, xi_um: META.xi_um, kp0_um_inv: kpGauss, f0: fGauss, tauMax: 400, rtol: 1e-7, atol: 1e-10,
  peakDepth: 0, ...extra,
});

section('Configurable stop target');
{
  const res = await parityRun({ stopKpFraction: 0.8 });
  check('custom target is reached', res.reachedTarget, `${res.termination}`);
  relClose('custom target stops at the requested k_p ratio', res.snapshots.at(-1)!.kp_um_inv / kpGauss, 0.8, 2e-4);
  check('custom target is earlier than the half-time', res.dtTarget_s! < gaussian.dt_half_classical_s,
    `${res.dtTarget_s} s vs ${gaussian.dt_half_classical_s} s`);
}

section('Classical dynamics depend on n and a only through na');
{
  const results: number[] = [];
  for (const factor of [1, 4]) {
    const n = META.density_um3 * factor;
    const s = computeScales(n, META.scattering_length_a0 / factor, SPECIES.K39);
    const kLoc = Float64Array.from(pGrid, (pp) => pp / s.xi_um);
    const q = normalizeQ(interpolateQ(gaussian.raw_k, gaussian.raw_q, kLoc), kLoc);
    const f0 = buildInitialF(q, kLoc, n);
    const res = await runWKE({
      rhs: makeBareRhs(geom, 'classical', s.ncal), grid: pGrid, gridWeights: geom.weights,
      t0_s: s.t0_s, xi_um: s.xi_um, kp0_um_inv: peakMomentumFromF(kLoc, f0), f0, tauMax: 400, rtol: 1e-7, atol: 1e-10,
    });
    results.push(res.dtTarget_s!);
  }
  relClose('Δt₁ᐟ₂ at (n, a) == at (4n, a/4)', results[1], results[0], 2e-3);
}

section('Weak-coupling grid headroom');
{
  const density = 400_000 / 140_000;
  const scales = computeScales(density, 8, SPECIES.K39);
  const pMax = solverPMax(scales.xi_um);
  const pWeak = logarithmicGrid(P_MIN, pMax, N_GRID);
  const kWeak = Float64Array.from(pWeak, (p) => p / scales.xi_um);
  const q = normalizeQ(Float64Array.from(kWeak, (k) => Math.exp(-0.5 * ((k - 1.5) / 0.21) ** 2)), kWeak);
  const f0 = buildInitialF(q, kWeak, density);
  const weakGeom = buildGeometry(pWeak, pMax / Math.SQRT2, parityQuad);
  const res = await runWKE({
    rhs: makeBareRhs(weakGeom, 'quantum', scales.ncal), grid: pWeak, gridWeights: weakGeom.weights,
    t0_s: scales.t0_s, xi_um: scales.xi_um, kp0_um_inv: peakMomentumFromF(kWeak, f0), f0, tauMax: 400, rtol: 1e-7, atol: 1e-10,
  });
  check('weak-coupling quantum run reaches k_p,0/2', res.reachedTarget, `${res.termination}`);
  check('weak-coupling particle drift below 5%', res.maxDN < 0.05, `max drift=${(100 * res.maxDN).toFixed(3)}%`);
  check('weak-coupling energy drift below 5%', res.maxDE < 0.05, `max drift=${(100 * res.maxDE).toFixed(3)}%`);
}

section('Continue simulating');
{
  const segment1 = await parityRun({});
  check('segment 1 reaches k_p,0/2', segment1.reachedTarget, `${segment1.termination}`);
  const totalTau = segment1.finalTau * 2;
  const segment2 = await parityRun({ f0: segment1.finalF, tauMax: totalTau - segment1.finalTau, haltOnHalf: false });
  const reference = await parityRun({ tauMax: totalTau, haltOnHalf: false });
  relClose('resumed run reaches the same k_p as an uninterrupted run',
    segment2.kpTrack.kp.at(-1)!, reference.kpTrack.kp.at(-1)!, 5e-4);
  const qReference = reference.snapshots.at(-1)!.q;
  const qResumed = segment2.snapshots.at(-1)!.q;
  let worstQ = 0;
  for (let i = 0; i < qReference.length; i++) {
    if (qReference[i] > 1e-6) worstQ = Math.max(worstQ, Math.abs(qResumed[i] / qReference[i] - 1));
  }
  check('resumed run reproduces the spectrum shape', worstQ < 1e-2, `max rel=${worstQ.toExponential(2)}`);
}

// ------------------------------------------------------- accuracy levels ---

section('Accuracy levels (full pipeline, bare classical)');
{
  // Converged half-time of the Gaussian shell at the reference conditions,
  // from the convergence study (2000 grid points, quadrature converged).
  const CONVERGED_S = 0.314305;
  const request = (accuracy: WKERunRequest['accuracy'], a_a0: number): WKERunRequest => ({
    type: 'run', runId: 't', model: 'bare', kernel: 'classical', accuracy, components: 1,
    q: Array.from(interpolateQ(gaussian.raw_k, gaussian.raw_q, INPUT_GRID)),
    density_um3: META.density_um3, a_a0, speciesKey: 'K39', stopKpFraction: 0.5, tauMax: 4000, nSnapshots: 40,
  });
  const backend = localBackend();
  const draft = (await runSimulation(request('draft', 50), backend)).result;
  const standard = (await runSimulation(request('standard', 50), backend)).result;
  const attractive = (await runSimulation(request('standard', -50), backend)).result;
  relClose('Draft half-time within 3% of converged', draft.dtTarget_s!, CONVERGED_S, 3e-2);
  relClose('Standard half-time within 0.05% of converged', standard.dtTarget_s!, CONVERGED_S, 5e-4);
  relClose('bare kinetics are blind to the sign of a', attractive.dtTarget_s!, standard.dtTarget_s!, 1e-12);
  check('Standard run keeps particle drift below 1%', standard.maxDN < 1e-2, `${(100 * standard.maxDN).toFixed(3)}%`);
  note(`  Draft ${(draft.dtTarget_s! * 1e3).toFixed(3)} ms (${draft.nEvents} events), Standard ${(standard.dtTarget_s! * 1e3).toFixed(3)} ms (${standard.nEvents} events)`);
}

console.log('Solver timings (Node, single thread):');
for (const t of timings) {
  console.log(`  ${t.key.padEnd(20)} ${t.kernel.padEnd(10)} ${(t.ms / 1000).toFixed(2)} s  ${t.steps} steps`);
}
report();
