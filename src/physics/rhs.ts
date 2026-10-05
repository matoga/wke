/**
 * Right-hand sides ∂τ f = C_model[f] for every kinetic model.
 *
 * All models share the reduced event table of collision.ts. The renormalised
 * models multiply each event by a loop-dressed factor M_e built from the
 * current spectrum (loops.ts); the bare model has M_e = 1.
 */

import type { CollisionGeometry, KernelType } from './collision';
import { KERNEL_IDS, collisionComponents, treePrefactor } from './collision';
import type { ChannelGeometry } from './channels';
import type { LoopOperator } from './loops';
import { makeLoopEvaluators } from './loops';
import { leggauss } from './quadrature';

export interface RhsDiagnostics {
  /** collision-weighted mean of M_e − 1 (0 for the bare model) */
  loopDressing: number;
  /**
   * Pole indicator: for resummed models the largest weight 1/|1 − cL|² at the
   * table nodes that collisions use (a diagnostic, not converged near a pole),
   * for the one-loop model the smallest bracket M_min, NaN for the bare model.
   */
  poleIndicator: number;
  /**
   * Resummed models: the share of the collision rate w|g − l| carried by
   * collisions whose averaged dressing M exceeds POLE_DRESSING_LIMIT; this
   * decides breakdown. NaN for the bare and one-loop models.
   */
  poleShare: number;
  /** non-null when the model left its domain of validity; the run stops */
  stop: string | null;
  /**
   * Distribution of the dressing M over the collisions, weighted by their
   * rate w|g − l| and normalised to 1, on the bins M_EDGES; null for bare.
   */
  mHist: number[] | null;
}

/**
 * Bins of the dressing histogram: 0.025 wide on the core range [−0.1, 2.1],
 * then 40 bins per octave out to [−16.1, 32.1]. M outside is clamped to the
 * end bins.
 */
const M_SEGMENTS: Array<[number, number, number]> = [
  [-16.1, -8.1, 40], [-8.1, -4.1, 40], [-4.1, -2.1, 40], [-2.1, -1.1, 40], [-1.1, -0.1, 40],
  [-0.1, 2.1, 88],
  [2.1, 4.1, 40], [4.1, 8.1, 40], [8.1, 16.1, 40], [16.1, 32.1, 40],
];
const M_SEG_OFFSET = M_SEGMENTS.reduce<number[]>((acc, [, , n], i) => { acc.push(i === 0 ? 0 : acc[i - 1] + M_SEGMENTS[i - 1][2]); return acc; }, []);
export const M_EDGES: number[] = (() => {
  const e: number[] = [M_SEGMENTS[0][0]];
  for (const [a, b, n] of M_SEGMENTS) for (let i = 1; i <= n; i++) e.push(a + ((b - a) * i) / n);
  return e;
})();
export const M_BINS = M_EDGES.length - 1;

/** Histogram bin of a dressing value M. */
export function mBin(M: number): number {
  if (!(M > M_SEGMENTS[0][0])) return 0;
  for (let s = 0; s < M_SEGMENTS.length; s++) {
    const [a, b, n] = M_SEGMENTS[s];
    if (M < b) return M_SEG_OFFSET[s] + Math.min(n - 1, Math.floor(((M - a) / (b - a)) * n));
  }
  return M_BINS - 1;
}

export type RhsFunction = (f: Float64Array, out: Float64Array) => RhsDiagnostics | Promise<RhsDiagnostics>;

/**
 * Partial sums of one right-hand-side evaluation. Evaluations over disjoint
 * target subsets combine by adding `out` and the sums, and taking minima.
 */
export interface RhsPartial {
  /** Σ w|g − l|(M − 1) */
  num: number;
  /** Σ w|g − l| */
  den: number;
  /** Σ w|g − l| over events with M < 0 */
  negW: number;
  /** Σ w|g − l| over events with M > POLE_DRESSING_LIMIT */
  highW: number;
  /** min M over events with weight */
  mMin: number;
  /** min |1 − cL|² at the channel-table nodes that collisions use */
  dMin: number;
  /** unnormalised rate-weighted histogram of M, or null */
  hist: Float64Array | null;
}

export type PartialRhs = (f: Float64Array, out: Float64Array) => RhsPartial;

export type RhsKind = 'bare' | 'one-loop' | 'resummed';

