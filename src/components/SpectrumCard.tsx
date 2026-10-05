/**
 * The evolving shell spectrum N_k(k, t) of the selected run. Playback replays
 * the saved states by simulated time; nothing is re-integrated. For a ±a pair
 * both runs are drawn at the same time on one playhead, with their difference
 * in a strip underneath.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, LegendItem, Segmented } from '../ui/primitives';
import { Plot } from './Plot';
import type { Marker, Series } from './Plot';
import { applyNorm } from '../ui/norm';
import type { NormSpec } from '../ui/norm';
import { fmt, time, timeText } from '../ui/format';
import { displayFrames, modelColor, nearestSnapshot, occupation, rampColor } from '../ui/runView';
import { load, save } from '../state/storage';
import { MODEL_BY_ID } from '../physics/models';
import type { NormMode } from '../ui/norm';
import { spectralExtent } from '../physics/descriptors';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { LiveRun, RunRecord } from '../state/useRunLibrary';
import type { WKESnapshot } from '../types/wke';
import { M_EDGES } from '../physics/rhs';

type SpectrumQuantity = 'unit' | 'experimental' | 'occupation' | 'k4';
type TimeView = 'animate' | 'rainbow' | 'both';

const PLAY_SECONDS = 6;
const CURVE_COUNTS = [20, 40, 60, 120] as const;
const isCurveCount = (v: unknown): v is number => typeof v === 'number' && (CURVE_COUNTS as readonly number[]).includes(v);

export function SpectrumCard({
  record, live, partner, stale, spectrum, desc, stopKpFraction, onStopKpFractionChange, norm, density: inputDensity, normMode, onNormMode, running, canContinue, onContinue, onFrame,
}: {
  /** the state on screen, for readouts elsewhere */
  onFrame?: (frame: { snap: WKESnapshot; k: Float64Array; partnerSnap?: WKESnapshot | null } | null) => void;
  /** the run shown: the only one, or the +a run of a ±a pair */
  record: RunRecord | null;
  live: LiveRun | null;
  /** the −a run of a ±a pair, finished or live; null outside pair mode */
  partner: { record: RunRecord | null; live: LiveRun | null } | null;
  stale: boolean;
  spectrum: PreparedSpectrum;
  desc: SpectralDescriptors;
  stopKpFraction: number;
  onStopKpFractionChange: (fraction: number) => void;
  norm: NormSpec;
  density: number | null;
  normMode: NormMode;
  onNormMode: (mode: NormMode) => void;
  running: boolean;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const pairMode = partner != null;
  const plusRun = live ?? record?.result ?? null;
  const minusRun = partner ? partner.live ?? partner.record?.result ?? null : null;
  // The run that sets the grid, the initial state and the time line: +a if there is one.
  const r = plusRun ?? minusRun;
  const termination = [plusRun, minusRun].some((x) => x && 'termination' in x && (x.termination === 'pole' || x.termination === 'nonfinite'))
    ? 'pole' : r && 'termination' in r ? r.termination : null;
  const [viewChoice, setView] = useState<TimeView>('both');
  // The rainbow history of two runs at once would be unreadable: a pair is always animated.
  const view: TimeView = pairMode ? 'animate' : viewChoice;
  const [quantity, setQuantity] = useState<'shell' | 'occupation' | 'k4'>('shell');
  const [curveCount, setCurveCountState] = useState<number>(() => load('curves', 60, isCurveCount));
  const setCurveCount = (c: number) => { setCurveCountState(c); save('curves', c); };
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const seenRun = useRef<string | null>(null);
  const seenEnd = useRef(0);

  const snaps = r?.snapshots ?? [];
  const minusSnaps = pairMode && plusRun ? minusRun?.snapshots ?? [] : [];
  const endOf = (s: WKESnapshot[]) => (s.length ? s[s.length - 1].t_s : 0);
  const tEnd = Math.max(endOf(snaps), endOf(minusSnaps));
  const k = useMemo(() => (r ? Float64Array.from(r.k_um_inv) : spectrum.k), [r, spectrum]);

  const runId = r?.runId;
  useEffect(() => {
    if (!runId) { seenRun.current = null; seenEnd.current = 0; return; }
    if (runId !== seenRun.current) {
      seenRun.current = runId;
      seenEnd.current = tEnd;
      setView('both');
      setT(tEnd);
      setPlaying(false);
      return;
    }
    const previousEnd = seenEnd.current;
    seenEnd.current = tEnd;
    if (tEnd > previousEnd) {
      setT((current) => Math.abs(current - previousEnd) < Math.max(previousEnd, 1) * 1e-10 ? tEnd : current);
    }
  }, [runId, snaps.length, tEnd]);

  // While the solver runs, the panel follows the newest state and playback is off.
  useEffect(() => {
    if (running) { setPlaying(false); setT(tEnd); }
  }, [running, tEnd]);

  useEffect(() => {
    if (!playing || tEnd <= 0) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * (tEnd / PLAY_SECONDS);
      last = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= tEnd) { setPlaying(false); return tEnd; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); };
  }, [playing, tEnd]);

  const q0 = r ? snaps[0].q : Array.from(spectrum.q);
  const xMax = useMemo(() => spectralExtent(k, q0, 0.999), [k, q0]);
  const density = r?.scales.density_um3 ?? inputDensity ?? 1;
  const rainbowFrames = useMemo(
    () => displayFrames(snaps, curveCount).map((i) => ({ snap: snaps[i], i })),
    [snaps, curveCount],
  );
  // Stops on the time axis: the stage crossings of each run, coloured by run; in a pair +a below, −a above.
  const stageMarks = useMemo(() => {
    const marksOf = (s: WKESnapshot[], who: '' | '+a' | '−a') => s
      .map((snap, i) => ({ time: snap.t_s, stage: snap.stage, i, who }))
      .filter((mark) => mark.stage !== 'sample' && mark.stage !== 'initial' && mark.stage !== 'live')
      .filter((mark, i, marks) => i === 0 || Math.abs(mark.time - marks[i - 1].time) > Math.max(tEnd, 1) * 1e-10);
    return pairMode && plusRun ? [...marksOf(snaps, '+a'), ...marksOf(minusSnaps, '−a')] : marksOf(snaps, pairMode ? '−a' : '');
  }, [snaps, minusSnaps, tEnd, pairMode, plusRun]);
  /** a stage label that is the stop target */
  const isTarget = (stage: string) => Math.abs(Number(stage) - stopKpFraction) < 1e-9;

  const tShown = running ? tEnd : t;
  // A run that ended before the playhead holds its final state.
  const idx = r ? nearestSnapshot(snaps, Math.min(tShown, endOf(snaps))) : 0;
  const frame = r ? snaps[idx] : null;
  const minusFrame = minusSnaps.length ? minusSnaps[nearestSnapshot(minusSnaps, Math.min(tShown, endOf(minusSnaps)))] : null;
  useEffect(() => {
    onFrame?.(frame ? { snap: frame, k, partnerSnap: minusFrame } : null);
  }, [frame, minusFrame, k, onFrame]);
  const hist = frame?.mHist && view !== 'rainbow' && r && r.model !== 'bare' ? frame.mHist : null;
  // Colour of the shown run: tinted when the pair has only its −a run.
  const color = r ? modelColor(r.model, pairMode && !plusRun ? -1 : 1) : 'var(--accent)';
  const minusColor = r ? modelColor(r.model, -1) : 'var(--accent)';

  const series: Series[] = [];
  const markers: Marker[] = [];
  const toY = (q: ArrayLike<number>) => {
    if (quantity === 'shell') return applyNorm(q, norm);
    const occ = occupation(k, q, density);
    if (quantity === 'occupation') return occ;
    return Float64Array.from(occ, (v, i) => v * k[i] ** 4);
  };
  const yMax = useMemo(() => {
    let max = 0;
    for (const snap of r ? [...snaps, ...minusSnaps] : [{ q: q0 }]) {
      for (let i = 0; i < k.length; i++) {
        const ki = k[i];
        if (ki > (quantity === 'occupation' ? 12 : xMax) || (quantity === 'occupation' && ki < 0.02)) continue;
        const shell = snap.q[i];
        const value = quantity === 'shell' ? shell * norm.scale
          : quantity === 'occupation' ? 2 * Math.PI ** 2 * density * shell / (ki * ki)
            : 2 * Math.PI ** 2 * density * shell * ki * ki;
        if (Number.isFinite(value) && value > max) max = value;
      }
    }
    return max;
  }, [r, snaps, minusSnaps, q0, k, quantity, norm.scale, density, xMax]);
  if (!r) {
    series.push({ id: 'initial', label: 'initial state', x: k, y: toY(q0), color: 'var(--accent)' });
  } else if (view !== 'rainbow') {
    if (view === 'both') {
      for (const { snap, i } of rainbowFrames) {
        series.push({
          id: `background-${i}`, label: '', x: k, y: toY(snap.q),
          color: rampColor(tEnd > 0 ? snap.t_s / tEnd : 0), width: 1.1,
          opacity: 0.3, decorative: true,
        });
      }
    }
    series.push({ id: 'initial', label: 't = 0', x: k, y: toY(snaps[0].q), color: 'var(--faint)', dashed: true, width: 1.4 });
    series.push({ id: 'now', label: `${pairMode && plusRun ? '+a, ' : ''}t = ${timeText(frame!.t_s)}`, x: k, y: toY(frame!.q), color, width: 2.2 });
    if (minusFrame) series.push({ id: 'now-minus', label: `−a, t = ${timeText(minusFrame.t_s)}`, x: k, y: toY(minusFrame.q), color: minusColor, width: 2.2 });
  } else {
    for (const { snap, i } of rainbowFrames) {
      series.push({
        id: `s${i}`, label: timeText(snap.t_s), x: k, y: toY(snap.q),
        color: rampColor(tEnd > 0 ? snap.t_s / tEnd : 0), width: 1.3, opacity: 0.85, decorative: true,
      });
    }
    const last = snaps[snaps.length - 1];
    series.push({ id: 'last', label: `t = ${timeText(last.t_s)}`, x: k, y: toY(last.q), color: rampColor(1), width: 2 });
  }
  if (r && snaps.length) {
    // The peak of the displayed state: follows the scrubber, or the last state in the rainbow view.
    const kpNow = view === 'rainbow' ? snaps[snaps.length - 1].kp_um_inv : frame!.kp_um_inv;
    markers.push({ id: 'kp', axis: 'x', value: kpNow, label: minusFrame ? 'kₚ(+a)' : 'kₚ(t)', color: 'var(--bad)', dashed: true });
    if (minusFrame) markers.push({ id: 'kp-minus', axis: 'x', value: minusFrame.kp_um_inv, label: 'kₚ(−a)', color: 'color-mix(in srgb, var(--bad) 55%, var(--panel))', dashed: true });
  }
  const kp0 = (r ? r.kp0_um_inv : desc.kp0_um_inv) || 1;
  if (kp0 > 0) {
    const targetVal = stopKpFraction * kp0;
    markers.push({
      id: 'target',
      axis: 'x',
      value: targetVal,
      label: 'target',
      color: 'var(--faint)',
      draggable: !running,
      min: 0.01 * kp0,
      max: 0.99 * kp0,
      title: `Target: ${(stopKpFraction * 100).toFixed(0)}% of initial peak kₚ,₀ (${targetVal.toFixed(3)} μm⁻¹). Drag to change stop target.`,
      onChange: (val) => {
        const nextFraction = Math.min(0.99, Math.max(0.01, val / kp0));
        onStopKpFractionChange(Math.round(nextFraction * 100) / 100);
      },
    });
  }

  const resumed = snaps.filter((s) => s.stage === 'continued');
  const tNow = time(frame?.t_s ?? 0);

  return (
    <Card
      label="Evolving spectrum"
      title={r ? `${MODEL_BY_ID[r.model].short} model${r.kernel === 'quantum' ? ', Bose +1' : ''}${pairMode ? ', ±a' : ''}` : 'Initial state'}
      ariaLabel="Evolving spectrum"
      actions={<div className="toolbar spectrum-actions">
        <Segmented<SpectrumQuantity> ariaLabel="Spectrum quantity" value={quantity === 'shell' ? normMode : quantity}
          onChange={(v) => {
            if (v === 'unit' || v === 'experimental') { setQuantity('shell'); onNormMode(v); }
            else setQuantity(v);
          }}
          options={[
            { id: 'unit', label: 'Nₖ/N' }, { id: 'experimental', label: 'Nₖ' },
            { id: 'occupation', label: 'nₖ' }, { id: 'k4', label: 'k⁴nₖ' },
          ]} />
        {r && <Segmented<TimeView> ariaLabel="Time view" value={view} onChange={(v) => { setView(v); if (v === 'rainbow') setPlaying(false); }}
          options={[
            { id: 'animate', label: 'Animate', title: 'Play the current state' },
            { id: 'rainbow', label: 'Rainbow', title: pairMode ? 'Not for a ±a pair: two histories at once are unreadable' : 'Overlay saved states, coloured by time', disabled: pairMode },
            { id: 'both', label: 'Both', title: pairMode ? 'Not for a ±a pair: two histories at once are unreadable' : 'Play the current state over a faint rainbow history', disabled: pairMode },
          ]} />}
        {r && view !== 'animate' && (
          <select className="curves-select" value={curveCount} onChange={(e) => setCurveCount(Number(e.target.value))}
            aria-label="Curves shown" title="How many saved states to overlay">
            {CURVE_COUNTS.map((c) => <option key={c} value={c}>{c} curves</option>)}
          </select>
        )}
      </div>}
    >
      {r && (
        <>
          <div className="timeline-summary">
            <span>Playback: 0 to {timeText(tEnd)} ({snaps.length} states)</span>
          </div>
          {view !== 'rainbow' ? (
            <div className="timeline">
              <button type="button" className="btn icon" onClick={() => {
                if (t >= tEnd) setT(0);
                setPlaying((p) => !p);
              }} disabled={running || tEnd <= 0} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
                <PlayIcon playing={playing} />
              </button>
              <div className="timeline-track">
                <input
                  type="range"
                  min={0}
                  max={tEnd || 1}
                  step={tEnd / 2000 || 1}
                  value={running ? tEnd : Math.min(t, tEnd)}
                  disabled={running}
                  onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
                  aria-label="Simulated time"
                />
                {stageMarks.map((mark) => {
                  const what = isTarget(mark.stage) ? `target kₚ = ${stopKpFraction} kₚ,₀`
                    : Number.isFinite(Number(mark.stage)) ? `kₚ = ${mark.stage} kₚ,₀` : mark.stage;
                  const who = mark.who ? `${mark.who}: ` : '';
                  return (
                    <button key={`${mark.who}${mark.i}-${mark.stage}`} type="button"
                      className={`timeline-mark ${mark.who === '−a' && pairMode && plusRun ? 'minus' : ''} ${isTarget(mark.stage) ? 'target' : ''}`}
                      style={{ left: `${tEnd > 0 ? 100 * mark.time / tEnd : 0}%`, ['--c' as string]: mark.who === '−a' ? minusColor : color }}
                      title={`${who}${what}, t = ${timeText(mark.time)}`}
                      aria-label={`Jump to ${who}${what} at ${timeText(mark.time)}`}
                      disabled={running}
                      onClick={() => { setPlaying(false); setT(mark.time); }} />
                  );
                })}
              </div>
              <span className="time">t = {tNow.value} {tNow.unit}</span>
            </div>
          ) : (
            <div className="timeline">
              <span className="hint">t = 0</span>
              <div className="ramp" aria-hidden="true" />
              <span className="hint">{timeText(tEnd)}</span>
            </div>
          )}
        </>
      )}
      <Plot
        series={series}
        markers={markers}
        xLabel="k (μm⁻¹)"
        yLabel={quantity === 'shell' ? norm.axis : quantity === 'occupation' ? 'nₖ (atoms per mode)' : 'k⁴nₖ (μm⁻⁴)'}
        xScale={quantity === 'occupation' ? 'log' : 'linear'}
        yScale={quantity === 'occupation' ? 'log' : 'linear'}
        xDomain={quantity === 'occupation' ? [0.02, 12] : [0, xMax]}
        yDomain={quantity === 'occupation' ? [0.3, 2 * Math.max(1, yMax)] : [0, yMax > 0 ? 1.08 * yMax : 1]}
        formatX={(v) => v.toFixed(3)}
        formatY={(v) => fmt(v, 4)}
        aspect={1.7}
        minHeight={260}
        maxHeight={480}
      />
      {frame && minusFrame && plusRun && (
        <DifferenceStrip k={k} plus={toY(frame.q)} minus={toY(minusFrame.q)} xDomain={quantity === 'occupation' ? [0.02, 12] : [0, xMax]}
          xScale={quantity === 'occupation' ? 'log' : 'linear'} color={minusColor} />
      )}
      {hist && <DressingHistogram hist={hist} loop={frame!.loop ?? null} color={color} t_s={frame!.t_s}
        minus={minusFrame?.mHist && plusRun ? { hist: minusFrame.mHist, loop: minusFrame.loop ?? null, color: minusColor } : undefined} />}
      {quantity === 'occupation' && (
        <p className="hint">Mean number of atoms per mode, <span>(2π)³ nₖ/V</span>. Modes below 0.3 atoms are cut off; the classical wave picture needs occupations well above one.</p>
      )}

      {r ? (
        <>
          <div className="toolbar">
            <div className="legend">
              {view !== 'rainbow' && <LegendItem color="var(--faint)" dashed label="t = 0" />}
              {view !== 'rainbow' && (
                <LegendItem color={color} label={`${pairMode ? (plusRun ? '+a' : '−a') + ', ' : ''}t = ${tNow.value} ${tNow.unit}, kₚ = ${fmt(frame!.kp_um_inv, 4)} μm⁻¹${pairMode && tShown > endOf(snaps) ? ` (ended at t = ${timeText(endOf(snaps))})` : ''}`} />
              )}
              {minusFrame && plusRun && (
                <LegendItem color={minusColor} label={`−a, kₚ = ${fmt(minusFrame.kp_um_inv, 4)} μm⁻¹${tShown > endOf(minusSnaps) ? ` (ended at t = ${timeText(endOf(minusSnaps))})` : ''}`} />
              )}
              {view === 'rainbow' && <span className="item">{rainbowFrames.length} saved states, coloured by time</span>}
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={onContinue}
              disabled={running || !canContinue || (stale && !live) || termination === 'pole' || termination === 'nonfinite'}
              title={termination === 'pole' ? 'This run stopped at the edge of the model; it cannot continue.' : 'Keep integrating from the last state.'}
            >
              Continue
            </button>
          </div>
          {resumed.length > 0 && (
            <p className="hint">Resumed at {resumed.map((s) => timeText(s.t_s)).join(', ')}. The timeline covers the whole history.</p>
          )}
          {stale && !live && <p className="hint">The setup has changed since this run. Run again to update the spectrum.</p>}
        </>
      ) : (
        <p className="hint">This is the initial spectrum. Run a model to watch the cascade: the peak <b>kₚ</b> moves down as particles flow to low momenta.</p>
      )}
    </Card>
  );
}

