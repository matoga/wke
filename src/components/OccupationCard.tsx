/**
 * Loop dressing of every loop-model run against time.
 */

import { Card, LegendItem } from '../ui/primitives';
import { Plot } from './Plot';
import type { Series } from './Plot';
import { fmt } from '../ui/format';
import { modelColor, modelDashed, runLabel } from '../ui/runView';
import type { RunRecord } from '../state/useRunLibrary';

export function OccupationCard({ records }: {
  records: RunRecord[];
}) {
  const loops = records.filter((rec) => rec.result.model !== 'bare');
  const series: Series[] = loops.map((rec) => ({
    id: rec.key,
    label: runLabel(rec.result),
    x: rec.result.kpTrack.t_s.map((t) => t * 1e3),
    y: rec.result.kpTrack.loop,
    color: modelColor(rec.result.model),
    dashed: modelDashed(rec.result.model, rec.result.kernel),
  }));
  const body = loops.length === 0 ? (
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

  return (
    <Card
      label="Loop dressing"
      title="Strength of the loops"
      ariaLabel="Loop dressing"
    >
      {body}
    </Card>
  );
}