export function emptyPartial(): RhsPartial {
  return { num: 0, den: 0, negW: 0, highW: 0, mMin: Infinity, dMin: Infinity, hist: null };
}

export function combinePartials(a: RhsPartial, b: RhsPartial): RhsPartial {
  return {
    num: a.num + b.num,
    den: a.den + b.den,
    negW: a.negW + b.negW,
    highW: a.highW + b.highW,
    mMin: Math.min(a.mMin, b.mMin),
    dMin: Math.min(a.dMin, b.dMin),
    hist: a.hist && b.hist ? a.hist.map((v, i) => v + b.hist![i]) : (a.hist ?? b.hist),
  };
}

/**
 * Breakdown of the resummed models: a collision counts as at the pole when its averaged dressing M
 * exceeds POLE_DRESSING_LIMIT, and the model has broken down once such collisions carry more than
 * POLE_RATE_SHARE of the collision rate. Averaged dressings are what the equation integrates, so
 * unlike the largest sampled 1/|1 − cL|² this converges with the table resolution.
 */
export const POLE_DRESSING_LIMIT = 10;
export const POLE_RATE_SHARE = 0.01;
/** Stop the one-loop model when this fraction of the collision weight has M < 0. */
export const NEGATIVE_WEIGHT_LIMIT = 1e-3;

export function finalizeDiagnostics(kind: RhsKind, rung: number, part: RhsPartial): RhsDiagnostics {
  if (kind === 'bare') return { loopDressing: 0, poleIndicator: NaN, poleShare: NaN, stop: null, mHist: null };
  const loopDressing = part.den > 0 ? part.num / part.den : 0;
  let total = 0;
  if (part.hist) for (const v of part.hist) total += v;
  const mHist = part.hist && total > 0 ? Array.from(part.hist, (v) => v / total) : null;
  if (kind === 'one-loop') {
    const frac = part.den > 0 ? part.negW / part.den : 0;
    return {
      loopDressing,
      mHist,
      poleIndicator: part.mMin,
      poleShare: NaN,
      stop: frac > NEGATIVE_WEIGHT_LIMIT
        ? `The one-loop bracket turned negative on ${(100 * frac).toFixed(1)}% of the collision weight: perturbation theory has broken down.`
        : null,
    };
  }
  const share = part.den > 0 ? part.highW / part.den : 0;
  return {
    loopDressing,
    mHist,
    poleIndicator: 1 / part.dMin,
    poleShare: share,
    stop: share > POLE_RATE_SHARE
      ? `The resummed vertex reached its pole: collisions with a dressing above ${POLE_DRESSING_LIMIT} carry ${(100 * share).toFixed(1)}% of the collision rate.`
      : null,
  };
}

/** Single-thread right-hand side from a partial one. */
export function completeRhs(partial: PartialRhs, kind: RhsKind, rung: number): RhsFunction {
  return (f, out) => finalizeDiagnostics(kind, rung, partial(f, out));
}

export function makeBarePartial(geom: CollisionGeometry, kernel: KernelType, ncal: number): PartialRhs {
  const n = geom.grid.length;
  const gain = new Float64Array(n);
  const loss = new Float64Array(n);
  const kernelId = KERNEL_IDS[kernel];
  const scale = treePrefactor(ncal);
  return (f, out) => {
    collisionComponents(f, geom, kernelId, gain, loss, scale);
    for (let i = 0; i < n; i++) out[i] = gain[i] - loss[i];
    return emptyPartial();
  };
}

export function makeBareRhs(geom: CollisionGeometry, kernel: KernelType, ncal: number): RhsFunction {
  return completeRhs(makeBarePartial(geom, kernel, ncal), 'bare', 0);
}

export interface LoopRhsOptions {
  model: 'one-loop' | 'chain' | 'heuristic-a' | 'heuristic-b' | 'heuristic-c';
  geom: CollisionGeometry;
  channels: ChannelGeometry;
  loopOp: LoopOperator;
  ncal: number;
  /** sign of the scattering length */
  sign: number;
  /** Gauss nodes for the s-channel average of the one-loop model */
  sNodes: number;
  /** multiplies every loop; 1 is physical (tests only) */
  loopScale?: number;
  /**
   * Statistics of the collision factors (default classical). 'quantum' adds the Bose +1 terms,
   * f₁f₂(1 + f + f₃) − f f₃(1 + f₁ + f₂); only the exchange-chain models accept it, because
   * the +1 cancels from L₋ (its factor is f_{k+Q} − f_k), so their dressing is unchanged.
   */
  kernel?: KernelType;
}

