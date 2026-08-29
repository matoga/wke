import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../ui/primitives';
import { SegmentedControl } from '../ui/primitives';
import { Plot } from './Plot';
import { MathBlock } from './MathBlock';
import { DrawCanvas } from './DrawCanvas';
import { COLORS, sig } from '../ui/theme';
import { prepareSpectrum } from '../physics/spectrum';
import type { PreparedSpectrum } from '../physics/spectrum';
import { PRESETS } from '../physics/presets';
import { interpolateQ } from '../physics/grid';
import type { WKEResult } from '../types/wke';
import type { KernelType } from '../physics/collision';

type Quantity = 'Nk' | 'nk' | 'k73nk';

const QUANTITIES: Array<{ id: Quantity; label: string; math: string; log: boolean }> = [
  { id: 'Nk', label: 'Nₖ(k) · linear', math: 'N_k(k)', log: false },
  { id: 'nk', label: 'nₖ(k) · log–log', math: 'n_k(k)', log: true },
  { id: 'k73nk', label: 'k⁷ᐟ³ nₖ(k) · linear', math: 'k^{7/3}n_k(k)', log: false },
];

export function PlaygroundCard({
  spectrum, presetKey, run, running, onRun, onContinue, onSpectrum,
  kernel, onKernel, quantumAvailable,
}: {
  spectrum: PreparedSpectrum | null;
  presetKey: string | null;
  run: WKEResult | undefined;
  running: boolean;
  onRun: () => void;
  onContinue: () => void;
  onSpectrum: (spectrum: PreparedSpectrum, presetKey: string | null) => void;
  kernel: KernelType;
  onKernel: (kernel: KernelType) => void;
  quantumAvailable: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drawValues, setDrawValues] = useState<number[]>(() => new Array(48).fill(0));
  const awaitingExtension = useRef(false);
  const frames = run?.snapshots ?? [];

  // A changed spectrum must never inherit a previous trajectory as though it
  // belonged to the new preset/edit. The next press always starts a real run.
  useEffect(() => {
    setHasStarted(false);
    setPlaying(false);
    setFrame(0);
  }, [spectrum]);

  // The first control press is deliberately “Run and play”: once the worker
  // returns its first trajectory segment, enter playback automatically rather
  // than leaving the UI frozen at its t = 0 frame.
  useEffect(() => {
    if (hasStarted && run && run.snapshots.length > 1) setPlaying(true);
  }, [hasStarted, run]);

  useEffect(() => {
    if (awaitingExtension.current && frames.length > frame + 1) awaitingExtension.current = false;
  }, [frames.length, frame]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrame((current) => {
        if (current >= frames.length - 1) {
          if (!awaitingExtension.current) {
            awaitingExtension.current = true;
            onContinue();
          }
          return current;
        }
        return current + 1;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, onContinue]);

  const currentIndex = Math.min(frame, Math.max(0, frames.length - 1));
  const current = frames[currentIndex];
  const k = current?.q ? run?.k_um_inv : spectrum?.k;
  const q = current?.q ?? spectrum?.q;
  const initialKp = frames[0]?.kp_um_inv ?? 0;
  const blowupReason = !current ? null
    : initialKp > 0 && current.kp_um_inv / initialKp < 0.005 ? 'peak collapsed'
      : Math.abs(current.dN_over_N) > 1 ? 'particle-number drift exceeded 100%'
        : Math.abs(current.dE_over_E) > 1 ? 'energy drift exceeded 100%'
          : null;
  const blowup = blowupReason != null;

  useEffect(() => {
    if (blowup) setPlaying(false);
  }, [blowup]);

  const editK = useMemo(
    () => Float64Array.from({ length: 48 }, (_, i) => (i / 47) * 6 || 1e-3),
    [],
  );
  const plotK = editing ? editK : k;
  const plotQ = editing ? drawValues : q;
  const valuesFor = useMemo(() => (quantity: Quantity) => {
    if (!plotK || !plotQ) return [];
    return Array.from(plotQ, (value, i) => {
      const ki = plotK[i];
      if (quantity === 'Nk') return value;
      const nk = ki > 0 ? value / (ki * ki) : 0;
      return quantity === 'nk' ? nk : Math.pow(ki, 7 / 3) * nk;
    });
  }, [plotK, plotQ]);
  // All six plots show the same instant: diagnostics must not reveal the
  // future while the spectrum is being played.
  const visibleFrames = frames.slice(0, Math.min(frame + 1, frames.length));
  const times = visibleFrames.map((item) => item.t_s);
  const dt = visibleFrames.map((item, index) => index === 0 ? 0 : item.t_s - visibleFrames[index - 1].t_s);

  const beginEditing = () => {
    if (!k || !q) return;
    const drawK = Float64Array.from({ length: 48 }, (_, i) => (i / 47) * 6 || 1e-3);
    const sampled = interpolateQ(Array.from(k), Array.from(q), drawK);
    const max = Math.max(...sampled, 1e-30);
    setDrawValues(Array.from(sampled, (value) => value / max));
    setPlaying(false);
    setEditing(true);
  };

  const applyEdits = () => {
    const drawK = Array.from({ length: 48 }, (_, i) => (i / 47) * 6 || 1e-3);
    onSpectrum(prepareSpectrum({
      k_um_inv: drawK,
      values: drawValues,
      convention: 'Nk_over_N',
      label: 'Playground edit',
      source: 'paste',
      warnings: [],
    }), null);
    setEditing(false);
  };

  return (
    <Card
      className="playground-card"
      title={
        <span className="flex items-center gap-2">
          <span className={playing ? 'playground-status-dot playground-status-dot-live' : 'playground-status-dot'} />
          Playground
          <span className="playground-kicker">shape · evolve · inspect</span>
        </span>
      }
      actions={
        <div className="playground-controls">
          <SegmentedControl
            size="xs"
            value={kernel}
            onChange={onKernel}
            options={[
              { id: 'classical', label: 'Classical' },
              { id: 'quantum', label: 'Quantum', disabled: !quantumAvailable },
            ]}
          />
          <select
            className="select playground-preset py-1 text-xs"
            value={presetKey ?? ''}
            onChange={(event) => {
              const preset = PRESETS.find((item) => item.key === event.target.value);
              if (preset) onSpectrum(preset.load(), preset.key);
            }}
            aria-label="Preset state"
          >
            {PRESETS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name} · kₚ ≈ {item.kp_um_inv.toFixed(2)} μm⁻¹
              </option>
            ))}
          </select>
          <button className="btn-secondary playground-edit-button text-xs px-2.5" onClick={editing ? applyEdits : beginEditing} disabled={!spectrum}>
            {editing ? '✓ Apply edits' : '✎ Edit state'}
          </button>
          <button
            className="btn-primary playground-run-button text-xs min-w-20"
            onClick={() => {
              if (!hasStarted || !run || run.snapshots.length < 2) {
                setHasStarted(true);
                onRun();
              }
              else setPlaying((value) => !value);
            }}
            disabled={running || !spectrum}
          >
            {running ? 'Running…' : !hasStarted || !run || run.snapshots.length < 2
              ? '▶ Run'
              : playing ? '❚❚ Pause' : '▶ Play'}
          </button>
        </div>
      }
    >
      {!k || !q ? (
        <p className="text-2xs text-slate-500 dark:text-slate-400">Choose a state in Solver, then return here to run it.</p>
      ) : (
        <div>
          <div className="flex items-baseline justify-between text-2xs text-slate-500 dark:text-slate-400 mb-2">
            <span className="playground-section-label">{editing ? 'Hand-edit Nₖ(k)' : 'Current spectrum'}</span>
            <span className="flex items-center gap-2">
              {blowup && <span className="text-orange-700 dark:text-orange-300">Paused: {blowupReason}</span>}
              {current && <span className="font-mono">t = {current.t_s.toFixed(3)} s</span>}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {editing
              ? QUANTITIES.map((item) => (
                <EditableSpectrumPanel
                  key={item.id}
                  item={item}
                  values={drawValues}
                  onChange={setDrawValues}
                />
              ))
              : QUANTITIES.map((item) => (
                <SpectrumPlot
                  key={item.id}
                  item={item}
                  k={plotK!}
                  y={valuesFor(item.id)}
                  current={Boolean(current)}
                />
              ))}
          </div>
        </div>
      )}
      {frames.length > 1 && !editing && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="playground-section-label mb-2">Diagnostics</div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <DiagnosticPlot title="kₚ(t)" x={times} y={visibleFrames.map((item) => item.kp_um_inv)} color={COLORS.peak} />
            <DiagnosticPlot title="E(t) / E₀" x={times} y={visibleFrames.map((item) => 1 + item.dE_over_E)} color={COLORS.quantum} />
            <DiagnosticPlot title="N(t) / N₀" x={times} y={visibleFrames.map((item) => 1 + item.dN_over_N)} color={COLORS.classical} />
            <DiagnosticPlot title="Δt(t)" x={times} y={dt} color={COLORS.muted} />
          </div>
        </div>
      )}
    </Card>
  );
}

