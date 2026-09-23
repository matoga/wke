/**
 * Physical scales derived from n and a for one species.
 * Lengths in μm, times in s. Every scale uses |a|; the sign of a is carried
 * separately because only the loop corrections depend on it.
 *
 *   g    = 4π ℏ² a / m
 *   ξ    = ℏ / sqrt(2 m |g| n) = 1 / sqrt(8π n |a|)
 *   t₀   = ℏ / (|g| n)
 *   Ncal = 4π² n ξ³
 */

import { HBAR_JS, BOHR_RADIUS_UM, UM_TO_M } from './constants';
import type { AtomicSpecies } from './constants';

export interface PhysicalScales {
  density_um3: number;
  /** signed scattering length (μm) */
  a_um: number;
  massKg: number;
  /** sign of a: +1 repulsive, −1 attractive */
  sign: 1 | -1;
  /** signed n·a (μm⁻²) */
  na_um2: number;
  /** signed coupling (J·m³) */
  g_SI: number;
  xi_um: number;
  t0_s: number;
  ncal: number;
  /** 1/ξ (μm⁻¹) */
  k_xi: number;
}

export function computeScales(
  density_um3: number,
  a_a0: number,
  species: AtomicSpecies,
): PhysicalScales {
  if (!(a_a0 !== 0 && Number.isFinite(a_a0))) throw new Error('scattering length must be non-zero');
  const a_um = a_a0 * BOHR_RADIUS_UM;
  const absA_m = Math.abs(a_um) * UM_TO_M;
  const n_m3 = density_um3 * 1e18;
  const sign: 1 | -1 = a_a0 > 0 ? 1 : -1;

  const absG = (4 * Math.PI * HBAR_JS ** 2 * absA_m) / species.massKg;
  const xi_m = HBAR_JS / Math.sqrt(2 * species.massKg * absG * n_m3);
  const xi_um = xi_m / UM_TO_M;
  const t0_s = HBAR_JS / (absG * n_m3);
  const ncal = 4 * Math.PI ** 2 * density_um3 * xi_um ** 3;

  return {
    density_um3,
    a_um,
    massKg: species.massKg,
    sign,
    na_um2: density_um3 * a_um,
    g_SI: sign * absG,
    xi_um,
    t0_s,
    ncal,
    k_xi: 1 / xi_um,
  };
}
