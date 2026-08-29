/** System parameters: mode selector, species, inputs, and the derived quantities. */

import React, { useState } from 'react';
import { Card, Field, Metric, NumberInput, Callout, SegmentedControl } from '../ui/primitives';
import { sig, expo, seconds, parseNum } from '../ui/theme';
import { MODES } from '../physics/modes';
import { SPECIES, DEFAULT_SPECIES_KEY, BOHR_RADIUS_UM } from '../physics/constants';
import { inferNA } from '../physics/calibration';
import { useShootingRefine } from '../hooks/useShootingRefine';
import type { DerivedPhysics, ParameterMode, PhysicsInputs } from '../types/wke';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { PreparedSpectrum } from '../physics/spectrum';

export interface ParameterFields {
  N: string;
  V_um3: string;
  density_um3: string;
  a_a0: string;
  dt_measured_s: string;
}

export function toInputs(
  mode: ParameterMode,
  speciesKey: string,
  f: ParameterFields,
): PhysicsInputs {
  return {
    mode,
    speciesKey,
    N: parseNum(f.N),
    V_um3: parseNum(f.V_um3),
    density_um3: parseNum(f.density_um3),
    a_a0: parseNum(f.a_a0),
    dt_measured_s: parseNum(f.dt_measured_s),
  };
}

