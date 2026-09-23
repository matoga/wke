/**
 * Reduced isotropic four-wave collision operator.
 *
 * The angular integrals of the momentum delta are done analytically, which
 * leaves, for every target p on the state grid, a double integral over the two
 * partner magnitudes p1, p2 on log Gauss-Legendre nodes:
 *
 *   p3² = p1² + p2² − p²              (reaction p + p3 ↔ p1 + p2)
 *   event weight = w1 · w2 · p1 · p2 · min(p, p1, p2, p3) / p
 *   ∂τ f(p) = (4π / N_cal²) Σ_events weight · M_e · [gain − loss]
 *
 * M_e = 1 for the bare kinetic equation; the renormalised models multiply each
 * event by a loop-dressed factor (see rhs.ts). The event weights here do not
 * depend on the coupling, so one table serves every density and scattering
 * length on the same grid.
 *
 * Events are stored contiguously per target, and within a target per p1 node
 * ("pair"): all events of a pair share p and p1, hence the t-channel energy
 * transfer |p² − p1²|.
 *
 * Gain/loss factors:
 *   quantum      g = f1 f2 (1 + f + f3),   l = f f3 (1 + f1 + f2)
 *   classical    g = f1 f2 (f + f3),       l = f f3 (f1 + f2)
 */

import { gaussLegendreLog, interpolationMap } from './quadrature';

export type KernelType = 'classical' | 'quantum';

export const KERNEL_IDS: Record<KernelType, number> = {
  quantum: 0,
  classical: 1,
};

export interface QuadratureOptions {
  /** Gauss nodes per panel below the target p */
  nqLow: number;
  /** Gauss nodes per panel above the target p */
  nqHigh: number;
  /** equal-width panels (in ln p) per segment */
  panels: number;
}

/**
 * Subset of targets owned by one compute thread: target i is built when
 * i % stride === offset. The partial right-hand sides of all subsets add up to
 * the full one.
 */
export interface TargetPartition {
  stride: number;
  offset: number;
}

/** Precomputed collision kinematics for one state grid. */
export interface CollisionGeometry {
  /** dimensionless state grid p (log-spaced) */
  grid: Float64Array;
  /** trapezoid weights Δp on the state grid (diagnostics only) */
  weights: Float64Array;
  p_coll_max: number;
  quad: QuadratureOptions;
  /** offsets[i] .. offsets[i+1] is the event range whose target is grid[i] */
  offsets: Int32Array;
  weight: Float64Array;
  i1: Int32Array;
  a1: Float64Array;
  i2: Int32Array;
  a2: Float64Array;
  i3: Int32Array;
  a3: Float64Array;
  /** second partner magnitude per event (the first is shared by the pair) */
  p2: Float64Array;
  /** pairOffsets[k] .. pairOffsets[k+1] are the events of pair k */
  pairOffsets: Int32Array;
  /** targetPairs[i] .. targetPairs[i+1] are the pairs whose target is grid[i] */
  targetPairs: Int32Array;
  pairTarget: Int32Array;
  pairP1: Float64Array;
  nPairs: number;
  nEvents: number;
  buildTime_ms: number;
}

/** Tree-level prefactor 4π / N_cal² that multiplies every event weight. */
export function treePrefactor(ncal: number): number {
  return (4.0 * Math.PI) / (ncal * ncal);
}

/** Trapezoid weights on a grid. */
export function trapezoidWeights(x: Float64Array): Float64Array {
  const n = x.length;
  const w = new Float64Array(n);
  w[0] = 0.5 * (x[1] - x[0]);
  w[n - 1] = 0.5 * (x[n - 1] - x[n - 2]);
  for (let i = 1; i < n - 1; i++) w[i] = 0.5 * (x[i + 1] - x[i - 1]);
  return w;
}

type Segment = [number, number, number]; // [a, b, nq]

/** Split [a, b] into equal panels in ln p, each carrying nq nodes. */
function panelize(a: number, b: number, nq: number, panels: number, out: Segment[]): void {
  if (panels <= 1) { out.push([a, b, nq]); return; }
  const la = Math.log(a);
  const step = (Math.log(b) - la) / panels;
  let lo = a;
  for (let k = 1; k <= panels; k++) {
    const hi = k === panels ? b : Math.exp(la + k * step);
    out.push([lo, hi, nq]);
    lo = hi;
  }
}

function axisSegments(p: number, pMin: number, pCollMax: number, q: QuadratureOptions): Segment[] {
  const segments: Segment[] = [];
  if (p >= pCollMax) {
    panelize(pMin, pCollMax, q.nqLow, q.panels, segments);
    return segments;
  }
  if (p > pMin * (1.0 + 1e-14)) panelize(pMin, p, q.nqLow, q.panels, segments);
  if (pCollMax > p * (1.0 + 1e-14)) panelize(Math.max(p, pMin), pCollMax, q.nqHigh, q.panels, segments);
  return segments;
}

function p2Segments(p: number, p1: number, pMin: number, pCollMax: number, q: QuadratureOptions): Segment[] {
  const lower = Math.max(pMin, Math.sqrt(Math.max(p * p - p1 * p1, 0.0)));
  if (lower >= pCollMax * (1.0 - 1e-15)) return [];
  const segments: Segment[] = [];
  const split = Math.min(p, pCollMax);
  if (lower < split * (1.0 - 1e-14)) panelize(lower, split, q.nqLow, q.panels, segments);
  const upperLow = Math.max(lower, p);
  if (upperLow < pCollMax * (1.0 - 1e-14)) panelize(upperLow, pCollMax, q.nqHigh, q.panels, segments);
  return segments;
}

