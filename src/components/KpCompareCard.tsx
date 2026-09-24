/** k_p(t) of every run on the current setup, overlaid for comparison. */

import { useState } from 'react';
import { Badge, Card, LegendItem, Segmented } from '../ui/primitives';
import { Plot } from './Plot';
import type { PlotProps, PointMark, Series } from './Plot';
import { exportKpFigures } from './kpExport';
import { fmt, time } from '../ui/format';
import { loopVerdict, modelColor, modelDashed, runLabel, terminationVerdict } from '../ui/runView';
import { MODELS } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { RunRecord } from '../state/useRunLibrary';

export type KpYMode = 'ratio' | 'abs' | 'invk2' | 'rate';

export interface KpViewOptions {
  records: RunRecord[];
  selectedKey: string | null;
  yMode: KpYMode;
  rateScale: 'linear' | 'log';
  xChoice: 'linear' | 'log' | null;
  stopKpFraction: number;
  /** guide slope in units of ħ/m */
  guideSlope: number;
  hbarOverM_um2_per_s: number | null;
}

/** Everything one view of the card draws, except the draggable target marker. */
export function kpView(o: KpViewOptions) {
  const { records, selectedKey, yMode, rateScale, xChoice, stopKpFraction, guideSlope, hbarOverM_um2_per_s } = o;
  const ends = records.map((r) => r.result.kpTrack.t_s.at(-1) ?? 0).filter((t) => t > 0);
  const spread = ends.length > 1 ? Math.max(...ends) / Math.min(...ends) : 1;
  const invk2 = yMode === 'invk2';
  // Growth rate of 1/kₚ² against the loop parameter (k_ξ/kₚ)², both axes on one scale.
  const rate = yMode === 'rate' && hbarOverM_um2_per_s != null;
  // 1/kₚ² is read against a straight line, so that view is always lin-lin.
  const xScale: 'linear' | 'log' = invk2 ? 'linear' : rate ? rateScale : xChoice ?? (spread > 3 ? 'log' : 'linear');
  const yOf = (kp: number, kp0: number) => (invk2 ? 1 / (kp * kp) : yMode === 'ratio' ? kp / kp0 : kp);

  const series: Series[] = [];
  const points: PointMark[] = [];
  for (const rec of records) {
    const r = rec.result;
    if (rate) {
      const { x, y } = rateTrack(r, hbarOverM_um2_per_s!);
      series.push({
        id: rec.key, label: runLabel(r), x, y, color: modelColor(r.model),
        dashed: modelDashed(r.model, r.kernel), width: rec.key === selectedKey ? 2.6 : 1.7,
      });
      continue;
    }
    const t = r.kpTrack.t_s.map((v) => v * 1e3);
    const y = r.kpTrack.kp.map((v) => yOf(v, r.kp0_um_inv));
    const color = modelColor(r.model);
    series.push({
      id: rec.key, label: runLabel(r), x: xScale === 'log' ? t.slice(1) : t, y: xScale === 'log' ? y.slice(1) : y, color,
      dashed: modelDashed(r.model, r.kernel), width: rec.key === selectedKey ? 2.6 : 1.7,
    });
    if (r.dtTarget_s != null) {
      points.push({ id: `${rec.key}-hit`, x: r.dtTarget_s * 1e3, y: yOf(r.stopKpFraction * r.kp0_um_inv, r.kp0_um_inv), color, shape: 'dot', title: `${runLabel(r)}: ${time(r.dtTarget_s).value} ${time(r.dtTarget_s).unit}` });
    }
    if (r.termination === 'pole' || r.termination === 'nonfinite') {
      points.push({ id: `${rec.key}-stop`, x: t[t.length - 1], y: y[y.length - 1], color, shape: 'cross', title: r.terminationMessage ?? 'stopped' });
    }
  }
  const kp0 = records[0]?.result.kp0_um_inv ?? 1;
  // Range of the data alone (the guide line is added below and ignored here).
  let yTop = 0, yBottom = Infinity;
  for (const s of series) for (let i = 0; i < s.y.length; i++) {
    const v = s.y[i];
    if (!Number.isFinite(v)) continue;
    if (v > yTop) yTop = v;
    if (v < yBottom) yBottom = v;
  }
  let rateDomain: [number, number] | undefined;
  if (rate) {
    // The y range follows the data but skips isolated spikes: a difference over two nearly coincident steps
    // (a stop, a restart) can be off by orders of magnitude. The spikes are still drawn, clipped at the frame.
    let xLo = Infinity, xHi = 0, yLo = Infinity, yHi = 0;
    for (const s of series) {
      const spike = isolatedSpikes(s.y);
      for (let i = 0; i < s.y.length; i++) {
        const xv = s.x[i], yv = s.y[i];
        if (!Number.isFinite(yv) || !(xv > 0)) continue;
        if (rateScale === 'log' && !(yv > 0)) continue;
        xLo = Math.min(xLo, xv); xHi = Math.max(xHi, xv);
        if (spike[i]) continue;
        yLo = Math.min(yLo, yv); yHi = Math.max(yHi, yv);
      }
    }
    if (Number.isFinite(xLo) && yHi > 0) {
      rateDomain = rateScale === 'log' ? [yLo / 1.3, yHi * 1.3] : [Math.min(0, yLo), yHi * 1.08];
      // A constant rate s·ħ/m is a horizontal line here.
      series.push({
        id: 'guide', label: `${guideSlope.toPrecision(2)} ħ/m`, color: 'var(--faint)', dashed: true, width: 1.4, decorative: true,
        x: [xLo, xHi], y: [guideSlope, guideSlope],
      });
    }
  }
  const targetY = yOf(stopKpFraction * kp0, kp0);
  // 1/kₚ²: fit the data, but do not let a last step past the target stretch the axis far beyond it.
  const invTop = Math.min(yTop, 1.1 * targetY);
  const invPad = 0.05 * Math.max(invTop - yBottom, 1e-9);
  const invDomain: [number, number] = [Math.max(0, yBottom - invPad), invTop + invPad];
  if (invk2 && hbarOverM_um2_per_s != null && ends.length) {
    // 1/kₚ² = 1/kₚ,₀² + s (ħ/m) t, a guide to the eye through the initial point.
    // It ends a little past the top of the plotted range, so its slope is drawn
    // exactly however steep it is.
    const y0 = 1 / (kp0 * kp0);
    const rateUm2PerS = guideSlope * hbarOverM_um2_per_s;
    const tEnd = Math.min(Math.max(...ends), Math.max(0, (4 * invDomain[1] - y0) / rateUm2PerS));
    series.push({
      id: 'guide', label: `${guideSlope.toPrecision(2)} ħ/m`, color: 'var(--faint)', dashed: true, width: 1.4, decorative: true,
      x: [0, tEnd * 1e3], y: [y0, y0 + rateUm2PerS * tEnd],
    });
  }
  const hasGuide = (invk2 || rate) && hbarOverM_um2_per_s != null;
  return {
    invk2, rate, kp0, targetY, yOf, hasGuide,
    plot: {
      series,
      points: rate ? [] : points,
      xLabel: rate ? '1/(ξkₚ)²' : 't (ms)',
      yLabel: rate ? 'd(1/kₚ²)/dt (ħ/m)' : invk2 ? '1/kₚ² (μm²)' : yMode === 'ratio' ? 'kₚ / kₚ,₀' : 'kₚ (μm⁻¹)',
      xScale,
      yScale: rate ? rateScale : 'linear',
      xDomain: !rate && xScale === 'log' && ends.length ? [Math.max(...ends) * 1e3 * 1e-3, Math.max(...ends) * 1e3 * 1.05] : undefined,
      yDomain: rate ? rateDomain : invk2 ? invDomain : yMode === 'ratio' ? [0, 1.05] : [0, 1.05 * kp0],
      formatX: (v: number) => fmt(v, 4),
      formatY: (v: number) => fmt(v, 4),
      aspect: 2,
      minHeight: 220,
      maxHeight: 380,
    } satisfies PlotProps,
  };
}

