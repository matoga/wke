/**
 * System parameters: density from atom number and volume (box or cylinder),
 * or entered directly, plus the scattering length as a magnitude and a sign:
 * repulsive, attractive, or both (a ±a pair of runs from the same state).
 */

import { BOHR_RADIUS_UM } from './constants';
import type { Sign } from '../types/wke';

export type ASign = 'repulsive' | 'attractive' | 'both';

export const A_SIGNS: Array<{ id: ASign; label: string; title: string }> = [
  { id: 'repulsive', label: 'Repulsive', title: 'a = +|a|' },
  { id: 'attractive', label: 'Attractive', title: 'a = −|a|' },
  { id: 'both', label: 'Both ±a', title: 'Run +|a| and −|a| side by side from the same initial state.' },
];

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
  /** magnitude of the scattering length |a| (a₀) */
  a_a0: number | null;
  /** sign of a, or both signs as a pair */
  aSign: ASign;
}

export interface DerivedSystem {
  density_um3: number | null;
  /** signed scattering length (a₀); +|a| for a pair, whose scales depend on |a| only */
  a_a0: number | null;
  /** the signs to run: one, or both for a ±a pair */
  signs: Sign[];
  /** signed n·a (μm⁻²); for a pair, n|a| */
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
  const signs: Sign[] = inp.aSign === 'both' ? [1, -1] : inp.aSign === 'attractive' ? [-1] : [1];
  const out: DerivedSystem = { density_um3: null, a_a0: null, signs, na_um2: null, N: null, V_um3: null, errors };

  if (inp.a_a0 == null || !Number.isFinite(inp.a_a0)) errors.push('Enter the scattering length a.');
  else if (inp.a_a0 === 0) errors.push('The scattering length must be non-zero: at a = 0 nothing collides.');
  else out.a_a0 = signs[0] * Math.abs(inp.a_a0);

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
