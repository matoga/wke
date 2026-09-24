/**
 * One-click export of every view of the peak-momentum panel: each view as a
 * standalone SVG and a PNG, plus the plotted data as CSV, in a single ZIP.
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Plot } from './Plot';
import type { PlotProps } from './Plot';
import { kpView } from './KpCompareCard';
import type { KpViewOptions } from './KpCompareCard';
import { MODEL_BY_ID } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { RunRecord } from '../state/useRunLibrary';
import { modelColor, modelDashed, runLabel } from '../ui/runView';

const WIDTH = 900;
const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style'] as const;

interface FigureSpec {
  name: string;
  title: string;
  view: Pick<KpViewOptions, 'yMode' | 'rateScale' | 'xChoice'>;
}

const FIGURES: FigureSpec[] = [
  { name: 'kp-ratio-vs-t', title: 'Peak momentum kₚ/kₚ,₀ against time', view: { yMode: 'ratio', rateScale: 'log', xChoice: 'linear' } },
  { name: 'kp-ratio-vs-log-t', title: 'Peak momentum kₚ/kₚ,₀ against time (log t)', view: { yMode: 'ratio', rateScale: 'log', xChoice: 'log' } },
  { name: 'kp-vs-t', title: 'Peak momentum kₚ against time', view: { yMode: 'abs', rateScale: 'log', xChoice: 'linear' } },
  { name: 'inv-kp2-vs-t', title: '1/kₚ² against time', view: { yMode: 'invk2', rateScale: 'log', xChoice: 'linear' } },
  { name: 'rate-lin', title: 'd(1/kₚ²)/dt against 1/(ξkₚ)² (lin-lin)', view: { yMode: 'rate', rateScale: 'linear', xChoice: null } },
  { name: 'rate-log', title: 'd(1/kₚ²)/dt against 1/(ξkₚ)² (log-log)', view: { yMode: 'rate', rateScale: 'log', xChoice: null } },
];

export async function exportKpFigures(o: Omit<KpViewOptions, 'yMode' | 'rateScale' | 'xChoice' | 'selectedKey'>): Promise<void> {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const enc = new TextEncoder();
  const figures = FIGURES.filter((f) => f.view.yMode !== 'rate' || o.hbarOverM_um2_per_s != null);
  // Figures are drawn in the light theme whatever the page shows. Rendering and serialising run synchronously,
  // so the page never paints in the temporary theme.
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  const svgs: Array<{ name: string; svg: string; w: number; h: number }> = [];
  try {
    for (const f of figures) {
      const view = kpView({ ...o, ...f.view, selectedKey: null });
      const markers: PlotProps['markers'] = view.rate ? [] : [{ id: 'stop', axis: 'y', value: view.targetY, label: 'target', color: 'var(--faint)' }];
      const legend = o.records.map((rec) => ({
        label: runLabel(rec.result), color: modelColor(rec.result.model), dashed: modelDashed(rec.result.model, rec.result.kernel),
      }));
      if (view.hasGuide) legend.push({ label: `guide: ${o.guideSlope.toPrecision(2)} ħ/m`, color: 'var(--faint)', dashed: true });
      svgs.push({ name: f.name, ...renderSvg({ ...view.plot, markers, maxHeight: WIDTH / 2 }, f.title, legend) });
    }
  } finally {
    if (theme == null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }
  for (const s of svgs) {
    files.push({ name: `${s.name}.svg`, data: enc.encode(s.svg) });
    const png = await rasterise(s.svg, s.w, s.h, 2);
    if (png) files.push({ name: `${s.name}.png`, data: png });
  }
  files.push({ name: 'peak-momentum.csv', data: enc.encode(dataCsv(o.records, o.guideSlope, o.hbarOverM_um2_per_s)) });
  const zip = makeZip(files);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'peak-momentum-plots.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Renders a Plot offscreen and returns it as a self-contained SVG, with a title and a legend. */
