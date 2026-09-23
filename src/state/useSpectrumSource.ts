import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PRESET_KEY, PRESETS, getPreset } from '../physics/presets';
import type { PreparedSpectrum } from '../physics/spectrum';
import { computeDescriptors } from '../physics/descriptors';
import { load, save } from './storage';

export interface SpectrumSource {
  /** preset key, or null for pasted, uploaded or drawn data */
  presetKey: string | null;
  spectrum: PreparedSpectrum;
}

const isKey = (v: unknown): v is string => typeof v === 'string' && PRESETS.some((p) => p.key === v);

export function useSpectrumSource() {
  const [source, setSource] = useState<SpectrumSource>(() => {
    const key = load('preset', DEFAULT_PRESET_KEY, isKey);
    return { presetKey: key, spectrum: getPreset(key).load() };
  });
  useEffect(() => { if (source.presetKey) save('preset', source.presetKey); }, [source.presetKey]);
  const descriptors = useMemo(() => computeDescriptors(source.spectrum.k, source.spectrum.q), [source.spectrum]);
  /** Stable identity of the spectrum's content, for run bookkeeping. */
  const fingerprint = useMemo(() => {
    const q = source.spectrum.q;
    let h = 2166136261;
    for (let i = 0; i < q.length; i += 3) {
      h ^= Math.round(q[i] * 1e9) & 0xffffffff;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return `${source.presetKey ?? 'custom'}:${h.toString(36)}`;
  }, [source]);
  return {
    ...source,
    descriptors,
    fingerprint,
    selectPreset: (key: string) => setSource({ presetKey: key, spectrum: getPreset(key).load() }),
    setCustom: (spectrum: PreparedSpectrum) => setSource({ presetKey: null, spectrum }),
  };
}
