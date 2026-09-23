/**
 * Built-in example spectra. `shared-data/presets.json` holds profiles already
 * sampled on the input grid; the measured n_k spectra are stored as supplied.
 */

import presetsJson from '../../shared-data/presets.json';
import measuredBJson from '../../shared-data/measured-state-b.json';
import measuredCJson from '../../shared-data/measured-states-c.json';
import { prepareSpectrum } from './spectrum';
import type { PreparedSpectrum } from './spectrum';

interface PresetRecord {
  key: string;
  name: string;
  description: string;
  q: number[];
  reference_density_um3: number;
  reference_a_a0: number;
  descriptors: {
    kp0_um_inv: number;
  };
}

const K_DESC: number[] = presetsJson.metadata.k_desc_um_inv;
const RECORDS = presetsJson.profiles as PresetRecord[];
const DEFAULT_DENSITY_UM3 = 2.8331;
const DEFAULT_A_A0 = 50;

export interface Preset {
  key: string;
  name: string;
  description: string;
  kp_um_inv: number;
  defaultDensity_um3: number;
  defaultA_a0: number;
  /** Defining expression for presets generated directly from an analytic shape. */
  formula?: string;
  /** Hide preprocessing details for curated built-in measured data. */
  hideImportNotes?: boolean;
  load: () => PreparedSpectrum;
}

/**
 * Generated fixtures live on the complete descriptor grid. Measured profiles
 * that started at finite k were historically padded with leading zeroes,
 * erasing the distinction between "unmeasured" and physically empty. Restore
 * the agreed finite low-k occupation: n_k is held at its first measured value,
 * hence the shell distribution q = N_k/N grows as k² toward that point.
 */
function restoreFiniteLowKOccupation(qInput: number[]): number[] {
  const q = qInput.slice();
  const first = q.findIndex((value) => Number.isFinite(value) && value > 0);
  if (first <= 0) return q;
  const k0 = K_DESC[first];
  const q0 = q[first];
  for (let index = 0; index < first; index++) {
    const ratio = K_DESC[index] / k0;
    q[index] = q0 * ratio * ratio;
  }
  return q;
}

/** Taper a prepared fixture after its measured shape, without moving its peak. */
function smoothPreparedTail(q: number[], start: number, end: number): number[] {
  const upper = K_DESC.findIndex((k) => k >= start);
  if (upper <= 0) return q;
  const lower = upper - 1;
  const fraction = (start - K_DESC[lower]) / (K_DESC[upper] - K_DESC[lower]);
  const height = q[lower] + fraction * (q[upper] - q[lower]);
  return q.map((value, i) => {
    const k = K_DESC[i];
    if (k <= start) return value;
    if (k >= end) return 0;
    const u = (k - start) / (end - start);
    return height * Math.exp(-2 * u) * (1 - u) ** 2;
  });
}

const PREPARED_TAILS: Record<string, [start: number, end: number]> = {
  prepared_a: [2.2, 4.0],
  prepared_b: [3.0, 4.5],
  prepared_c: [4.0, 5.0],
  prepared_d: [4.7, 5.5],
};

const fixturePresets: Preset[] = RECORDS.map((rec) => ({
  key: rec.key,
  name: rec.name,
  description: rec.description,
  kp_um_inv: rec.descriptors.kp0_um_inv,
  defaultDensity_um3: rec.reference_density_um3,
  defaultA_a0: rec.reference_a_a0,
  formula: rec.key === 'gaussian_shell'
    ? 'N_k(k) \\propto \\exp\\!\\left[-\\frac{(k-2.0)^2}{2(0.28)^2}\\right]'
    : undefined,
  load: () =>
    prepareSpectrum({
      k_um_inv: K_DESC,
      values: PREPARED_TAILS[rec.key]
        ? smoothPreparedTail(restoreFiniteLowKOccupation(rec.q), ...PREPARED_TAILS[rec.key])
        : restoreFiniteLowKOccupation(rec.q),
      convention: 'Nk_over_N',
      label: rec.name,
      source: 'preset',
      warnings: [],
    }),
}));

function syntheticPreset({
  key, name, description, convention, formula, values,
}: {
  key: string;
  name: string;
  description: string;
  convention: 'n_k' | 'Nk_over_N';
  formula: string;
  values: (k: number) => number;
}): Preset {
  const sampled = K_DESC.map((k) => Math.max(0, values(k)));
  const peakValues = convention === 'n_k'
    ? sampled.map((n, i) => K_DESC[i] * K_DESC[i] * n)
    : sampled;
  let peakIndex = 0;
  for (let i = 1; i < peakValues.length; i++) {
    if (peakValues[i] > peakValues[peakIndex]) peakIndex = i;
  }
  return {
    key,
    name,
    description,
    kp_um_inv: K_DESC[peakIndex],
    defaultDensity_um3: DEFAULT_DENSITY_UM3,
    defaultA_a0: DEFAULT_A_A0,
    formula,
    load: () => prepareSpectrum({
      k_um_inv: K_DESC,
      values: sampled,
      convention,
      label: name,
      source: 'preset',
      warnings: [],
    }),
  };
}

