/** Owns the WKE worker lifecycle, the run queue, and merging "continue" extensions. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KernelType } from '../physics/collision';
import type { WKEResponse, WKEResult, WKERunRequest, WKEContinueRequest } from '../types/wke';
import type { RunState } from '../components/SimulationPanel';

export interface RunSpec {
  kernels: KernelType[];
  q: number[];
  density_um3: number;
  a_a0: number;
  speciesKey: string;
  tauMax: number;
  rtol: number;
  nSnapshots: number;
}

const IDLE: RunState = { running: false, phase: '', pct: 0 };

/**
 * Append a continuation segment onto a finished result: offset its snapshots
 * and kp track by the prior segment's end, drop the duplicate boundary frame,
 * and keep whichever facts (dtHalf_s, gridCoverage, …) belong to the run as a
 * whole rather than to just this segment.
 */
function mergeContinuation(prior: WKEResult, seg: WKEResult): WKEResult {
  const offsetTau = prior.kpTrack.t_s.length > 0
    ? prior.snapshots[prior.snapshots.length - 1].tau : 0;
  const offsetT = prior.kpTrack.t_s.at(-1) ?? 0;

  const newSnapshots = seg.snapshots.map((s) => ({
    ...s,
    tau: s.tau + offsetTau,
    t_s: s.t_s + offsetT,
    // The segment's own t=0 frame marks exactly where it resumed, coinciding
    // with prior's last frame — kept (not dropped) so the boundary is visible
    // on the timeline. Its own 'final' is only the real Δt₁ᐟ₂ crossing if this
    // segment is the one that actually crossed it; otherwise it is just where
    // this extension's time budget ran out.
    stage: s.stage === 'initial' ? 'continued' : s.stage === 'final' && !seg.reachedHalf ? 'extended' : s.stage,
  }));

  return {
    ...prior,
    reachedHalf: prior.reachedHalf || seg.reachedHalf,
    tauHalf: prior.reachedHalf ? prior.tauHalf : (seg.reachedHalf ? (seg.tauHalf ?? 0) + offsetTau : null),
    dtHalf_s: prior.reachedHalf ? prior.dtHalf_s : (seg.reachedHalf ? (seg.dtHalf_s ?? 0) + offsetT : null),
    snapshots: [...prior.snapshots, ...newSnapshots],
    kpTrack: {
      t_s: [...prior.kpTrack.t_s, ...seg.kpTrack.t_s.slice(1).map((t) => t + offsetT)],
      kp: [...prior.kpTrack.kp, ...seg.kpTrack.kp.slice(1)],
    },
    nSteps: prior.nSteps + seg.nSteps,
    nRhs: prior.nRhs + seg.nRhs,
    nRejected: prior.nRejected + seg.nRejected,
    wallTime_ms: prior.wallTime_ms + seg.wallTime_ms,
    maxDN: Math.max(prior.maxDN, seg.maxDN),
    maxDE: Math.max(prior.maxDE, seg.maxDE),
    // gridCoverage/geometry_ms/nEvents/k_um_inv/scales/kp0_um_inv are properties
    // of the fixed physical setup, not of this segment — keep the original.
  };
}

