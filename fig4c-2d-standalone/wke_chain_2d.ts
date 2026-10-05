/**
 * Wave kinetic equation (WKE) for a homogeneous, isotropic Bose gas, with the collision vertex dressed by the
 * large-N bubble chain, for one measured series of the coherence-spreading experiment.
 *
 *   node wke_chain.ts --series 1 [--accuracy draft|standard|high] [--kernel quantum|classical]
 *                     [--wall 1500] [--out out/runs/s01.json] [--data data/fig4c_data.json]
 *
 * Needs Node 22.6 or newer (it runs TypeScript directly) and nothing else. SOLVER.md walks through this file
 * section by section; README.md explains the physics.
 *
 * Output (JSON, rewritten every 30 s so a stopped run keeps what it reached):
 *   settings, scales, initial E/N, and at samples 60 per decade in t:
 *   t_s, X = k_ξ/k_p, ell_um = ℓ̄ = (f(k→0)/n₂)^(1/2), ellRate = (m/ħ) dℓ̄²/dt from the collision term, its
 *   uncertainty ellRateErr, and the particle number and kinetic energy relative to t = 0 (N_rel, E_rel).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SETUP_START = performance.now();

// ============================================================================================================
// 1. Constants, units and accuracy levels
// ============================================================================================================

const HBAR = 1.054571817e-34;          // J s
const KB = 1.380649e-23;               // J/K
const BOHR_UM = 5.29177210903e-5;      // µm

/** Solver momentum range in p = k ξ: the reference upper end, and the reference ξ (µm) of the input grid. */
const P_MIN_REF = 0.01;
const P_MAX_REF = 20.0;
const REFERENCE_XI_UM = 2.30389960057421;
/** The state grid is extended down to this p, at the level's points per decade. */
const P_MIN = 0.001;

interface Level {
  nGrid: number;          // state grid points on [P_MIN_REF, P_MAX_REF]
  nq: number;             // Gauss nodes per panel for each partner momentum
  panels: number;         // panels per quadrature segment
  rtol: number; atol: number;
  loopTable: number;      // nodes of the tabulated principal-value integral H(x)
  channelCell: number;    // target cell width of the transfer-momentum tables (p units)
  channelCellsMax: number;
}
const LEVELS: Record<string, Level> = {
  draft:    { nGrid: 300,  nq: 12, panels: 2, rtol: 1e-5, atol: 1e-8,  loopTable: 600,  channelCell: 0.4,  channelCellsMax: 32 },
  standard: { nGrid: 500,  nq: 12, panels: 2, rtol: 1e-7, atol: 1e-10, loopTable: 1000, channelCell: 0.2,  channelCellsMax: 64 },
  high:     { nGrid: 1000, nq: 12, panels: 2, rtol: 1e-8, atol: 1e-11, loopTable: 1400, channelCell: 0.12, channelCellsMax: 96 },
};

/** Command line. */
function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) out[v[i].replace(/^--/, '')] = v[i + 1];
  return out;
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ARGS = parseArgs();
const SERIES = Number(ARGS.series);
const ACCURACY = ARGS.accuracy ?? 'standard';
const KERNEL = ARGS.kernel ?? 'quantum';
const CHAIN = ARGS.chain !== 'off';
const WALL_S = Number(ARGS.wall ?? 1500);
const LENGTH_STOP_UM = ARGS['length-stop-um'] === undefined ? NaN : Number(ARGS['length-stop-um']);
if (ARGS['length-stop-um'] !== undefined && (!(LENGTH_STOP_UM > 0) || !Number.isFinite(LENGTH_STOP_UM)))
  throw new Error('--length-stop-um must be positive and finite (µm)');
const TAU_STOP = Number(ARGS['tau-stop'] ?? 1e6);
const DATA_PATH = ARGS.data ?? join(HERE, 'data', 'fig4c_data.json');
const OUT = ARGS.out ?? join(HERE, 'out', 'runs', `s${String(SERIES).padStart(2, '0')}.json`);
if (!LEVELS[ACCURACY]) throw new Error(`unknown --accuracy ${ACCURACY}`);
if (KERNEL !== 'quantum' && KERNEL !== 'classical') throw new Error(`unknown --kernel ${KERNEL}`);
if (!(TAU_STOP > 0) || !Number.isFinite(TAU_STOP)) throw new Error('--tau-stop must be positive and finite');
const LEVEL = { ...LEVELS[ACCURACY], channelCell: Number(ARGS['channel-cell'] ?? LEVELS[ACCURACY].channelCell),
  nGrid: Number(ARGS['n-grid'] ?? LEVELS[ACCURACY].nGrid), panels: Number(ARGS.panels ?? LEVELS[ACCURACY].panels) };
if (!(LEVEL.channelCell > 0)) throw new Error('--channel-cell must be positive');
if (!Number.isInteger(LEVEL.nGrid) || LEVEL.nGrid < 100 || !Number.isInteger(LEVEL.panels) || LEVEL.panels < 1)
  throw new Error('--n-grid must be at least 100 and --panels must be positive integers');
/** 1 adds the Bose-enhancement terms f₁f₂(1 + f + f₃) − f f₃(1 + f₁ + f₂); 0 keeps the classical-wave limit. */
const BOSE = KERNEL === 'quantum' ? 1 : 0;

const DATA = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const SER = DATA.series.find((s: { series: number }) => s.series === SERIES);
if (!SER) throw new Error(`no series ${SERIES} in ${DATA_PATH}`);
const MASS_KG = DATA.species.mass_amu * DATA.species.amu_kg;
const HBAR_OVER_M = (HBAR / MASS_KG) * 1e12;   // µm²/s
const DENSITY_3D = SER.density_um3 as number;  // µm⁻³, only used by the mapping
const A_A0 = SER.a_a0 as number;

/**
 * Scales set by n and a (lengths in µm, times in s):
 *   g₂ = ħ²g̃/m,  ξ = 1/√(2g̃n₂),  t₀ = 1/[(ħ/m)g̃n₂],  N_cal = 4πn₂ξ².
 * The solver works in p = kξ and τ = t/t₀; n enters the kinetics only through N_cal.
 */
const LZ_UM = Number(ARGS.lz ?? DENSITY_3D ** (-1 / 3));
if (!(LZ_UM > 0)) throw new Error('--lz must be positive (µm)');
const DENSITY = Number(ARGS['density2'] ?? DENSITY_3D * LZ_UM);  // µm⁻²
if (!(DENSITY > 0) || !Number.isFinite(DENSITY)) throw new Error('--density2 must be positive and finite (µm⁻²)');
const GTILDE = Math.sqrt(8 * Math.PI) * A_A0 * BOHR_UM / LZ_UM;
const XI_UM = 1 / Math.sqrt(2 * GTILDE * DENSITY);
const T0_S = 1 / (HBAR_OVER_M * GTILDE * DENSITY);
const NCAL = 4 * Math.PI * DENSITY * XI_UM ** 2;
const K_XI = 1 / XI_UM;

// ============================================================================================================
// 2. Grids and quadrature
// ============================================================================================================

