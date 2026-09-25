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
 *   t_s, X = k_ξ/k_p, ell_um = ℓ̄ = (f(k→0)/n)^(1/3), ellRate = (m/ħ) dℓ̄²/dt from the collision term, its
 *   uncertainty ellRateErr, and the particle number and kinetic energy relative to t = 0 (N_rel, E_rel).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  draft:    { nGrid: 300,  nq: 12, panels: 1, rtol: 1e-5, atol: 1e-8,  loopTable: 600,  channelCell: 0.4,  channelCellsMax: 32 },
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
const WALL_S = Number(ARGS.wall ?? 1500);
const DATA_PATH = ARGS.data ?? join(HERE, 'data', 'fig4c_data.json');
const OUT = ARGS.out ?? join(HERE, 'out', 'runs', `s${String(SERIES).padStart(2, '0')}.json`);
if (!LEVELS[ACCURACY]) throw new Error(`unknown --accuracy ${ACCURACY}`);
if (KERNEL !== 'quantum' && KERNEL !== 'classical') throw new Error(`unknown --kernel ${KERNEL}`);
const LEVEL = LEVELS[ACCURACY];
/** 1 adds the Bose-enhancement terms f₁f₂(1 + f + f₃) − f f₃(1 + f₁ + f₂); 0 keeps the classical-wave limit. */
const BOSE = KERNEL === 'quantum' ? 1 : 0;

const DATA = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const SER = DATA.series.find((s: { series: number }) => s.series === SERIES);
if (!SER) throw new Error(`no series ${SERIES} in ${DATA_PATH}`);
const MASS_KG = DATA.species.mass_amu * DATA.species.amu_kg;
const HBAR_OVER_M = (HBAR / MASS_KG) * 1e12;   // µm²/s
const DENSITY = SER.density_um3 as number;      // µm⁻³
const A_A0 = SER.a_a0 as number;

/**
 * Scales set by n and a (lengths in µm, times in s):
 *   g = 4πħ²a/m,  ξ = ħ/√(2m g n) = 1/√(8π n a),  t₀ = ħ/(g n),  N_cal = 4π² n ξ³.
 * The solver works in p = kξ and τ = t/t₀; n enters the kinetics only through N_cal.
 */
const a_m = A_A0 * BOHR_UM * 1e-6;
const G = (4 * Math.PI * HBAR ** 2 * a_m) / MASS_KG;
const XI_UM = (HBAR / Math.sqrt(2 * MASS_KG * G * DENSITY * 1e18)) * 1e6;
const T0_S = HBAR / (G * DENSITY * 1e18);
const NCAL = 4 * Math.PI ** 2 * DENSITY * XI_UM ** 3;
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
    // log-log slope of the first points, bounded to [0, 2]: q ∝ k² for a finite n_k at small k
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let j = 0; j < Math.min(12, M); j++) {
      if (!(ys[j] > 0) || !(xs[j] > 0)) break;
      const lx = Math.log(xs[j]), ly = Math.log(ys[j]);
      sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; c++;
    }
    const den = c * sxx - sx * sx;
    if (c >= 2 && Math.abs(den) > 1e-15) power = Math.min(2, Math.max(0, (c * sxy - sx * sy) / den));
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
 * Measured n_k → shell density q(k) = 4πk² n_k / ∫4πk² n_k dk on a fixed input grid (n_k held at its first
 * measured value below the first point, zero above the last), then onto the solver grid, then
 * f(k) = 2π² n q(k)/k², rescaled so that n = (1/2π²) ∫ k² f dk exactly on the solver grid.
 */
