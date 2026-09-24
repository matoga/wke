/**
 * One headless simulation run for analysis studies.
 *
 *   npx tsx analysis/run.ts --state gaussian_shell --a 25 --model chain --accuracy draft \
 *     --target 25 --out analysis/results/<study>/runs/<name>.json [--pmin 0.001] [--wall 300] [--snapshots 16]
 *     [--kernel classical|quantum]   (quantum: the WKE with the +1 terms; default classical)
 *     [--density 2.8331] [--species K39] [--loopScale 1]
 *     [--tmax_ms T] [--snapTimes_ms t1,t2,...] [--breakdown continue|stop] [--maxDrift 0.05]
 *
 * With --tmax_ms the run stops at the physical time T (status `time`) and --target may be left out;
 * with --snapTimes_ms the n_k snapshots are taken at exactly these times (ms) instead of the log(k_ξ/k_p) targets.
 * --breakdown stop ends the run (status `pole`) when the model reports a breakdown, such as a one-loop
 * bracket turning negative; the default continues through it. --maxDrift d ends the run (status `drift`) when
 * the particle number ∫k²f dk or the kinetic energy ∫k⁴f dk leaves 1 ± d of its initial value; both are
 * recorded at every rate sample and snapshot (fields N_rel, E_rel).
 *
 * Records, at samples spaced by 0.02 decades in k_ξ/k_p:
 *   - the smooth peak k_p (weighted parabola fit of ln(k² n_k) against ln k),
 *   - the instantaneous rate (m/ħ) d(1/k_p²)/dt, taken from the collision term itself:
 *       dk_p/dτ = [k_p(f + εC) − k_p(f − εC)] / 2ε,  C = ∂τ f,  d(1/k_p²)/dt = −2 k_p⁻³ dk_p/dτ / t₀,
 *     with an uncertainty from two peak-fit widths (δ = 0.02, 0.05) and two steps (ε, 2ε),
 *   - the largest resummed weight (pole indicator),
 *   - the length ℓ̄ = (f(k→0)/n)^(1/3) (fields ell_um, ellRate, ellRateErr), f(k→0) from a fit
 *     ln f = A + B k² over k ≤ k_p/5, and (m/ħ) dℓ̄²/dt, also from the collision term; the plots turn
 *     it into the coherence length ℓ = ℓ̄ η_eq^(−1/3) for Bose +1 runs,
 * and the occupation n_k at `snapshots` times spaced evenly in log(k_ξ/k_p).
 * The file is rewritten every 30 s, so a stopped run keeps what it reached.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { getPreset } from '../src/physics/presets';
import { logarithmicGrid, interpolateQ, normalizeQ } from '../src/physics/grid';
import { trapezoidWeights } from '../src/physics/collision';
import { computeScales } from '../src/physics/scales';
import { peakMomentumFromF, INPUT_GRID } from '../src/physics/descriptors';
import { buildInitialF, runWKE } from '../src/physics/integrator';
import { localBackend } from '../src/physics/simulate';
import { SPECIES, P_MIN, solverPMax, HBAR_JS, KB_JK } from '../src/physics/constants';
import { PRECISION } from '../src/physics/precision';
import type { AccuracyLevel } from '../src/physics/precision';
import { MODEL_BY_ID } from '../src/physics/models';
import type { ModelId } from '../src/physics/models';
import type { KernelType } from '../src/physics/collision';

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) out[v[i].replace(/^--/, '')] = v[i + 1];
  return out;
}
const A = args();
for (const k of ['state', 'a', 'model', 'accuracy', 'out']) {
  if (!A[k]) throw new Error(`missing --${k}`);
}
if (!A.target && !A.tmax_ms) throw new Error('missing --target (or --tmax_ms)');
const state = A.state, a = Number(A.a), model = A.model as ModelId, accuracy = A.accuracy as AccuracyLevel;
const target = A.target ? Number(A.target) : Infinity, out = A.out;
const tmax_ms = A.tmax_ms ? Number(A.tmax_ms) : undefined;
const snapTimes_ms = A.snapTimes_ms ? A.snapTimes_ms.split(',').map(Number).filter((t) => t > 0).sort((x, y) => x - y) : undefined;
if (A.kernel === 'quantum' && !MODEL_BY_ID[model].allowsQuantum) {
  throw new Error(`--kernel quantum: model ${model} has no quantum kernel (the solver would run it classical)`);
}
const pMin = Number(A.pmin ?? 0.001), wallCap = Number(A.wall ?? 600), nSnap = Number(A.snapshots ?? 16);
const density = Number(A.density ?? 2.8331), speciesKey = A.species ?? 'K39';
const kernel = (A.kernel ?? 'classical') as KernelType;
const stopAtBreakdown = (A.breakdown ?? 'continue') === 'stop';
const maxDrift = A.maxDrift === undefined ? Infinity : Number(A.maxDrift);
if (A.breakdown && A.breakdown !== 'stop' && A.breakdown !== 'continue') throw new Error(`unknown --breakdown ${A.breakdown}`);
// multiplies every loop, so for the exchange chain it is the rung weight c in 1/|1 − c L₋|² (calibration scans only)
const loopScale = A.loopScale === undefined ? undefined : Number(A.loopScale);
if (kernel !== 'classical' && kernel !== 'quantum') throw new Error(`unknown --kernel ${kernel}`);

const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const meta = {
  command: `npx tsx analysis/run.ts ${process.argv.slice(2).join(' ')}`,
  gitCommit: git('rev-parse --short HEAD'),
  gitDirty: git('status --porcelain -- src') !== '',
  started: new Date().toISOString(),
  node: process.version,
};

const preset = getPreset(state);
if (preset.key !== state) throw new Error(`unknown --state ${state}`);
const spectrum = preset.load();
const species = SPECIES[speciesKey];
const hbarOverM = (HBAR_JS / species.massKg) * 1e12; // μm²/s
const sc = computeScales(density, a, species);
const level = PRECISION[accuracy];
const pMax = solverPMax(sc.xi_um);
// keep the accuracy level's points per decade when the grid is extended below P_MIN
const nGrid = Math.round(level.nGrid * Math.log(pMax / pMin) / Math.log(pMax / P_MIN));
const grid = logarithmicGrid(pMin, pMax, nGrid);
const k = Float64Array.from(grid, (p) => p / sc.xi_um);
const lnk = Float64Array.from(k, Math.log);
const f0 = buildInitialF(normalizeQ(interpolateQ(Array.from(INPUT_GRID), Array.from(spectrum.q), k, { lower: 'power-law' }), k), k, density);
const kp0 = peakMomentumFromF(k, f0);
const kXi = 1 / sc.xi_um;
const stopFraction = Number.isFinite(target) ? (kXi / kp0) / target : 1e-9;

// kinetic energy per atom of the initial state, ħ²⟨k²⟩/2m (nK); independent of a
let EN_nK = 0;
{
  const kin = Array.from(INPUT_GRID), qin = Array.from(spectrum.q);
  let norm = 0, k2 = 0;
  for (let i = 0; i < kin.length - 1; i++) {
    const dk = kin[i + 1] - kin[i];
    norm += 0.5 * dk * (qin[i] + qin[i + 1]);
    k2 += 0.5 * dk * (kin[i] ** 2 * qin[i] + kin[i + 1] ** 2 * qin[i + 1]);
  }
  EN_nK = (HBAR_JS ** 2 * (k2 / norm) * 1e12) / (2 * species.massKg * KB_JK) * 1e9;
}

/** Smooth peak: weighted parabola fit of ln(k² f) vs ln k, weights exp(−(L_max − L)/δ). */
function kpSmooth(f: Float64Array, delta: number): number {
  let Lmax = -Infinity, iMax = 0;
  const L = new Float64Array(k.length);
  for (let i = 0; i < k.length; i++) {
    L[i] = f[i] > 0 ? Math.log(k[i] * k[i] * f[i]) : -Infinity;
    if (L[i] > Lmax) { Lmax = L[i]; iMax = i; }
  }
  const xc = lnk[iMax];
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0, xLo = 0, xHi = 0;
  for (let i = 0; i < k.length; i++) {
    const drop = Lmax - L[i];
    if (!(drop < 12 * delta)) continue;
    const w = Math.exp(-drop / delta);
    const x = lnk[i] - xc, x2 = x * x;
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x);
    S0 += w; S1 += w * x; S2 += w * x2; S3 += w * x2 * x; S4 += w * x2 * x2;
    T0 += w * L[i]; T1 += w * x * L[i]; T2 += w * x2 * L[i];
  }
  const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) =>
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det3(S4, S3, S2, S3, S2, S1, S2, S1, S0);
  const Aq = det3(T2, S3, S2, T1, S2, S1, T0, S1, S0) / D;
  const Bq = det3(S4, T2, S2, S3, T1, S1, S2, T0, S0) / D;
  if (!(Aq < 0)) return k[iMax];
  // a flat or two-humped top can put the vertex far outside the fitted points; keep it inside them
  return Math.exp(xc + Math.min(xHi, Math.max(xLo, -Bq / (2 * Aq))));
}