function logGrid(lo: number, hi: number, n: number): Float64Array {
  const g = new Float64Array(n);
  const a = Math.log(lo), b = Math.log(hi);
  for (let i = 0; i < n; i++) g[i] = Math.exp(a + (b - a) * i / (n - 1));
  return g;
}

function trapz(y: ArrayLike<number>, x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length - 1; i++) s += 0.5 * (y[i] + y[i + 1]) * (x[i + 1] - x[i]);
  return s;
}

/** n-point Gauss-Legendre nodes and weights on [−1, 1] (Newton iteration on P_n). */
function leggauss(n: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < (n + 1) >> 1; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = 0;
      for (let j = 0; j < n; j++) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
      }
      pp = (n * (z * p0 - p1)) / (z * z - 1);
      const dz = p0 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  return { x, w };
}

/** Gauss-Legendre nodes on [a, b] placed uniformly in ln p, with weights for ∫ dp. */
function gaussLog(a: number, b: number, n: number): { p: Float64Array; w: Float64Array } {
  const { x, w: gw } = leggauss(n);
  const sa = Math.log(a), half = 0.5 * (Math.log(b) - sa), mid = sa + half;
  const p = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = Math.exp(half * x[i] + mid);
    w[i] = gw[i] * half * p[i];
  }
  return { p, w };
}

/** Index and weight for linear interpolation in ln p on the state grid; f(p_min) is held below the grid. */
function logInterp(lnGrid: Float64Array, value: number): { idx: number; alpha: number } {
  const lv = Math.log(value), n = lnGrid.length;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lnGrid[mid] <= lv) lo = mid + 1; else hi = mid;
  }
  let idx = lo - 1;
  const low = idx < 0;
  if (idx >= n - 1 && lv > lnGrid[n - 1] + 5e-13) throw new Error('interpolation beyond the state grid');
  idx = Math.min(Math.max(idx, 0), n - 2);
  const alpha = (lv - lnGrid[idx]) / (lnGrid[idx + 1] - lnGrid[idx]);
  return { idx, alpha: low ? 0 : Math.min(Math.max(alpha, 0), 1) };
}

/**
 * The state grid: log-spaced in p from P_MIN to p_max, with the reference level's points per decade.
 * p_max grows with ξ above the reference so that the physical cutoff k_max never falls below the reference one.
 */
const P_MAX = P_MAX_REF * Math.max(1, XI_UM / REFERENCE_XI_UM);
const N_GRID = Math.round(LEVEL.nGrid * Math.log(P_MAX / P_MIN) / Math.log(P_MAX / P_MIN_REF));
const GRID = logGrid(P_MIN, P_MAX, N_GRID);
const LN_GRID = Float64Array.from(GRID, Math.log);
const K = Float64Array.from(GRID, (p) => p / XI_UM);      // µm⁻¹
const LN_K = Float64Array.from(K, Math.log);

// ============================================================================================================
// 3. Initial state
// ============================================================================================================

/** Linear interpolation of (xs, ys) onto x, with a chosen continuation below the data and zero above it. */
function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: Float64Array, lower: 'constant' | 'power-law'): Float64Array {
  const M = xs.length, out = new Float64Array(x.length);
  let power = 0;
  if (lower === 'power-law' && ys[0] > 0 && xs[0] > 0) {
    // log-log slope of the first points, bounded to [0, 1]: q ∝ k for finite n_k at small k
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let j = 0; j < Math.min(12, M); j++) {
      if (!(ys[j] > 0) || !(xs[j] > 0)) break;
      const lx = Math.log(xs[j]), ly = Math.log(ys[j]);
      sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; c++;
    }
    const den = c * sxx - sx * sx;
    if (c >= 2 && Math.abs(den) > 1e-15) power = Math.min(1, Math.max(0, (c * sxy - sx * sy) / den));
  }
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v < xs[0]) { out[i] = lower === 'constant' ? ys[0] : (ys[0] > 0 ? ys[0] * (v / xs[0]) ** power : 0); continue; }
    if (v > xs[M - 1]) { out[i] = 0; continue; }
    let lo = 0, hi = M - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= v) lo = mid; else hi = mid;
    }
    const t = (v - xs[lo]) / (xs[hi] - xs[lo]);
    out[i] = Math.max(0, ys[lo] * (1 - t) + ys[hi] * t);
  }
  return out;
}

function normalized(q: Float64Array, x: Float64Array): Float64Array {
  const s = trapz(q, x);
  return s > 0 ? Float64Array.from(q, (v) => v / s) : q.slice();
}

/**
 * Measured n_k → shell density q(k) = 2πk n_k / ∫2πk n_k dk on a fixed input grid (n_k held at its first
 * measured value below the first point, zero above the last), then onto the solver grid, then
 * f(k) = 2πn₂q(k)/k, rescaled so that n₂ = (1/2π) ∫ k f dk exactly on the solver grid.
 */
function initialState(): { f: Float64Array; EN_nK: number } {
  const st = DATA.initial_states[SER.protocol];
  const pairs = st.k_um_inv.map((k: number, i: number) => [k, Math.max(0, st.n_k_um3[i])]).filter((r: number[]) => r[0] > 0)
    .sort((a: number[], b: number[]) => a[0] - b[0]);
  const kr = pairs.map((r: number[]) => r[0]), nr = pairs.map((r: number[]) => r[1]);
  const inputGrid = Float64Array.from(logGrid(P_MIN_REF, P_MAX_REF, 500), (p) => p / REFERENCE_XI_UM);
  const nOn = interp(kr, nr, inputGrid, 'constant');
  const q = normalized(Float64Array.from(inputGrid, (k, i) => 2 * Math.PI * k * nOn[i]), inputGrid);
  // kinetic energy per atom ħ²⟨k²⟩/2m of the measured state (independent of a)
  const k2 = trapz(Float64Array.from(inputGrid, (k, i) => k * k * q[i]), inputGrid) / trapz(q, inputGrid);
  const EN_nK = (HBAR ** 2 * k2 * 1e12) / (2 * MASS_KG * KB) * 1e9;

  const qs = normalized(interp(inputGrid, q, K, 'power-law'), K);
  const f = Float64Array.from(K, (k, i) => (2 * Math.PI * DENSITY * qs[i]) / k);
  const dens = trapz(Float64Array.from(K, (k, i) => k * f[i]), K) / (2 * Math.PI);
  if (dens > 0) for (let i = 0; i < f.length; i++) f[i] *= DENSITY / dens;
  return { f, EN_nK };
}