/** Gauss-Legendre points on [0, 1] for the resummed channel averages. */
const RG = leggauss(6);
const RG_X = Float64Array.from(RG.x, (x) => 0.5 * (x + 1));
const RG_W = Float64Array.from(RG.w, (w) => 0.5 * w);
/** Sub-panels per cell where |1 − L|² may be small, so a narrow peak is resolved. */
const NEAR_POLE_PANELS = 48;
/**
 * Heuristic B: Re L₊ is fitted per event by a Chebyshev interpolant on the s-channel interval, and for each
 * transfer Q the s-channel angle ψ is sampled by the midpoint rule (spectral for a smooth function of cos ψ),
 * with more points in cells near the pole. Checked against a dense direct average of the same events
 * (24 × 64 points per event in P and φ): 2 × 10⁻⁵ in C_B/C_bare.
 */
const CHEB_N = 8;
const CHEB_X = Float64Array.from({ length: CHEB_N }, (_, k) => Math.cos(((2 * k + 1) * Math.PI) / (2 * CHEB_N)));
const CHEB_T = Float64Array.from({ length: CHEB_N * CHEB_N }, (_, i) => Math.cos(((i / CHEB_N | 0) * (2 * (i % CHEB_N) + 1) * Math.PI) / (2 * CHEB_N)));
const PSI_NODES = 6;
const NEAR_POLE_PSI_NODES = 16;
/** Heuristic B: sub-panels in Q of a cell near the pole */
const NEAR_POLE_B_PANELS = 16;
const psiCos = (n: number) => Float64Array.from({ length: n }, (_, m) => Math.cos(((m + 0.5) * Math.PI) / n));
const PSI_COS = psiCos(PSI_NODES);
const PSI_COS_NEAR = psiCos(NEAR_POLE_PSI_NODES);
/** Gauss-Legendre points on [0, 1] per cell away from the pole, where the joint integrand is smooth. */
const FAR = leggauss(3);
const FAR_X = Float64Array.from(FAR.x, (x) => 0.5 * (x + 1));
const FAR_W = Float64Array.from(FAR.w, (w) => 0.5 * w);

/**
 * ∫_{s0}^{s1} ds / [U(s)² + V(s)²] over a table cell in local units s ∈ [0, 1],
 * with U = 1 − c Re L and V = c Im L the quadratics through the cell's three
 * nodes. The loops are smooth, so interpolating them (not their inverse square)
 * keeps the integrand positive and its peaks where they belong.
 */
function resummedCellIntegral(
  u0: number, u1: number, u2: number, v0: number, v1: number, v2: number,
  s0: number, s1: number, nearPole: boolean,
): number {
  // U(s) = A + B s + C s², likewise V
  const ua = u0, ub = -3 * u0 + 4 * u1 - u2, uc = 2 * u0 - 4 * u1 + 2 * u2;
  const va = v0, vb = -3 * v0 + 4 * v1 - v2, vc = 2 * v0 - 4 * v1 + 2 * v2;
  const panels = nearPole ? NEAR_POLE_PANELS : 1;
  const len = (s1 - s0) / panels;
  let acc = 0;
  for (let p = 0; p < panels; p++) {
    const base = s0 + p * len;
    for (let j = 0; j < RG_X.length; j++) {
      const s = base + len * RG_X[j];
      const u = ua + s * (ub + s * uc), v = va + s * (vb + s * vc);
      acc += RG_W[j] / Math.max(u * u + v * v, 1e-8);
    }
  }
  return acc * len;
}

const C23 = 2 / 3;
const C43 = 4 / 3;

/**
 * Rung weight of heuristic C: the bubble chain with 1/|1 − c L₋|². Deep in the coherent regime
 * |L₋| ≫ 1, so the late rates scale as 1/c²; c² ≈ 3.4 brings the bubble chain's late
 * (m/ħ) dℓ²/dt ≈ 11.5 (Bose +1) down to the measured ≈ 3.4.
 */
export const RUNG_C = 1.85;

