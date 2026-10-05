/** View helpers shared by the cards that display runs. */

import type { KernelType } from '../physics/collision';
import type { ModelId } from '../physics/models';
import { MODEL_BY_ID } from '../physics/models';
import { POLE_DRESSING_LIMIT, POLE_RATE_SHARE } from '../physics/rhs';
import type { Sign, WKEResult, WKESnapshot } from '../types/wke';
import type { Tone } from './primitives';

/** The model's colour; the attractive run of a ±a pair takes a lighter tint of it. */
export const modelColor = (model: ModelId, sign: Sign = 1): string => `var(--m-${model}${sign < 0 ? '-neg' : ''})`;

/** Colour of a run: its model, tinted when a < 0 and shown as part of a pair. */
export const runColor = (r: Pick<WKEResult, 'model' | 'scales'>, pair: boolean): string =>
  modelColor(r.model, pair ? r.scales.sign : 1);

/** "+a" or "−a". */
export const signLabel = (sign: Sign): string => (sign > 0 ? '+a' : '−a');

export const modelDashed = (model: ModelId, kernel: KernelType): boolean =>
  kernel === 'quantum';

/** Short name of a run; with `pair`, followed by the sign of a. */
export function runLabel(r: Pick<WKEResult, 'model' | 'kernel'> & { scales?: { sign: Sign } }, pair = false): string {
  const m = MODEL_BY_ID[r.model];
  const base = r.kernel === 'quantum' ? `${m.short}, Bose +1` : m.short;
  return pair && r.scales ? `${base} · ${signLabel(r.scales.sign)}` : base;
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

/**
 * States to overlay: the lattice states on the smallest power-of-two stride
 * that leaves at most `target` of them, plus the first and the latest state.
 * The choice depends only on which states exist, so a run shows the same
 * curves while it runs, when it finishes, and before and after Continue.
 */
export function displayFrames(snaps: WKESnapshot[], target: number): number[] {
  const lattice: Array<[number, number]> = [];
  snaps.forEach((s, i) => { if (s.lattice !== undefined) lattice.push([s.lattice, i]); });
  let stride = 1;
  const count = (st: number) => lattice.reduce((c, [l]) => c + (l % st === 0 ? 1 : 0), 0);
  while (stride < 2 ** 52 && count(stride) > target) stride *= 2;
  const picked = new Set(lattice.filter(([l]) => l % stride === 0).map(([, i]) => i));
  if (snaps.length) { picked.add(0); picked.add(snaps.length - 1); }
  return [...picked].sort((a, b) => a - b);
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
  const share = (r.kpTrack.share ?? []).reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), 0);
  const title = `Largest share of the collision rate carried by collisions whose averaged dressing M exceeds ${POLE_DRESSING_LIMIT};`
    + ` the model has broken down above ${100 * POLE_RATE_SHARE}%. The largest sampled vertex weight 1/|1 − cL|² was ${wMax.toFixed(1)}`
    + ' (a diagnostic only: near a pole it depends on where the table nodes fall).';
  const text = `M > ${POLE_DRESSING_LIMIT} on ${sharePercent(share)} of the rate`;
  if (share > POLE_RATE_SHARE) return { tone: 'bad', text: `${text}: at the pole`, title };
  if (share > 0 || wMax >= 2) return { tone: 'warn', text: `${text}: near the pole`, title };
  return { tone: 'ok', text: `${text}: far from the pole`, title };
}

/** A rate share as a percentage with two significant digits, e.g. 0.35%. */
export function sharePercent(share: number): string {
  return share > 0 ? `${Number((100 * share).toPrecision(2))}%` : '0%';
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
