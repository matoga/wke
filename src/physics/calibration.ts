/**
 * Operational transport calibration.
 *
 *   A_ref   = κ k_p,0²                                  [s·μm⁻⁴]
 *   δ_k     = (⟨k⟩ − k_p,0) / k_p,0
 *   w       = FWHM / k_p,0
 *   C_shape = c₀ + c₁ δ_k + c₂ w
 *   na      = √( κ k_p,0² C_shape / Δt₁ᐟ₂ )              [μm⁻²]
 *   Δt₁ᐟ₂   = κ k_p,0² C_shape / (na)²                   [s]
 *
 * κ carries units of s·μm⁻², so A_ref is in s·μm⁻⁴ and na in μm⁻².
 */

import {
  KAPPA_S_UM2, C0, C1, C2,
  KP_MIN_UM, KP_MAX_UM, DELTA_K_MAX, W_MIN, W_MAX,
  BOHR_RADIUS_UM,
} from './constants';
import type { SpectralDescriptors } from './descriptors';

export const CALIBRATION = {
  kappa_s_um2: KAPPA_S_UM2,
  c0: C0,
  c1: C1,
  c2: C2,
  kp_min: KP_MIN_UM,
  kp_max: KP_MAX_UM,
  delta_k_max: DELTA_K_MAX,
  w_min: W_MIN,
  w_max: W_MAX,
} as const;

/** C_shape from the two shape descriptors. */
export function shapeFactor(delta_k: number, w: number): number {
  return C0 + C1 * delta_k + C2 * w;
}

/** A_ref = κ k_p² [s·μm⁻⁴]. */
export function referencePrefactor(kp_um_inv: number): number {
  return KAPPA_S_UM2 * kp_um_inv * kp_um_inv;
}

/** Δt₁ᐟ₂ = κ k_p² C_shape / (na)² [s]. */
export function predictDeltaT(desc: SpectralDescriptors, na_um2: number): number {
  return (desc.A_ref_s_um4 * desc.c_shape) / (na_um2 * na_um2);
}

/** na = √(κ k_p² C_shape / Δt₁ᐟ₂) [μm⁻²]. */
export function inferNA(desc: SpectralDescriptors, dt_half_s: number): number {
  return Math.sqrt((desc.A_ref_s_um4 * desc.c_shape) / dt_half_s);
}

/**
 * na contour used by the 2D calibration map, for C_shape = 1:
 *   na(k_p, Δt) = √(κ k_p² / Δt) = k_p √(κ / Δt)
 * The shape-corrected value is this times √C_shape.
 */
export function naContour(kp_um_inv: number, dt_half_s: number): number {
  return kp_um_inv * Math.sqrt(KAPPA_S_UM2 / dt_half_s);
}

/** a [μm] from na and n. */
export function aFromNa_um(na_um2: number, density_um3: number): number {
  return na_um2 / density_um3;
}

/** a [a₀] from na and n. */
export function aFromNa_a0(na_um2: number, density_um3: number): number {
  return na_um2 / density_um3 / BOHR_RADIUS_UM;
}

/** n [μm⁻³] from na and a [a₀]. */
export function densityFromNa(na_um2: number, a_a0: number): number {
  return na_um2 / (a_a0 * BOHR_RADIUS_UM);
}

export type DomainStatus = 'inside' | 'extrapolated';

export interface DomainCheck {
  status: DomainStatus;
  warnings: string[];
}

/**
 * Certified classical calibration domain:
 *   1.15 ≤ k_p,0 ≤ 3.00 μm⁻¹,  |δ_k| ≤ 0.08,  0.18 ≤ w ≤ 0.65, unimodal.
 */
export function checkDomain(kp: number, delta_k: number, w: number): DomainCheck {
  const warnings: string[] = [];
  if (kp < KP_MIN_UM) {
    warnings.push(`k_p,0 = ${kp.toFixed(3)} μm⁻¹ is below the certified lower bound ${KP_MIN_UM}`);
  }
  if (kp > KP_MAX_UM) {
    warnings.push(`k_p,0 = ${kp.toFixed(3)} μm⁻¹ is above the certified upper bound ${KP_MAX_UM}`);
  }
  if (Math.abs(delta_k) > DELTA_K_MAX) {
    warnings.push(`|δ_k| = ${Math.abs(delta_k).toFixed(4)} exceeds ${DELTA_K_MAX}`);
  }
  if (w < W_MIN) {
    warnings.push(`w = ${w.toFixed(3)} is below the certified lower bound ${W_MIN}`);
  }
  if (w > W_MAX) {
    warnings.push(`w = ${w.toFixed(3)} is above the certified upper bound ${W_MAX}`);
  }
  return { status: warnings.length === 0 ? 'inside' : 'extrapolated', warnings };
}
