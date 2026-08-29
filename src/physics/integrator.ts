/**
 * Adaptive Dormand–Prince 5(4) integrator with terminal event detection.
 *
 * Mirrors the Python driver used to produce the reference fixtures:
 *   solve_ivp(rhs, (0, tau_max), f0, method="DOP853", events=hit_half,
 *             rtol=1e-6, atol=1e-9)
 * with `hit_half(tau, f) = peak_momentum(k, f) − kp0/2`, terminal, direction −1.
 *
 * DOP853 is replaced by DOPRI5 with tighter tolerances; the half-time is a
 * smooth functional of the trajectory, so the two agree far inside the 1%
 * cross-validation target (see docs/VALIDATION.md).
 */

import type { CollisionGeometry, KernelType } from './collision';
import { KERNEL_IDS, collisionComponents } from './collision';
import { peakMomentumFromF } from './descriptors';

// --- Dormand–Prince 5(4) tableau -------------------------------------------
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
// error = b − b̂
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920,
      E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

export interface Snapshot {
  tau: number;
  t_s: number;
  kp_um_inv: number;
  /** q(k, t) = k² f / (2π² n₀), normalized so ∫ q dk = 1 at t = 0 */
  q: Float64Array;
  dN_over_N: number;
  dE_over_E: number;
  /** 'initial' | '0.90' | '0.75' | '0.50' | 'sample' | 'final' */
  stage: string;
}

export interface IntegrationResult {
  reachedHalf: boolean;
  tauHalf: number | null;
  dtHalf_s: number | null;
  snapshots: Snapshot[];
  kpTrack: { tau: number[]; t_s: number[]; kp: number[] };
  /** k_p at the requested `tauEval` times, from the dense output */
  evalTrack: { tau: number[]; t_s: number[]; kp: number[] };
  nSteps: number;
  nRhs: number;
  nRejected: number;
  wallTime_ms: number;
  maxDN: number;
  maxDE: number;
  /** raw occupation at the end of this segment — hand back in to extend the run */
  finalF: Float64Array;
  finalTau: number;
}

export interface IntegrationConfig {
  kernel: KernelType;
  geom: CollisionGeometry;
  /** physical time unit t₀ [s] */
  t0_s: number;
  /** healing length ξ [μm] */
  xi_um: number;
  /** initial peak wavevector [μm⁻¹]; the half-target is kp0/2 */
  kp0_um_inv: number;
  /** initial occupation f(p) on the state grid */
  f0: Float64Array;
  tauMax: number;
  rtol?: number;
  atol?: number;
  /** number of evenly spaced snapshots saved for the timeline slider */
  nSnapshots?: number;
  /** spacing of timeline snapshots in dimensionless time; defaults to tauMax / nSnapshots */
  snapshotIntervalTau?: number;
  /** accepted-step budget; defaults to the global safety limit */
  maxSteps?: number;
  /**
   * When false, integration runs for the full `tauMax` without checking for
   * the kp0/2 crossing or the 0.90/0.75/0.50 stage markers — used to extend an
   * already-finished run further in time ("Continue simulating").
   */
  haltOnHalf?: boolean;
  /**
   * Dimensionless times at which to report k_p from the dense output. Use this
   * to compare against another integrator's trajectory: k_p(τ) hops by a grid
   * cell whenever the spectral argmax moves, so interpolating a step-resolution
   * track across such a hop is meaningless — the state must be evaluated at the
   * requested τ itself.
   */
  tauEval?: ArrayLike<number>;
  onProgress?: (info: { pct: number; tau: number; kp: number; nSteps: number }) => void;
}

const STAGE_FRACTIONS: Array<[number, string]> = [
  [0.9, '0.90'],
  [0.75, '0.75'],
  [0.5, '0.50'],
];

/** Dimensionless number moment ∫ p² f dp. */
function numberMoment(p: Float64Array, w: Float64Array, f: Float64Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += w[i] * p[i] * p[i] * f[i];
  return s;
}

/** Dimensionless energy moment ∫ p⁴ f dp. */
function energyMoment(p: Float64Array, w: Float64Array, f: Float64Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) {
    const p2 = p[i] * p[i];
    s += w[i] * p2 * p2 * f[i];
  }
  return s;
}

/**
 * Build f(p) from a normalized q(k), then rescale so the discrete density
 * moment reproduces `density_um3` exactly — the same two-step construction the
 * Python fixture generator performs.
 */
export function buildInitialF(
  q: Float64Array,
  k_um_inv: Float64Array,
  density_um3: number,
): Float64Array {
  const n = q.length;
  const f = new Float64Array(n);
  const twoPi2 = 2 * Math.PI * Math.PI;
  for (let i = 0; i < n; i++) {
    f[i] = (twoPi2 * density_um3 * q[i]) / (k_um_inv[i] * k_um_inv[i]);
  }
  // dens = ∫ k² f dk / (2π²)  (trapezoid on the physical grid)
  let dens = 0;
  for (let i = 0; i < n - 1; i++) {
    const yi = k_um_inv[i] * k_um_inv[i] * f[i];
    const yj = k_um_inv[i + 1] * k_um_inv[i + 1] * f[i + 1];
    dens += 0.5 * (yi + yj) * (k_um_inv[i + 1] - k_um_inv[i]);
  }
  dens /= twoPi2;
  if (dens > 0) {
    const scale = density_um3 / dens;
    for (let i = 0; i < n; i++) f[i] *= scale;
  }
  return f;
}