function EditableSpectrumPanel({
  item, values, onChange,
}: {
  item: typeof QUANTITIES[number];
  values: number[];
  onChange: (values: number[]) => void;
}) {
  const display = values.map((value, index) => {
    const k = (index / (values.length - 1)) * 6 || 1e-3;
    if (item.id === 'Nk') return value;
    return item.id === 'nk' ? value / (k * k) : value * Math.pow(k, 1 / 3);
  });
  const peak = Math.max(...display, 1e-30);
  const normalized = display.map((value) => Math.max(0, value / peak));
  const apply = (next: number[]) => {
    const unscaled = next.map((value, index) => {
      const k = (index / (next.length - 1)) * 6 || 1e-3;
      if (item.id === 'Nk') return value;
      return item.id === 'nk' ? value * k * k : value / Math.pow(k, 1 / 3);
    });
    const max = Math.max(...unscaled, 1e-30);
    onChange(unscaled.map((value) => Math.max(0, value / max)));
  };
  return (
    <div>
      <div className="text-2xs text-slate-500 dark:text-slate-400 mb-1">
        <MathBlock math={item.math} /> <span className="ml-1">paint to edit</span>
      </div>
      <div className="rounded-md border border-slate-200 dark:border-slate-800 p-1.5 bg-slate-50 dark:bg-gray-900">
        <DrawCanvas
          values={normalized}
          onChange={apply}
          kMax={6}
          height={215}
          xScale={item.id === 'nk' ? 'log' : 'linear'}
          yScale={item.id === 'nk' ? 'log' : 'linear'}
        />
      </div>
    </div>
  );
}

