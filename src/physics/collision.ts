/**
 * Reduced isotropic four-wave collision operator.
 *
 * Direct TypeScript port of `wke/geometry.py` + `wke/collision.py`.
 * The kinematics are precomputed once into flat typed arrays (event table),
 * then every right-hand-side evaluation is a single linear sweep over events.
 *
 * Event kinematics (Appendix-A reduced form):
 *   p3² = p1² + p2² − p²          (energy conservation, ε ∝ p²)
 *   weight = (4π/ncal²) · w1 · w2 · p1 · p2 · K(p, p1, p2, p3)
 *   K(p, p1, p2, p3) = min(p, p1, p2, p3) / p     (bare isotropic kernel)
 *
 * Gain/loss factors (`wke/kernel.py::gain_loss`):
 *   quantum      g = f1 f2 (1 + f + f3),   l = f f3 (1 + f1 + f2)
 *   classical    g = f1 f2 (f + f3),       l = f f3 (f1 + f2)
 *   spontaneous  g = f1 f2,                l = f f3
 */

import { gaussLegendreLog, interpolationMap } from './quadrature';

export type KernelType = 'classical' | 'quantum' | 'spontaneous';

export const KERNEL_IDS: Record<KernelType, number> = {
  quantum: 0,
  classical: 1,
  spontaneous: 2,
};

/** Precomputed collision kinematics for one state grid. */
export interface CollisionGeometry {
  /** dimensionless state grid p (log-spaced) */
  grid: Float64Array;
  /** trapezoid weights Δp on the state grid (diagnostics only) */
  weights: Float64Array;
  p_coll_max: number;
  ncal: number;
  nq_low: number;
  nq_high: number;
  /** offsets[i] .. offsets[i+1] is the event range whose target is grid[i] */
  offsets: Int32Array;
  weight: Float64Array;
  i1: Int32Array;
  a1: Float64Array;
  i2: Int32Array;
  a2: Float64Array;
  i3: Int32Array;
  a3: Float64Array;
  nEvents: number;
  buildTime_ms: number;
}

/** Trapezoid weights matching `wke.physics.trapezoid_weights`. */
export function trapezoidWeights(x: Float64Array): Float64Array {
  const n = x.length;
  const w = new Float64Array(n);
  w[0] = 0.5 * (x[1] - x[0]);
  w[n - 1] = 0.5 * (x[n - 1] - x[n - 2]);
  for (let i = 1; i < n - 1; i++) w[i] = 0.5 * (x[i + 1] - x[i - 1]);
  return w;
}

type Segment = [number, number, number]; // [a, b, nq]

/** Port of `_axis_segments`. */
function axisSegments(
  p: number,
  pMin: number,
  pCollMax: number,
  nqLow: number,
  nqHigh: number,
): Segment[] {
  if (p >= pCollMax) return [[pMin, pCollMax, nqLow]];
  const segments: Segment[] = [];
  if (p > pMin * (1.0 + 1e-14)) segments.push([pMin, p, nqLow]);
  if (pCollMax > p * (1.0 + 1e-14)) segments.push([Math.max(p, pMin), pCollMax, nqHigh]);
  return segments;
}

/** Port of `_p2_segments`. */
function p2Segments(
  p: number,
  p1: number,
  pMin: number,
  pCollMax: number,
  nqLow: number,
  nqHigh: number,
): Segment[] {
  const lower = Math.max(pMin, Math.sqrt(Math.max(p * p - p1 * p1, 0.0)));
  if (lower >= pCollMax * (1.0 - 1e-15)) return [];
  const segments: Segment[] = [];
  const split = Math.min(p, pCollMax);
  if (lower < split * (1.0 - 1e-14)) segments.push([lower, split, nqLow]);
  const upperLow = Math.max(lower, p);
  if (upperLow < pCollMax * (1.0 - 1e-14)) segments.push([upperLow, pCollMax, nqHigh]);
  return segments;
}

/** Growable flat buffer of collision events. */
class EventBuffer {
  weight: Float64Array;
  i1: Int32Array;
  a1: Float64Array;
  i2: Int32Array;
  a2: Float64Array;
  i3: Int32Array;
  a3: Float64Array;
  n = 0;

  constructor(capacity: number) {
    this.weight = new Float64Array(capacity);
    this.i1 = new Int32Array(capacity);
    this.a1 = new Float64Array(capacity);
    this.i2 = new Int32Array(capacity);
    this.a2 = new Float64Array(capacity);
    this.i3 = new Int32Array(capacity);
    this.a3 = new Float64Array(capacity);
  }

  private grow(): void {
    const cap = this.weight.length * 2;
    const gf = (src: Float64Array) => { const d = new Float64Array(cap); d.set(src); return d; };
    const gi = (src: Int32Array) => { const d = new Int32Array(cap); d.set(src); return d; };
    this.weight = gf(this.weight);
    this.a1 = gf(this.a1); this.a2 = gf(this.a2); this.a3 = gf(this.a3);
    this.i1 = gi(this.i1); this.i2 = gi(this.i2); this.i3 = gi(this.i3);
  }

  push(
    weight: number,
    i1: number, a1: number,
    i2: number, a2: number,
    i3: number, a3: number,
  ): void {
    if (this.n === this.weight.length) this.grow();
    const k = this.n++;
    this.weight[k] = weight;
    this.i1[k] = i1; this.a1[k] = a1;
    this.i2[k] = i2; this.a2[k] = a2;
    this.i3[k] = i3; this.a3[k] = a3;
  }
}

/**
 * Build the collision event table. Port of `build_geometry`.
 *
 * @param pState    log-spaced dimensionless state grid; must extend to
 *                  sqrt(2)·pCollMax so that p3 never leaves the grid.
 * @param pCollMax  collision cutoff (strictly inside the state grid)
 * @param ncal      4π² n ξ³
 */
