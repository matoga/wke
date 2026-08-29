/**
 * The three parameter modes and what each one identifies.
 *
 *   known_NVa    N, V, a          → n = N/V,  na
 *   known_na     n, a             → na
 *   measured_dt  Δt₁ᐟ₂ (+ a, N)   → na from the calibration;
 *                                   n = na/a if a given; V = N/n if N also given
 *
 * The WKE itself only needs na for the classical kernel (the collision operator
 * is scale-invariant once expressed in ξ and t₀, both functions of na), but the
 * quantum kernel's +1 factors compare f against unity, so it needs n and a
 * separately. Modes that identify only na therefore disable quantum runs.
 */

import { BOHR_RADIUS_UM } from './constants';
import { inferNA } from './calibration';
import type { SpectralDescriptors } from './descriptors';
import type { DerivedPhysics, ParameterMode, PhysicsInputs } from '../types/wke';

export const MODES: Array<{ id: ParameterMode; label: string; blurb: string }> = [
  {
    id: 'known_NVa',
    label: 'Known volume',
    blurb: 'Predict the half-time from N, V, and a.',
  },
  {
    id: 'known_na',
    label: 'Known density',
    blurb: 'Predict the half-time from n and a.',
  },
  {
    id: 'measured_dt',
    label: 'Calibrate volume',
    blurb: 'Infer box volume from N, a, and the measured half-time.',
  },
];

/** Resolve the derived quantities for the active mode. */
export function derivePhysics(
  inputs: PhysicsInputs,
  desc: SpectralDescriptors | null,
): DerivedPhysics {
  const notes: string[] = [];
  const empty: DerivedPhysics = {
    density_um3: null, a_a0: null, na_um2: null, V_um3: null, N: null,
    quantumAvailable: false, notes,
  };

  const aUm = (a: number) => a * BOHR_RADIUS_UM;

  if (inputs.mode === 'known_NVa') {
    const { N, V_um3, a_a0 } = inputs;
    if (N == null || V_um3 == null || a_a0 == null) {
      notes.push('Enter N, V and a.');
      return empty;
    }
    if (!(N > 0 && V_um3 > 0)) {
      notes.push('N and V must be positive.');
      return empty;
    }
    const n = N / V_um3;
    return {
      density_um3: n, a_a0, na_um2: n * aUm(a_a0), V_um3, N,
      quantumAvailable: true, notes,
    };
  }

  if (inputs.mode === 'known_na') {
    const { density_um3, a_a0 } = inputs;
    if (density_um3 == null || a_a0 == null) {
      notes.push('Enter n and a.');
      return empty;
    }
    if (!(density_um3 > 0)) {
      notes.push('n must be positive.');
      return empty;
    }
    return {
      density_um3, a_a0, na_um2: density_um3 * aUm(a_a0), V_um3: null, N: inputs.N,
      quantumAvailable: true, notes,
    };
  }

  // measured_dt
  const { dt_measured_s, a_a0, N } = inputs;
  if (dt_measured_s == null || !(dt_measured_s > 0)) {
    notes.push('Enter a measured Δt₁ᐟ₂ > 0.');
    return empty;
  }
  if (!desc) {
    notes.push('Load a spectrum to evaluate the calibration.');
    return empty;
  }

  const na = inferNA(desc, dt_measured_s);
  let density: number | null = null;
  let volume: number | null = null;

  if (a_a0 != null && a_a0 !== 0) {
    density = na / aUm(a_a0);
    if (N != null && N > 0) {
      volume = N / density;
    } else {
      notes.push('Add N to obtain V = N/n.');
    }
  } else {
    notes.push('Only na is identified. Add a to obtain n, and N as well for V.');
  }

  return {
    density_um3: density,
    a_a0: a_a0 ?? null,
    na_um2: na,
    V_um3: volume,
    N: N ?? null,
    quantumAvailable: density != null && a_a0 != null,
    notes,
  };
}

/**
 * A classical WKE rerun only needs na, so any (n, a) pair with the right
 * product reproduces the same dynamics. When the mode identifies na alone, use
 * the reference density and solve for the matching a.
 */
export function classicalRunParameters(
  derived: DerivedPhysics,
  referenceDensity_um3: number,
): { density_um3: number; a_a0: number } | null {
  if (derived.na_um2 == null || !(derived.na_um2 > 0)) return null;
  if (derived.density_um3 != null && derived.a_a0 != null) {
    return { density_um3: derived.density_um3, a_a0: derived.a_a0 };
  }
  return {
    density_um3: referenceDensity_um3,
    a_a0: derived.na_um2 / referenceDensity_um3 / BOHR_RADIUS_UM,
  };
}
