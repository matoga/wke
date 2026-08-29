/**
 * Spectral descriptors of an isotropic momentum spectrum.
 *
 * Everything works with physical k [μm⁻¹] and the normalized shell density
 *
 *     q(k) = N_k / N,     ∫ q(k) dk = 1,     N_k = 4π k² n_k,
 *
 * which is the same quantity the Python reference implementation calls `q_arr`.
 * The Bose occupation on the same grid is f(k) = 2π² n q(k) / k².
 */

import { trapz, logarithmicGrid } from './grid';
import {
  P_MIN, P_MAX, N_GRID, REFERENCE_XI_UM,
} from './constants';
import { shapeFactor, referencePrefactor, checkDomain } from './calibration';
import type { DomainStatus } from './calibration';

/**
 * Canonical descriptor grid: the solver grid at the reference conditions,
 * expressed in physical k. Resampling every input onto this grid makes browser
 * descriptors reproduce the Python fixture values bit-for-bit.
 */
export const DESCRIPTOR_GRID: Float64Array = (() => {
  const p = logarithmicGrid(P_MIN, P_MAX, N_GRID);
  const k = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) k[i] = p[i] / REFERENCE_XI_UM;
  return k;
})();

/**
 * Peak of a spectral density by a three-point parabolic fit in (ln k, ln s).
 * Port of `wke.observables.peak_momentum`, which fits `spectral = k² f`.
 */
function peakOfSpectral(k: Float64Array, spectral: Float64Array): number {
  const n = k.length;
  let iMax = 0;
  let sMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (spectral[i] > sMax) { sMax = spectral[i]; iMax = i; }
  }
  if (iMax === 0 || iMax === n - 1) return k[iMax];
  if (spectral[iMax - 1] <= 0 || spectral[iMax] <= 0 || spectral[iMax + 1] <= 0) return k[iMax];

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

/** Peak wavevector from a shell density q(k) — q is itself the spectral density. */
export function peakMomentum(k: Float64Array, q: Float64Array): number {
  return peakOfSpectral(k, q);
}

/** Peak wavevector from an occupation f(k); the spectral density is k² f. */
export function peakMomentumFromF(k: Float64Array, f: Float64Array): number {
  const spec = new Float64Array(k.length);
  for (let i = 0; i < k.length; i++) spec[i] = k[i] * k[i] * f[i];
  return peakOfSpectral(k, spec);
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
 * Count distinct, prominent interior maxima — a unimodality proxy.
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
  /** δ_k = (⟨k⟩ − k_p,0) / k_p,0 */
  delta_k: number;
  /** w = FWHM / k_p,0 */
  w: number;
  c_shape: number;
  /** A_ref = κ k_p,0² [s·μm⁻⁴] */
  A_ref_s_um4: number;
  /** A_pred = A_ref · C_shape [s·μm⁻⁴] */
  A_pred_s_um4: number;
  /** ∫ q dk of the supplied profile, before renormalization */
  normIntegral: number;
  modeCount: number;
  domainStatus: DomainStatus;
  domainWarnings: string[];
}

/** All descriptors of a normalized q(k) profile. */
export function computeDescriptors(
  k_um_inv: Float64Array,
  q: Float64Array,
): SpectralDescriptors {
  const normIntegral = trapz(q, k_um_inv);
  const kp = peakMomentum(k_um_inv, q);
  const mean_k = spectralCentroid(k_um_inv, q);
  const { fwhm, kLeft, kRight } = computeFWHM(k_um_inv, q);
  const delta_k = (mean_k - kp) / kp;
  const w = fwhm / kp;
  const c_shape = shapeFactor(delta_k, w);
  const A_ref = referencePrefactor(kp);
  const modeCount = countModes(q);

  const { status, warnings } = checkDomain(kp, delta_k, w);
  if (modeCount > 1) {
    warnings.push(`${modeCount} prominent local maxima above 10% of the peak; profile is not unimodal`);
  }

  return {
    kp0_um_inv: kp,
    mean_k_um_inv: mean_k,
    fwhm_um_inv: fwhm,
    kLeft_um_inv: kLeft,
    kRight_um_inv: kRight,
    delta_k,
    w,
    c_shape,
    A_ref_s_um4: A_ref,
    A_pred_s_um4: A_ref * c_shape,
    normIntegral,
    modeCount,
    domainStatus: warnings.length === 0 ? status : 'extrapolated',
    domainWarnings: warnings,
  };
}