function initialState(): { f: Float64Array; EN_nK: number } {
  const st = DATA.initial_states[SER.protocol];
  const pairs = st.k_um_inv.map((k: number, i: number) => [k, Math.max(0, st.n_k_um3[i])]).filter((r: number[]) => r[0] > 0)
    .sort((a: number[], b: number[]) => a[0] - b[0]);
  const kr = pairs.map((r: number[]) => r[0]), nr = pairs.map((r: number[]) => r[1]);
  const inputGrid = Float64Array.from(logGrid(P_MIN_REF, P_MAX_REF, 500), (p) => p / REFERENCE_XI_UM);
  const nOn = interp(kr, nr, inputGrid, 'constant');
  const q = normalized(Float64Array.from(inputGrid, (k, i) => 4 * Math.PI * k * k * nOn[i]), inputGrid);
  // kinetic energy per atom ħ²⟨k²⟩/2m of the measured state (independent of a)
  const k2 = trapz(Float64Array.from(inputGrid, (k, i) => k * k * q[i]), inputGrid) / trapz(q, inputGrid);
  const EN_nK = (HBAR ** 2 * k2 * 1e12) / (2 * MASS_KG * KB) * 1e9;

  const qs = normalized(interp(inputGrid, q, K, 'power-law'), K);
  const f = Float64Array.from(K, (k, i) => (2 * Math.PI ** 2 * DENSITY * qs[i]) / (k * k));
  const dens = trapz(Float64Array.from(K, (k, i) => k * k * f[i]), K) / (2 * Math.PI ** 2);
  if (dens > 0) for (let i = 0; i < f.length; i++) f[i] *= DENSITY / dens;
  return { f, EN_nK };
}

/** Peak of k² f: least-squares parabola in (ln k, ln k²f) over the contiguous top within 2% (in ln) of the maximum. */
function peakMomentum(f: Float64Array): number {
  const n = K.length;
  let iMax = 0, sMax = -Infinity;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) { s[i] = K[i] * K[i] * f[i]; if (s[i] > sMax) { sMax = s[i]; iMax = i; } }
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
 * Smooth peak of k² f for the observables: parabola in (ln k, ln k²f) with weights exp(−(L_max − L)/0.02), so it
 * moves continuously as grid points enter or leave the top (the stop test above uses the plain top-2% fit).
 */
function peakSmooth(f: Float64Array): number {
  const delta = 0.02, n = K.length;
  let Lmax = -Infinity, iMax = 0;
  const L = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = f[i] > 0 ? Math.log(K[i] * K[i] * f[i]) : -Infinity;
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

/**
 * For every target p on the grid, the partners (p1, p2) on log Gauss-Legendre nodes, and p3 from energy
 * conservation, p3² = p1² + p2² − p². After the angular integrals of the momentum delta,
 *   ∂τ f(p) = (4π/N_cal²) Σ_events w1 w2 p1 p2 [min(p, p1, p2, p3)/p] M_e [gain − loss].
 * Events are grouped by target and, within it, by p1 ("pair"): the events of a pair share the energy
 * transfer |p² − p1²|, so they share one table of the dressing M. The cutoff p_max/√2 keeps p3 on the grid.
 */
const P_COLL = P_MAX / Math.SQRT2;
type Seg = [number, number];

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
  const split = Math.min(p, P_COLL);
  if (lower < split * (1 - 1e-14)) panels(lower, split, out);
  const upLow = Math.max(lower, p);
  if (upLow < P_COLL * (1 - 1e-14)) panels(upLow, P_COLL, out);
  return out;
}

const ev = { weight: [] as number[], i1: [] as number[], a1: [] as number[], i2: [] as number[], a2: [] as number[],
  i3: [] as number[], a3: [] as number[], p2: [] as number[] };
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
          const m2 = logInterp(LN_GRID, p2), m3 = logInterp(LN_GRID, p3);
          ev.weight.push(q1.w[j] * q2.w[m] * p1 * p2 * Math.min(p, p1, p2, p3) / p);
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
const I1 = Int32Array.from(ev.i1), A1 = Float64Array.from(ev.a1);
const I2 = Int32Array.from(ev.i2), A2 = Float64Array.from(ev.a2);
const I3 = Int32Array.from(ev.i3), A3 = Float64Array.from(ev.a3);
const PAIR_OFF = Int32Array.from(pairOff);
const N_PAIRS = pairTarget.length;

// ============================================================================================================
// 5. Transfer-momentum tables per pair
// ============================================================================================================