export function runWKE(config: IntegrationConfig): IntegrationResult {
  const wall0 = performance.now();
  const {
    kernel, geom, t0_s, xi_um, kp0_um_inv, f0, tauMax,
    rtol = 1e-7, atol = 1e-10, nSnapshots = 40, snapshotIntervalTau,
    maxSteps = 200000, tauEval, onProgress,
    haltOnHalf = true,
  } = config;

  const kernelId = KERNEL_IDS[kernel];
  const n = f0.length;
  const p = geom.grid;
  const wq = geom.weights;

  const k_um_inv = new Float64Array(n);
  for (let i = 0; i < n; i++) k_um_inv[i] = p[i] / xi_um;

  const twoPi2 = 2 * Math.PI * Math.PI;
  const n0 = numberMoment(p, wq, f0);
  const e0 = energyMoment(p, wq, f0);
  // density used to normalize the reported q(k, t)
  let dens0 = 0;
  for (let i = 0; i < n - 1; i++) {
    const yi = k_um_inv[i] * k_um_inv[i] * f0[i];
    const yj = k_um_inv[i + 1] * k_um_inv[i + 1] * f0[i + 1];
    dens0 += 0.5 * (yi + yj) * (k_um_inv[i + 1] - k_um_inv[i]);
  }
  dens0 /= twoPi2;

  const gain = new Float64Array(n);
  const loss = new Float64Array(n);
  let nRhs = 0;
  const rhs = (f: Float64Array, out: Float64Array): Float64Array => {
    collisionComponents(f, geom, kernelId, gain, loss);
    for (let i = 0; i < n; i++) out[i] = gain[i] - loss[i];
    nRhs++;
    return out;
  };

  const alloc = () => new Float64Array(n);
  const k1 = alloc(), k2 = alloc(), k3 = alloc(), k4 = alloc(), k5 = alloc(), k6 = alloc(), k7 = alloc();
  const yTmp = alloc();

  let y = f0.slice();
  let tau = 0;
  const halfTarget = kp0_um_inv / 2;

  const kpOf = (f: Float64Array) => peakMomentumFromF(k_um_inv, f);

  const snapshots: Snapshot[] = [];
  const kpTrack = { tau: [] as number[], t_s: [] as number[], kp: [] as number[] };
  const evalTrack = { tau: [] as number[], t_s: [] as number[], kp: [] as number[] };
  let evalIdx = 0;
  let maxDN = 0;
  let maxDE = 0;

  const makeSnapshot = (t: number, f: Float64Array, stage: string): Snapshot => {
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      q[i] = (k_um_inv[i] * k_um_inv[i] * f[i]) / (twoPi2 * dens0);
    }
    const dN = (numberMoment(p, wq, f) - n0) / n0;
    const dE = (energyMoment(p, wq, f) - e0) / e0;
    maxDN = Math.max(maxDN, Math.abs(dN));
    maxDE = Math.max(maxDE, Math.abs(dE));
    return { tau: t, t_s: t * t0_s, kp_um_inv: kpOf(f), q, dN_over_N: dN, dE_over_E: dE, stage };
  };

  snapshots.push(makeSnapshot(0, y, 'initial'));
  kpTrack.tau.push(0); kpTrack.t_s.push(0); kpTrack.kp.push(kp0_um_inv);

  const pendingStages = STAGE_FRACTIONS.map(([frac, label]) => ({
    target: frac * kp0_um_inv, label, done: false,
  }));

  // Initial step size: a small fraction of the expected timescale.
  rhs(y, k1);
  let h = tauMax / 2000;
  {
    let scale = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.abs(y[i]);
      scale = Math.max(scale, Math.abs(k1[i]) / sc);
    }
    if (scale > 0) h = Math.min(h, 0.01 / scale);
  }
  const hMax = tauMax / 20;

  let nSteps = 0;
  let nRejected = 0;
  let reachedHalf = false;
  let tauHalf: number | null = null;
  let halfStateF: Float64Array | null = null;
  let kpPrev = kp0_um_inv;

  // Timeline states are sampled uniformly in simulated time, independently of
  // the adaptive solver steps. This keeps playback faithful to elapsed time.
  const sampleInterval = snapshotIntervalTau ?? tauMax / nSnapshots;
  let nextSampleTau = Number.isFinite(sampleInterval) && sampleInterval > 0
    ? sampleInterval
    : Infinity;

  while (tau < tauMax && nSteps < maxSteps && !(haltOnHalf && reachedHalf)) {
    if (tau + h > tauMax) h = tauMax - tau;

    // --- one DOPRI5 stage sweep ---
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * A21 * k1[i];
    rhs(yTmp, k2);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    rhs(yTmp, k3);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    rhs(yTmp, k4);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    rhs(yTmp, k5);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    rhs(yTmp, k6);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
    rhs(yTmp, k7);

    // error estimate
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yTmp[i]));
      const r = e / sc;
      err += r * r;
    }
    err = Math.sqrt(err / n);

    if (err > 1 && h > 1e-14) {
      nRejected++;
      h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      continue;
    }

    const tauNew = tau + h;
    const kpNew = kpOf(yTmp);

    // --- terminal event: kp crosses kp0/2 downwards ---
    if (haltOnHalf && kpPrev > halfTarget && kpNew <= halfTarget) {
      tauHalf = bisectEvent(y, yTmp, k1, k7, tau, h, kpOf, halfTarget, n);
      // y/yTmp/k1/k7 describe *this* step only — the exact state must be taken
      // here, before the loop advances past it below.
      halfStateF = hermite(y, yTmp, k1, k7, tau, h, tauHalf, n);
      reachedHalf = true;
    }

    // --- stage crossings, located the same way ---
    if (haltOnHalf) {
      for (const st of pendingStages) {
        if (!st.done && kpPrev > st.target && kpNew <= st.target) {
          const tc = bisectEvent(y, yTmp, k1, k7, tau, h, kpOf, st.target, n);
          const fc = hermite(y, yTmp, k1, k7, tau, h, tc, n);
          snapshots.push(makeSnapshot(tc, fc, st.label));
          st.done = true;
        }
      }
    }

    // --- dense output at the requested evaluation times ---
    if (tauEval) {
      while (evalIdx < tauEval.length && tauEval[evalIdx] <= tauNew + 1e-15) {
        const te = tauEval[evalIdx];
        if (te >= tau - 1e-15) {
          const fe = te <= tau ? y : hermite(y, yTmp, k1, k7, tau, h, te, n);
          evalTrack.tau.push(te);
          evalTrack.t_s.push(te * t0_s);
          evalTrack.kp.push(kpOf(fe));
        }
        evalIdx++;
      }
    }

    // --- evenly spaced timeline samples, evaluated on dense output ---
    // If this step contains the terminal half-time event, do not save states
    // beyond that event: the final snapshot below is the exact half-time state.
    const sampleEnd = reachedHalf && tauHalf !== null ? tauHalf : tauNew;
    while (nextSampleTau <= sampleEnd + 1e-15) {
      const fs = hermite(y, yTmp, k1, k7, tau, h, nextSampleTau, n);
      snapshots.push(makeSnapshot(nextSampleTau, fs, 'sample'));
      nextSampleTau += sampleInterval;
    }

    tau = tauNew;
    y.set(yTmp);
    k1.set(k7); // FSAL
    kpPrev = kpNew;
    nSteps++;

    kpTrack.tau.push(tau);
    kpTrack.t_s.push(tau * t0_s);
    kpTrack.kp.push(kpNew);

    if (onProgress && nSteps % 20 === 0) {
      const pct = Math.min(1, (kp0_um_inv - kpNew) / (kp0_um_inv - halfTarget));
      onProgress({ pct, tau, kp: kpNew, nSteps });
    }

    if (!reachedHalf) {
      h = Math.min(hMax, h * Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
    }
  }

  let finalF: Float64Array = y;
  let finalTau = tau;
  if (haltOnHalf && reachedHalf && tauHalf !== null && halfStateF !== null) {
    finalF = halfStateF;
    finalTau = tauHalf;
    snapshots.push(makeSnapshot(tauHalf, finalF, 'final'));
  } else {
    snapshots.push(makeSnapshot(tau, y, 'final'));
  }

  // Snapshots may be produced slightly out of order across stage/sample paths.
  snapshots.sort((a, b) => a.tau - b.tau);

  return {
    reachedHalf,
    tauHalf,
    dtHalf_s: tauHalf !== null ? tauHalf * t0_s : null,
    snapshots,
    kpTrack,
    evalTrack,
    nSteps,
    nRhs,
    nRejected,
    wallTime_ms: performance.now() - wall0,
    maxDN,
    maxDE,
    finalF,
    finalTau,
  };
}

/** Cubic Hermite interpolation of the state within an accepted step. */
function hermite(
  y0: Float64Array, y1: Float64Array,
  f0: Float64Array, f1: Float64Array,
  t0: number, h: number, t: number, n: number,
): Float64Array {
  const out = new Float64Array(n);
  if (h === 0) { out.set(y0); return out; }
  const s = (t - t0) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  for (let i = 0; i < n; i++) {
    out[i] = h00 * y0[i] + h * h10 * f0[i] + h01 * y1[i] + h * h11 * f1[i];
  }
  return out;
}

/**
 * Locate the time at which kp(t) = target inside an accepted step, by
 * bisection on the Hermite interpolant (analogue of scipy's brentq on the
 * dense output).
 */
function bisectEvent(
  y0: Float64Array, y1: Float64Array,
  f0: Float64Array, f1: Float64Array,
  t0: number, h: number,
  kpOf: (f: Float64Array) => number,
  target: number,
  n: number,
): number {
  let lo = t0;
  let hi = t0 + h;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    const fm = hermite(y0, y1, f0, f1, t0, h, mid, n);
    if (kpOf(fm) > target) lo = mid; else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}
