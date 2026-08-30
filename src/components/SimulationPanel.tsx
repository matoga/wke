/**
 * WKE simulation panel: run controls, live progress, the evolving spectrum with
 * a stage/timeline scrubber, k_p(t), and conservation diagnostics.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Card, Metric, Badge, Callout, SegmentedControl } from '../ui/primitives';
import { Plot } from './Plot';
import { MathBlock } from './MathBlock';
import { COLORS, sig, seconds, pct, rainbowColor } from '../ui/theme';
import type { WKEResult } from '../types/wke';
import type { KernelType } from '../physics/collision';
import { spectralExtent } from '../physics/descriptors';
import { applyNorm } from '../ui/norm';
import type { NormSpec } from '../ui/norm';

function stageName(stage: string, reachedHalf: boolean): string {
  if (stage === 'initial') return 'initial peak';
  if (stage === 'continued') return 'resumed here';
  if (stage === 'final') return reachedHalf ? 'half-time reached' : 'run limit reached';
  if (stage === 'extended') return 'extension ends';
  return `peak ratio ${stage}`;
}

function StageLabel({ stage, reachedHalf }: { stage: string; reachedHalf: boolean }) {
  if (stage === 'initial') return <MathBlock math="k_{p,0}" />;
  if (stage === 'continued') return <>resumed here</>;
  if (stage === 'final') return reachedHalf ? <MathBlock math="\Delta t_{1/2}" /> : <>run limit reached</>;
  if (stage === 'extended') return <>extension ends</>;
  return <><MathBlock math="k_p/k_{p,0}" /> = {stage}</>;
}

/** Local power-law exponent from a five-point regression in log k–log n. */
function effectiveExponent(k: ArrayLike<number>, n: ArrayLike<number>): number[] {
  const count = Math.min(k.length, n.length);
  const result = new Array<number>(count).fill(Number.NaN);
  for (let i = 0; i < count; i++) {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(count - 1, i + 2);
    let samples = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (let j = lo; j <= hi; j++) {
      if (!(k[j] > 0) || !(n[j] > 0) || !Number.isFinite(n[j])) continue;
      const x = Math.log(k[j]);
      const y = Math.log(n[j]);
      samples++;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }
    const denominator = samples * sumXX - sumX * sumX;
    if (samples >= 3 && Math.abs(denominator) > 1e-14) {
      const slope = (samples * sumXY - sumX * sumY) / denominator;
      result[i] = Math.max(-4, Math.min(1, slope));
    }
  }
  return result;
}

export type RunMode = 'classical' | 'quantum' | 'both';

export interface RunState {
  running: boolean;
  phase: string;
  pct: number;
  kp?: number;
  message?: string;
}

