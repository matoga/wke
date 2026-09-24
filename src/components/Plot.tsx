/**
 * Responsive SVG line plot with a cursor readout: linear or log axes, a few
 * series, optional markers and bands, and an optional hand-drawn series.
 * Colours are CSS values, so tokens follow the light and dark themes.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  id: string;
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  kind?: 'line' | 'points';
  dashed?: boolean;
  width?: number;
  opacity?: number;
  /** drawn, but left out of the legend and cursor readout */
  decorative?: boolean;
}

export interface Marker {
  id: string;
  axis: 'x' | 'y';
  value: number;
  label?: string;
  color: string;
  dashed?: boolean;
  draggable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
}

export interface PointMark {
  id: string;
  x: number;
  y: number;
  color: string;
  shape: 'dot' | 'cross';
  title?: string;
}

export interface PlotProps {
  series: Series[];
  markers?: Marker[];
  points?: PointMark[];
  xLabel: string;
  yLabel: string;
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** height = width / aspect, clamped */
  aspect?: number;
  minHeight?: number;
  maxHeight?: number;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  ariaLabel?: string;
  /** mouse-wheel zoom, drag to pan, double-click or the reset button to restore */
  zoomable?: boolean;
  editableSeries?: {
    id: string;
    onChange: (values: number[]) => void;
    onCommit?: (values: number[]) => void;
    min?: number;
    max?: number;
  };
}

const MARGIN = { top: 12, right: 14, bottom: 38, left: 58 };

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const step0 = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  const mult = e1 - e0 > 5 ? [1] : [1, 2, 5];
  for (let e = e0; e <= e1; e++) {
    for (const m of mult) {
      const v = m * Math.pow(10, e);
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.length > 1 ? out : [lo, hi];
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function fmtTick(v: number, log: boolean): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (log && (a >= 1e4 || a < 1e-2)) {
    const e = Math.round(Math.log10(a));
    if (Math.abs(a / Math.pow(10, e) - 1) < 1e-9) {
      return `10${String(e).replace('-', '⁻').replace(/\d/g, (d) => SUP[Number(d)])}`;
    }
  }
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(0).split('e');
    return `${m}e${Number(e)}`;
  }
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  return String(Number(v.toPrecision(2)));
}

const defaultFormat = (v: number): string =>
  Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toPrecision(4);

