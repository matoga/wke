/**
 * Owns the solver worker, a queue of runs, and the library of finished runs
 * (the latest run of every model, kernel, accuracy and sign of a). Runs on the
 * same physical setup share a fingerprint, which holds |a|, so the two signs
 * of a can be compared.
 *
 * A job runs one sign, or both signs of a ±a pair: the pair's two runs start
 * together from the same state and integrate concurrently in the worker. The
 * bare equation is even in a, so its pair runs once and the result stands for
 * both signs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import { MODEL_BY_ID } from '../physics/models';
import type { AccuracyLevel } from '../physics/precision';
import { PRECISION, nextLevel } from '../physics/precision';
import { partnerKeyOf, runKeyOf, signOfKey } from '../types/wke';
import type { Sign, WKEContinueRequest, WKELive, WKEResponse, WKEResult, WKERunRequest, WKESnapshot } from '../types/wke';

export interface RunSetup {
  /** identity of the physical setup; holds |a|, so both signs of a share it */
  fingerprint: string;
  q: number[];
  density_um3: number;
  /** |a| (a₀) */
  aAbs_a0: number;
  /** the signs a run covers: one, or both for a ±a pair */
  signs: Sign[];
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
  /** the bare equation's result at the other sign, which it equals (the equation is even in a) */
  mirrored?: boolean;
}

