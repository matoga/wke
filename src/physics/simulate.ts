/**
 * One simulation run, independent of threading: resample the input spectrum
 * onto the solver grid of the chosen accuracy level, build the initial
 * occupation, integrate the chosen kinetic model and package the result.
 */

import { logarithmicGrid, interpolateQ, normalizeQ, trapz } from './grid';
import { trapezoidWeights } from './collision';
import { computeScales } from './scales';
import { peakMomentumFromF, INPUT_GRID } from './descriptors';
import { buildInitialF, runWKE } from './integrator';
import type { IntegrationResult, Snapshot } from './integrator';
import { SolverEngine } from './engine';
import type { EngineSpec, PreparedModel } from './engine';
import { completeRhs } from './rhs';
import type { RhsDiagnostics, RhsFunction } from './rhs';
import { SPECIES, DEFAULT_SPECIES_KEY, P_MIN, solverPMax } from './constants';
import { PRECISION } from './precision';
import { MODEL_BY_ID } from './models';
import { runKeyOf } from '../types/wke';
import type { WKEContinueRequest, WKELive, WKEProgress, WKEResult, WKERunRequest } from '../types/wke';

export type BackendSpec = Omit<EngineSpec, 'partition'>;

export interface SimulationBackend {
  threads: number;
  prepare(spec: BackendSpec): Promise<{ nEvents: number; setup_ms: number }>;
  rhs: RhsFunction;
}

/** Single-thread backend (tests, and browsers without nested workers). */
export function localBackend(engine = new SolverEngine()): SimulationBackend {
  let rhs: RhsFunction = () => { throw new Error('backend not prepared'); };
  return {
    threads: 1,
    async prepare(spec) {
      const prepared: PreparedModel = engine.prepare({ ...spec, partition: { stride: 1, offset: 0 } });
      rhs = completeRhs(prepared.partial, prepared.kind, prepared.rung);
      return { nEvents: prepared.nEvents, setup_ms: prepared.setup_ms };
    },
    rhs: (f, out) => rhs(f, out),
  };
}

/** Everything needed to extend a finished run further in time. */
export interface RunContext {
  request: WKERunRequest;
  spec: BackendSpec;
  finalF: Float64Array;
  grid: Float64Array;
  gridWeights: Float64Array;
  k_um_inv: Float64Array;
  scales: WKEResult['scales'];
  nSteps: number;
  /** absolute dimensionless time at the end of the run so far, and the lattice stride there */
  tauEnd: number;
  latticeStride: number;
  nEvents: number;
}

type ProgressFn = (m: WKEProgress | WKELive) => void;

function liveAdapter(
  runId: string, request: WKERunRequest, continuation: boolean,
  k_um_inv: Float64Array, kp0: number, stopKpFraction: number,
  onProgress?: ProgressFn,
) {
  if (!onProgress) return undefined;
  const kernel = MODEL_BY_ID[request.model].allowsQuantum ? request.kernel : 'classical';
  const grid = Array.from(k_um_inv);
  return (snapshot: Snapshot, stride: number) => onProgress({
    type: 'live', runId, runKey: runKeyOf(request.model, kernel, request.accuracy),
    continuation, model: request.model, kernel,
    k_um_inv: grid, kp0_um_inv: kp0, stopKpFraction,
    density_um3: request.density_um3,
    snapshot: { ...snapshot, q: Array.from(snapshot.q), mHist: snapshot.mHist ?? undefined },
    stride,
  });
}

function packResult(
  runId: string,
  req: WKERunRequest,
  continuation: boolean,
  res: IntegrationResult,
  k_um_inv: Float64Array,
  kp0: number,
  stopKpFraction: number,
  scales: WKEResult['scales'],
  setup: { nEvents: number; setup_ms: number },
  threads: number,
  gridCoverage: number,
): WKEResult {
  const kernel = MODEL_BY_ID[req.model].allowsQuantum ? req.kernel : 'classical';
  return {
    type: 'result',
    runId,
    runKey: runKeyOf(req.model, kernel, req.accuracy),
    model: req.model,
    kernel,
    accuracy: req.accuracy,
    continuation,
    k_um_inv: Array.from(k_um_inv),
    kp0_um_inv: kp0,
    stopKpFraction,
    reachedTarget: res.reachedTarget,
    tauTarget: res.tauTarget,
    dtTarget_s: res.dtTarget_s,
    termination: res.termination,
    terminationMessage: res.terminationMessage,
    snapshots: res.snapshots.map((s) => ({
      tau: s.tau,
      t_s: s.t_s,
      kp_um_inv: s.kp_um_inv,
      q: Array.from(s.q),
      dN_over_N: s.dN_over_N,
      dE_over_E: s.dE_over_E,
      stage: s.stage,
      lattice: s.lattice,
      loop: s.loop,
      mHist: s.mHist ?? undefined,
    })),
    latticeStride: res.latticeStride,
    breakdown: res.breakdown ? { t_s: res.breakdown.t_s, message: res.breakdown.message } : null,
    kpTrack: { t_s: res.kpTrack.t_s, kp: res.kpTrack.kp, loop: res.kpTrack.loop, pole: res.kpTrack.pole },
    evalTrack: { t_s: res.evalTrack.t_s, kp: res.evalTrack.kp },
    scales,
    nSteps: res.nSteps,
    nRhs: res.nRhs,
    nRejected: res.nRejected,
    wallTime_ms: res.wallTime_ms,
    setup_ms: setup.setup_ms,
    nEvents: setup.nEvents,
    threads,
    gridCoverage,
    maxDN: res.maxDN,
    maxDE: res.maxDE,
  };
}

