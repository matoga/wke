/**
 * A pool of compute workers that split the collision sum by target. Each
 * worker owns targets i ≡ w (mod K); the partial right-hand sides add up.
 */

import type { EngineSpec } from '../physics/engine';
import { rhsKind } from '../physics/engine';
import { combinePartials, emptyPartial, finalizeDiagnostics } from '../physics/rhs';
import type { RhsDiagnostics, RhsPartial } from '../physics/rhs';

export type ComputeRequest =
  | { type: 'setup'; id: number; spec: EngineSpec }
  | { type: 'rhs'; id: number; f: Float64Array };

export type ComputeResponse =
  | { type: 'ready'; id: number; nEvents: number; setup_ms: number }
  | { type: 'rhs'; id: number; out: Float64Array; part: RhsPartial }
  | { type: 'error'; id: number; message: string };

type Pending = { resolve: (m: ComputeResponse) => void; reject: (e: Error) => void };

export class ComputePool {
  private workers: Worker[];
  private pending: Array<Map<number, Pending>>;
  private nextId = 1;
  private kind: ReturnType<typeof rhsKind> = 'bare';
  private rung = 1;

  private constructor(workers: Worker[]) {
    this.workers = workers;
    this.pending = workers.map(() => new Map());
    workers.forEach((w, i) => {
      w.onmessage = (e: MessageEvent<ComputeResponse>) => {
        const p = this.pending[i].get(e.data.id);
        if (!p) return;
        this.pending[i].delete(e.data.id);
        if (e.data.type === 'error') p.reject(new Error(e.data.message));
        else p.resolve(e.data);
      };
      w.onerror = (e) => {
        for (const p of this.pending[i].values()) p.reject(new Error(e.message || 'compute worker failed'));
        this.pending[i].clear();
      };
    });
  }

  /** null when nested workers are unavailable in this environment. */
  static create(size: number): ComputePool | null {
    if (size < 2 || typeof Worker === 'undefined') return null;
    try {
      const workers: Worker[] = [];
      for (let i = 0; i < size; i++) {
        workers.push(new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' }));
      }
      return new ComputePool(workers);
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private send(i: number, m: ComputeRequest): Promise<ComputeResponse> {
    return new Promise((resolve, reject) => {
      this.pending[i].set(m.id, { resolve, reject });
      this.workers[i].postMessage(m);
    });
  }

  async prepare(spec: Omit<EngineSpec, 'partition'>): Promise<{ nEvents: number; setup_ms: number }> {
    const K = this.workers.length;
    const replies = await Promise.all(this.workers.map((_, i) => this.send(i, {
      type: 'setup', id: this.nextId++, spec: { ...spec, partition: { stride: K, offset: i } },
    })));
    this.kind = rhsKind(spec.model);
    this.rung = spec.model === 'heuristic' ? 4 : 1;
    let nEvents = 0, setup = 0;
    for (const r of replies) {
      if (r.type === 'ready') { nEvents += r.nEvents; setup = Math.max(setup, r.setup_ms); }
    }
    return { nEvents, setup_ms: setup };
  }

  async rhs(f: Float64Array, out: Float64Array): Promise<RhsDiagnostics> {
    const replies = await Promise.all(this.workers.map((_, i) => this.send(i, {
      type: 'rhs', id: this.nextId++, f,
    })));
    out.fill(0);
    let part = emptyPartial();
    for (const r of replies) {
      if (r.type !== 'rhs') continue;
      const o = r.out;
      for (let j = 0; j < out.length; j++) out[j] += o[j];
      part = combinePartials(part, r.part);
    }
    return finalizeDiagnostics(this.kind, this.rung, part);
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}
