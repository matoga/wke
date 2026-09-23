/** Number formatting for readouts. Missing values render as "n/a". */

export const NA = 'n/a';

export function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return sci(v, digits - 1);
  return Number(v.toPrecision(digits)).toString();
}

export function fixed(v: number | null | undefined, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return v.toFixed(decimals);
}

/** Scientific notation with a real minus sign and superscript exponent. */
export function sci(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return NA;
  if (v === 0) return '0';
  const [m, e] = v.toExponential(digits).split('e');
  const exp = Number(e);
  const sup = String(exp).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${m.replace('-', '−')} × 10${sup}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${(100 * v).toFixed(digits)}%`;
}

export function signed(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return NA;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s.replace('-', '−');
}

/** A physical time in the most readable unit. */
export function time(t_s: number | null | undefined): { value: string; unit: string } {
  if (t_s == null || !Number.isFinite(t_s)) return { value: NA, unit: '' };
  if (t_s === 0) return { value: '0', unit: 's' };
  const a = Math.abs(t_s);
  if (a >= 1) return { value: t_s.toPrecision(4), unit: 's' };
  if (a >= 1e-3) return { value: (t_s * 1e3).toPrecision(4), unit: 'ms' };
  return { value: (t_s * 1e6).toPrecision(4), unit: 'μs' };
}

export function timeText(t_s: number | null | undefined): string {
  const t = time(t_s);
  return t.unit ? `${t.value} ${t.unit}` : t.value;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return NA;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}