export function useWKEWorker() {
  const workerRef = useRef<Worker | null>(null);
  const queueRef = useRef<KernelType[]>([]);
  const continueQueueRef = useRef<KernelType[]>([]);
  const specRef = useRef<RunSpec | null>(null);
  const runIdRef = useRef<string>('');

  const [runs, setRuns] = useState<Partial<Record<KernelType, WKEResult>>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const [state, setState] = useState<RunState>(IDLE);

  const spawn = useCallback((): Worker => {
    const w = new Worker(new URL('../workers/wke.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WKEResponse>) => {
      const msg = e.data;
      if (msg.runId !== runIdRef.current) return;

      if (msg.type === 'progress') {
        setState({
          running: true,
          phase: msg.phase === 'geometry'
            ? 'Building collision geometry…'
            : `Integrating ${queueRef.current[0] ?? continueQueueRef.current[0] ?? ''} kernel…`,
          pct: msg.pct,
          kp: msg.kp,
        });
        return;
      }

      if (msg.type === 'error') {
        queueRef.current = [];
        continueQueueRef.current = [];
        setState({ running: false, phase: '', pct: 0, message: msg.message });
        return;
      }

      if (msg.continuation) {
        setRuns((prev) => {
          const prior = prev[msg.kernel];
          if (!prior) return prev;
          const merged = { ...prev, [msg.kernel]: mergeContinuation(prior, msg) };
          runsRef.current = merged;
          return merged;
        });
        continueQueueRef.current = continueQueueRef.current.slice(1);
        const nextK = continueQueueRef.current[0];
        if (nextK && specRef.current) {
          postContinue(w, nextK, specRef.current, runsRef.current, runIdRef.current);
          setState({ running: true, phase: `Continuing ${nextK} kernel…`, pct: 0 });
        } else {
          setState(IDLE);
        }
        return;
      }

      setRuns((prev) => ({ ...prev, [msg.kernel]: msg }));
      queueRef.current = queueRef.current.slice(1);
      const next = queueRef.current[0];
      if (next && specRef.current) {
        postRun(w, next, specRef.current, runIdRef.current);
        setState({ running: true, phase: `Integrating ${next} kernel…`, pct: 0 });
      } else {
        setState(IDLE);
      }
    };
    w.onerror = (e) => {
      queueRef.current = [];
      continueQueueRef.current = [];
      setState({ running: false, phase: '', pct: 0, message: e.message || 'Worker crashed.' });
    };
    return w;
  }, []);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const run = useCallback((spec: RunSpec) => {
    if (spec.kernels.length === 0) return;
    workerRef.current ??= spawn();
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = id;
    queueRef.current = [...spec.kernels];
    continueQueueRef.current = [];
    specRef.current = spec;
    setRuns({});
    setState({ running: true, phase: 'Building collision geometry…', pct: 0 });
    postRun(workerRef.current, spec.kernels[0], spec, id);
  }, [spawn]);

  const continueRun = useCallback((nSnapshots?: number) => {
    const kernels = (Object.keys(runs) as KernelType[]);
    if (kernels.length === 0 || !specRef.current || !workerRef.current) return;
    const id = `cont-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = id;
    queueRef.current = [];
    continueQueueRef.current = kernels;
    const spec = { ...specRef.current, nSnapshots: nSnapshots ?? specRef.current.nSnapshots };
    setState({ running: true, phase: `Continuing ${kernels[0]} kernel…`, pct: 0 });
    postContinue(workerRef.current, kernels[0], spec, runs, id);
  }, [runs]);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    queueRef.current = [];
    continueQueueRef.current = [];
    runIdRef.current = '';
    setState(IDLE);
  }, []);

  const clear = useCallback(() => setRuns({}), []);

  return { runs, state, run, continueRun, cancel, clear };
}

function postRun(worker: Worker, kernel: KernelType, spec: RunSpec, runId: string): void {
  const req: WKERunRequest = {
    type: 'run',
    runId,
    kernel,
    q: spec.q,
    density_um3: spec.density_um3,
    a_a0: spec.a_a0,
    speciesKey: spec.speciesKey,
    tauMax: spec.tauMax,
    rtol: spec.rtol,
    nSnapshots: spec.nSnapshots,
  };
  worker.postMessage(req);
}

function postContinue(
  worker: Worker, kernel: KernelType, spec: RunSpec,
  runs: Partial<Record<KernelType, WKEResult>>, runId: string,
): void {
  const prior = runs[kernel];
  if (!prior) return;
  const req: WKEContinueRequest = {
    type: 'continue',
    runId,
    kernel,
    density_um3: spec.density_um3,
    a_a0: spec.a_a0,
    speciesKey: spec.speciesKey,
    // The worker uses the retained accepted-step budget. This field remains in
    // the message type for compatibility with existing callers but is ignored.
    extraSeconds: 0,
    kp0_um_inv: prior.kp0_um_inv,
    alreadyHalved: prior.reachedHalf,
    nSnapshots: spec.nSnapshots,
  };
  worker.postMessage(req);
}
