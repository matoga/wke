/** k_p(t) of every run on the current setup, overlaid for comparison. */

import { useState } from 'react';
import { Badge, Card, LegendItem, Segmented } from '../ui/primitives';
import { Plot } from './Plot';
import type { PointMark, Series } from './Plot';
import { fmt, time } from '../ui/format';
import { loopVerdict, modelColor, modelDashed, runLabel, terminationVerdict } from '../ui/runView';
import { MODELS } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { RunRecord } from '../state/useRunLibrary';

export function KpCompareCard({
  records, selectedKey, onSelect, stopKpFraction, onStopKpFractionChange,
}: {
  /** runs on the current setup, in model order */
  records: RunRecord[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  stopKpFraction: number;
  onStopKpFractionChange?: (fraction: number) => void;
}) {
  const [yMode, setYMode] = useState<'ratio' | 'abs'>('ratio');
  const [xChoice, setXChoice] = useState<'linear' | 'log' | null>(null);
  const ends = records.map((r) => r.result.kpTrack.t_s.at(-1) ?? 0).filter((t) => t > 0);
  const spread = ends.length > 1 ? Math.max(...ends) / Math.min(...ends) : 1;
  const xScale = xChoice ?? (spread > 3 ? 'log' : 'linear');

  const bare = records.find((r) => r.result.model === 'bare' && r.result.kernel === 'classical');
  const series: Series[] = [];
  const points: PointMark[] = [];
  for (const rec of records) {
    const r = rec.result;
    const scale = yMode === 'ratio' ? 1 / r.kp0_um_inv : 1;
    const t = r.kpTrack.t_s.map((v) => v * 1e3);
    const y = r.kpTrack.kp.map((v) => v * scale);
    const color = modelColor(r.model);
    series.push({
      id: rec.key, label: runLabel(r), x: xScale === 'log' ? t.slice(1) : t, y: xScale === 'log' ? y.slice(1) : y, color,
      dashed: modelDashed(r.model, r.kernel), width: rec.key === selectedKey ? 2.6 : 1.7,
    });
    if (r.dtTarget_s != null) {
      points.push({ id: `${rec.key}-hit`, x: r.dtTarget_s * 1e3, y: r.stopKpFraction * r.kp0_um_inv * scale, color, shape: 'dot', title: `${runLabel(r)}: ${time(r.dtTarget_s).value} ${time(r.dtTarget_s).unit}` });
    }
    if (r.termination === 'pole' || r.termination === 'nonfinite') {
      points.push({ id: `${rec.key}-stop`, x: t[t.length - 1], y: y[y.length - 1], color, shape: 'cross', title: r.terminationMessage ?? 'stopped' });
    }
  }
  const kp0 = records[0]?.result.kp0_um_inv ?? 1;

  return (
    <Card
      label="Relaxation"
      title="Peak momentum against time"
      ariaLabel="Peak momentum against time"
      actions={(
        <>
          <Segmented ariaLabel="Vertical axis" value={yMode} onChange={setYMode}
            options={[{ id: 'ratio', label: 'kₚ/kₚ,₀' }, { id: 'abs', label: 'kₚ' }]} />
          <Segmented ariaLabel="Time axis" value={xScale} onChange={setXChoice}
            options={[{ id: 'linear', label: 'linear t' }, { id: 'log', label: 'log t' }]} />
        </>
      )}
    >
      {records.length === 0 ? (
        <p className="hint">Runs of different models on the same spectrum and parameters appear here together. Use <b>Run all models</b> to fill it.</p>
      ) : (
        <>
          <Plot
            series={series}
            points={points}
            markers={[{
              id: 'stop',
              axis: 'y',
              value: stopKpFraction * (yMode === 'ratio' ? 1 : kp0),
              label: 'target',
              color: 'var(--faint)',
              draggable: onStopKpFractionChange != null,
              min: 0.05 * (yMode === 'ratio' ? 1 : kp0),
              max: 0.99 * (yMode === 'ratio' ? 1 : kp0),
              title: `Target: ${(stopKpFraction * 100).toFixed(0)}% of initial peak kₚ,₀ (${(stopKpFraction * kp0).toFixed(3)} μm⁻¹). Drag vertically to adjust.`,
              onChange: (val) => {
                const rawFrac = yMode === 'ratio' ? val : val / kp0;
                const clamped = Math.min(0.99, Math.max(0.05, rawFrac));
                onStopKpFractionChange?.(Math.round(clamped * 100) / 100);
              },
            }]}
            xLabel="t (ms)"
            yLabel={yMode === 'ratio' ? 'kₚ / kₚ,₀' : 'kₚ (μm⁻¹)'}
            xScale={xScale}
            xDomain={xScale === 'log' && ends.length ? [Math.max(...ends) * 1e3 * 1e-3, Math.max(...ends) * 1e3 * 1.05] : undefined}
            yDomain={yMode === 'ratio' ? [0, 1.05] : [0, 1.05 * kp0]}
            formatX={(v) => fmt(v, 4)}
            formatY={(v) => fmt(v, 4)}
            aspect={2}
            minHeight={220}
            maxHeight={380}
          />
          <div className="legend">
            {records.map((rec) => (
              <LegendItem key={rec.key} color={modelColor(rec.result.model)} dashed={modelDashed(rec.result.model, rec.result.kernel)}
                label={runLabel(rec.result)} selected={rec.key === selectedKey} onClick={() => onSelect(rec.key)} />
            ))}
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

/** Keep one record per model and kernel, preferring the requested accuracy. */
export function compatibleRuns(records: Record<string, RunRecord>, fingerprint: string | null): RunRecord[] {
  if (!fingerprint) return [];
  const list = Object.values(records).filter((r) => r.fingerprint === fingerprint);
  const order = (r: RunRecord) => MODELS.findIndex((m) => m.id === r.result.model) * 2 + (r.result.kernel === 'quantum' ? 1 : 0);
  return list.sort((a, b) => order(a) - order(b));
}