export interface LiveRun {
  sourceRunId: string;
  runId: string;
  runKey: string;
  model: WKELive['model'];
  kernel: WKELive['kernel'];
  sign: Sign;
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

type SignKey = '+' | '-';
const sk = (s: Sign): SignKey => (s > 0 ? '+' : '-');

interface QueuedJob extends RunJob {
  purpose: 'main' | 'check';
  signs: Sign[];
  /** convergence checks: the run each sign checks, and the times to compare at */
  mainKeys?: Partial<Record<SignKey, string>>;
  tEval?: Partial<Record<SignKey, number[]>>;
}

/** Progress of one run of the current job. */
export interface SignProgress {
  phase: 'setup' | 'integrating' | 'continuing';
  pct: number;
  t_s?: number;
  kp?: number;
  loopDressing?: number;
  poleIndicator?: number;
  poleShare?: number;
  elapsed_ms?: number;
  done?: boolean;
}

export interface RunProgress {
  running: boolean;
  stopping?: boolean;
  label: string;
  phase: 'setup' | 'integrating' | 'continuing' | '';
  /** the least advanced run of the job */
  pct: number;
  t_s?: number;
  kp?: number;
  loopDressing?: number;
  poleIndicator?: number;
  poleShare?: number;
  elapsed_ms?: number;
  queued: number;
  error?: string;
  /** a convergence check reruns the shown run and leaves its result valid */
  purpose?: 'main' | 'check';
  /** every run of the job, by sign of a; two entries for a pair */
  perSign: Partial<Record<SignKey, SignProgress>>;
}

const IDLE: RunProgress = { running: false, label: '', phase: '', pct: 0, queued: 0, perSign: {} };

const NSNAPSHOTS = 50;
const TAU_MAX = 1e6;

/** Keep event states and the lattice states that the current stride divides. */
export function onLattice(snaps: WKESnapshot[], stride: number): WKESnapshot[] {
  return snaps.filter((s) => s.lattice === undefined || s.lattice % stride === 0);
}

/** Append a continuation segment onto a finished run. */
export function mergeContinuation(prior: WKEResult, seg: WKEResult): WKEResult {
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
    termination: (seg.termination === 'steps' || seg.termination === 'tauMax') && reached ? 'target' : seg.termination,
    terminationMessage: seg.terminationMessage,
    snapshots: onLattice([...prior.snapshots, ...snapshots], seg.latticeStride),
    breakdown: prior.breakdown ?? (seg.breakdown ? { ...seg.breakdown, t_s: seg.breakdown.t_s + offsetT } : null),
    latticeStride: seg.latticeStride,
    kpTrack: {
      t_s: [...prior.kpTrack.t_s, ...seg.kpTrack.t_s.slice(1).map((t) => t + offsetT)],
      kp: [...prior.kpTrack.kp, ...seg.kpTrack.kp.slice(1)],
      loop: [...prior.kpTrack.loop, ...seg.kpTrack.loop.slice(1)],
      pole: [...prior.kpTrack.pole, ...seg.kpTrack.pole.slice(1)],
      share: prior.kpTrack.share && seg.kpTrack.share ? [...prior.kpTrack.share, ...seg.kpTrack.share.slice(1)] : undefined,
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

/** The bare equation is even in a: its result at one sign stands for the other. */
function mirror(rec: RunRecord): RunRecord {
  const r = rec.result;
  return {
    ...rec,
    key: partnerKeyOf(rec.key),
    mirrored: true,
    result: {
      ...r, runKey: partnerKeyOf(r.runKey), runId: `${r.runId}-mirror`,
      scales: { ...r.scales, sign: r.scales.sign > 0 ? -1 : 1, na_um2: -r.scales.na_um2 },
    },
  };
}

/** The signs a job actually integrates: the bare pair runs once. */
const runSigns = (job: QueuedJob): Sign[] => (job.model === 'bare' && job.purpose === 'main' ? job.signs.slice(0, 1) : job.signs);

interface Active {
  /** null for continuations */
  job: QueuedJob | null;
  runs: Map<string, Sign>;
  pending: number;
  /** convergence checks wanted once every run of the job is in */
  checks: Partial<Record<SignKey, { key: string; tEval: number[] }>>;
  /** the key selected when the job ends */
  select: string | null;
  /** set when a run of the job failed; the others are stopped and drained */
  error?: string;
}

export function useRunLibrary(setup: RunSetup | null) {
  const workerRef = useRef<Worker | null>(null);
  const stopRequestedRef = useRef(false);
  const queueRef = useRef<QueuedJob[]>([]);
  const activeRef = useRef<Active | null>(null);
  const setupRef = useRef<RunSetup | null>(null);

  const [records, setRecords] = useState<Record<string, RunRecord>>({});
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress>(IDLE);
  const [liveById, setLiveById] = useState<Record<string, LiveRun>>({});

  const label = (job: RunJob, purpose: 'main' | 'check', signs: Sign[]) => {
    const m = MODEL_BY_ID[job.model];
    const kernel = job.kernel === 'quantum' && m.allowsQuantum ? ', Bose +1' : '';
    const pair = signs.length > 1 ? ' ±a' : '';
    return `${m.short}${kernel}${pair} · ${PRECISION[job.accuracy].label}${purpose === 'check' ? ' convergence check' : ''}`;
  };

  /** Top-level progress from the runs of the job: the least advanced one leads. */
  const summarise = (prev: RunProgress, perSign: RunProgress['perSign']): RunProgress => {
    const runs = Object.values(perSign).filter((p): p is SignProgress => p != null);
    const lead = runs.filter((p) => !p.done).sort((a, b) => a.pct - b.pct)[0] ?? runs[0];
    if (!lead) return { ...prev, perSign };
    return {
      ...prev, perSign, pct: lead.pct, t_s: lead.t_s, kp: lead.kp, loopDressing: lead.loopDressing,
      poleIndicator: lead.poleIndicator, poleShare: lead.poleShare, elapsed_ms: lead.elapsed_ms,
      phase: prev.phase === 'continuing' ? 'continuing' : lead.phase,
    };
  };

  const post = useCallback((w: Worker, job: QueuedJob) => {
    const s = setupRef.current;
    if (!s) return;
    stopRequestedRef.current = false;
    const signs = runSigns(job);
    const runs = new Map<string, Sign>();
    const perSign: RunProgress['perSign'] = {};
    for (const sign of signs) {
      const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runs.set(id, sign);
      perSign[sk(sign)] = { phase: 'setup', pct: 0 };
    }
    activeRef.current = { job, runs, pending: runs.size, checks: {}, select: null };
    setLiveById({});
    setProgress({ running: true, label: label(job, job.purpose, job.signs), phase: 'setup', pct: 0, queued: queueRef.current.length, purpose: job.purpose, perSign });
    // the runs of a pair evolve over a common time span: the first to reach its target waits for the other
    const pair = runs.size > 1 ? { id: `pair-${[...runs.keys()][0]}`, size: runs.size } : undefined;
    for (const [id, sign] of runs) {
      const req: WKERunRequest = {
        type: 'run',
        runId: id,
        model: job.model,
        kernel: job.kernel,
        accuracy: job.accuracy,
        q: s.q,
        density_um3: s.density_um3,
        a_a0: sign * s.aAbs_a0,
        speciesKey: s.speciesKey,
        stopKpFraction: s.stopKpFraction,
        stopAtBreakdown: job.stopAtBreakdown,
        tauMax: TAU_MAX,
        nSnapshots: NSNAPSHOTS,
        tEval_s: job.tEval?.[sk(sign)],
        pair,
      };
      w.postMessage(req);
    }
  }, []);

  const advance = useCallback((w: Worker) => {
    const next = queueRef.current.shift();
    if (next) post(w, next);
    else {
      activeRef.current = null;
      setProgress(IDLE);
    }
  }, [post]);

  /** One run of the active job has returned; when all have, queue checks and move on. */
  const finishRun = useCallback((w: Worker) => {
    const act = activeRef.current;
    if (!act) return;
    act.pending -= 1;
    if (act.pending > 0) return;
    if (act.error) {
      activeRef.current = null;
      setProgress({ ...IDLE, error: act.error });
      return;
    }
    if (act.select) setSelectedKey(act.select);
    const signs = (Object.keys(act.checks) as SignKey[]);
    if (act.job && signs.length && !stopRequestedRef.current) {
      const next = nextLevel(act.job.accuracy)!;
      queueRef.current.unshift({
        ...act.job, accuracy: next, purpose: 'check',
        signs: signs.map((k) => (k === '+' ? 1 : -1) as Sign),
        mainKeys: Object.fromEntries(signs.map((k) => [k, act.checks[k]!.key])),
        tEval: Object.fromEntries(signs.map((k) => [k, act.checks[k]!.tEval])),
      });
    }
    advance(w);
  }, [advance]);

  const spawn = useCallback((): Worker => {
    const w = new Worker(new URL('../workers/wke.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WKEResponse>) => {
      const msg = e.data;
      const act = activeRef.current;
      const sign = act?.runs.get(msg.runId);
      if (!act || sign == null) return;
      if (msg.type === 'progress') {
        setProgress((prev) => summarise(prev, {
          ...prev.perSign,
          [sk(sign)]: {
            phase: prev.phase === 'continuing' ? 'continuing' : msg.phase, pct: msg.pct, t_s: msg.t_s, kp: msg.kp,
            loopDressing: msg.loopDressing, poleIndicator: msg.poleIndicator, poleShare: msg.poleShare, elapsed_ms: msg.elapsed_ms,
          },
        }));
        return;
      }
      if (msg.type === 'live') {
        if (act.job?.purpose === 'check') return;
        setLiveById((all) => {
          const prev = all[msg.runId];
          const prior = msg.continuation ? recordsRef.current[msg.runKey]?.result : undefined;
          const offsetT = prior?.snapshots.at(-1)?.t_s ?? 0;
          const offsetTau = prior?.snapshots.at(-1)?.tau ?? 0;
          const snapshot = { ...msg.snapshot, t_s: msg.snapshot.t_s + offsetT, tau: msg.snapshot.tau + offsetTau,
            stage: msg.continuation && msg.snapshot.stage === 'initial' ? 'continued' : msg.snapshot.stage };
          const first: LiveRun = prev ?? {
            sourceRunId: msg.runId, runId: prior?.runId ?? msg.runId, runKey: msg.runKey,
            model: msg.model, kernel: msg.kernel, sign,
            k_um_inv: msg.k_um_inv, kp0_um_inv: msg.kp0_um_inv,
            stopKpFraction: msg.stopKpFraction, scales: { density_um3: msg.density_um3 },
            snapshots: prior?.snapshots ?? [],
          };
          return { ...all, [msg.runId]: { ...first, snapshots: onLattice([...first.snapshots, snapshot], msg.stride) } };
        });
        return;
      }
      setLiveById((all) => {
        const { [msg.runId]: _gone, ...rest } = all;
        return rest;
      });
      if (msg.type === 'error') {
        // one failed run ends the job: stop its partner and drop the queue. The partner's stopped
        // result is still kept, since the solver saves its end state for a later Continue.
        if (!act.error) {
          act.error = msg.message;
          stopRequestedRef.current = true;
          queueRef.current = [];
          for (const id of act.runs.keys()) if (id !== msg.runId) w.postMessage({ type: 'stop', runId: id });
          setProgress((prev) => ({ ...prev, stopping: true, queued: 0, error: msg.message }));
        }
        finishRun(w);
        return;
      }
      setProgress((prev) => summarise(prev, { ...prev.perSign, [sk(sign)]: { ...(prev.perSign[sk(sign)] ?? { phase: 'integrating', pct: 1 }), pct: 1, done: true } }));
      const job = act.job;
      if (msg.continuation) {
        setRecords((prev) => {
          const prior = prev[msg.runKey];
          if (!prior) return prev;
          const merged: RunRecord = { ...prior, result: mergeContinuation(prior.result, msg), check: undefined };
          const partner = prev[partnerKeyOf(msg.runKey)];
          return { ...prev, [msg.runKey]: merged, ...(partner?.mirrored ? { [partner.key]: mirror(merged) } : {}) };
        });
        finishRun(w);
        return;
      }
      if (job?.purpose === 'check') {
        const mainKey = job.mainKeys?.[sk(sign)];
        if (mainKey) {
          setRecords((prev) => {
            const main = prev[mainKey];
            if (!main) return prev;
            const checked: RunRecord = { ...main, check: stopRequestedRef.current || msg.termination === 'stopped'
              ? undefined : compareRuns(main.result, msg, msg.accuracy) };
            const partner = prev[partnerKeyOf(mainKey)];
            return { ...prev, [mainKey]: checked, ...(partner?.mirrored ? { [partner.key]: mirror(checked) } : {}) };
          });
        }
        finishRun(w);
        return;
      }
      const fingerprint = setupRef.current?.fingerprint ?? '';
      const next = nextLevel(msg.accuracy);
      const wantCheck = !stopRequestedRef.current && job?.checkConvergence && next != null && msg.dtTarget_s != null;
      const rec: RunRecord = { key: msg.runKey, result: msg, fingerprint, check: wantCheck ? 'pending' : undefined };
      const mirrored = job && job.model === 'bare' && job.signs.length > 1 ? mirror(rec) : null;
      setRecords((prev) => ({ ...prev, [msg.runKey]: rec, ...(mirrored ? { [mirrored.key]: mirrored } : {}) }));
      if (wantCheck) act.checks[sk(sign)] = { key: msg.runKey, tEval: sampleTimes(msg) };
      if (!act.select || sign === (job?.signs[0] ?? sign)) act.select = msg.runKey;
      finishRun(w);
    };
    w.onerror = (e) => {
      queueRef.current = [];
      activeRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      setLiveById({});
      setProgress({ ...IDLE, error: e.message || 'The solver stopped unexpectedly.' });
    };
    return w;
  }, [finishRun]);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  useEffect(() => { setupRef.current = setup; }, [setup]);

  const run = useCallback((jobs: RunJob[]) => {
    if (!setup || jobs.length === 0) return;
    setupRef.current = setup;
    workerRef.current ??= spawn();
    queueRef.current = jobs.map((j) => ({ ...j, purpose: 'main' as const, signs: setup.signs }));
    advance(workerRef.current);
  }, [setup, spawn, advance]);

  /** Extend finished runs further in time; the runs of a pair continue together. */
  const continueRuns = useCallback((keys: string[]) => {
    const w = workerRef.current;
    if (!w) return;
    // a mirrored bare record follows its source
    const sources = Array.from(new Set(keys.map((k) => (recordsRef.current[k]?.mirrored ? partnerKeyOf(k) : k))))
      .filter((k) => recordsRef.current[k] && !recordsRef.current[k].mirrored);
    if (!sources.length) return;
    stopRequestedRef.current = false;
    queueRef.current = [];
    const runs = new Map<string, Sign>();
    const perSign: RunProgress['perSign'] = {};
    const targetFrac = setupRef.current?.stopKpFraction;
    // A pair continues together to twice its current (common) end time.
    const pair = sources.length > 1 ? { id: `pair-cont-${Date.now()}`, size: sources.length } : undefined;
    const untilT_s = pair ? 2 * Math.max(...sources.map((k) => recordsRef.current[k].result.snapshots.at(-1)?.t_s ?? 0)) : undefined;
    const reqs: WKEContinueRequest[] = sources.map((key) => {
      const rec = recordsRef.current[key];
      const id = `cont-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const sign = signOfKey(key);
      runs.set(id, sign);
      perSign[sk(sign)] = { phase: 'continuing', pct: 0 };
      const frac = targetFrac ?? rec.result.stopKpFraction;
      const currentKp = rec.result.snapshots.at(-1)?.kp_um_inv ?? rec.result.kp0_um_inv;
      // The last state of a finished run sits exactly on its target, so compare
      // with a tolerance; otherwise the continuation re-detects the same crossing
      // on its first step and stops at once.
      const reachedNewTarget = (rec.result.reachedTarget && frac >= rec.result.stopKpFraction - 1e-12)
        || currentKp <= frac * rec.result.kp0_um_inv * (1 + 1e-6);
      return {
        type: 'continue', runId: id, runKey: key, alreadyReachedTarget: reachedNewTarget,
        kp0_um_inv: rec.result.kp0_um_inv, stopKpFraction: frac, nSnapshots: NSNAPSHOTS, untilT_s, pair,
      };
    });
    activeRef.current = { job: null, runs, pending: runs.size, checks: {}, select: null };
    const m = MODEL_BY_ID[recordsRef.current[sources[0]].result.model];
    setLiveById({});
    setProgress({ running: true, label: `Continuing ${m.short}${keys.length > 1 ? ' ±a' : ''}`, phase: 'continuing', pct: 0, queued: 0, perSign });
    for (const r of reqs) w.postMessage(r);
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    queueRef.current = [];
    activeRef.current = null;
    stopRequestedRef.current = false;
    setLiveById({});
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
    setLiveById({});
  }, []);

  /** Stop every run of the current job after its current step, keeping what they have. */
  const stop = useCallback(() => {
    const act = activeRef.current;
    if (!workerRef.current || !act) return;
    queueRef.current = [];
    stopRequestedRef.current = true;
    setProgress((prev) => ({ ...prev, stopping: true, queued: 0 }));
    for (const id of act.runs.keys()) workerRef.current.postMessage({ type: 'stop', runId: id });
  }, []);

  /** Whether the worker still holds the end state needed to continue a run. */
  const canContinue = (key: string) => {
    const rec = recordsRef.current[key];
    return workerRef.current != null && rec != null && (!rec.mirrored || partnerKeyOf(key) in recordsRef.current);
  };

  const live = Object.values(liveById).sort((a, b) => b.sign - a.sign);

  return {
    records, live, selectedKey, setSelectedKey, progress, run, continueRuns, stop, cancel, clear, canContinue,
    keyOf: runKeyOf,
  };
}