export function buildGeometry(
  pState: Float64Array,
  pCollMax: number,
  ncal: number,
  nqLow = 16,
  nqHigh = 16,
): CollisionGeometry {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const n = pState.length;

  if (pState[n - 1] < Math.SQRT2 * pCollMax * (1.0 - 1e-12)) {
    throw new Error('state grid lacks the required sqrt(2) collision guard band');
  }
  if (pCollMax > pState[n - 1] || pCollMax <= pState[0]) {
    throw new Error('collision cutoff must lie strictly inside the state grid');
  }

  const logState = new Float64Array(n);
  for (let i = 0; i < n; i++) logState[i] = Math.log(pState[i]);

  const prefactor = (4.0 * Math.PI) / (ncal * ncal);
  const pMin = pState[0];
  const pMaxGuard = pState[n - 1] * (1.0 + 2e-12);

  const offsets = new Int32Array(n + 1);
  // Rough a-priori capacity: 2 p1-segments × nq × 2 p2-segments × nq per target.
  const buf = new EventBuffer(Math.max(1 << 16, n * 2 * nqHigh * 2 * nqHigh));

  for (let ip = 0; ip < n; ip++) {
    const p = pState[ip];
    const p2Target = p * p;

    for (const [a, b, nqa] of axisSegments(p, pMin, pCollMax, nqLow, nqHigh)) {
      const { p: q1, w: w1 } = gaussLegendreLog(a, b, nqa);

      for (let j = 0; j < q1.length; j++) {
        const p1 = q1[j];
        const w1n = w1[j];
        const m1 = interpolationMap(logState, p1);

        for (const [c, d, nqb] of p2Segments(p, p1, pMin, pCollMax, nqLow, nqHigh)) {
          const { p: q2, w: w2 } = gaussLegendreLog(c, d, nqb);

          for (let m = 0; m < q2.length; m++) {
            const p2 = q2[m];
            const p3sq = p1 * p1 + p2 * p2 - p2Target;
            // Roundoff at a lower boundary may produce an exact zero.
            if (!(p3sq > 0.0)) continue;
            const p3 = Math.sqrt(p3sq);
            if (p3 > pMaxGuard) throw new Error('p3 exceeds state guard band');

            // bare_kernel = min(p, p1, p2, p3) / p
            const kernel = Math.min(p, p1, p2, p3) / p;
            const gw = prefactor * (w1n * w2[m]) * p1 * p2 * kernel;

            const m2 = interpolationMap(logState, p2);
            const m3 = interpolationMap(logState, p3);
            buf.push(gw, m1.idx, m1.alpha, m2.idx, m2.alpha, m3.idx, m3.alpha);
          }
        }
      }
    }
    offsets[ip + 1] = buf.n;
  }

  const nEvents = buf.n;
  const clip = <T extends Float64Array | Int32Array>(arr: T): T => arr.slice(0, nEvents) as T;

  return {
    grid: pState,
    weights: trapezoidWeights(pState),
    p_coll_max: pCollMax,
    ncal,
    nq_low: nqLow,
    nq_high: nqHigh,
    offsets,
    weight: clip(buf.weight),
    i1: clip(buf.i1), a1: clip(buf.a1),
    i2: clip(buf.i2), a2: clip(buf.a2),
    i3: clip(buf.i3), a3: clip(buf.a3),
    nEvents,
    buildTime_ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/**
 * Gain and loss components of C[f]. Port of `_components_numba`.
 * Writes into `gain`/`loss` to avoid per-call allocation in the ODE hot loop.
 */
export function collisionComponents(
  f: Float64Array,
  geom: CollisionGeometry,
  kernelId: number,
  gain: Float64Array,
  loss: Float64Array,
): void {
  const { offsets, weight, i1, a1, i2, a2, i3, a3 } = geom;
  const n = f.length;

  for (let i = 0; i < n; i++) {
    const fp = f[i];
    let sg = 0.0;
    let sl = 0.0;
    const end = offsets[i + 1];

    for (let e = offsets[i]; e < end; e++) {
      const j1 = i1[e], j2 = i2[e], j3 = i3[e];
      const u1 = a1[e], u2 = a2[e], u3 = a3[e];
      const f1 = (1.0 - u1) * f[j1] + u1 * f[j1 + 1];
      const f2 = (1.0 - u2) * f[j2] + u2 * f[j2 + 1];
      const f3 = (1.0 - u3) * f[j3] + u3 * f[j3 + 1];

      let g: number, l: number;
      if (kernelId === 0) {
        g = f1 * f2 * (1.0 + fp + f3);
        l = fp * f3 * (1.0 + f1 + f2);
      } else if (kernelId === 1) {
        g = f1 * f2 * (fp + f3);
        l = fp * f3 * (f1 + f2);
      } else {
        g = f1 * f2;
        l = fp * f3;
      }
      const w = weight[e];
      sg += w * g;
      sl += w * l;
    }
    gain[i] = sg;
    loss[i] = sl;
  }
}

/** C[f] = gain − loss, allocating scratch on demand. */
export function collisionRhs(
  f: Float64Array,
  geom: CollisionGeometry,
  kernelId: number,
  out: Float64Array,
  gainScratch?: Float64Array,
  lossScratch?: Float64Array,
): Float64Array {
  const n = f.length;
  const gain = gainScratch ?? new Float64Array(n);
  const loss = lossScratch ?? new Float64Array(n);
  collisionComponents(f, geom, kernelId, gain, loss);
  for (let i = 0; i < n; i++) out[i] = gain[i] - loss[i];
  return out;
}