/** d(1/kₚ²)/dt by centred differences over the accepted steps, in units of ħ/m, against (k_ξ/kₚ)². */
export function rateTrack(r: RunRecord['result'], hbarOverM_um2_per_s: number): { x: number[]; y: number[] } {
  const ts = r.kpTrack.t_s, kps = r.kpTrack.kp;
  const kXi = 1 / r.scales.xi_um;
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i < ts.length - 1; i++) {
    const dt = ts[i + 1] - ts[i - 1];
    if (!(dt > 0)) continue;
    const d = (1 / (kps[i + 1] * kps[i + 1]) - 1 / (kps[i - 1] * kps[i - 1])) / dt;
    x.push((kXi / kps[i]) ** 2);
    y.push(d / hbarOverM_um2_per_s);
  }
  return { x, y };
}

export function KpCompareCard({
  records, selectedKey, onSelect, stopKpFraction, onStopKpFractionChange, hbarOverM_um2_per_s,
}: {
  /** ħ/m of the species (μm²/s), for the 1/kₚ² guide line */
  hbarOverM_um2_per_s: number | null;
  /** runs on the current setup, in model order */
  records: RunRecord[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  stopKpFraction: number;
  onStopKpFractionChange?: (fraction: number) => void;
}) {
  const [yMode, setYMode] = useState<KpYMode>('ratio');
  const [rateScale, setRateScale] = useState<'linear' | 'log'>('log');
  const [xChoice, setXChoice] = useState<'linear' | 'log' | null>(null);
  // Guide slope in units of ħ/m, chosen on a log slider between 0.01 and 10.
  const [guideSlope, setGuideSlope] = useState(0.37);
  const [exporting, setExporting] = useState(false);
  const view = kpView({ records, selectedKey, yMode, rateScale, xChoice, stopKpFraction, guideSlope, hbarOverM_um2_per_s });
  const { invk2, rate, kp0, targetY, yOf, hasGuide } = view;
  const xScale = view.plot.xScale;
  const bare = records.find((r) => r.result.model === 'bare' && r.result.kernel === 'classical');
  const exportAll = async () => {
    setExporting(true);
    try {
      await exportKpFigures({ records, stopKpFraction, guideSlope, hbarOverM_um2_per_s });
    } finally {
      setExporting(false);
    }
  };
  return (
    <Card
      label="Relaxation"
      title="Peak momentum against time"
      ariaLabel="Peak momentum against time"
      actions={(
        <>
          <Segmented ariaLabel="Vertical axis" value={yMode} onChange={setYMode}
            options={[
              { id: 'ratio', label: 'kₚ/kₚ,₀' }, { id: 'abs', label: 'kₚ' },
              { id: 'invk2', label: '1/kₚ²', title: '1/kₚ² against t on linear axes, with an adjustable guide line' },
              { id: 'rate', label: 'd(1/kₚ²)/dt', title: 'Growth rate of 1/kₚ², in units of ħ/m, against the loop parameter 1/(ξkₚ)²', disabled: hbarOverM_um2_per_s == null },
            ]} />
          {rate ? (
            <Segmented ariaLabel="Axes" value={rateScale} onChange={setRateScale}
              options={[{ id: 'linear', label: 'lin-lin' }, { id: 'log', label: 'log-log' }]} />
          ) : (
            <Segmented ariaLabel="Time axis" value={xScale} onChange={setXChoice}
              options={[{ id: 'linear', label: 'linear t' }, { id: 'log', label: 'log t', disabled: invk2 }]} />
          )}
        </>
      )}
    >
      {records.length === 0 ? (
        <p className="hint">Runs of different models on the same spectrum and parameters appear here together. Use <b>Run all models</b> to fill it.</p>
      ) : (
        <>
          <Plot
            {...view.plot}
            markers={rate ? [] : [{
              id: 'stop',
              axis: 'y',
              value: targetY,
              label: 'target',
              color: 'var(--faint)',
              draggable: onStopKpFractionChange != null,
              min: Math.min(yOf(0.01 * kp0, kp0), yOf(0.99 * kp0, kp0)),
              max: Math.max(yOf(0.01 * kp0, kp0), yOf(0.99 * kp0, kp0)),
              title: `Target: ${(stopKpFraction * 100).toFixed(0)}% of initial peak kₚ,₀ (${(stopKpFraction * kp0).toFixed(3)} μm⁻¹). Drag vertically to adjust.`,
              onChange: (val) => {
                const rawFrac = invk2 ? 1 / (kp0 * Math.sqrt(Math.max(val, 1e-12))) : yMode === 'ratio' ? val : val / kp0;
                const clamped = Math.min(0.99, Math.max(0.01, rawFrac));
                onStopKpFractionChange?.(Math.round(clamped * 100) / 100);
              },
            }]}
            zoomable
          />
          {hasGuide && hbarOverM_um2_per_s != null && (
            <label className="guide-slider">
              <span className="label">Guide slope</span>
              <input type="range" min={-2} max={1} step={0.01} value={Math.log10(guideSlope)}
                onChange={(e) => setGuideSlope(10 ** Number(e.target.value))} aria-label="Guide slope in units of ħ/m" />
              <span className="guide-value">{guideSlope.toPrecision(2)} ħ/m</span>
              <span className="unit">({(guideSlope * hbarOverM_um2_per_s).toPrecision(3)} μm²/s)</span>
            </label>
          )}
          {rate && (
            <p className="hint">
              Each point is one solver step: the growth rate of 1/kₚ² (centred difference, in units of ħ/m) against the
              loop parameter 1/(ξkₚ)² = (kξ/kₚ)², which grows as the peak moves down. A constant rate is a horizontal line.
              In the 1/kₚ² view the same guide is a straight line of that slope.
            </p>
          )}
          <p className="hint">Scroll to zoom (Shift: horizontal only, Alt: vertical only), drag to pan, double-click to reset.</p>
          <div className="legend">
            {records.map((rec) => (
              <LegendItem key={rec.key} color={modelColor(rec.result.model)} dashed={modelDashed(rec.result.model, rec.result.kernel)}
                label={runLabel(rec.result)} selected={rec.key === selectedKey} onClick={() => onSelect(rec.key)} />
            ))}
            {hasGuide && hbarOverM_um2_per_s != null && <LegendItem color="var(--faint)" dashed label={rate ? `guide: ${guideSlope.toPrecision(2)} ħ/m` : `guide: slope ${guideSlope.toPrecision(2)} ħ/m`} />}
          </div>
          <div className="toolbar">
            <button type="button" className="btn" onClick={exportAll} disabled={exporting}
              title="One ZIP with every view of this panel as SVG and PNG, plus the plotted data as CSV">
              {exporting ? 'Exporting…' : 'Download all plots'}
            </button>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="n">Stop time</th>
                  <th className="n">vs bare</th>
                  <th>Loops</th>
                  <th>Outcome</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const r = rec.result;
                  const t = time(r.dtTarget_s);
                  const ratio = bare?.result.dtTarget_s != null && r.dtTarget_s != null ? r.dtTarget_s / bare.result.dtTarget_s : null;
                  const lv = loopVerdict(r);
                  const tv = terminationVerdict(r);
                  return (
                    <tr key={rec.key} onClick={() => onSelect(rec.key)} style={{ cursor: 'pointer' }}>
                      <td className="model-cell"><LegendItem color={modelColor(r.model)} dashed={modelDashed(r.model, r.kernel)} label={runLabel(r)} selected={rec.key === selectedKey} /></td>
                      <td className="n">{r.dtTarget_s != null ? `${t.value} ${t.unit}` : 'n/a'}</td>
                      <td className="n">{ratio != null ? ratio.toFixed(4) : 'n/a'}</td>
                      <td>{lv ? <Badge tone={lv.tone} title={lv.title}>{lv.text.split(':')[1]?.trim() ?? lv.text}</Badge> : <span className="muted">none</span>}</td>
                      <td><Badge tone={tv.tone} title={tv.title}>{tv.text}</Badge></td>
                      <td>{PRECISION[r.accuracy].label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Flags points that stand far off the median of their neighbours (four on each side). A spike of one or two
 * points cannot move that median, while a genuine trend moves the neighbours with it.
 */
export function isolatedSpikes(y: ArrayLike<number>): boolean[] {
  const out = new Array<boolean>(y.length).fill(false);
  const W = 4;
  for (let i = 0; i < y.length; i++) {
    const near: number[] = [];
    for (let j = Math.max(0, i - W); j <= Math.min(y.length - 1, i + W); j++) {
      if (j !== i && Number.isFinite(y[j])) near.push(y[j]);
    }
    if (near.length < 3) continue;
    near.sort((a, b) => a - b);
    const med = near[near.length >> 1];
    // Interquartile spread, so a neighbouring spike does not widen the tolerance.
    const spread = near[Math.floor(0.75 * (near.length - 1))] - near[Math.ceil(0.25 * (near.length - 1))];
    // Tolerance: the local spread (a steep but smooth stretch) or the size of the value itself.
    if (Math.abs(y[i] - med) > 3 * Math.max(spread, Math.abs(med), 1e-12)) out[i] = true;
  }
  return out;
}

/** Keep one record per model and kernel, preferring the requested accuracy. */
export function compatibleRuns(records: Record<string, RunRecord>, fingerprint: string | null): RunRecord[] {
  if (!fingerprint) return [];
  const list = Object.values(records).filter((r) => r.fingerprint === fingerprint);
  const order = (r: RunRecord) => MODELS.findIndex((m) => m.id === r.result.model) * 2 + (r.result.kernel === 'quantum' ? 1 : 0);
  return list.sort((a, b) => order(a) - order(b));
}
