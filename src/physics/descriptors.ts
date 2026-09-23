/**
 * Spectral descriptors of an isotropic momentum spectrum.
 *
 * Everything works with physical k [μm⁻¹] and the normalized shell density
 *
 *     q(k) = N_k / N,     ∫ q(k) dk = 1,     N_k = 4π k² n_k,
 *
 * The Bose occupation on the same grid is f(k) = 2π² n q(k) / k².
 */

import { trapz, logarithmicGrid } from './grid';
import {
  P_MIN, P_MAX, N_GRID, REFERENCE_XI_UM,
} from './constants';

/**
 * Canonical input grid: every imported or drawn spectrum is resampled onto it
 * before the solver resamples it again onto its own accuracy-dependent grid.
 * It equals the Standard solver grid at the reference healing length.
 */
export const INPUT_GRID: Float64Array = (() => {
  const p = logarithmicGrid(P_MIN, P_MAX, N_GRID);
  const k = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) k[i] = p[i] / REFERENCE_XI_UM;
  return k;
})();

/**
 * Depth, in ln s below the maximum, of the peak region the estimator fits.
 * A least-squares parabola over the top 2% of the peak averages out grid-level
 * wiggles of a broad, flat peak, which move a three-point fit by up to a few
 * 1e-3 and make stop times jitter with the grid instead of converging.
 * Depth 0 selects the three-point parabola through the grid maximum.
 */
export const PEAK_DEPTH = 0.02;

/** Peak of a spectral density by a parabolic fit in (ln k, ln s) around the maximum. */
function peakOfSpectral(k: Float64Array, spectral: Float64Array, peakDepth: number): number {
  const n = k.length;
  let iMax = 0;
  let sMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (spectral[i] > sMax) { sMax = spectral[i]; iMax = i; }
  }
  if (iMax === 0 || iMax === n - 1) return k[iMax];
  if (spectral[iMax - 1] <= 0 || spectral[iMax] <= 0 || spectral[iMax + 1] <= 0) return k[iMax];

  if (peakDepth > 0) {
    // Least-squares parabola over the contiguous top of the peak.
    const floor = Math.log(sMax) - peakDepth;
    let lo = iMax - 1, hi = iMax + 1;
    while (lo > 0 && spectral[lo - 1] > 0 && Math.log(spectral[lo - 1]) >= floor) lo--;
    while (hi < n - 1 && spectral[hi + 1] > 0 && Math.log(spectral[hi + 1]) >= floor) hi++;
    const xc = Math.log(k[iMax]);
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let i = lo; i <= hi; i++) {
      const x = Math.log(k[i]) - xc, y = Math.log(spectral[i]);
      const x2 = x * x;
      S0 += 1; S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
      T0 += y; T1 += x * y; T2 += x2 * y;
    }
    // Solve [[S4 S3 S2][S3 S2 S1][S2 S1 S0]] [A B C] = [T2 T1 T0]
    const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) =>
      a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const D = det3(S4, S3, S2, S3, S2, S1, S2, S1, S0);
    const A = det3(T2, S3, S2, T1, S2, S1, T0, S1, S0) / D;
    const B = det3(S4, T2, S2, S3, T1, S1, S2, T0, S0) / D;
    if (!(A < 0)) return k[iMax];
    const xl = Math.log(k[lo]) - xc, xh = Math.log(k[hi]) - xc;
    return Math.exp(xc + Math.max(xl, Math.min(xh, -B / (2 * A))));
  }

  const x0 = Math.log(k[iMax - 1]), x1 = Math.log(k[iMax]), x2 = Math.log(k[iMax + 1]);
  const y0 = Math.log(spectral[iMax - 1]), y1 = Math.log(spectral[iMax]), y2 = Math.log(spectral[iMax + 1]);

  // Lagrange form of the interpolating parabola through the three points.
  const L0 = y0 / ((x0 - x1) * (x0 - x2));
  const L1 = y1 / ((x1 - x0) * (x1 - x2));
  const L2 = y2 / ((x2 - x0) * (x2 - x1));
  const a = L0 + L1 + L2;
  if (!(a < 0)) return k[iMax];
  const b = -(L0 * (x1 + x2) + L1 * (x0 + x2) + L2 * (x0 + x1));
  return Math.exp(Math.max(x0, Math.min(x2, -b / (2 * a))));
}

/** Peak wavevector from a shell density q(k); q is itself the spectral density. */
export function peakMomentum(k: Float64Array, q: Float64Array, depth = PEAK_DEPTH): number {
  return peakOfSpectral(k, q, depth);
}

/** Peak wavevector from an occupation f(k); the spectral density is k² f. */
export function peakMomentumFromF(k: Float64Array, f: Float64Array, depth = PEAK_DEPTH): number {
  const spec = new Float64Array(k.length);
  for (let i = 0; i < k.length; i++) spec[i] = k[i] * k[i] * f[i];
  return peakOfSpectral(k, spec, depth);
}

