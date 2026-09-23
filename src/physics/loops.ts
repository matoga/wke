/**
 * One-loop functionals of an isotropic spectrum, in solver units
 * (p = kξ, occupation f, N_cal = 4π² n ξ³, s_a = sign a).
 *
 * Every loop reduces to two one-dimensional functionals of f:
 *
 *   H(x) = ∫₀^∞ s f(s) ln|(s − x)/(s + x)| ds      (odd in x)
 *   J(x) = ∫₀^|x| s f(s) ds                        (even in x)
 *
 * and, with divided differences H[a, b] = (H(a) − H(b))/(a − b),
 *
 *   Re L₊(P, ω₊) = (s_a/N_cal) H[y_a, y_b],   y_a = (P + D)/2, y_b = (D − P)/2, D = √(2ω₊ − P²)
 *   Re L₋(Q, ω)  = (s_a/2N_cal) H[x_a, x_b],  x_a = (|ω| + Q²)/2Q, x_b = (|ω| − Q²)/2Q
 *   Im L₋(Q, ω)  = −(π s_a/2N_cal) (J(x_a) − J(x_b))/Q
 *
 * f is taken piecewise linear on the state grid, constant f(p_min) below the
 * grid and zero above it (the solver's own conventions). H and H' are
 * tabulated on a log grid by exact product integration, so the logarithmic
 * singularities of the integrand are integrated in closed form.
 */

import { leggauss } from './quadrature';

export interface LoopOperator {
  /** state grid s_j (log-uniform) */
  s: Float64Array;
  lnS0: number;
  invDlnS: number;
  /** table abscissae x_m (log-uniform on [xLo, xHi]) */
  x: Float64Array;
  lnX0: number;
  du: number;
  invDu: number;
  xLo: number;
  xHi: number;
  /** H_m = Σ_j MH[m·n + j] f_j and H'_m = Σ_j MD[m·n + j] f_j */
  MH: Float64Array;
  MD: Float64Array;
  buildTime_ms: number;
}

/** Loop functionals for one spectrum f; rebuilt every right-hand side. */
export interface LoopState {
  op: LoopOperator;
  f: Float64Array;
  /** H at the table nodes and dH/du (u = ln x) */
  H: Float64Array;
  Hu: Float64Array;
  /** cumulative ∫₀^{s_j} s f ds */
  Jc: Float64Array;
  /** H(x)/x for x → 0, i.e. −2∫f ds */
  slope0: number;
  /** ∫ s² f ds and ∫ s⁴ f ds, for the large-x asymptote */
  m2: number;
  m4: number;
  /** ∫ f ds over the whole axis */
  intF: number;
}

const lnAbs = (u: number): number => (u === 0 ? 0 : Math.log(Math.abs(u)));

/** ∫_a^b s ln|s − r| ds and ∫_a^b s² ln|s − r| ds, closed form. */
function logMoments(a: number, b: number, r: number): [number, number] {
  const A1 = (s: number) => {
    const u = s - r, L = lnAbs(u);
    return 0.5 * u * u * L - 0.25 * u * u + r * (u * L - u);
  };
  const A2 = (s: number) => {
    const u = s - r, L = lnAbs(u);
    return (u * u * u * L) / 3 - (u * u * u) / 9 + 2 * r * (0.5 * u * u * L - 0.25 * u * u) + r * r * (u * L - u);
  };
  return [A1(b) - A1(a), A2(b) - A2(a)];
}

/** Principal values ∫_a^b s/(s − r) ds and ∫_a^b s²/(s − r) ds, closed form. */
function poleMoments(a: number, b: number, r: number): [number, number] {
  const B1 = (s: number) => s + r * lnAbs(s - r);
  const B2 = (s: number) => 0.5 * s * s + r * s + r * r * lnAbs(s - r);
  return [B1(b) - B1(a), B2(b) - B2(a)];
}

const GAUSS = leggauss(10);

