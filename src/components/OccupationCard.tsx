/**
 * Mode occupation of the selected run on log axes, and the loop dressing of
 * every loop-model run against time.
 */

import { useState } from 'react';
import { Card, LegendItem, Segmented } from '../ui/primitives';
import { Plot } from './Plot';
import { Tex } from '../ui/Tex';
import type { Series } from './Plot';
import { fmt, timeText } from '../ui/format';
import { modelColor, modelDashed, occupation, rampColor, runLabel } from '../ui/runView';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { RunRecord } from '../state/useRunLibrary';

export function OccupationCard({ record, records, spectrum, density }: {
  record: RunRecord | null;
  records: RunRecord[];
  spectrum: PreparedSpectrum;
  density: number | null;
}) {
  const [view, setView] = useState<'occupation' | 'dressing'>('occupation');
  const r = record?.result ?? null;
  const n = r?.scales.density_um3 ?? density ?? 1;

  let body;
  if (view === 'occupation') {
    const series: Series[] = [];
    let yMax = 1;
    if (r) {
      const k = r.k_um_inv;
      const snaps = r.snapshots;
      const picks = [0, 0.25, 0.5, 0.75, 1].map((u) => snaps[Math.round(u * (snaps.length - 1))]);
      const tEnd = snaps[snaps.length - 1].t_s || 1;
      picks.forEach((s, i) => {
        const f = occupation(k, s.q, n);
        for (const v of f) if (v > yMax) yMax = v;
        series.push({ id: `o${i}`, label: `t = ${timeText(s.t_s)}`, x: k, y: f, color: rampColor(s.t_s / tEnd), width: i === picks.length - 1 ? 2.2 : 1.5 });
      });
    } else {
      const f = occupation(spectrum.k, spectrum.q, n);
      for (const v of f) if (v > yMax) yMax = v;
      series.push({ id: 'o0', label: 'initial state', x: spectrum.k, y: f, color: 'var(--accent)' });
    }
    body = (
      <>
        <Plot series={series} xLabel="k (μm⁻¹)" yLabel="occupation per mode" xScale="log" yScale="log"
          yDomain={[0.3, 2 * yMax]} xDomain={[0.02, 12]} formatX={(v) => fmt(v, 3)} formatY={(v) => fmt(v, 3)}
          aspect={1.3} minHeight={220} maxHeight={340} />
        <div className="legend">
          {series.map((s) => <LegendItem key={s.id} color={s.color} label={s.label} />)}
        </div>
        <p className="hint">Mean number of atoms per mode, <Tex math="(2\pi)^3 n_k/V" />. Modes below 0.3 atoms are cut off; the classical wave picture needs occupations well above one.</p>
      </>
    );
  } else {
    const loops = records.filter((rec) => rec.result.model !== 'bare');
    const series: Series[] = loops.map((rec) => ({
      id: rec.key,
      label: runLabel(rec.result),
      x: rec.result.kpTrack.t_s.map((t) => t * 1e3),
      y: rec.result.kpTrack.loop,
      color: modelColor(rec.result.model),
      dashed: modelDashed(rec.result.model, rec.result.kernel),
    }));
    body = loops.length === 0 ? (
      <p className="hint">Run a loop model to see how strongly the loops dress the collisions as the spectrum evolves.</p>
    ) : (
      <>
        <Plot series={series} xLabel="t (ms)" yLabel="collision-weighted M − 1" formatX={(v) => fmt(v, 4)} formatY={(v) => fmt(v, 3)}
          markers={[{ id: 'zero', axis: 'y', value: 0, color: 'var(--faint)', dashed: false }]}
          aspect={1.3} minHeight={220} maxHeight={340} />
        <div className="legend">{series.map((s) => <LegendItem key={s.id} color={s.color} dashed={s.dashed} label={s.label} />)}</div>
        <p className="hint">Mean of <b>M − 1</b> over the collisions, weighted by their rate. Negative values slow the relaxation (screening), positive values speed it up. Beyond about 0.3 the one-loop expansion is not quantitative.</p>
      </>
    );
  }

  return (
    <Card
      label={view === 'occupation' ? 'Occupation' : 'Loop dressing'}
      title={view === 'occupation' ? 'Modes on log axes' : 'Strength of the loops'}
      ariaLabel="Occupation and loop dressing"
      actions={<Segmented ariaLabel="Panel" value={view} onChange={setView} options={[{ id: 'occupation', label: 'Occupation' }, { id: 'dressing', label: 'Dressing' }]} />}
    >
      {body}
    </Card>
  );
}
