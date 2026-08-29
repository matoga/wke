/**
 * Compact responsive SVG line plot with a cursor readout.
 *
 * Deliberately minimal: linear or log axes, a handful of series, optional
 * vertical/horizontal markers and shaded bands. Colours come from CSS custom
 * properties so light and dark themes stay consistent.
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';

export interface Series {
  id: string;
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  /** 'line' draws a polyline, 'points' draws small circles */
  kind?: 'line' | 'points';
  dashed?: boolean;
  width?: number;
  opacity?: number;
  /** Draw the series without adding it to the legend or cursor readout. */
  decorative?: boolean;
}

export interface Marker {
  id: string;
  axis: 'x' | 'y';
  value: number;
  label?: string;
  color: string;
  dashed?: boolean;
  /** Makes the guide draggable along its value axis. */
  onChange?: (value: number) => void;
  /** When provided, shows a compact reset control beside the guide label. */
  resetValue?: number;
}

export interface Band {
  id: string;
  axis: 'x' | 'y';
  from: number;
  to: number;
  color: string;
  label?: string;
}

export interface PlotProps {
  series: Series[];
  markers?: Marker[];
  bands?: Band[];
  xLabel: string;
  yLabel: string;
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xDomain?: [number, number];
  yDomain?: [number, number];
  height?: number;
  /**
   * When set, height tracks measured width at this aspect ratio instead of
   * the fixed `height` prop — 'golden' is width / 1.618, clamped to a sane
   * range for the main evolution plots.
   */
  aspect?: 'golden';
  minHeight?: number;
  maxHeight?: number;
  /** caps the plot's rendered width (and, with aspect='golden', its height) */
  maxWidth?: number;
  /** formats the cursor readout; defaults to 4 significant digits */
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  legend?: boolean;
  className?: string;
  /** Makes one line directly paintable with pointer or touch input. */
  editableSeries?: {
    id: string;
    onChange: (values: number[]) => void;
    onCommit?: (values: number[]) => void;
    min?: number;
    max?: number;
  };
}

const MARGIN = { top: 10, right: 12, bottom: 34, left: 54 };

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.length > 1 ? out : [lo, hi];
}

function fmtTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

const defaultFormat = (v: number): string =>
  Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toPrecision(4);

