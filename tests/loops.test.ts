/**
 * Loop functionals and renormalised kinetic models.
 *
 * Reference values were computed independently (adaptive quadrature in the
 * continuum, cross-checked by Monte Carlo over the resonant manifold) for the
 * Gaussian shell q(k) ∝ exp[−(k − 2)²/(2·0.28²)] at k_ξ = 0.3 μm⁻¹, i.e. in
 * p = kξ units a Gaussian at p₀ = 20/3 with σ = 0.28/0.3, normalised on
 * [0.01, ∞). With N_cal = 2 the solver occupation is f = q_p/p².
 * The dressing ratios of heuristics B and C come from the continuum reference in analysis/reference/, which
 * reproduces the other three columns to 3 × 10⁻⁴.
 */

import { logarithmicGrid } from '../src/physics/grid';
import { buildGeometry, treePrefactor } from '../src/physics/collision';
import { leggauss } from '../src/physics/quadrature';
import { buildChannelGeometry } from '../src/physics/channels';
import {
  buildLoopOperator, chi0, createLoopState, evalH, imLminus, imLplus, makeLoopEvaluators, reLminus, reLplus, updateLoopState,
} from '../src/physics/loops';
import { makeBarePartial, makeLoopPartial, makeLoopRhs, RUNG_C } from '../src/physics/rhs';
import type { RhsDiagnostics } from '../src/physics/rhs';
import { runWKE } from '../src/physics/integrator';
import { INPUT_GRID } from '../src/physics/descriptors';
import { localBackend, runSimulation } from '../src/physics/simulate';
import type { WKERunRequest } from '../src/types/wke';
import { absClose, check, note, relClose, report, section } from './harness';

const P0 = 20 / 3;
const SIG = 0.28 / 0.3;
const qp = (p: number) => Math.exp(-((p - P0) ** 2) / (2 * SIG * SIG));
let Z = 0;
{
  const N = 200000, a = 0.01, b = 40, h = (b - a) / N;
  for (let i = 0; i <= N; i++) Z += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * qp(a + i * h);
  Z *= h / 3;
}
const P_MAX_REF = 28.9312;
const NCAL = 2;
const occupation = (grid: Float64Array) => Float64Array.from(grid, (p) => qp(p) / Z / (p * p));

// ------------------------------------------------------------ functionals ---