/** Peak of k f: least-squares parabola in (ln k, ln kf) over the contiguous top within 2% (in ln) of the maximum. */
function peakMomentum(f: Float64Array): number {
  const n = K.length;
  let iMax = 0, sMax = -Infinity;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) { s[i] = K[i] * f[i]; if (s[i] > sMax) { sMax = s[i]; iMax = i; } }
  if (iMax === 0 || iMax === n - 1) return K[iMax];
  if (s[iMax - 1] <= 0 || s[iMax] <= 0 || s[iMax + 1] <= 0) return K[iMax];
  const floor = Math.log(sMax) - 0.02;
  let lo = iMax - 1, hi = iMax + 1;
  while (lo > 0 && s[lo - 1] > 0 && Math.log(s[lo - 1]) >= floor) lo--;
  while (hi < n - 1 && s[hi + 1] > 0 && Math.log(s[hi + 1]) >= floor) hi++;
  const xc = Math.log(K[iMax]);
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (let i = lo; i <= hi; i++) {
    const x = Math.log(K[i]) - xc, y = Math.log(s[i]), x2 = x * x;
    S0 += 1; S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
    T0 += y; T1 += x * y; T2 += x2 * y;
  }
  const [A, B] = parabola(S0, S1, S2, S3, S4, T0, T1, T2);
  if (!(A < 0)) return K[iMax];
  const xl = Math.log(K[lo]) - xc, xh = Math.log(K[hi]) - xc;
  return Math.exp(xc + Math.max(xl, Math.min(xh, -B / (2 * A))));
}

/**
 * Smooth peak of k f for the observables: parabola in (ln k, ln kf) with weights exp(−(L_max − L)/0.02), so it
 * moves continuously as grid points enter or leave the top (the stop test above uses the plain top-2% fit).
 */
function peakSmooth(f: Float64Array): number {
  const delta = 0.02, n = K.length;
  let Lmax = -Infinity, iMax = 0;
  const L = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = f[i] > 0 ? Math.log(K[i] * f[i]) : -Infinity;
    if (L[i] > Lmax) { Lmax = L[i]; iMax = i; }
  }
  const xc = LN_K[iMax];
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0, xLo = 0, xHi = 0;
  for (let i = 0; i < n; i++) {
    const drop = Lmax - L[i];
    if (!(drop < 12 * delta)) continue;
    const w = Math.exp(-drop / delta), x = LN_K[i] - xc, x2 = x * x;
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x);
    S0 += w; S1 += w * x; S2 += w * x2; S3 += w * x2 * x; S4 += w * x2 * x2;
    T0 += w * L[i]; T1 += w * x * L[i]; T2 += w * x2 * L[i];
  }
  const [A, B] = parabola(S0, S1, S2, S3, S4, T0, T1, T2);
  if (!(A < 0)) return K[iMax];
  return Math.exp(xc + Math.min(xHi, Math.max(xLo, -B / (2 * A))));
}

/** Leading and linear coefficients (A, B) of the least-squares parabola from its moment sums. */
function parabola(S0: number, S1: number, S2: number, S3: number, S4: number, T0: number, T1: number, T2: number): [number, number] {
  const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) =>
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det3(S4, S3, S2, S3, S2, S1, S2, S1, S0);
  return [det3(T2, S3, S2, T1, S2, S1, T0, S1, S0) / D, det3(S4, T2, S2, S3, T1, S1, S2, T0, S0) / D];
}

// ============================================================================================================
// 4. Collision geometry: the resonant events
// ============================================================================================================

/** Resonant partners satisfy p₃²=p₁²+p₂²−p². The 2D angular integral is an event-specific
 * transfer-momentum integral. Events with the same p and p₁ share a bubble table in Q.
 */
const P_COLL = P_MAX / Math.SQRT2;
type Seg = [number, number];

/** I = K(k)/(2P), with P=max(p p3,p1 p2) and k=min(...)/P.
 * Resonance gives 1-k² = |(p²-p1²)(p²-p2²)|/P², avoiding cancellation near k=1.
 */
function angularIntegral(p: number, p1: number, p2: number, p3: number): number {
  const big = Math.max(p * p3, p1 * p2);
  const gap = Math.abs((p * p - p1 * p1) * (p * p - p2 * p2));
  if (!(big > 0) || gap === 0) return 0; // exactly trivial quartet: collision bracket vanishes
  let a = 1, b = Math.min(1, Math.sqrt(gap) / big);
  for (let i = 0; i < 32; i++) {
    const nextA = 0.5 * (a + b), nextB = Math.sqrt(a * b);
    a = nextA; b = nextB;
    if (Math.abs(a - b) <= 2e-15 * a) break;
  }
  return Math.PI / (4 * big * a);
}

function panels(a: number, b: number, out: Seg[]): void {
  const step = (Math.log(b) - Math.log(a)) / LEVEL.panels;
  let lo = a;
  for (let k = 1; k <= LEVEL.panels; k++) {
    const hi = k === LEVEL.panels ? b : Math.exp(Math.log(a) + k * step);
    out.push([lo, hi]);
    lo = hi;
  }
}
function p1Segments(p: number): Seg[] {
  const out: Seg[] = [];
  if (p >= P_COLL) { panels(P_MIN, P_COLL, out); return out; }
  if (p > P_MIN * (1 + 1e-14)) panels(P_MIN, p, out);
  if (P_COLL > p * (1 + 1e-14)) panels(Math.max(p, P_MIN), P_COLL, out);
  return out;
}
function p2Segments(p: number, p1: number): Seg[] {
  const lower = Math.max(P_MIN, Math.sqrt(Math.max(p * p - p1 * p1, 0)));   // p3² ≥ 0
  if (lower >= P_COLL * (1 - 1e-15)) return [];
  const out: Seg[] = [];
  const stops = [lower, p, p1, P_COLL].filter((x) => x >= lower && x <= P_COLL).sort((x, y) => x - y);
  for (let i = 0; i < stops.length - 1; i++)
    if (stops[i + 1] > stops[i] * (1 + 1e-12)) panels(stops[i], stops[i + 1], out);
  return out;
}

const ev = { weight: [] as number[], i1: [] as number[], a1: [] as number[], i2: [] as number[], a2: [] as number[],
  i3: [] as number[], a3: [] as number[], p2: [] as number[], q: [] as number[], qw: [] as number[],
  qSqLo: [] as number[], qSqHi: [] as number[], otherLo: [] as number[], otherHi: [] as number[], geomNear: [] as number[] };
