/** Model, accuracy and physical parameters of the next run. */

import { Card, Field, NumberInput, Segmented } from '../ui/primitives';
import { Tex } from '../ui/Tex';
import { fmt, time } from '../ui/format';
import { modelColor, modelDashed } from '../ui/runView';
import { MODELS, MODEL_BY_ID } from '../physics/models';
import type { ModelId } from '../physics/models';
import { ACCURACY_LEVELS, LEVEL_EVENTS, PRECISION } from '../physics/precision';
import { A_SIGNS, INPUT_MODES } from '../physics/parameters';
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

/** A stop time as "182 ms", or "stopped" when the run ended before its target. */
function stopText(rec: RunRecord | undefined): string {
  if (!rec) return '';
  const r = rec.result;
  if (r.dtTarget_s == null) return 'stopped';
  const t = time(r.dtTarget_s);
  return `${t.value} ${t.unit}`;
}

export function SetupCard({
  settings, onSettings, inputs, derived, onInputs, lastRuns, pair,
}: {
  settings: SimulationSettings;
  onSettings: (patch: Partial<SimulationSettings>) => void;
  inputs: SystemInputs;
  derived: DerivedSystem;
  onInputs: (patch: Partial<SystemInputs>) => void;
  /** latest compatible run per model and sign of a, for the stop times next to each */
  lastRuns: Partial<Record<ModelId, { plus?: RunRecord; minus?: RunRecord }>>;
  /** both signs of a are run */
  pair: boolean;
}) {
  const bare = settings.model === 'bare';
  const quantumOk = MODEL_BY_ID[settings.model].allowsQuantum;
  const stopInvalid = !(settings.stopKpFraction >= 0.01 && settings.stopKpFraction < 0.99);
  const shown = visibleModels(settings.showHeuristics);
  const hidden = MODELS.length - shown.length;
  return (
    <Card label="Setup" ariaLabel="Model and parameters">
      <div className="subhead"><span className="label">Gas</span></div>
      <div className="gas">
        <div className="gas-row">
          <Field label="Species">
            <select value={inputs.speciesKey} onChange={(e) => onInputs({ speciesKey: e.target.value })}>
              {Object.entries(SPECIES).map(([k, sp]) => <option key={k} value={k}>{sp.label}</option>)}
            </select>
          </Field>
          <div className="field">
            <span className="label">Density from</span>
            <Segmented<InputMode>
              ariaLabel="Density from"
              value={inputs.mode}
              onChange={(mode) => onInputs({ mode })}
              options={INPUT_MODES.map((m) => ({ id: m.id, label: m.label }))}
            />
          </div>
        </div>

        <div className="field a-field">
          <span className="label">Scattering length <Tex math="|a|" /> <span className="u">(a₀)</span></span>
          <div className="a-group">
            <NumberInput value={inputs.a_a0} invalid={derived.a_a0 == null} onChange={(a_a0) => onInputs({ a_a0 })} ariaLabel="Scattering length |a| (a₀)" />
            <Segmented ariaLabel="Sign of the scattering length" value={inputs.aSign} onChange={(aSign) => onInputs({ aSign })}
              options={A_SIGNS.map((sg) => ({ id: sg.id, label: sg.label, title: sg.title }))} />
          </div>
        </div>

        <div className="gas-fields">
          {inputs.mode !== 'density' && (
            <Field label={<>Atoms <Tex math="N" /></>}>
              <NumberInput value={inputs.N} invalid={!(inputs.N != null && inputs.N > 0)} onChange={(N) => onInputs({ N })} />
            </Field>
          )}
          {inputs.mode === 'N_V' && (
            <Field label={<>Volume <Tex math="V" /> <span className="u">(μm³)</span></>}>
              <NumberInput value={inputs.V_um3} invalid={!(inputs.V_um3 != null && inputs.V_um3 > 0)} onChange={(V_um3) => onInputs({ V_um3 })} />
            </Field>
          )}
          {inputs.mode === 'N_cylinder' && (
            <>
              <Field label={<>Length <Tex math="L" /> <span className="u">(μm)</span></>}>
                <NumberInput value={inputs.L_um} onChange={(L_um) => onInputs({ L_um })} />
              </Field>
              <Field label={<>Ratio <Tex math="R/L" /></>}>
                <NumberInput value={inputs.aspect} step={0.05} onChange={(aspect) => onInputs({ aspect })} />
              </Field>
            </>
          )}
          {inputs.mode === 'density' && (
            <Field label={<>Density <Tex math="n" /> <span className="u">(μm⁻³)</span></>}>
              <NumberInput value={inputs.density_um3} invalid={derived.density_um3 == null} onChange={(density_um3) => onInputs({ density_um3 })} />
            </Field>
          )}
        </div>
        {inputs.mode === 'N_cylinder' && derived.V_um3 != null && (
          <p className="hint">Cylinder volume <Tex math="V = \pi R^2 L" /> = {fmt(derived.V_um3)} μm³.</p>
        )}
        {pair && (
          <p className="hint">
            Runs <Tex math="+|a|" /> and <Tex math="-|a|" /> side by side from the same initial state, grid and settings. The
            bare equation is even in <Tex math="a" /> and runs once.
          </p>
        )}
        {derived.errors.length > 0 && (
          <div className="notice bad">{derived.errors.map((e) => <div key={e}>{e}</div>)}</div>
        )}
      </div>

      <hr className="divider" />

      <div className="subhead">
        <span className="label">Model</span>
        <label className="check small" title="Heuristic models are ansätze with a fitted or guessed resummation, not controlled approximations.">
          <input type="checkbox" checked={settings.showHeuristics}
            onChange={(e) => onSettings({ showHeuristics: e.target.checked })} />
          Show heuristic models{!settings.showHeuristics && hidden > 0 ? ` (${hidden})` : ''}
        </label>
      </div>
      <div className="models" role="group" aria-label="Kinetic model">
        {shown.map((m) => {
          const last = lastRuns[m.id];
          const one = derived.signs[0] > 0 ? last?.plus : last?.minus;
          const when = pair
            ? (last?.plus || last?.minus ? `${stopText(last.plus) || 'n/a'} | ${stopText(last.minus) || 'n/a'}` : '')
            : stopText(one);
          return (
            <button
              key={m.id}
              type="button"
              className="model"
              aria-pressed={settings.model === m.id}
              onClick={() => onSettings({ model: m.id })}
            >
              <span className={`swatch ${modelDashed(m.id, 'classical') ? 'dash' : ''}`} style={{ ['--c' as string]: modelColor(m.id) }} />
              <span className="name">
                {m.label}
                {m.pill && <span className="pill warn" title={m.pill.title}>{m.pill.text}</span>}
              </span>
              <span className="when" title={pair && when ? 'Stop times at +a | −a' : undefined}>{when}</span>
              <span className="desc">{m.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        {quantumOk && (
          <Segmented
            ariaLabel="Statistics"
            value={settings.kernel}
            onChange={(kernel) => onSettings({ kernel })}
            options={[
              { id: 'classical', label: 'Classical waves', title: 'Occupations much larger than one.' },
              { id: 'quantum', label: 'Bose +1', title: 'Include spontaneous terms f → f + 1. Bare equation and exchange-chain models.' },
            ]}
          />
        )}
        {!quantumOk && <span className="hint">This model uses classical wave statistics.</span>}
      </div>

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
          <NumberInput value={settings.stopKpFraction} step={0.05} min={0.01} max={0.99} invalid={stopInvalid}
            onChange={(v) => onSettings({ stopKpFraction: v ?? 0.5 })} />
        </Field>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={settings.checkConvergence}
            onChange={(e) => onSettings({ checkConvergence: e.target.checked })}
            disabled={settings.accuracy === 'reference'} />
          Check convergence
        </label>
      </div>
      {!bare && (
        <label className="check" title="Stop a one-loop run when its bracket turns negative, or a resummed run when its vertex nears a pole. Off: keep integrating and flag the moment the model breaks down.">
          <input type="checkbox" checked={settings.stopAtBreakdown}
            onChange={(e) => onSettings({ stopAtBreakdown: e.target.checked })} />
          Stop at model breakdown
        </label>
      )}
    </Card>
  );
}

/** The models listed: the heuristic ones only when asked for. */
export function visibleModels(showHeuristics: boolean) {
  return MODELS.filter((m) => showHeuristics || !m.heuristic);
}
