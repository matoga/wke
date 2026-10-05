/**
 * A pool of compute workers that split the collision sum by target. Each
 * worker owns targets i ≡ w (mod K); the partial right-hand sides add up.
 * Several prepared models ("slots") can live side by side, so that two runs
 * (the signs of a ±a pair) integrate at once on the same threads; they share
 * each worker's grid and tables, which do not depend on the model.
 */

import type { EngineSpec } from '../physics/engine';
import { rhsKind } from '../physics/engine';
import { combinePartials, emptyPartial, finalizeDiagnostics, loopRung } from '../physics/rhs';
import type { RhsDiagnostics, RhsPartial } from '../physics/rhs';

export type ComputeRequest =
  | { type: 'setup'; id: number; slot: number; spec: EngineSpec }
  | { type: 'rhs'; id: number; slot: number; f: Float64Array }
  | { type: 'release'; id: number; slot: number };

export type ComputeResponse =
  | { type: 'ready'; id: number; nEvents: number; setup_ms: number }
  | { type: 'released'; id: number }
  | { type: 'rhs'; id: number; out: Float64Array; part: RhsPartial }
  | { type: 'error'; id: number; message: string };

type Pending = { resolve: (m: ComputeResponse) => void; reject: (e: Error) => void };

export class ComputePool {
  private workers: Worker[];
  private pending: Array<Map<number, Pending>>;
  private nextId = 1;
  private nextSlot = 1;
  private slots = new Map<number, { kind: ReturnType<typeof rhsKind>; rung: number }>();

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

  /** A new slot id for one prepared model. */
  newSlot(): number {
    return this.nextSlot++;
  }

  async prepare(spec: Omit<EngineSpec, 'partition'>, slot: number): Promise<{ nEvents: number; setup_ms: number }> {
    const K = this.workers.length;
    const replies = await Promise.all(this.workers.map((_, i) => this.send(i, {
      type: 'setup', id: this.nextId++, slot, spec: { ...spec, partition: { stride: K, offset: i } },
    })));
    this.slots.set(slot, { kind: rhsKind(spec.model), rung: loopRung(spec.model) });
    let nEvents = 0, setup = 0;
    for (const r of replies) {
      if (r.type === 'ready') { nEvents += r.nEvents; setup = Math.max(setup, r.setup_ms); }
    }
    return { nEvents, setup_ms: setup };
  }

  async rhs(f: Float64Array, out: Float64Array, slot: number): Promise<RhsDiagnostics> {
    const s = this.slots.get(slot);
    if (!s) throw new Error('compute pool used before setup');
    const replies = await Promise.all(this.workers.map((_, i) => this.send(i, {
      type: 'rhs', id: this.nextId++, slot, f,
    })));
    out.fill(0);
    let part = emptyPartial();
    for (const r of replies) {
      if (r.type !== 'rhs') continue;
      const o = r.out;
      for (let j = 0; j < out.length; j++) out[j] += o[j];
      part = combinePartials(part, r.part);
    }
    return finalizeDiagnostics(s.kind, s.rung, part);
  }

  /** Drop a slot's prepared model in every worker. */
  release(slot: number): void {
    this.slots.delete(slot);
    this.workers.forEach((_, i) => { void this.send(i, { type: 'release', id: this.nextId++, slot }).catch(() => {}); });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}