/**
 * Contributions of one cell [a, b] to H(x) and H'(x) for the two hat functions
 * φ0 = (b − s)/h and φ1 = (s − a)/h. With `constant`, φ0 ≡ 1 and φ1 ≡ 0.
 */
function cellWeights(a: number, b: number, x: number, constant: boolean, out: Float64Array): void {
  const h = b - a;
  // Terms: +ln|s − x| (singular at x), −ln|s + x| (singular at −x).
  // Derivative kernel: −1/(s − x) − 1/(s + x).
  let h0 = 0, h1 = 0, d0 = 0, d1 = 0;
  const nearMinus = x > a - 2 * h && x < b + 2 * h;
  const nearPlus = a + x < 2 * h;

  const addClosed = (r: number, sgnLog: number, sgnPole: number) => {
    const [I1, I2] = logMoments(a, b, r);
    const [P1, P2] = poleMoments(a, b, r);
    if (constant) {
      h0 += sgnLog * I1;
      d0 += sgnPole * P1;
    } else {
      h0 += (sgnLog * (b * I1 - I2)) / h;
      h1 += (sgnLog * (I2 - a * I1)) / h;
      d0 += (sgnPole * (b * P1 - P2)) / h;
      d1 += (sgnPole * (P2 - a * P1)) / h;
    }
  };
  if (nearMinus) addClosed(x, 1, -1);
  if (nearPlus) addClosed(-x, -1, -1);

  if (!nearMinus || !nearPlus) {
    const mid = 0.5 * (a + b), half = 0.5 * h;
    for (let i = 0; i < GAUSS.x.length; i++) {
      const s = mid + half * GAUSS.x[i];
      const w = half * GAUSS.w[i] * s;
      let kl = 0, kd = 0;
      if (!nearMinus) { kl += Math.log(Math.abs(s - x)); kd -= 1 / (s - x); }
      if (!nearPlus) { kl -= Math.log(s + x); kd -= 1 / (s + x); }
      if (constant) {
        h0 += w * kl; d0 += w * kd;
      } else {
        const p1 = (s - a) / h, p0 = 1 - p1;
        h0 += w * kl * p0; h1 += w * kl * p1;
        d0 += w * kd * p0; d1 += w * kd * p1;
      }
    }
  }
  out[0] = h0; out[1] = h1; out[2] = d0; out[3] = d1;
}

