/** Model, accuracy and physical parameters of the next run. */

import { Card, Field, NumberInput, Segmented } from '../ui/primitives';
import { Tex } from '../ui/Tex';
import { fmt, time } from '../ui/format';
import { modelColor, modelDashed } from '../ui/runView';
import { MODELS } from '../physics/models';
import type { ModelId } from '../physics/models';
import { ACCURACY_LEVELS, LEVEL_EVENTS, PRECISION } from '../physics/precision';
import { INPUT_MODES } from '../physics/parameters';
import type { DerivedSystem, InputMode, SystemInputs } from '../physics/parameters';
import { SPECIES } from '../physics/constants';
import type { SimulationSettings } from '../state/useSimulationSettings';
import type { RunRecord } from '../state/useRunLibrary';

const LEVEL_HINT: Record<string, string> = {
  draft: 'Quick look. Stop times good to a few percent.',
  standard: 'Stop times within 0.05% for smooth shells, 0.5% for structured spectra.',
  high: 'Twice the grid. About 0.02% for smooth shells, 0.1% for structured spectra.',
  reference: 'Four times the grid. Slowest, and needs a few hundred MB of memory.',
};

export function SetupCard({
  settings, onSettings, inputs, derived, onInputs, lastRuns,
}: {
  settings: SimulationSettings;
  onSettings: (patch: Partial<SimulationSettings>) => void;
  inputs: SystemInputs;
  derived: DerivedSystem;
  onInputs: (patch: Partial<SystemInputs>) => void;
  /** latest compatible run per model, for the stop time next to each */
  lastRuns: Partial<Record<ModelId, RunRecord>>;
}) {
  const bare = settings.model === 'bare';
  const stopInvalid = !(settings.stopKpFraction > 0.05 && settings.stopKpFraction < 0.99);
  return (
    <Card label="Setup" ariaLabel="Model and parameters">
      <div className="models" role="group" aria-label="Kinetic model">
        {MODELS.map((m) => {
          const last = lastRuns[m.id]?.result;
          const t = time(last?.dtTarget_s ?? null);
          return (
            <button
              key={m.id}
              type="button"
              className="model"
              aria-pressed={settings.model === m.id}
              onClick={() => onSettings({ model: m.id })}
            >
              <span className={`swatch ${modelDashed(m.id, 'classical') ? 'dash' : ''}`} style={{ ['--c' as string]: modelColor(m.id) }} />
              <span className="name">{m.label}</span>
              <span className="when">{last ? (last.dtTarget_s != null ? `${t.value} ${t.unit}` : 'stopped') : ''}</span>
              <span className="desc">{m.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        {bare && (
          <Segmented
            ariaLabel="Statistics"
            value={settings.kernel}
            onChange={(kernel) => onSettings({ kernel })}
            options={[
              { id: 'classical', label: 'Classical waves', title: 'Occupations much larger than one.' },
              { id: 'quantum', label: 'Bose +1', title: 'Include spontaneous terms f → f + 1. Only for the bare equation.' },
            ]}
          />
        )}
        {!bare && <span className="hint">Loop models use classical wave statistics.</span>}
      </div>

      {settings.model === 'large-n' && (
        <div className="inputs">
          <Field label="Components N" unit="clock t → 2N t">
            <NumberInput value={settings.components} min={1} step={1}
              onChange={(v) => onSettings({ components: Math.max(1, Math.round(v ?? 1)) })} />
          </Field>
        </div>
      )}

      <div className="field accuracy-field">
        <span className="label">Accuracy</span>
        <Segmented
          ariaLabel="Accuracy"
          value={settings.accuracy}
          onChange={(accuracy) => onSettings({ accuracy })}
          options={ACCURACY_LEVELS.map((id) => ({
            id,
            label: PRECISION[id].label,
            title: `${PRECISION[id].nGrid} grid points, about ${(LEVEL_EVENTS[id] / 1e6).toFixed(1)} M collision events`,
          }))}
        />
        <span className="unit">{LEVEL_HINT[settings.accuracy]}</span>
      </div>

      <div className="inputs">
        <Field label={<>Stop at <Tex math="k_p/k_{p,0}" /></>}>
          <NumberInput value={settings.stopKpFraction} step={0.05} min={0.05} max={0.99} invalid={stopInvalid}
            onChange={(v) => onSettings({ stopKpFraction: v ?? 0.5 })} />
        </Field>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={settings.checkConvergence}
            onChange={(e) => onSettings({ checkConvergence: e.target.checked })}
            disabled={settings.accuracy === 'reference'} />
          Check convergence
        </label>
      </div>

      <hr className="divider" />

      <div className="toolbar">
        <Segmented<InputMode>
          ariaLabel="Density from"
          value={inputs.mode}
          onChange={(mode) => onInputs({ mode })}
          options={INPUT_MODES.map((m) => ({ id: m.id, label: m.label }))}
        />
      </div>

      <div className="inputs parameter-fields">
        <Field label="Species">
          <select value={inputs.speciesKey} onChange={(e) => onInputs({ speciesKey: e.target.value })}>
            {Object.entries(SPECIES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </Field>
        <Field label={<>Scattering length <Tex math="a" /></>} unit="(a₀), negative for attraction">
          <NumberInput value={inputs.a_a0} invalid={derived.a_a0 == null} onChange={(a_a0) => onInputs({ a_a0 })} />
        </Field>
        {inputs.mode !== 'density' && (
          <Field label={<>Atoms <Tex math="N" /></>}>
            <NumberInput value={inputs.N} invalid={!(inputs.N != null && inputs.N > 0)} onChange={(N) => onInputs({ N })} />
          </Field>
        )}
        {inputs.mode === 'N_V' && (
          <Field label={<>Volume <Tex math="V" /></>} unit="(μm³)">
            <NumberInput value={inputs.V_um3} invalid={!(inputs.V_um3 != null && inputs.V_um3 > 0)} onChange={(V_um3) => onInputs({ V_um3 })} />
          </Field>
        )}
        {inputs.mode === 'N_cylinder' && (
          <>
            <Field label={<>Length <Tex math="L" /></>} unit="(μm)">
              <NumberInput value={inputs.L_um} onChange={(L_um) => onInputs({ L_um })} />
            </Field>
            <Field label={<>Ratio <Tex math="R/L" /></>}>
              <NumberInput value={inputs.aspect} step={0.05} onChange={(aspect) => onInputs({ aspect })} />
            </Field>
          </>
        )}
        {inputs.mode === 'density' && (
          <Field label={<>Density <Tex math="n" /></>} unit="(μm⁻³)">
            <NumberInput value={inputs.density_um3} invalid={derived.density_um3 == null} onChange={(density_um3) => onInputs({ density_um3 })} />
          </Field>
        )}
      </div>
      {inputs.mode === 'N_cylinder' && derived.V_um3 != null && (
        <p className="hint">Cylinder volume <Tex math="V = \pi R^2 L" /> = {fmt(derived.V_um3)} μm³.</p>
      )}
      {derived.errors.length > 0 && (
        <div className="notice bad">{derived.errors.map((e) => <div key={e}>{e}</div>)}</div>
      )}
    </Card>
  );
}