const Q_NODES = Number(ARGS['q-nodes'] ?? (ACCURACY === 'draft' ? 4 : 12));
if (!Number.isInteger(Q_NODES) || Q_NODES < 4 || Q_NODES > 64) throw new Error('--q-nodes must be an integer from 4 to 64');
const pairOff: number[] = [0], pairTarget: number[] = [], pairP1: number[] = [];
const targetPairs = new Int32Array(N_GRID + 1);
for (let ip = 0; ip < N_GRID; ip++) {
  const p = GRID[ip], pSq = p * p;
  for (const [a, b] of p1Segments(p)) {
    const q1 = gaussLog(a, b, LEVEL.nq);
    for (let j = 0; j < LEVEL.nq; j++) {
      const p1 = q1.p[j], m1 = logInterp(LN_GRID, p1), start = ev.weight.length;
      for (const [c, d] of p2Segments(p, p1)) {
        const q2 = gaussLog(c, d, LEVEL.nq);
        for (let m = 0; m < LEVEL.nq; m++) {
          const p2 = q2.p[m], p3sq = p1 * p1 + p2 * p2 - pSq;
          if (!(p3sq > 0)) continue;
          const p3 = Math.sqrt(p3sq);
          const exactAngular = angularIntegral(p, p1, p2, p3);
          if (!(exactAngular > 0)) continue;
          const a2 = (p - p1) ** 2, b2 = (p + p1) ** 2;
          const c2 = (p2 - p3) ** 2, d2 = (p2 + p3) ** 2;
          const lo = Math.max(a2, c2), hi = Math.min(b2, d2);
          if (!(hi > lo)) continue;
          const otherLo = Math.min(a2, c2), otherHi = Math.max(b2, d2);
          const qStart = ev.q.length;
          let angular = 0;
          for (let z = 0; z < Q_NODES; z++) {
            const theta = Math.PI * (z + 0.5) / Q_NODES;
            const qsq = 0.5 * (lo + hi) + 0.5 * (hi - lo) * Math.cos(theta);
            const weight = Math.PI / (2 * Q_NODES * Math.sqrt((qsq - otherLo) * (otherHi - qsq)));
            ev.q.push(Math.sqrt(qsq)); ev.qw.push(weight); angular += weight;
          }
          if (!Number.isFinite(angular)) { ev.q.length = qStart; ev.qw.length = qStart; continue; }
          const m2 = logInterp(LN_GRID, p2), m3 = logInterp(LN_GRID, p3);
          ev.weight.push(q1.w[j] * q2.w[m] * p1 * p2 * exactAngular);
          ev.qSqLo.push(lo); ev.qSqHi.push(hi); ev.otherLo.push(otherLo); ev.otherHi.push(otherHi);
          const bigProduct = Math.max(p * p3, p1 * p2);
          ev.geomNear.push(Math.abs((pSq - p1 * p1) * (pSq - p2 * p2)) < 1e-8 * bigProduct * bigProduct ? 1 : 0);
          ev.i1.push(m1.idx); ev.a1.push(m1.alpha); ev.i2.push(m2.idx); ev.a2.push(m2.alpha);
          ev.i3.push(m3.idx); ev.a3.push(m3.alpha); ev.p2.push(p2);
        }
      }
      if (ev.weight.length > start) { pairTarget.push(ip); pairP1.push(p1); pairOff.push(ev.weight.length); }
    }
  }
  targetPairs[ip + 1] = pairTarget.length;
}
const W = Float64Array.from(ev.weight);
let EVENT_Q = Float64Array.from(ev.q), EVENT_QW = Float64Array.from(ev.qw);
const Q_SQ_LO = Float64Array.from(ev.qSqLo), Q_SQ_HI = Float64Array.from(ev.qSqHi);
const OTHER_LO = Float64Array.from(ev.otherLo), OTHER_HI = Float64Array.from(ev.otherHi);
const GEOM_NEAR = Uint8Array.from(ev.geomNear);
const I1 = Int32Array.from(ev.i1), A1 = Float64Array.from(ev.a1);
const I2 = Int32Array.from(ev.i2), A2 = Float64Array.from(ev.a2);
const I3 = Int32Array.from(ev.i3), A3 = Float64Array.from(ev.a3);
const PAIR_OFF = Int32Array.from(pairOff);
const N_PAIRS = pairTarget.length;

// ============================================================================================================
// 5. Transfer-momentum tables per pair
// ============================================================================================================

/** For fixed p,p₁, table L₋ on Q ∈ [|p−p₁|,p+p₁] at each cell end and midpoint. */
const MIN_CELLS = 16;
const pairQlo = new Float64Array(N_PAIRS), pairH = new Float64Array(N_PAIRS), pairOmega = new Float64Array(N_PAIRS);
const pairCells = new Int32Array(N_PAIRS), pairNode = new Int32Array(N_PAIRS), pairCellBase = new Int32Array(N_PAIRS);
let nNodes = 0, nCells = 0;
for (let k = 0; k < N_PAIRS; k++) {
  const p = GRID[pairTarget[k]], p1 = pairP1[k];
  const qlo = Math.abs(p - p1), qhi = p + p1;
  const cells = Math.min(LEVEL.channelCellsMax, Math.max(MIN_CELLS, Math.ceil((qhi - qlo) / LEVEL.channelCell)));
  const h = (qhi - qlo) / cells;
  pairQlo[k] = qlo; pairH[k] = h; pairOmega[k] = Math.abs(p * p - p1 * p1); pairCells[k] = cells;
  pairNode[k] = nNodes; pairCellBase[k] = nCells;
  nNodes += 2 * cells + 1; nCells += cells + 1;
}

/** Project each event's angular measure onto the pair's positive, linearly interpolated M(Q) nodes. */
const sparseOff: number[] = [0], sparseIndex: number[] = [], sparseWeight: number[] = [];
const EVENT_CELL_FIRST = new Uint8Array(W.length), EVENT_CELL_LAST = new Uint8Array(W.length);
for (let k = 0; k < N_PAIRS; k++) {
  const off = pairNode[k], cells = pairCells[k], qlo = pairQlo[k], h = pairH[k];
  for (let e = PAIR_OFF[k]; e < PAIR_OFF[k + 1]; e++) {
    EVENT_CELL_FIRST[e] = Math.max(0, Math.min(cells - 1, Math.floor((Math.sqrt(Q_SQ_LO[e]) - qlo) / h)));
    EVENT_CELL_LAST[e] = Math.max(0, Math.min(cells - 1, Math.floor((Math.sqrt(Q_SQ_HI[e]) - qlo) / h)));
    let total = 0;
    for (let z = e * Q_NODES; z < (e + 1) * Q_NODES; z++) total += EVENT_QW[z];
    const row = new Map<number, number>();
    for (let z = e * Q_NODES; z < (e + 1) * Q_NODES; z++) {
      const t = Math.max(0, Math.min(2 * cells, 2 * (EVENT_Q[z] - qlo) / h));
      const j = Math.min(2 * cells - 1, t | 0), r = t - j, weight = EVENT_QW[z] / total;
      row.set(off + j, (row.get(off + j) ?? 0) + weight * (1 - r));
      row.set(off + j + 1, (row.get(off + j + 1) ?? 0) + weight * r);
    }
    let sum = 0;
    for (const weight of row.values()) sum += weight;
    for (const [index, weight] of row) { sparseIndex.push(index); sparseWeight.push(weight / sum); }
    sparseOff.push(sparseIndex.length);
  }
}
const SPARSE_OFF = Int32Array.from(sparseOff), SPARSE_INDEX = Int32Array.from(sparseIndex);
const SPARSE_WEIGHT = Float64Array.from(sparseWeight);
EVENT_Q = new Float64Array(0); EVENT_QW = new Float64Array(0);
for (const values of Object.values(ev)) values.length = 0;

// ============================================================================================================
// 6. The two-dimensional retarded bubble
// ============================================================================================================

/** The angular integral is 2π/√((A+i0)²−(2sQ)²).  For x=|A|/(2Q),
 * R(x)=∫₀ˣ sf(s)/√(x²−s²) ds and I(x)=∫ₓ∞ sf(s)/√(s²−x²) ds.
 * Both are linear in f, and hat-function moments are integrated analytically.
 */
const NX = LEVEL.loopTable;
const X_LO = GRID[0] / 10, X_HI = 20 * GRID[N_GRID - 1];
const LNX0 = Math.log(X_LO), DU = (Math.log(X_HI) - LNX0) / (NX - 1), INV_DU = 1 / DU;
const XT = Float64Array.from({ length: NX }, (_, m) => Math.exp(LNX0 + m * DU));
const MR = new Float64Array(NX * N_GRID), MI = new Float64Array(NX * N_GRID);

