import { useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { SpectrumCard } from './components/SpectrumCard';
import { ResultCard } from './components/ResultCard';
import type { ScaleSummary } from './components/ResultCard';
import { SetupCard } from './components/SetupCard';
import { KpCompareCard, compatibleRuns } from './components/KpCompareCard';
import { OccupationCard } from './components/OccupationCard';
import { InitialStateCard } from './components/InitialStateCard';
import { ExportCard } from './components/ExportCard';
import { MethodNotes } from './components/MethodNotes';
import { useSystemParameters } from './state/useSystemParameters';
import { useSpectrumSource } from './state/useSpectrumSource';
import { useSimulationSettings } from './state/useSimulationSettings';
import { useRunLibrary } from './state/useRunLibrary';
import type { RunJob, RunRecord, RunSetup } from './state/useRunLibrary';
import { normSpec } from './ui/norm';
import type { NormMode } from './ui/norm';
import { MODELS, clockFactor } from './physics/models';
import type { ModelId } from './physics/models';
import { SPECIES, BOHR_RADIUS_UM } from './physics/constants';
import { computeScales } from './physics/scales';
import { trapz } from './physics/grid';

export default function App() {
  const system = useSystemParameters();
  const source = useSpectrumSource();
  const sim = useSimulationSettings();
  const [normMode, setNormMode] = useState<NormMode>('unit');
  const { derived, inputs } = system;
  const { settings } = sim;

  const stopValid = settings.stopKpFraction > 0.05 && settings.stopKpFraction < 0.99;
  const runBlocker = derived.errors[0] ?? (stopValid ? null : 'The stop target must lie between 0.05 and 0.99.');

  const setup: RunSetup | null = useMemo(() => {
    if (runBlocker || derived.density_um3 == null || derived.a_a0 == null) return null;
    return {
      fingerprint: [source.fingerprint, derived.density_um3, derived.a_a0, inputs.speciesKey, settings.stopKpFraction, settings.components].join('|'),
      q: Array.from(source.spectrum.q),
      density_um3: derived.density_um3,
      a_a0: derived.a_a0,
      speciesKey: inputs.speciesKey,
      stopKpFraction: settings.stopKpFraction,
      components: settings.components,
    };
  }, [runBlocker, derived, source.fingerprint, source.spectrum, inputs.speciesKey, settings.stopKpFraction, settings.components]);

  const lib = useRunLibrary(setup);
  const compared = useMemo(() => compatibleRuns(lib.records, setup?.fingerprint ?? null), [lib.records, setup]);
  const selected: RunRecord | null = lib.selectedKey ? lib.records[lib.selectedKey] ?? null : null;
  const stale = selected != null && selected.fingerprint !== setup?.fingerprint;

  const lastRuns = useMemo(() => {
    const out: Partial<Record<ModelId, RunRecord>> = {};
    for (const rec of compared) {
      if (rec.result.kernel === 'quantum') continue;
      const prev = out[rec.result.model];
      if (!prev || rec.result.accuracy === settings.accuracy) out[rec.result.model] = rec;
    }
    return out;
  }, [compared, settings.accuracy]);

  const scales: ScaleSummary = useMemo(() => {
    if (derived.density_um3 == null || derived.a_a0 == null) return { kXi: null, eps: null, chi0: null, t0_s: null };
    const sc = computeScales(derived.density_um3, derived.a_a0, SPECIES[inputs.speciesKey]);
    const kXi = Math.sqrt(8 * Math.PI * derived.density_um3 * Math.abs(derived.a_a0) * BOHR_RADIUS_UM);
    const k = source.spectrum.k, q = source.spectrum.q;
    const invK2 = trapz(Float64Array.from(q, (v, i) => v / (k[i] * k[i])), k);
    return {
      kXi,
      eps: (kXi / source.descriptors.kp0_um_inv) ** 2,
      chi0: -4 * Math.PI * derived.density_um3 * derived.a_a0 * BOHR_RADIUS_UM * invK2,
      t0_s: sc.t0_s * clockFactor(settings.model, settings.components),
    };
  }, [derived, inputs.speciesKey, source.spectrum, source.descriptors, settings.model, settings.components]);

  const norm = normSpec(normMode, { atomNumber: derived.N, importedIntegral: source.spectrum.rawIntegral });

  const job = (model: ModelId): RunJob => ({
    model,
    kernel: model === 'bare' ? sim.effectiveKernel : 'classical',
    accuracy: settings.accuracy,
    checkConvergence: settings.checkConvergence,
  });

  return (
    <div className="wrap">
      <AppHeader norm={normMode} onNorm={setNormMode} />

      <div className="main">
        <div className="stack">
          <div className="slot o2">
            <SpectrumCard
              record={selected}
              stale={stale}
              spectrum={source.spectrum}
              norm={norm}
              running={lib.progress.running}
              canContinue={selected != null && lib.canContinue(selected.key)}
              onContinue={() => selected && lib.continueRun(selected.key)}
            />
          </div>
          <div className="slot o3">
            <KpCompareCard records={compared} selectedKey={lib.selectedKey} onSelect={lib.setSelectedKey} stopKpFraction={settings.stopKpFraction} />
          </div>
          <div className="slot o6">
            <InitialStateCard
              presetKey={source.presetKey}
              spectrum={source.spectrum}
              desc={source.descriptors}
              norm={norm}
              speciesKey={inputs.speciesKey}
              onPreset={source.selectPreset}
              onCustom={source.setCustom}
            />
          </div>
        </div>
        <div className="stack">
          <div className="slot o1">
            <ResultCard
              record={selected}
              stale={stale}
              progress={lib.progress}
              settings={settings}
              derived={derived}
              desc={source.descriptors}
              scales={scales}
              canRun={setup != null}
              runBlocker={runBlocker}
              onRun={() => lib.run([job(settings.model)])}
              onRunAll={() => lib.run(MODELS.map((m) => job(m.id)))}
              onCancel={lib.cancel}
            />
          </div>
          <div className="slot o4">
            <SetupCard
              settings={settings}
              onSettings={sim.update}
              inputs={inputs}
              derived={derived}
              onInputs={system.update}
              lastRuns={lastRuns}
            />
          </div>
          <div className="slot o5">
            <OccupationCard record={selected} records={compared} spectrum={source.spectrum} density={derived.density_um3} />
          </div>
          <div className="slot o7">
            <ExportCard spectrum={source.spectrum} atomNumber={derived.N} selected={selected} compared={compared} />
          </div>
        </div>
      </div>

      <MethodNotes />
    </div>
  );
}
