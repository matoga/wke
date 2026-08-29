/** Shared plot palette and number formatting. */

export const COLORS = {
  raw: '#94a3b8',
  current: 'var(--plot-current)',
  spectrum: '#0c8ee0',
  classical: '#0c8ee0',
  quantum: '#a855f7',
  formula: '#f59e0b',
  measured: '#ef4444',
  peak: '#ef4444',
  band: '#22c55e',
  muted: '#64748b',
  stage: '#14b8a6',
} as const;

/** Fixed significant digits, switching to exponent notation outside 1e-3…1e5. */
export function sig(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (v === 0) return '0';
  if (a >= 1e5 || a < 1e-3) {
    const s = v.toExponential(digits - 1);
    const [m, e] = s.split('e');
    return `${m}×10${superscript(Number(e))}`;
  }
  return v.toPrecision(digits);
}

/** Plain exponent notation, for tight table cells. */
export function expo(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return v.toExponential(digits - 1);
}

/**
 * Rainbow ramp for "all times at once" views: blue (early) through green and
 * yellow to red (late), the conventional low-to-high colour order.
 */
export function rainbowColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const hue = 240 - 240 * clamped;
  return `hsl(${hue.toFixed(1)}, 75%, 48%)`;
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Seconds with a unit that keeps 3–4 significant digits readable. */
export function seconds(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1) return `${v.toPrecision(4)} s`;
  if (a >= 1e-3) return `${(v * 1e3).toPrecision(4)} ms`;
  if (a >= 1e-6) return `${(v * 1e6).toPrecision(4)} µs`;
  return `${v.toExponential(3)} s`;
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '',
};

function superscript(e: number): string {
  return String(e).split('').map((c) => SUP[c] ?? c).join('');
}

/** Parse a user-entered number; blank or unparseable becomes null. */
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
