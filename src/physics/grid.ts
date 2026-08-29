/**
 * Logarithmic momentum grid and quadrature weights.
 * p = k · ξ (dimensionless), or k in physical [μm⁻¹] form.
 */

/**
 * Generate a logarithmically spaced grid from p_min to p_max with N points.
 * Matches Python `wke.grid.logarithmic_grid`.
 */
export function logarithmicGrid(p_min: number, p_max: number, N: number): Float64Array {
  const grid = new Float64Array(N);
  const log_min = Math.log(p_min);
  const log_max = Math.log(p_max);
  for (let i = 0; i < N; i++) {
    grid[i] = Math.exp(log_min + (log_max - log_min) * i / (N - 1));
  }
  return grid;
}

/**
 * Compute cell-centered quadrature weights Δp for trapezoid integration on a grid.
 * dp_full[i] matches the Python convention.
 */
export function trapzWeights(grid: Float64Array): Float64Array {
  const N = grid.length;
  const w = new Float64Array(N);
  // interior: half-sum of adjacent spacings
  for (let i = 1; i < N - 1; i++) {
    w[i] = 0.5 * (grid[i + 1] - grid[i - 1]);
  }
  w[0]     = grid[1] - grid[0];
  w[N - 1] = grid[N - 1] - grid[N - 2];
  return w;
}

/** Trapezoid integration ∫ f(x) dx */
export function trapz(y: Float64Array, x: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < x.length - 1; i++) {
    sum += 0.5 * (y[i] + y[i + 1]) * (x[i + 1] - x[i]);
  }
  return sum;
}

/** Trapezoid integration using precomputed weights */
export function trapzW(y: Float64Array, w: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < y.length; i++) sum += y[i] * w[i];
  return sum;
}

/**
 * Interpolate q_raw (sampled at k_raw) onto a target grid k_grid.
 * Uses linear interpolation with independently configurable low-k and high-k
 * extrapolation. A constant low-k extension is useful for imported spectra:
 * a missing measurement below the first point is not evidence that the
 * density vanishes there.
 */
export function interpolateQ(
  k_raw: number[],
  q_raw: number[],
  k_grid: Float64Array,
  options: { lower?: 'zero' | 'constant' | 'power-law'; upper?: 'zero' | 'constant' } = {},
): Float64Array {
  const N = k_grid.length;
  const out = new Float64Array(N);
  const M = k_raw.length;
  // A run's physical-k grid shifts when the healing length differs from the
  // reference value. Continue the measured low-k asymptote onto any newly
  // exposed cells instead of creating an artificial empty band. The bounded
  // fit covers the two regular cases used here: q=N_k/N ~ k^2 for finite n_k,
  // and q~constant for the mu=0 Bose distribution (n_k~k^-2).
  let lowerPower = 0;
  if (options.lower === 'power-law' && q_raw[0] > 0 && k_raw[0] > 0) {
    const fitCount = Math.min(12, M);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, count = 0;
    for (let j = 0; j < fitCount; j++) {
      if (!(q_raw[j] > 0) || !(k_raw[j] > 0)) break;
      const x = Math.log(k_raw[j]);
      const y = Math.log(q_raw[j]);
      sx += x; sy += y; sxx += x * x; sxy += x * y; count++;
    }
    const denominator = count * sxx - sx * sx;
    if (count >= 2 && Math.abs(denominator) > 1e-15) {
      lowerPower = Math.min(2, Math.max(0, (count * sxy - sx * sy) / denominator));
    }
  }
  for (let i = 0; i < N; i++) {
    const k = k_grid[i];
    if (k < k_raw[0]) {
      if (options.lower === 'constant') out[i] = q_raw[0];
      else if (options.lower === 'power-law' && q_raw[0] > 0) {
        out[i] = q_raw[0] * (k / k_raw[0]) ** lowerPower;
      } else out[i] = 0;
      continue;
    }
    if (k > k_raw[M - 1]) {
      out[i] = options.upper === 'constant' ? q_raw[M - 1] : 0;
      continue;
    }
    // binary search
    let lo = 0, hi = M - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (k_raw[mid] <= k) lo = mid; else hi = mid;
    }
    const t = (k - k_raw[lo]) / (k_raw[hi] - k_raw[lo]);
    out[i] = q_raw[lo] * (1 - t) + q_raw[hi] * t;
    if (out[i] < 0) out[i] = 0;
  }
  return out;
}

/** Normalize a profile so ∫ q dk = 1 using the provided k grid and weights */
export function normalizeQ(q: Float64Array, k: Float64Array): Float64Array {
  const integral = trapz(q, k);
  if (integral <= 0) return q.slice();
  const out = new Float64Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / integral;
  return out;
}
