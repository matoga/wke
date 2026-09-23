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
import { modelColor, nearestSnapshot, rampColor, runLabel } from '../ui/runView';
import { spectralExtent } from '../physics/descriptors';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { RunRecord } from '../state/useRunLibrary';

const PLAY_SECONDS = 6;
const OVERLAY_CURVES = 24;

export function SpectrumCard({
  record, stale, spectrum, norm, running, canContinue, onContinue,
}: {
  record: RunRecord | null;
  stale: boolean;
  spectrum: PreparedSpectrum;
  norm: NormSpec;
  running: boolean;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const r = record?.result ?? null;
  const [view, setView] = useState<'animate' | 'all'>('animate');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  const snaps = r?.snapshots ?? [];
  const tEnd = snaps.length ? snaps[snaps.length - 1].t_s : 0;
  const k = useMemo(() => (r ? Float64Array.from(r.k_um_inv) : spectrum.k), [r, spectrum]);

  // Jump to the end of a new run so the stop state is what one sees first.
  const runId = r?.runId;
  const nSnaps = snaps.length;
  useEffect(() => { setT(tEnd); setPlaying(false); }, [runId, nSnaps, tEnd]);

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
  const yMax = useMemo(() => {
    let m = 0;
    const list = r ? snaps : [{ q: q0 }];
    for (const s of list) for (let i = 0; i < k.length; i++) if (k[i] <= xMax && s.q[i] > m) m = s.q[i];
    return 1.08 * m * norm.scale;
  }, [r, snaps, q0, k, xMax, norm.scale]);

  const idx = r ? nearestSnapshot(snaps, t) : 0;
  const frame = r ? snaps[idx] : null;
  const color = r ? modelColor(r.model) : 'var(--accent)';

  const series: Series[] = [];
  const markers: Marker[] = [];
  if (!r) {
    series.push({ id: 'initial', label: 'initial state', x: k, y: applyNorm(q0, norm), color: 'var(--accent)' });
  } else if (view === 'animate') {
    series.push({ id: 'initial', label: 't = 0', x: k, y: applyNorm(snaps[0].q, norm), color: 'var(--faint)', dashed: true, width: 1.4 });
    series.push({ id: 'now', label: `t = ${timeText(frame!.t_s)}`, x: k, y: applyNorm(frame!.q, norm), color, width: 2.2 });
    markers.push({ id: 'kp', axis: 'x', value: frame!.kp_um_inv, label: 'kₚ', color });
  } else {
    const step = Math.max(1, Math.floor(snaps.length / OVERLAY_CURVES));
    for (let i = 0; i < snaps.length; i += step) {
      series.push({
        id: `s${i}`, label: timeText(snaps[i].t_s), x: k, y: applyNorm(snaps[i].q, norm),
        color: rampColor(tEnd > 0 ? snaps[i].t_s / tEnd : 0), width: 1.3, decorative: true,
      });
    }
    const last = snaps[snaps.length - 1];
    series.push({ id: 'last', label: `t = ${timeText(last.t_s)}`, x: k, y: applyNorm(last.q, norm), color: rampColor(1), width: 2 });
  }
  if (r) {
    markers.push({ id: 'target', axis: 'x', value: r.stopKpFraction * r.kp0_um_inv, label: 'target', color: 'var(--faint)' });
  }

  const resumed = snaps.filter((s) => s.stage === 'continued');
  const tNow = time(frame?.t_s ?? 0);

  return (
    <Card
      label="Evolving spectrum"
      title={r ? runLabel(r) : 'Initial state'}
      ariaLabel="Evolving spectrum"
      actions={r && (
        <Segmented
          ariaLabel="View"
          value={view}
          onChange={(v) => { setView(v); setPlaying(false); }}
          options={[{ id: 'animate', label: 'Animate' }, { id: 'all', label: 'All times' }]}
        />
      )}
    >
      <Plot
        series={series}
        markers={markers}
        xLabel="k (μm⁻¹)"
        yLabel={norm.axis}
        xDomain={[0, xMax]}
        yDomain={[0, yMax > 0 ? yMax : 1]}
        formatX={(v) => v.toFixed(3)}
        formatY={(v) => fmt(v, 4)}
        aspect={1.7}
        minHeight={260}
        maxHeight={480}
      />

      {r ? (
        <>
          {view === 'animate' ? (
            <div className="timeline">
              <button type="button" className="btn icon" onClick={() => {
                if (t >= tEnd) setT(0);
                setPlaying((p) => !p);
              }} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                min={0}
                max={tEnd}
                step={tEnd / 1000 || 1}
                value={Math.min(t, tEnd)}
                onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
                aria-label="Simulated time"
              />
              <span className="time">t = {tNow.value} {tNow.unit}</span>
            </div>
          ) : (
            <div className="timeline">
              <span className="hint">t = 0</span>
              <div className="ramp" aria-hidden="true" />
              <span className="hint">{timeText(tEnd)}</span>
            </div>
          )}
          <div className="toolbar">
            <div className="legend">
              {view === 'animate' && <LegendItem color="var(--faint)" dashed label="t = 0" />}
              {view === 'animate' && <LegendItem color={color} label={`t = ${tNow.value} ${tNow.unit}, kₚ = ${fmt(frame!.kp_um_inv, 4)} μm⁻¹`} />}
              {view === 'all' && <span className="item">{Math.min(snaps.length, OVERLAY_CURVES)} saved states, coloured by time</span>}
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={onContinue}
              disabled={running || !canContinue || stale || r.termination === 'pole' || r.termination === 'nonfinite'}
              title={r.termination === 'pole' ? 'This run stopped at the edge of the model; it cannot continue.' : 'Keep integrating from the last state.'}
            >
              Continue
            </button>
          </div>
          {resumed.length > 0 && (
            <p className="hint">Resumed at {resumed.map((s) => timeText(s.t_s)).join(', ')}. The timeline covers the whole history.</p>
          )}
          {stale && <p className="hint">The setup has changed since this run. Run again to update the spectrum.</p>}
        </>
      ) : (
        <p className="hint">This is the initial spectrum. Run a model to watch the cascade: the peak <b>kₚ</b> moves down as particles flow to low momenta.</p>
      )}
    </Card>
  );
}