/**
 * The −a spectrum minus the +a spectrum at the time on screen, as a share of the +a peak. Dividing by the peak
 * rather than point by point keeps the sparse tails from dominating.
 */
function DifferenceStrip({ k, plus, minus, xDomain, xScale, color }: {
  k: Float64Array; plus: ArrayLike<number>; minus: ArrayLike<number>;
  xDomain: [number, number]; xScale: 'linear' | 'log'; color: string;
}) {
  let peak = 0;
  for (let i = 0; i < k.length; i++) if (k[i] >= xDomain[0] && k[i] <= xDomain[1] && plus[i] > peak) peak = plus[i];
  const y = Float64Array.from(k, (_, i) => (peak > 0 ? (100 * (minus[i] - plus[i])) / peak : 0));
  let amp = 0;
  for (let i = 0; i < k.length; i++) if (k[i] >= xDomain[0] && k[i] <= xDomain[1] && Number.isFinite(y[i])) amp = Math.max(amp, Math.abs(y[i]));
  const top = amp > 0 ? 1.15 * amp : 1;
  return (
    <div className="subpanel diff-strip">
      <Plot
        series={[{ id: 'diff', label: '−a minus +a', x: k, y, color, width: 1.8 }]}
        markers={[{ id: 'zero', axis: 'y', value: 0, color: 'var(--faint)', dashed: false }]}
        xLabel="k (μm⁻¹)"
        yLabel="−a minus +a (%)"
        xScale={xScale}
        xDomain={xDomain}
        yDomain={[-top, top]}
        formatX={(v) => v.toFixed(3)}
        formatY={(v) => `${v.toFixed(2)}%`}
        aspect={5}
        minHeight={96}
        maxHeight={130}
      />
      <p className="hint">The −a spectrum minus the +a spectrum at this time, as a share of the +a peak.</p>
    </div>
  );
}