/** Precompute the f-independent product-integration operator for a state grid. */
export function buildLoopOperator(s: Float64Array, nTable: number): LoopOperator {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = s.length;
  const xLo = s[0] / 10;
  const xHi = 20 * s[n - 1];
  const lnX0 = Math.log(xLo);
  const du = (Math.log(xHi) - lnX0) / (nTable - 1);
  const x = new Float64Array(nTable);
  for (let m = 0; m < nTable; m++) x[m] = Math.exp(lnX0 + m * du);

  const MH = new Float64Array(nTable * n);
  const MD = new Float64Array(nTable * n);
  const w = new Float64Array(4);
  for (let m = 0; m < nTable; m++) {
    const xm = x[m];
    const row = m * n;
    cellWeights(0, s[0], xm, true, w);
    MH[row] += w[0];
    MD[row] += w[2];
    for (let j = 0; j < n - 1; j++) {
      cellWeights(s[j], s[j + 1], xm, false, w);
      MH[row + j] += w[0]; MH[row + j + 1] += w[1];
      MD[row + j] += w[2]; MD[row + j + 1] += w[3];
    }
  }

  return {
    s,
    lnS0: Math.log(s[0]),
    invDlnS: (n - 1) / (Math.log(s[n - 1]) - Math.log(s[0])),
    x,
    lnX0,
    du,
    invDu: 1 / du,
    xLo,
    xHi,
    MH,
    MD,
    buildTime_ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

export function createLoopState(op: LoopOperator): LoopState {
  const nx = op.x.length;
  return {
    op,
    f: new Float64Array(op.s.length),
    H: new Float64Array(nx),
    Hu: new Float64Array(nx),
    Jc: new Float64Array(op.s.length),
    slope0: 0,
    m2: 0,
    m4: 0,
    intF: 0,
  };
}

/** Refresh every loop functional for the spectrum f. */
export function updateLoopState(st: LoopState, f: Float64Array): void {
  const { op } = st;
  const { s, x, MH, MD } = op;
  const n = s.length;
  const nx = x.length;
  st.f = f;

  for (let m = 0; m < nx; m++) {
    const row = m * n;
    let h = 0, d = 0;
    for (let j = 0; j < n; j++) {
      const fj = f[j];
      h += MH[row + j] * fj;
      d += MD[row + j] * fj;
    }
    st.H[m] = h;
    st.Hu[m] = d * x[m];
  }

  // Exact moments of the piecewise-linear f.
  let jc = 0.5 * f[0] * s[0] * s[0];
  let intF = f[0] * s[0];
  let m2 = (f[0] * s[0] ** 3) / 3;
  let m4 = (f[0] * s[0] ** 5) / 5;
  st.Jc[0] = jc;
  for (let j = 0; j < n - 1; j++) {
    const a = s[j], b = s[j + 1], fa = f[j], fb = f[j + 1];
    const c = (fb - fa) / (b - a);
    const c0 = fa - c * a;
    // ∫ s^k (c0 + c s) ds
    const mom = (k: number) => (c0 * (b ** (k + 1) - a ** (k + 1))) / (k + 1) + (c * (b ** (k + 2) - a ** (k + 2))) / (k + 2);
    intF += mom(0);
    jc += mom(1);
    m2 += mom(2);
    m4 += mom(4);
    st.Jc[j + 1] = jc;
  }
  st.intF = intF;
  st.m2 = m2;
  st.m4 = m4;
  st.slope0 = st.H[0] / x[0];
}

/** H(x), odd. */
export function evalH(st: LoopState, x: number): number {
  const ax = Math.abs(x);
  const op = st.op;
  let v: number;
  if (ax <= op.xLo) {
    v = ax * st.slope0;
  } else if (ax >= op.xHi) {
    const i2 = 1 / (ax * ax);
    v = (-2 * st.m2 - (2 / 3) * st.m4 * i2) / ax;
  } else {
    const t = (Math.log(ax) - op.lnX0) * op.invDu;
    let m = t | 0;
    if (m >= st.H.length - 1) m = st.H.length - 2;
    const s = t - m;
    const s2 = s * s, s3 = s2 * s;
    v = (2 * s3 - 3 * s2 + 1) * st.H[m] + (s3 - 2 * s2 + s) * op.du * st.Hu[m]
      + (-2 * s3 + 3 * s2) * st.H[m + 1] + (s3 - s2) * op.du * st.Hu[m + 1];
  }
  return x < 0 ? -v : v;
}

/** H'(x), even. */
export function evalHp(st: LoopState, x: number): number {
  const ax = Math.abs(x);
  const op = st.op;
  if (ax <= op.xLo) return st.slope0;
  if (ax >= op.xHi) {
    const i2 = 1 / (ax * ax);
    return 2 * st.m2 * i2 + 2 * st.m4 * i2 * i2;
  }
  const t = (Math.log(ax) - op.lnX0) * op.invDu;
  let m = t | 0;
  if (m >= st.H.length - 1) m = st.H.length - 2;
  const s = t - m;
  const s2 = s * s;
  const dHdu = (6 * s2 - 6 * s) * (st.H[m] - st.H[m + 1]) * op.invDu
    + (3 * s2 - 4 * s + 1) * st.Hu[m] + (3 * s2 - 2 * s) * st.Hu[m + 1];
  return dHdu / ax;
}

/** Divided difference H[a, b]. */
export function divH(st: LoopState, a: number, b: number): number {
  const d = a - b;
  if (Math.abs(d) <= 1e-7 * Math.max(Math.abs(a), Math.abs(b), st.op.xLo)) {
    return evalHp(st, 0.5 * (a + b));
  }
  return (evalH(st, a) - evalH(st, b)) / d;
}

/** J(x) = ∫₀^|x| s f ds, even. */
export function evalJ(st: LoopState, x: number): number {
  const ax = Math.abs(x);
  const op = st.op;
  const s = op.s, f = st.f;
  const n = s.length;
  if (ax <= s[0]) return 0.5 * f[0] * ax * ax;
  if (ax >= s[n - 1]) return st.Jc[n - 1];
  let j = ((Math.log(ax) - op.lnS0) * op.invDlnS) | 0;
  if (j > n - 2) j = n - 2;
  while (j > 0 && s[j] > ax) j--;
  while (j < n - 2 && s[j + 1] < ax) j++;
  const a = s[j];
  const c = (f[j + 1] - f[j]) / (s[j + 1] - a);
  const c0 = f[j] - c * a;
  return st.Jc[j] + (c0 * (ax * ax - a * a)) / 2 + (c * (ax * ax * ax - a * a * a)) / 3;
}

/** Re L₊ without the prefactor s_a/N_cal: H[y_a, y_b]. */
export function reLplusRaw(st: LoopState, P: number, omegaPlus: number): number {
  const D = Math.sqrt(Math.max(2 * omegaPlus - P * P, 0));
  return divH(st, 0.5 * (P + D), 0.5 * (D - P));
}

/** Re L₋ without the prefactor s_a/(2N_cal): H[x_a, x_b]. */
export function reLminusRaw(st: LoopState, Q: number, absOmega: number): number {
  const xa = (absOmega + Q * Q) / (2 * Q);
  const xb = (absOmega - Q * Q) / (2 * Q);
  return divH(st, xa, xb);
}

/** Im L₋ without the prefactor −π s_a/(2N_cal): (J(x_a) − J(x_b))/Q. */
export function imLminusRaw(st: LoopState, Q: number, absOmega: number): number {
  const xa = (absOmega + Q * Q) / (2 * Q);
  const xb = (absOmega - Q * Q) / (2 * Q);
  return (evalJ(st, xa) - evalJ(st, xb)) / Q;
}

/** Signed physical loops. */
export function reLplus(st: LoopState, P: number, omegaPlus: number, sign: number, ncal: number): number {
  return (sign / ncal) * reLplusRaw(st, P, omegaPlus);
}
export function reLminus(st: LoopState, Q: number, absOmega: number, sign: number, ncal: number): number {
  return (sign / (2 * ncal)) * reLminusRaw(st, Q, absOmega);
}
export function imLminus(st: LoopState, Q: number, absOmega: number, sign: number, ncal: number): number {
  return (-Math.PI * sign / (2 * ncal)) * imLminusRaw(st, Q, absOmega);
}

/** Static screening χ₀ = Re L₋(Q → 0, ω = 0) = −(s_a/N_cal) ∫ f dp. */
export function chi0(st: LoopState, sign: number, ncal: number): number {
  return (-sign / ncal) * st.intF;
}

export interface LoopEvaluators {
  /** refresh from f, then evaluate */
  update: (f: Float64Array) => void;
  /** H[y_a, y_b] for Re L₊ */
  lPlus: (P: number, omegaPlus: number) => number;
  /** H[x_a, x_b] for Re L₋ */
  lMinusRe: (Q: number, absOmega: number) => number;
  /** (J(x_a) − J(x_b))/Q for Im L₋ */
  lMinusIm: (Q: number, absOmega: number) => number;
  state: LoopState;
}

/**
 * Hot-path versions of the loop functionals as closures over local typed
 * arrays. Same results as evalH/divH/evalJ, without property lookups.
 */
export function makeLoopEvaluators(op: LoopOperator): LoopEvaluators {
  const st = createLoopState(op);
  const Ht = st.H, Hu = st.Hu, Jc = st.Jc;
  const nx = Ht.length;
  const { lnX0, invDu, du, xLo, xHi, lnS0, invDlnS } = op;
  const s = op.s;
  const ns = s.length;
  const s0 = s[0], sN = s[ns - 1];
  let f = st.f;
  let slope0 = 0, m2 = 0, m4 = 0, jTot = 0;

  const hAbs = (ax: number): number => {
    if (ax <= xLo) return ax * slope0;
    if (ax >= xHi) {
      const i2 = 1 / (ax * ax);
      return (-2 * m2 - 0.6666666666666666 * m4 * i2) / ax;
    }
    const t = (Math.log(ax) - lnX0) * invDu;
    let m = t | 0;
    if (m >= nx - 1) m = nx - 2;
    const r = t - m;
    const r2 = r * r, r3 = r2 * r;
    return (2 * r3 - 3 * r2 + 1) * Ht[m] + (r3 - 2 * r2 + r) * du * Hu[m]
      + (3 * r2 - 2 * r3) * Ht[m + 1] + (r3 - r2) * du * Hu[m + 1];
  };
  const hp = (x: number): number => {
    const ax = x < 0 ? -x : x;
    if (ax <= xLo) return slope0;
    if (ax >= xHi) {
      const i2 = 1 / (ax * ax);
      return 2 * m2 * i2 + 2 * m4 * i2 * i2;
    }
    const t = (Math.log(ax) - lnX0) * invDu;
    let m = t | 0;
    if (m >= nx - 1) m = nx - 2;
    const r = t - m;
    const r2 = r * r;
    return ((6 * r2 - 6 * r) * (Ht[m] - Ht[m + 1]) * invDu
      + (3 * r2 - 4 * r + 1) * Hu[m] + (3 * r2 - 2 * r) * Hu[m + 1]) / ax;
  };
  const dd = (a: number, b: number): number => {
    const d = a - b;
    const aa = a < 0 ? -a : a, ab = b < 0 ? -b : b;
    const scale = aa > ab ? aa : ab;
    if (d <= 1e-7 * (scale > xLo ? scale : xLo)) return hp(0.5 * (a + b));
    const ha = a < 0 ? -hAbs(-a) : hAbs(a);
    const hb = b < 0 ? -hAbs(-b) : hAbs(b);
    return (ha - hb) / d;
  };
  const jAbs = (ax: number): number => {
    if (ax <= s0) return 0.5 * f[0] * ax * ax;
    if (ax >= sN) return jTot;
    let j = ((Math.log(ax) - lnS0) * invDlnS) | 0;
    if (j > ns - 2) j = ns - 2;
    if (s[j] > ax && j > 0) j--;
    else if (s[j + 1] < ax && j < ns - 2) j++;
    const a = s[j];
    const c = (f[j + 1] - f[j]) / (s[j + 1] - a);
    const c0 = f[j] - c * a;
    return Jc[j] + 0.5 * c0 * (ax * ax - a * a) + 0.3333333333333333 * c * (ax * ax * ax - a * a * a);
  };

  return {
    state: st,
    update: (fNew) => {
      updateLoopState(st, fNew);
      f = st.f;
      slope0 = st.slope0;
      m2 = st.m2;
      m4 = st.m4;
      jTot = Jc[ns - 1];
    },
    lPlus: (P, omegaPlus) => {
      const q = 2 * omegaPlus - P * P;
      const D = q > 0 ? Math.sqrt(q) : 0;
      return dd(0.5 * (P + D), 0.5 * (D - P));
    },
    lMinusRe: (Q, w) => {
      const inv = 0.5 / Q;
      const Q2 = Q * Q;
      return dd((w + Q2) * inv, (w - Q2) * inv);
    },
    lMinusIm: (Q, w) => {
      const inv = 0.5 / Q;
      const Q2 = Q * Q;
      const xb = (w - Q2) * inv;
      return (jAbs((w + Q2) * inv) - jAbs(xb < 0 ? -xb : xb)) / Q;
    },
  };
}
