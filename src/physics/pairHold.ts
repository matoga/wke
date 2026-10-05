/**
 * The runs of each ±a pair end at a common time. A run that has reached its
 * target goes on evolving, never ahead of a partner that is still running,
 * until every run of the pair has reached its target (or ended); the pair then
 * ends at the latest of those times. Both runs share t₀ (it depends on |a|
 * only), so their dimensionless times are directly comparable.
 */

import type { PairHold } from './simulate';

interface PairMember { tau: number; target: number | null; ended: number | null }

export class PairRegistry {
  private pairs = new Map<string, Map<string, PairMember>>();

  /** Register a run; `end` must be called when it finishes, however it finishes. */
  join(runId: string, pair: { id: string; size: number } | undefined): { hold?: PairHold; end: () => void } {
    if (!pair || pair.size < 2) return { end: () => {} };
    const members = this.pairs.get(pair.id) ?? new Map<string, PairMember>();
    this.pairs.set(pair.id, members);
    const me: PairMember = { tau: 0, target: null, ended: null };
    members.set(runId, me);
    const hold: PairHold = {
      onTarget: (t) => { me.target = t; },
      onStep: (t) => { me.tau = t; },
      bound: () => {
        const others = [...members.entries()].filter(([id]) => id !== runId).map(([, m]) => m);
        const running = others.filter((m) => m.target === null && m.ended === null);
        if (members.size < pair.size) return { tau: 0, final: false };
        if (running.length) return { tau: Math.min(...running.map((m) => m.tau)), final: false };
        return { tau: Math.max(me.target ?? me.tau, ...others.map((m) => m.target ?? m.ended ?? 0)), final: true };
      },
    };
    return {
      hold,
      end: () => {
        me.ended = me.tau;
        if ([...members.values()].every((m) => m.ended !== null)) this.pairs.delete(pair.id);
      },
    };
  }
}
