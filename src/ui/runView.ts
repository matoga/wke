/** View helpers shared by the cards that display runs. */

import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import { MODEL_BY_ID } from '../physics/models';
import { POLE_WEIGHT_LIMIT } from '../physics/rhs';
import type { WKEResult, WKESnapshot } from '../types/wke';
import type { Tone } from './primitives';

export const modelColor = (model: ModelId): string => `var(--m-${model})`;

export const modelDashed = (model: ModelId, kernel: KernelType): boolean =>
  model === 'large-n' || kernel === 'quantum';

export function runLabel(r: Pick<WKEResult, 'model' | 'kernel' | 'components'>): string {
  const m = MODEL_BY_ID[r.model];
  if (r.model === 'large-n') return `${m.short}, N = ${r.components}`;
  return r.kernel === 'quantum' ? `${m.short}, Bose +1` : m.short;
}

/** Index of the saved state nearest to time t. */
export function nearestSnapshot(snaps: WKESnapshot[], t: number): number {
  let lo = 0, hi = snaps.length - 1;
  if (hi <= 0) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].t_s <= t) lo = mid; else hi = mid;
  }
  return Math.abs(snaps[hi].t_s - t) < Math.abs(snaps[lo].t_s - t) ? hi : lo;
}

/** Match the main branch's blue → cyan → green → yellow → red time ramp. */
export function rampColor(u: number): string {
  const hue = 240 - 240 * Math.min(1, Math.max(0, u));
  return `hsl(${hue.toFixed(1)}, 75%, 48%)`;
}

/** Mean occupation per mode, f = 2π² n q / k². */
export function occupation(k: ArrayLike<number>, q: ArrayLike<number>, density_um3: number): Float64Array {
  const out = new Float64Array(k.length);
  for (let i = 0; i < k.length; i++) out[i] = (2 * Math.PI * Math.PI * density_um3 * q[i]) / (k[i] * k[i]);
  return out;
}

export interface Verdict { tone: Tone; text: string; title: string }

/** Validity of the loop expansion over a run, from its per-step diagnostics. */
export function loopVerdict(r: WKEResult): Verdict | null {
  if (r.model === 'bare') return null;
  if (r.model === 'one-loop') {
    const worst = r.kpTrack.loop.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const mMin = r.kpTrack.pole.reduce((m, v) => Math.min(m, v), Infinity);
    const text = `dressing up to ${(100 * worst).toFixed(0)}%`;
    const title = 'Largest collision-weighted one-loop correction |M − 1| during the run, and the smallest bracket M.';
    if (worst >= 0.3 || mMin <= 0.5) return { tone: 'bad', text: `${text}: not quantitative`, title };
    if (worst >= 0.1) return { tone: 'warn', text: `${text}: marginal`, title };
    return { tone: 'ok', text: `${text}: perturbative`, title };
  }
  const wMax = r.kpTrack.pole.reduce((m, v) => Math.max(m, v), 0);
  const title = `Largest resummed weight 1/|1 − cL₋|² reached during the run. The run stops at ${POLE_WEIGHT_LIMIT}.`;
  const text = `vertex weight up to ${wMax.toFixed(2)}`;
  if (wMax >= POLE_WEIGHT_LIMIT) return { tone: 'bad', text: `${text}: at the pole`, title };
  if (wMax >= 2) return { tone: 'warn', text: `${text}: near the pole`, title };
  return { tone: 'ok', text: `${text}: far from the pole`, title };
}

export function terminationVerdict(r: WKEResult): Verdict {
  const target = `kₚ = ${r.stopKpFraction} kₚ,₀`;
  switch (r.termination) {
    case 'target':
      return { tone: 'ok', text: `reached ${target}`, title: 'The run stopped at its target.' };
    case 'pole':
      return { tone: 'bad', text: r.model === 'one-loop' ? 'stopped: bracket turned negative' : 'stopped at the pole', title: r.terminationMessage ?? '' };
    case 'nonfinite':
      return { tone: 'bad', text: 'stopped: equation became too stiff', title: r.terminationMessage ?? '' };
    case 'stopped':
      return { tone: 'info', text: 'stopped by user', title: 'The accepted states were kept; this run can be continued.' };
    case 'steps':
      return r.reachedTarget
        ? { tone: 'ok', text: 'extended past the target', title: 'Continued beyond the stop target.' }
        : { tone: 'warn', text: `stopped before ${target}`, title: 'The accepted-step budget ran out before the target.' };
    default:
      return { tone: 'warn', text: `did not reach ${target}`, title: 'The run hit its time limit.' };
  }
}

export function driftVerdict(r: WKEResult): Verdict {
  const d = Math.max(r.maxDN, r.maxDE);
  const text = `N drift ${(100 * r.maxDN).toFixed(2)}%, E drift ${(100 * r.maxDE).toFixed(2)}%`;
  const title = 'Largest relative change of the particle number and energy moments. These are conserved by the kinetic equation; the drift is the truncated-grid discretisation error.';
  return { tone: d < 0.01 ? 'ok' : d < 0.05 ? 'warn' : 'bad', text, title };
}