/**
 * For fixed magnitudes, the angular measure of an event is uniform in the transfer momentum Q = |p − p1|
 * (vectors) on [max(|p − p1|, |p2 − p3|), min(p + p1, p2 + p3)]. Each pair gets a table on [|p − p1|, p + p1]
 * with `cells` equal cells (nodes at ends and midpoints); an event's interval is stored in cell units (ta, tb).
 */
const MIN_CELLS = 16;
const pairQlo = new Float64Array(N_PAIRS), pairH = new Float64Array(N_PAIRS), pairOmega = new Float64Array(N_PAIRS);
const pairCells = new Int32Array(N_PAIRS), pairNode = new Int32Array(N_PAIRS), pairCell = new Int32Array(N_PAIRS);
const TA = new Float64Array(W.length), TB = new Float64Array(W.length);
let nNodes = 0, nCells = 0;
for (let k = 0; k < N_PAIRS; k++) {
  const p = GRID[pairTarget[k]], p1 = pairP1[k];
  const qlo = Math.abs(p - p1), qhi = p + p1;
  const cells = Math.min(LEVEL.channelCellsMax, Math.max(MIN_CELLS, Math.ceil((qhi - qlo) / LEVEL.channelCell)));
  const h = (qhi - qlo) / cells;
  pairQlo[k] = qlo; pairH[k] = h; pairOmega[k] = Math.abs(p * p - p1 * p1); pairCells[k] = cells;
  pairNode[k] = nNodes; pairCell[k] = nCells;
  nNodes += 2 * cells + 1; nCells += cells + 1;
  for (let e = PAIR_OFF[k]; e < PAIR_OFF[k + 1]; e++) {
    const q2 = ev.p2[e], p3 = Math.sqrt(p1 * p1 + q2 * q2 - p * p);
    const a = Math.max(qlo, Math.abs(q2 - p3)), b = Math.min(qhi, q2 + p3);
    TA[e] = Math.min(cells, Math.max(0, (a - qlo) / h));
    TB[e] = Math.min(cells, Math.max(TA[e], (b - qlo) / h));
  }
}

// ============================================================================================================
// 6. The bubble L₋(Q, ω) of the current spectrum
// ============================================================================================================

/**
 * With H(x) = ∫₀^∞ s f(s) ln|(s − x)/(s + x)| ds and J(x) = ∫₀^|x| s f(s) ds,
 *   Re L₋(Q, ω) = (1/2N_cal) [H(x_a) − H(x_b)]/(x_a − x_b),   Im L₋(Q, ω) = −(π/2N_cal) [J(x_a) − J(x_b)]/Q,
 *   x_a = (|ω| + Q²)/2Q,  x_b = (|ω| − Q²)/2Q.
 * f is taken linear in p between grid points, f(p_min) on [0, p_min] and zero above p_max. H and dH/dx are
 * linear in f, so they are tabulated at log-spaced x_m through matrices built once (the logarithmic
 * singularities integrated in closed form); J is exact.
 */
const GAUSS10 = leggauss(10);
const lnAbs = (u: number) => (u === 0 ? 0 : Math.log(Math.abs(u)));

/** ∫_a^b s ln|s − r| ds and ∫_a^b s² ln|s − r| ds. */
function logMoments(a: number, b: number, r: number): [number, number] {
  const A1 = (s: number) => { const u = s - r, L = lnAbs(u); return 0.5 * u * u * L - 0.25 * u * u + r * (u * L - u); };
  const A2 = (s: number) => {
    const u = s - r, L = lnAbs(u);
    return (u * u * u * L) / 3 - (u * u * u) / 9 + 2 * r * (0.5 * u * u * L - 0.25 * u * u) + r * r * (u * L - u);
  };
  return [A1(b) - A1(a), A2(b) - A2(a)];
}
/** Principal values ∫_a^b s/(s − r) ds and ∫_a^b s²/(s − r) ds. */
function poleMoments(a: number, b: number, r: number): [number, number] {
  const B1 = (s: number) => s + r * lnAbs(s - r);
  const B2 = (s: number) => 0.5 * s * s + r * s + r * r * lnAbs(s - r);
  return [B1(b) - B1(a), B2(b) - B2(a)];
}

