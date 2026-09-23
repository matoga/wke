/**
 * System parameters: density from atom number and volume (box or cylinder),
 * or entered directly, plus the signed scattering length.
 */

import { BOHR_RADIUS_UM } from './constants';

export type InputMode = 'N_V' | 'N_cylinder' | 'density';

export const INPUT_MODES: Array<{ id: InputMode; label: string }> = [
  { id: 'N_V', label: 'N and V' },
  { id: 'N_cylinder', label: 'N and cylinder' },
  { id: 'density', label: 'Density' },
];

export interface SystemInputs {
  mode: InputMode;
  speciesKey: string;
  N: number | null;
  V_um3: number | null;
  /** cylinder length L (μm) and aspect ratio R/L */
  L_um: number | null;
  aspect: number | null;
  density_um3: number | null;
  /** signed scattering length (a₀) */
  a_a0: number | null;
}

export interface DerivedSystem {
  density_um3: number | null;
  a_a0: number | null;
  /** signed n·a (μm⁻²) */
  na_um2: number | null;
  N: number | null;
  V_um3: number | null;
  errors: string[];
}

export function cylinderVolume(L_um: number, aspect: number): number {
  const R = aspect * L_um;
  return Math.PI * R * R * L_um;
}

const positive = (x: number | null): x is number => x != null && Number.isFinite(x) && x > 0;

export function deriveSystem(inp: SystemInputs): DerivedSystem {
  const errors: string[] = [];
  const out: DerivedSystem = { density_um3: null, a_a0: null, na_um2: null, N: null, V_um3: null, errors };

  if (inp.a_a0 == null || !Number.isFinite(inp.a_a0)) errors.push('Enter the scattering length a.');
  else if (inp.a_a0 === 0) errors.push('The scattering length must be non-zero: at a = 0 nothing collides.');
  else out.a_a0 = inp.a_a0;

  if (inp.mode === 'density') {
    if (!positive(inp.density_um3)) errors.push('The density n must be positive.');
    else out.density_um3 = inp.density_um3;
    if (positive(inp.N)) out.N = inp.N;
  } else {
    if (!positive(inp.N)) errors.push('The atom number N must be positive.');
    let V: number | null = null;
    if (inp.mode === 'N_V') {
      if (!positive(inp.V_um3)) errors.push('The volume V must be positive.');
      else V = inp.V_um3;
    } else if (!positive(inp.L_um) || !positive(inp.aspect)) {
      errors.push('The cylinder length L and ratio R/L must be positive.');
    } else {
      V = cylinderVolume(inp.L_um, inp.aspect);
    }
    if (positive(inp.N) && V != null) {
      out.N = inp.N;
      out.V_um3 = V;
      out.density_um3 = inp.N / V;
    }
  }

  if (out.density_um3 != null && out.a_a0 != null) {
    out.na_um2 = out.density_um3 * out.a_a0 * BOHR_RADIUS_UM;
  }
  return out;
}