class F64 {
  a: Float64Array;
  constructor(cap: number) { this.a = new Float64Array(cap); }
  ensure(n: number): void {
    if (n <= this.a.length) return;
    const d = new Float64Array(Math.max(n, this.a.length * 2));
    d.set(this.a);
    this.a = d;
  }
}

class I32 {
  a: Int32Array;
  constructor(cap: number) { this.a = new Int32Array(cap); }
  ensure(n: number): void {
    if (n <= this.a.length) return;
    const d = new Int32Array(Math.max(n, this.a.length * 2));
    d.set(this.a);
    this.a = d;
  }
}

/**
 * Build the collision event table.
 *
 * @param pState    log-spaced dimensionless state grid; must extend to
 *                  sqrt(2)·pCollMax so that p3 never leaves the grid.
 * @param pCollMax  collision cutoff (strictly inside the state grid)
 */
export function buildGeometry(
  pState: Float64Array,
  pCollMax: number,
  quad: QuadratureOptions = { nqLow: 16, nqHigh: 16, panels: 1 },
  partition: TargetPartition = { stride: 1, offset: 0 },
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

  const pMin = pState[0];
  const pMaxGuard = pState[n - 1] * (1.0 + 2e-12);

  const perTarget = 4 * quad.panels * quad.panels * Math.max(quad.nqLow, quad.nqHigh) ** 2;
  const cap = Math.max(1 << 16, Math.ceil((n * perTarget) / (2 * partition.stride)));
  const weight = new F64(cap), a1 = new F64(cap), a2 = new F64(cap), a3 = new F64(cap);
  const p2s = new F64(cap);
  const i1 = new I32(cap), i2 = new I32(cap), i3 = new I32(cap);
  const pairOff = new I32(n * 4 * quad.panels * quad.nqHigh + 1);
  const pairTarget = new I32(n * 4 * quad.panels * quad.nqHigh);
  const pairP1 = new F64(n * 4 * quad.panels * quad.nqHigh);

  const offsets = new Int32Array(n + 1);
  const targetPairs = new Int32Array(n + 1);
  let ne = 0;
  let np = 0;
  pairOff.a[0] = 0;

  for (let ip = 0; ip < n; ip++) {
    const p = pState[ip];
    const pSq = p * p;
    const owned = ip % partition.stride === partition.offset;

    for (const [a, b, nqa] of owned ? axisSegments(p, pMin, pCollMax, quad) : []) {
      const { p: q1, w: w1 } = gaussLegendreLog(a, b, nqa);

      for (let j = 0; j < q1.length; j++) {
        const p1 = q1[j];
        const w1n = w1[j];
        const m1 = interpolationMap(logState, p1);
        const pairStart = ne;

        for (const [c, d, nqb] of p2Segments(p, p1, pMin, pCollMax, quad)) {
          const { p: q2, w: w2 } = gaussLegendreLog(c, d, nqb);

          for (let m = 0; m < q2.length; m++) {
            const p2 = q2[m];
            const p3sq = p1 * p1 + p2 * p2 - pSq;
            // Roundoff at a lower boundary may produce an exact zero.
            if (!(p3sq > 0.0)) continue;
            const p3 = Math.sqrt(p3sq);
            if (p3 > pMaxGuard) throw new Error('p3 exceeds state guard band');

            const kernel = Math.min(p, p1, p2, p3) / p;
            const m2 = interpolationMap(logState, p2);
            const m3 = interpolationMap(logState, p3);

            const k = ne++;
            if (k >= weight.a.length) {
              const need = k + 1;
              weight.ensure(need); a1.ensure(need); a2.ensure(need); a3.ensure(need);
              p2s.ensure(need); i1.ensure(need); i2.ensure(need); i3.ensure(need);
            }
            weight.a[k] = w1n * w2[m] * p1 * p2 * kernel;
            i1.a[k] = m1.idx; a1.a[k] = m1.alpha;
            i2.a[k] = m2.idx; a2.a[k] = m2.alpha;
            i3.a[k] = m3.idx; a3.a[k] = m3.alpha;
            p2s.a[k] = p2;
          }
        }

        if (ne > pairStart) {
          pairOff.ensure(np + 2); pairTarget.ensure(np + 1); pairP1.ensure(np + 1);
          pairTarget.a[np] = ip;
          pairP1.a[np] = p1;
          np++;
          pairOff.a[np] = ne;
        }
      }
    }
    offsets[ip + 1] = ne;
    targetPairs[ip + 1] = np;
  }

  return {
    grid: pState,
    weights: trapezoidWeights(pState),
    p_coll_max: pCollMax,
    quad,
    offsets,
    weight: weight.a.slice(0, ne),
    i1: i1.a.slice(0, ne), a1: a1.a.slice(0, ne),
    i2: i2.a.slice(0, ne), a2: a2.a.slice(0, ne),
    i3: i3.a.slice(0, ne), a3: a3.a.slice(0, ne),
    p2: p2s.a.slice(0, ne),
    pairOffsets: pairOff.a.slice(0, np + 1),
    targetPairs,
    pairTarget: pairTarget.a.slice(0, np),
    pairP1: pairP1.a.slice(0, np),
    nPairs: np,
    nEvents: ne,
    buildTime_ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/**
 * Bare gain and loss components of C[f], already multiplied by `scale`
 * (normally the tree prefactor 4π/N_cal²). Writes into `gain`/`loss`.
 */
export function collisionComponents(
  f: Float64Array,
  geom: CollisionGeometry,
  kernelId: number,
  gain: Float64Array,
  loss: Float64Array,
  scale: number,
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
      } else {
        g = f1 * f2 * (fp + f3);
        l = fp * f3 * (f1 + f2);
      }
      const w = weight[e];
      sg += w * g;
      sl += w * l;
    }
    gain[i] = scale * sg;
    loss[i] = scale * sl;
  }
}