const backend = localBackend();
const t0 = Date.now();
await backend.prepare({ level: accuracy, pMax, pMin, nGrid, model: MODEL_BY_ID[model].solver, kernel, loopScale, ncal: sc.ncal, sign: sc.sign });
const C = new Float64Array(k.length), fp = new Float64Array(k.length), fm = new Float64Array(k.length);

/** Instantaneous (m/ħ) d(1/k_p²)/dt at state f, its uncertainty, and the pole indicator. */
function rateAt(f: Float64Array): [number, number, number, number] {
  const diag = backend.rhs(f, C) as { poleIndicator: number };
  const kp = kpSmooth(f, 0.02);
  const ip = Math.max(0, k.findIndex((kk) => kk >= kp));
  let cmax = 0;
  for (let i = Math.max(0, ip - 20); i < Math.min(k.length, ip + 20); i++) cmax = Math.max(cmax, Math.abs(C[i]));
  const eps0 = cmax > 0 ? 1e-3 * Math.max(Math.abs(f[ip]), 1e-300) / cmax : 1e-6;
  const est: number[] = [];
  for (const eps of [eps0, 2 * eps0]) {
    for (let i = 0; i < f.length; i++) { fp[i] = f[i] + eps * C[i]; fm[i] = f[i] - eps * C[i]; }
    for (const delta of [0.02, 0.05]) {
      const dkp = (kpSmooth(fp, delta) - kpSmooth(fm, delta)) / (2 * eps);
      const kpd = kpSmooth(f, delta);
      est.push((-2 * dkp / (kpd * kpd * kpd)) / sc.t0_s / hbarOverM);
    }
  }
  let err = 0;
  for (const v of est) err = Math.max(err, Math.abs(v - est[0]));
  return [kXi / kp, est[0], err, diag.poleIndicator];
}

