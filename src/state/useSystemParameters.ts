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
  aSign: 'repulsive',
};

/** Inputs stored before the sign control kept a signed a; split it into |a| and a sign. */
function migrate(v: SystemInputs): SystemInputs {
  if (v.aSign === 'repulsive' || v.aSign === 'attractive' || v.aSign === 'both') return v;
  const a = v.a_a0;
  return { ...v, a_a0: a == null ? a : Math.abs(a), aSign: a != null && a < 0 ? 'attractive' : 'repulsive' };
}

const isInputs = (v: unknown): v is SystemInputs =>
  isObject(v) && typeof v.mode === 'string' && ['N_V', 'N_cylinder', 'density'].includes(v.mode as string)
  && typeof v.speciesKey === 'string' && v.speciesKey in SPECIES;

export function useSystemParameters() {
  const [inputs, setInputs] = useState<SystemInputs>(() => ({ ...DEFAULT_SYSTEM, ...migrate(load('system', DEFAULT_SYSTEM, isInputs)) }));
  useEffect(() => { save('system', inputs); }, [inputs]);
  const derived = useMemo(() => deriveSystem(inputs), [inputs]);
  const update = (patch: Partial<SystemInputs>) => setInputs((prev) => {
    const next = { ...prev, ...patch };
    // a negative magnitude typed into the field means attraction
    if (patch.a_a0 != null && patch.a_a0 < 0) return { ...next, a_a0: -patch.a_a0, aSign: 'attractive' };
    return next;
  });
  return { inputs, derived, update, reset: () => setInputs(DEFAULT_SYSTEM) };
}