/** Weights of one cell [a, b] on H(x) and H'(x) for the hat functions (b − s)/h, (s − a)/h (or 1 if `constant`). */
function cellWeights(a: number, b: number, x: number, constant: boolean, out: Float64Array): void {
  const h = b - a;
  let h0 = 0, h1 = 0, d0 = 0, d1 = 0;
  const nearMinus = x > a - 2 * h && x < b + 2 * h, nearPlus = a + x < 2 * h;
  const closed = (r: number, sgnLog: number, sgnPole: number) => {
    const [I1, I2] = logMoments(a, b, r), [P1, P2] = poleMoments(a, b, r);
    if (constant) { h0 += sgnLog * I1; d0 += sgnPole * P1; }
    else {
      h0 += (sgnLog * (b * I1 - I2)) / h; h1 += (sgnLog * (I2 - a * I1)) / h;
      d0 += (sgnPole * (b * P1 - P2)) / h; d1 += (sgnPole * (P2 - a * P1)) / h;
    }
  };
  if (nearMinus) closed(x, 1, -1);
  if (nearPlus) closed(-x, -1, -1);
  if (!nearMinus || !nearPlus) {
    const mid = 0.5 * (a + b), half = 0.5 * h;
    for (let i = 0; i < 10; i++) {
      const s = mid + half * GAUSS10.x[i], w = half * GAUSS10.w[i] * s;
      let kl = 0, kd = 0;
      if (!nearMinus) { kl += Math.log(Math.abs(s - x)); kd -= 1 / (s - x); }
      if (!nearPlus) { kl -= Math.log(s + x); kd -= 1 / (s + x); }
      if (constant) { h0 += w * kl; d0 += w * kd; }
      else {
        const q1 = (s - a) / h, q0 = 1 - q1;
        h0 += w * kl * q0; h1 += w * kl * q1; d0 += w * kd * q0; d1 += w * kd * q1;
      }
    }
  }
  out[0] = h0; out[1] = h1; out[2] = d0; out[3] = d1;
}

const NX = LEVEL.loopTable;
const X_LO = GRID[0] / 10, X_HI = 20 * GRID[N_GRID - 1];
const LNX0 = Math.log(X_LO), DU = (Math.log(X_HI) - LNX0) / (NX - 1), INV_DU = 1 / DU;
const XT = Float64Array.from({ length: NX }, (_, m) => Math.exp(LNX0 + m * DU));
const MH = new Float64Array(NX * N_GRID), MD = new Float64Array(NX * N_GRID);
{
  const w = new Float64Array(4);
  for (let m = 0; m < NX; m++) {
    const row = m * N_GRID;
    cellWeights(0, GRID[0], XT[m], true, w);
    MH[row] += w[0]; MD[row] += w[2];
    for (let j = 0; j < N_GRID - 1; j++) {
      cellWeights(GRID[j], GRID[j + 1], XT[m], false, w);
      MH[row + j] += w[0]; MH[row + j + 1] += w[1];
      MD[row + j] += w[2]; MD[row + j + 1] += w[3];
    }
  }
}

/** Loop state of the current f: H and dH/du (u = ln x) at the table nodes, cumulative J, and asymptotes. */
const Ht = new Float64Array(NX), Hu = new Float64Array(NX), Jc = new Float64Array(N_GRID);
let fLoop = new Float64Array(N_GRID);
let slope0 = 0, m2 = 0, m4 = 0;
const LNS0 = Math.log(GRID[0]), INV_DLNS = (N_GRID - 1) / (Math.log(GRID[N_GRID - 1]) - LNS0);

