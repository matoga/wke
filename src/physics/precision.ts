/**
 * Accuracy levels. The user picks a level; everything numerical follows from
 * it so that only validated combinations are ever run. The convergence study
 * (scripts/convergence-bench.ts) shows the partner quadrature converged at
 * 12 nodes on 2 panels per segment, so the levels refine the state grid.
 */

export type AccuracyLevel = 'draft' | 'standard' | 'high' | 'reference';
/** 'parity' reproduces the fixture configuration exactly; tests only. */
export type SolverLevel = AccuracyLevel | 'parity';

export interface PrecisionSettings {
  label: string;
  /** state grid points */
  nGrid: number;
  /** Gauss nodes per panel below / above the target */
  nqLow: number;
  nqHigh: number;
  /** panels per quadrature segment */
  panels: number;
  rtol: number;
  atol: number;
  /** points of the loop-functional table H(x) */
  loopTable: number;
  /** target cell width of the channel-average tables, in p units */
  channelCell: number;
  /** maximum cells per channel-average table */
  channelCellsMax: number;
  /** Gauss nodes for the s-channel average (one-loop model) */
  sNodes: number;
}

export const PRECISION: Record<SolverLevel, PrecisionSettings> = {
  draft: {
    label: 'Draft', nGrid: 300, nqLow: 12, nqHigh: 12, panels: 1,
    rtol: 1e-5, atol: 1e-8, loopTable: 600, channelCell: 0.4, channelCellsMax: 32, sNodes: 3,
  },
  standard: {
    label: 'Standard', nGrid: 500, nqLow: 12, nqHigh: 12, panels: 2,
    rtol: 1e-7, atol: 1e-10, loopTable: 1000, channelCell: 0.2, channelCellsMax: 64, sNodes: 4,
  },
  high: {
    label: 'High', nGrid: 1000, nqLow: 12, nqHigh: 12, panels: 2,
    rtol: 1e-8, atol: 1e-11, loopTable: 1400, channelCell: 0.12, channelCellsMax: 96, sNodes: 5,
  },
  reference: {
    label: 'Reference', nGrid: 2000, nqLow: 12, nqHigh: 12, panels: 2,
    rtol: 1e-9, atol: 1e-12, loopTable: 1400, channelCell: 0.08, channelCellsMax: 128, sNodes: 6,
  },
  parity: {
    label: 'Parity', nGrid: 500, nqLow: 16, nqHigh: 16, panels: 1,
    rtol: 1e-7, atol: 1e-10, loopTable: 1000, channelCell: 0.2, channelCellsMax: 64, sNodes: 4,
  },
};

/** Approximate collision events per level, for the UI's cost hints. */
export const LEVEL_EVENTS: Record<AccuracyLevel, number> = {
  draft: 1.7e5, standard: 1.1e6, high: 2.2e6, reference: 4.4e6,
};

export const ACCURACY_LEVELS: AccuracyLevel[] = ['draft', 'standard', 'high', 'reference'];

export function nextLevel(level: AccuracyLevel): AccuracyLevel | null {
  const i = ACCURACY_LEVELS.indexOf(level);
  return i >= 0 && i < ACCURACY_LEVELS.length - 1 ? ACCURACY_LEVELS[i + 1] : null;
}
