/** Physical constants and atomic species data */

export const HBAR_JS = 1.054571817e-34;       // J·s
export const HBAR_eVS = 6.582119569e-16;      // eV·s
export const KB_JK = 1.380649e-23;            // J/K
export const AMU_KG = 1.66053906892e-27;      // kg per amu (CODATA 2022)
export const BOHR_RADIUS_M = 5.29177210903e-11; // m (CODATA 2018)
export const BOHR_RADIUS_UM = 5.29177210903e-5; // μm  ← primary unit throughout
export const UM_TO_M = 1e-6;

export interface AtomicSpecies {
  label: string;
  symbol: string;
  massAmu: number;
  massKg: number;
  commonA0?: number; // typical scattering length in Bohr radii for reference
}

export const SPECIES: Record<string, AtomicSpecies> = {
  K39: {
    label: '³⁹K',
    symbol: '39K',
    massAmu: 38.96370668,
    massKg: 38.96370668 * AMU_KG,
    commonA0: 50,
  },
  K41: {
    label: '⁴¹K',
    symbol: '41K',
    massAmu: 40.96182576,
    massKg: 40.96182576 * AMU_KG,
    commonA0: 60,
  },
  Rb87: {
    label: '⁸⁷Rb',
    symbol: '87Rb',
    massAmu: 86.9091805,
    massKg: 86.9091805 * AMU_KG,
    commonA0: 100,
  },
  Na23: {
    label: '²³Na',
    symbol: '23Na',
    massAmu: 22.9897692809,
    massKg: 22.9897692809 * AMU_KG,
    commonA0: 55,
  },
  Li6: {
    label: '⁶Li',
    symbol: '6Li',
    massAmu: 6.0151228874,
    massKg: 6.0151228874 * AMU_KG,
    commonA0: -2200,
  },
  Li7: {
    label: '⁷Li',
    symbol: '7Li',
    massAmu: 7.0160034366,
    massKg: 7.0160034366 * AMU_KG,
    commonA0: -27,
  },
  Cs133: {
    label: '¹³³Cs',
    symbol: '133Cs',
    massAmu: 132.905451961,
    massKg: 132.905451961 * AMU_KG,
    commonA0: 280,
  },
};

export const DEFAULT_SPECIES_KEY = 'K39';

/**
 * Canonical solver p range (p = k ξ). The collision cutoff is p_max/√2 so that
 * the outgoing p3 = √(p1² + p2² − p²) never leaves the state grid. Grid size and
 * quadrature depend on the accuracy level (precision.ts).
 */
export const P_MIN = 0.01;
export const P_MAX = 20.0;
export const N_GRID = 500;

/**
 * Keep at least the reference physical-k range when the healing length grows.
 *
 * A fixed p_max makes k_max = p_max / xi collapse at weak coupling.  The
 * initial spectrum can still be fully covered in that case while the
 * energy-carrying direct cascade runs into the collision cutoff during the
 * solve, causing very large number and energy drift.  Scaling p_max with xi
 * preserves the reference k cutoff; for xi below the reference value the
 * canonical p range is retained.
 */
export function solverPMax(xi_um: number): number {
  return P_MAX * Math.max(1, xi_um / REFERENCE_XI_UM);
}

/**
 * Healing length of the reference conditions (n = 2.8331 μm⁻³, a = 50 a₀, ³⁹K).
 * The input grid is the Standard solver grid at these conditions.
 */
export const REFERENCE_XI_UM = 2.30389960057421;
export const REFERENCE_DENSITY_UM3 = 2.8331;
export const REFERENCE_A_A0 = 50;
