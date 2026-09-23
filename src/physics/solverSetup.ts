/**
 * Grid and collision geometry for one accuracy level. The geometry depends
 * only on the grid, so it is shared by every density, scattering length and
 * kinetic model with the same p range.
 */

import { logarithmicGrid } from './grid';
import { buildGeometry } from './collision';
import type { CollisionGeometry } from './collision';
import { P_MIN, solverPMax } from './constants';
import { PRECISION } from './precision';
import type { SolverLevel } from './precision';

export interface SolverSetup {
  level: SolverLevel;
  pMax: number;
  grid: Float64Array;
  geom: CollisionGeometry;
}

export function solverGrid(level: SolverLevel, xi_um: number): { pMax: number; grid: Float64Array } {
  const pMax = solverPMax(xi_um);
  return { pMax, grid: logarithmicGrid(P_MIN, pMax, PRECISION[level].nGrid) };
}

export function buildSolverSetup(level: SolverLevel, xi_um: number): SolverSetup {
  const { pMax, grid } = solverGrid(level, xi_um);
  const s = PRECISION[level];
  const geom = buildGeometry(grid, pMax / Math.SQRT2, {
    nqLow: s.nqLow, nqHigh: s.nqHigh, panels: s.panels,
  });
  return { level, pMax, grid, geom };
}
