/**
 * Owns the solver worker, a queue of runs, and the library of finished runs
 * (the latest run of every model, kernel and accuracy). Runs of different
 * models on the same physical setup share a fingerprint and can be compared.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import { MODEL_BY_ID } from '../physics/models';
import type { AccuracyLevel } from '../physics/precision';
import { PRECISION, nextLevel } from '../physics/precision';
import { runKeyOf } from '../types/wke';
import type { WKEContinueRequest, WKELive, WKEResponse, WKEResult, WKERunRequest, WKESnapshot } from '../types/wke';

export interface RunSetup {
  fingerprint: string;
  q: number[];
  density_um3: number;
  a_a0: number;
  speciesKey: string;
  stopKpFraction: number;
}

export interface ConvergenceCheck {
  level: AccuracyLevel;
  /** (t_main − t_check)/t_check for the stop time */
  dtRel: number | null;
  /** max over the shared times of |k_p,main/k_p,check − 1| */
  kpMaxRel: number | null;
}

export interface RunRecord {
  key: string;
  result: WKEResult;
  fingerprint: string;
  check?: ConvergenceCheck | 'pending';
}

export interface LiveRun {
  sourceRunId: string;
  runId: string;
  runKey: string;
  model: WKELive['model'];
  kernel: WKELive['kernel'];
  k_um_inv: number[];
  kp0_um_inv: number;
  stopKpFraction: number;
  scales: Pick<WKEResult['scales'], 'density_um3'>;
  snapshots: WKESnapshot[];
}

export interface RunJob {
  model: ModelId;
  kernel: KernelType;
  accuracy: AccuracyLevel;
  checkConvergence: boolean;
  stopAtBreakdown: boolean;
}

interface QueuedJob extends RunJob {
  purpose: 'main' | 'check';
  mainKey?: string;
  tEval_s?: number[];
}

export interface RunProgress {
  running: boolean;
  stopping?: boolean;
  label: string;
  phase: 'setup' | 'integrating' | 'continuing' | '';
  pct: number;
  t_s?: number;
  kp?: number;
  loopDressing?: number;
  poleIndicator?: number;
  elapsed_ms?: number;
  queued: number;
  error?: string;
  /** a convergence check reruns the shown run and leaves its result valid */
  purpose?: 'main' | 'check';
}

const IDLE: RunProgress = { running: false, label: '', phase: '', pct: 0, queued: 0 };

const NSNAPSHOTS = 50;
const TAU_MAX = 1e6;

/** Keep event states and the lattice states that the current stride divides. */
export function onLattice(snaps: WKESnapshot[], stride: number): WKESnapshot[] {
  return snaps.filter((s) => s.lattice === undefined || s.lattice % stride === 0);
}

/** Append a continuation segment onto a finished run. */
function mergeContinuation(prior: WKEResult, seg: WKEResult): WKEResult {
  const offsetTau = prior.snapshots.at(-1)?.tau ?? 0;
  const offsetT = prior.kpTrack.t_s.at(-1) ?? 0;
  const snapshots = seg.snapshots.map((s) => ({
    ...s,
    tau: s.tau + offsetTau,
    t_s: s.t_s + offsetT,
    stage: s.stage === 'initial' ? 'continued' : s.stage === 'final' && !seg.reachedTarget ? 'extended' : s.stage,
  }));
  const reached = prior.reachedTarget || seg.reachedTarget;
  return {
    ...prior,
    reachedTarget: reached,
    tauTarget: prior.reachedTarget ? prior.tauTarget : seg.reachedTarget ? (seg.tauTarget ?? 0) + offsetTau : null,
    dtTarget_s: prior.reachedTarget ? prior.dtTarget_s : seg.reachedTarget ? (seg.dtTarget_s ?? 0) + offsetT : null,
    termination: seg.termination === 'steps' && reached ? 'target' : seg.termination,
    terminationMessage: seg.terminationMessage,
    snapshots: onLattice([...prior.snapshots, ...snapshots], seg.latticeStride),
    breakdown: prior.breakdown ?? (seg.breakdown ? { ...seg.breakdown, t_s: seg.breakdown.t_s + offsetT } : null),
    latticeStride: seg.latticeStride,
    kpTrack: {
      t_s: [...prior.kpTrack.t_s, ...seg.kpTrack.t_s.slice(1).map((t) => t + offsetT)],
      kp: [...prior.kpTrack.kp, ...seg.kpTrack.kp.slice(1)],
      loop: [...prior.kpTrack.loop, ...seg.kpTrack.loop.slice(1)],
      pole: [...prior.kpTrack.pole, ...seg.kpTrack.pole.slice(1)],
    },
    nSteps: prior.nSteps + seg.nSteps,
    nRhs: prior.nRhs + seg.nRhs,
    nRejected: prior.nRejected + seg.nRejected,
    wallTime_ms: prior.wallTime_ms + seg.wallTime_ms,
    maxDN: Math.max(prior.maxDN, seg.maxDN),
    maxDE: Math.max(prior.maxDE, seg.maxDE),
  };
}

