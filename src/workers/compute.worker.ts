/**
 * Compute worker: owns one interleaved subset of targets and evaluates its
 * partial right-hand side on request.
 */

import { SolverEngine } from '../physics/engine';
import type { PreparedModel } from '../physics/engine';
import type { ComputeRequest, ComputeResponse } from './pool';

const engine = new SolverEngine();
let current: PreparedModel | null = null;

const post = (m: ComputeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'setup') {
      current = engine.prepare(m.spec);
      post({ type: 'ready', id: m.id, nEvents: current.nEvents, setup_ms: current.setup_ms });
      return;
    }
    if (!current) throw new Error('compute worker used before setup');
    const out = new Float64Array(m.f.length);
    const part = current.partial(m.f, out);
    post({ type: 'rhs', id: m.id, out, part }, [out.buffer]);
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};
