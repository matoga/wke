/** Gauss-Legendre quadrature and log-p interpolation maps. */

const leggaussCache = new Map<number, { x: Float64Array; w: Float64Array }>();

/**
 * Nodes and weights of the n-point Gauss-Legendre rule on [-1, 1].
 * Newton iteration on P_n using the standard three-term recurrence, accurate
 * to about 1e-15.
 */
export function leggauss(n: number): { x: Float64Array; w: Float64Array } {
  const cached = leggaussCache.get(n);
  if (cached) return cached;

  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const m = (n + 1) >> 1;

  for (let i = 0; i < m; i++) {
    // Chebyshev-like initial guess, accurate enough for quadratic convergence.
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1.0;
      let p1 = 0.0;
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
    x[i] = -z;
    x[n - 1 - i] = z;
    const wi = 2.0 / ((1 - z * z) * pp * pp);
    w[i] = wi;
    w[n - 1 - i] = wi;
  }

  const result = { x, w };
  leggaussCache.set(n, result);
  return result;
}

/**
 * Nodes and `dp` weights on [a, b] for an integral transformed with s = log(p).
 */
export function gaussLegendreLog(
  a: number,
  b: number,
  n: number,
): { p: Float64Array; w: Float64Array } {
  if (!(a > 0 && b > a) || n < 1) {
    throw new Error(`gaussLegendreLog requires 0 < a < b and n >= 1 (got ${a}, ${b}, ${n})`);
  }
  const { x, w: gw } = leggauss(n);
  const sa = Math.log(a);
  const sb = Math.log(b);
  const half = 0.5 * (sb - sa);
  const mid = 0.5 * (sb + sa);

  const p = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = Math.exp(half * x[i] + mid);
    w[i] = gw[i] * half * p[i];
  }
  return { p, w };
}

/**
 * Index, upper weight, and low-boundary flag for linear interpolation in log p.
 *
 * `logGrid` must be the strictly increasing log of the state grid.
 */
export function interpolationMap(
  logGrid: Float64Array,
  value: number,
): { idx: number; alpha: number; low: boolean } {
  const lv = Math.log(value);
  const n = logGrid.length;

  // index of the last grid point <= lv
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (logGrid[mid] <= lv) lo = mid + 1;
    else hi = mid;
  }
  let idx = lo - 1;

  const low = idx < 0;
  const high = idx >= n - 1;
  if (high && lv > logGrid[n - 1] + 5e-13) {
    throw new Error('interpolation request exceeds state guard band');
  }
  idx = Math.min(Math.max(idx, 0), n - 2);

  let alpha = (lv - logGrid[idx]) / (logGrid[idx + 1] - logGrid[idx]);
  alpha = low ? 0.0 : Math.min(Math.max(alpha, 0.0), 1.0);
  return { idx, alpha, low };
}
