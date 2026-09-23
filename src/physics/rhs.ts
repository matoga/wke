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
   * Pole indicator: for resummed models the largest dressing weight
   * 1/min|1 − cL|², for the one-loop model the smallest bracket M_min,
   * NaN for the bare model.
   */
  poleIndicator: number;
  /** non-null when the model left its domain of validity; the run stops */
  stop: string | null;
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
  /** min M over events with weight */
  mMin: number;
  /** min |1 − cL|² over the channel tables */
  dMin: number;
}

export type PartialRhs = (f: Float64Array, out: Float64Array) => RhsPartial;

export type RhsKind = 'bare' | 'one-loop' | 'resummed';

export function emptyPartial(): RhsPartial {
  return { num: 0, den: 0, negW: 0, mMin: Infinity, dMin: Infinity };
}

export function combinePartials(a: RhsPartial, b: RhsPartial): RhsPartial {
  return {
    num: a.num + b.num,
    den: a.den + b.den,
    negW: a.negW + b.negW,
    mMin: Math.min(a.mMin, b.mMin),
    dMin: Math.min(a.dMin, b.dMin),
  };
}

/** Pole alarm for the resummed models: stop when 1/|1 − cL|² exceeds this. */
export const POLE_WEIGHT_LIMIT = 10;
/** Stop the one-loop model when this fraction of the collision weight has M < 0. */
export const NEGATIVE_WEIGHT_LIMIT = 1e-3;

export function finalizeDiagnostics(kind: RhsKind, rung: number, part: RhsPartial): RhsDiagnostics {
  if (kind === 'bare') return { loopDressing: 0, poleIndicator: NaN, stop: null };
  const loopDressing = part.den > 0 ? part.num / part.den : 0;
  if (kind === 'one-loop') {
    const frac = part.den > 0 ? part.negW / part.den : 0;
    return {
      loopDressing,
      poleIndicator: part.mMin,
      stop: frac > NEGATIVE_WEIGHT_LIMIT
        ? `The one-loop bracket turned negative on ${(100 * frac).toFixed(1)}% of the collision weight: perturbation theory has broken down.`
        : null,
    };
  }
  const w = 1 / part.dMin;
  return {
    loopDressing,
    poleIndicator: w,
    stop: w >= POLE_WEIGHT_LIMIT
      ? `The resummed vertex approached its pole: 1/|1 − ${rung === 1 ? '' : rung}L₋|² reached ${w.toFixed(1)}.`
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
  model: 'one-loop' | 'chain' | 'heuristic';
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
}

const C23 = 2 / 3;
const C43 = 4 / 3;

export function loopRung(model: LoopRhsOptions['model']): number {
  return model === 'heuristic' ? 4 : 1;
}

export function makeLoopRhs(o: LoopRhsOptions): RhsFunction {
  return completeRhs(makeLoopPartial(o), o.model === 'one-loop' ? 'one-loop' : 'resummed', loopRung(o.model));
}

export function makeLoopPartial(o: LoopRhsOptions): PartialRhs {
  const { geom, channels: ch, model } = o;
  const { grid, weight, i1, a1, i2, a2, i3, a3, p2: p2e, targetPairs, pairOffsets, pairP1 } = geom;
  const { pairQlo, pairH, pairOmega, pairCells, pairF, pairPhi, ta, tb } = ch;
  const n = grid.length;
  const nPairs = geom.nPairs;
  const ev = makeLoopEvaluators(o.loopOp);
  const { lPlus, lMinusRe, lMinusIm } = ev;
  const F = new Float64Array(ch.nF);
  const Phi = new Float64Array(ch.nPhi);
  const coupling = (o.loopScale ?? 1) * o.sign / o.ncal;
  const c = loopRung(model);
  const oneLoop = model === 'one-loop';
  const scale = treePrefactor(o.ncal);
  const gauss = leggauss(o.sNodes);
  const gx = gauss.x, gw = gauss.w, nG = gx.length;

  return (f, out) => {
    ev.update(f);

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
          if (d < dMin) dMin = d;
          F[off + s] = 1 / d;
        }
      }
      const po = pairPhi[k];
      Phi[po] = 0;
      for (let j = 0; j < cells; j++) {
        const b = off + 2 * j;
        Phi[po + j + 1] = Phi[po + j] + (h * (F[b] + 4 * F[b + 1] + F[b + 2])) / 6;
      }
    }

    // event sweep
    let num = 0, den = 0, negW = 0, mMin = Infinity;
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
          const g = f1 * f2 * (fp + f3);
          const l = fp * f3 * (f1 + f2);

          // uniform t-channel average of F over [ta, tb] (cells), from the pair table
          const ea = ta[e], eb = tb[e];
          let M: number;
          if (eb - ea < 1e-6) {
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
            for (let j = 0; j < nG; j++) {
              sum += gw[j] * lPlus(mid + half * gx[j], omegaPlus);
            }
            M += 1 + coupling * sum;
          }

          const w = weight[e];
          sg += w * M * g;
          sl += w * M * l;
          const aw = w * Math.abs(g - l);
          num += aw * (M - 1);
          den += aw;
          if (M < 0) negW += aw;
          if (aw > 0 && M < mMin) mMin = M;
        }
      }
      out[i] = scale * (sg - sl);
    }

    return { num, den, negW, mMin, dMin };
  };
}
