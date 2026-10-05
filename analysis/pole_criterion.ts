/**
 * Pole criteria on saved states: re-evaluates the snapshots of finished runs of a resummed model
 * with the solver's own settings, once at the accuracy level's channel-table cell width and once
 * with cells half as wide, and records per snapshot
 *   - the largest sampled vertex weight 1/|1 − cL|² (the pole indicator, a diagnostic),
 *   - the share of the collision rate carried by collisions whose averaged dressing M exceeds M*
 *     (the breakdown rule, POLE_DRESSING_LIMIT, and a few other thresholds from the M histogram).
 *
 *   npx tsx analysis/pole_criterion.ts --out analysis/results/<folder> <run.json> [<run.json> ...]
 *
 * Writes <out>/pole_criterion.json; analysis/plots/pole_criterion.py makes the figure.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { logarithmicGrid } from '../src/physics/grid';
import { buildGeometry } from '../src/physics/collision';
import { buildChannelGeometry } from '../src/physics/channels';
import { buildLoopOperator } from '../src/physics/loops';
import { finalizeDiagnostics, loopRung, M_EDGES, makeLoopPartial, POLE_DRESSING_LIMIT } from '../src/physics/rhs';
import { PRECISION } from '../src/physics/precision';
import type { AccuracyLevel } from '../src/physics/precision';
import { SPECIES } from '../src/physics/constants';
import { computeScales } from '../src/physics/scales';
import type { SolverModel } from '../src/physics/models';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
if (outIdx < 0 || !args[outIdx + 1]) throw new Error('usage: --out <folder> <run.json> ...');
const outDir = args[outIdx + 1];
const files = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

/** thresholds M* read off the rate-weighted histogram; each is just below a bin edge */
const THRESHOLDS = [3, 5, 10, 20];
// the histogram share for M* counts the bins from the first edge at or above M*; the edges used are written out
const edgeIndex = (m: number) => M_EDGES.findIndex((e) => e >= m);
/** model ids renamed since the runs were made */
const RENAMED: Record<string, SolverModel> = { heuristic: 'heuristic-b' };

const results: unknown[] = [];
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const st = run.settings;
  const model = (RENAMED[st.model] ?? st.model) as SolverModel;
  if (model === 'bare' || model === 'one-loop') throw new Error(`${file}: ${model} has no pole`);
  const level = PRECISION[st.accuracy as AccuracyLevel];
  const sc = computeScales(st.density_um3, st.a_a0, SPECIES[st.species]);
  const grid = logarithmicGrid(st.pMin, st.pMax, st.nGrid);
  const geom = buildGeometry(grid, st.pMax / Math.SQRT2, { nqLow: level.nqLow, nqHigh: level.nqHigh, panels: level.panels });
  const op = buildLoopOperator(grid, level.loopTable);
  const resolutions = [
    { label: 'standard cells', cell: level.channelCell, maxCells: level.channelCellsMax },
    { label: 'half-width cells', cell: level.channelCell / 2, maxCells: 2 * level.channelCellsMax },
  ];
  const out = new Float64Array(grid.length);
  const rows = resolutions.map((r) => {
    const partial = makeLoopPartial({
      model, geom, channels: buildChannelGeometry(geom, r.cell, r.maxCells), loopOp: op, ncal: sc.ncal, sign: sc.sign,
      sNodes: level.sNodes, loopScale: st.loopScale ?? 1, kernel: st.kernel,
    });
    const weight: number[] = [], share: number[] = [], mMax: number[] = [], m999: number[] = [], m99: number[] = [];
    const shares: Record<string, number[]> = Object.fromEntries(THRESHOLDS.map((m) => [String(m), [] as number[]]));
    const t = Date.now();
    for (const f of run.snapshots.n_k as number[][]) {
      const d = finalizeDiagnostics('resummed', loopRung(model), partial(Float64Array.from(f), out));
      weight.push(d.poleIndicator);
      share.push(d.poleShare);
      // upper edge of the highest occupied bin, and the rate quantiles 99% and 99.9% of M (bin upper edges)
      const h = d.mHist ?? [];
      let top = -1, acc = 0, q99 = NaN, q999 = NaN;
      for (let b = 0; b < h.length; b++) {
        if (h[b] > 0) top = b;
        acc += h[b];
        if (Number.isNaN(q99) && acc >= 0.99) q99 = M_EDGES[b + 1];
        if (Number.isNaN(q999) && acc >= 0.999) q999 = M_EDGES[b + 1];
      }
      mMax.push(top >= 0 ? M_EDGES[top + 1] : NaN); m99.push(q99); m999.push(q999);
      for (const m of THRESHOLDS) {
        let s = 0;
        for (let b = edgeIndex(m); b < (d.mHist?.length ?? 0); b++) s += d.mHist![b];
        shares[String(m)].push(s);
      }
    }
    console.log(`${basename(file)} ${r.label}: ${run.snapshots.n_k.length} states, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    return { ...r, weight, share, shareByThreshold: shares, mMax, m99, m999 };
  });
  results.push({
    file: basename(file), model, a_a0: st.a_a0, state: st.stateName, accuracy: st.accuracy, kernel: st.kernel,
    X: run.snapshots.X, t_s: run.snapshots.t_s, resolutions: rows,
  });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'pole_criterion.json'), JSON.stringify({
  schema: 'wke-pole-criterion/1', poleDressingLimit: POLE_DRESSING_LIMIT, thresholds: THRESHOLDS,
  thresholdEdges: THRESHOLDS.map((m) => M_EDGES[edgeIndex(m)]), runs: results,
}));
console.log(`wrote ${join(outDir, 'pole_criterion.json')}`);