function SpectrumPlot({
  item, k, y, current,
}: {
  item: typeof QUANTITIES[number];
  k: ArrayLike<number>;
  y: number[];
  current: boolean;
}) {
  const positive = y.filter((value) => value > 0);
  const peak = Math.max(...y, 1e-30);
  // The occupation's machine-small tail is physically uninformative but can
  // span hundreds of decades on a log axis. Keep four visible decades below
  // the peak and omit lower values from this display only.
  const logFloor = Math.max(peak * 1e-4, 1e-30);
  const plottedY = item.log ? y.map((value) => value >= logFloor ? value : NaN) : y;
  const yMin = item.log ? logFloor : (positive.length ? Math.min(...positive) : 1e-12);
  const kMax = item.log ? Math.min(k[k.length - 1], 5.3) : 5.3;
  return (
    <div>
      <div className="text-2xs text-slate-500 dark:text-slate-400 mb-1"><MathBlock math={item.math} /></div>
      <Plot
        height={215}
        maxWidth={390}
        xScale={item.log ? 'log' : 'linear'}
        yScale={item.log ? 'log' : 'linear'}
        xDomain={item.log ? [Math.max(k[0], 1e-4), kMax] : [0, kMax]}
        yDomain={item.log ? [yMin, peak * 1.3] : [0, peak * 1.1]}
        xLabel="k (μm⁻¹)"
        yLabel={item.math}
        formatX={(value) => `${sig(value, 3)} μm⁻¹`}
        legend={false}
        series={[{ id: item.id, label: current ? 'current state' : 'initial state', x: k, y: plottedY, color: COLORS.spectrum }]}
      />
    </div>
  );
}

function DiagnosticPlot({
  title, x, y, color,
}: {
  title: string;
  x: number[];
  y: number[];
  color: string;
}) {
  const peak = Math.max(...y.map(Math.abs), 1e-30);
  const min = Math.min(...y);
  const max = Math.max(...y);
  const padding = Math.max((max - min) * 0.15, peak * 1e-6);
  return (
    <div>
      <div className="text-2xs text-slate-500 dark:text-slate-400 mb-1">{title}</div>
      <Plot
        height={155}
        maxWidth={290}
        xDomain={[0, x.at(-1) || 1]}
        yDomain={[min - padding, max + padding]}
        xLabel="t (s)"
        yLabel=""
        legend={false}
        series={[{ id: title, label: title, x, y, color }]}
      />
    </div>
  );
}