function updateLoops(f: Float64Array): void {
  fLoop = f;
  for (let m = 0; m < NX; m++) {
    const row = m * N_GRID;
    let h = 0, d = 0;
    for (let j = 0; j < N_GRID; j++) { h += MH[row + j] * f[j]; d += MD[row + j] * f[j]; }
    Ht[m] = h; Hu[m] = d * XT[m];
  }
  const s = GRID;
  let jc = 0.5 * f[0] * s[0] * s[0];
  m2 = (f[0] * s[0] ** 3) / 3;
  m4 = (f[0] * s[0] ** 5) / 5;
  Jc[0] = jc;
  for (let j = 0; j < N_GRID - 1; j++) {
    const a = s[j], b = s[j + 1], c = (f[j + 1] - f[j]) / (b - a), c0 = f[j] - c * a;
    const mom = (k: number) => (c0 * (b ** (k + 1) - a ** (k + 1))) / (k + 1) + (c * (b ** (k + 2) - a ** (k + 2))) / (k + 2);
    jc += mom(1); m2 += mom(2); m4 += mom(4);
    Jc[j + 1] = jc;
  }
  slope0 = Ht[0] / XT[0];
}

/** H(|x|) by cubic Hermite in u = ln x, with the small- and large-x asymptotes outside the table. */
function hAbs(ax: number): number {
  if (ax <= X_LO) return ax * slope0;
  if (ax >= X_HI) { const i2 = 1 / (ax * ax); return (-2 * m2 - 0.6666666666666666 * m4 * i2) / ax; }
  const t = (Math.log(ax) - LNX0) * INV_DU;
  let m = t | 0; if (m >= NX - 1) m = NX - 2;
  const r = t - m, r2 = r * r, r3 = r2 * r;
  return (2 * r3 - 3 * r2 + 1) * Ht[m] + (r3 - 2 * r2 + r) * DU * Hu[m] + (3 * r2 - 2 * r3) * Ht[m + 1] + (r3 - r2) * DU * Hu[m + 1];
}
/** H'(x). */
function hPrime(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax <= X_LO) return slope0;
  if (ax >= X_HI) { const i2 = 1 / (ax * ax); return 2 * m2 * i2 + 2 * m4 * i2 * i2; }
  const t = (Math.log(ax) - LNX0) * INV_DU;
  let m = t | 0; if (m >= NX - 1) m = NX - 2;
  const r = t - m, r2 = r * r;
  return ((6 * r2 - 6 * r) * (Ht[m] - Ht[m + 1]) * INV_DU + (3 * r2 - 4 * r + 1) * Hu[m] + (3 * r2 - 2 * r) * Hu[m + 1]) / ax;
}
/** Divided difference H[a, b] (H is odd). */
function divH(a: number, b: number): number {
  const d = a - b, aa = a < 0 ? -a : a, ab = b < 0 ? -b : b, scale = aa > ab ? aa : ab;
  if (d <= 1e-7 * (scale > X_LO ? scale : X_LO)) return hPrime(0.5 * (a + b));
  return ((a < 0 ? -hAbs(-a) : hAbs(a)) - (b < 0 ? -hAbs(-b) : hAbs(b))) / d;
}
/** J(|x|) for the piecewise-linear f. */
function jAbs(ax: number): number {
  const s = GRID, f = fLoop;
  if (ax <= s[0]) return 0.5 * f[0] * ax * ax;
  if (ax >= s[N_GRID - 1]) return Jc[N_GRID - 1];
  let j = ((Math.log(ax) - LNS0) * INV_DLNS) | 0;
  if (j > N_GRID - 2) j = N_GRID - 2;
  if (s[j] > ax && j > 0) j--;
  else if (s[j + 1] < ax && j < N_GRID - 2) j++;
  const a = s[j], c = (f[j + 1] - f[j]) / (s[j + 1] - a), c0 = f[j] - c * a;
  return Jc[j] + 0.5 * c0 * (ax * ax - a * a) + 0.3333333333333333 * c * (ax * ax * ax - a * a * a);
}
/** H[x_a, x_b] and (J(x_a) − J(x_b))/Q: Re L₋ and Im L₋ without their prefactors. */
function lMinusRe(Q: number, w: number): number { const inv = 0.5 / Q, Q2 = Q * Q; return divH((w + Q2) * inv, (w - Q2) * inv); }
function lMinusIm(Q: number, w: number): number {
  const inv = 0.5 / Q, Q2 = Q * Q, xb = (w - Q2) * inv;
  return (jAbs((w + Q2) * inv) - jAbs(xb < 0 ? -xb : xb)) / Q;
}

