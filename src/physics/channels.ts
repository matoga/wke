/**
 * Channel kinematics for loop-dressed collisions.
 *
 * For fixed magnitudes the angular measure of a resonant quadruple is uniform
 * in the transfer momentum Q_t = |p − p1| (vector difference), on an interval
 * of length 2·min(p, p1, p2, p3). Every event of a pair (target p, partner p1)
 * shares the energy transfer |p² − p1²|, so the t-channel dressing of all of
 * its events is read off one cumulative table Φ(Q) = ∫ F dQ over
 * [|p − p1|, p + p1]; an event's channel average is a difference of Φ.
 *
 * For the one-loop model F is linear in the loop and is taken as the quadratic
 * through each cell's ends and midpoint. The resummed models interpolate the
 * loops instead and integrate 1/|1 − L|² by Gauss-Legendre (see rhs.ts).
 */

import type { CollisionGeometry } from './collision';

/** Fewest table cells per (p, p1) pair, whatever its interval length. */
export const MIN_CELLS = 16;

export interface ChannelGeometry {
  pairQlo: Float64Array;
  pairH: Float64Array;
  pairOmega: Float64Array;
  pairCells: Int32Array;
  /** offset of the pair's 2·cells + 1 samples of F */
  pairF: Int32Array;
  /** offset of the pair's cells + 1 values of Φ */
  pairPhi: Int32Array;
  nF: number;
  nPhi: number;
  /** event interval ends, in cell units from the pair's Q_lo */
  ta: Float64Array;
  tb: Float64Array;
  buildTime_ms: number;
}

export function buildChannelGeometry(
  geom: CollisionGeometry,
  cellWidth: number,
  maxCells: number,
): ChannelGeometry {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { nPairs, pairTarget, pairP1, pairOffsets, grid, p2 } = geom;
  const pairQlo = new Float64Array(nPairs);
  const pairH = new Float64Array(nPairs);
  const pairOmega = new Float64Array(nPairs);
  const pairCells = new Int32Array(nPairs);
  const pairF = new Int32Array(nPairs);
  const pairPhi = new Int32Array(nPairs);
  const ta = new Float64Array(geom.nEvents);
  const tb = new Float64Array(geom.nEvents);

  let nF = 0;
  let nPhi = 0;
  for (let k = 0; k < nPairs; k++) {
    const p = grid[pairTarget[k]];
    const p1 = pairP1[k];
    const qlo = Math.abs(p - p1);
    const qhi = p + p1;
    // At least MIN_CELLS per pair: short intervals (small p, p1) carry the sharpest loop structure.
    const cells = Math.min(maxCells, Math.max(MIN_CELLS, Math.ceil((qhi - qlo) / cellWidth)));
    const h = (qhi - qlo) / cells;
    pairQlo[k] = qlo;
    pairH[k] = h;
    pairOmega[k] = Math.abs(p * p - p1 * p1);
    pairCells[k] = cells;
    pairF[k] = nF;
    pairPhi[k] = nPhi;
    nF += 2 * cells + 1;
    nPhi += cells + 1;

    const invH = 1 / h;
    const pSq = p * p;
    for (let e = pairOffsets[k]; e < pairOffsets[k + 1]; e++) {
      const q2 = p2[e];
      const p3 = Math.sqrt(p1 * p1 + q2 * q2 - pSq);
      const a = Math.max(qlo, Math.abs(q2 - p3));
      const b = Math.min(qhi, q2 + p3);
      ta[e] = Math.min(cells, Math.max(0, (a - qlo) * invH));
      tb[e] = Math.min(cells, Math.max(ta[e], (b - qlo) * invH));
    }
  }

  return {
    pairQlo, pairH, pairOmega, pairCells, pairF, pairPhi, nF, nPhi, ta, tb,
    buildTime_ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/** Φ at position t (cells) of a pair table. */
export function phiAt(F: Float64Array, Phi: Float64Array, fOff: number, phiOff: number, cells: number, h: number, t: number): number {
  let k = t | 0;
  if (k >= cells) k = cells - 1;
  const s = t - k;
  const s2 = s * s, s3 = s2 * s;
  const b = fOff + 2 * k;
  return Phi[phiOff + k] + h * (
    F[b] * ((2 / 3) * s3 - 1.5 * s2 + s)
    + F[b + 1] * (2 * s2 - (4 / 3) * s3)
    + F[b + 2] * ((2 / 3) * s3 - 0.5 * s2)
  );
}

/** F at position t (cells), from the cell's quadratic. */
export function fAt(F: Float64Array, fOff: number, cells: number, t: number): number {
  let k = t | 0;
  if (k >= cells) k = cells - 1;
  const s = t - k;
  const b = fOff + 2 * k;
  return F[b] * (2 * s - 1) * (s - 1) + F[b + 1] * 4 * s * (1 - s) + F[b + 2] * s * (2 * s - 1);
}

/** Uniform average of F over [ta, tb] (cells). */
export function channelAverage(
  F: Float64Array, Phi: Float64Array, fOff: number, phiOff: number, cells: number, h: number,
  ta: number, tb: number,
): number {
  const d = tb - ta;
  if (d < 1e-6) return fAt(F, fOff, cells, 0.5 * (ta + tb));
  return (phiAt(F, Phi, fOff, phiOff, cells, h, tb) - phiAt(F, Phi, fOff, phiOff, cells, h, ta)) / (d * h);
}
