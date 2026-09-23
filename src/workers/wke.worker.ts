/**
 * WKE solver worker. Runs the integrator off the main thread and fans the
 * collision sum out to a pool of compute workers, one per spare core. Keeps
 * the end state of every run (per model, kernel and accuracy) so a 'continue'
 * request can resume the same trajectory.
 */

import { continueSimulation, localBackend, runSimulation } from '../physics/simulate';
import type { RunContext, SimulationBackend } from '../physics/simulate';
import { ComputePool } from './pool';
import type { WKERequest, WKEResponse } from '../types/wke';

const contexts = new Map<string, RunContext>();
let backend: SimulationBackend | null = null;
let activeRunId: string | null = null;
let stopRunId: string | null = null;

function post(m: WKEResponse): void {
  self.postMessage(m);
}

function getBackend(): SimulationBackend {
  if (backend) return backend;
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  const pool = ComputePool.create(Math.max(1, Math.min(12, cores - 1)));
  if (pool) {
    backend = {
      threads: pool.size,
      prepare: (spec) => pool.prepare(spec),
      rhs: (f, out) => pool.rhs(f, out),
    };
  } else {
    backend = localBackend();
  }
  return backend;
}

self.onmessage = async (e: MessageEvent<WKERequest>) => {
  const req = e.data;
  if (req.type === 'cancel') return;
  if (req.type === 'stop') {
    if (req.runId === activeRunId) stopRunId = req.runId;
    return;
  }
  activeRunId = req.runId;
  stopRunId = null;
  try {
    const be = getBackend();
    if (req.type === 'run') {
      const { result, context } = await runSimulation(req, be, post, () => stopRunId === req.runId);
      contexts.set(result.runKey, context);
      post(result);
      return;
    }
    const ctx = contexts.get(req.runKey);
    if (!ctx) throw new Error('This run is no longer in the solver; run it again to continue.');
    const { result, context } = await continueSimulation(req, ctx, be, post, () => stopRunId === req.runId);
    contexts.set(result.runKey, context);
    post(result);
  } catch (err) {
    post({ type: 'error', runId: req.runId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    activeRunId = null;
    stopRunId = null;
  }
};
