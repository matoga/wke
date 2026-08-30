/**
 * Freehand N_k(k) editor. A fixed number of knots span a linear k axis; drag
 * (mouse or touch) paints their heights, with values interpolated along the
 * gesture so a fast swipe still produces a smooth curve.
 */

import React, { useCallback, useRef, useState } from 'react';

const MARGIN = { top: 8, right: 10, bottom: 26, left: 34 };

export function DrawCanvas({
  values, onChange, kMax, height = 220, xScale = 'linear', yScale = 'linear', xMin = 0.005, yFloor = 1e-4,
}: {
  /** knot heights in [0, 1], evenly spaced from 0 to kMax */
  values: number[];
  onChange: (next: number[]) => void;
  kMax: number;
  height?: number;
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xMin?: number;
  yFloor?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const dragging = useRef(false);
  const last = useRef<{ i: number; v: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 480);
    return () => ro.disconnect();
  }, []);

  const iw = Math.max(40, width - MARGIN.left - MARGIN.right);
  const ih = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const n = values.length;

  const sx = (i: number) => {
    const k = Math.max(xMin, (i / (n - 1)) * kMax);
    return xScale === 'log'
      ? ((Math.log(k) - Math.log(xMin)) / (Math.log(kMax) - Math.log(xMin))) * iw
      : (i / (n - 1)) * iw;
  };
  const sy = (v: number) => yScale === 'log'
    ? ih - ((Math.log(Math.max(yFloor, v)) - Math.log(yFloor)) / -Math.log(yFloor)) * ih
    : ih - v * ih;

  const paintAt = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const x = clientX - rect.left - MARGIN.left;
    const y = clientY - rect.top - MARGIN.top;
    const xFraction = Math.min(1, Math.max(0, x / iw));
    const k = xScale === 'log'
      ? Math.exp(Math.log(xMin) + xFraction * (Math.log(kMax) - Math.log(xMin)))
      : xFraction * kMax;
    const i = Math.round((k / kMax) * (n - 1));
    const yFraction = Math.min(1, Math.max(0, 1 - y / ih));
    const v = yScale === 'log'
      ? Math.exp(Math.log(yFloor) + yFraction * -Math.log(yFloor))
      : yFraction;
    if (i < 0 || i >= n) return;

    const next = values.slice();
    if (last.current && last.current.i !== i) {
      // interpolate between the last painted knot and this one so a fast
      // swipe does not leave gaps
      const { i: i0, v: v0 } = last.current;
      const lo = Math.min(i0, i), hi = Math.max(i0, i);
      for (let k = lo; k <= hi; k++) {
        const t = hi === lo ? 1 : (k - i0) / (i - i0);
        next[k] = v0 + t * (v - v0);
      }
    } else {
      next[i] = v;
    }
    last.current = { i, v };
    onChange(next);
  }, [values, onChange, iw, ih, n]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      dragging.current = true;
      last.current = null;
      (e.target as Element).setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging.current) return;
      paintAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    onPointerUp: () => { dragging.current = false; last.current = null; },
    onPointerLeave: () => { dragging.current = false; last.current = null; },
  };

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join('');

  const kTicks = xScale === 'log'
    ? [xMin, 0.01, 0.05, 0.2, 1, kMax].filter((k) => k >= xMin && k <= kMax)
    : [0, 0.25, 0.5, 0.75, 1].map((f) => f * kMax);

  return (
    <div ref={ref}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="touch-none cursor-crosshair select-none text-slate-300 dark:text-slate-700"
        role="application"
        tabIndex={0}
        aria-label="Spectrum editor. Use left and right arrow keys to select k; use up and down arrows to change amplitude."
        onFocus={() => setKeyboardFocused(true)}
        onBlur={() => setKeyboardFocused(false)}
        onKeyDown={(event) => {
          let nextIndex = keyboardIndex;
          if (event.key === 'ArrowLeft') nextIndex = Math.max(0, keyboardIndex - 1);
          else if (event.key === 'ArrowRight') nextIndex = Math.min(n - 1, keyboardIndex + 1);
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const next = values.slice();
            const step = yScale === 'log' ? Math.max(yFloor, next[keyboardIndex]) * 0.15 : 0.025;
            next[keyboardIndex] = Math.min(1, Math.max(0,
              next[keyboardIndex] + (event.key === 'ArrowUp' ? step : -step)));
            onChange(next);
          } else return;
          setKeyboardIndex(nextIndex);
          event.preventDefault();
        }}
        {...handlers}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <rect x={0} y={0} width={iw} height={ih} fill="currentColor" opacity={0.06} rx={6} />
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={iw} y1={ih * f} y2={ih * f} stroke="currentColor" strokeWidth={0.5} />
          ))}
          <path d={path} fill="none" stroke="var(--draw-stroke, #0c8ee0)" strokeWidth={2}
            className="text-accent-600 dark:text-accent-400" style={{ stroke: 'currentColor' }} />
          <path d={`${path} L${iw} ${ih} L0 ${ih} Z`} fill="currentColor" opacity={0.12}
            className="text-accent-600 dark:text-accent-400" />
          {keyboardFocused && (
            <circle cx={sx(keyboardIndex)} cy={sy(values[keyboardIndex])} r={4}
              className="fill-accent-600 dark:fill-accent-400" stroke="white" strokeWidth={1.5} />
          )}
          <rect x={0} y={0} width={iw} height={ih} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.4} />
          {kTicks.map((t) => (
            <text key={t} x={xScale === 'log'
              ? ((Math.log(t) - Math.log(xMin)) / (Math.log(kMax) - Math.log(xMin))) * iw
              : (t / kMax) * iw} y={ih + 14} textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9.5 }}>
              {xScale === 'log' ? t.toPrecision(1) : t.toFixed(1)}
            </text>
          ))}
          <text x={iw / 2} y={ih + 24} textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10 }}>
            k (μm⁻¹)
          </text>
        </g>
      </svg>
    </div>
  );
}
