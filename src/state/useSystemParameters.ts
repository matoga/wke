import { useEffect, useMemo, useState } from 'react';
import { deriveSystem } from '../physics/parameters';
import type { SystemInputs } from '../physics/parameters';
import { SPECIES } from '../physics/constants';
import { isObject, load, save } from './storage';

export const DEFAULT_SYSTEM: SystemInputs = {
  mode: 'N_V',
  speciesKey: 'K39',
  N: 250000,
  V_um3: 88243,
  L_um: 48.3,
  aspect: 0.5,
  density_um3: 2.8331,
  a_a0: 25,
};

const isInputs = (v: unknown): v is SystemInputs =>
  isObject(v) && typeof v.mode === 'string' && ['N_V', 'N_cylinder', 'density'].includes(v.mode as string)
  && typeof v.speciesKey === 'string' && v.speciesKey in SPECIES;

export function useSystemParameters() {
  const [inputs, setInputs] = useState<SystemInputs>(() => ({ ...DEFAULT_SYSTEM, ...load('system', DEFAULT_SYSTEM, isInputs) }));
  useEffect(() => { save('system', inputs); }, [inputs]);
  const derived = useMemo(() => deriveSystem(inputs), [inputs]);
  const update = (patch: Partial<SystemInputs>) => setInputs((prev) => ({ ...prev, ...patch }));
  return { inputs, derived, update, reset: () => setInputs(DEFAULT_SYSTEM) };
}
