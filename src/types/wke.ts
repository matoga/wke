/** Messages exchanged with the WKE Web Worker, and shared app types. */

import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import type { AccuracyLevel } from '../physics/precision';
import type { Termination } from '../physics/integrator';

export type { KernelType, ModelId, AccuracyLevel, Termination };

export interface WKERunRequest {
  type: 'run';
  runId: string;
  model: ModelId;
  kernel: KernelType;
  accuracy: AccuracyLevel;
  /** q(k) on the input grid, ∫ q dk = 1 */
  q: number[];
  density_um3: number;
  /** signed scattering length (a₀) */
  a_a0: number;
  speciesKey: string;
  /** Stop when k_p(t) / k_p,0 reaches this value (0 < value < 1). */
  stopKpFraction: number;
  /** stop when the model leaves its range of validity; otherwise report it and go on */
  stopAtBreakdown: boolean;
  /** safety bound on the dimensionless run time */
  tauMax: number;
  nSnapshots: number;
  /** physical times (s) at which to report k_p from the dense output */
  tEval_s?: number[];
  /** the ±a pair this run belongs to: its runs integrate side by side and end at a common time */
  pair?: { id: string; size: number };
}

export interface WKEContinueRequest {
  type: 'continue';
  runId: string;
  runKey: string;
  /** whether the run being extended had already reached its stop target */
  alreadyReachedTarget: boolean;
  kp0_um_inv: number;
  stopKpFraction: number;
  nSnapshots: number;
  /** a pair continues to this common time (s) instead of by a step budget */
  untilT_s?: number;
  pair?: { id: string; size: number };
}

export interface WKECancelRequest {
  type: 'cancel';
}

export interface WKEStopRequest {
  type: 'stop';
  runId: string;
}

export type WKERequest = WKERunRequest | WKEContinueRequest | WKECancelRequest | WKEStopRequest;

export interface WKEProgress {
  type: 'progress';
  runId: string;
  phase: 'setup' | 'integrating';
  pct: number;
  t_s?: number;
  kp?: number;
  nSteps?: number;
  loopDressing?: number;
  poleIndicator?: number;
  /** rate share of collisions at the pole (resummed models) */
  poleShare?: number;
  elapsed_ms: number;
}

export interface WKESnapshot {
  tau: number;
  t_s: number;
  kp_um_inv: number;
  q: number[];
  dN_over_N: number;
  dE_over_E: number;
  stage: string;
  /** index on the absolute sampling lattice; absent for event states */
  lattice?: number;
  /** collision-weighted loop dressing at this state */
  loop?: number;
  /** rate-weighted distribution of M on the bins of M_HIST (loop models) */
  mHist?: number[];
}

/** A display copy of an accepted state. It does not change the solver state. */
export interface WKELive {
  type: 'live';
  runId: string;
  runKey: string;
  continuation: boolean;
  model: ModelId;
  kernel: KernelType;
  k_um_inv: number[];
  kp0_um_inv: number;
  stopKpFraction: number;
  density_um3: number;
  snapshot: WKESnapshot;
  /** current lattice stride: states whose lattice index it does not divide are dropped */
  stride: number;
}

export interface WKEResult {
  type: 'result';
  runId: string;
  runKey: string;
  model: ModelId;
  kernel: KernelType;
  accuracy: AccuracyLevel;
  /** true for a result produced by a 'continue' request; merged onto the prior result */
  continuation: boolean;
  /** physical k grid the solver used (μm⁻¹) */
  k_um_inv: number[];
  kp0_um_inv: number;
  stopKpFraction: number;
  reachedTarget: boolean;
  tauTarget: number | null;
  dtTarget_s: number | null;
  termination: Termination;
  terminationMessage: string | null;
  snapshots: WKESnapshot[];
  /** lattice stride at the end of this segment */
  latticeStride: number;
  /** first breakdown of the model in this segment when the run continued past it (t_s from the segment start) */
  breakdown: { t_s: number; message: string } | null;
  /** `share`: rate share of collisions at the pole per step (resummed models; absent in older runs) */
  kpTrack: { t_s: number[]; kp: number[]; loop: number[]; pole: number[]; share?: number[] };
  evalTrack: { t_s: number[]; kp: number[] };
  scales: {
    xi_um: number;
    /** time unit t₀ (s) */
    t0_s: number;
    ncal: number;
    na_um2: number;
    density_um3: number;
    sign: 1 | -1;
  };
  nSteps: number;
  nRhs: number;
  nRejected: number;
  wallTime_ms: number;
  setup_ms: number;
  nEvents: number;
  threads: number;
  /** fraction of ∫q dk captured by the solver's own k grid (1 = full support) */
  gridCoverage: number;
  maxDN: number;
  maxDE: number;
}

export interface WKEError {
  type: 'error';
  runId: string;
  message: string;
}

export type WKEResponse = WKEProgress | WKELive | WKEResult | WKEError;

/** Sign of a run: +1 repulsive, −1 attractive. */
export type Sign = 1 | -1;

export const signOf = (a_a0: number): Sign => (a_a0 < 0 ? -1 : 1);

/** Identity of a run in the library and in the solver's continuation store. */
export function runKeyOf(model: ModelId, kernel: KernelType, accuracy: AccuracyLevel, sign: Sign): string {
  return `${model}:${kernel}:${accuracy}:${sign > 0 ? '+' : '-'}`;
}

/** The run key of the same run at the opposite sign of a. */
export function partnerKeyOf(key: string): string {
  return key.endsWith(':+') ? `${key.slice(0, -1)}-` : `${key.slice(0, -1)}+`;
}

/** The run key of the same run at the given sign of a. */
export const keyAtSign = (key: string, sign: Sign): string => `${key.slice(0, -1)}${sign > 0 ? '+' : '-'}`;

/** Sign of a run key. */
export const signOfKey = (key: string): Sign => (key.endsWith(':-') ? -1 : 1);
