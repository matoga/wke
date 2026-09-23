/**
 * Export conversions: any saved profile (the imported spectrum, or a WKE
 * snapshot) rendered as a two-column table in the convention and k unit the
 * user picks. Kept separate from `ui/norm.ts`, which is the *display* toggle:
 * export needs a strict superset (radial n_k, and a k-unit choice) that would
 * be overkill for every plot in the app.
 */

export type ExportConvention = 'Nk_over_N' | 'Nk' | 'nk';
export type ExportKUnit = 'um_inv' | 'm_inv';

export const EXPORT_CONVENTIONS: Array<{ id: ExportConvention; label: string; column: string }> = [
  { id: 'Nk_over_N', label: 'Nₖ/N, unit norm', column: 'Nk_over_N' },
  { id: 'Nk', label: 'Nₖ, atom-number scale', column: 'Nk' },
  { id: 'nk', label: 'nₖ = Nₖ/(4πk²), radial density', column: 'n_k' },
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

export interface ExportedTrajectory {
  csv: string;
  rows: number;
  curves: number;
  scaleNote: string;
}

function absoluteScale(atomNumber: number | null, fallbackScale: number | null): {
  scale: number;
  scaleNote: string;
} {
  const N = atomNumber ?? fallbackScale;
  if (N != null && N > 0) {
    return {
      scale: N,
      scaleNote: atomNumber != null
        ? `scaled to N = ${N.toPrecision(6)} atoms`
        : `N unknown; scaled to the imported integral (${N.toExponential(4)})`,
    };
  }
  return { scale: 1, scaleNote: 'No absolute scale available; using unit norm' };
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
    ({ scale, scaleNote } = absoluteScale(opts.atomNumber, opts.fallbackScale));
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

/** Export every distinct saved state for one kernel as long-form k,n_k,time rows. */
export function exportTrajectory(
  k_um_inv: ArrayLike<number>,
  snapshots: ArrayLike<{ t_s: number; q: ArrayLike<number> }>,
  density_um3: number,
): ExportedTrajectory {
  const unique = new Map<string, { t_s: number; q: ArrayLike<number> }>();
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    unique.set(snapshot.t_s.toPrecision(15), snapshot);
  }

  const curves = Array.from(unique.values()).sort((a, b) => a.t_s - b.t_s);
  const lines = ['k_um_inv,n_k,time_s'];
  let rows = 0;
  for (const snapshot of curves) {
    const n = Math.min(k_um_inv.length, snapshot.q.length);
    for (let i = 0; i < n; i++) {
      const k = k_um_inv[i];
      const k2 = k * k;
      const nk = k2 > 0 ? (snapshot.q[i] * 2 * Math.PI * Math.PI * density_um3) / k2 : 0;
      lines.push(`${k.toPrecision(9)},${nk.toPrecision(9)},${snapshot.t_s.toPrecision(9)}`);
      rows++;
    }
  }
  return {
    csv: lines.join('\n'), rows, curves: curves.length,
    scaleNote: `absolute occupation using n = ${density_um3.toPrecision(6)} μm⁻³`,
  };
}