export function Plot({
  series, markers = [], points = [],
  xLabel, yLabel, xScale = 'linear', yScale = 'linear', xDomain, yDomain,
  aspect = 1.618, minHeight = 200, maxHeight = 460,
  formatX = defaultFormat, formatY = defaultFormat, ariaLabel, editableSeries, zoomable = false,
}: PlotProps) {
  const [zoom, setZoom] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const panStart = useRef<{ startX: number; startY: number; x: [number, number]; y: [number, number] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(560);
  const [cursor, setCursor] = useState<{ px: number; x: number } | null>(null);
  const [keyIndex, setKeyIndex] = useState(0);
  const [draggedMarkerId, setDraggedMarkerId] = useState<string | null>(null);
  const lastPaint = useRef<{ index: number; value: number } | null>(null);
  const painted = useRef<number[] | null>(null);

  const height = Math.min(maxHeight, Math.max(minHeight, width / aspect));

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
  const ih = Math.max(60, height - MARGIN.top - MARGIN.bottom);
  const geo = useRef({ width, height, iw, ih });
  geo.current = { width, height, iw, ih };

  useEffect(() => {
    const svg = svgRef.current;
    if (!zoomable || !svg) return;
    const onWheel = (e: WheelEvent) => {
      const g = geo.current;
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (g.width / rect.width) - MARGIN.left;
      const py = (e.clientY - rect.top) * (g.height / rect.height) - MARGIN.top;
      if (px < 0 || px > g.iw || py < 0 || py > g.ih) return;
      e.preventDefault();
      const factor = Math.exp(Math.sign(e.deltaY) * Math.min(0.5, Math.abs(e.deltaY) / 400) * 0.6);
      zoomRef.current(factor, px / g.iw, 1 - py / g.ih, e.shiftKey ? 'x' : e.altKey ? 'y' : 'both');
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomable]);

  const { dx0, dx1, dy0, dy1 } = useMemo(() => {
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
    if (!Number.isFinite(x0)) { x0 = xScale === 'log' ? 0.1 : 0; x1 = 1; }
    if (!Number.isFinite(y0)) { y0 = yScale === 'log' ? 0.1 : 0; y1 = 1; }
    let [a, b] = xDomain ?? [x0, x1];
    let [c, d] = yDomain ?? [y0, y1];
    if (!yDomain) {
      if (yScale === 'log') { c = Math.max(c, d * 1e-6); d *= 1.6; }
      else {
        const pad = (d - c) * 0.08 || Math.abs(d) * 0.08 || 1;
        c = c >= 0 && c - pad < 0 ? 0 : c - pad;
        d += pad;
      }
    }
    if (b <= a) b = a + (xScale === 'log' ? a : 1);
    if (d <= c) d = c + (yScale === 'log' ? c : 1);
    if (zoom) return { dx0: zoom.x[0], dx1: zoom.x[1], dy0: zoom.y[0], dy1: zoom.y[1] };
    return { dx0: a, dx1: b, dy0: c, dy1: d };
  }, [series, xDomain, yDomain, xScale, yScale, zoom]);

  // Zoom and pan work in the axis coordinate: ln v on a log axis, v otherwise.
  const toU = (v: number, log: boolean) => (log ? Math.log(v) : v);
  const fromU = (u: number, log: boolean) => (log ? Math.exp(u) : u);
  const scaleRange = (r: [number, number], log: boolean, factor: number, anchor: number): [number, number] => {
    const a = toU(r[0], log), b = toU(r[1], log), m = toU(anchor, log);
    return [fromU(m + (a - m) * factor, log), fromU(m + (b - m) * factor, log)];
  };
  const zoomBy = useCallback((factor: number, fx: number, fy: number, axes: 'both' | 'x' | 'y') => {
    const xr: [number, number] = [dx0, dx1], yr: [number, number] = [dy0, dy1];
    const ax = xScale === 'log' ? Math.exp(Math.log(dx0) + fx * (Math.log(dx1) - Math.log(dx0))) : dx0 + fx * (dx1 - dx0);
    const ay = yScale === 'log' ? Math.exp(Math.log(dy0) + fy * (Math.log(dy1) - Math.log(dy0))) : dy0 + fy * (dy1 - dy0);
    setZoom({
      x: axes === 'y' ? xr : scaleRange(xr, xScale === 'log', factor, ax),
      y: axes === 'x' ? yr : scaleRange(yr, yScale === 'log', factor, ay),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dx0, dx1, dy0, dy1, xScale, yScale]);
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => { setZoom(null); }, [xScale, yScale, xLabel, yLabel]);

  const sx = useCallback((v: number) => (xScale === 'log'
    ? ((Math.log(Math.max(v, 1e-300)) - Math.log(dx0)) / (Math.log(dx1) - Math.log(dx0))) * iw
    : ((v - dx0) / (dx1 - dx0)) * iw), [xScale, dx0, dx1, iw]);
  const sy = useCallback((v: number) => (yScale === 'log'
    ? ih - ((Math.log(Math.max(v, 1e-300)) - Math.log(dy0)) / (Math.log(dy1) - Math.log(dy0))) * ih
    : ih - ((v - dy0) / (dy1 - dy0)) * ih), [yScale, dy0, dy1, ih]);
  const invX = useCallback((px: number) => {
    const t = px / iw;
    return xScale === 'log' ? Math.exp(Math.log(dx0) + t * (Math.log(dx1) - Math.log(dx0))) : dx0 + t * (dx1 - dx0);
  }, [xScale, dx0, dx1, iw]);
  const invY = useCallback((py: number) => {
    const t = 1 - py / ih;
    return yScale === 'log' ? Math.exp(Math.log(dy0) + t * (Math.log(dy1) - Math.log(dy0))) : dy0 + t * (dy1 - dy0);
  }, [yScale, dy0, dy1, ih]);

  const xTicks = xScale === 'log' ? logTicks(dx0, dx1) : niceTicks(dx0, dx1, Math.max(3, Math.floor(iw / 90)));
  const yTicks = yScale === 'log' ? logTicks(dy0, dy1) : niceTicks(dy0, dy1, Math.max(3, Math.floor(ih / 46)));

  const paths = useMemo(() => series.map((s) => {
    if (s.kind === 'points') return '';
    const n = Math.min(s.x.length, s.y.length);
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const xv = s.x[i], yv = s.y[i];
      const ok = Number.isFinite(xv) && Number.isFinite(yv) && (xScale !== 'log' || xv > 0) && (yScale !== 'log' || yv > 0);
      if (!ok) { pen = false; continue; }
      // Only guard against absurd coordinates: clamping near the frame would
      // move the end of a straight segment and change its slope. The clip path
      // does the visual cropping.
      const X = Math.min(1e6, Math.max(-1e6, sx(xv)));
      const Y = Math.min(1e6, Math.max(-1e6, sy(yv)));
      d += `${pen ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`;
      pen = true;
    }
    return d;
  }), [series, sx, sy, xScale, yScale, iw, ih]);

  const readout = useMemo(() => {
    if (!cursor) return null;
    return series.filter((s) => !s.decorative).map((s) => {
      const n = Math.min(s.x.length, s.y.length);
      let best = -1, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(sx(s.x[i]) - cursor.px);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best >= 0 && bestD < 40 ? { s, x: s.x[best], y: s.y[best] } : null;
    }).filter(Boolean) as Array<{ s: Series; x: number; y: number }>;
  }, [cursor, series, sx]);

  const paintAt = useCallback((clientX: number, clientY: number, svg: SVGSVGElement) => {
    if (!editableSeries) return;
    const target = series.find((item) => item.id === editableSeries.id);
    if (!target) return;
    const rect = svg.getBoundingClientRect();
    const px = Math.min(iw, Math.max(0, (clientX - rect.left) * (width / rect.width) - MARGIN.left));
    const py = Math.min(ih, Math.max(0, (clientY - rect.top) * (height / rect.height) - MARGIN.top));
    const x = invX(px);
    let index = 0, distance = Infinity;
    for (let i = 0; i < target.x.length; i++) {
      const dd = Math.abs(target.x[i] - x);
      if (dd < distance) { distance = dd; index = i; }
    }
    const min = editableSeries.min ?? dy0;
    const max = editableSeries.max ?? dy1;
    const value = Math.min(max, Math.max(min, invY(py)));
    const next = Array.from(target.y);
    const prev = lastPaint.current;
    if (prev && prev.index !== index) {
      const lo = Math.min(prev.index, index), hi = Math.max(prev.index, index);
      for (let i = lo; i <= hi; i++) next[i] = prev.value + ((i - prev.index) / (index - prev.index)) * (value - prev.value);
    } else {
      next[index] = value;
    }
    lastPaint.current = { index, value };
    painted.current = next;
    editableSeries.onChange(next);
  }, [editableSeries, series, width, height, iw, ih, invX, invY, dy0, dy1]);

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const target = editableSeries ? series.find((i) => i.id === editableSeries.id) : series.find((i) => !i.decorative);
    if (!target) return;
    const count = Math.min(target.x.length, target.y.length);
    if (count === 0) return;
    let idx = Math.min(keyIndex, count - 1);
    if (event.key === 'ArrowLeft') idx = Math.max(0, idx - 1);
    else if (event.key === 'ArrowRight') idx = Math.min(count - 1, idx + 1);
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && editableSeries) {
      const min = editableSeries.min ?? dy0, max = editableSeries.max ?? dy1;
      const next = Array.from(target.y);
      next[idx] = Math.min(max, Math.max(min, next[idx] + (event.key === 'ArrowUp' ? 1 : -1) * (max - min) / 50));
      editableSeries.onChange(next);
      editableSeries.onCommit?.(next);
    } else return;
    setKeyIndex(idx);
    setCursor({ px: sx(target.x[idx]), x: target.x[idx] });
    event.preventDefault();
  };

  const xSymbol = xLabel.split(' ')[0];

  return (
    <div className="plot" ref={ref}>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        tabIndex={0}
        className={editableSeries ? 'editable' : zoomable ? 'zoomable' : undefined}
        aria-label={ariaLabel ?? `${yLabel} against ${xLabel}. Arrow keys inspect values${editableSeries ? '; up and down arrows edit' : ''}.`}
        onKeyDown={onKeyDown}
        onMouseMove={(e) => {
          if (draggedMarkerId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) * (width / rect.width) - MARGIN.left;
          if (px < 0 || px > iw) { setCursor(null); return; }
          setCursor({ px, x: invX(px) });
        }}
        onMouseLeave={() => { if (!draggedMarkerId) setCursor(null); }}
        onDoubleClick={zoomable ? () => setZoom(null) : undefined}
        onPointerDown={!editableSeries && zoomable ? (e) => {
          if (draggedMarkerId || (e.target as Element).closest('.plot-marker') || e.button !== 0) return;
          panStart.current = { startX: e.clientX, startY: e.clientY, x: [dx0, dx1], y: [dy0, dy1] };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add('panning');
        } : editableSeries ? (e) => {
          if (draggedMarkerId) return;
          lastPaint.current = null;
          painted.current = null;
          e.currentTarget.setPointerCapture(e.pointerId);
          paintAt(e.clientX, e.clientY, e.currentTarget);
        } : undefined}
        onPointerMove={!editableSeries && zoomable ? (e) => {
          const st = panStart.current;
          if (!st || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const fx = ((e.clientX - st.startX) * (width / rect.width)) / iw;
          const fy = ((e.clientY - st.startY) * (height / rect.height)) / ih;
          const shift = (r: [number, number], log: boolean, f: number): [number, number] => {
            const a = toU(r[0], log), b = toU(r[1], log), d = f * (b - a);
            return [fromU(a - d, log), fromU(b - d, log)];
          };
          setZoom({ x: shift(st.x, xScale === 'log', fx), y: shift(st.y, yScale === 'log', -fy) });
        } : editableSeries ? (e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) paintAt(e.clientX, e.clientY, e.currentTarget);
        } : undefined}
        onPointerUp={!editableSeries && zoomable ? (e) => {
          panStart.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.classList.remove('panning');
        } : editableSeries ? (e) => {
          const committed = painted.current;
          lastPaint.current = null;
          painted.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (committed) editableSeries.onCommit?.(committed);
        } : undefined}
      >
        <defs>
          <clipPath id={`clip-${iw}-${ih}`}>
            <rect x={-2} y={-2} width={iw + 4} height={ih + 4} />
          </clipPath>
        </defs>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {xTicks.map((t) => <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={0} y2={ih} style={{ stroke: 'var(--grid)' }} />)}
          {yTicks.map((t) => <line key={`gy${t}`} x1={0} x2={iw} y1={sy(t)} y2={sy(t)} style={{ stroke: 'var(--grid)' }} />)}

          <g clipPath={`url(#clip-${iw}-${ih})`}>
            {series.map((s, i) => s.kind === 'points' ? (
              <g key={s.id} style={{ fill: s.color }} opacity={s.opacity ?? 0.9}>
                {Array.from({ length: Math.min(s.x.length, s.y.length) }, (_, j) => {
                  const xv = s.x[j], yv = s.y[j];
                  if (!Number.isFinite(xv) || !Number.isFinite(yv)) return null;
                  if ((xScale === 'log' && !(xv > 0)) || (yScale === 'log' && !(yv > 0))) return null;
                  return <circle key={j} cx={sx(xv)} cy={sy(yv)} r={1.9} />;
                })}
              </g>
            ) : (
              <path key={s.id} d={paths[i]} fill="none"
                style={{ stroke: s.color }}
                strokeWidth={s.width ?? 1.8} opacity={s.opacity ?? 1}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {markers.map((m, mi) => {
              const isDragging = draggedMarkerId === m.id;
              if (m.axis === 'x') {
                const X = sx(m.value);
                const xBefore = markers.slice(0, mi).filter((o) => o.axis === 'x').length;
                const labelY = 12 + 13 * xBefore;
                const isRightEdge = X > iw - 50;
                return (
                  <g
                    key={m.id}
                    className={`plot-marker ${m.draggable ? 'mark-draggable' : ''} ${isDragging ? 'dragging' : ''}`}
                    tabIndex={m.draggable ? 0 : undefined}
                    role={m.draggable ? 'slider' : undefined}
                    aria-label={m.label ?? m.id}
                    aria-valuenow={m.value}
                    aria-valuemin={m.min}
                    aria-valuemax={m.max}
                    onPointerDown={m.draggable ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                      setDraggedMarkerId(m.id);
                    } : undefined}
                    onPointerMove={m.draggable ? (e) => {
                      if (draggedMarkerId !== m.id && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const svg = svgRef.current;
                      if (!svg) return;
                      const rect = svg.getBoundingClientRect();
                      const scaleX = rect.width > 0 ? width / rect.width : 1;
                      const px = Math.min(iw, Math.max(0, (e.clientX - rect.left) * scaleX - MARGIN.left));
                      let val = invX(px);
                      if (m.min != null) val = Math.max(m.min, val);
                      if (m.max != null) val = Math.min(m.max, val);
                      if (m.step != null && m.step > 0) val = Math.round(val / m.step) * m.step;
                      m.onChange?.(val);
                      setCursor({ px: sx(val), x: val });
                    } : undefined}
                    onPointerUp={m.draggable ? (e) => {
                      try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      } catch {}
                      setDraggedMarkerId(null);
                      m.onCommit?.(m.value);
                    } : undefined}
                    onPointerCancel={m.draggable ? (e) => {
                      try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      } catch {}
                      setDraggedMarkerId(null);
                    } : undefined}
                    onKeyDown={m.draggable ? (e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        e.stopPropagation();
                        const step = m.step ?? (dx1 - dx0) / 100;
                        const delta = (e.key === 'ArrowRight' ? 1 : -1) * step;
                        let nextVal = m.value + delta;
                        if (m.min != null) nextVal = Math.max(m.min, nextVal);
                        if (m.max != null) nextVal = Math.min(m.max, nextVal);
                        m.onChange?.(nextVal);
                        m.onCommit?.(nextVal);
                      }
                    } : undefined}
                  >
                    {m.draggable && (
                      <line
                        x1={X} x2={X} y1={0} y2={ih}
                        stroke="transparent"
                        strokeWidth={20}
                        style={{ cursor: 'ew-resize', pointerEvents: 'stroke', touchAction: 'none' }}
                      />
                    )}
                    <line
                      x1={X} x2={X} y1={0} y2={ih}
                      className="mark-line"
                      style={{ stroke: isDragging ? 'var(--accent)' : m.color }}
                      strokeWidth={isDragging ? 1.6 : 1.1}
                      strokeDasharray={m.dashed === false ? undefined : '3 3'}
                    />
                    {m.draggable && (
                      <g className="mark-handle-group" style={{ cursor: 'ew-resize', pointerEvents: 'all' }}>
                        <rect
                          x={X - 5}
                          y={1}
                          width={10}
                          height={14}
                          rx={2}
                          className="mark-handle"
                          style={{
                            fill: isDragging ? 'var(--accent)' : 'var(--panel)',
                            stroke: isDragging ? 'var(--accent)' : 'var(--faint)',
                            strokeWidth: 1.2,
                          }}
                        />
                        <line
                          x1={X - 1.5} x2={X - 1.5} y1={4} y2={12}
                          style={{ stroke: isDragging ? 'var(--panel)' : 'var(--muted)', strokeWidth: 1 }}
                        />
                        <line
                          x1={X + 1.5} x2={X + 1.5} y1={4} y2={12}
                          style={{ stroke: isDragging ? 'var(--panel)' : 'var(--muted)', strokeWidth: 1 }}
                        />
                      </g>
                    )}
                    {m.label && (
                      <text
                        x={isRightEdge ? X - (m.draggable ? 8 : 4) : X + (m.draggable ? 8 : 4)}
                        y={labelY}
                        textAnchor={isRightEdge ? 'end' : 'start'}
                        className="mark-text"
                        style={{
                          fill: isDragging ? 'var(--accent)' : m.color,
                          fontWeight: isDragging ? 600 : undefined,
                          cursor: m.draggable ? 'ew-resize' : undefined,
                        }}
                      >
                        {m.label}
                      </text>
                    )}
                    {m.title && <title>{m.title}</title>}
                  </g>
                );
              }
              const Y = sy(m.value);
              return (
                <g
                  key={m.id}
                  className={`plot-marker ${m.draggable ? 'mark-draggable mark-draggable-y' : ''} ${isDragging ? 'dragging' : ''}`}
                  tabIndex={m.draggable ? 0 : undefined}
                  role={m.draggable ? 'slider' : undefined}
                  aria-label={m.label ?? m.id}
                  aria-valuenow={m.value}
                  aria-valuemin={m.min}
                  aria-valuemax={m.max}
                  onPointerDown={m.draggable ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                    setDraggedMarkerId(m.id);
                  } : undefined}
                  onPointerMove={m.draggable ? (e) => {
                    if (draggedMarkerId !== m.id && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    const svg = svgRef.current;
                    if (!svg) return;
                    const rect = svg.getBoundingClientRect();
                    const scaleY = rect.height > 0 ? height / rect.height : 1;
                    const py = Math.min(ih, Math.max(0, (e.clientY - rect.top) * scaleY - MARGIN.top));
                    let val = invY(py);
                    if (m.min != null) val = Math.max(m.min, val);
                    if (m.max != null) val = Math.min(m.max, val);
                    if (m.step != null && m.step > 0) val = Math.round(val / m.step) * m.step;
                    m.onChange?.(val);
                  } : undefined}
                  onPointerUp={m.draggable ? (e) => {
                    try {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    } catch {}
                    setDraggedMarkerId(null);
                    m.onCommit?.(m.value);
                  } : undefined}
                  onPointerCancel={m.draggable ? (e) => {
                    try {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    } catch {}
                    setDraggedMarkerId(null);
                  } : undefined}
                  onKeyDown={m.draggable ? (e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      e.stopPropagation();
                      const step = m.step ?? (dy1 - dy0) / 100;
                      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step;
                      let nextVal = m.value + delta;
                      if (m.min != null) nextVal = Math.max(m.min, nextVal);
                      if (m.max != null) nextVal = Math.min(m.max, nextVal);
                      m.onChange?.(nextVal);
                      m.onCommit?.(nextVal);
                    }
                  } : undefined}
                >
                  {m.draggable && (
                    <line
                      x1={0} x2={iw} y1={Y} y2={Y}
                      stroke="transparent"
                      strokeWidth={20}
                      style={{ cursor: 'ns-resize', pointerEvents: 'stroke', touchAction: 'none' }}
                    />
                  )}
                  <line
                    x1={0} x2={iw} y1={Y} y2={Y}
                    className="mark-line"
                    style={{ stroke: isDragging ? 'var(--accent)' : m.color }}
                    strokeWidth={isDragging ? 1.6 : 1.1}
                    strokeDasharray={m.dashed === false ? undefined : '3 3'}
                  />
                  {m.draggable && (
                    <g className="mark-handle-group" style={{ cursor: 'ns-resize', pointerEvents: 'all' }}>
                      <rect
                        x={iw - 14}
                        y={Y - 5}
                        width={14}
                        height={10}
                        rx={2}
                        className="mark-handle"
                        style={{
                          fill: isDragging ? 'var(--accent)' : 'var(--panel)',
                          stroke: isDragging ? 'var(--accent)' : 'var(--faint)',
                          strokeWidth: 1.2,
                        }}
                      />
                      <line
                        x1={iw - 11} x2={iw - 3} y1={Y - 1.5} y2={Y - 1.5}
                        style={{ stroke: isDragging ? 'var(--panel)' : 'var(--muted)', strokeWidth: 1 }}
                      />
                      <line
                        x1={iw - 11} x2={iw - 3} y1={Y + 1.5} y2={Y + 1.5}
                        style={{ stroke: isDragging ? 'var(--panel)' : 'var(--muted)', strokeWidth: 1 }}
                      />
                    </g>
                  )}
                  {m.label && (
                    <text
                      x={m.draggable ? iw - 18 : iw - 4}
                      y={Y - 4}
                      textAnchor="end"
                      className="mark-text"
                      style={{
                        fill: isDragging ? 'var(--accent)' : m.color,
                        fontWeight: isDragging ? 600 : undefined,
                        cursor: m.draggable ? 'ns-resize' : undefined,
                      }}
                    >
                      {m.label}
                    </text>
                  )}
                  {m.title && <title>{m.title}</title>}
                </g>
              );
            })}

            {points.map((p) => {
              const X = sx(p.x), Y = sy(p.y);
              return p.shape === 'dot' ? (
                <circle key={p.id} cx={X} cy={Y} r={4} style={{ fill: p.color, stroke: 'var(--panel)' }} strokeWidth={1.5}>
                  {p.title && <title>{p.title}</title>}
                </circle>
              ) : (
                <g key={p.id} style={{ stroke: p.color }} strokeWidth={2.2} strokeLinecap="round">
                  <line x1={X - 5} x2={X + 5} y1={Y - 5} y2={Y + 5} />
                  <line x1={X - 5} x2={X + 5} y1={Y + 5} y2={Y - 5} />
                  {p.title && <title>{p.title}</title>}
                </g>
              );
            })}
          </g>

          {cursor && <line x1={cursor.px} x2={cursor.px} y1={0} y2={ih} style={{ stroke: 'var(--faint)' }} />}
          {cursor && readout?.map(({ s, x, y }) => (
            (yScale !== 'log' || y > 0) && (
              <circle key={s.id} cx={sx(x)} cy={sy(y)} r={3} style={{ fill: s.color, stroke: 'var(--panel)' }} strokeWidth={1} />
            )
          ))}

          <line x1={0} x2={iw} y1={ih} y2={ih} style={{ stroke: 'var(--faint)' }} />
          <line x1={0} x2={0} y1={0} y2={ih} style={{ stroke: 'var(--faint)' }} />
          {xTicks.map((t) => (
            <text key={`tx${t}`} x={sx(t)} y={ih + 15} textAnchor="middle" className="axis-text">{fmtTick(t, xScale === 'log')}</text>
          ))}
          {yTicks.map((t) => (
            <text key={`ty${t}`} x={-7} y={sy(t) + 3.5} textAnchor="end" className="axis-text">{fmtTick(t, yScale === 'log')}</text>
          ))}
          <text x={iw / 2} y={ih + 32} textAnchor="middle" className="axis-title">{xLabel}</text>
          <text transform={`translate(${-MARGIN.left + 13},${ih / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{yLabel}</text>
        </g>
      </svg>
      {zoomable && (
        <div className="plot-zoom" role="group" aria-label="Zoom">
          <button type="button" className="btn icon" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(0.7, 0.5, 0.5, 'both')}>+</button>
          <button type="button" className="btn icon" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 0.7, 0.5, 0.5, 'both')}>−</button>
          <button type="button" className="btn icon" title="Show all (or double-click the plot)" aria-label="Reset zoom" disabled={!zoom} onClick={() => setZoom(null)}>Reset</button>
        </div>
      )}
      <div className="readout" role="status" aria-live="polite" style={{ visibility: cursor && readout?.length ? 'visible' : 'hidden' }}>
        {xSymbol} = {formatX(cursor?.x ?? 0)}
        {(readout ?? []).map(({ s, y }) => <span key={s.id} style={{ color: s.color }}>{'   '}{formatY(y)}</span>)}
      </div>
    </div>
  );
}