function rootMoments(a: number, b: number, x: number, inside: boolean): [number, number] {
  const lo = inside ? a : Math.max(a, x), hi = inside ? Math.min(b, x) : b;
  if (!(hi > lo)) return [0, 0];
  const primitive = (s: number): [number, number] => {
    if (inside) {
      const root = Math.sqrt(Math.max(0, x * x - s * s));
      return [-root, 0.5 * (x * x * Math.asin(Math.min(1, s / x)) - s * root)];
    }
    const root = Math.sqrt(Math.max(0, s * s - x * x));
    return [root, 0.5 * (s * root + x * x * Math.acosh(Math.max(1, s / x)))];
  };
  const l = primitive(lo), h = primitive(hi);
  return [h[0] - l[0], h[1] - l[1]];
}
function addRootCell(row: number, a: number, b: number, x: number, j: number, constant: boolean): void {
  for (const [inside, mat] of [[true, MR], [false, MI]] as const) {
    const [m1, m2] = rootMoments(a, b, x, inside);
    if (constant) mat[row] += m1;
    else { mat[row + j] += (b * m1 - m2) / (b - a); mat[row + j + 1] += (m2 - a * m1) / (b - a); }
  }
}
for (let m = 0; m < NX; m++) {
  const row = m * N_GRID;
  addRootCell(row, 0, GRID[0], XT[m], 0, true);
  for (let j = 0; j < N_GRID - 1; j++) addRootCell(row, GRID[j], GRID[j + 1], XT[m], j, false);
}
const Rt = new Float64Array(NX), It = new Float64Array(NX);
function updateLoops(f: Float64Array): void {
  if (!CHAIN) return;
  for (let m = 0; m < NX; m++) {
    const row = m * N_GRID;
    let r = 0, im = 0;
    for (let j = 0; j < N_GRID; j++) { r += MR[row + j] * f[j]; im += MI[row + j] * f[j]; }
    Rt[m] = r; It[m] = im;
  }
}
function rootTable(x: number, table: Float64Array, real: boolean): number {
  if (x <= X_LO) return real ? table[0] * x / X_LO : table[0];
  if (x >= X_HI) return real ? table[NX - 1] * X_HI / x : 0;
  const t = (Math.log(x) - LNX0) * INV_DU;
  const i = Math.min(NX - 2, Math.max(0, t | 0));
  return table[i] + (t - i) * (table[i + 1] - table[i]);
}
function lMinusRe(Q: number, w: number): number {
  const a = (w + Q * Q) / (2 * Q), b = (w - Q * Q) / (2 * Q);
  return (rootTable(Math.abs(a), Rt, true) - Math.sign(b) * rootTable(Math.abs(b), Rt, true)) / Q;
}
function lMinusIm(Q: number, w: number): number {
  const a = (w + Q * Q) / (2 * Q), b = (w - Q * Q) / (2 * Q);
  return (rootTable(Math.abs(a), It, false) - rootTable(Math.abs(b), It, false)) / Q;
}

/** Fixed Q and ω permit the bubble table lookups to be prepared once. */
const BUB_A_I = new Int32Array(nNodes), BUB_B_I = new Int32Array(nNodes);
const BUB_A_T = new Float64Array(nNodes), BUB_B_T = new Float64Array(nNodes);
const BUB_SCALE = new Float64Array(nNodes), BUB_SIGN_B = new Int8Array(nNodes);
function prepareBubbleX(x: number, index: Int32Array, alpha: Float64Array, z: number): void {
  if (x <= X_LO) { index[z] = -1; alpha[z] = x / X_LO; return; }
  if (x >= X_HI) { index[z] = NX - 1; alpha[z] = X_HI / x; return; }
  const t = (Math.log(x) - LNX0) * INV_DU;
  const i = Math.min(NX - 2, Math.max(0, t | 0));
  index[z] = i; alpha[z] = t - i;
}
for (let k = 0; k < N_PAIRS; k++) {
  const off = pairNode[k], cells = pairCells[k], h = pairH[k], qlo = pairQlo[k], w = pairOmega[k];
  for (let s = 0; s <= 2 * cells; s++) {
    const z = off + s, Q = Math.max(1e-12, qlo + 0.5 * h * s);
    const a = (w + Q * Q) / (2 * Q), b = (w - Q * Q) / (2 * Q);
    prepareBubbleX(Math.abs(a), BUB_A_I, BUB_A_T, z);
    prepareBubbleX(Math.abs(b), BUB_B_I, BUB_B_T, z);
    BUB_SCALE[z] = 1 / Q;
    BUB_SIGN_B[z] = Math.sign(b);
  }
}

// ============================================================================================================
// 7. Chain weight over the event-specific transfer measure
// ============================================================================================================

/** Quadratic interpolation of U=1−Re L₋ and V=Im L₋ on each pair's Q table. */
const U = new Float64Array(nNodes), V = new Float64Array(nNodes);
const MNODE = new Float64Array(nNodes);
const NEAR_PREFIX = new Uint16Array(nCells);
const ANGLE_RULES: Record<number, { x: Float64Array; w: Float64Array }> =
  { 8: leggauss(8), 16: leggauss(16), 32: leggauss(32), 64: leggauss(64) };
let unresolvedAnglePanels = 0;
let nearEventCalls = 0, rhsCalls = 0;
const WALL_CAP = Symbol('wall-cap');
let wallDeadline = Infinity;

function vertexAtQ(Q: number, pair: number): number {
  const off = pairNode[pair], cells = pairCells[pair], qlo = pairQlo[pair], h = pairH[pair];
  const t = Math.max(0, Math.min(cells, (Q - qlo) / h));
  const j = Math.min(cells - 1, t | 0), r = t - j, b = off + 2 * j;
  const l0 = (2 * r - 1) * (r - 1), l1 = 4 * r * (1 - r), l2 = r * (2 * r - 1);
  const u = U[b] * l0 + U[b + 1] * l1 + U[b + 2] * l2;
  const v = V[b] * l0 + V[b + 1] * l1 + V[b + 2] * l2;
  return 1 / (u * u + v * v);
}

/** In x=Q² the endpoint Jacobian is removed by x=(L+U)/2+(U-L)cos(phi)/2. */
function anglePanel(e: number, pair: number, a: number, b: number, order: number): [number, number] {
  const rule = ANGLE_RULES[order], mid = 0.5 * (a + b), half = 0.5 * (b - a);
  const lo = Q_SQ_LO[e], hi = Q_SQ_HI[e], otherLo = OTHER_LO[e], otherHi = OTHER_HI[e];
  let numerator = 0, denominator = 0;
  for (let j = 0; j < order; j++) {
    const phi = mid + half * rule.x[j];
    const x = 0.5 * (lo + hi) + 0.5 * (hi - lo) * Math.cos(phi);
    const weight = 0.5 * half * rule.w[j] / Math.sqrt((x - otherLo) * (otherHi - x));
    numerator += weight * vertexAtQ(Math.sqrt(x), pair);
    denominator += weight;
  }
  return [numerator, denominator];
}