/** f(k→0): least-squares fit ln f = A + B k² over all grid points with k ≤ kMax; returns e^A. */
function f0Fit(f: Float64Array, kMax: number): number {
  let S0 = 0, S1 = 0, S2 = 0, T0 = 0, T1 = 0;
  for (let i = 0; i < k.length && k[i] <= kMax; i++) {
    if (!(f[i] > 0)) continue;
    const x = k[i] * k[i], y = Math.log(f[i]);
    S0 += 1; S1 += x; S2 += x * x; T0 += y; T1 += x * y;
  }
  if (S0 < 3) return f[0];
  return Math.exp((T0 * S2 - T1 * S1) / (S0 * S2 - S1 * S1));
}

/**
 * ℓ̄³ = f(k→0)/n from the zero-momentum occupation (η = 1; the plots divide by η_eq for ℓ),
 * and (m/ħ) dℓ̄²/dt = (2/3) ℓ̄² (∂τ f₀/f₀) / t₀, with ∂τ f₀ from the fit applied to f ± εC
 * (C the collision term left by rateAt). f₀ is fitted over k ≤ k_p/5; the uncertainty is the
 * spread over the fit windows k_p/5 and k_p/10 and the steps ε and 2ε.
 */
function ellAt(f: Float64Array, kp: number): [number, number, number] {
  const f0 = f0Fit(f, kp / 5);
  const ell = Math.cbrt(f0 / density);
  let cmax = 0;
  for (let i = 0; i < k.length && k[i] <= kp / 5; i++) cmax = Math.max(cmax, Math.abs(C[i]) / Math.max(f[i], 1e-300));
  const eps0 = cmax > 0 ? 1e-3 / cmax : 1e-6;
  const est: number[] = [];
  for (const kMax of [kp / 5, kp / 10]) {
    const f0w = f0Fit(f, kMax);
    for (const eps of [eps0, 2 * eps0]) {
      for (let i = 0; i < f.length; i++) { fp[i] = f[i] + eps * C[i]; fm[i] = f[i] - eps * C[i]; }
      const dlnf0 = (f0Fit(fp, kMax) - f0Fit(fm, kMax)) / (2 * eps * f0w);
      est.push(((2 / 3) * dlnf0 / sc.t0_s / hbarOverM) * Math.cbrt(f0w / density) ** 2);
    }
  }
  let err = 0;
  for (const v of est) err = Math.max(err, Math.abs(v - est[0]));
  return [ell, est[0], err];
}

const points = { t_s: [] as number[], X: [] as number[], rate: [] as number[], rateErr: [] as number[], poleWeight: [] as number[],
  ell_um: [] as number[], ellRate: [] as number[], ellRateErr: [] as number[], N_rel: [] as number[], E_rel: [] as number[] };

/** ∫k^m f dk on the grid (trapezoid). */
function moment(f: ArrayLike<number>, m: number): number {
  let s = 0;
  for (let i = 0; i < k.length - 1; i++) s += 0.5 * (k[i] ** m * f[i] + k[i + 1] ** m * f[i + 1]) * (k[i + 1] - k[i]);
  return s;
}
const N0 = moment(f0, 2), E0 = moment(f0, 4);
let drifted = false;
const X0 = kXi / kpSmooth(f0, 0.02);
// snapshots at log(k_ξ/k_p) targets, unless --snapTimes_ms gives the times
const snapTargets = snapTimes_ms ? [] : Array.from({ length: nSnap }, (_, i) => X0 * (target / X0) ** (i / Math.max(1, nSnap - 1)));
const snapshots = { t_s: [0] as number[], X: [X0] as number[], n_k: [Array.from(f0)] as number[][], N_rel: [1] as number[], E_rel: [1] as number[] };
const snapTau = (snapTimes_ms ?? []).map((t) => t * 1e-3 / sc.t0_s);
let nextSnap = 1, nextTimeSnap = 0, lastLogX = -Infinity, lastSave = Date.now();