export function ParametersCard({
  mode, onMode, speciesKey, onSpecies, fields, onFields, derived, desc, spectrum,
}: {
  mode: ParameterMode;
  onMode: (m: ParameterMode) => void;
  speciesKey: string;
  onSpecies: (k: string) => void;
  fields: ParameterFields;
  onFields: (f: ParameterFields) => void;
  derived: DerivedPhysics;
  desc: SpectralDescriptors | null;
  spectrum: PreparedSpectrum | null;
}) {
  const set = (k: keyof ParameterFields) => (v: string) => onFields({ ...fields, [k]: v });
  const blurb = MODES.find((m) => m.id === mode)!.blurb;
  const nonDefaultSpecies = speciesKey !== DEFAULT_SPECIES_KEY;

  const [volumeInput, setVolumeInput] = useState<'direct' | 'cylinder'>('direct');
  const [cylinderL, setCylinderL] = useState('300');
  const [cylinderRatio, setCylinderRatio] = useState('0.5');
  const cylL = parseNum(cylinderL);
  const cylRho = parseNum(cylinderRatio);
  const cylR = cylL != null && cylRho != null ? cylRho * cylL : null;
  const cylV = cylR != null && cylL != null ? Math.PI * cylR * cylR * cylL : null;

  const shoot = useShootingRefine();
  const [shootResult, setShootResult] = useState<{ na: number; dt: number; converged: boolean } | null>(null);
  const formulaNa = desc && fields.dt_measured_s
    ? (() => { const dt = parseNum(fields.dt_measured_s); return dt != null && dt > 0 ? inferNA(desc, dt) : null; })()
    : null;

  React.useEffect(() => {
    if (mode !== 'known_NVa' || volumeInput !== 'cylinder' || cylV == null) return;
    const current = parseNum(fields.V_um3);
    if (current == null || Math.abs(current / cylV - 1) > 1e-9) {
      onFields({ ...fields, V_um3: cylV.toPrecision(8) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, volumeInput, cylV]);

  const runRefine = async () => {
    if (!desc || !spectrum || formulaNa == null) return;
    setShootResult(null);
    try {
      const dtTarget = parseNum(fields.dt_measured_s)!;
      const r = await shoot.refine(Array.from(spectrum.q), formulaNa, dtTarget, speciesKey);
      setShootResult({ na: r.na_um2, dt: r.dtWKE_s, converged: r.converged });
    } catch {
      // surfaced via shoot.error
    }
  };

  return (
    <Card title="System parameters" subtitle={blurb}>
      <div className="space-y-3">
        <SegmentedControl
          className="w-full"
          value={mode}
          onChange={onMode}
          options={MODES.map((m) => ({ id: m.id, label: m.label, title: m.blurb }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Species">
            <select className="select" value={speciesKey} onChange={(e) => onSpecies(e.target.value)}>
              {Object.entries(SPECIES).map(([k, s]) => (
                <option key={k} value={k}>{s.label} · {s.massAmu.toFixed(4)} u</option>
              ))}
            </select>
          </Field>

          {mode === 'known_NVa' && (
            <>
              <Field label="Atom number N" unit="atoms">
                <NumberInput value={fields.N} onChange={set('N')} placeholder="e.g. 1.0e5" min={0} />
              </Field>

              {volumeInput === 'direct' ? (
                <Field
                  label={<span className="flex items-center justify-between gap-2">Volume V
                    <button type="button" className="text-2xs text-accent-600 dark:text-accent-400 font-normal hover:underline"
                      onClick={() => setVolumeInput('cylinder')}>from R, L →</button>
                  </span>}
                  unit="μm³"
                >
                  <NumberInput value={fields.V_um3} onChange={set('V_um3')} placeholder="e.g. 3.5e4" min={0} />
                </Field>
              ) : (
                <div className="col-span-1">
                  <span className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-2xs font-medium text-slate-600 dark:text-slate-300">Cylinder geometry</span>
                    <button type="button" className="text-2xs text-accent-600 dark:text-accent-400 font-normal hover:underline"
                      onClick={() => setVolumeInput('direct')}>enter V directly →</button>
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-3xs text-slate-500 dark:text-slate-400">length L (μm)</span>
                      <NumberInput value={cylinderL} onChange={setCylinderL} placeholder="300" min={0} />
                    </div>
                    <div>
                      <span className="text-3xs text-slate-500 dark:text-slate-400">ratio R/L</span>
                      <NumberInput value={cylinderRatio} onChange={setCylinderRatio} placeholder="0.5" min={0} step={0.05} />
                    </div>
                  </div>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 mt-1">
                    V = πR²L{cylR != null && <> · R = {sig(cylR, 4)} μm · V = {sig(cylV ?? 0, 4)} μm³</>}
                  </p>
                </div>
              )}

              <Field label="Scattering length a" unit="a₀">
                <NumberInput value={fields.a_a0} onChange={set('a_a0')} placeholder="50" />
              </Field>
            </>
          )}

          {mode === 'known_na' && (
            <>
              <Field label="Density n" unit="μm⁻³">
                <NumberInput value={fields.density_um3} onChange={set('density_um3')} placeholder="2.8331" min={0} />
              </Field>
              <Field label="Scattering length a" unit="a₀">
                <NumberInput value={fields.a_a0} onChange={set('a_a0')} placeholder="50" />
              </Field>
            </>
          )}

          {mode === 'measured_dt' && (
            <>
              <Field label="Measured Δt₁ᐟ₂" unit="s">
                <NumberInput value={fields.dt_measured_s} onChange={set('dt_measured_s')} placeholder="0.313" min={0} />
              </Field>
              <Field label="Scattering length a" unit="a₀">
                <NumberInput value={fields.a_a0} onChange={set('a_a0')} placeholder="Required for volume" />
              </Field>
              <Field label="Atom number N" unit="atoms">
                <NumberInput value={fields.N} onChange={set('N')} placeholder="Required for volume" min={0} />
              </Field>
            </>
          )}
        </div>

        {mode === 'measured_dt' && formulaNa != null && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs font-medium text-slate-700 dark:text-slate-200">
                Refine na against the direct simulation
              </span>
              <button
                className="btn-secondary text-2xs py-1"
                onClick={runRefine}
                disabled={shoot.running}
              >
                {shoot.running ? `Running · ${shoot.steps.length}/6` : 'Refine with simulation'}
              </button>
            </div>
            <p className="text-3xs text-slate-600 dark:text-slate-300">Match the direct WKE result to the measured half-time.</p>
            {shoot.steps.length > 0 && (
              <div className="font-mono text-3xs text-slate-500 dark:text-slate-400 space-y-0.5">
                {shoot.steps.map((s) => (
                  <div key={s.iteration} className="flex justify-between">
                    <span>iter {s.iteration}</span>
                    <span>na = {expo(s.na_um2, 5)} μm⁻²</span>
                    <span>Δt_WKE = {seconds(s.dtWKE_s)}</span>
                  </div>
                ))}
              </div>
            )}
            {shoot.error && <Callout tone="danger">{shoot.error}</Callout>}
            {shootResult && (
              <div className="grid grid-cols-2 gap-x-5 pt-1 border-t border-slate-100 dark:border-slate-800">
                <Metric label="formula na" value={expo(formulaNa)} unit="μm⁻²" />
                <Metric label="simulation-refined na" value={expo(shootResult.na)} unit="μm⁻²" emphasis />
                <Metric label="shift" value={`${((shootResult.na / formulaNa - 1) * 100).toFixed(2)}%`} />
                <Metric label="status" value={shootResult.converged ? 'converged' : `stopped after ${shoot.steps.length} iterations`} />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 pt-1 border-t border-slate-100 dark:border-slate-800">
          <div>
            <Metric label="n" value={derived.density_um3 != null ? sig(derived.density_um3) : '-'} unit="μm⁻³"
              emphasis={mode === 'measured_dt' && derived.density_um3 != null} />
            <Metric label="a" value={derived.a_a0 != null ? sig(derived.a_a0) : '-'} unit="a₀" />
            <Metric label="a" value={derived.a_a0 != null ? expo(derived.a_a0 * BOHR_RADIUS_UM) : '-'} unit="μm"
              title="a₀ = 5.291772109×10⁻⁵ μm" />
          </div>
          <div>
            <Metric label="na" value={derived.na_um2 != null ? expo(derived.na_um2) : '-'} unit="μm⁻²"
              emphasis={mode === 'measured_dt'} />
            <Metric label="V" value={derived.V_um3 != null ? sig(derived.V_um3) : '-'} unit="μm³"
              emphasis={mode === 'measured_dt' && derived.V_um3 != null} />
            <Metric label="N" value={derived.N != null ? sig(derived.N) : '-'} unit="atoms" />
          </div>
        </div>

        {derived.notes.length > 0 && (
          <Callout tone="info">
            <ul className="list-disc pl-4 space-y-0.5">
              {derived.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </Callout>
        )}

        {nonDefaultSpecies && (
          <Callout tone="warning" title="κ was calibrated for ³⁹K">
            The WKE time unit is t₀ = m / (4πℏ·na), so Δt₁ᐟ₂ scales with the atomic mass, but the
            calibration constant κ carries no mass factor. For {SPECIES[speciesKey].label} the
            simulation and the formula will differ by roughly the mass ratio
            {' '}{(SPECIES[speciesKey].massAmu / SPECIES[DEFAULT_SPECIES_KEY].massAmu).toFixed(3)}.
          </Callout>
        )}
      </div>
    </Card>
  );
}
