import { useEffect, useState } from 'react';
import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import { MODEL_BY_ID } from '../physics/models';
import type { AccuracyLevel } from '../physics/precision';
import { ACCURACY_LEVELS } from '../physics/precision';
import { isObject, load, save } from './storage';

export interface SimulationSettings {
  model: ModelId;
  kernel: KernelType;
  accuracy: AccuracyLevel;
  stopKpFraction: number;
  checkConvergence: boolean;
  /** stop runs when the model leaves its range of validity */
  stopAtBreakdown: boolean;
  /** list the heuristic models too */
  showHeuristics: boolean;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  model: 'one-loop',
  kernel: 'classical',
  accuracy: 'standard',
  stopKpFraction: 0.5,
  checkConvergence: false,
  stopAtBreakdown: false,
  showHeuristics: false,
};

/** Model ids renamed after a setting may have been stored. */
const RENAMED_MODELS: Record<string, ModelId> = { heuristic: 'heuristic-b' };

const isSettings = (v: unknown): v is SimulationSettings => {
  if (isObject(v) && typeof v.model === 'string' && v.model in RENAMED_MODELS) v.model = RENAMED_MODELS[v.model];
  return isCurrentSettings(v);
};

const isCurrentSettings = (v: unknown): v is SimulationSettings =>
  isObject(v) && typeof v.model === 'string' && v.model in MODEL_BY_ID
  && (v.kernel === 'classical' || v.kernel === 'quantum')
  && ACCURACY_LEVELS.includes(v.accuracy as AccuracyLevel)
  && typeof v.stopKpFraction === 'number' && v.stopKpFraction > 0 && v.stopKpFraction < 1;

export function useSimulationSettings() {
  const [settings, setSettings] = useState<SimulationSettings>(() => {
    const stored = load('settings', DEFAULT_SETTINGS, isSettings);
    // a heuristic model chosen before the list could hide them stays visible
    const showHeuristics = stored.showHeuristics ?? MODEL_BY_ID[stored.model].heuristic;
    return { ...DEFAULT_SETTINGS, ...stored, showHeuristics };
  });
  useEffect(() => { save('settings', settings); }, [settings]);
  const update = (patch: Partial<SimulationSettings>) => setSettings((prev) => {
    const next = { ...prev, ...patch };
    // hiding the heuristics while one is selected falls back to the bubble chain
    if (!next.showHeuristics && MODEL_BY_ID[next.model].heuristic) next.model = 'chain';
    return next;
  });
  /** Bose +1 statistics exist for the bare equation and the exchange-chain models. */
  const effectiveKernel: KernelType = MODEL_BY_ID[settings.model].allowsQuantum ? settings.kernel : 'classical';
  return { settings, update, effectiveKernel };
}