const save = (status: Record<string, unknown>) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    schema: 'wke-analysis-run/1',
    meta: { ...meta, wall_s: (Date.now() - t0) / 1000 },
    settings: { state, stateName: preset.name, a_a0: a, model, modelLabel: MODEL_BY_ID[model].label, accuracy, target, pMin, pMax, nGrid,
      density_um3: density, species: speciesKey, kernel, loopScale: loopScale ?? 1, wallCap_s: wallCap,
      ...(tmax_ms ? { tmax_ms } : {}), ...(snapTimes_ms ? { snapTimes_ms } : {}), ...(stopAtBreakdown ? { breakdown: 'stop' } : {}),
      ...(Number.isFinite(maxDrift) ? { maxDrift } : {}) },
    scales: { kXi_um_inv: kXi, xi_um: sc.xi_um, t0_s: sc.t0_s, hbarOverM_um2_per_s: hbarOverM },
    initial: { kp0_um_inv: kp0, EN_nK },
    points, snapshots: { ...snapshots, k_um_inv: Array.from(k) },
    ...status,
  }));
};

const tauEval = [...Array.from({ length: 2401 }, (_, i) => 1e-5 * 10 ** (i / 300) / sc.t0_s), ...snapTau]
  .filter((tau) => tmax_ms === undefined || tau <= tmax_ms * 1e-3 / sc.t0_s * (1 + 1e-12))
  .sort((x, y) => x - y);
const res = await runWKE({
  rhs: backend.rhs, grid, gridWeights: trapezoidWeights(grid), t0_s: sc.t0_s, xi_um: sc.xi_um,
  kp0_um_inv: kp0, f0, tauMax: tmax_ms === undefined ? 1e6 : tmax_ms * 1e-3 / sc.t0_s, rtol: level.rtol, atol: level.atol, nSnapshots: 20,
  stopKpFraction: Math.min(stopFraction, 0.999), stopAtBreakdown,
  tauEval,
  shouldStop: () => drifted || (Date.now() - t0) / 1000 > wallCap,
  onEval: (tau: number, f: Float64Array) => {
    const X = kXi / kpSmooth(f, 0.02);
    const Nr = moment(f, 2) / N0, Er = moment(f, 4) / E0;
    if (Math.abs(Nr - 1) > maxDrift || Math.abs(Er - 1) > maxDrift) drifted = true;
    if (nextTimeSnap < snapTau.length && tau >= snapTau[nextTimeSnap] * (1 - 1e-9)) {
      snapshots.t_s.push(tau * sc.t0_s); snapshots.X.push(X); snapshots.n_k.push(Array.from(f));
      snapshots.N_rel.push(Nr); snapshots.E_rel.push(Er);
      while (nextTimeSnap < snapTau.length && tau >= snapTau[nextTimeSnap] * (1 - 1e-9)) nextTimeSnap++;
    }
    if (!snapTimes_ms && nextSnap < nSnap && X >= snapTargets[nextSnap]) {
      snapshots.t_s.push(tau * sc.t0_s); snapshots.X.push(X); snapshots.n_k.push(Array.from(f));
      snapshots.N_rel.push(Nr); snapshots.E_rel.push(Er);
      while (nextSnap < nSnap && X >= snapTargets[nextSnap]) nextSnap++;
    }
    if (Math.log10(X) - lastLogX < 0.02) return;
    lastLogX = Math.log10(X);
    const [x, y, e, w] = rateAt(Float64Array.from(f));
    points.t_s.push(tau * sc.t0_s); points.X.push(x); points.rate.push(y); points.rateErr.push(e); points.poleWeight.push(w);
    const [ell, ey, ee] = ellAt(f, kXi / x);
    points.ell_um.push(ell); points.ellRate.push(ey); points.ellRateErr.push(ee);
    points.N_rel.push(Nr); points.E_rel.push(Er);
    if (Date.now() - lastSave > 30000) { lastSave = Date.now(); save({ status: 'running' }); }
  },
});
const status = res.termination === 'stopped' ? (drifted ? 'drift' : 'wall-cap') : res.termination === 'tauMax' && tmax_ms !== undefined ? 'time' : res.termination;
save({ status, message: res.terminationMessage, finished: new Date().toISOString() });
console.log(`${state} a=${a} ${model}: ${status}, k_ξ/k_p reached ${points.X.at(-1)?.toFixed(2)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
