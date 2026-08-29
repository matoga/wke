/**
 * Physical scales derived from n, a (species-dependent).
 * All lengths in μm, times in s.
 *
 *   g   = 4π ℏ² a / m        [μm³/s² · μm⁻³] → J·μm³ → keep SI internally
 *   ξ   = ℏ / sqrt(2 m g n)  healing length [μm]
 *   t₀  = ℏ / (g n)          time unit [s]
 *   Ncal = 4π² n ξ³           dimensionless normalization constant
 */

import { HBAR_JS, BOHR_RADIUS_UM, UM_TO_M } from './constants';
import type { AtomicSpecies } from './constants';

export interface PhysicalScales {
  // inputs
  density_um3: number;   // n [μm⁻³]
  a_um: number;          // a [μm]
  massKg: number;
  // derived
  na_um2: number;        // n·a [μm⁻²]
  g_SI: number;          // coupling constant [J·m³]
  g_um: number;          // coupling constant [μm³/s²·...] – not directly needed
  xi_um: number;         // healing length [μm]
  t0_s: number;          // time unit [s]
  ncal: number;          // normalization constant (dimensionless)
  k_xi: number;          // characteristic k = 1/ξ [μm⁻¹]
}

/**
 * Compute all derived physical scales.
 * @param density_um3   atomic number density n [μm⁻³]
 * @param a_a0          scattering length [Bohr radii]
 * @param species       atomic species (provides mass)
 */
export function computeScales(
  density_um3: number,
  a_a0: number,
  species: AtomicSpecies,
): PhysicalScales {
  const a_um = a_a0 * BOHR_RADIUS_UM;
  const a_m = a_um * UM_TO_M;
  const n_m3 = density_um3 * 1e18; // μm⁻³ → m⁻³

  const g_SI = (4 * Math.PI * HBAR_JS ** 2 * a_m) / species.massKg; // J·m³

  // healing length: ξ = ℏ / sqrt(2 m g n)
  const xi_m = HBAR_JS / Math.sqrt(2 * species.massKg * g_SI * n_m3);
  const xi_um = xi_m / UM_TO_M;

  // time unit: t₀ = ℏ / (g n)
  const t0_s = HBAR_JS / (g_SI * n_m3);

  // dimensionless normalization constant
  const ncal = 4 * Math.PI ** 2 * density_um3 * xi_um ** 3;

  return {
    density_um3,
    a_um,
    massKg: species.massKg,
    na_um2: density_um3 * a_um,
    g_SI,
    g_um: g_SI / (UM_TO_M ** 3),
    xi_um,
    t0_s,
    ncal,
    k_xi: 1 / xi_um,
  };
}

/**
 * Convert na [μm⁻²] to a [μm] given density [μm⁻³].
 */
export function naToA_um(na_um2: number, density_um3: number): number {
  return na_um2 / density_um3;
}

/**
 * Convert na [μm⁻²] to a [a₀] given density [μm⁻³].
 */
export function naToA_a0(na_um2: number, density_um3: number): number {
  return naToA_um(na_um2, density_um3) / BOHR_RADIUS_UM;
}

/**
 * Convert a [a₀] to a [μm].
 */
export function a0_to_um(a_a0: number): number {
  return a_a0 * BOHR_RADIUS_UM;
}