function adaptiveAnglePanel(e: number, pair: number, a: number, b: number, depth = 0): [number, number] {
  let previous = anglePanel(e, pair, a, b, 8);
  for (const order of [16, 32, 64]) {
    const current = anglePanel(e, pair, a, b, order);
    const average = current[0] / current[1], previousAverage = previous[0] / previous[1];
    if (Math.abs(average - previousAverage) / Math.max(Math.abs(average), 1e-30) <= 1e-3) return current;
    previous = current;
  }
  if (depth < 2) {
    const mid = 0.5 * (a + b);
    const left = adaptiveAnglePanel(e, pair, a, mid, depth + 1);
    const right = adaptiveAnglePanel(e, pair, mid, b, depth + 1);
    return [left[0] + right[0], left[1] + right[1]];
  }
  unresolvedAnglePanels++;
  return previous;
}

/** Angular average with the exact 2D transfer measure, sampled at Chebyshev nodes in Q². */
function eventChainAverage(e: number, pair: number): number {
  let numerator = 0, denominator = 0;
  const cellBase = pairCellBase[pair];
  if (GEOM_NEAR[e] || NEAR_PREFIX[cellBase + EVENT_CELL_LAST[e] + 1] !== NEAR_PREFIX[cellBase + EVENT_CELL_FIRST[e]]) {
    nearEventCalls++;
    const lo = Q_SQ_LO[e], hi = Q_SQ_HI[e], otherLo = OTHER_LO[e], otherHi = OTHER_HI[e];
    const qlo = pairQlo[pair], h = pairH[pair], breaks = [0, Math.PI];
    const angleAt = (x: number) => Math.acos(Math.max(-1, Math.min(1, (2 * x - lo - hi) / (hi - lo))));
    for (let j = EVENT_CELL_FIRST[e]; j <= EVENT_CELL_LAST[e]; j++) {
      if (NEAR_PREFIX[cellBase + j + 1] === NEAR_PREFIX[cellBase + j]) continue;
      const q0 = qlo + j * h, q1 = q0 + h;
      for (const x of [q0 * q0, q1 * q1]) if (x > lo && x < hi) breaks.push(angleAt(x));
    }
    breaks.sort((a, b) => a - b);
    for (let j = 0; j < breaks.length - 1; j++) {
      const a = breaks[j], b = breaks[j + 1];
      if (b - a < 1e-12) continue;
      const xmid = 0.5 * (lo + hi) + 0.5 * (hi - lo) * Math.cos(0.5 * (a + b));
      const qmid = Math.sqrt(xmid);
      const cell = Math.max(0, Math.min(pairCells[pair] - 1, Math.floor((qmid - qlo) / h)));
      const flagged = GEOM_NEAR[e] || NEAR_PREFIX[cellBase + cell + 1] !== NEAR_PREFIX[cellBase + cell];
      const part = flagged ? adaptiveAnglePanel(e, pair, a, b) : anglePanel(e, pair, a, b, 8);
      numerator += part[0]; denominator += part[1];
    }
    return numerator / denominator;
  }
  for (let z = SPARSE_OFF[e]; z < SPARSE_OFF[e + 1]; z++) numerator += SPARSE_WEIGHT[z] * MNODE[SPARSE_INDEX[z]];
  return numerator;
}

// ============================================================================================================
// 8. The right-hand side ∂τ f
// ============================================================================================================

const PREFACTOR = 32 / (Math.PI * NCAL * NCAL);
const COUPLING = 1 / NCAL;   // repulsive a > 0
let benchTimings = [0, 0, 0];

function rhs(f: Float64Array, out: Float64Array): void {
  rhsCalls++;
  const t0 = ARGS.diagnostic === 'bench' ? performance.now() : 0;
  updateLoops(f);
  const t1 = ARGS.diagnostic === 'bench' ? performance.now() : 0;
  // loops at each pair-table node
  for (let k = 0; CHAIN && k < N_PAIRS; k++) {
    const off = pairNode[k], cells = pairCells[k];
    for (let s = 0; s <= 2 * cells; s++) {
      const z = off + s, ai = BUB_A_I[z], bi = BUB_B_I[z];
      const at = BUB_A_T[z], bt = BUB_B_T[z];
      let ra: number, ia: number, rb: number, ib: number;
      if (ai < 0) { ra = Rt[0] * at; ia = It[0]; }
      else if (ai >= NX - 1) { ra = Rt[NX - 1] * at; ia = 0; }
      else { ra = Rt[ai] + at * (Rt[ai + 1] - Rt[ai]); ia = It[ai] + at * (It[ai + 1] - It[ai]); }
      if (bi < 0) { rb = Rt[0] * bt; ib = It[0]; }
      else if (bi >= NX - 1) { rb = Rt[NX - 1] * bt; ib = 0; }
      else { rb = Rt[bi] + bt * (Rt[bi + 1] - Rt[bi]); ib = It[bi] + bt * (It[bi + 1] - It[bi]); }
      const scale = 0.5 * COUPLING * BUB_SCALE[z];
      U[z] = 1 - scale * (ra - BUB_SIGN_B[z] * rb);
      V[z] = -scale * (ia - ib);
      MNODE[z] = 1 / (U[z] * U[z] + V[z] * V[z]);
    }
    const nearBase = pairCellBase[k];
    NEAR_PREFIX[nearBase] = 0;
    for (let j = 0; j < cells; j++) {
      const b = off + 2 * j;
      const d0 = U[b] ** 2 + V[b] ** 2, d1 = U[b + 1] ** 2 + V[b + 1] ** 2;
      const d2 = U[b + 2] ** 2 + V[b + 2] ** 2;
      const crossing = (U[b] * U[b + 1] <= 0 || U[b + 1] * U[b + 2] <= 0) &&
        Math.min(Math.abs(V[b]), Math.abs(V[b + 1]), Math.abs(V[b + 2])) < 0.2;
      NEAR_PREFIX[nearBase + j + 1] = NEAR_PREFIX[nearBase + j] + (Math.min(d0, d1, d2) < 0.04 || crossing ? 1 : 0);
    }

  }
  const t2 = ARGS.diagnostic === 'bench' ? performance.now() : 0;
  // event sweep: gain − loss, each event weighted by its chain average
  for (let i = 0; i < N_GRID; i++) {
    if (Date.now() >= wallDeadline) throw WALL_CAP;
    const fp = f[i];
    let sg = 0, sl = 0;
    for (let k = targetPairs[i]; k < targetPairs[i + 1]; k++) {
      for (let e = PAIR_OFF[k]; e < PAIR_OFF[k + 1]; e++) {
        const j1 = I1[e], j2 = I2[e], j3 = I3[e], u1 = A1[e], u2 = A2[e], u3 = A3[e];
        const f1 = (1 - u1) * f[j1] + u1 * f[j1 + 1];
        const f2 = (1 - u2) * f[j2] + u2 * f[j2 + 1];
        const f3 = (1 - u3) * f[j3] + u3 * f[j3 + 1];
        const gain = f1 * f2 * (BOSE + fp + f3);
        const loss = fp * f3 * (BOSE + f1 + f2);
        const M = CHAIN ? eventChainAverage(e, k) : 1;
        const w = W[e];
        sg += w * M * gain;
        sl += w * M * loss;
      }
    }
    out[i] = PREFACTOR * (sg - sl);
  }
  if (ARGS.diagnostic === 'bench') benchTimings = [t1 - t0, t2 - t1, performance.now() - t2];
}