function renderSvg(props: PlotProps, title: string, legend: Array<{ label: string; color: string; dashed: boolean }>) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${WIDTH}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(host);
  const reactRoot = createRoot(host);
  try {
    flushSync(() => reactRoot.render(<Plot {...props} />));
    const live = host.querySelector('svg')!;
    const out = live.cloneNode(true) as SVGSVGElement;
    // Inline the computed styles, so the file does not depend on the page's stylesheet or theme tokens.
    const src = live.querySelectorAll('*');
    const dst = out.querySelectorAll('*');
    src.forEach((el, i) => {
      const d = dst[i] as SVGElement;
      d.removeAttribute('class');
      d.removeAttribute('style');
      if (el.closest('defs')) return;
      const cs = getComputedStyle(el);
      for (const p of STYLE_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) d.setAttribute(p, v);
      }
    });
    const vb = live.viewBox.baseVal;
    const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#ffffff';
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#16202c';
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#5b6878';
    const font = getComputedStyle(document.body).fontFamily;

    // Legend rows below the plot, wrapped at the plot width.
    const TOP = 30, ROW = 18, PAD = 14;
    const items: Array<{ x: number; row: number }> = [];
    let x = 58, row = 0;
    for (const it of legend) {
      const w = 30 + 6.6 * it.label.length + 18;
      if (x + w > vb.width - 10 && x > 58) { x = 58; row++; }
      items.push({ x, row });
      x += w;
    }
    const legendH = legend.length ? (row + 1) * ROW + 6 : 0;
    const W = vb.width, H = TOP + vb.height + legendH + PAD;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('font-family', font);
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', String(W));
    bg.setAttribute('height', String(H));
    bg.setAttribute('fill', panel);
    svg.appendChild(bg);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '58');
    t.setAttribute('y', '20');
    t.setAttribute('fill', ink);
    t.setAttribute('font-size', '14');
    t.setAttribute('font-weight', '600');
    t.textContent = title;
    svg.appendChild(t);
    const plot = document.createElementNS(SVG_NS, 'g');
    plot.setAttribute('transform', `translate(0,${TOP})`);
    for (const child of Array.from(out.childNodes)) plot.appendChild(child);
    svg.appendChild(plot);
    legend.forEach((it, i) => {
      const { x: lx, row: r } = items[i];
      const y = TOP + vb.height + 8 + r * ROW + ROW / 2;
      const color = resolveColor(it.color, host);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(lx));
      line.setAttribute('x2', String(lx + 24));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      if (it.dashed) line.setAttribute('stroke-dasharray', '5 4');
      svg.appendChild(line);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(lx + 30));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('fill', muted);
      label.setAttribute('font-size', '11.5');
      label.textContent = it.label;
      svg.appendChild(label);
    });
    return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`, w: W, h: H };
  } finally {
    reactRoot.unmount();
    host.remove();
  }
}

function resolveColor(color: string, host: HTMLElement): string {
  if (!color.startsWith('var(')) return color;
  const probe = document.createElement('span');
  probe.style.color = color;
  host.appendChild(probe);
  const v = getComputedStyle(probe).color;
  probe.remove();
  return v;
}

async function rasterise(svg: string, w: number, h: number, scale: number): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function dataCsv(records: RunRecord[], guideSlope: number, hbarOverM: number | null): string {
  const lines = [
    '# peak momentum of every run on this setup; rate = d(1/k_p^2)/dt by centred differences, in units of hbar/m',
    `# guide slope: ${guideSlope} hbar/m${hbarOverM != null ? ` = ${guideSlope * hbarOverM} um^2/s (hbar/m = ${hbarOverM} um^2/s)` : ''}`,
    'model,accuracy,t_s,k_p_um_inv,k_p_over_k_p0,inv_k_p2_um2,loop_parameter_kxi_over_kp_sq,rate_hbar_over_m',
  ];
  for (const rec of records) {
    const r = rec.result;
    const name = `${MODEL_BY_ID[r.model].label}${r.kernel === 'quantum' ? ' Bose +1' : ''}`.replace(/,/g, ';');
    const kXi = 1 / r.scales.xi_um;
    const ts = r.kpTrack.t_s, kps = r.kpTrack.kp;
    // Same differences as the plotted rate, aligned to their step.
    const rate = new Array<number | null>(ts.length).fill(null);
    if (hbarOverM != null) {
      for (let i = 1; i < ts.length - 1; i++) {
        const dt = ts[i + 1] - ts[i - 1];
        if (dt > 0) rate[i] = (1 / (kps[i + 1] ** 2) - 1 / (kps[i - 1] ** 2)) / dt / hbarOverM;
      }
    }
    for (let i = 0; i < ts.length; i++) {
      const row = [ts[i], kps[i], kps[i] / r.kp0_um_inv, 1 / (kps[i] * kps[i]), (kXi / kps[i]) ** 2, rate[i]];
      lines.push([name, PRECISION[r.accuracy].label, ...row.map((v) => (v == null ? '' : v.toPrecision(9)))].join(','));
    }
  }
  return lines.join('\n');
}

// Minimal ZIP writer (stored entries, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}