// ============================================================================================================
// 7. The chain weight M = ⟨1/|1 − L₋|²⟩ over each event's transfer interval
// ============================================================================================================

/**
 * U = 1 − Re L₋ and V = Im L₋ (|1 − L₋|² = U² + V²) are smooth, so they are taken as the quadratics through each
 * cell's three nodes and 1/(U² + V²) is integrated by 6-point Gauss-Legendre (48 sub-panels in a cell where
 * |1 − L₋|² may be small). Φ holds the running integral at cell ends; an event's average is a difference of Φ
 * plus its two partial cells.
 */
const RG = leggauss(6);
const RG_X = Float64Array.from(RG.x, (x) => 0.5 * (x + 1)), RG_W = Float64Array.from(RG.w, (w) => 0.5 * w);
const NEAR_POLE_PANELS = 48;

function cellIntegral(u0: number, u1: number, u2: number, v0: number, v1: number, v2: number, s0: number, s1: number, near: boolean): number {
  const ua = u0, ub = -3 * u0 + 4 * u1 - u2, uc = 2 * u0 - 4 * u1 + 2 * u2;
  const va = v0, vb = -3 * v0 + 4 * v1 - v2, vc = 2 * v0 - 4 * v1 + 2 * v2;
  const np = near ? NEAR_POLE_PANELS : 1, len = (s1 - s0) / np;
  let acc = 0;
  for (let q = 0; q < np; q++) {
    const base = s0 + q * len;
    for (let j = 0; j < 6; j++) {
      const s = base + len * RG_X[j];
      const u = ua + s * (ub + s * uc), v = va + s * (vb + s * vc);
      acc += RG_W[j] / Math.max(u * u + v * v, 1e-8);
    }
  }
  return acc * len;
}

const U = new Float64Array(nNodes), V = new Float64Array(nNodes);
const PHI = new Float64Array(nCells);
const NEAR = new Uint8Array(nCells);

function chainAverage(off: number, po: number, cells: number, ea: number, eb: number): number {
  let ka = ea | 0; if (ka >= cells) ka = cells - 1;
  let kb = eb | 0; if (kb >= cells) kb = cells - 1;
  const ra = ea - ka, rb = eb - kb;
  if (eb - ea < 1e-6) {
    const b = off + 2 * ka, s = ra;
    const l0 = (2 * s - 1) * (s - 1), l1 = 4 * s * (1 - s), l2 = s * (2 * s - 1);
    const u = U[b] * l0 + U[b + 1] * l1 + U[b + 2] * l2, v = V[b] * l0 + V[b + 1] * l1 + V[b + 2] * l2;
    return 1 / Math.max(u * u + v * v, 1e-8);
  }
  const ba = off + 2 * ka, bb = off + 2 * kb;
  let integral: number;
  if (ka === kb) integral = cellIntegral(U[ba], U[ba + 1], U[ba + 2], V[ba], V[ba + 1], V[ba + 2], ra, rb, NEAR[po + ka] === 1);
  else {
    integral = cellIntegral(U[ba], U[ba + 1], U[ba + 2], V[ba], V[ba + 1], V[ba + 2], ra, 1, NEAR[po + ka] === 1)
      + (PHI[po + kb] - PHI[po + ka + 1])
      + cellIntegral(U[bb], U[bb + 1], U[bb + 2], V[bb], V[bb + 1], V[bb + 2], 0, rb, NEAR[po + kb] === 1);
  }
  return integral / (eb - ea);
}

// ============================================================================================================
// 8. The right-hand side ∂τ f
// ============================================================================================================

