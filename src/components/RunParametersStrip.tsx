/** Compact, shared summary of the physical parameters used by both run surfaces. */

import React from 'react';
import { Badge } from '../ui/primitives';
import { SPECIES } from '../physics/constants';
import { MODES } from '../physics/modes';
import { expo, sig } from '../ui/theme';
import { MathBlock } from './MathBlock';
import type { DerivedPhysics, ParameterMode } from '../types/wke';

export function RunParametersStrip({
  mode, speciesKey, derived, stale, onEdit,
}: {
  mode: ParameterMode;
  speciesKey: string;
  derived: DerivedPhysics;
  stale: boolean;
  onEdit: () => void;
}) {
  const species = SPECIES[speciesKey];
  const speciesMatch = species?.symbol.match(/^(\d+)(.+)$/);
  const modeLabel = MODES.find((item) => item.id === mode)?.label ?? mode;
  const item = (label: string, value: React.ReactNode) => (
    <span className="whitespace-nowrap text-2xs text-slate-500 dark:text-slate-400">
      {label} <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </span>
  );

  return (
    <div className="card px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Run parameters</span>
      <Badge tone="neutral">{modeLabel}</Badge>
      {stale && <Badge tone="warning">run out of date</Badge>}
      {item('species =', speciesMatch
        ? <MathBlock math={`{}^{${speciesMatch[1]}}\\mathrm{${speciesMatch[2]}}`} />
        : species?.label ?? speciesKey)}
      {item('n =', derived.density_um3 != null ? `${sig(derived.density_um3)} μm⁻³` : '—')}
      {item('a =', derived.a_a0 != null ? `${sig(derived.a_a0)} a₀` : '—')}
      {item('na =', derived.na_um2 != null ? `${expo(derived.na_um2)} μm⁻²` : '—')}
      {item('N =', derived.N != null ? sig(derived.N) : '—')}
      {item('V =', derived.V_um3 != null ? `${sig(derived.V_um3)} μm³` : '—')}
      <button className="btn-secondary text-2xs py-1 ml-auto" onClick={onEdit}>
        Edit parameters
      </button>
    </div>
  );
}
