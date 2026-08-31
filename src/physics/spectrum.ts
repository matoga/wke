/**
 * Spectrum import: CSV parsing, convention handling, and resampling.
 *
 * Two input conventions are supported and are never inferred silently:
 *
 *   `n_k`        radial momentum-space density n(k), with ∫ d³k n(k) = N.
 *                The shell density is N_k = 4π k² n(k).
 *   `Nk_over_N`  the shell density N_k itself (or anything proportional to it),
 *                e.g. an already-normalized q(k).
 *
 * Both are normalized to q(k) = N_k / N with ∫ q dk = 1.
 */

import { interpolateQ, normalizeQ, trapz } from './grid';
import { DESCRIPTOR_GRID } from './descriptors';

export type SpectrumConvention = 'n_k' | 'Nk_over_N';

export const CONVENTIONS: Array<{
  id: SpectrumConvention;
  columns: string;
  label: string;
  detail: string;
}> = [
  {
    id: 'n_k',
    columns: 'k_um_inv, n_k',
    label: 'Isotropic density n(k)',
    detail: 'Three-dimensional isotropic density: N = 4π∫k²n(k)dk. Converted via N_k = 4πk²n(k), then normalized.',
  },
  {
    id: 'Nk_over_N',
    columns: 'k_um_inv, Nk_over_N',
    label: 'Shell distribution N_k / N',
    detail: 'One-dimensional shell distribution with ∫(N_k/N)dk = 1. Relative weights are also accepted and normalized to this integral.',
  },
];

export interface RawSpectrum {
  /** k values exactly as supplied [μm⁻¹] */
  k_um_inv: number[];
  /** second column exactly as supplied, before any conversion */
  values: number[];
  convention: SpectrumConvention;
  label: string;
  source: 'preset' | 'paste' | 'file';
  /** header names detected in the file, if any */
  detectedColumns?: [string, string];
  warnings: string[];
}

export interface PreparedSpectrum {
  raw: RawSpectrum;
  /** shell density N_k on the raw k grid, before normalization */
  shellRaw: number[];
  /** ∫ N_k dk over the raw grid, i.e. the normalization that was divided out */
  rawIntegral: number;
  /** q(k) on the raw k grid, ∫ q dk = 1 */
  qRaw: number[];
  /** q(k) resampled onto the canonical descriptor grid and renormalized */
  k: Float64Array;
  q: Float64Array;
  /** fraction of ∫q dk that falls outside the descriptor grid */
  coverageLoss: number;
}

export class SpectrumParseError extends Error {}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Parse two numeric columns from CSV/TSV/whitespace-delimited text.
 * A non-numeric first row is treated as a header.
 */
export function parseSpectrumText(text: string): {
  k: number[];
  values: number[];
  detectedColumns?: [string, string];
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) throw new SpectrumParseError('No data rows found.');

  const split = (line: string): string[] =>
    line.split(/[,;\t]|\s{1,}/).map((c) => c.trim()).filter((c) => c.length > 0);

  let detectedColumns: [string, string] | undefined;
  let start = 0;
  const first = split(lines[0]);
  if (first.length >= 2 && !NUMERIC.test(first[0])) {
    detectedColumns = [first[0], first[1]];
    start = 1;
  }

  const k: number[] = [];
  const values: number[] = [];
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (cells.length < 2) { skipped++; continue; }
    const a = Number(cells[0]);
    const b = Number(cells[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { skipped++; continue; }
    k.push(a);
    values.push(b);
  }

  if (skipped > 0) warnings.push(`${skipped} row(s) skipped as non-numeric.`);
  if (k.length < 4) {
    throw new SpectrumParseError(`Only ${k.length} usable rows; need at least 4.`);
  }
  return { k, values, detectedColumns, warnings };
}

/**
 * Convert a raw spectrum to the shell density N_k, then to q(k) on the raw grid
 * and on the canonical descriptor grid.
 */