/** Rate-weighted distribution of the collision dressing M in the state on screen; for a pair, of both runs. */
function DressingHistogram({ hist, loop, color, t_s, minus }: {
  hist: number[]; loop: number | null; color: string; t_s: number;
  minus?: { hist: number[]; loop: number | null; color: string };
}) {
  // At least [−0.1, 2.1]; widened in octave jumps where either distribution has weight.
  const LOWS = [-0.1, -1.1, -2.1, -4.1, -8.1, -16.1];
  const HIGHS = [2.1, 4.1, 8.1, 16.1, 32.1];
  const both = minus ? hist.map((v, i) => Math.max(v, minus.hist[i] ?? 0)) : hist;
  let first = both.findIndex((v) => v > 1e-4);
  let last = both.length - 1 - [...both].reverse().findIndex((v) => v > 1e-4);
  if (first < 0) { first = 0; last = both.length - 1; }
  const lo = LOWS.find((v) => v <= M_EDGES[first] + 1e-9) ?? LOWS[LOWS.length - 1];
  const hi = HIGHS.find((v) => v >= M_EDGES[last + 1] - 1e-9) ?? HIGHS[HIGHS.length - 1];
  const steps = (h: number[]) => {
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < h.length; i++) {
      const a = M_EDGES[i], b = M_EDGES[i + 1];
      if (b <= lo + 1e-9 || a >= hi - 1e-9) continue;
      const density = (100 * h[i]) / (b - a);
      x.push(a, b);
      y.push(density, density);
    }
    return { x, y };
  };
  const plus = steps(hist);
  const series: Series[] = [{ id: 'hist', label: minus ? '+a' : 'share of collision rate per unit M', ...plus, color, width: 1.8 }];
  const yAll = [...plus.y];
  if (minus) {
    const m = steps(minus.hist);
    series.push({ id: 'hist-minus', label: '−a', ...m, color: minus.color, width: 1.8 });
    yAll.push(...m.y);
  }
  const markers: Marker[] = [{ id: 'bare', axis: 'x', value: 1, label: 'bare', color: 'var(--faint)' }];
  if (loop != null) markers.push({ id: 'mean', axis: 'x', value: 1 + loop, label: minus ? '⟨M⟩ +a' : '⟨M⟩', color, dashed: true });
  if (minus?.loop != null) markers.push({ id: 'mean-minus', axis: 'x', value: 1 + minus.loop, label: '⟨M⟩ −a', color: minus.color, dashed: true });
  const clipped = hist[0] > 1e-4 || hist[hist.length - 1] > 1e-4;
  return (
    <div className="subpanel">
      <div className="label">Collision dressing at t = {timeText(t_s)}</div>
      <Plot
        series={series}
        markers={markers}
        xLabel="dressing M"
        yLabel="rate share per unit M (%)"
        xDomain={[lo, hi]}
        yDomain={[0, 1.1 * Math.max(...yAll, 1e-6)]}
        formatX={(v) => v.toFixed(3)}
        formatY={(v) => `${v.toFixed(1)}%`}
        aspect={3.2}
        minHeight={150}
        maxHeight={220}
      />
      <p className="hint">
        How strongly the loops dress the collisions of this state: the distribution of M over all collision events, weighted by
        their rate. M = 1 is the bare equation; the mean is 1 plus the loop strength. The axis spans at least −0.1 to 2.1 and
        widens in steps where the distribution has weight.{clipped ? ` Values beyond ${M_EDGES[0]} to ${M_EDGES[M_EDGES.length - 1]} are gathered in the end bins.` : ''}
      </p>
    </div>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ display: 'block', fill: 'currentColor' }}>
      {playing
        ? <><rect x="2" y="1.5" width="3" height="9" rx="0.6" /><rect x="7" y="1.5" width="3" height="9" rx="0.6" /></>
        : <path d="M3 1.4 L10.4 6 L3 10.6 Z" />}
    </svg>
  );
}