/** Spectral centroid ⟨k⟩ = ∫ k q(k) dk. */
export function spectralCentroid(k: Float64Array, q: Float64Array): number {
  const kq = new Float64Array(k.length);
  for (let i = 0; i < k.length; i++) kq[i] = k[i] * q[i];
  return trapz(kq, k);
}

export interface FWHMResult {
  fwhm: number;
  kLeft: number;
  kRight: number;
}

/** FWHM from linearly interpolated half-maximum crossings around the argmax. */
export function computeFWHM(k: Float64Array, q: Float64Array): FWHMResult {
  const n = k.length;
  let iMax = 0;
  let qMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (q[i] > qMax) { qMax = q[i]; iMax = i; }
  }
  const half = qMax / 2;

  let kLeft = k[0];
  for (let i = iMax - 1; i >= 0; i--) {
    if (q[i] <= half && half <= q[i + 1]) {
      const dq = q[i + 1] - q[i];
      const alpha = dq !== 0 ? (half - q[i]) / dq : 0;
      kLeft = k[i] + alpha * (k[i + 1] - k[i]);
      break;
    }
  }

  let kRight = k[n - 1];
  for (let i = iMax; i < n - 1; i++) {
    if (q[i] >= half && half >= q[i + 1]) {
      const dq = q[i + 1] - q[i];
      const alpha = dq !== 0 ? (half - q[i]) / dq : 0;
      kRight = k[i] + alpha * (k[i + 1] - k[i]);
      break;
    }
  }

  return { fwhm: kRight - kLeft, kLeft, kRight };
}

/**
 * Count distinct, prominent interior maxima, a unimodality proxy.
 *
 * A one-grid-point wiggle should not turn a visually unimodal imported curve
 * into a bimodal one. A candidate must be above 10% of the global peak and
 * have at least 1% of that peak in topographic prominence.
 */
export function countModes(
  q: Float64Array,
  relThreshold = 0.1,
  relProminence = 0.01,
): number {
  let qMax = 0;
  for (let i = 0; i < q.length; i++) qMax = Math.max(qMax, q[i]);
  const floor = relThreshold * qMax;
  const minProminence = relProminence * qMax;
  let modes = 0;
  for (let i = 1; i < q.length - 1; i++) {
    if (!(q[i] > floor && q[i] >= q[i - 1] && q[i] > q[i + 1])) continue;

    let leftSaddle = q[i];
    for (let j = i - 1; j >= 0 && q[j] <= q[i]; j--) {
      leftSaddle = Math.min(leftSaddle, q[j]);
    }
    let rightSaddle = q[i];
    for (let j = i + 1; j < q.length && q[j] <= q[i]; j++) {
      rightSaddle = Math.min(rightSaddle, q[j]);
    }
    if (q[i] - Math.max(leftSaddle, rightSaddle) >= minProminence) modes++;
  }
  return modes;
}

/**
 * Upper end of the k range worth plotting on a linear axis: the point below
 * which `frac` of the spectral weight lies, rounded out a little. The solver
 * grid runs to ~8.7 μm⁻¹ but a typical profile is dead above ~4, and on a log
 * axis that empty tail is free while on a linear one it is half the panel.
 */
export function spectralExtent(
  k: Float64Array,
  q: ArrayLike<number>,
  frac = 0.999,
): number {
  let total = 0;
  for (let i = 0; i < k.length - 1; i++) {
    total += 0.5 * (q[i] + q[i + 1]) * (k[i + 1] - k[i]);
  }
  if (!(total > 0)) return k[k.length - 1];

  const target = frac * total;
  let acc = 0;
  for (let i = 0; i < k.length - 1; i++) {
    acc += 0.5 * (q[i] + q[i + 1]) * (k[i + 1] - k[i]);
    if (acc >= target) return Math.min(k[k.length - 1], k[i + 1] * 1.15);
  }
  return k[k.length - 1];
}

export interface SpectralDescriptors {
  kp0_um_inv: number;
  mean_k_um_inv: number;
  fwhm_um_inv: number;
  kLeft_um_inv: number;
  kRight_um_inv: number;
  /** ∫ q dk of the supplied profile, before renormalization */
  normIntegral: number;
  modeCount: number;
}

/** Shape descriptors of a normalized q(k) profile. */
export function computeDescriptors(
  k_um_inv: Float64Array,
  q: Float64Array,
  peakDepth = PEAK_DEPTH,
): SpectralDescriptors {
  const { fwhm, kLeft, kRight } = computeFWHM(k_um_inv, q);
  return {
    kp0_um_inv: peakMomentum(k_um_inv, q, peakDepth),
    mean_k_um_inv: spectralCentroid(k_um_inv, q),
    fwhm_um_inv: fwhm,
    kLeft_um_inv: kLeft,
    kRight_um_inv: kRight,
    normIntegral: trapz(q, k_um_inv),
    modeCount: countModes(q),
  };
}
