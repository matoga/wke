import { useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { SpectrumCard } from './components/SpectrumCard';
import { ResultCard } from './components/ResultCard';
import type { FrameView, ScaleSummary } from './components/ResultCard';
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
import { MODELS } from './physics/models';
import type { ModelId } from './physics/models';
import { SPECIES, BOHR_RADIUS_UM, HBAR_JS } from './physics/constants';
import { computeScales } from './physics/scales';

export default function App() {
  const system = useSystemParameters();
  const source = useSpectrumSource();
  const sim = useSimulationSettings();
  const [normMode, setNormMode] = useState<NormMode>('unit');
  const { derived, inputs } = system;
  const { settings } = sim;

  const stopValid = settings.stopKpFraction >= 0.01 && settings.stopKpFraction < 0.99;
  const runBlocker = derived.errors[0] ?? (stopValid ? null : 'The stop target must lie between 0.01 and 0.99.');

  const setup: RunSetup | null = useMemo(() => {
    if (runBlocker || derived.density_um3 == null || derived.a_a0 == null) return null;
    return {
      fingerprint: [source.fingerprint, derived.density_um3, derived.a_a0, inputs.speciesKey, settings.stopKpFraction].join('|'),
      q: Array.from(source.spectrum.q),
      density_um3: derived.density_um3,
      a_a0: derived.a_a0,
      speciesKey: inputs.speciesKey,
      stopKpFraction: settings.stopKpFraction,
    };
  }, [runBlocker, derived, source.fingerprint, source.spectrum, inputs.speciesKey, settings.stopKpFraction]);

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
    if (derived.density_um3 == null || derived.a_a0 == null) return { kXi: null, t0_s: null };
    const sc = computeScales(derived.density_um3, derived.a_a0, SPECIES[inputs.speciesKey]);
    const kXi = Math.sqrt(8 * Math.PI * derived.density_um3 * Math.abs(derived.a_a0) * BOHR_RADIUS_UM);
    return { kXi, t0_s: sc.t0_s };
  }, [derived, inputs.speciesKey]);
  const [frame, setFrame] = useState<FrameView | null>(null);

  const norm = normSpec(normMode, { atomNumber: derived.N, importedIntegral: source.spectrum.rawIntegral });

  const job = (model: ModelId): RunJob => ({
    model,
    kernel: model === 'bare' ? sim.effectiveKernel : 'classical',
    accuracy: settings.accuracy,
    checkConvergence: settings.checkConvergence,
    stopAtBreakdown: settings.stopAtBreakdown,
  });

  return (
    <div className="wrap">
      <AppHeader />

      <div className="main">
        <div className="stack">
          <div className="slot o2">
            <SpectrumCard
              onFrame={setFrame}
              record={selected}
              live={lib.live}
              stale={stale}
              spectrum={source.spectrum}
              desc={source.descriptors}
              stopKpFraction={settings.stopKpFraction}
              onStopKpFractionChange={(stopKpFraction) => sim.update({ stopKpFraction })}
              norm={norm}
              density={derived.density_um3}
              normMode={normMode}
              onNormMode={setNormMode}
              running={lib.progress.running}
              canContinue={selected != null && lib.canContinue(selected.key)}
              onContinue={() => selected && lib.continueRun(selected.key)}
            />
          </div>
          <div className="slot o3">
            <KpCompareCard
              hbarOverM_um2_per_s={SPECIES[inputs.speciesKey] ? (HBAR_JS / SPECIES[inputs.speciesKey].massKg) * 1e12 : null}
              records={compared}
              selectedKey={lib.selectedKey}
              onSelect={lib.setSelectedKey}
              stopKpFraction={settings.stopKpFraction}
              onStopKpFractionChange={(stopKpFraction) => sim.update({ stopKpFraction })}
            />
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
              frame={frame}
              canRun={setup != null}
              runBlocker={runBlocker}
              onRun={() => lib.run([job(settings.model)])}
              onRunAll={() => lib.run(MODELS.map((m) => job(m.id)))}
              onCancel={lib.stop}
              onStopAndReset={() => { lib.cancel(); lib.clear(); }}
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
            <OccupationCard records={compared} />
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
