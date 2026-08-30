/**
 * Initial state: spectrum import (presets, paste, drag/drop, file picker) and
 * the descriptors extracted from it, in one panel — the import controls and the
 * numbers they produce belong together.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Card, Field, SegmentedControl, Badge, Callout, Metric } from '../ui/primitives';
import { Plot } from './Plot';
import { COLORS, sig, expo } from '../ui/theme';
import { applyNorm } from '../ui/norm';
import type { NormSpec } from '../ui/norm';
import { PRESETS, presetToCsv } from '../physics/presets';
import { CONVENTIONS, SpectrumParseError, prepareFromText, prepareSpectrum } from '../physics/spectrum';
import type { PreparedSpectrum, SpectrumConvention } from '../physics/spectrum';
import { MathBlock } from './MathBlock';
import { spectralExtent } from '../physics/descriptors';
import { interpolateQ } from '../physics/grid';
import type { SpectralDescriptors } from '../physics/descriptors';

type Source = 'preset' | 'data' | 'draw';
const DRAW_KNOTS = 192;
const DRAW_K_LIMIT = 5.3;

export function InitialStateCard({
  spectrum, desc, norm, onSpectrum, presetKey, onPresetKey, onDraftChange,
}: {
  spectrum: PreparedSpectrum | null;
  desc: SpectralDescriptors | null;
  norm: NormSpec;
  onSpectrum: (s: PreparedSpectrum, presetKey: string | null) => void;
  presetKey: string | null;
  onPresetKey: (k: string) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [source, setSource] = useState<Source>('preset');
  const [convention, setConvention] = useState<SpectrumConvention>('Nk_over_N');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const [drawValues, setDrawValues] = useState<number[]>(() => new Array(DRAW_KNOTS).fill(0));
  const [drawKMax, setDrawKMax] = useState(3.7);
  const [drawDirty, setDrawDirty] = useState(false);
  const drawK = Array.from({ length: DRAW_KNOTS }, (_, index) => (index / (DRAW_KNOTS - 1)) * drawKMax);

  useEffect(() => onDraftChange?.(drawDirty), [drawDirty, onDraftChange]);

  const ingest = useCallback((raw: string, label: string, src: 'paste' | 'file') => {
    try {
      const prepared = prepareFromText(raw, convention, label, src);
      setError(null);
      onSpectrum(prepared, null);
    } catch (e) {
      setError(e instanceof SpectrumParseError ? e.message : String(e));
    }
  }, [convention, onSpectrum]);

  const loadPreset = (key: string) => {
    onPresetKey(key);
    const preset = PRESETS.find((p) => p.key === key);
    if (preset) { setError(null); onSpectrum(preset.load(), key); }
  };

  const chooseSource = (next: Source) => {
    if (next !== 'draw') setDrawDirty(false);
    if (next === 'draw' && spectrum) {
      const nextKMax = Math.min(DRAW_K_LIMIT, spectralExtent(spectrum.k, spectrum.q));
      const nextK = Array.from({ length: DRAW_KNOTS }, (_, index) => (index / (DRAW_KNOTS - 1)) * nextKMax);
      const sampled = interpolateQ(
        Array.from(spectrum.k),
        Array.from(spectrum.q),
        Float64Array.from(nextK),
        { lower: 'constant' },
      );
      const peak = Math.max(...sampled, 1e-30);
      setDrawValues(Array.from(sampled, (value) => Math.max(0, value / peak)));
      setDrawKMax(nextKMax);
      setDrawDirty(false);
    }
    setSource(next);
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    file.text().then((t) => {
      setFileName(file.name);
      setText(t.length < 200_000 ? t : '');
      ingest(t, file.name, 'file');
    });
  };

  const applyDrawnShape = useCallback((values: number[], kMax = drawKMax) => {
    const k: number[] = [];
    for (let i = 0; i < DRAW_KNOTS; i++) k.push((i / (DRAW_KNOTS - 1)) * kMax || 1e-3);
    try {
      const prepared = prepareSpectrum({
        k_um_inv: k,
        values,
        convention: 'Nk_over_N',
        label: 'Hand-drawn spectrum',
        source: 'paste',
        warnings: [],
      });
      setError(null);
      onSpectrum(prepared, null);
      setDrawDirty(false);
    } catch (e) {
      setError(e instanceof SpectrumParseError ? e.message : String(e));
    }
  }, [drawKMax, onSpectrum]);

  const reshape = (kind: 'smooth' | 'sharpen') => {
    if (!spectrum) return;
    let targetKMax = drawKMax;
    const sampled = source === 'draw'
      ? drawValues.slice()
      : (() => {
          targetKMax = Math.min(DRAW_K_LIMIT, spectralExtent(spectrum.k, spectrum.q));
          const targetK = Array.from({ length: DRAW_KNOTS }, (_, index) => (index / (DRAW_KNOTS - 1)) * targetKMax);
          const values = interpolateQ(
            Array.from(spectrum.k),
            Array.from(spectrum.q),
            Float64Array.from(targetK),
            { lower: 'constant' },
          );
          const peak = Math.max(...values, 1e-30);
          return Array.from(values, (value) => Math.max(0, value / peak));
        })();
    let next: number[];
    if (kind === 'smooth') {
      next = sampled.slice();
      for (let pass = 0; pass < 2; pass++) {
        const previous = next;
        next = previous.map((_, index) => {
          const at = (offset: number) => previous[Math.min(previous.length - 1, Math.max(0, index + offset))];
          return (at(-2) + 4 * at(-1) + 6 * at(0) + 4 * at(1) + at(2)) / 16;
        });
      }
    } else {
      const peak = Math.max(...sampled, 1e-30);
      next = sampled.map((value) => Math.pow(Math.max(0, value / peak), 1.3));
    }
    const peak = Math.max(...next, 1e-30);
    next = next.map((value) => value / peak);
    setDrawValues(next);
    setDrawKMax(targetKMax);
    setSource('draw');
    applyDrawnShape(next, targetKMax);
  };

  const raw = spectrum?.raw;
  let half = 0;
  if (spectrum) {
    let qMax = 0;
    for (let i = 0; i < spectrum.q.length; i++) qMax = Math.max(qMax, spectrum.q[i]);
    half = (qMax / 2) * norm.scale;
  }
  let drawIntegral = 0;
  for (let index = 0; index < drawValues.length - 1; index++) {
    drawIntegral += 0.5 * (drawValues[index] + drawValues[index + 1]) * (drawK[index + 1] - drawK[index]);
  }
  const drawQ = drawIntegral > 0
    ? drawValues.map((value) => value / drawIntegral)
    : drawValues.slice();
  const drawDisplay = Array.from(applyNorm(drawQ, norm));
  const fromDrawDisplay = (values: number[]) => values.map((value) => value / norm.scale);
  return (
    <Card
      title="Initial state"
      actions={
        <div className="flex items-center gap-2">
          {expanded && spectrum && (
            <div className="flex items-center gap-1 rounded-xl bg-black/[0.035] p-0.5 dark:bg-white/[0.06]">
              <button
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={() => reshape('smooth')}
                title="Soften narrow variations in the current spectrum"
              >
                Smooth
              </button>
              <button
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={() => reshape('sharpen')}
                title="Concentrate the current spectrum around its peaks"
              >
                Sharpen
              </button>
            </div>
          )}
          <button
            className="btn-secondary text-xs"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="initial-state-content"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      }
    >
      <div className="collapse-region" data-collapsed={!expanded} aria-hidden={!expanded}>
        <div className="collapse-region-inner">
          <div
            id="initial-state-content"
            className="grid grid-cols-1 xl:grid-cols-[minmax(210px,0.66fr)_minmax(360px,1.28fr)_minmax(250px,0.82fr)] gap-x-6 gap-y-5 items-start"
          >
        <div className="space-y-3 min-w-0">
          <SegmentedControl
            size="xs"
            value={source}
            onChange={chooseSource}
            options={[
              { id: 'preset', label: 'Examples' },
              { id: 'data', label: 'Your data' },
              { id: 'draw', label: 'Draw' },
            ]}
          />
        {source === 'preset' ? (
          <Field label="Example">
            <select
              className="select"
              value={presetKey ?? ''}
              onChange={(e) => loadPreset(e.target.value)}
            >
              {presetKey === null && <option value="">Pasted or uploaded data</option>}
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} · k_p ≈ {p.kp_um_inv.toFixed(2)} μm⁻¹
                </option>
              ))}
            </select>
          </Field>
        ) : source === 'data' ? (
          <>
            <Field
              label="Spectrum convention"
              hint={CONVENTIONS.find((item) => item.id === convention)?.detail}
            >
              <select
                className="select"
                value={convention}
                onChange={(e) => setConvention(e.target.value as SpectrumConvention)}
              >
                {CONVENTIONS.map((c) => (
                  <option key={c.id} value={c.id}>{c.columns}: {c.label}</option>
                ))}
              </select>
            </Field>

            <div
              className={clsx('drop-zone py-4 text-2xs', dragging && 'drop-zone-active')}
              role="button"
              tabIndex={0}
              aria-label="Choose a spectrum CSV file"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                fileRef.current?.click();
              }}
            >
              <span>Drop a CSV here, or click to choose a file</span>
              {fileName && <span className="font-mono text-slate-500">{fileName}</span>}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/*"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>

            <Field label="Paste two columns">
              <textarea
                className="input font-mono text-2xs h-24 resize-y"
                spellCheck={false}
                placeholder={convention === 'n_k'
                  ? 'k_um_inv,n_k\n0.15,3420.6\n0.30,3658.7\n…'
                  : 'k_um_inv,Nk_over_N\n0.15,0.020\n0.30,0.085\n…'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>

            <div className="flex gap-2">
              <button
                className="btn-primary text-xs"
                disabled={text.trim().length === 0}
                onClick={() => ingest(text, 'Pasted spectrum', 'paste')}
              >
                Use this spectrum
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={() => {
                  setConvention('Nk_over_N');
                  setText(presetToCsv(presetKey ?? PRESETS[0].key));
                }}
                title="Fill the box with an example in the expected format"
              >
                Load example CSV
              </button>
            </div>
          </>
        ) : null}

        {source === 'draw' && (
          <>
            <p className="text-2xs text-slate-500 dark:text-slate-400">
              Draw directly on the spectrum plot, then apply the draft. Applied shapes are normalized to
              <MathBlock math="\int N_k/N\,dk=1" />. Keyboard: focus the plot, use ←/→ to select k and ↑/↓ to adjust it.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary text-xs"
                onClick={() => { setDrawValues(new Array(DRAW_KNOTS).fill(0)); setDrawDirty(true); }}
              >
                Clear
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={() => {
                  // seed a bell curve so users see the gesture before drawing their own
                  const kp = drawKMax * 0.4;
                  const sigma = drawKMax * 0.12;
                  const next = Array.from({ length: DRAW_KNOTS }, (_, i) => {
                    const k = (i / (DRAW_KNOTS - 1)) * drawKMax;
                    return Math.exp(-0.5 * ((k - kp) / sigma) ** 2);
                  });
                  setDrawValues(next);
                  setDrawDirty(true);
                }}
              >
                Seed bell curve
              </button>
              <button
                className="btn-primary text-xs"
                disabled={!drawDirty || !(drawIntegral > 0)}
                onClick={() => applyDrawnShape(drawValues)}
              >
                Apply shape
              </button>
              <button
                className="btn-ghost text-xs"
                disabled={!drawDirty}
                onClick={() => { setDrawDirty(false); setSource('preset'); }}
              >
                Cancel edits
              </button>
            </div>
            {drawDirty && <Badge tone="warning">unsaved shape draft</Badge>}
          </>
        )}

        {error && <Callout tone="danger" title="Could not read that spectrum">{error}</Callout>}

        {raw && spectrum && (
          <>
            {spectrum.raw.warnings.length > 0 && (
              <Callout tone="warning" title="Import notes">
                <ul className="list-disc pl-4 space-y-0.5">
                  {spectrum.raw.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </Callout>
            )}
          </>
        )}
        </div>

        {raw && spectrum && (
          <>
            <div>
              <div className="flex items-baseline justify-between gap-3 text-2xs text-slate-500 dark:text-slate-400 mb-2">
                <span>{source === 'draw' ? <>Draw <MathBlock math="N_k(k)" /> directly</> : <>Imported points and interpolated <MathBlock math="N_k(k)" /></>}</span>
                <span className="text-3xs text-slate-400 dark:text-slate-500">
                  {norm.source}
                </span>
              </div>
              <Plot
                aspect="golden"
                maxWidth={480}
                xDomain={source === 'draw' ? [0, drawKMax] : [0, spectralExtent(spectrum.k, spectrum.q)]}
                xLabel="k (μm⁻¹)"
                yLabel={norm.axis}
                formatX={(v) => `${sig(v, 3)} μm⁻¹`}
                series={source === 'draw' ? [{
                  id: 'draw',
                  label: `${norm.symbol} on editable grid`,
                  x: drawK,
                  y: drawDisplay,
                  color: COLORS.spectrum,
                  width: 2.2,
                }] : [
                  {
                    id: 'raw',
                    label: 'imported points',
                    kind: 'points',
                    x: spectrum.raw.k_um_inv,
                    y: applyNorm(spectrum.qRaw, norm),
                    color: COLORS.raw,
                  },
                  {
                    id: 'q',
                    label: `${norm.symbol} on solver grid`,
                    x: spectrum.k,
                    y: applyNorm(spectrum.q, norm),
                    color: COLORS.spectrum,
                  },
                ]}
                editableSeries={source === 'draw' ? {
                  id: 'draw',
                  onChange: (values) => { setDrawValues(fromDrawDisplay(values)); setDrawDirty(true); },
                  onCommit: (values) => { setDrawValues(fromDrawDisplay(values)); setDrawDirty(true); },
                  min: 0,
                } : undefined}
                markers={desc ? [
                  { id: 'kp', axis: 'x', value: desc.kp0_um_inv, label: 'k_p,0', color: COLORS.peak },
                  { id: 'mean', axis: 'x', value: desc.mean_k_um_inv, label: '⟨k⟩', color: COLORS.muted },
                  { id: 'half', axis: 'y', value: half, color: COLORS.muted },
                ] : []}
              />
            </div>

            <div className="space-y-3 min-w-0">
            {desc && (
              <>
                <div className="grid grid-cols-1 gap-x-5 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <Metric label={<MathBlock math="k_{p,0}" />} value={sig(desc.kp0_um_inv)} unit="μm⁻¹" emphasis />
                    <Metric label={<MathBlock math="\langle k \rangle" />} value={sig(desc.mean_k_um_inv)} unit="μm⁻¹" />
                    <Metric label="FWHM" value={sig(desc.fwhm_um_inv)} unit="μm⁻¹" />
                    <Metric label={<><MathBlock math="\int N_k\,dk" /> as imported</>} value={expo(spectrum.rawIntegral)}
                      title="The normalization constant divided out on import." />
                    <Metric label="prominent maxima > 10% peak" value={String(desc.modeCount)} />
                  </div>
                  <div>
                    <Metric label={<MathBlock math="\delta_k = \frac{\langle k \rangle-k_{p,0}}{k_{p,0}}" />} value={desc.delta_k.toFixed(5)} />
                    <Metric label={<MathBlock math="w = \frac{\mathrm{FWHM}}{k_{p,0}}" />} value={desc.w.toFixed(5)} />
                    <Metric label={<MathBlock math="C_{\mathrm{shape}}" />} value={desc.c_shape.toFixed(5)} emphasis />
                    <Metric label={<MathBlock math="A_{\mathrm{ref}} = \kappa k_{p,0}^2" />} value={expo(desc.A_ref_s_um4)} unit="s·μm⁻⁴" />
                    <Metric label={<><MathBlock math="\int N_k/N\,dk" /> after resampling</>} value={desc.normIntegral.toFixed(6)}
                      title="Should be 1 by construction." />
                  </div>
                </div>

              </>
            )}
            </div>
          </>
        )}
      </div>
        </div>
      </div>
    </Card>
  );
}
