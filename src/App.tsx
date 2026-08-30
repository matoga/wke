import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { InitialStateCard } from './components/InitialStateCard';
import { ParametersCard, toInputs } from './components/ParametersCard';
import type { ParameterFields } from './components/ParametersCard';
import { ResultsCard } from './components/ResultsCard';
import { SensitivityCard } from './components/SensitivityCard';
import type { SliderState } from './components/SensitivityCard';
import { CalibrationMapCard } from './components/CalibrationMapCard';
import { SimulationPanel } from './components/SimulationPanel';
import { PlaygroundCard } from './components/PlaygroundCard';
import type { RunMode } from './components/SimulationPanel';
import type { KernelType } from './physics/collision';
import { ExportPanel } from './components/ExportPanel';
import { SpectrumSummaryStrip } from './components/SpectrumSummaryStrip';
import { RunParametersStrip } from './components/RunParametersStrip';
import { MathBlock } from './components/MathBlock';
import { useWKEWorker } from './hooks/useWKEWorker';
import { computeDescriptors } from './physics/descriptors';
import { derivePhysics, classicalRunParameters } from './physics/modes';
import { predictDeltaT } from './physics/calibration';
import { getPreset, DEFAULT_PRESET_KEY } from './physics/presets';
import {
  DEFAULT_SPECIES_KEY, REFERENCE_DENSITY_UM3, REFERENCE_A_A0,
} from './physics/constants';
import type { PreparedSpectrum } from './physics/spectrum';
import type { ParameterMode, RunProvenance } from './types/wke';
import { NORM_MODES, normSpec } from './ui/norm';
import type { NormMode } from './ui/norm';
import { Badge, SegmentedControl } from './ui/primitives';

type Tab = 'play' | 'simulate' | 'calibrate' | 'export';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'play', label: 'Playground' },
  { id: 'simulate', label: 'Solver' },
  { id: 'calibrate', label: 'Calibrate volume' },
  { id: 'export', label: 'Export' },
];

const EMPTY_FIELDS: ParameterFields = {
  N: '', V_um3: '', density_um3: '', a_a0: '', dt_measured_s: '', na_override_um2: '',
};

