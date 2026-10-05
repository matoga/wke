/**
 * WKE solver worker. Runs the integrator off the main thread and fans the
 * collision sum out to a pool of compute workers, one per spare core. Keeps
 * the end state of every run (per model, kernel, accuracy and sign of a) so a
 * 'continue' request can resume the same trajectory.
 *
 * Several runs may be in flight at once (the two signs of a ±a pair): each
 * gets its own view of the backend, and their integrators interleave on the
 * same compute threads.
 */

import { continueSimulation, localBackend, runSimulation } from '../physics/simulate';
import type { RunContext, SimulationBackend } from '../physics/simulate';
import { PairRegistry } from '../physics/pairHold';
import { ComputePool } from './pool';
import type { WKERequest, WKEResponse } from '../types/wke';

const contexts = new Map<string, RunContext>();
let backend: SimulationBackend | null = null;
const active = new Set<string>();
const stopped = new Set<string>();
const pairs = new PairRegistry();

function post(m: WKEResponse): void {
  self.postMessage(m);
}

function poolBackend(pool: ComputePool): SimulationBackend {
  const slot = pool.newSlot();
  return {
    threads: pool.size,
    prepare: (spec) => pool.prepare(spec, slot),
    rhs: (f, out) => pool.rhs(f, out, slot),
    view: () => poolBackend(pool),
    release: () => pool.release(slot),
  };
}

function getBackend(): SimulationBackend {
  if (backend) return backend;
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  const pool = ComputePool.create(Math.max(1, Math.min(12, cores - 1)));
  backend = pool ? poolBackend(pool) : localBackend();
  return backend;
}

self.onmessage = async (e: MessageEvent<WKERequest>) => {
  const req = e.data;
  if (req.type === 'cancel') return;
  if (req.type === 'stop') {
    if (active.has(req.runId)) stopped.add(req.runId);
    return;
  }
  active.add(req.runId);
  const be = getBackend().view();
  const shouldStop = () => stopped.has(req.runId);
  const { hold, end } = pairs.join(req.runId, req.pair);
  try {
    if (req.type === 'run') {
      const { result, context } = await runSimulation(req, be, post, shouldStop, hold);
      contexts.set(result.runKey, context);
      post(result);
      return;
    }
    const ctx = contexts.get(req.runKey);
    if (!ctx) throw new Error('This run is no longer in the solver; run it again to continue.');
    const { result, context } = await continueSimulation(req, ctx, be, post, shouldStop, hold);
    contexts.set(result.runKey, context);
    post(result);
  } catch (err) {
    post({ type: 'error', runId: req.runId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    end();
    be.release();
    active.delete(req.runId);
    stopped.delete(req.runId);
  }
};