// ============================================================================================================
// 9. Observables
// ============================================================================================================

/** ∫ k^m f dk on the physical grid: m = 1 is ∝ the density, m = 3 ∝ the kinetic energy. */
function moment(f: Float64Array, m: number): number {
  let s = 0;
  for (let i = 0; i < N_GRID - 1; i++) s += 0.5 * (K[i] ** m * f[i] + K[i + 1] ** m * f[i + 1]) * (K[i + 1] - K[i]);
  return s;
}
/** f(k→0) = e^A from the least-squares fit ln f = A + B k² over the grid points with k ≤ kMax. */
function f0Fit(f: Float64Array, kMax: number): number {
  let S0 = 0, S1 = 0, S2 = 0, T0 = 0, T1 = 0;
  for (let i = 0; i < N_GRID && K[i] <= kMax; i++) {
    if (!(f[i] > 0)) continue;
    const x = K[i] * K[i], y = Math.log(f[i]);
    S0 += 1; S1 += x; S2 += x * x; T0 += y; T1 += x * y;
  }
  if (S0 < 3) return f[0];
  return Math.exp((T0 * S2 - T1 * S1) / (S0 * S2 - S1 * S1));
}

const C = new Float64Array(N_GRID), FP = new Float64Array(N_GRID), FM = new Float64Array(N_GRID);
/**
 * ℓ̄² = f(k→0)/n₂ and (m/ħ) dℓ̄²/dt = ℓ̄² (∂τ ln f₀)/t₀/(ħ/m), with ∂τ f₀ from the fit applied to f ± εC,
 * C = ∂τ f the collision term. f₀ is fitted over k ≤ k_p/5; the uncertainty is the largest deviation over the
 * windows k_p/5 and k_p/10 and the steps ε and 2ε. (The plots divide by the condensed fraction for ℓ.)
 */
function ellAt(f: Float64Array, kp: number): [number, number, number] {
  rhs(f, C);
  const ell = Math.sqrt(f0Fit(f, kp / 5) / DENSITY);
  let cmax = 0;
  for (let i = 0; i < N_GRID && K[i] <= kp / 5; i++) cmax = Math.max(cmax, Math.abs(C[i]) / Math.max(f[i], 1e-300));
  const eps0 = cmax > 0 ? 1e-3 / cmax : 1e-6;
  const est: number[] = [];
  for (const kMax of [kp / 5, kp / 10]) {
    const f0w = f0Fit(f, kMax);
    for (const eps of [eps0, 2 * eps0]) {
      for (let i = 0; i < N_GRID; i++) { FP[i] = f[i] + eps * C[i]; FM[i] = f[i] - eps * C[i]; }
      const dlnf0 = (f0Fit(FP, kMax) - f0Fit(FM, kMax)) / (2 * eps * f0w);
      est.push((dlnf0 / T0_S / HBAR_OVER_M) * (f0w / DENSITY));
    }
  }
  let err = 0;
  for (const v of est) err = Math.max(err, Math.abs(v - est[0]));
  return [ell, est[0], err];
}

// ============================================================================================================
// 10. Time integration: Dormand-Prince 5(4)
// ============================================================================================================

const DP = {
  a21: 1 / 5, a31: 3 / 40, a32: 9 / 40, a41: 44 / 45, a42: -56 / 15, a43: 32 / 9,
  a51: 19372 / 6561, a52: -25360 / 2187, a53: 64448 / 6561, a54: -212 / 729,
  a61: 9017 / 3168, a62: -355 / 33, a63: 46732 / 5247, a64: 49 / 176, a65: -5103 / 18656,
  b1: 35 / 384, b3: 500 / 1113, b4: 125 / 192, b5: -2187 / 6784, b6: 11 / 84,
  e1: 71 / 57600, e3: -71 / 16695, e4: 71 / 1920, e5: -17253 / 339200, e6: 22 / 525, e7: -1 / 40,
};

/** Cubic Hermite interpolation of f inside an accepted step, from both ends and their derivatives. */
function hermite(y0: Float64Array, y1: Float64Array, d0: Float64Array, d1: Float64Array, t0: number, h: number, t: number): Float64Array {
  const out = new Float64Array(N_GRID);
  const s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let i = 0; i < N_GRID; i++) out[i] = h00 * y0[i] + h * h10 * d0[i] + h01 * y1[i] + h * h11 * d1[i];
  return out;
}