const DEFAULT_FIELDS: Record<ParameterMode, ParameterFields> = {
  known_NVa: { ...EMPTY_FIELDS, N: '1e5', V_um3: '35296', a_a0: String(REFERENCE_A_A0) },
  known_na: { ...EMPTY_FIELDS, density_um3: String(REFERENCE_DENSITY_UM3), a_a0: String(REFERENCE_A_A0) },
  measured_dt: { ...EMPTY_FIELDS, N: '1e5', dt_measured_s: '0.313', a_a0: String(REFERENCE_A_A0) },
};

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function App() {
  const { dark, toggle } = useDarkMode();

  const [presetKey, setPresetKey] = useState<string | null>(DEFAULT_PRESET_KEY);
  const [spectrum, setSpectrum] = useState<PreparedSpectrum | null>(
    () => getPreset(DEFAULT_PRESET_KEY).load(),
  );

  const [mode, setMode] = useState<ParameterMode>('measured_dt');
  const [speciesKey, setSpeciesKey] = useState(DEFAULT_SPECIES_KEY);
  const [fieldsByMode, setFieldsByMode] = useState(DEFAULT_FIELDS);
  const fields = fieldsByMode[mode];

  const [tab, setTab] = useState<Tab>('simulate');
  const [initialDraftDirty, setInitialDraftDirty] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>('classical');
  const [playKernel, setPlayKernel] = useState<KernelType>('classical');
  const [normMode, setNormMode] = useState<NormMode>('unit');
  const solver = useWKEWorker();
  const preview = useWKEWorker();

  const desc = useMemo(
    () => (spectrum ? computeDescriptors(spectrum.k, spectrum.q) : null),
    [spectrum],
  );

  const inputs = useMemo(() => toInputs(mode, speciesKey, fields), [mode, speciesKey, fields]);
  const derived = useMemo(() => derivePhysics(inputs, desc), [inputs, desc]);

  // A completed trajectory is only current for the exact spectrum and physical
  // configuration that produced it. Keep old results visible for comparison,
  // but never present them as though they match edited inputs.
  const runFingerprint = useMemo(() => JSON.stringify({
    spectrum: spectrum ? Array.from(spectrum.q) : null,
    mode,
    speciesKey,
    density_um3: derived.density_um3,
    a_a0: derived.a_a0,
    na_um2: derived.na_um2,
    N: derived.N,
    V_um3: derived.V_um3,
  }), [spectrum, mode, speciesKey, derived]);
  const [lastSolverFingerprint, setLastSolverFingerprint] = useState<string | null>(null);
  const [lastPreviewFingerprint, setLastPreviewFingerprint] = useState<string | null>(null);
  const [solverProvenance, setSolverProvenance] = useState<RunProvenance | null>(null);
  const solverIsStale = Object.keys(solver.runs).length > 0 && lastSolverFingerprint !== runFingerprint;
  const previewIsStale = Object.keys(preview.runs).length > 0 && lastPreviewFingerprint !== runFingerprint;

  useEffect(() => {
    if (solver.state.running && lastSolverFingerprint != null && lastSolverFingerprint !== runFingerprint) {
      solver.cancel();
    }
    if (preview.state.running && lastPreviewFingerprint != null && lastPreviewFingerprint !== runFingerprint) {
      preview.cancel();
    }
  }, [runFingerprint, lastSolverFingerprint, lastPreviewFingerprint, solver.state.running, preview.state.running, solver.cancel, preview.cancel]);

  // One display convention for every spectrum plot in the app.
  const norm = useMemo(
    () => normSpec(normMode, {
      atomNumber: derived.N,
      importedIntegral: spectrum?.rawIntegral ?? null,
    }),
    [normMode, derived.N, spectrum],
  );

  // Sliders start from whatever the entered parameters imply.
  const sliderBase: SliderState & { dt_measured_s: number | null } = useMemo(() => ({
    a_a0: derived.a_a0 ?? REFERENCE_A_A0,
    density_um3: derived.density_um3 ?? REFERENCE_DENSITY_UM3,
    dtScale: 1,
    dt_measured_s: inputs.dt_measured_s,
  }), [derived.a_a0, derived.density_um3, inputs.dt_measured_s]);

  const [sliders, setSliders] = useState<SliderState>(sliderBase);
  useEffect(() => { setSliders(sliderBase); }, [sliderBase]);

  const slidersDirty =
    Math.abs(sliders.a_a0 / sliderBase.a_a0 - 1) > 1e-9 ||
    Math.abs(sliders.density_um3 / sliderBase.density_um3 - 1) > 1e-9 ||
    Math.abs(sliders.dtScale - 1) > 1e-9;

  const applySensitivityToRun = useCallback(() => {
    setFieldsByMode((current) => {
      const active = current[mode];
      if (mode === 'known_na') {
        return {
          ...current,
          [mode]: {
            ...active,
            density_um3: sliders.density_um3.toPrecision(10),
            a_a0: sliders.a_a0.toPrecision(10),
          },
        };
      }
      if (mode === 'known_NVa') {
        const N = Number(active.N);
        const V = Number.isFinite(N) && N > 0 && sliders.density_um3 > 0
          ? N / sliders.density_um3
          : null;
        return {
          ...current,
          [mode]: {
            ...active,
            V_um3: V != null ? V.toPrecision(10) : active.V_um3,
            a_a0: sliders.a_a0.toPrecision(10),
          },
        };
      }
      const dt = inputs.dt_measured_s != null
        ? inputs.dt_measured_s * sliders.dtScale
        : null;
      return {
        ...current,
        [mode]: {
          ...active,
          dt_measured_s: dt != null ? dt.toPrecision(10) : active.dt_measured_s,
          a_a0: sliders.a_a0.toPrecision(10),
        },
      };
    });
  }, [mode, sliders, inputs.dt_measured_s]);

  const onSpectrum = useCallback((s: PreparedSpectrum, key: string | null) => {
    setSpectrum(s);
    setPresetKey(key);
    setFieldsByMode((current) => ({
      ...current,
      measured_dt: { ...current.measured_dt, na_override_um2: '' },
    }));
  }, []);

  const changeSpecies = useCallback((key: string) => {
    setSpeciesKey(key);
    setFieldsByMode((current) => ({
      ...current,
      measured_dt: { ...current.measured_dt, na_override_um2: '' },
    }));
  }, []);

  const dtFormula = desc && derived.na_um2 ? predictDeltaT(desc, derived.na_um2) : null;
  const dtForMap = mode === 'measured_dt'
    ? inputs.dt_measured_s
    : (!solverIsStale ? solver.runs.classical?.dtHalf_s : null) ?? dtFormula;

  // Run configuration
  const runParams = classicalRunParameters(derived, REFERENCE_DENSITY_UM3);
  const wantQuantum = runMode !== 'classical';
  const kernels = runMode === 'both'
    ? (['classical', 'quantum'] as const)
    : ([runMode] as const);

  const baseBlockedReason = derived.notes[0] ?? (initialDraftDirty
    ? 'Apply or cancel the spectrum draft before running.'
    : !spectrum
    ? 'Load a spectrum first.'
    : derived.na_um2 == null
      ? 'Complete the parameters above to identify na.'
      : null);
  const blockedReason = baseBlockedReason ?? (wantQuantum && !derived.quantumAvailable
    ? 'The quantum kernel needs n and a separately.'
    : null);
  const playBlockedReason = baseBlockedReason ?? (playKernel === 'quantum' && !derived.quantumAvailable
    ? 'The quantum kernel needs n and a separately.'
    : null);

  const startRun = () => {
    if (!spectrum || !runParams || blockedReason) return;
    // The quantum kernel needs the true (n, a); the classical one only na.
    const useTrue = wantQuantum && derived.density_um3 != null && derived.a_a0 != null;
    setLastSolverFingerprint(runFingerprint);
    setSolverProvenance({
      origin: 'solver', spectrumLabel: spectrum.raw.label, mode, speciesKey,
      density_um3: derived.density_um3, a_a0: derived.a_a0, na_um2: derived.na_um2,
      N: derived.N, V_um3: derived.V_um3, tauMax: 400, rtol: 1e-7, nSnapshots: 150,
    });
    solver.run({
      kernels: [...kernels],
      q: Array.from(spectrum.q),
      density_um3: useTrue ? derived.density_um3! : runParams.density_um3,
      a_a0: useTrue ? derived.a_a0! : runParams.a_a0,
      speciesKey,
      tauMax: 400,
      rtol: 1e-7,
      nSnapshots: 150,
    });
  };

  const startPlayRun = () => {
    if (!spectrum || !runParams || playBlockedReason) return;
    const useTrue = derived.density_um3 != null && derived.a_a0 != null;
    setLastPreviewFingerprint(runFingerprint);
    preview.run({
      kernels: [playKernel],
      q: Array.from(spectrum.q),
      density_um3: useTrue ? derived.density_um3! : runParams.density_um3,
      a_a0: useTrue ? derived.a_a0! : runParams.a_a0,
      speciesKey,
      // The Play surface samples roughly 150 frames before the first
      // half-peak checkpoint, then keeps this cadence on every continuation.
      tauMax: 40,
      rtol: 1e-9,
      nSnapshots: 150,
    });
  };

  const quantumBlockedReason = 'Quantum mode requires n and a.';

  const selectTab = (next: Tab) => {
    if (tab === 'play' && next !== 'play' && preview.state.running) preview.cancel();
    setTab(next);
  };

  /* const formulaReference = (
    <footer className={clsx(
      'card p-4 text-2xs leading-relaxed h-fit space-y-3',
      'text-slate-600 dark:text-slate-300',
    )}>
      <div className="font-semibold text-xs text-slate-800 dark:text-slate-100">
        Calibration model &amp; equations
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 p-3 bg-slate-50 dark:bg-gray-950/60 rounded-lg border border-slate-200/60 dark:border-slate-800 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
            <MathBlock math="A_{\mathrm{ref}} = \kappa\, k_{p,0}^2" />
            <span className="text-3xs text-slate-400 font-mono">[A_ref] = s·μm⁻⁴</span>
          </div>
          <div className="py-0.5">
            <MathBlock math="\delta_k = \frac{\langle k \rangle - k_{p,0}}{k_{p,0}}" />
          </div>
          <div className="py-0.5">
            <MathBlock math="w = \frac{\mathrm{FWHM}}{k_{p,0}}" />
          </div>
          <div className="py-0.5">
            <MathBlock math={`C_{\\mathrm{shape}} = ${C0} ${C1 >= 0 ? '+' : '-'} ${Math.abs(C1)}\\,\\delta_k ${C2 >= 0 ? '+' : '-'} ${Math.abs(C2)}\\,w`} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
            <MathBlock math="na = \sqrt{\frac{\kappa\, k_{p,0}^2\, C_{\mathrm{shape}}}{\Delta t_{1/2}}}" />
            <span className="text-3xs text-slate-400 font-mono">[na] = μm⁻²</span>
          </div>
          <div className="py-0.5">
            <MathBlock math="\Delta t_{1/2} = \frac{\kappa\, k_{p,0}^2\, C_{\mathrm{shape}}}{(na)^2}" />
          </div>
        </div>
        <div className="flex flex-col justify-between space-y-3">
          <div>
            <div className="text-3xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
              Constants (copyable)
            </div>
            <pre className="font-mono text-3xs sm:text-2xs p-2.5 bg-slate-100 dark:bg-slate-900/90 rounded-lg border border-slate-200 dark:border-slate-800 select-all overflow-x-auto text-slate-800 dark:text-slate-200">
{`κ       = ${KAPPA_S_UM2.toExponential(6)} s·μm⁻²
c0      = ${C0}
c1      = ${C1}
c2      = ${C2}
kappa   = 3.932378e-6 s*um^-2`}
            </pre>
          </div>
          <p className="text-3xs text-slate-500 dark:text-slate-400 leading-normal">
            Everything runs locally in this browser tab; nothing is uploaded. The kinetic solver is a
            direct port of the validated Python implementation and reproduces its half-times to
            better than 0.01% — see <span className="font-mono">docs/VALIDATION.md</span>.
          </p>
        </div>
      </div>
    </footer>
  ); */

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-gray-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-5 min-h-14 py-2 sm:py-0 flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:flex items-baseline gap-2 shrink-0">
            <span className="font-semibold text-[15px] tracking-tight">WKE Solver</span>
            <span className="hidden xl:inline text-2xs text-slate-500 dark:text-slate-400">
              box-trap volume calibration
            </span>
          </div>

          <nav className="tab-bar min-w-0 flex-1 sm:flex-none overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={clsx('tab-bar-item', tab === t.id && 'tab-bar-item-active')}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center shrink-0">
            <button className="btn-ghost p-1.5 text-xs" onClick={toggle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-3 sm:px-5 py-4 space-y-4">
        {(tab === 'play' || tab === 'simulate') && (
          <RunParametersStrip
            mode={mode}
            speciesKey={speciesKey}
            derived={derived}
            stale={tab === 'play' ? previewIsStale : solverIsStale}
            onEdit={() => setTab('calibrate')}
          />
        )}
        {tab === 'play' && (
          <PlaygroundCard
            spectrum={spectrum}
            presetKey={presetKey}
            run={preview.runs[playKernel]}
            running={preview.state.running}
            onRun={startPlayRun}
            onContinue={() => preview.continueRun()}
            onStop={preview.cancel}
            onSpectrum={onSpectrum}
            kernel={playKernel}
            onKernel={setPlayKernel}
            quantumAvailable={derived.quantumAvailable}
            canRun={playBlockedReason == null}
            blockedReason={playBlockedReason}
            runIsStale={previewIsStale}
          />
        )}

        {tab === 'simulate' && (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Solver spectrum display controls">
              <span className="text-2xs font-medium text-slate-500 dark:text-slate-400">Spectrum display</span>
              <SegmentedControl
                size="xs"
                value={normMode}
                onChange={setNormMode}
                options={NORM_MODES.map((m) => ({
                  id: m.id,
                  label: <MathBlock math={m.id === 'unit' ? 'N_k/N' : 'N_k'} />,
                  title: m.title,
                }))}
              />
              {norm.fellBack && <Badge tone="warning">{norm.source}</Badge>}
            </div>
            <div className="grid grid-cols-1 gap-4 items-start">
              <InitialStateCard
                spectrum={spectrum}
                desc={desc}
                norm={norm}
                onSpectrum={onSpectrum}
                presetKey={presetKey}
                onPresetKey={setPresetKey}
                onDraftChange={setInitialDraftDirty}
              />
            </div>
            <div className="card-stage-enter"><SimulationPanel
                runs={solver.runs}
                runState={solver.state}
                runMode={runMode}
                onRunMode={setRunMode}
                onRun={startRun}
                onCancel={solver.cancel}
                onContinue={() => solver.continueRun()}
                norm={norm}
                quantumAvailable={derived.quantumAvailable}
                quantumBlockedReason={quantumBlockedReason}
                canRun={blockedReason == null}
                blockedReason={blockedReason}
                runIsStale={solverIsStale}
              /></div>
          </>
        )}

        {tab === 'calibrate' && (
          <>
            <SpectrumSummaryStrip
              spectrum={spectrum}
              desc={desc}
              onGoToSimulate={() => setTab('simulate')}
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ParametersCard
                mode={mode}
                onMode={setMode}
                speciesKey={speciesKey}
                onSpecies={changeSpecies}
                fields={fields}
                onFields={(f) => setFieldsByMode({ ...fieldsByMode, [mode]: f })}
                derived={derived}
                desc={desc}
                spectrum={spectrum}
              />
              <SensitivityCard
                mode={mode}
                desc={desc}
                state={sliders}
                base={sliderBase}
                onChange={setSliders}
                onRestore={() => setSliders(sliderBase)}
                dirty={slidersDirty}
                onApply={applySensitivityToRun}
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              <ResultsCard
                mode={mode}
                desc={desc}
                derived={derived}
                dtMeasured_s={inputs.dt_measured_s}
                runs={solver.runs}
                runIsStale={solverIsStale}
                usingRefinedNa={Boolean(fields.na_override_um2)}
              />

              <CalibrationMapCard desc={desc} na_um2={derived.na_um2} dt_half_s={dtForMap} />
            </div>
          </>
        )}

        {tab === 'export' && (
          <ExportPanel
            spectrum={spectrum}
            runs={solver.runs}
            atomNumber={derived.N}
            provenance={solverProvenance}
            mode={mode}
            speciesKey={speciesKey}
            derived={derived}
          />
        )}
      </main>
    </div>
  );
}
