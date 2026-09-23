/**
 * Display normalization for the shell spectrum.
 *
 * Internally everything is the unit-normalized shell density
 *
 *     q(k) = N_k / N,      ∫ q(k) dk = 1,      N_k = 4π k² n(k),
 *
 * a scale-free working quantity. The UI never labels an axis "q"; it shows N_k
 * under one of two conventions, chosen with a single switch in the header:
 *
 *   `unit`          N_k / N (the profile as normalized), ∫ = 1.
 *   `experimental`  N_k on the scale the numbers actually came in on: the atom
 *                   number N when the parameters identify it, otherwise the
 *                   integral of the imported column.
 *
 * Both are the same curve with a different y scale; nothing about the physics
 * or the fitted descriptors depends on the choice.
 */

export type NormMode = 'unit' | 'experimental';

export const NORM_MODES: Array<{ id: NormMode; label: string; title: string }> = [
  {
    id: 'unit',
    label: 'Nₖ/N',
    title: 'Unit norm: the shell spectrum divided by the total atom number, ∫ dk = 1.',
  },
  {
    id: 'experimental',
    label: 'Nₖ',
    title: 'Experimental norm: the shell spectrum on the atom-number scale, ∫ dk = N.',
  },
];

export interface NormSpec {
  mode: NormMode;
  /** multiply the internal q(k) by this to get the displayed quantity */
  scale: number;
  /** axis symbol, e.g. "N_k / N" */
  symbol: string;
  /** axis unit, e.g. "μm" */
  unit: string;
  /** full axis label */
  axis: string;
  /** where the scale came from, for the caption */
  source: string;
  /** true when experimental was requested but no absolute scale is known */
  fellBack: boolean;
}

export function normSpec(
  mode: NormMode,
  opts: { atomNumber?: number | null; importedIntegral?: number | null },
): NormSpec {
  if (mode === 'unit') {
    return {
      mode,
      scale: 1,
      symbol: 'Nₖ/N',
      unit: 'μm',
      axis: 'Nₖ/N (μm)',
      source: 'normalized to ∫ dk = 1',
      fellBack: false,
    };
  }

  const N = opts.atomNumber;
  if (N != null && N > 0) {
    return {
      mode,
      scale: N,
      symbol: 'Nₖ',
      unit: 'atoms μm',
      axis: 'Nₖ (atoms μm)',
      source: `scaled to N = ${N.toPrecision(4)} atoms`,
      fellBack: false,
    };
  }

  const raw = opts.importedIntegral;
  if (raw != null && raw > 0) {
    return {
      mode,
      scale: raw,
      symbol: 'Nₖ',
      unit: 'as imported',
      axis: 'Nₖ (as imported)',
      source: 'N is unknown; using the imported scale',
      fellBack: true,
    };
  }

  return {
    mode,
    scale: 1,
    symbol: 'Nₖ/N',
    unit: 'μm',
    axis: 'Nₖ/N (μm)',
    source: 'No absolute scale available; using unit norm',
    fellBack: true,
  };
}

/** Apply a NormSpec to a profile. Returns the input unchanged when scale is 1. */
export function applyNorm(values: ArrayLike<number>, spec: NormSpec): ArrayLike<number> {
  if (spec.scale === 1) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] * spec.scale;
  return out;
}