function main(): void {
  const wall0 = Date.now();
  const { f: f0, EN_nK } = initialState();
  const kp0 = peakMomentum(f0);
  const target = SER.target_kxi_over_kp as number;
  const kpStop = Number.isFinite(LENGTH_STOP_UM) ? 3 / LENGTH_STOP_UM
    : kp0 * Math.min((K_XI / kp0) / target, 0.999);
  const N0 = moment(f0, 1), E0 = moment(f0, 3);

  // samples at 60 per decade in t from 10 µs, recorded on the dense output
  const tauEval = Array.from({ length: 1201 }, (_, i) => 1e-5 * 10 ** (i / 60) / T0_S);
  const pts = { t_s: [] as number[], X: [] as number[], kpRate: [] as number[], ell_um: [] as number[], ellRate: [] as number[],
    ellRateErr: [] as number[], N_rel: [] as number[], E_rel: [] as number[] };
  const snapshots = { k_um_inv: Array.from(K), t_s: [] as number[], n_k: [] as number[][] };
  let lastSave = Date.now();
  const save = (status: string) => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      schema: 'wke-chain-run/1', status, wall_s: (Date.now() - wall0) / 1000,
      numerics: { rhsCalls, nearEventCalls, unresolvedAnglePanels },
      settings: { series: SERIES, protocol: SER.protocol, a_a0: A_A0, density_um3: DENSITY_3D, density_um2: DENSITY,
        lz_um: LZ_UM, gtilde: GTILDE, V_um3: SER.V_um3,
        accuracy: ACCURACY, kernel: KERNEL, model: 'bubble chain (N -> infinity)', target_kxi_over_kp: target,
        pMin: P_MIN, pMax: P_MAX, nGrid: N_GRID, panels: LEVEL.panels, events: W.length, qNodes: Q_NODES,
        channelCell: LEVEL.channelCell, tau_stop: TAU_STOP, wall_cap_s: WALL_S,
        length_stop_um: Number.isFinite(LENGTH_STOP_UM) ? LENGTH_STOP_UM : null },
      scales: { xi_um: XI_UM, kXi_um_inv: K_XI, t0_s: T0_S, ncal: NCAL, hbarOverM_um2_per_s: HBAR_OVER_M },
      initial: { kp0_um_inv: kp0, EN_nK },
      points: pts,
      snapshots,
    }));
  };
  const record = (tau: number, f: Float64Array) => {
    if (pts.t_s.length % 10 === 0) {
      snapshots.t_s.push(tau * T0_S);
      snapshots.n_k.push(Array.from(f));
    }
    const kp = peakSmooth(f);
    const [ell, rate, err] = ellAt(f, kp);
    // ellAt leaves the collision term C = df/dτ available for the instantaneous peak rate.
    let ip = 0;
    while (ip < N_GRID - 1 && K[ip] < kp) ip++;
    let cmax = 0;
    for (let i = Math.max(0, ip - 20); i < Math.min(N_GRID, ip + 20); i++) cmax = Math.max(cmax, Math.abs(C[i]));
    const eps = cmax > 0 ? 1e-3 * Math.max(Math.abs(f[ip]), 1e-300) / cmax : 1e-6;
    for (let i = 0; i < N_GRID; i++) { FP[i] = f[i] + eps * C[i]; FM[i] = f[i] - eps * C[i]; }
    const dkp = (peakSmooth(FP) - peakSmooth(FM)) / (2 * eps);
    const kpRate = -2 * dkp / (kp * kp * kp * T0_S * HBAR_OVER_M);
    pts.t_s.push(tau * T0_S); pts.X.push(K_XI / kp); pts.kpRate.push(kpRate);
    pts.ell_um.push(ell); pts.ellRate.push(rate); pts.ellRateErr.push(err);
    pts.N_rel.push(moment(f, 1) / N0); pts.E_rel.push(moment(f, 3) / E0);
    if (Date.now() - lastSave > 30000) { lastSave = Date.now(); save('running'); }
  };

  const n = N_GRID, alloc = () => new Float64Array(n);
  const k1 = alloc(), k2 = alloc(), k3 = alloc(), k4 = alloc(), k5 = alloc(), k6 = alloc(), k7 = alloc(), yT = alloc();
  const y = f0.slice();
  const { rtol, atol } = LEVEL;
  const tauMax = TAU_STOP, hMax = 1e6 / 20;
  let tau = 0, evalIdx = 0, rejects = 0;
  rhs(y, k1);
  wallDeadline = wall0 + 1000 * WALL_S;
  let h = 1e6 / 2000;
  { let sc = 0; for (let i = 0; i < n; i++) sc = Math.max(sc, Math.abs(k1[i]) / (atol + rtol * Math.abs(y[i]))); if (sc > 0) h = Math.min(h, 0.01 / sc); }
  let kpPrev = kp0;
  let status = 'tauMax';

  try { while (tau < tauMax) {
    if ((Date.now() - wall0) / 1000 > WALL_S) { status = 'wall-cap'; break; }
    if (tau + h > tauMax) h = tauMax - tau;
    if (rejects > 60 || !(h > 0)) { status = 'nonfinite'; break; }
    const stage = (out: Float64Array, c: (i: number) => number) => { for (let i = 0; i < n; i++) yT[i] = y[i] + h * c(i); rhs(yT, out); };
    stage(k2, (i) => DP.a21 * k1[i]);
    stage(k3, (i) => DP.a31 * k1[i] + DP.a32 * k2[i]);
    stage(k4, (i) => DP.a41 * k1[i] + DP.a42 * k2[i] + DP.a43 * k3[i]);
    stage(k5, (i) => DP.a51 * k1[i] + DP.a52 * k2[i] + DP.a53 * k3[i] + DP.a54 * k4[i]);
    stage(k6, (i) => DP.a61 * k1[i] + DP.a62 * k2[i] + DP.a63 * k3[i] + DP.a64 * k4[i] + DP.a65 * k5[i]);
    stage(k7, (i) => DP.b1 * k1[i] + DP.b3 * k3[i] + DP.b4 * k4[i] + DP.b5 * k5[i] + DP.b6 * k6[i]);   // yT = 5th-order solution
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = h * (DP.e1 * k1[i] + DP.e3 * k3[i] + DP.e4 * k4[i] + DP.e5 * k5[i] + DP.e6 * k6[i] + DP.e7 * k7[i]);
      const r = e / (atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yT[i])));
      err += r * r;
    }
    err = Math.sqrt(err / n);
    if (!Number.isFinite(err)) { rejects++; h *= 0.2; continue; }
    if (err > 1) { rejects++; h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2)); continue; }
    rejects = 0;

    const tauNew = tau + h;
    const kpNew = peakMomentum(yT);
    const reached = kpPrev > kpStop && kpNew <= kpStop;
    while (evalIdx < tauEval.length && tauEval[evalIdx] <= tauNew + 1e-15) {
      const te = tauEval[evalIdx];
      if (te >= tau - 1e-15) record(te, te <= tau ? y : hermite(y, yT, k1, k7, tau, h, te));
      evalIdx++;
    }
    tau = tauNew;
    y.set(yT);
    k1.set(k7);   // first-same-as-last
    kpPrev = kpNew;
    if (reached) { status = Number.isFinite(LENGTH_STOP_UM) ? 'length-stop' : 'target'; break; }
    h = Math.min(hMax, h * Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
  } } catch (error) {
    if (error !== WALL_CAP) throw error;
    status = 'wall-cap';
  }
  save(status);
  const x = pts.X.at(-1) ?? NaN;
  console.log(`s${String(SERIES).padStart(2, '0')} ${SER.protocol} a=${A_A0} ${KERNEL} ${ACCURACY}: ${status}, k_xi/k_p ${x.toFixed(2)}, ` +
    `${((Date.now() - wall0) / 1000).toFixed(0)} s`);
}

if (ARGS.diagnostic === 'rj') {
  const thermal = Float64Array.from(GRID, (p) => 1 / (1 + p * p));
  const perturbed = Float64Array.from(GRID, (p, i) => thermal[i] * (1 + 0.2 * Math.exp(-(Math.log(p) ** 2))));
  const ct = new Float64Array(N_GRID), cp = new Float64Array(N_GRID);
  rhs(thermal, ct); rhs(perturbed, cp);
  const rms = (a: Float64Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  console.log(JSON.stringify({ diagnostic: 'rj', series: SERIES, chain: CHAIN, thermal_rms: rms(ct),
    perturbed_rms: rms(cp), ratio: rms(ct) / rms(cp) }));
} else if (ARGS.diagnostic === 'bubble') {
  updateLoops(Float64Array.from(GRID, (p) => Math.exp(-p * p)));
  const Q = 0.7, w = 1.1;
  console.log(JSON.stringify({ diagnostic: 'bubble', Q, w, re: lMinusRe(Q, w), im: lMinusIm(Q, w) }));
} else if (ARGS.diagnostic === 'bench') {
  const f = initialState().f, out = new Float64Array(N_GRID);
  rhs(f, out);
  const start = performance.now();
  for (let i = 0; i < 3; i++) rhs(f, out);
  console.log(JSON.stringify({ diagnostic: 'bench', series: SERIES, chain: CHAIN,
    q_nodes: Q_NODES, setup_ms: start - SETUP_START, ms_per_rhs: (performance.now() - start) / 3, phases_ms: benchTimings,
    checksum: out.reduce((s, v) => s + v, 0) }));
} else main();