export function SimulationPanel({
  runs, runState, runMode, onRunMode, onRun, onCancel, onContinue, norm,
  quantumAvailable, quantumBlockedReason, canRun, blockedReason,
  runIsStale,
}: {
  runs: Partial<Record<KernelType, WKEResult>>;
  norm: NormSpec;
  runState: RunState;
  runMode: RunMode;
  onRunMode: (m: RunMode) => void;
  onRun: () => void;
  onCancel: () => void;
  onContinue: () => void;
  quantumAvailable: boolean;
  quantumBlockedReason: string;
  canRun: boolean;
  blockedReason: string | null;
  runIsStale: boolean;
}) {
  const primary = runMode === 'quantum'
    ? runs.quantum ?? runs.classical
    : runs.classical ?? runs.quantum;
  const snapshots = primary?.snapshots ?? [];
  const totalTime = snapshots.length > 0 ? snapshots[snapshots.length - 1].t_s : 0;

  // Playback position is real simulated time in seconds, not a frame index —
  // the saved snapshots are spaced unevenly in time (denser while the peak is
  // moving fast), so an index-based scrubber would silently distort the pacing.
  // `null` means "track the latest state", so a Continue extension is visible
  // immediately without the user having to drag the slider again.
  const [simTime, setSimTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastStartedRunId = useRef<string | null>(null);

  // The default animation keeps the current state prominent over a faint
  // time-coloured history. A clean animation and a fully emphasized static
  // rainbow remain available as explicit alternatives.
  const [viewMode, setViewMode] = useState<'animate' | 'animate-clean' | 'rainbow'>('animate');
  const [gammaGuide, setGammaGuide] = useState(-7 / 3);

  const displayTime = simTime == null ? totalTime : Math.min(simTime, totalTime);

  // Nearest saved snapshot to the current playback time.
  const idx = useMemo(() => {
    if (snapshots.length === 0) return 0;
    let lo = 0, hi = snapshots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (snapshots[mid].t_s < displayTime) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(snapshots[lo - 1].t_s - displayTime) <= Math.abs(snapshots[lo].t_s - displayTime)) {
      return lo - 1;
    }
    return lo;
  }, [snapshots, displayTime]);

  const snap = snapshots[idx];
  const initial = snapshots[0];

  const stageMarks = useMemo(() => {
    const marks = snapshots
      .map((s, i) => ({ i, stage: s.stage, time: s.t_s }))
      .filter((s) => s.stage !== 'sample');

    // Crossing and continuation snapshots can occupy exactly the same instant.
    // Render those as one timeline event with a combined popover.
    return marks.reduce<Array<{ time: number; marks: typeof marks }>>((groups, mark) => {
      const previous = groups[groups.length - 1];
      const tolerance = Math.max(totalTime, 1) * 1e-10;
      if (previous && Math.abs(previous.time - mark.time) <= tolerance) previous.marks.push(mark);
      else groups.push({ time: mark.time, marks: [mark] });
      return groups;
    }, []);
  }, [snapshots, totalTime]);

  // Play advances simTime at wall-clock rate, scaled so the whole run — however
  // long it actually is — plays through in about six real seconds. This is a
  // replay of already-saved states, not a re-integration, so it costs nothing.
  useEffect(() => {
    if (!playing || totalTime <= 0) return;
    const rate = totalTime / 6;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSimTime((t) => {
        const cur = t == null ? 0 : t;
        const next = cur + dt * rate;
        if (next >= totalTime) { setPlaying(false); return totalTime; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [playing, totalTime]);

  // A genuinely new solve starts at its first frame and autoplays. A merged
  // continuation retains the original runId, so it extends the current view
  // without unexpectedly rewinding the trajectory.
  useEffect(() => {
    if (!primary || primary.runId === lastStartedRunId.current) return;
    lastStartedRunId.current = primary.runId;
    setViewMode('animate');
    setSimTime(0);
    setPlaying(primary.snapshots.length > 1);
  }, [primary?.runId]);

  // Fix every axis from the initial state so nothing rescales frame to frame
  // while the peak migrates downward — the whole point of watching it evolve.
  const kMaxPlot = useMemo(() => {
    if (!primary || snapshots.length === 0) return 1;
    return spectralExtent(Float64Array.from(primary.k_um_inv), snapshots[0].q);
  }, [primary, snapshots]);

  const yMaxLin = useMemo(() => {
    if (!initial) return 1;
    let m = 0;
    for (let i = 0; i < initial.q.length; i++) m = Math.max(m, initial.q[i]);
    return m * norm.scale * 1.15;
  }, [initial, norm]);

  // The log-log panel plots the mean occupation number n_k (atoms per mode),
  // reconstructed exactly from the reported q(k,t): q = k² f / (2π² n₀), so
  // f = q · 2π² n₀ / k². This is the solver's own internal quantity, an
  // absolute occupation count — not a shell-integrated density like N_k, so
  // unlike the linear panel it does not depend on the N_k/N_k display toggle
  // above; a change of total atom number would not change whether a given
  // mode holds "many atoms" or "about one."
  const toOccupation = useCallback((q: ArrayLike<number>): number[] => {
    if (!primary) return [];
    const twoPi2 = 2 * Math.PI * Math.PI;
    const density = primary.scales.density_um3;
    const out = new Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const k = primary.k_um_inv[i];
      out[i] = (q[i] * twoPi2 * density) / (k * k);
    }
    return out;
  }, [primary]);

  const NK_FLOOR = 0.3; // atoms/mode — below this the mode is essentially unoccupied
  const K_MIN_LOG = 0.03; // μm⁻¹ — fixed lower bound for the log-log occupation plot

  const yMaxLog = useMemo(() => {
    if (!initial || !primary) return NK_FLOOR * 10;
    const twoPi2 = 2 * Math.PI * Math.PI;
    const density = primary.scales.density_um3;
    const states = snapshots.length > 0 ? snapshots.map((s) => s.q) : [initial.q];
    let m = 0;
    for (const q of states) {
      for (let i = 0; i < q.length; i++) {
        const k = primary.k_um_inv[i];
        m = Math.max(m, (q[i] * twoPi2 * density) / (k * k));
      }
    }
    return Math.max(m * 1.3, NK_FLOOR * 10);
  }, [initial, primary, snapshots]);

  // A manageable, evenly-spaced-in-time subset of the saved states, for the
  // "all times" overlay — plotting all 150 at "very fine" would be illegible.
  const RAINBOW_MAX = 24;
  const rainbowFrames = useMemo(() => {
    if (snapshots.length === 0) return [];
    if (snapshots.length <= RAINBOW_MAX) return snapshots.map((s, i) => ({ snap: s, i }));
    const out: Array<{ snap: typeof snapshots[number]; i: number }> = [];
    for (let j = 0; j < RAINBOW_MAX; j++) {
      const i = Math.round((j / (RAINBOW_MAX - 1)) * (snapshots.length - 1));
      out.push({ snap: snapshots[i], i });
    }
    return out;
  }, [snapshots]);

  const animated = viewMode !== 'rainbow';
  const rainbowBackground = viewMode === 'animate';

  const backgroundSeries = useCallback((mapY: (frame: typeof snapshots[number]) => ArrayLike<number>) => (
    rainbowBackground && primary
      ? rainbowFrames.map(({ snap: frame, i }) => ({
          id: `background-${i}`,
          label: '',
          x: primary.k_um_inv,
          y: mapY(frame),
          color: rainbowColor(totalTime > 0 ? frame.t_s / totalTime : 0),
          width: 1,
          opacity: 0.3,
          decorative: true,
        }))
      : []
  ), [primary, rainbowBackground, rainbowFrames, totalTime]);

  const linearSeries = useMemo(() => {
    if (!primary || !initial) return [];
    if (animated) {
      return [
        ...backgroundSeries((frame) => applyNorm(frame.q, norm)),
        { id: 'q0', label: `${norm.symbol} at t = 0`, x: primary.k_um_inv, y: applyNorm(initial.q, norm), color: COLORS.raw, dashed: true },
        { id: 'qt', label: `${norm.symbol} at t = ${seconds(snap.t_s)}`, x: primary.k_um_inv, y: applyNorm(snap.q, norm), color: COLORS.current, width: 1.9 },
      ];
    }
    return rainbowFrames.map(({ snap: s, i }) => ({
      id: `frame-${i}`,
      label: seconds(s.t_s),
      x: primary.k_um_inv,
      y: applyNorm(s.q, norm),
      color: rainbowColor(totalTime > 0 ? s.t_s / totalTime : 0),
      width: 1.3,
      opacity: 0.85,
    }));
  }, [primary, initial, snap, animated, backgroundSeries, rainbowFrames, norm, totalTime]);

  const logLogSeries = useMemo(() => {
    if (!primary || !initial) return [];
    if (animated) {
      return [
        ...backgroundSeries((frame) => toOccupation(frame.q)),
        { id: 'q0', label: 'n_k at t = 0', x: primary.k_um_inv, y: toOccupation(initial.q), color: COLORS.raw, dashed: true },
        { id: 'qt', label: `n_k at t = ${seconds(snap.t_s)}`, x: primary.k_um_inv, y: toOccupation(snap.q), color: COLORS.current, width: 1.9 },
      ];
    }
    return rainbowFrames.map(({ snap: s, i }) => ({
      id: `frame-${i}`,
      label: seconds(s.t_s),
      x: primary.k_um_inv,
      y: toOccupation(s.q),
      color: rainbowColor(totalTime > 0 ? s.t_s / totalTime : 0),
      width: 1.3,
      opacity: 0.85,
    }));
  }, [primary, initial, snap, animated, backgroundSeries, rainbowFrames, toOccupation, totalTime]);

  const exponentSeries = useMemo(() => {
    if (!primary) return [];
    if (animated) {
      return [
        ...backgroundSeries((frame) => effectiveExponent(primary.k_um_inv, toOccupation(frame.q))),
        {
          id: 'exponent-current',
          label: `t = ${seconds(snap.t_s)}`,
          x: primary.k_um_inv,
          y: effectiveExponent(primary.k_um_inv, toOccupation(snap.q)),
          color: COLORS.current,
          width: 1.9,
        },
      ];
    }
    return rainbowFrames.map(({ snap: frame, i }) => ({
      id: `exponent-${i}`,
      label: seconds(frame.t_s),
      x: primary.k_um_inv,
      y: effectiveExponent(primary.k_um_inv, toOccupation(frame.q)),
      color: rainbowColor(totalTime > 0 ? frame.t_s / totalTime : 0),
      width: 1.15,
      opacity: 0.78,
    }));
  }, [primary, snap, animated, backgroundSeries, rainbowFrames, toOccupation, totalTime]);

  const kpMax = primary ? primary.kp0_um_inv * 1.05 : 1;
  // The x-range must track the longest available track, not just the
  // half-time — a Continue extension runs well past dtHalf_s.
  const tMax = primary
    ? Math.max(
        primary.dtHalf_s ?? 0,
        runs.classical?.kpTrack.t_s.at(-1) ?? 0,
        runs.quantum?.kpTrack.t_s.at(-1) ?? 0,
      ) * 1.08
    : 1;
  const selectedRunExists = runMode === 'both'
    ? Boolean(runs.classical && runs.quantum)
    : Boolean(runs[runMode]);

  return (
    <Card
      title="WKE simulation"
      subtitle="Direct wave kinetic equation solve."
      actions={
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="xs"
            value={runMode}
            onChange={onRunMode}
            options={[
              { id: 'classical', label: 'Classical' },
              { id: 'quantum', label: 'Quantum', disabled: !quantumAvailable, title: quantumAvailable ? undefined : quantumBlockedReason },
              { id: 'both', label: 'Both', disabled: !quantumAvailable, title: quantumAvailable ? undefined : quantumBlockedReason },
            ]}
          />
          {runState.running ? (
            <button className="btn-secondary text-xs" onClick={onCancel}>Stop run</button>
          ) : (!selectedRunExists || runIsStale) && (
            <button className="btn-primary text-xs" onClick={onRun} disabled={!canRun} title={blockedReason ?? undefined}>
              {runIsStale
                ? `Re-run ${runMode === 'both' ? 'both' : runMode}`
                : runMode === 'both' ? 'Run both' : `Run ${runMode}`}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {blockedReason && !runState.running && (
          <Callout tone="info">{blockedReason}</Callout>
        )}

        {runIsStale && !runState.running && (
          <Callout tone="warning" title="Run is out of date">
            Inputs changed after this run. The plots below are the previous result; re-run to update them.
          </Callout>
        )}

        {!quantumAvailable && (
          <Callout tone="info" title="Quantum unavailable">
            {quantumBlockedReason}
          </Callout>
        )}

        {runState.running && (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-2xs text-slate-500 dark:text-slate-400">
              <span>{runState.phase}</span>
              <span className="font-mono tabular-nums">
                {runState.kp != null && `k_p = ${runState.kp.toFixed(4)} μm⁻¹ · `}
                {(runState.pct * 100).toFixed(0)}%
              </span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${Math.min(100, runState.pct * 100)}%` }} />
            </div>
          </div>
        )}

        {runState.message && <Callout tone="danger" title="Solver error">{runState.message}</Callout>}

        {primary && primary.gridCoverage < 0.99 && (
          <Callout tone="warning" title="Spectrum exceeds solver grid">
            {(primary.gridCoverage * 100).toFixed(1)}% covered. This half-time is unreliable.
          </Callout>
        )}

        {primary && snap && initial && (
          <>
            <div className="flex justify-end">
              <Badge tone="info">Displaying {primary.kernel} trajectory</Badge>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))' }}>
              {(['classical', 'quantum'] as KernelType[]).map((k) => {
                const r = runs[k];
                if (!r) return null;
                return (
                  <div key={k} className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full"
                        style={{ background: k === 'classical' ? COLORS.classical : COLORS.quantum }} />
                      <span className="text-2xs uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                        {k} <MathBlock math="\Delta t_{1/2}" />
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-base font-semibold mt-0.5">
                      {r.reachedHalf ? seconds(r.dtHalf_s) : 'no crossing'}
                    </div>
                    <div className="text-2xs text-slate-500 dark:text-slate-400">
                      {r.nSteps} steps · {(r.wallTime_ms / 1000).toFixed(2)} s
                    </div>
                  </div>
                );
              })}
              <div className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2">
                <div className="text-2xs uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                  simulation time
                </div>
                <div className="font-mono tabular-nums text-base font-semibold mt-0.5">
                  {seconds(snap.t_s)}
                </div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">τ = {snap.tau.toFixed(3)}</div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2">
                <div className="text-2xs uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                  <MathBlock math="k_p(t) / k_{p,0}" />
                </div>
                <div className="font-mono tabular-nums text-base font-semibold mt-0.5">
                  {(snap.kp_um_inv / primary.kp0_um_inv).toFixed(4)}
                </div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">
                  {snap.kp_um_inv.toFixed(4)} μm⁻¹
                </div>
              </div>
            </div>

            {/* View mode: animate one frame at a time, or overlay every saved state */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-2xs text-slate-500 dark:text-slate-400">
                <span>
                  {animated
                    ? <>Playback: 0 to {seconds(totalTime)} ({snapshots.length} states)</>
                    : <>All {snapshots.length > rainbowFrames.length ? `${rainbowFrames.length} of ${snapshots.length}` : snapshots.length} saved states, t = 0 to {seconds(totalTime)}</>}
                </span>
                <div className="flex items-center gap-2">
                  {animated && (
                    <span className="font-mono">
                      {seconds(displayTime)}
                      {snap.stage !== 'sample' && (
                        <span className="ml-2 text-accent-600 dark:text-accent-400">{snap.stage}</span>
                      )}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 rounded-xl border border-accent-200/80 bg-accent-50/80 p-1 shadow-sm dark:border-accent-800 dark:bg-accent-900/20">
                    <span className="pl-1.5 text-2xs font-semibold tracking-wide text-accent-700 dark:text-accent-300">VIEW</span>
                    <SegmentedControl
                      size="sm"
                      value={viewMode}
                      onChange={(v) => { setViewMode(v); if (v === 'rainbow') setPlaying(false); }}
                      options={[
                        { id: 'animate', label: 'Animate' },
                        { id: 'animate-clean', label: 'Solo', title: 'Animate only the current state' },
                        { id: 'rainbow', label: 'Rainbow', title: 'Overlay all saved times' },
                      ]}
                    />
                  </div>
                </div>
              </div>
              {animated ? (
                <>
                  <div className="flex items-start gap-2">
                    <button
                      className="btn-secondary mt-0.5 text-2xs py-1 px-2 w-16 justify-center"
                      onClick={() => {
                        if (!playing && displayTime >= totalTime - 1e-12) setSimTime(0);
                        setPlaying((p) => !p);
                      }}
                      aria-label={playing ? 'Pause playback' : 'Play the cascade'}
                    >
                      {playing ? '❚❚ Pause' : '▶ Play'}
                    </button>
                    <div className="relative h-8 flex-1" aria-label="Simulation timeline with checkpoint markers">
                      <input
                        type="range"
                        min={0}
                        max={totalTime || 1}
                        step={totalTime > 0 ? totalTime / 2000 : 1}
                        value={displayTime}
                        onChange={(e) => { setPlaying(false); setSimTime(Number(e.target.value)); }}
                        className="absolute inset-x-0 top-1 h-1 w-full accent-accent-600 cursor-pointer"
                      />
                      {stageMarks.map((group) => {
                        const position = totalTime > 0 ? Math.max(0, Math.min(100, group.time / totalTime * 100)) : 0;
                        const active = group.marks.some((mark) => idx === mark.i);
                        const accessibleNames = group.marks
                          .map((mark) => stageName(mark.stage, primary.reachedHalf))
                          .join(', ');
                        return (
                          <button
                            key={`${group.time}-${accessibleNames}`}
                            type="button"
                            aria-label={`${accessibleNames}, ${seconds(group.time)}`}
                            onClick={() => { setPlaying(false); setSimTime(group.time); }}
                            className={clsx('timeline-event group', active && 'timeline-event-active')}
                            style={{ left: `${position}%` }}
                          >
                            <span className="timeline-event-stem" />
                            <span className="timeline-event-dot" />
                            <span className="timeline-event-popover" role="tooltip">
                              {group.marks.map((mark) => (
                                <span key={`${mark.i}-${mark.stage}`} className="block whitespace-nowrap">
                                  <StageLabel stage={mark.stage} reachedHalf={primary.reachedHalf} />
                                </span>
                              ))}
                              <span className="mt-0.5 block whitespace-nowrap font-mono text-[9px] font-normal text-slate-400 dark:text-slate-500">
                                {seconds(group.time)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="btn-primary mt-0.5 whitespace-nowrap px-3 py-1 text-2xs"
                      onClick={onContinue}
                      disabled={runState.running || runIsStale}
                      title={runIsStale
                        ? 'Re-run with the current settings before extending the trajectory.'
                        : 'Resume from the exact final solver state for the same number of adaptive steps.'}
                    >
                      {runState.running ? 'Running…' : 'Continue run'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-2xs text-slate-500 dark:text-slate-400">
                  <span>t = 0</span>
                  <span
                    className="flex-1 h-2 rounded-full"
                    style={{ background: 'linear-gradient(to right, hsl(240,75%,48%), hsl(180,75%,48%), hsl(120,75%,48%), hsl(60,75%,48%), hsl(0,75%,48%))' }}
                  />
                  <span>t = {seconds(totalTime)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-6">
              <div>
                <div className="flex items-baseline justify-between text-2xs text-slate-500 dark:text-slate-400 mb-2">
                  <span><MathBlock math="N_k(k)" />, linear</span>
                  <span className="text-3xs text-slate-400 dark:text-slate-500">{norm.source}</span>
                </div>
                <Plot
                  aspect="golden"
                  maxWidth={440}
                  xDomain={[0, kMaxPlot]}
                  yDomain={[0, yMaxLin]}
                  xLabel="k (μm⁻¹)"
                  yLabel={norm.axis}
                  formatX={(v) => `${sig(v, 3)} μm⁻¹`}
                  legend={animated}
                  series={linearSeries}
                  markers={[
                    { id: 'kp0', axis: 'x', value: primary.kp0_um_inv, label: 'k_p,0', color: COLORS.muted },
                    { id: 'kp', axis: 'x', value: snap.kp_um_inv, label: 'k_p(t)', color: COLORS.peak },
                    { id: 'half', axis: 'x', value: primary.kp0_um_inv / 2, label: 'k_p,0/2', color: COLORS.stage },
                  ]}
                />
              </div>

              <div>
                <div className="text-2xs text-slate-500 dark:text-slate-400 mb-2">
                  <MathBlock math="n_k(k)" />, log-log
                </div>
                <Plot
                  aspect="golden"
                  maxWidth={440}
                  xScale="log"
                  yScale="log"
                  xDomain={[K_MIN_LOG, kMaxPlot]}
                  yDomain={[NK_FLOOR, yMaxLog]}
                  xLabel="k (μm⁻¹)"
                  yLabel="n_k (atoms / mode)"
                  formatX={(v) => `${sig(v, 3)} μm⁻¹`}
                  formatY={(v) => `${sig(v, 3)} atoms/mode`}
                  legend={animated}
                  series={logLogSeries}
                  markers={[
                    { id: 'kp0', axis: 'x', value: primary.kp0_um_inv, label: 'k_p,0', color: COLORS.muted },
                    { id: 'kp', axis: 'x', value: snap.kp_um_inv, label: 'k_p(t)', color: COLORS.peak },
                  ]}
                />
              </div>

              <div>
                <div className="text-2xs text-slate-500 dark:text-slate-400 mb-2">
                  Peak wavevector <MathBlock math="k_p(t)" />, linear
                </div>
                <Plot
                  aspect="golden"
                  maxWidth={440}
                  xDomain={[0, tMax]}
                  yDomain={[0, kpMax]}
                  xLabel="t (s)"
                  yLabel="k_p (μm⁻¹)"
                  formatX={(v) => seconds(v)}
                  series={[
                    runs.classical && {
                      id: 'kpc', label: 'classical',
                      x: runs.classical.kpTrack.t_s, y: runs.classical.kpTrack.kp,
                      color: COLORS.classical,
                    },
                    runs.quantum && {
                      id: 'kpq', label: 'quantum',
                      x: runs.quantum.kpTrack.t_s, y: runs.quantum.kpTrack.kp,
                      color: COLORS.quantum,
                    },
                  ].filter(Boolean) as never}
                  markers={[
                    { id: 'half', axis: 'y', value: primary.kp0_um_inv / 2, label: 'k_p,0/2', color: COLORS.stage },
                    ...(primary.dtHalf_s != null
                      ? [{ id: 'dt', axis: 'x' as const, value: primary.dtHalf_s, label: 'Δt₁ᐟ₂', color: COLORS.peak }]
                      : []),
                    { id: 'cursor', axis: 'x', value: snap.t_s, label: '', color: COLORS.muted, dashed: false },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,36rem)_minmax(280px,1fr)] gap-6 items-start pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
                <div>
                  <Metric label={<>particle moment drift <MathBlock math="\int p^2 f\,dp" /></>} value={pct(snap.dN_over_N, 4)}
                    title="Number is not exactly conserved on a truncated grid; this is the discretization error, not a solver failure." />
                  <Metric label={<>energy moment drift <MathBlock math="\int p^4 f\,dp" /></>} value={pct(snap.dE_over_E, 4)} />
                  <Metric label="worst drift over the run" value={`${pct(primary.maxDN, 3)} / ${pct(primary.maxDE, 3)}`} />
                </div>
                <div>
                  <Metric label="collision events" value={primary.nEvents.toLocaleString()} />
                  <Metric label="RHS evaluations" value={String(primary.nRhs)} />
                  <Metric label="rejected steps" value={String(primary.nRejected)} />
                  <Metric label="geometry build" value={`${primary.geometry_ms.toFixed(0)} ms`} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-2xs text-slate-500 dark:text-slate-400">
                  <span>effective exponent <MathBlock math="d\ln n_k / d\ln k" /></span>
                  <span className="text-3xs text-slate-400 dark:text-slate-500">local 5-point fit</span>
                </div>
                <Plot
                  height={210}
                  minHeight={210}
                  maxWidth={560}
                  xDomain={[0, kMaxPlot]}
                  yDomain={[-4, 1]}
                  xLabel="k (μm⁻¹)"
                  yLabel="d ln n_k / d ln k"
                  formatX={(v) => `${sig(v, 3)} μm⁻¹`}
                  formatY={(v) => sig(v, 3)}
                  legend={false}
                  series={exponentSeries}
                  markers={[{
                    id: 'gamma-guide',
                    axis: 'y',
                    value: gammaGuide,
                    label: `γ = ${gammaGuide.toFixed(2)}`,
                    color: COLORS.muted,
                    dashed: true,
                    onChange: setGammaGuide,
                    resetValue: -7 / 3,
                  }]}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">ξ = {primary.scales.xi_um.toFixed(4)} μm</Badge>
              <Badge tone="neutral">t₀ = {primary.scales.t0_s.toExponential(4)} s</Badge>
              <Badge tone="neutral">N_cal = {primary.scales.ncal.toFixed(2)}</Badge>
              <Badge tone="neutral">na = {primary.scales.na_um2.toExponential(4)} μm⁻²</Badge>
            </div>
          </>
        )}

        {!primary && !runState.running && (
          <p className="text-2xs text-slate-500 dark:text-slate-400">
            Press Run to integrate the isotropic four-wave kinetic equation until
            k_p(t) falls to k_p,0/2. A typical solve takes about a second.
          </p>
        )}
      </div>
    </Card>
  );
}