const PREFACTOR = (4 * Math.PI) / (NCAL * NCAL);
const COUPLING = 1 / NCAL;   // repulsive a > 0

function rhs(f: Float64Array, out: Float64Array): void {
  updateLoops(f);
  // loops at every table node, and the running integral Φ of 1/|1 − L₋|²
  for (let k = 0; k < N_PAIRS; k++) {
    const off = pairNode[k], cells = pairCells[k], h = pairH[k], qlo = pairQlo[k], w = pairOmega[k];
    for (let s = 0; s <= 2 * cells; s++) {
      let Q = qlo + 0.5 * h * s;
      if (Q < 1e-12) Q = 1e-12;
      U[off + s] = 1 - 0.5 * COUPLING * lMinusRe(Q, w);
      V[off + s] = -0.5 * Math.PI * COUPLING * lMinusIm(Q, w);
    }
    const po = pairCell[k];
    PHI[po] = 0;
    for (let j = 0; j < cells; j++) {
      const b = off + 2 * j;
      const d0 = U[b] * U[b] + V[b] * V[b], d1 = U[b + 1] * U[b + 1] + V[b + 1] * V[b + 1], d2 = U[b + 2] * U[b + 2] + V[b + 2] * V[b + 2];
      const near = Math.min(d0, d1, d2) < 0.25 || U[b] * U[b + 1] <= 0 || U[b + 1] * U[b + 2] <= 0;
      NEAR[po + j] = near ? 1 : 0;
      PHI[po + j + 1] = PHI[po + j] + cellIntegral(U[b], U[b + 1], U[b + 2], V[b], V[b + 1], V[b + 2], 0, 1, near);
    }
  }
  // event sweep: gain − loss, each event weighted by its chain average
  for (let i = 0; i < N_GRID; i++) {
    const fp = f[i];
    let sg = 0, sl = 0;
    for (let k = targetPairs[i]; k < targetPairs[i + 1]; k++) {
      const off = pairNode[k], po = pairCell[k], cells = pairCells[k];
      for (let e = PAIR_OFF[k]; e < PAIR_OFF[k + 1]; e++) {
        const j1 = I1[e], j2 = I2[e], j3 = I3[e], u1 = A1[e], u2 = A2[e], u3 = A3[e];
        const f1 = (1 - u1) * f[j1] + u1 * f[j1 + 1];
        const f2 = (1 - u2) * f[j2] + u2 * f[j2 + 1];
        const f3 = (1 - u3) * f[j3] + u3 * f[j3 + 1];
        const gain = f1 * f2 * (BOSE + fp + f3);
        const loss = fp * f3 * (BOSE + f1 + f2);
        const M = chainAverage(off, po, cells, TA[e], TB[e]);
        const w = W[e];
        sg += w * M * gain;
        sl += w * M * loss;
      }
    }
    out[i] = PREFACTOR * (sg - sl);
  }
}

// ============================================================================================================
// 9. Observables
// ============================================================================================================

/** ∫ k^m f dk on the physical grid: m = 2 is ∝ the density, m = 4 ∝ the kinetic energy. */
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
 * ℓ̄³ = f(k→0)/n and (m/ħ) dℓ̄²/dt = (2/3) ℓ̄² (∂τ ln f₀)/t₀/(ħ/m), with ∂τ f₀ from the fit applied to f ± εC,
 * C = ∂τ f the collision term. f₀ is fitted over k ≤ k_p/5; the uncertainty is the largest deviation over the
 * windows k_p/5 and k_p/10 and the steps ε and 2ε. (The plots divide by the condensed fraction for ℓ.)
 */
