/** Messages exchanged with the WKE Web Worker. */

import type { KernelType } from '../physics/collision';

export type { KernelType };

export interface WKERunRequest {
  type: 'run';
  runId: string;
  kernel: KernelType;
  /** q(k) on the canonical descriptor grid, ∫ q dk = 1 */
  q: number[];
  density_um3: number;
  a_a0: number;
  speciesKey: string;
  tauMax: number;
  rtol: number;
  /** number of intermediate states saved for the timeline; more = smoother scrubbing, slightly slower */
  nSnapshots: number;
}

export interface WKEContinueRequest {
  type: 'continue';
  runId: string;
  kernel: KernelType;
  density_um3: number;
  a_a0: number;
  speciesKey: string;
  /** Legacy field; continuations now end after the retained accepted-step budget. */
  extraSeconds: number;
  /** the original run's k_p,0, so a not-yet-halved run can still detect the crossing */
  kp0_um_inv: number;
  /** whether the run being extended had already crossed k_p,0/2 */
  alreadyHalved: boolean;
  nSnapshots: number;
}

export interface WKECancelRequest {
  type: 'cancel';
}

export type WKERequest = WKERunRequest | WKEContinueRequest | WKECancelRequest;

export interface WKEProgress {
  type: 'progress';
  runId: string;
  phase: 'geometry' | 'integrating';
  pct: number;
  tau?: number;
  kp?: number;
  nSteps?: number;
}

export interface WKESnapshot {
  tau: number;
  t_s: number;
  kp_um_inv: number;
  q: number[];
  dN_over_N: number;
  dE_over_E: number;
  stage: string;
}

export interface WKEResult {
  type: 'result';
  runId: string;
  kernel: KernelType;
  /** true for a result produced by a 'continue' request — the caller merges it onto the prior result rather than replacing it */
  continuation?: boolean;
  /** physical k grid the solver actually used [μm⁻¹] */
  k_um_inv: number[];
  kp0_um_inv: number;
  reachedHalf: boolean;
  tauHalf: number | null;
  dtHalf_s: number | null;
  snapshots: WKESnapshot[];
  kpTrack: { t_s: number[]; kp: number[] };
  scales: {
    xi_um: number;
    t0_s: number;
    ncal: number;
    na_um2: number;
    density_um3: number;
  };
  nSteps: number;
  nRhs: number;
  nRejected: number;
  wallTime_ms: number;
  geometry_ms: number;
  nEvents: number;
  /** fraction of ∫q dk captured by the solver's own k grid (1 = full support) */
  gridCoverage: number;
  maxDN: number;
  maxDE: number;
}

export interface WKEError {
  type: 'error';
  runId: string;
  kernel: KernelType;
  message: string;
}

export type WKEResponse = WKEProgress | WKEResult | WKEError;

export type ParameterMode = 'known_NVa' | 'known_na' | 'measured_dt';

export interface PhysicsInputs {
  mode: ParameterMode;
  speciesKey: string;
  N: number | null;
  V_um3: number | null;
  density_um3: number | null;
  a_a0: number | null;
  dt_measured_s: number | null;
  /** Optional simulation-refined inverse result; only used in measured_dt mode. */
  na_override_um2?: number | null;
}

export interface DerivedPhysics {
  /** null when the mode does not identify it */
  density_um3: number | null;
  a_a0: number | null;
  na_um2: number | null;
  V_um3: number | null;
  N: number | null;
  /** true when n and a are separately known, so the quantum kernel is meaningful */
  quantumAvailable: boolean;
  notes: string[];
}

/** Immutable description of the inputs that produced a saved run artifact. */
export interface RunProvenance {
  origin: 'solver' | 'playground';
  spectrumLabel: string;
  mode: ParameterMode;
  speciesKey: string;
  density_um3: number | null;
  a_a0: number | null;
  na_um2: number | null;
  N: number | null;
  V_um3: number | null;
  tauMax: number;
  rtol: number;
  nSnapshots: number;
}