export function loopRung(model: string): number {
  if (model === 'heuristic-c') return RUNG_C;
  return model === 'heuristic-b' || model === 'heuristic-a' ? 4 : 1;
}

export function makeLoopRhs(o: LoopRhsOptions): RhsFunction {
  return completeRhs(makeLoopPartial(o), o.model === 'one-loop' ? 'one-loop' : 'resummed', loopRung(o.model));
}

export function makeLoopPartial(o: LoopRhsOptions): PartialRhs {
  const { geom, channels: ch, model } = o;
  const { grid, weight, i1, a1, i2, a2, i3, a3, p2: p2e, targetPairs, pairOffsets, pairP1 } = geom;
  const { pairQlo, pairH, pairOmega, pairCells, pairF, pairPhi, ta, tb, pairUsedLo, pairUsedHi } = ch;
  const n = grid.length;
  const nPairs = geom.nPairs;
  const ev = makeLoopEvaluators(o.loopOp);
  const { lPlus, lMinusRe, lMinusIm } = ev;
  const F = new Float64Array(ch.nF);
  const Phi = new Float64Array(ch.nPhi);
  // resummed models: loops at the nodes, near-pole flag per cell (stored at the cell's Φ slot)
  const U = new Float64Array(ch.nF);
  const V = new Float64Array(ch.nF);
  const near = new Uint8Array(ch.nPhi);
  const coupling = (o.loopScale ?? 1) * o.sign / o.ncal;
  const c = loopRung(model);
  const oneLoop = model === 'one-loop';
  // Heuristic B puts both channels in one denominator: Z = Re L₊ + 4 L₋, M = ⟨1/|1 − Z|²⟩ averaged
  // over the joint measure of the s and t channels; heuristics A and C are the exchange chain alone.
  // Im L₊ is left out: its interference with Im L₋ would depend on the sign of Im L₋, i.e. on the
  // causal prescription of the exchange line, which the ansatz does not fix. Without it every model
  // depends on Im L₋ only through its square.
  const sResum = model === 'heuristic-b';
  if (o.kernel === 'quantum' && model !== 'chain' && model !== 'heuristic-a' && model !== 'heuristic-c') {
    throw new Error(`the Bose +1 kernel is only defined for the exchange-chain models, not ${model}`);
  }
  const bose = o.kernel === 'quantum' ? 1 : 0;
  let dMinShift = Infinity;
  /** Chebyshev coefficients of Re L₊ on the current event's s-channel interval (heuristic B) */
  const rCoef = new Float64Array(CHEB_N);
  const rVal = new Float64Array(CHEB_N);
  let rMid = 0, rInvHalf = 0, rMin = 0, rMax = 0;
  const fitReLplus = (lo: number, hi: number, omegaPlus: number): void => {
    rMid = 0.5 * (lo + hi);
    const half = 0.5 * (hi - lo);
    rInvHalf = half > 1e-12 ? 1 / half : 0;
    rMin = Infinity; rMax = -Infinity;
    for (let k = 0; k < CHEB_N; k++) {
      const v = coupling * lPlus(Math.max(rMid + half * CHEB_X[k], 1e-12), omegaPlus);
      rVal[k] = v;
      if (v < rMin) rMin = v;
      if (v > rMax) rMax = v;
    }
    for (let j = 0; j < CHEB_N; j++) {
      let c = 0;
      for (let k = 0; k < CHEB_N; k++) c += rVal[k] * CHEB_T[j * CHEB_N + k];
      rCoef[j] = ((j === 0 ? 1 : 2) / CHEB_N) * c;
    }
  };
  const reLplusAt = (P: number): number => {
    let x = (P - rMid) * rInvHalf;
    if (x > 1) x = 1; else if (x < -1) x = -1;
    let b1 = 0, b2 = 0;
    for (let j = CHEB_N - 1; j >= 1; j--) { const t = 2 * x * b1 - b2 + rCoef[j]; b2 = b1; b1 = t; }
    return x * b1 - b2 + rCoef[0];
  };
  /**
   * Heuristic B for one event: the joint average of 1/[(U − Re L₊)² + V²] over its configurations. The
   * transfer Q is uniform on [ea, eb] and is integrated cell by cell as in the other resummed models. For
   * fixed Q the pairs (p, p₁) and (p₂, p₃) turn independently about Q, so the angle ψ between their
   * planes is uniform on [0, π] and P² = C + D cos ψ. Re L₊ is smooth in P and read off the event's
   * Chebyshev fit.
   */
  const jointAverage = (off: number, cells: number, qlo: number, h: number, ea: number, eb: number,
    p: number, p1: number, q2: number, p3: number): number => {
    const pSq = p * p, p1Sq = p1 * p1, q2Sq = q2 * q2, p3Sq = p3 * p3;
    // P² = p² + p₃² + 2 p·p₃, with p·p₃ = cPar (dPar − Q) + cPerp dPerp cos ψ
    const inner = (Q: number, u: number, v: number, cosPsi: Float64Array): number => {
      const inv2Q = 0.5 / Q, QSq = Q * Q;
      const cPar = (pSq + QSq - p1Sq) * inv2Q, dPar = (q2Sq + QSq - p3Sq) * inv2Q;
      const C = pSq + p3Sq + 2 * cPar * (dPar - Q);
      const D = 2 * Math.sqrt(Math.max(pSq - cPar * cPar, 0) * Math.max(q2Sq - dPar * dPar, 0));
      let acc = 0;
      for (let m = 0; m < cosPsi.length; m++) {
        const du = u - reLplusAt(Math.sqrt(Math.max(C + D * cosPsi[m], 0)));
        acc += 1 / Math.max(du * du + v * v, 1e-8);
      }
      return acc / cosPsi.length;
    };
    let ka = ea | 0; if (ka >= cells) ka = cells - 1;
    let kb = eb | 0; if (kb >= cells) kb = cells - 1;
    const uAt = (b: number, x: number) => U[b] * (2 * x - 1) * (x - 1) + U[b + 1] * 4 * x * (1 - x) + U[b + 2] * x * (2 * x - 1);
    const vAt = (b: number, x: number) => V[b] * (2 * x - 1) * (x - 1) + V[b + 1] * 4 * x * (1 - x) + V[b + 2] * x * (2 * x - 1);
    if (eb - ea < 1e-6) {
      const b = off + 2 * ka, x = ea - ka, u = uAt(b, x), v = vAt(b, x);
      const du = u < rMin ? rMin - u : u > rMax ? u - rMax : 0;
      if (du * du + v * v < dMinShift) dMinShift = du * du + v * v;
      return inner(Math.max(qlo + ea * h, 1e-12), u, v, PSI_COS_NEAR);
    }
    let integral = 0;
    for (let j = ka; j <= kb; j++) {
      const b = off + 2 * j;
      // near the pole when some node comes within 0.5 of it for some Re L₊ of the event, or when
      // 1 − Re Z can vanish inside the cell while Im Z is small at a node
      let dm = Infinity, uLo = Infinity, uHi = -Infinity, vMin = Infinity;
      for (let t = 0; t < 3; t++) {
        const u = U[b + t], v = V[b + t];
        const du = u < rMin ? rMin - u : u > rMax ? u - rMax : 0;
        dm = Math.min(dm, du * du + v * v);
        uLo = Math.min(uLo, u); uHi = Math.max(uHi, u); vMin = Math.min(vMin, v * v);
      }
      // the pole indicator, as for the other models: node values, here for the least favourable Re L₊
      if (dm < dMinShift) dMinShift = dm;
      const flag = dm < 0.25 || (vMin < 0.25 && uLo <= rMax && uHi >= rMin);
      const s0 = j === ka ? ea - ka : 0, s1 = j === kb ? eb - kb : 1;
      const panels = flag ? NEAR_POLE_B_PANELS : 1;
      const cosPsi = flag ? PSI_COS_NEAR : PSI_COS;
      const gX = flag ? RG_X : FAR_X, gW = flag ? RG_W : FAR_W;
      const len = (s1 - s0) / panels;
      let acc = 0;
      for (let q = 0; q < panels; q++) {
        const base = s0 + q * len;
        for (let g = 0; g < gX.length; g++) {
          const x = base + len * gX[g];
          acc += gW[g] * inner(Math.max(qlo + (j + x) * h, 1e-12), uAt(b, x), vAt(b, x), cosPsi);
        }
      }
      integral += acc * len;
    }
    return integral / (eb - ea);
  };
  const scale = treePrefactor(o.ncal);
  const gauss = leggauss(o.sNodes);
  const gx = gauss.x, gw = gauss.w, nG = gx.length;

  /** Uniform average of 1/|1 − L|² over [ea, eb] (cell units) of one pair table. */
  const resummedAverage = (off: number, po: number, cells: number, ea: number, eb: number): number => {
    let ka = ea | 0; if (ka >= cells) ka = cells - 1;
    let kb = eb | 0; if (kb >= cells) kb = cells - 1;
    const ra = ea - ka, rb = eb - kb;
    if (eb - ea < 1e-6) {
      const b = off + 2 * ka, s = ra;
      const l0 = (2 * s - 1) * (s - 1), l1 = 4 * s * (1 - s), l2 = s * (2 * s - 1);
      const u = U[b] * l0 + U[b + 1] * l1 + U[b + 2] * l2, v = V[b] * l0 + V[b + 1] * l1 + V[b + 2] * l2;
      return 1 / Math.max(u * u + v * v, 1e-8);
    }
    const ba = off + 2 * ka, bb = off + 2 * kb;
    let integral: number;
    if (ka === kb) {
      integral = resummedCellIntegral(U[ba], U[ba + 1], U[ba + 2], V[ba], V[ba + 1], V[ba + 2], ra, rb, near[po + ka] === 1);
    } else {
      integral = resummedCellIntegral(U[ba], U[ba + 1], U[ba + 2], V[ba], V[ba + 1], V[ba + 2], ra, 1, near[po + ka] === 1)
        + (Phi[po + kb] - Phi[po + ka + 1])
        + resummedCellIntegral(U[bb], U[bb + 1], U[bb + 2], V[bb], V[bb + 1], V[bb + 2], 0, rb, near[po + kb] === 1);
    }
    return integral / (eb - ea);
  };

  return (f, out) => {
    ev.update(f);
    dMinShift = Infinity;

    // t-channel tables
    let dMin = Infinity;
    for (let k = 0; k < nPairs; k++) {
      const off = pairF[k];
      const cells = pairCells[k];
      const h = pairH[k];
      const qlo = pairQlo[k];
      const w = pairOmega[k];
      const m = 2 * cells;
      for (let s = 0; s <= m; s++) {
        let Q = qlo + 0.5 * h * s;
        if (Q < 1e-12) Q = 1e-12;
        if (oneLoop) {
          F[off + s] = 4 * coupling * lMinusRe(Q, w);
        } else {
          const re = 0.5 * c * coupling * lMinusRe(Q, w);
          const im = -0.5 * Math.PI * c * coupling * lMinusIm(Q, w);
          const d = (1 - re) * (1 - re) + im * im;
          if (!sResum && d < dMin && s >= pairUsedLo[k] && s <= pairUsedHi[k]) dMin = d;
          U[off + s] = 1 - re;
          V[off + s] = im;
        }
      }
      const po = pairPhi[k];
      Phi[po] = 0;
      if (oneLoop) {
        for (let j = 0; j < cells; j++) {
          const b = off + 2 * j;
          Phi[po + j + 1] = Phi[po + j] + (h * (F[b] + 4 * F[b + 1] + F[b + 2])) / 6;
        }
      } else {
        // Φ in cell units: ∫ ds / |1 − L|² from the table start, exact at cell ends.
        for (let j = 0; j < cells; j++) {
          const b = off + 2 * j;
          const d0 = U[b] * U[b] + V[b] * V[b], d1 = U[b + 1] * U[b + 1] + V[b + 1] * V[b + 1], d2 = U[b + 2] * U[b + 2] + V[b + 2] * V[b + 2];
          // Near a pole |1 − L|² is small at a node, or 1 − Re L changes sign inside the cell.
          const flag = Math.min(d0, d1, d2) < 0.25 || U[b] * U[b + 1] <= 0 || U[b + 1] * U[b + 2] <= 0;
          near[po + j] = flag ? 1 : 0;
          Phi[po + j + 1] = Phi[po + j] + resummedCellIntegral(U[b], U[b + 1], U[b + 2], V[b], V[b + 1], V[b + 2], 0, 1, flag);
        }
      }
    }

    // event sweep
    let num = 0, den = 0, negW = 0, highW = 0, mMin = Infinity;
    const hist = new Float64Array(M_BINS);
    for (let i = 0; i < n; i++) {
      const p = grid[i];
      const pSq = p * p;
      const fp = f[i];
      let sg = 0, sl = 0;
      for (let k = targetPairs[i]; k < targetPairs[i + 1]; k++) {
        const p1 = pairP1[k];
        const off = pairF[k], po = pairPhi[k], cells = pairCells[k], h = pairH[k];
        for (let e = pairOffsets[k]; e < pairOffsets[k + 1]; e++) {
          const j1 = i1[e], j2 = i2[e], j3 = i3[e];
          const u1 = a1[e], u2 = a2[e], u3 = a3[e];
          const f1 = (1 - u1) * f[j1] + u1 * f[j1 + 1];
          const f2 = (1 - u2) * f[j2] + u2 * f[j2 + 1];
          const f3 = (1 - u3) * f[j3] + u3 * f[j3 + 1];
          const g = f1 * f2 * (bose + fp + f3);
          const l = fp * f3 * (bose + f1 + f2);

          // uniform t-channel average of F over [ta, tb] (cells), from the pair table
          const ea = ta[e], eb = tb[e];
          let M: number;
          if (sResum) {
            M = 0; // joint s-t average below
          } else if (!oneLoop) {
            M = resummedAverage(off, po, cells, ea, eb);
          } else if (eb - ea < 1e-6) {
            const t = 0.5 * (ea + eb);
            let kk = t | 0;
            if (kk >= cells) kk = cells - 1;
            const r = t - kk, b = off + 2 * kk;
            M = F[b] * (2 * r - 1) * (r - 1) + F[b + 1] * 4 * r * (1 - r) + F[b + 2] * r * (2 * r - 1);
          } else {
            let ka = ea | 0;
            if (ka >= cells) ka = cells - 1;
            let r = ea - ka, r2 = r * r, r3 = r2 * r, b = off + 2 * ka;
            const phiA = Phi[po + ka] + h * (F[b] * (C23 * r3 - 1.5 * r2 + r) + F[b + 1] * (2 * r2 - C43 * r3) + F[b + 2] * (C23 * r3 - 0.5 * r2));
            let kb = eb | 0;
            if (kb >= cells) kb = cells - 1;
            r = eb - kb; r2 = r * r; r3 = r2 * r; b = off + 2 * kb;
            const phiB = Phi[po + kb] + h * (F[b] * (C23 * r3 - 1.5 * r2 + r) + F[b + 1] * (2 * r2 - C43 * r3) + F[b + 2] * (C23 * r3 - 0.5 * r2));
            M = (phiB - phiA) / ((eb - ea) * h);
          }
          if (oneLoop) {
            const q2 = p2e[e];
            const p3 = Math.sqrt(Math.max(p1 * p1 + q2 * q2 - pSq, 0));
            const lo = Math.max(Math.abs(p - p3), Math.abs(p1 - q2));
            const hi = Math.min(p + p3, p1 + q2);
            const omegaPlus = pSq + p3 * p3;
            const mid = 0.5 * (lo + hi), half = 0.5 * (hi - lo);
            let sum = 0;
            for (let j = 0; j < nG; j++) sum += gw[j] * lPlus(mid + half * gx[j], omegaPlus);
            M += 1 + coupling * sum;
          } else if (sResum) {
            const q2 = p2e[e];
            const p3 = Math.sqrt(Math.max(p1 * p1 + q2 * q2 - pSq, 0));
            const lo = Math.max(Math.abs(p - p3), Math.abs(p1 - q2));
            const hi = Math.min(p + p3, p1 + q2);
            fitReLplus(lo, hi, pSq + p3 * p3);
            M = jointAverage(off, cells, pairQlo[k], h, ea, eb, p, p1, q2, p3);
          }

          const w = weight[e];
          sg += w * M * g;
          sl += w * M * l;
          const aw = w * Math.abs(g - l);
          num += aw * (M - 1);
          den += aw;
          if (M < 0) negW += aw;
          if (M > POLE_DRESSING_LIMIT) highW += aw;
          if (aw > 0 && M < mMin) mMin = M;
          hist[mBin(M)] += aw;
        }
      }
      out[i] = scale * (sg - sl);
    }

    if (dMinShift < dMin) dMin = dMinShift;
    return { num, den, negW, highW, mMin, dMin, hist };
  };
}
