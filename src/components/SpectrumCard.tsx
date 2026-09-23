/**
 * The evolving shell spectrum N_k(k, t) of the selected run. Playback replays
 * the saved states by simulated time; nothing is re-integrated.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, LegendItem, Segmented } from '../ui/primitives';
import { Plot } from './Plot';
import type { Marker, Series } from './Plot';
import { applyNorm } from '../ui/norm';
import type { NormSpec } from '../ui/norm';
import { fmt, time, timeText } from '../ui/format';
import { displayFrames, modelColor, nearestSnapshot, occupation, rampColor, runLabel } from '../ui/runView';
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
  record, live, stale, spectrum, desc, stopKpFraction, onStopKpFractionChange, norm, density: inputDensity, normMode, onNormMode, running, canContinue, onContinue, onFrame,
}: {
  /** the state on screen, for readouts elsewhere */
  onFrame?: (frame: { snap: WKESnapshot; k: Float64Array } | null) => void;
  record: RunRecord | null;
  live: LiveRun | null;
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
  const r = live ?? record?.result ?? null;
  const termination = r && 'termination' in r ? r.termination : null;
  const [view, setView] = useState<TimeView>('both');
  const [quantity, setQuantity] = useState<'shell' | 'occupation' | 'k4'>('shell');
  const [curveCount, setCurveCountState] = useState<number>(() => load('curves', 60, isCurveCount));
  const setCurveCount = (c: number) => { setCurveCountState(c); save('curves', c); };
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const seenRun = useRef<string | null>(null);
  const seenEnd = useRef(0);

  const snaps = r?.snapshots ?? [];
  const tEnd = snaps.length ? snaps[snaps.length - 1].t_s : 0;
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
  const stageMarks = useMemo(() => snaps
    .map((snap, i) => ({ time: snap.t_s, stage: snap.stage, i }))
    .filter((mark) => mark.stage !== 'sample' && mark.stage !== 'initial' && mark.stage !== 'live')
    .filter((mark, i, marks) => i === 0 || Math.abs(mark.time - marks[i - 1].time) > Math.max(tEnd, 1) * 1e-10),
  [snaps, tEnd]);

  const idx = r ? nearestSnapshot(snaps, running ? tEnd : t) : 0;
  const frame = r ? snaps[idx] : null;
  useEffect(() => { onFrame?.(frame ? { snap: frame, k } : null); }, [frame, k, onFrame]);
  const hist = frame?.mHist && view !== 'rainbow' && r && r.model !== 'bare' ? frame.mHist : null;
  const color = r ? modelColor(r.model) : 'var(--accent)';

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
    for (const snap of r ? snaps : [{ q: q0 }]) {
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
  }, [r, snaps, q0, k, quantity, norm.scale, density, xMax]);
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
    series.push({ id: 'now', label: `t = ${timeText(frame!.t_s)}`, x: k, y: toY(frame!.q), color, width: 2.2 });
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
    markers.push({ id: 'kp', axis: 'x', value: kpNow, label: 'kₚ(t)', color: 'var(--bad)', dashed: true });
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
      title={r ? `${MODEL_BY_ID[r.model].short} model${r.kernel === 'quantum' ? ', Bose +1' : ''}` : 'Initial state'}
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
            { id: 'rainbow', label: 'Rainbow', title: 'Overlay saved states, coloured by time' },
            { id: 'both', label: 'Both', title: 'Play the current state over a faint rainbow history' },
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
                {stageMarks.map((mark) => (
                  <button key={`${mark.i}-${mark.stage}`} type="button" className="timeline-mark"
                    style={{ left: `${tEnd > 0 ? 100 * mark.time / tEnd : 0}%` }}
                    title={`${mark.stage}, ${timeText(mark.time)}`}
                    aria-label={`Jump to ${mark.stage} at ${timeText(mark.time)}`}
                    disabled={running}
                    onClick={() => { setPlaying(false); setT(mark.time); }} />
                ))}
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
      {hist && <DressingHistogram hist={hist} loop={frame!.loop ?? null} color={color} t_s={frame!.t_s} />}
      {quantity === 'occupation' && (
        <p className="hint">Mean number of atoms per mode, <span>(2π)³ nₖ/V</span>. Modes below 0.3 atoms are cut off; the classical wave picture needs occupations well above one.</p>
      )}

      {r ? (
        <>
          <div className="toolbar">
            <div className="legend">
              {view !== 'rainbow' && <LegendItem color="var(--faint)" dashed label="t = 0" />}
              {view !== 'rainbow' && <LegendItem color={color} label={`t = ${tNow.value} ${tNow.unit}, kₚ = ${fmt(frame!.kp_um_inv, 4)} μm⁻¹`} />}
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

/** Rate-weighted distribution of the collision dressing M in the state on screen. */
function DressingHistogram({ hist, loop, color, t_s }: { hist: number[]; loop: number | null; color: string; t_s: number }) {
  // At least [−0.1, 2.1]; widened in octave jumps where the distribution has weight.
  const LOWS = [-0.1, -1.1, -2.1, -4.1, -8.1, -16.1];
  const HIGHS = [2.1, 4.1, 8.1, 16.1, 32.1];
  let first = hist.findIndex((v) => v > 1e-4);
  let last = hist.length - 1 - [...hist].reverse().findIndex((v) => v > 1e-4);
  if (first < 0) { first = 0; last = hist.length - 1; }
  const lo = LOWS.find((v) => v <= M_EDGES[first] + 1e-9) ?? LOWS[LOWS.length - 1];
  const hi = HIGHS.find((v) => v >= M_EDGES[last + 1] - 1e-9) ?? HIGHS[HIGHS.length - 1];
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < hist.length; i++) {
    const a = M_EDGES[i], b = M_EDGES[i + 1];
    if (b <= lo + 1e-9 || a >= hi - 1e-9) continue;
    const density = (100 * hist[i]) / (b - a);
    x.push(a, b);
    y.push(density, density);
  }
  const markers: Marker[] = [{ id: 'bare', axis: 'x', value: 1, label: 'bare', color: 'var(--faint)' }];
  if (loop != null) markers.push({ id: 'mean', axis: 'x', value: 1 + loop, label: '⟨M⟩', color, dashed: true });
  const clipped = hist[0] > 1e-4 || hist[hist.length - 1] > 1e-4;
  return (
    <div className="subpanel">
      <div className="label">Collision dressing at t = {timeText(t_s)}</div>
      <Plot
        series={[{ id: 'hist', label: 'share of collision rate per unit M', x, y, color, width: 1.8 }]}
        markers={markers}
        xLabel="dressing M"
        yLabel="rate share per unit M (%)"
        xDomain={[lo, hi]}
        yDomain={[0, 1.1 * Math.max(...y, 1e-6)]}
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
