/**
 * Export conversions: any saved profile (the imported spectrum, or a WKE
 * snapshot) rendered as a two-column table in the convention and k unit the
 * user picks. Kept separate from `ui/norm.ts`, which is the *display* toggle —
 * export needs a strict superset (radial n_k, and a k-unit choice) that would
 * be overkill for every plot in the app.
 */

export type ExportConvention = 'Nk_over_N' | 'Nk' | 'nk';
export type ExportKUnit = 'um_inv' | 'm_inv';

export const EXPORT_CONVENTIONS: Array<{ id: ExportConvention; label: string; column: string }> = [
  { id: 'Nk_over_N', label: 'N_k / N (unit norm, ∫dk = 1)', column: 'Nk_over_N' },
  { id: 'Nk', label: 'N_k (experimental scale)', column: 'Nk' },
  { id: 'nk', label: 'n_k = N_k / (4πk²)  (radial density)', column: 'n_k' },
];

export const EXPORT_K_UNITS: Array<{ id: ExportKUnit; label: string }> = [
  { id: 'um_inv', label: 'μm⁻¹' },
  { id: 'm_inv', label: 'm⁻¹' },
];

export interface ExportOptions {
  convention: ExportConvention;
  kUnit: ExportKUnit;
  /** atom number, for the Nk convention; falls back to `fallbackScale` when absent */
  atomNumber: number | null;
  /** used for Nk when atomNumber is unknown (e.g. the raw imported integral) */
  fallbackScale: number | null;
}

export interface ExportedProfile {
  csv: string;
  kColumn: string;
  valueColumn: string;
  scaleNote: string;
}

/** Render (k [μm⁻¹], q with ∫q dk = 1) as a CSV under the requested convention. */
export function exportProfile(
  k_um_inv: ArrayLike<number>,
  q_unit: ArrayLike<number>,
  opts: ExportOptions,
): ExportedProfile {
  const n = Math.min(k_um_inv.length, q_unit.length);
  const kUnit = EXPORT_K_UNITS.find((u) => u.id === opts.kUnit)!;
  const kScale = opts.kUnit === 'm_inv' ? 1e6 : 1;

  let scale = 1;
  let scaleNote = '∫dk = 1 (unit norm)';
  if (opts.convention !== 'Nk_over_N') {
    const N = opts.atomNumber ?? opts.fallbackScale;
    if (N != null && N > 0) {
      scale = N;
      scaleNote = opts.atomNumber != null
        ? `scaled to N = ${N.toPrecision(6)} atoms`
        : `N unknown; scaled to the imported integral (${N.toExponential(4)})`;
    } else {
      scaleNote = 'No absolute scale available; using unit norm';
    }
  }

  const kColumn = `k_${kUnit.id}`;
  const valueColumn = EXPORT_CONVENTIONS.find((c) => c.id === opts.convention)!.column;

  const lines = [`${kColumn},${valueColumn}`];
  for (let i = 0; i < n; i++) {
    const k = k_um_inv[i] * kScale;
    let v = q_unit[i] * scale;
    if (opts.convention === 'nk') {
      const k4pi = 4 * Math.PI * k_um_inv[i] * k_um_inv[i]; // radial conversion uses physical k, not the export unit
      v = k4pi > 0 ? v / k4pi : 0;
      // n_k as exported is per μm^-3 in k-space regardless of the k-column unit;
      // converting that to a per-m^-3 convention would require a second factor,
      // which is out of scope for a same-page CSV export.
    }
    lines.push(`${k.toPrecision(9)},${v.toPrecision(9)}`);
  }

  return { csv: lines.join('\n'), kColumn, valueColumn, scaleNote };
}
