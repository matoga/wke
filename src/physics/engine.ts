/**
 * Per-thread solver engine: builds and caches the grid, collision geometry,
 * channel tables and loop operator for an accuracy level, and hands out the
 * partial right-hand side of a kinetic model. Used directly for single-thread
 * runs and inside each compute worker for parallel runs.
 */

import { logarithmicGrid } from './grid';
import { buildGeometry } from './collision';
import type { CollisionGeometry, KernelType, TargetPartition } from './collision';
import { buildChannelGeometry } from './channels';
import type { ChannelGeometry } from './channels';
import { buildLoopOperator } from './loops';
import type { LoopOperator } from './loops';
import { loopRung, makeBarePartial, makeLoopPartial } from './rhs';
import type { PartialRhs, RhsKind } from './rhs';
import { P_MIN } from './constants';
import { PRECISION } from './precision';
import type { SolverLevel } from './precision';
import type { SolverModel } from './models';

export interface EngineSpec {
  level: SolverLevel;
  pMax: number;
  partition: TargetPartition;
  model: SolverModel;
  kernel: KernelType;
  ncal: number;
  sign: number;
  loopScale?: number;
  /** lower end of the solver grid (default P_MIN); analysis scripts lower it to follow k_p far below k_ξ */
  pMin?: number;
  /** grid points (default: the accuracy level's) */
  nGrid?: number;
}

export interface PreparedModel {
  partial: PartialRhs;
  kind: RhsKind;
  rung: number;
  grid: Float64Array;
  gridWeights: Float64Array;
  nEvents: number;
  setup_ms: number;
}

export function rhsKind(model: SolverModel): RhsKind {
  return model === 'bare' ? 'bare' : model === 'one-loop' ? 'one-loop' : 'resummed';
}

export class SolverEngine {
  private geomKey = '';
  private geom: CollisionGeometry | null = null;
  private channels: ChannelGeometry | null = null;
  private opKey = '';
  private op: LoopOperator | null = null;

  prepare(spec: EngineSpec): PreparedModel {
    const t0 = performance.now();
    const s = PRECISION[spec.level];
    const pMin = spec.pMin ?? P_MIN;
    const nGrid = spec.nGrid ?? s.nGrid;
    const gKey = `${spec.level}|${pMin}|${nGrid}|${spec.pMax}|${spec.partition.stride}|${spec.partition.offset}`;
    if (gKey !== this.geomKey || !this.geom) {
      const grid = logarithmicGrid(pMin, spec.pMax, nGrid);
      this.geom = null;
      this.channels = null;
      this.geom = buildGeometry(grid, spec.pMax / Math.SQRT2, {
        nqLow: s.nqLow, nqHigh: s.nqHigh, panels: s.panels,
      }, spec.partition);
      this.geomKey = gKey;
    }
    const geom = this.geom;

    let partial: PartialRhs;
    if (spec.model === 'bare') {
      partial = makeBarePartial(geom, spec.kernel, spec.ncal);
    } else {
      if (!this.channels) this.channels = buildChannelGeometry(geom, s.channelCell, s.channelCellsMax);
      const oKey = `${spec.level}|${pMin}|${nGrid}|${spec.pMax}`;
      if (oKey !== this.opKey || !this.op) {
        this.op = null;
        this.op = buildLoopOperator(geom.grid, s.loopTable);
        this.opKey = oKey;
      }
      partial = makeLoopPartial({
        model: spec.model,
        geom,
        channels: this.channels,
        loopOp: this.op,
        ncal: spec.ncal,
        sign: spec.sign,
        sNodes: s.sNodes,
        loopScale: spec.loopScale,
        kernel: spec.kernel,
      });
    }
    return {
      partial,
      kind: rhsKind(spec.model),
      rung: loopRung(spec.model),
      grid: geom.grid,
      gridWeights: geom.weights,
      nEvents: geom.nEvents,
      setup_ms: performance.now() - t0,
    };
  }
}