function ellAt(f: Float64Array, kp: number): [number, number, number] {
  rhs(f, C);
  const ell = Math.cbrt(f0Fit(f, kp / 5) / DENSITY);
  let cmax = 0;
  for (let i = 0; i < N_GRID && K[i] <= kp / 5; i++) cmax = Math.max(cmax, Math.abs(C[i]) / Math.max(f[i], 1e-300));
  const eps0 = cmax > 0 ? 1e-3 / cmax : 1e-6;
  const est: number[] = [];
  for (const kMax of [kp / 5, kp / 10]) {
    const f0w = f0Fit(f, kMax);
    for (const eps of [eps0, 2 * eps0]) {
      for (let i = 0; i < N_GRID; i++) { FP[i] = f[i] + eps * C[i]; FM[i] = f[i] - eps * C[i]; }
      const dlnf0 = (f0Fit(FP, kMax) - f0Fit(FM, kMax)) / (2 * eps * f0w);
      est.push(((2 / 3) * dlnf0 / T0_S / HBAR_OVER_M) * Math.cbrt(f0w / DENSITY) ** 2);
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
  const kpStop = kp0 * Math.min((K_XI / kp0) / target, 0.999);
  const N0 = moment(f0, 2), E0 = moment(f0, 4);

  // samples at 60 per decade in t from 10 µs, recorded on the dense output
  const tauEval = Array.from({ length: 1201 }, (_, i) => 1e-5 * 10 ** (i / 60) / T0_S);
  const pts = { t_s: [] as number[], X: [] as number[], ell_um: [] as number[], ellRate: [] as number[],
    ellRateErr: [] as number[], N_rel: [] as number[], E_rel: [] as number[] };
  let lastSave = Date.now();
  const save = (status: string) => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      schema: 'wke-chain-run/1', status, wall_s: (Date.now() - wall0) / 1000,
      settings: { series: SERIES, protocol: SER.protocol, a_a0: A_A0, density_um3: DENSITY, V_um3: SER.V_um3,
        accuracy: ACCURACY, kernel: KERNEL, model: 'bubble chain (N -> infinity)', target_kxi_over_kp: target,
        pMin: P_MIN, pMax: P_MAX, nGrid: N_GRID, events: W.length, wall_cap_s: WALL_S },
      scales: { xi_um: XI_UM, kXi_um_inv: K_XI, t0_s: T0_S, ncal: NCAL, hbarOverM_um2_per_s: HBAR_OVER_M },
      initial: { kp0_um_inv: kp0, EN_nK },
      points: pts,
    }));
  };
  const record = (tau: number, f: Float64Array) => {
    const kp = peakSmooth(f);
    const [ell, rate, err] = ellAt(f, kp);
    pts.t_s.push(tau * T0_S); pts.X.push(K_XI / kp); pts.ell_um.push(ell); pts.ellRate.push(rate); pts.ellRateErr.push(err);
    pts.N_rel.push(moment(f, 2) / N0); pts.E_rel.push(moment(f, 4) / E0);
    if (Date.now() - lastSave > 30000) { lastSave = Date.now(); save('running'); }
  };

  const n = N_GRID, alloc = () => new Float64Array(n);
  const k1 = alloc(), k2 = alloc(), k3 = alloc(), k4 = alloc(), k5 = alloc(), k6 = alloc(), k7 = alloc(), yT = alloc();
  const y = f0.slice();
  const { rtol, atol } = LEVEL;
  const tauMax = 1e6, hMax = tauMax / 20;
  let tau = 0, evalIdx = 0, rejects = 0;
  rhs(y, k1);
  let h = tauMax / 2000;
  { let sc = 0; for (let i = 0; i < n; i++) sc = Math.max(sc, Math.abs(k1[i]) / (atol + rtol * Math.abs(y[i]))); if (sc > 0) h = Math.min(h, 0.01 / sc); }
  let kpPrev = kp0;
  let status = 'tauMax';

  while (tau < tauMax) {
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
    if (reached) { status = 'target'; break; }
    h = Math.min(hMax, h * Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
  }
  save(status);
  const x = pts.X.at(-1) ?? NaN;
  console.log(`s${String(SERIES).padStart(2, '0')} ${SER.protocol} a=${A_A0} ${KERNEL} ${ACCURACY}: ${status}, k_xi/k_p ${x.toFixed(2)}, ` +
    `${((Date.now() - wall0) / 1000).toFixed(0)} s`);
}

main();