export function Plot({
  series, markers = [], bands = [],
  xLabel, yLabel,
  xScale = 'linear', yScale = 'linear',
  xDomain, yDomain,
  height = 220,
  formatX = defaultFormat, formatY = defaultFormat,
  legend = true,
  className,
  aspect,
  minHeight = 180,
  maxHeight = 460,
  maxWidth,
  editableSeries,
}: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [cursor, setCursor] = useState<{ px: number; x: number } | null>(null);
  const lastPaint = useRef<{ index: number; value: number } | null>(null);
  const paintedValues = useRef<number[] | null>(null);

  const resolvedHeight = aspect === 'golden'
    ? Math.min(maxHeight, Math.max(minHeight, width / 1.618))
    : height;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 560);
    return () => ro.disconnect();
  }, []);

  const iw = Math.max(60, width - MARGIN.left - MARGIN.right);
  const ih = Math.max(60, resolvedHeight - MARGIN.top - MARGIN.bottom);

  const domains = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of series) {
      const n = Math.min(s.x.length, s.y.length);
      for (let i = 0; i < n; i++) {
        const xv = s.x[i], yv = s.y[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
        if (xScale === 'log' && !(xv > 0)) continue;
        if (yScale === 'log' && !(yv > 0)) continue;
        if (xv < x0) x0 = xv;
        if (xv > x1) x1 = xv;
        if (yv < y0) y0 = yv;
        if (yv > y1) y1 = yv;
      }
    }
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; }
    if (!Number.isFinite(y0)) { y0 = 0; y1 = 1; }

    let [dx0, dx1] = xDomain ?? [x0, x1];
    let [dy0, dy1] = yDomain ?? [y0, y1];
    if (!yDomain) {
      if (yScale === 'log') {
        dy0 = Math.max(dy0, dy1 * 1e-6);
        dy1 *= 1.6;
      } else {
        const pad = (dy1 - dy0) * 0.08 || Math.abs(dy1) * 0.08 || 1;
        dy0 = dy0 > 0 && dy0 - pad < 0 ? 0 : dy0 - pad;
        dy1 += pad;
      }
    }
    if (dx1 <= dx0) dx1 = dx0 + 1;
    if (dy1 <= dy0) dy1 = dy0 + 1;
    return { dx0, dx1, dy0, dy1 };
  }, [series, xDomain, yDomain, xScale, yScale]);

  const { dx0, dx1, dy0, dy1 } = domains;

  const sx = useCallback((v: number): number => {
    if (xScale === 'log') {
      const l0 = Math.log(dx0), l1 = Math.log(dx1);
      return ((Math.log(Math.max(v, 1e-300)) - l0) / (l1 - l0)) * iw;
    }
    return ((v - dx0) / (dx1 - dx0)) * iw;
  }, [xScale, dx0, dx1, iw]);

  const sy = useCallback((v: number): number => {
    if (yScale === 'log') {
      const l0 = Math.log(dy0), l1 = Math.log(dy1);
      return ih - ((Math.log(Math.max(v, 1e-300)) - l0) / (l1 - l0)) * ih;
    }
    return ih - ((v - dy0) / (dy1 - dy0)) * ih;
  }, [yScale, dy0, dy1, ih]);

  const invX = useCallback((px: number): number => {
    const t = px / iw;
    if (xScale === 'log') return Math.exp(Math.log(dx0) + t * (Math.log(dx1) - Math.log(dx0)));
    return dx0 + t * (dx1 - dx0);
  }, [xScale, dx0, dx1, iw]);

  const invY = useCallback((py: number): number => {
    const t = 1 - py / ih;
    if (yScale === 'log') return Math.exp(Math.log(dy0) + t * (Math.log(dy1) - Math.log(dy0)));
    return dy0 + t * (dy1 - dy0);
  }, [yScale, dy0, dy1, ih]);

  const xTicks = xScale === 'log' ? logTicks(dx0, dx1) : niceTicks(dx0, dx1, Math.max(3, Math.floor(iw / 90)));
  const yTicks = yScale === 'log' ? logTicks(dy0, dy1) : niceTicks(dy0, dy1, Math.max(3, Math.floor(ih / 44)));

  const paths = useMemo(() => series.map((s) => {
    if (s.kind === 'points') return { id: s.id, d: '' };
    const n = Math.min(s.x.length, s.y.length);
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const xv = s.x[i], yv = s.y[i];
      const ok = Number.isFinite(xv) && Number.isFinite(yv)
        && (xScale !== 'log' || xv > 0) && (yScale !== 'log' || yv > 0);
      if (!ok) { pen = false; continue; }
      const X = sx(xv), Y = sy(yv);
      d += `${pen ? 'L' : 'M'}${X.toFixed(2)} ${Y.toFixed(2)}`;
      pen = true;
    }
    return { id: s.id, d };
  }), [series, sx, sy, xScale, yScale]);

  // nearest-sample readout for each series at the cursor x
  const readout = useMemo(() => {
    if (!cursor) return null;
    return series.filter((s) => !s.decorative).map((s) => {
      const n = Math.min(s.x.length, s.y.length);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(sx(s.x[i]) - cursor.px);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best >= 0 && bestD < 40
        ? { s, x: s.x[best], y: s.y[best] }
        : null;
    }).filter(Boolean) as Array<{ s: Series; x: number; y: number }>;
  }, [cursor, series, sx]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - MARGIN.left;
    if (px < 0 || px > iw) { setCursor(null); return; }
    setCursor({ px, x: invX(px) });
  };

  const paintAt = useCallback((clientX: number, clientY: number, svg: SVGSVGElement) => {
    if (!editableSeries) return;
    const target = series.find((item) => item.id === editableSeries.id);
    if (!target) return;
    const rect = svg.getBoundingClientRect();
    const viewX = (clientX - rect.left) * (width / rect.width);
    const viewY = (clientY - rect.top) * (resolvedHeight / rect.height);
    const px = Math.min(iw, Math.max(0, viewX - MARGIN.left));
    const py = Math.min(ih, Math.max(0, viewY - MARGIN.top));
    const x = invX(px);
    let index = 0;
    let distance = Infinity;
    for (let i = 0; i < target.x.length; i++) {
      const nextDistance = Math.abs(target.x[i] - x);
      if (nextDistance < distance) { distance = nextDistance; index = i; }
    }
    const min = editableSeries.min ?? dy0;
    const max = editableSeries.max ?? dy1;
    const value = Math.min(max, Math.max(min, invY(py)));
    const next = Array.from(target.y);
    if (lastPaint.current && lastPaint.current.index !== index) {
      const previous = lastPaint.current;
      const lo = Math.min(previous.index, index);
      const hi = Math.max(previous.index, index);
      for (let i = lo; i <= hi; i++) {
        const t = (i - previous.index) / (index - previous.index);
        next[i] = previous.value + t * (value - previous.value);
      }
    } else {
      next[index] = value;
    }
    lastPaint.current = { index, value };
    paintedValues.current = next;
    editableSeries.onChange(next);
  }, [editableSeries, series, width, resolvedHeight, iw, ih, invX, invY, dy0, dy1]);

  const grid = 'currentColor';

  return (
    <div
      ref={ref}
      className={clsx(className, maxWidth != null && 'mx-auto w-full')}
      style={maxWidth != null ? { maxWidth } : undefined}
    >
      <svg
        width="100%"
        height={resolvedHeight}
        viewBox={`0 0 ${width} ${resolvedHeight}`}
        role="img"
        aria-label={`${yLabel} versus ${xLabel}`}
        onMouseMove={onMove}
        onMouseLeave={() => setCursor(null)}
        onPointerDown={editableSeries ? (event) => {
          lastPaint.current = null;
          paintedValues.current = null;
          event.currentTarget.setPointerCapture(event.pointerId);
          paintAt(event.clientX, event.clientY, event.currentTarget);
        } : undefined}
        onPointerMove={editableSeries ? (event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          paintAt(event.clientX, event.clientY, event.currentTarget);
        } : undefined}
        onPointerUp={editableSeries ? (event) => {
          const committed = paintedValues.current;
          lastPaint.current = null;
          paintedValues.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (committed) editableSeries.onCommit?.(committed);
        } : undefined}
        onPointerCancel={editableSeries ? () => {
          lastPaint.current = null;
          paintedValues.current = null;
        } : undefined}
        className={clsx(
          'text-slate-300 dark:text-slate-700 select-none',
          editableSeries && 'touch-none cursor-crosshair',
        )}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {bands.map((b) => {
            const [a, c] = b.axis === 'x'
              ? [sx(b.from), sx(b.to)]
              : [sy(b.to), sy(b.from)];
            return b.axis === 'x' ? (
              <rect key={b.id} x={Math.min(a, c)} y={0} width={Math.abs(c - a)} height={ih}
                fill={b.color} opacity={0.1} />
            ) : (
              <rect key={b.id} x={0} y={Math.min(a, c)} width={iw} height={Math.abs(c - a)}
                fill={b.color} opacity={0.1} />
            );
          })}

          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={0} y2={ih}
              stroke={grid} strokeWidth={0.5} opacity={0.55} />
          ))}
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={0} x2={iw} y1={sy(t)} y2={sy(t)}
              stroke={grid} strokeWidth={0.5} opacity={0.55} />
          ))}

          {series.map((s, i) => s.kind === 'points' ? (
            <g key={s.id} fill={s.color} opacity={s.opacity ?? 0.85}>
              {Array.from({ length: Math.min(s.x.length, s.y.length) }, (_, j) => {
                const xv = s.x[j], yv = s.y[j];
                if (!Number.isFinite(xv) || !Number.isFinite(yv)) return null;
                if (xScale === 'log' && !(xv > 0)) return null;
                if (yScale === 'log' && !(yv > 0)) return null;
                return <circle key={j} cx={sx(xv)} cy={sy(yv)} r={1.8} />;
              })}
            </g>
          ) : (
            <path key={s.id} d={paths[i].d} fill="none" stroke={s.color}
              strokeWidth={s.width ?? 1.6} opacity={s.opacity ?? 1}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {markers.map((m) => m.axis === 'x' ? (
            <g key={m.id}>
              <line x1={sx(m.value)} x2={sx(m.value)} y1={0} y2={ih}
                stroke={m.color} strokeWidth={1.2}
                strokeDasharray={m.dashed === false ? undefined : '3 3'} />
              {m.label && (
                <text x={sx(m.value) + 3} y={11} fill={m.color}
                  className="text-[9px] font-medium" style={{ fontSize: 9 }}>{m.label}</text>
              )}
            </g>
          ) : (
            <g key={m.id}>
              <line x1={0} x2={iw} y1={sy(m.value)} y2={sy(m.value)}
                stroke={m.color} strokeWidth={1.2}
                strokeDasharray={m.dashed === false ? undefined : '3 3'} />
              {m.onChange && (
                <line
                  x1={0} x2={iw} y1={sy(m.value)} y2={sy(m.value)}
                  stroke="transparent" strokeWidth={24}
                  className="touch-none cursor-row-resize"
                  role="slider"
                  aria-label={m.label ?? 'Horizontal guide'}
                  aria-valuemin={dy0}
                  aria-valuemax={dy1}
                  aria-valuenow={m.value}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    const step = (dy1 - dy0) / 100;
                    if (event.key === 'ArrowUp') m.onChange?.(Math.min(dy1, m.value + step));
                    else if (event.key === 'ArrowDown') m.onChange?.(Math.max(dy0, m.value - step));
                    else return;
                    event.preventDefault();
                  }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    event.preventDefault();
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const svg = event.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const rect = svg.getBoundingClientRect();
                    const viewY = (event.clientY - rect.top) * (resolvedHeight / rect.height);
                    m.onChange?.(Math.min(dy1, Math.max(dy0, invY(viewY - MARGIN.top))));
                  }}
                  onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                />
              )}
              {m.label && !m.onChange && (
                <text x={iw - 3} y={sy(m.value) - 3} fill={m.color} textAnchor="end"
                  style={{ fontSize: 9 }}>{m.label}</text>
              )}
              {m.label && m.onChange && (
                <foreignObject x={Math.max(0, iw - 94)} y={Math.max(0, Math.min(ih - 22, sy(m.value) - 11))} width={94} height={22}>
                  <div
                    className="flex h-[22px] touch-none select-none items-center justify-end gap-1 cursor-row-resize"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      event.preventDefault();
                    }}
                    onPointerMove={(event) => {
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      const svg = event.currentTarget.closest('svg');
                      if (!svg) return;
                      const rect = svg.getBoundingClientRect();
                      const viewY = (event.clientY - rect.top) * (resolvedHeight / rect.height);
                      m.onChange?.(Math.min(dy1, Math.max(dy0, invY(viewY - MARGIN.top))));
                    }}
                    onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                  >
                    <span
                      className="rounded-md border border-slate-200/90 bg-white/90 px-1.5 py-0.5 font-mono text-[9px] font-medium shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90"
                      style={{ color: m.color }}
                    >
                      {m.label}
                    </span>
                    {m.resetValue != null && (
                      <button
                        type="button"
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-slate-200 bg-white/95 text-[10px] text-slate-500 shadow-sm transition-colors hover:border-accent-300 hover:text-accent-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => m.onChange?.(m.resetValue!)}
                        aria-label={`Reset ${m.label} to ${m.resetValue.toFixed(2)}`}
                        title={`Reset to ${m.resetValue.toFixed(2)}`}
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </foreignObject>
              )}
            </g>
          ))}

          {cursor && (
            <line x1={cursor.px} x2={cursor.px} y1={0} y2={ih}
              stroke="currentColor" strokeWidth={1} opacity={0.9} />
          )}
          {cursor && readout?.map(({ s, x, y }) => (
            <circle key={s.id} cx={sx(x)} cy={sy(y)} r={3}
              fill={s.color} stroke="var(--plot-bg, #fff)" strokeWidth={1} />
          ))}

          <line x1={0} x2={iw} y1={ih} y2={ih} stroke="currentColor" strokeWidth={1} />
          <line x1={0} x2={0} y1={0} y2={ih} stroke="currentColor" strokeWidth={1} />

          {xTicks.map((t) => (
            <text key={`tx${t}`} x={sx(t)} y={ih + 13} textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9.5 }}>
              {fmtTick(t)}
            </text>
          ))}
          {yTicks.map((t) => (
            <text key={`ty${t}`} x={-6} y={sy(t) + 3} textAnchor="end"
              className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9.5 }}>
              {fmtTick(t)}
            </text>
          ))}

          <text x={iw / 2} y={ih + 28} textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10 }}>
            {xLabel}
          </text>
          <text transform={`translate(${-MARGIN.left + 11},${ih / 2}) rotate(-90)`} textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10 }}>
            {yLabel}
          </text>
        </g>
      </svg>

      <div className="flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 px-1">
        {legend && series.filter((s) => !s.decorative).map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 text-2xs text-slate-500 dark:text-slate-400">
            <span className="inline-block w-3 h-[2px] rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-5 overflow-hidden px-1 text-right">
        <span
          className={clsx(
            'whitespace-nowrap font-mono text-2xs tabular-nums text-slate-500 dark:text-slate-400',
            !(cursor && readout && readout.length > 0) && 'invisible',
          )}
        >
          {xLabel.split(' ')[0]} = {formatX(cursor?.x ?? 0)}
          {(readout ?? []).map(({ s, y }) => (
            <span key={s.id} style={{ color: s.color }}>{'  '}· {formatY(y)}</span>
          ))}
        </span>
      </div>
    </div>
  );
}