function measuredNkPreset({
  key, name, description, data, kMax_um_inv,
}: {
  key: string;
  name: string;
  description: string;
  data: { k_um_inv: number[]; n_k: number[] };
  kMax_um_inv: number;
}): Preset {
  const retained = data.k_um_inv
    .map((k, index) => ({ k, n: data.n_k[index] }))
    .filter(({ k }) => k <= kMax_um_inv);
  const peak = retained.reduce((best, { k, n }) => {
    const shell = k * k * Math.max(0, n);
    return shell > best.shell ? { k, shell } : best;
  }, { k: retained[0].k, shell: -Infinity });
  return {
    key, name, description, kp_um_inv: peak.k,
    defaultDensity_um3: DEFAULT_DENSITY_UM3,
    defaultA_a0: DEFAULT_A_A0,
    hideImportNotes: true,
    load: () => prepareSpectrum({
      k_um_inv: retained.map(({ k }) => k),
      values: retained.map(({ n }) => n),
      convention: 'n_k',
      label: name,
      source: 'preset',
      warnings: [],
    }),
  };
}

const preparedE = syntheticPreset({
  key: 'prepared_e',
  name: 'Prepared state E',
  description: 'High-wavevector prepared state with a gently skewed tail.',
  convention: 'Nk_over_N',
  formula: 'N_k(k) \\propto \\exp\\!\\left[-\\frac{(k-4.8)^2}{2\\sigma(k)^2}\\right],\\quad \\sigma(k)=\\begin{cases}0.48,&k<4.8\\\\0.72,&k\\ge 4.8\\end{cases}',
  values: (k) => {
    const kp = 4.8;
    const sigma = k < kp ? 0.48 : 0.72;
    return Math.exp(-0.5 * ((k - kp) / sigma) ** 2);
  },
});

const measuredB = measuredNkPreset({
  key: 'measured_b',
  name: 'Measured state B',
  description: 'Measured n_k at t = 0, just after a momentum kick.',
  data: measuredBJson,
  kMax_um_inv: 4,
});

const measuredC: Preset[] = (['C1', 'C2', 'C3'] as const).map((id) => measuredNkPreset({
  key: `measured_${id.toLowerCase()}`,
  name: `Measured state ${id}`,
  description: `Measured n_k spectrum ${id}.`,
  data: measuredCJson[id],
  kMax_um_inv: id === 'C3' ? 6 : 4,
}));

const exploratoryPresets: Preset[] = [
  syntheticPreset({
    key: 'sharp_gaussian',
    name: 'Sharp Gaussian',
    description: 'Narrow shell distribution centered at k = 2.0 μm⁻¹.',
    convention: 'Nk_over_N',
    formula: 'N_k(k) \\propto \\exp\\!\\left[-\\frac{(k-2.0)^2}{2(0.12)^2}\\right]',
    values: (k) => Math.exp(-0.5 * ((k - 2) / 0.12) ** 2),
  }),
  syntheticPreset({
    key: 'nk_top_hat',
    name: 'Top-hat in nₖ',
    description: 'Heaviside occupation n_k proportional to Θ(k_p - k), with k_p = 2.2 μm⁻¹.',
    convention: 'n_k',
    formula: 'n_k(k) \\propto \\Theta(2.2-k)',
    values: (k) => k < 2.2 ? 1 : 0,
  }),
  syntheticPreset({
    key: 'bose_einstein_mu0',
    name: 'Thermal Bose–Einstein (μ = 0)',
    description: 'Ideal μ = 0 Bose–Einstein occupation with thermal wavevector k_T = 1.5 μm⁻¹.',
    convention: 'n_k',
    formula: 'n_k(k) \\propto \\frac{1}{\\exp[(k/1.5)^2]-1}',
    values: (k) => 1 / Math.expm1((k / 1.5) ** 2),
  }),
  syntheticPreset({
    key: 'bose_einstein_mu0_perturbed',
    name: 'Thermal + weak perturbation',
    description: 'The μ = 0 thermal state with a weak localized occupation bump near k = 0.55 μm⁻¹.',
    convention: 'n_k',
    formula: 'n_k(k) \\propto \\frac{1+0.12\\exp[-(k-0.55)^2/(2\\cdot0.10^2)]}{\\exp[(k/1.5)^2]-1}',
    values: (k) => {
      const thermal = 1 / Math.expm1((k / 1.5) ** 2);
      const bump = 1 + 0.12 * Math.exp(-0.5 * ((k - 0.55) / 0.1) ** 2);
      return thermal * bump;
    },
  }),
];

const preparedDIndex = fixturePresets.findIndex((preset) => preset.key === 'prepared_d');
export const PRESETS: Preset[] = [
  ...fixturePresets.slice(0, preparedDIndex + 1),
  preparedE,
  ...fixturePresets.slice(preparedDIndex + 1),
  measuredB,
  ...measuredC,
  ...exploratoryPresets,
];

export const DEFAULT_PRESET_KEY = 'gaussian_shell';

export function getPreset(key: string): Preset {
  return PRESETS.find((p) => p.key === key) ?? PRESETS[0];
}

/** CSV text for a preset, so the user can see and edit the expected format. */
export function presetToCsv(key: string): string {
  const spectrum = getPreset(key).load();
  const lines = [`k_um_inv,${spectrum.raw.convention}`];
  for (let i = 0; i < spectrum.raw.k_um_inv.length; i++) {
    lines.push(`${spectrum.raw.k_um_inv[i].toPrecision(8)},${spectrum.raw.values[i].toPrecision(8)}`);
  }
  return lines.join('\n');
}