section('Loop functionals vs independent continuum values');
{
  const grid = logarithmicGrid(0.01, P_MAX_REF, 500);
  const st = createLoopState(buildLoopOperator(grid, 1000));
  updateLoopState(st, occupation(grid));
  // The 500-point grid resolves f to a few 1e-4; the finer grid below shows
  // the error falling at second order.
  for (const [x, v] of [[0.5, -2.4027462e-2], [3, -1.5763827e-1], [6.6666667, -4.9931614e-1], [9, -2.9653021e-1], [20, -1.0408138e-1]]) {
    relClose(`H(${x})`, evalH(st, x), v, 1e-3);
  }
  relClose('χ₀ = Re L₋(0) = −(1/N_cal)∫f', chi0(st, 1, NCAL), -1.19872544e-2, 1e-4);
  for (const [Q, w, re, im] of [
    [1, 0, -1.20137312e-2, 0], [0.5, 3, -1.60087950e-2, -5.73047e-5], [2, 10, -1.48009103e-2, -4.18988e-5],
    [5, 20, -1.52957042e-2, -3.82565e-4], [8, 30, -1.76035616e-2, -3.66021e-3], [13, 5, -1.90632221e-2, -1.49352e-3],
  ]) {
    relClose(`Re L₋(Q=${Q}, |ω|=${w})`, reLminus(st, Q, w, 1, NCAL), re, 1e-3);
    absClose(`Im L₋(Q=${Q}, |ω|=${w})`, imLminus(st, Q, w, 1, NCAL), im, 5e-3 * Math.max(Math.abs(im), 1e-4));
  }
  for (const [P, w, re] of [[6, 40, -3.97967534e-2], [10, 80, -1.80007585e-2], [13, 89, -2.80334232e-2], [3, 60, -4.74739971e-2]]) {
    relClose(`Re L₊(P=${P}, ω₊=${w})`, reLplus(st, P, w, 1, NCAL), re, 1e-3);
  }
  // Complex L₊ straight from its angular integral, ∫dμ 1/(A + Bμ + iη) with
  // A = ω₊ − 2q² − P², B = 2qP, on the continuum spectrum, with no use of H or J.
  const lPlusDirect = (P: number, w: number): [number, number] => {
    const N = 400000, a = 1e-4, b = 40, h = (b - a) / N, eta = 1e-7;
    let re = 0, im = 0;
    for (let i = 0; i <= N; i++) {
      const q = a + i * h;
      const c = (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * (h / 3) * q * q * (qp(q) / Z / (q * q));
      const A = w - 2 * q * q - P * P, B = 2 * q * P;
      re += (c * Math.log(((A + B) ** 2 + eta * eta) / ((A - B) ** 2 + eta * eta))) / (2 * B);
      im -= (c * (Math.atan((A + B) / eta) - Math.atan((A - B) / eta))) / B;
    }
    return [(2 / NCAL) * re, (2 / NCAL) * im];
  };
  for (const [P, w] of [[6, 40], [10, 80], [13, 89], [3, 60]]) {
    const [re, im] = lPlusDirect(P, w);
    relClose(`Re L₊(P=${P}, ω₊=${w}) from the angular integral`, reLplus(st, P, w, 1, NCAL), re, 1e-3);
    absClose(`Im L₊(P=${P}, ω₊=${w}) from the angular integral`, imLplus(st, P, w, 1, NCAL), im, 2e-3 * Math.max(Math.abs(im), 1e-4));
  }
  relClose('attractive sign flips every loop', reLminus(st, 5, 20, -1, NCAL), -reLminus(st, 5, 20, 1, NCAL), 1e-15);

  const ev = makeLoopEvaluators(st.op);
  ev.update(occupation(grid));
  relClose('fast evaluator == reference evaluator (Re L₋)', ev.lMinusRe(5, 20) / (2 * NCAL), reLminus(st, 5, 20, 1, NCAL), 1e-13);
  relClose('fast evaluator == reference evaluator (Im L₋)', (-Math.PI / (2 * NCAL)) * ev.lMinusIm(8, 30), imLminus(st, 8, 30, 1, NCAL), 1e-13);
  relClose('fast evaluator == reference evaluator (Re L₊)', ev.lPlus(6, 40) / NCAL, reLplus(st, 6, 40, 1, NCAL), 1e-13);
  relClose('fast evaluator == reference evaluator (Im L₊)', (-Math.PI / NCAL) * ev.lPlusIm(10, 80), imLplus(st, 10, 80, 1, NCAL), 1e-13);

  const fine = logarithmicGrid(0.01, P_MAX_REF, 2000);
  const stFine = createLoopState(buildLoopOperator(fine, 2000));
  updateLoopState(stFine, occupation(fine));
  relClose('H(9) on a 2000-point grid converges to 1e-4', evalH(stFine, 9), -2.9653021e-1, 1e-4);
  relClose('Re L₊(10, 80) on a 2000-point grid converges to 1e-4', reLplus(stFine, 10, 80, 1, NCAL), -1.80007585e-2, 1e-4);
}

section('Loop functional of a power law');
{
  // f = s^(−7/3) on [0.01, 20]; reference values from exact quadrature. The
  // solver holds f at f(p_min) below the grid, which adds
  // ∫₀^{s₀} s f₀ ln|(s − x)/(s + x)| ds = −2 f₀ [s₀³/(3x) + s₀⁵/(15x³) + …] for x ≫ s₀.
  const s0 = 0.01, f0 = s0 ** (-7 / 3);
  const grid = logarithmicGrid(s0, 20, 1500);
  const st = createLoopState(buildLoopOperator(grid, 1500));
  updateLoopState(st, Float64Array.from(grid, (s) => s ** (-7 / 3)));
  for (const [x, v] of [[0.1, -1.0326733e1], [1, -5.2745098], [5, -3.0149690]]) {
    const below = -2 * f0 * (s0 ** 3 / (3 * x) + s0 ** 5 / (15 * x ** 3));
    relClose(`H(${x})`, evalH(st, x), v + below, 1e-3);
  }
}

// ----------------------------------------------------------------- models ---

section('Model dressing ratios C_model/C_bare at grid points');

const grid = logarithmicGrid(0.01, P_MAX_REF, 500);
const f = occupation(grid);
const op = buildLoopOperator(grid, 1000);
const REF: Record<string, number[][]> = {
  '1': [
    [0.81966, 0.96714, 0.87778, 0.84153, 0.94047], [0.90198, 0.96434, 0.86730, 0.90488, 0.93540],
    [0.83647, 0.96612, 0.87414, 0.85444, 0.93865], [0.80001, 0.96613, 0.87517, 0.82623, 0.93882],
    [0.84750, 0.96573, 0.87237, 0.86303, 0.93789],
  ],
  '-1': [
    [1.18034, 1.03457, 1.14983, 1.20827, 1.06540], [1.09802, 1.03749, 1.16201, 1.09923, 1.07084],
    [1.16353, 1.03568, 1.15477, 1.18583, 1.06750], [1.19999, 1.03587, 1.15714, 1.23448, 1.06804],
    [1.15250, 1.03601, 1.15570, 1.17139, 1.06808],
  ],
};
const IDX = [375, 393, 407, 419, 428];
/** columns of REF */
const MODELS = ['one-loop', 'chain', 'heuristic-a', 'heuristic-b', 'heuristic-c'] as const;

for (const [label, quad, tol] of [
  ['parity quadrature', { nqLow: 16, nqHigh: 16, panels: 1 }, 5e-3],
  ['16x2 quadrature', { nqLow: 16, nqHigh: 16, panels: 2 }, 1e-3],
] as const) {
  const geom = buildGeometry(grid, P_MAX_REF / Math.SQRT2, quad);
  const ch = buildChannelGeometry(geom, 0.2, 64);
  const bare = new Float64Array(grid.length);
  makeBarePartial(geom, 'classical', NCAL)(f, bare);
  for (const sign of [1, -1]) {
    let worst = 0;
    for (let m = 0; m < MODELS.length; m++) {
      const out = new Float64Array(grid.length);
      makeLoopPartial({ model: MODELS[m], geom, channels: ch, loopOp: op, ncal: NCAL, sign, sNodes: 4 })(f, out);
      IDX.forEach((i, r) => { worst = Math.max(worst, Math.abs(out[i] / bare[i] - REF[String(sign)][r][m])); });
    }
    check(`${label}, a ${sign > 0 ? '> 0' : '< 0'}: one loop, chain, heuristics A, B and C`, worst <= tol, `max |Δ| = ${worst.toExponential(2)} (tol ${tol})`);
  }
}

section('Heuristic B near its pole: joint s-t average');
{
  // At 3× the reference coupling (a < 0) the weights 1/|1 − Z|² reach ≈ 4. The solver's joint average
  // (Q by cells, the s-channel angle by the midpoint rule) is compared with a direct average of the
  // same events: 24 Gauss points in P, and for each P the dihedral angle φ, with Q² = A − B cos φ,
  // on 64 midpoints, evaluating the loops afresh at every point.
  const sign = -1, scale = 3, cp = (sign * scale) / NCAL;
  const ev = makeLoopEvaluators(op);
  ev.update(f);
  const G = leggauss(24), NPHI = 64;
  for (const i of [407, 419]) {
    const geom = buildGeometry(grid, P_MAX_REF / Math.SQRT2, { nqLow: 16, nqHigh: 16, panels: 2 }, { stride: grid.length, offset: i });
    const out = new Float64Array(grid.length);
    makeLoopPartial({ model: 'heuristic-b', geom, channels: buildChannelGeometry(geom, 0.2, 64), loopOp: op, ncal: NCAL, sign, sNodes: 4, loopScale: scale })(f, out);
    const { weight, i1, a1, i2, a2, i3, a3, p2: p2e, targetPairs, pairOffsets, pairP1 } = geom;
    const p = grid[i], pSq = p * p, fp = f[i];
    const at = (j: number, u: number) => (1 - u) * f[j] + u * f[j + 1];
    let joint = 0, product = 0;
    for (let k = targetPairs[i]; k < targetPairs[i + 1]; k++) {
      const p1 = pairP1[k], w = Math.abs(pSq - p1 * p1);
      for (let e = pairOffsets[k]; e < pairOffsets[k + 1]; e++) {
        const f1 = at(i1[e], a1[e]), f2 = at(i2[e], a2[e]), f3 = at(i3[e], a3[e]);
        const rate = weight[e] * (f1 * f2 * (fp + f3) - fp * f3 * (f1 + f2));
        const q2 = p2e[e], p3Sq = Math.max(p1 * p1 + q2 * q2 - pSq, 0), p3 = Math.sqrt(p3Sq);
        const lo = Math.max(Math.abs(p - p3), Math.abs(p1 - q2)), hi = Math.min(p + p3, p1 + q2);
        const qa = Math.max(Math.abs(p - p1), Math.abs(q2 - p3)), qb = Math.min(p + p1, q2 + p3);
        const weightAt = (P: number, Q: number) => {
          const Qc = Math.max(Q, 1e-12);
          const re = cp * ev.lPlus(P, pSq + p3Sq) + 2 * cp * ev.lMinusRe(Qc, w);
          const im = 2 * Math.PI * cp * ev.lMinusIm(Qc, w);
          return 1 / ((1 - re) ** 2 + im * im);
        };
        let mJ = 0, mP = 0;
        for (let a = 0; a < G.x.length; a++) {
          const P = 0.5 * (lo + hi) + 0.5 * (hi - lo) * G.x[a];
          const aPar = (pSq + P * P - p3Sq) / (2 * P), bPar = (p1 * p1 + P * P - q2 * q2) / (2 * P);
          const A = pSq + p1 * p1 - 2 * aPar * bPar;
          const B = 2 * Math.sqrt(Math.max(pSq - aPar ** 2, 0) * Math.max(p1 * p1 - bPar ** 2, 0));
          let sj = 0;
          for (let m = 0; m < NPHI; m++) sj += weightAt(P, Math.sqrt(Math.max(A - B * Math.cos(((m + 0.5) * Math.PI) / NPHI), 0)));
          mJ += (0.5 * G.w[a] * sj) / NPHI;
          let sp = 0;
          for (let b = 0; b < G.x.length; b++) sp += 0.5 * G.w[b] * weightAt(P, 0.5 * (qa + qb) + 0.5 * (qb - qa) * G.x[b]);
          mP += 0.5 * G.w[a] * sp;
        }
        joint += rate * mJ;
        product += rate * mP;
      }
    }
    joint *= treePrefactor(NCAL);
    product *= treePrefactor(NCAL);
    relClose(`p = ${p.toFixed(3)}: solver = direct joint average`, out[i], joint, 1e-3);
    note(`  joint − product measure: ${((joint - product) / joint).toExponential(2)} (relative)`);
  }
}

section('Model identities');
{
  const geom = buildGeometry(grid, P_MAX_REF / Math.SQRT2, { nqLow: 12, nqHigh: 12, panels: 1 });
  const ch = buildChannelGeometry(geom, 0.2, 64);
  const n = grid.length;
  const bare = new Float64Array(n);
  makeBarePartial(geom, 'classical', NCAL)(f, bare);
  const bareMax = Math.max(...Array.from(bare, Math.abs));
  const run = (model: typeof MODELS[number], sign: number, loopScale = 1, ff = f) => {
    const out = new Float64Array(n);
    const part = makeLoopPartial({ model, geom, channels: ch, loopOp: op, ncal: NCAL, sign, sNodes: 4, loopScale })(ff, out);
    return { out, part };
  };
  const maxDiff = (a: Float64Array, b: Float64Array) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };

  for (const model of MODELS) {
    const d = maxDiff(run(model, 1, 0).out, bare) / bareMax;
    check(`${model}: switching the loops off gives the bare equation`, d < 1e-13, `max rel = ${d.toExponential(2)}`);
  }

  const plus = run('one-loop', 1).out, minus = run('one-loop', -1).out;
  const avg = Float64Array.from(plus, (v, i) => 0.5 * (v + minus[i]));
  const parity = maxDiff(avg, bare) / bareMax;
  check('one loop is odd in a: C(+a) + C(−a) = 2 C_bare', parity < 1e-12, `max rel = ${parity.toExponential(2)}`);

  // First order: chain → 1 + 2 Re L₋, heuristic A → 1 + 8 Re L₋,
  // heuristic B → 1 + 2 Re L₊ + 8 Re L₋ (the one-loop bracket).
  const eps = 1e-3;
  const dc = run('chain', 1, eps).out, dh = run('heuristic-b', 1, eps).out, dl = run('one-loop', 1, eps).out;
  const da = run('heuristic-a', 1, eps).out;
  let na = 0, nc = 0;
  for (let i = 0; i < n; i++) { na += Math.abs(da[i] - bare[i]); nc += Math.abs(dc[i] - bare[i]); }
  relClose('weak coupling: (heuristic A − bare) = 4 (chain − bare)', na / nc, 4, 1e-2);
  let num = 0, den = 0, dev = 0, act = 0;
  for (let i = 0; i < n; i++) {
    num += Math.abs(dh[i] - bare[i]);
    den += Math.abs(dc[i] - bare[i]);
    dev = Math.max(dev, Math.abs(dh[i] - dl[i]));
    act = Math.max(act, Math.abs(dl[i] - bare[i]));
  }
  check('weak coupling: heuristic B = one loop at first order', dev / act < 1e-2, `max |heuristic − one loop| / max |one loop − bare| = ${(dev / act).toExponential(2)}`);
  check('weak coupling: the particle-particle chain matters (heuristic B ≠ 4 × chain)', Math.abs(num / den - 4) > 0.05, `ratio ${(num / den).toFixed(3)}`);

  // Conservation quality: the loops must not degrade the discrete scheme's
  // number and energy balance appreciably.
  const activity = (c: Float64Array, power: number) => {
    let s = 0, a = 0;
    for (let i = 0; i < n; i++) {
      const w = geom.weights[i] * grid[i] ** power;
      s += w * c[i];
      a += w * Math.abs(c[i]);
    }
    return Math.abs(s) / a;
  };
  const nBare = activity(bare, 2), eBare = activity(bare, 4);
  for (const model of MODELS) {
    for (const sign of [1, -1]) {
      const c = run(model, sign).out;
      check(`${model}, sign ${sign}: number balance within 15% of bare`, Math.abs(activity(c, 2) / nBare - 1) < 0.15,
        `${activity(c, 2).toExponential(2)} vs ${nBare.toExponential(2)}`);
      check(`${model}, sign ${sign}: energy balance within 15% of bare`, Math.abs(activity(c, 4) / eBare - 1) < 0.15,
        `${activity(c, 4).toExponential(2)} vs ${eBare.toExponential(2)}`);
    }
  }

  // Rayleigh-Jeans is a fixed point of every model.
  const rj = Float64Array.from(grid, (p) => 0.05 / (p * p + 0.3));
  const rjBare = new Float64Array(n);
  makeBarePartial(geom, 'classical', NCAL)(rj, rjBare);
  const rjScale = Math.max(...Array.from(rjBare, Math.abs));
  for (const model of MODELS) {
    const r = run(model, -1, 1, rj).out;
    const m = Math.max(...Array.from(r, Math.abs));
    check(`${model}: Rayleigh-Jeans residual stays at the bare discretisation level`, m < 3 * rjScale,
      `${m.toExponential(2)} vs bare ${rjScale.toExponential(2)}`);
  }

  // Partitioned loop right-hand sides add up to the full one.
  const full = run('heuristic-b', -1).out;
  const summed = new Float64Array(n);
  for (let off = 0; off < 3; off++) {
    const g = buildGeometry(grid, P_MAX_REF / Math.SQRT2, { nqLow: 12, nqHigh: 12, panels: 1 }, { stride: 3, offset: off });
    const out = new Float64Array(n);
    makeLoopPartial({ model: 'heuristic-b', geom: g, channels: buildChannelGeometry(g, 0.2, 64), loopOp: op, ncal: NCAL, sign: -1, sNodes: 4 })(f, out);
    for (let i = 0; i < n; i++) summed[i] += out[i];
  }
  const dp = maxDiff(full, summed) / Math.max(...Array.from(full, Math.abs));
  check('partitioned loop right-hand sides add up to the full one', dp < 1e-12, `max rel = ${dp.toExponential(2)}`);

  // Bose +1 statistics: exchange-chain models only, dressing unchanged.
  {
    const bareQ = new Float64Array(n);
    makeBarePartial(geom, 'quantum', NCAL)(f, bareQ);
    const bareQMax = Math.max(...Array.from(bareQ, Math.abs));
    const runQ = (model: 'chain' | 'heuristic-a' | 'heuristic-c', loopScale = 1, ff = f) => {
      const out = new Float64Array(n);
      makeLoopPartial({ model, geom, channels: ch, loopOp: op, ncal: NCAL, sign: -1, sNodes: 4, loopScale, kernel: 'quantum' })(ff, out);
      return out;
    };
    // heuristic C is the chain with its rung weight RUNG_C
    const dC = maxDiff(runQ('heuristic-c'), runQ('chain', RUNG_C)) / Math.max(...Array.from(runQ('chain', RUNG_C), Math.abs));
    check('heuristic C = chain with loops scaled by its rung weight', dC < 1e-12, `max rel = ${dC.toExponential(2)}`);
    for (const model of ['chain', 'heuristic-a', 'heuristic-c'] as const) {
      const d = maxDiff(runQ(model, 0), bareQ) / bareQMax;
      check(`${model}, Bose +1: switching the loops off gives the bare quantum equation`, d < 1e-13, `max rel = ${d.toExponential(2)}`);
      const c = runQ(model);
      for (const [power, what] of [[2, 'number'], [4, 'energy']] as const) {
        const r = activity(c, power) / activity(bareQ, power);
        check(`${model}, Bose +1: ${what} balance within 15% of bare quantum`, Math.abs(r - 1) < 0.15, `ratio ${r.toFixed(3)}`);
      }
    }
    // Bose-Einstein is a fixed point: every event has g = l, whatever its dressing.
    const be = Float64Array.from(grid, (p) => 1 / Math.expm1((p * p + 0.3) / 0.8));
    const beBare = new Float64Array(n);
    makeBarePartial(geom, 'quantum', NCAL)(be, beBare);
    const beScale = Math.max(...Array.from(beBare, Math.abs));
    const beChain = Math.max(...Array.from(runQ('chain', 1, be), Math.abs));
    check('chain, Bose +1: Bose-Einstein residual stays at the bare discretisation level', beChain < 3 * beScale,
      `${beChain.toExponential(2)} vs bare ${beScale.toExponential(2)}`);
    for (const model of ['one-loop', 'heuristic-b'] as const) {
      let threw = false;
      try { makeLoopPartial({ model, geom, channels: ch, loopOp: op, ncal: NCAL, sign: -1, sNodes: 4, kernel: 'quantum' }); } catch { threw = true; }
      check(`${model}: the Bose +1 kernel is refused`, threw, threw ? 'throws' : 'accepted');
    }
  }

  // Diagnostics and the pole alarm.
  const weak = makeLoopRhs({ model: 'heuristic-b', geom, channels: ch, loopOp: op, ncal: NCAL, sign: -1, sNodes: 4 });
  const dWeak = weak(f, new Float64Array(n)) as RhsDiagnostics;
  check('reference coupling is far from the pole', dWeak.stop === null && dWeak.poleIndicator < 2 && dWeak.poleShare === 0,
    `1/min|1 − 4L|² = ${dWeak.poleIndicator.toFixed(3)}, rate share at the pole ${dWeak.poleShare}`);
  check('collision-weighted dressing is positive for a < 0', dWeak.loopDressing > 0.1, `${dWeak.loopDressing.toFixed(4)}`);
  const strong = makeLoopRhs({ model: 'heuristic-b', geom, channels: ch, loopOp: op, ncal: NCAL, sign: -1, sNodes: 4, loopScale: 12 });
  const dStrong = strong(f, new Float64Array(n)) as RhsDiagnostics;
  check('strong attractive coupling trips the pole alarm', dStrong.stop !== null, `rate share at the pole ${(100 * dStrong.poleShare).toFixed(1)}%, largest sampled weight ${dStrong.poleIndicator.toFixed(1)}`);
  const oneLoopStrong = makeLoopRhs({ model: 'one-loop', geom, channels: ch, loopOp: op, ncal: NCAL, sign: 1, sNodes: 4, loopScale: 12 });
  const d1 = oneLoopStrong(f, new Float64Array(n)) as RhsDiagnostics;
  check('strong repulsive coupling turns the one-loop bracket negative and stops', d1.stop !== null, `M_min = ${d1.poleIndicator.toFixed(2)}`);

  // An integration that runs into the pole ends cleanly.
  const res = await runWKE({
    rhs: strong, grid, gridWeights: geom.weights, t0_s: 1, xi_um: 1, kp0_um_inv: P0, f0: f, tauMax: 1e6,
  });
  check('a run that meets the pole ends with termination = pole', res.termination === 'pole' && res.terminationMessage !== null,
    `${res.termination}: ${res.terminationMessage}`);
  check('a pole stop keeps the initial state', res.snapshots.length >= 2, `${res.snapshots.length} snapshots`);
}

