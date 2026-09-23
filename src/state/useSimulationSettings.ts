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
  /** field components N of the O(N) model */
  components: number;
  checkConvergence: boolean;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  model: 'one-loop',
  kernel: 'classical',
  accuracy: 'standard',
  stopKpFraction: 0.5,
  components: 3,
  checkConvergence: false,
};

const isSettings = (v: unknown): v is SimulationSettings =>
  isObject(v) && typeof v.model === 'string' && v.model in MODEL_BY_ID
  && (v.kernel === 'classical' || v.kernel === 'quantum')
  && ACCURACY_LEVELS.includes(v.accuracy as AccuracyLevel)
  && typeof v.stopKpFraction === 'number' && v.stopKpFraction > 0 && v.stopKpFraction < 1
  && typeof v.components === 'number' && v.components >= 1;

export function useSimulationSettings() {
  const [settings, setSettings] = useState<SimulationSettings>(() => load('settings', DEFAULT_SETTINGS, isSettings));
  useEffect(() => { save('settings', settings); }, [settings]);
  const update = (patch: Partial<SimulationSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  /** Bose +1 statistics only exist for the bare equation. */
  const effectiveKernel: KernelType = MODEL_BY_ID[settings.model].allowsQuantum ? settings.kernel : 'classical';
  return { settings, update, effectiveKernel };
}