function progressAdapter(runId: string, onProgress: ProgressFn | undefined, t0_s: number, wall0: number) {
  if (!onProgress) return undefined;
  return (info: { pct: number; tau: number; kp: number; nSteps: number; diag: RhsDiagnostics }) => onProgress({
    type: 'progress',
    runId,
    phase: 'integrating',
    pct: info.pct,
    t_s: info.tau * t0_s,
    kp: info.kp,
    nSteps: info.nSteps,
    loopDressing: info.diag.loopDressing,
    poleIndicator: info.diag.poleIndicator,
    elapsed_ms: performance.now() - wall0,
  });
}

export async function runSimulation(
  req: WKERunRequest,
  backend: SimulationBackend,
  onProgress?: ProgressFn,
  shouldStop?: () => boolean,
): Promise<{ result: WKEResult; context: RunContext }> {
  const wall0 = performance.now();
  const info = MODEL_BY_ID[req.model];
  const kernel = info.allowsQuantum ? req.kernel : 'classical';
  const species = SPECIES[req.speciesKey] ?? SPECIES[DEFAULT_SPECIES_KEY];
  const sc = computeScales(req.density_um3, req.a_a0, species);
  const level = PRECISION[req.accuracy];
  const pMax = solverPMax(sc.xi_um);
  const grid = logarithmicGrid(P_MIN, pMax, level.nGrid);
  const gridWeights = trapezoidWeights(grid);
  const k_um_inv = Float64Array.from(grid, (p) => p / sc.xi_um);

  // The solver grid is fixed in p, so a strongly non-reference ξ can move it
  // off the spectrum's support. Report how much weight survives the transfer
  // rather than silently renormalizing a truncated profile.
  const qOnSolver = interpolateQ(Array.from(INPUT_GRID), req.q, k_um_inv, { lower: 'power-law' });
  const gridCoverage = trapz(qOnSolver, k_um_inv);
  const f0 = buildInitialF(normalizeQ(qOnSolver, k_um_inv), k_um_inv, req.density_um3);
  const kp0 = peakMomentumFromF(k_um_inv, f0);

  const t0_s = sc.t0_s;
  const scales: WKEResult['scales'] = {
    xi_um: sc.xi_um, t0_s, ncal: sc.ncal, na_um2: sc.na_um2, density_um3: req.density_um3, sign: sc.sign,
  };

  onProgress?.({ type: 'progress', runId: req.runId, phase: 'setup', pct: 0, elapsed_ms: 0 });
  const spec: BackendSpec = {
    level: req.accuracy, pMax, model: info.solver, kernel, ncal: sc.ncal, sign: sc.sign,
  };
  const setup = await backend.prepare(spec);

  const res = await runWKE({
    rhs: backend.rhs,
    grid,
    gridWeights,
    t0_s,
    xi_um: sc.xi_um,
    kp0_um_inv: kp0,
    f0,
    tauMax: req.tauMax,
    rtol: level.rtol,
    atol: level.atol,
    nSnapshots: req.nSnapshots,
    stopKpFraction: req.stopKpFraction,
    tauEval: req.tEval_s ? req.tEval_s.map((t) => t / t0_s) : undefined,
    onProgress: progressAdapter(req.runId, onProgress, t0_s, wall0),
    onLive: liveAdapter(req.runId, req, false, k_um_inv, kp0, req.stopKpFraction, onProgress),
    shouldStop,
    stopAtBreakdown: req.stopAtBreakdown ?? true,
  });

  const result = packResult(req.runId, req, false, res, k_um_inv, kp0, req.stopKpFraction, scales, setup, backend.threads, gridCoverage);
  return {
    result,
    context: {
      request: req,
      spec,
      finalF: res.finalF,
      grid,
      gridWeights,
      k_um_inv,
      scales,
      nSteps: Math.max(res.nSteps, 50),
      tauEnd: res.finalTau,
      latticeStride: res.latticeStride,
      nEvents: setup.nEvents,
    },
  };
}

export async function continueSimulation(
  req: WKEContinueRequest,
  ctx: RunContext,
  backend: SimulationBackend,
  onProgress?: ProgressFn,
  shouldStop?: () => boolean,
): Promise<{ result: WKEResult; context: RunContext }> {
  const wall0 = performance.now();
  const level = PRECISION[ctx.request.accuracy];
  const setup = await backend.prepare(ctx.spec);
  const res = await runWKE({
    rhs: backend.rhs,
    grid: ctx.grid,
    gridWeights: ctx.gridWeights,
    t0_s: ctx.scales.t0_s,
    xi_um: ctx.scales.xi_um,
    kp0_um_inv: req.kp0_um_inv,
    f0: ctx.finalF,
    // The accepted-step budget, not elapsed time, ends a continuation. A
    // continuation that starts before the target still stops there.
    tauMax: Infinity,
    rtol: level.rtol,
    atol: level.atol,
    haltOnHalf: !req.alreadyReachedTarget,
    stopKpFraction: req.stopKpFraction,
    nSnapshots: req.nSnapshots,
    lattice: { offsetTau: ctx.tauEnd, stride: ctx.latticeStride },
    maxSteps: ctx.nSteps,
    onProgress: progressAdapter(req.runId, onProgress, ctx.scales.t0_s, wall0),
    onLive: liveAdapter(req.runId, ctx.request, true, ctx.k_um_inv, req.kp0_um_inv, req.stopKpFraction, onProgress),
    shouldStop,
    stopAtBreakdown: ctx.request.stopAtBreakdown ?? true,
  });
  const result = packResult(
    req.runId, ctx.request, true, res, ctx.k_um_inv, req.kp0_um_inv, req.stopKpFraction, ctx.scales,
    setup, backend.threads, 1,
  );
  return {
    result,
    context: { ...ctx, finalF: res.finalF, tauEnd: ctx.tauEnd + res.finalTau, latticeStride: res.latticeStride },
  };
}