function compareRuns(main: WKEResult, check: WKEResult, level: AccuracyLevel): ConvergenceCheck {
  const dtRel = main.dtTarget_s != null && check.dtTarget_s != null
    ? (main.dtTarget_s - check.dtTarget_s) / check.dtTarget_s : null;
  let kpMaxRel: number | null = null;
  const mt = main.kpTrack.t_s, mk = main.kpTrack.kp;
  const ct = check.evalTrack.t_s, ck = check.evalTrack.kp;
  let j = 0;
  for (let i = 0; i < ct.length; i++) {
    while (j < mt.length - 1 && mt[j] < ct[i]) j++;
    if (Math.abs(mt[j] - ct[i]) > 1e-9 * Math.max(1e-12, ct[i])) continue;
    const r = Math.abs(mk[j] / ck[i] - 1);
    kpMaxRel = kpMaxRel == null ? r : Math.max(kpMaxRel, r);
  }
  return { level, dtRel, kpMaxRel };
}

function sampleTimes(result: WKEResult, max = 60): number[] {
  const t = result.kpTrack.t_s.slice(1);
  if (t.length <= max) return t;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(t[Math.round(((i + 1) * (t.length - 1)) / max)]);
  return Array.from(new Set(out));
}

export function useRunLibrary(setup: RunSetup | null) {
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef('');
  const stopRequestedRef = useRef(false);
  const queueRef = useRef<QueuedJob[]>([]);
  const currentRef = useRef<QueuedJob | null>(null);
  const setupRef = useRef<RunSetup | null>(null);

  const [records, setRecords] = useState<Record<string, RunRecord>>({});
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress>(IDLE);
  const [live, setLive] = useState<LiveRun | null>(null);

  const label = (job: RunJob, purpose: 'main' | 'check') => {
    const m = MODEL_BY_ID[job.model];
    const kernel = job.kernel === 'quantum' && m.allowsQuantum ? ', Bose +1' : '';
    return `${m.short}${kernel} · ${PRECISION[job.accuracy].label}${purpose === 'check' ? ' convergence check' : ''}`;
  };

  const post = useCallback((w: Worker, job: QueuedJob) => {
    const s = setupRef.current;
    if (!s) return;
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = id;
    stopRequestedRef.current = false;
    currentRef.current = job;
    setLive(null);
    const req: WKERunRequest = {
      type: 'run',
      runId: id,
      model: job.model,
      kernel: job.kernel,
      accuracy: job.accuracy,
      q: s.q,
      density_um3: s.density_um3,
      a_a0: s.a_a0,
      speciesKey: s.speciesKey,
      stopKpFraction: s.stopKpFraction,
      stopAtBreakdown: job.stopAtBreakdown,
      tauMax: TAU_MAX,
      nSnapshots: NSNAPSHOTS,
      tEval_s: job.tEval_s,
    };
    setProgress({ running: true, label: label(job, job.purpose), phase: 'setup', pct: 0, queued: queueRef.current.length, purpose: job.purpose });
    w.postMessage(req);
  }, []);

  const advance = useCallback((w: Worker) => {
    const next = queueRef.current.shift();
    if (next) post(w, next);
    else {
      currentRef.current = null;
      setProgress(IDLE);
    }
  }, [post]);

  const spawn = useCallback((): Worker => {
    const w = new Worker(new URL('../workers/wke.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WKEResponse>) => {
      const msg = e.data;
      if (msg.runId !== runIdRef.current) return;
      if (msg.type === 'progress') {
        setProgress((prev) => ({
          ...prev,
          running: true,
          phase: prev.phase === 'continuing' ? 'continuing' : msg.phase,
          pct: msg.pct,
          t_s: msg.t_s,
          kp: msg.kp,
          loopDressing: msg.loopDressing,
          poleIndicator: msg.poleIndicator,
          elapsed_ms: msg.elapsed_ms,
        }));
        return;
      }
      if (msg.type === 'live') {
        if (currentRef.current?.purpose === 'check') return;
        setLive((prev) => {
          const prior = msg.continuation ? recordsRef.current[msg.runKey]?.result : undefined;
          const offsetT = prior?.snapshots.at(-1)?.t_s ?? 0;
          const offsetTau = prior?.snapshots.at(-1)?.tau ?? 0;
          const snapshot = { ...msg.snapshot, t_s: msg.snapshot.t_s + offsetT, tau: msg.snapshot.tau + offsetTau,
            stage: msg.continuation && msg.snapshot.stage === 'initial' ? 'continued' : msg.snapshot.stage };
          const first = prev?.sourceRunId === msg.runId ? prev : {
            sourceRunId: msg.runId, runId: prior?.runId ?? msg.runId, runKey: msg.runKey,
            model: msg.model, kernel: msg.kernel, 
            k_um_inv: msg.k_um_inv, kp0_um_inv: msg.kp0_um_inv,
            stopKpFraction: msg.stopKpFraction, scales: { density_um3: msg.density_um3 },
            snapshots: prior?.snapshots ?? [],
          };
          return { ...first, snapshots: onLattice([...first.snapshots, snapshot], msg.stride) };
        });
        return;
      }
      setLive(null);
      if (msg.type === 'error') {
        queueRef.current = [];
        currentRef.current = null;
        setProgress({ ...IDLE, error: msg.message });
        return;
      }
      const job = currentRef.current;
      if (msg.continuation) {
        setRecords((prev) => {
          const prior = prev[msg.runKey];
          if (!prior) return prev;
          return { ...prev, [msg.runKey]: { ...prior, result: mergeContinuation(prior.result, msg), check: undefined } };
        });
        advance(w);
        return;
      }
      if (job?.purpose === 'check' && job.mainKey) {
        const mainKey = job.mainKey;
        setRecords((prev) => {
          const main = prev[mainKey];
          if (!main) return prev;
          return { ...prev, [mainKey]: { ...main, check: stopRequestedRef.current || msg.termination === 'stopped'
            ? undefined : compareRuns(main.result, msg, msg.accuracy) } };
        });
        advance(w);
        return;
      }
      const fingerprint = setupRef.current?.fingerprint ?? '';
      const next = nextLevel(msg.accuracy);
      const wantCheck = !stopRequestedRef.current && job?.checkConvergence && next != null && msg.dtTarget_s != null;
      setRecords((prev) => ({
        ...prev,
        [msg.runKey]: { key: msg.runKey, result: msg, fingerprint, check: wantCheck ? 'pending' : undefined },
      }));
      setSelectedKey(msg.runKey);
      if (wantCheck && job) {
        queueRef.current.unshift({
          ...job, accuracy: next!, purpose: 'check', mainKey: msg.runKey, tEval_s: sampleTimes(msg),
        });
      }
      advance(w);
    };
    w.onerror = (e) => {
      queueRef.current = [];
      currentRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      setProgress({ ...IDLE, error: e.message || 'The solver stopped unexpectedly.' });
    };
    return w;
  }, [advance]);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  useEffect(() => { setupRef.current = setup; }, [setup]);

  const run = useCallback((jobs: RunJob[]) => {
    if (!setup || jobs.length === 0) return;
    setupRef.current = setup;
    workerRef.current ??= spawn();
    queueRef.current = jobs.map((j) => ({ ...j, purpose: 'main' as const }));
    advance(workerRef.current);
  }, [setup, spawn, advance]);

  const continueRun = useCallback((key: string) => {
    const rec = recordsRef.current[key];
    if (!rec || !workerRef.current) return;
    const id = `cont-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = id;
    stopRequestedRef.current = false;
    currentRef.current = null;
    queueRef.current = [];
    const targetFrac = setupRef.current?.stopKpFraction ?? rec.result.stopKpFraction;
    const currentKp = rec.result.snapshots.at(-1)?.kp_um_inv ?? rec.result.kp0_um_inv;
    // The last state of a finished run sits exactly on its target, so compare
    // with a tolerance; otherwise the continuation re-detects the same crossing
    // on its first step and stops at once.
    const reachedNewTarget = (rec.result.reachedTarget && targetFrac >= rec.result.stopKpFraction - 1e-12)
      || currentKp <= targetFrac * rec.result.kp0_um_inv * (1 + 1e-6);
    const req: WKEContinueRequest = {
      type: 'continue',
      runId: id,
      runKey: key,
      alreadyReachedTarget: reachedNewTarget,
      kp0_um_inv: rec.result.kp0_um_inv,
      stopKpFraction: targetFrac,
      nSnapshots: NSNAPSHOTS,
    };
    const m = MODEL_BY_ID[rec.result.model];
    setLive(null);
    setProgress({ running: true, label: `Continuing ${m.short}`, phase: 'continuing', pct: 0, queued: 0 });
    workerRef.current.postMessage(req);
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    queueRef.current = [];
    currentRef.current = null;
    runIdRef.current = '';
    stopRequestedRef.current = false;
    setLive(null);
    setRecords((prev) => {
      const next: Record<string, RunRecord> = {};
      for (const [k, r] of Object.entries(prev)) next[k] = r.check === 'pending' ? { ...r, check: undefined } : r;
      return next;
    });
    setProgress(IDLE);
  }, []);

  const clear = useCallback(() => {
    setRecords({});
    setSelectedKey(null);
    setLive(null);
  }, []);

  const stop = useCallback(() => {
    if (!workerRef.current || !runIdRef.current) return;
    queueRef.current = [];
    stopRequestedRef.current = true;
    setProgress((prev) => ({ ...prev, stopping: true, queued: 0 }));
    workerRef.current.postMessage({ type: 'stop', runId: runIdRef.current });
  }, []);

  /** Whether the worker still holds the end state needed to continue a run. */
  const canContinue = (key: string) => workerRef.current != null && key in recordsRef.current;

  return {
    records, live, selectedKey, setSelectedKey, progress, run, continueRun, stop, cancel, clear, canContinue,
    keyOf: runKeyOf,
  };
}
