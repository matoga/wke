/**
 * The two transport-time predictions side by side, or — in measured-Δt mode —
 * the inferred na and everything it identifies.
 */

import React from 'react';
import { clsx } from 'clsx';
import { Card, Metric, Badge, Callout } from '../ui/primitives';
import { COLORS, sig, expo, seconds, pct } from '../ui/theme';
import { predictDeltaT } from '../physics/calibration';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { DerivedPhysics, ParameterMode, WKEResult } from '../types/wke';

function Panel({
  label, value, sub, color, tone, status,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  tone?: 'muted';
  status?: React.ReactNode;
}) {
  return (
    <div className={clsx(
      'rounded-md border px-3 py-2.5',
      'border-slate-200 dark:border-slate-800',
      tone === 'muted' && 'opacity-60',
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />}
        <span className="text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
        {status && <span className="ml-auto normal-case tracking-normal">{status}</span>}
      </div>
      <div className="font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50 leading-tight">
        {value}
      </div>
      {sub && <div className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function ResultsCard({
  mode, desc, derived, dtMeasured_s, runs,
}: {
  mode: ParameterMode;
  desc: SpectralDescriptors | null;
  derived: DerivedPhysics;
  dtMeasured_s: number | null;
  runs: Partial<Record<'classical' | 'quantum', WKEResult>>;
}) {
  if (!desc) {
    return (
      <Card title="Transport time">
        <p className="text-2xs text-slate-500 dark:text-slate-400">Load a spectrum to evaluate the calibration.</p>
      </Card>
    );
  }

  const na = derived.na_um2;
  const dtFormula = na != null && na > 0 ? predictDeltaT(desc, na) : null;
  const dtWKE = runs.classical?.dtHalf_s ?? null;
  const dtQuantum = runs.quantum?.dtHalf_s ?? null;

  const frac = (a: number | null, b: number | null) =>
    a != null && b != null && b !== 0 ? (a - b) / b : null;

  const diffFormulaWKE = frac(dtFormula, dtWKE);
  const inverse = mode === 'measured_dt';

  return (
    <Card title={inverse ? 'Inferred interaction parameter' : 'Transport time'}>
      <div className="space-y-3">
        {desc.domainStatus !== 'inside' && (
          <Callout tone="warning" title="Calibration formula is outside its certified range">
            <ul className="list-disc space-y-0.5 pl-4">
              {desc.domainWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
            <p className="mt-1">The direct WKE simulation is unaffected by this formula limitation.</p>
          </Callout>
        )}
        {inverse ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Panel
                label="inferred na"
                color={COLORS.formula}
                value={na != null ? `${expo(na)}` : '-'}
                sub="μm⁻²"
                status={desc.domainStatus === 'inside'
                  ? <Badge tone="success">formula certified</Badge>
                  : <Badge tone="warning">formula extrapolated</Badge>}
              />
              <Panel
                label="derived n"
                value={derived.density_um3 != null ? sig(derived.density_um3) : '-'}
                sub={derived.density_um3 != null ? 'μm⁻³  (= na / a)' : 'needs a'}
                tone={derived.density_um3 == null ? 'muted' : undefined}
              />
              <Panel
                label="derived V"
                value={derived.V_um3 != null ? sig(derived.V_um3) : '-'}
                sub={derived.V_um3 != null ? 'μm³  (= N / n)' : 'needs a and N'}
                tone={derived.V_um3 == null ? 'muted' : undefined}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
              <div>
                <Metric label="measured Δt₁ᐟ₂" value={seconds(dtMeasured_s)} emphasis />
                <Metric label="A_pred = κ k_p,0² C_shape" value={expo(desc.A_pred_s_um4)} unit="s·μm⁻⁴" />
              </div>
              <div>
                <Metric
                  label="classical WKE Δt₁ᐟ₂ at inferred na"
                  value={dtWKE != null ? seconds(dtWKE) : 'not run'}
                />
                <Metric
                  label="WKE vs measured"
                  value={frac(dtWKE, dtMeasured_s) != null ? pct(frac(dtWKE, dtMeasured_s)!) : '-'}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Panel
                label="calibration formula"
                color={COLORS.formula}
                value={dtFormula != null ? seconds(dtFormula) : '-'}
                sub={<>Δt = κ k<sub>p</sub>² C<sub>shape</sub> / (na)²</>}
                status={desc.domainStatus === 'inside'
                  ? <Badge tone="success">certified</Badge>
                  : <Badge tone="warning">extrapolated</Badge>}
              />
              <Panel
                label="classical WKE"
                color={COLORS.classical}
                value={dtWKE != null ? seconds(dtWKE) : 'not run'}
                sub="direct in-browser solve"
                tone={dtWKE == null ? 'muted' : undefined}
              />
              <Panel
                label="quantum WKE"
                color={COLORS.quantum}
                value={dtQuantum != null ? seconds(dtQuantum) : derived.quantumAvailable ? 'not run' : 'needs n and a'}
                sub="Bose kernel with +1 factors"
                tone={dtQuantum == null ? 'muted' : undefined}
              />
            </div>

            {diffFormulaWKE != null && (
              <div className="flex items-baseline gap-3 px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900/60">
                <span className="text-2xs text-slate-500 dark:text-slate-400">
                  fractional difference (formula − WKE) / WKE
                </span>
                <span className={clsx(
                  'ml-auto font-mono tabular-nums text-sm font-semibold',
                  Math.abs(diffFormulaWKE) < 0.03
                    ? 'text-green-600 dark:text-green-400'
                    : Math.abs(diffFormulaWKE) < 0.10
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-red-600 dark:text-red-400',
                )}>
                  {diffFormulaWKE >= 0 ? '+' : ''}{pct(diffFormulaWKE)}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
              <div>
                <Metric label="na" value={na != null ? expo(na) : '-'} unit="μm⁻²" />
                <Metric label="A_ref = κ k_p,0²" value={expo(desc.A_ref_s_um4)} unit="s·μm⁻⁴" />
                <Metric label="A_pred = A_ref C_shape" value={expo(desc.A_pred_s_um4)} unit="s·μm⁻⁴" />
              </div>
              <div>
                <Metric label="C_shape" value={desc.c_shape.toFixed(5)} />
                <Metric label="√C_shape (na multiplier)" value={Math.sqrt(Math.max(desc.c_shape, 0)).toFixed(5)} />
                {dtQuantum != null && dtWKE != null && (
                  <Metric label="quantum vs classical" value={pct((dtQuantum - dtWKE) / dtWKE)} />
                )}
              </div>
            </div>
          </>
        )}

      </div>
    </Card>
  );
}