export function prepareSpectrum(raw: RawSpectrum): PreparedSpectrum {
  const n = raw.k_um_inv.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => raw.k_um_inv[a] - raw.k_um_inv[b],
  );
  const kSorted: number[] = [];
  const vSorted: number[] = [];
  for (const i of order) {
    const kv = raw.k_um_inv[i];
    if (!(kv > 0)) continue; // k = 0 carries no shell weight and breaks log grids
    if (kSorted.length > 0 && kv === kSorted[kSorted.length - 1]) continue;
    kSorted.push(kv);
    vSorted.push(raw.values[i]);
  }
  if (kSorted.length < 4) {
    throw new SpectrumParseError('Fewer than 4 distinct positive k values.');
  }

  const warnings = [...raw.warnings];
  let negatives = 0;
  const nonnegativeValues = vSorted.map((value) => {
    if (value < 0) { negatives++; return 0; }
    return value;
  });
  const shellRaw = kSorted.map((kv, i) => {
    const v = nonnegativeValues[i];
    return raw.convention === 'n_k' ? 4 * Math.PI * kv * kv * v : v;
  });
  if (negatives > 0) {
    warnings.push(`${negatives} negative value(s) clipped to zero.`);
  }

  const kArr = Float64Array.from(kSorted);
  const rawIntegral = trapz(Float64Array.from(shellRaw), kArr);
  if (!(rawIntegral > 0)) {
    throw new SpectrumParseError('Spectrum integrates to zero; nothing to normalize.');
  }
  const qRaw = shellRaw.map((v) => v / rawIntegral);

  const kGrid = DESCRIPTOR_GRID;
  // Below the first measurement, retain the first finite n(k), not the first
  // shell value. For an n(k) import this happens naturally before conversion;
  // for an N_k/N import we reconstruct the equivalent k² shell scaling.
  const importedOnGrid = interpolateQ(kSorted, nonnegativeValues, kGrid, { lower: 'constant' });
  if (kSorted[0] > kGrid[0]) {
    warnings.push(
      `Below ${kSorted[0].toPrecision(3)} μm⁻¹, n_k is held at its first finite supplied value.`,
    );
  }
  const shellOnGrid = new Float64Array(kGrid.length);
  for (let i = 0; i < kGrid.length; i++) {
    if (raw.convention === 'n_k') {
      shellOnGrid[i] = 4 * Math.PI * kGrid[i] * kGrid[i] * importedOnGrid[i];
    } else if (kGrid[i] < kSorted[0]) {
      const ratio = kGrid[i] / kSorted[0];
      shellOnGrid[i] = importedOnGrid[i] * ratio * ratio;
    } else {
      shellOnGrid[i] = importedOnGrid[i];
    }
  }
  const covered = trapz(shellOnGrid, kGrid) / rawIntegral;
  const qInterp = shellOnGrid;
  const q = normalizeQ(qInterp, kGrid);

  if (kSorted[0] > kGrid[kGrid.length - 1] || kSorted[kSorted.length - 1] < kGrid[0]) {
    throw new SpectrumParseError(
      `k range ${kSorted[0].toPrecision(3)}–${kSorted[kSorted.length - 1].toPrecision(3)} μm⁻¹ ` +
      `does not overlap the solver grid ${kGrid[0].toPrecision(3)}–${kGrid[kGrid.length - 1].toPrecision(3)} μm⁻¹.`,
    );
  }
  const coverageLoss = Math.max(0, 1 - covered);
  if (coverageLoss > 0.01) {
    warnings.push(
      `${(coverageLoss * 100).toFixed(1)}% of the spectral weight lies outside the solver grid ` +
      `(${kGrid[0].toPrecision(3)}–${kGrid[kGrid.length - 1].toPrecision(3)} μm⁻¹) and was renormalized away.`,
    );
  }

  return {
    raw: { ...raw, k_um_inv: kSorted, values: vSorted, warnings },
    shellRaw,
    rawIntegral,
    qRaw,
    k: kGrid,
    q,
    coverageLoss,
  };
}

/** Convenience: text → prepared spectrum. */
export function prepareFromText(
  text: string,
  convention: SpectrumConvention,
  label: string,
  source: 'paste' | 'file',
): PreparedSpectrum {
  const { k, values, detectedColumns, warnings } = parseSpectrumText(text);
  return prepareSpectrum({
    k_um_inv: k,
    values,
    convention,
    label,
    source,
    detectedColumns,
    warnings,
  });
}
