/**
 * Operational 2D calibration map: na(k_p, Δt₁ᐟ₂) for C_shape = 1, with the
 * user's point overlaid and a toggle for the shape-corrected √C_shape shift.
 *
 *   na(k_p, Δt) = k_p √(κ C / Δt)
 *
 * Contours of constant na are straight lines through the origin in
 * (log Δt, log k_p), so the field is drawn on a canvas and the iso-na contours
 * are drawn analytically on top.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, SegmentedControl, Badge, Metric } from '../ui/primitives';
import { COLORS, expo, seconds } from '../ui/theme';
import { CALIBRATION, naContour } from '../physics/calibration';
import type { SpectralDescriptors } from '../physics/descriptors';

const KP_LO = 0.8, KP_HI = 4.2;
const DT_LO = 0.02, DT_HI = 5.0;
const PAD = { top: 10, right: 14, bottom: 34, left: 56 };

type View = 'reference' | 'corrected';

export function CalibrationMapCard({
  desc, na_um2, dt_half_s,
}: {
  desc: SpectralDescriptors | null;
  na_um2: number | null;
  dt_half_s: number | null;
}) {
  const [view, setView] = useState<View>('reference');
  const [dark, setDark] = useState(false);
  const [size, setSize] = useState({ w: 560, h: 300 });
  const [hover, setHover] = useState<{ kp: number; dt: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cShape = view === 'corrected' && desc ? desc.c_shape : 1;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
      if (w) setSize({ w, h: Math.max(240, Math.min(340, w * 0.55)) });
    });
    ro.observe(el);
    const mo = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark')));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setDark(document.documentElement.classList.contains('dark'));
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  const iw = size.w - PAD.left - PAD.right;
  const ih = size.h - PAD.top - PAD.bottom;

  const sx = (dt: number) => (Math.log(dt / DT_LO) / Math.log(DT_HI / DT_LO)) * iw;
  const sy = (kp: number) => ih - (Math.log(kp / KP_LO) / Math.log(KP_HI / KP_LO)) * ih;
  const invX = (px: number) => DT_LO * Math.pow(DT_HI / DT_LO, px / iw);
  const invY = (py: number) => KP_LO * Math.pow(KP_HI / KP_LO, (ih - py) / ih);

  // na range across the panel, for the colour ramp
  const [naMin, naMax] = useMemo(() => {
    const lo = naContour(KP_LO, DT_HI) * Math.sqrt(cShape);
    const hi = naContour(KP_HI, DT_LO) * Math.sqrt(cShape);
    return [lo, hi];
  }, [cShape]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || iw <= 0 || ih <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(iw * dpr);
    cv.height = Math.round(ih * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(cv.width, cv.height);
    const lgMin = Math.log(naMin), lgMax = Math.log(naMax);
    for (let py = 0; py < cv.height; py++) {
      const kp = invY(py / dpr);
      for (let px = 0; px < cv.width; px++) {
        const dt = invX(px / dpr);
        const na = naContour(kp, dt) * Math.sqrt(cShape);
        const t = Math.min(1, Math.max(0, (Math.log(na) - lgMin) / (lgMax - lgMin)));
        // perceptually even blue→amber ramp, muted in both themes
        const r = Math.round(dark ? 20 + 200 * t : 245 - 40 * t);
        const g = Math.round(dark ? 40 + 130 * t : 250 - 90 * t);
        const b = Math.round(dark ? 90 - 40 * t : 255 - 200 * t);
        const o = (py * cv.width + px) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [iw, ih, naMin, naMax, cShape, dark]);

  // iso-na contours: kp = na / √(κ C / Δt)
  const contours = useMemo(() => {
    const levels: number[] = [];
    const e0 = Math.floor(Math.log10(naMin));
    const e1 = Math.ceil(Math.log10(naMax));
    for (let e = e0; e <= e1; e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v > naMin && v < naMax) levels.push(v);
      }
    }
    return levels.map((na) => {
      const pts: string[] = [];
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const dt = DT_LO * Math.pow(DT_HI / DT_LO, i / n);
        const kp = na / Math.sqrt((CALIBRATION.kappa_s_um2 * cShape) / dt);
        if (kp < KP_LO || kp > KP_HI) continue;
        pts.push(`${sx(dt).toFixed(1)},${sy(kp).toFixed(1)}`);
      }
      return { na, pts };
    }).filter((c) => c.pts.length > 1);
  }, [naMin, naMax, cShape, iw, ih]);

  const hasPoint = desc != null && dt_half_s != null && dt_half_s > 0;
  const px = hasPoint ? sx(Math.min(Math.max(dt_half_s!, DT_LO), DT_HI)) : 0;
  const py = hasPoint ? sy(Math.min(Math.max(desc!.kp0_um_inv, KP_LO), KP_HI)) : 0;

  const dtTicks = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
  const kpTicks = [1, 1.5, 2, 2.5, 3, 3.5, 4];

  return (
    <Card
      title="Calibration map"
      actions={
        <SegmentedControl
          size="xs"
          value={view}
          onChange={setView}
          options={[
            { id: 'reference', label: 'C = 1' },
            { id: 'corrected', label: '√C_shape', disabled: !desc },
          ]}
        />
      }
    >
      <div ref={boxRef} className="space-y-2">
        <div className="relative" style={{ height: size.h }}>
          <canvas
            ref={canvasRef}
            className="absolute rounded-sm"
            style={{ left: PAD.left, top: PAD.top, width: iw, height: ih }}
          />
          <svg
            className="absolute inset-0 text-slate-400 dark:text-slate-600"
            width={size.w}
            height={size.h}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - r.left - PAD.left;
              const y = e.clientY - r.top - PAD.top;
              if (x < 0 || x > iw || y < 0 || y > ih) { setHover(null); return; }
              setHover({ kp: invY(y), dt: invX(x) });
            }}
            onMouseLeave={() => setHover(null)}
          >
            <g transform={`translate(${PAD.left},${PAD.top})`}>
              {/* certified k_p band */}
              <rect
                x={0}
                y={sy(CALIBRATION.kp_max)}
                width={iw}
                height={sy(CALIBRATION.kp_min) - sy(CALIBRATION.kp_max)}
                fill="none"
                stroke={COLORS.band}
                strokeWidth={1.2}
                strokeDasharray="5 3"
              />
              <text x={4} y={sy(CALIBRATION.kp_max) - 4} fill={COLORS.band} style={{ fontSize: 9 }}>
                certified k_p range
              </text>

              {contours.map((c) => (
                <g key={c.na}>
                  <polyline
                    points={c.pts.join(' ')}
                    fill="none"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={1}
                  />
                  <text
                    x={c.pts[c.pts.length - 1].split(',')[0]}
                    y={Number(c.pts[c.pts.length - 1].split(',')[1]) - 3}
                    textAnchor="end"
                    fill="rgba(255,255,255,0.85)"
                    style={{ fontSize: 8.5 }}
                  >
                    {c.na.toExponential(0)}
                  </text>
                </g>
              ))}

              {hasPoint && (
                <g>
                  <circle cx={px} cy={py} r={6} fill="none" stroke="#fff" strokeWidth={2.5} />
                  <circle cx={px} cy={py} r={6} fill="none" stroke={COLORS.measured} strokeWidth={1.6} />
                  <circle cx={px} cy={py} r={1.8} fill={COLORS.measured} />
                  <text x={px + 10} y={py + 3} fill={COLORS.measured} style={{ fontSize: 9.5 }}
                    stroke="rgba(255,255,255,0.6)" strokeWidth={2.5} paintOrder="stroke">
                    your spectrum
                  </text>
                </g>
              )}

              <rect x={0} y={0} width={iw} height={ih} fill="none" stroke="currentColor" strokeWidth={1} />

              {dtTicks.map((t) => (
                <text key={t} x={sx(t)} y={ih + 13} textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9.5 }}>
                  {t < 1 ? t.toFixed(2).replace(/0$/, '') : t}
                </text>
              ))}
              {kpTicks.map((t) => (
                <text key={t} x={-6} y={sy(t) + 3} textAnchor="end"
                  className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9.5 }}>
                  {t}
                </text>
              ))}
              <text x={iw / 2} y={ih + 28} textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10 }}>
                Δt₁ᐟ₂ (s)
              </text>
              <text transform={`translate(${-PAD.left + 12},${ih / 2}) rotate(-90)`} textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10 }}>
                k_p,0 (μm⁻¹)
              </text>
            </g>
          </svg>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <div>
            <Metric label="cursor k_p" value={hover ? hover.kp.toFixed(3) : '-'} unit="μm⁻¹" />
            <Metric label="cursor Δt₁ᐟ₂" value={hover ? seconds(hover.dt) : '-'} />
            <Metric
              label={view === 'corrected' ? 'cursor na (shape-corrected)' : 'cursor na (C = 1)'}
              value={hover ? expo(naContour(hover.kp, hover.dt) * Math.sqrt(cShape)) : '-'}
              unit="μm⁻²"
            />
          </div>
          <div>
            <Metric label="your k_p,0" value={desc ? desc.kp0_um_inv.toFixed(4) : '-'} unit="μm⁻¹" />
            <Metric label="your Δt₁ᐟ₂" value={seconds(dt_half_s)} />
            <Metric label="your na" value={na_um2 != null ? expo(na_um2) : '-'} unit="μm⁻²" emphasis />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {desc && (
            desc.domainStatus === 'inside'
              ? <Badge tone="success">point inside certified k_p range</Badge>
              : <Badge tone="warning">point outside certified domain</Badge>
          )}
          <span className="text-2xs text-slate-500 dark:text-slate-400">
            White curves are iso-na contours, labelled in μm⁻².
          </span>
        </div>
      </div>
    </Card>
  );
}