// ------------------------------------------------------------ end to end ---

section('Models end to end (Draft, one-component gas)');
{
  const gaussQ = Array.from(INPUT_GRID, (k) => Math.exp(-0.5 * ((k - 2) / 0.28) ** 2));
  const req = (model: WKERunRequest['model'], a_a0: number): WKERunRequest => ({
    type: 'run', runId: 't', model, kernel: 'classical', accuracy: 'draft',
    q: gaussQ, density_um3: 2.8331, a_a0, speciesKey: 'K39', stopKpFraction: 0.5, stopAtBreakdown: true, tauMax: 4000, nSnapshots: 20,
  });
  const backend = localBackend();
  const t = async (model: WKERunRequest['model'], a: number) =>
    (await runSimulation(req(model, a), backend)).result;
  // One loop is only perturbative at weaker coupling: at 50 a₀ this shell
  // already carries a −40% dressing and the bracket goes negative mid-run.
  const bare25 = await t('bare', 25);
  const oneRep = await t('one-loop', 25);
  const oneAtt = await t('one-loop', -25);
  const oneStrong = await t('one-loop', 50);
  const bare = await t('bare', 50);
  const chain = await t('chain', -50);
  const heur = await t('heuristic-a', -50);
  const heurB = await t('heuristic-b', -50);
  // at −150 a₀ the attractive dressing of heuristic A exceeds 10 on more than 1% of the rate early on
  const heurStrong = await t('heuristic-a', -150);
  check('one loop at 50 a₀ stops cleanly when the bracket turns negative', oneStrong.termination === 'pole',
    `${oneStrong.termination} at k_p/k_p,0 = ${(oneStrong.kpTrack.kp.at(-1)! / oneStrong.kp0_um_inv).toFixed(3)}`);
  for (const r of [bare25, oneRep, oneAtt, bare, chain, heur, heurB]) {
    check(`${r.model} (a ${r.scales.sign > 0 ? '> 0' : '< 0'}) reaches the target`, r.termination === 'target', `${r.termination} ${r.terminationMessage ?? ''}`);
  }
  check('repulsion slows the one-loop relaxation', oneRep.dtTarget_s! > bare25.dtTarget_s!,
    `${(oneRep.dtTarget_s! / bare25.dtTarget_s!).toFixed(4)} × bare`);
  check('attraction speeds up the one-loop relaxation', oneAtt.dtTarget_s! < bare25.dtTarget_s!,
    `${(oneAtt.dtTarget_s! / bare25.dtTarget_s!).toFixed(4)} × bare`);
  check('heuristic A at −150 a₀ runs into its pole and stops cleanly', heurStrong.termination === 'pole' && heurStrong.terminationMessage !== null,
    `${heurStrong.termination} at k_p/k_p,0 = ${(heurStrong.kpTrack.kp.at(-1)! / heurStrong.kp0_um_inv).toFixed(3)}: ${heurStrong.terminationMessage}`);
  check('attraction speeds up heuristic A', heur.dtTarget_s! < bare.dtTarget_s!,
    `${(heur.dtTarget_s! / bare.dtTarget_s!).toFixed(4)} × bare`);
  note(`  t/t_bare: one loop at ±25 a₀ ${(oneRep.dtTarget_s! / bare25.dtTarget_s!).toFixed(4)} / ${(oneAtt.dtTarget_s! / bare25.dtTarget_s!).toFixed(4)}; at −50 a₀ chain −a ${(chain.dtTarget_s! / bare.dtTarget_s!).toFixed(4)}; heuristic −a ${(heur.dtTarget_s! / bare.dtTarget_s!).toFixed(4)}`);
}

report();
