/**
 * Initial spectrum: presets, pasted or uploaded two-column data, or a curve
 * drawn by hand, with the shape descriptors it produces.
 */

import { useRef, useState } from 'react';
import { Card, LegendItem, Segmented } from '../ui/primitives';
import { Tex } from '../ui/Tex';
import { Plot } from './Plot';
import type { Series } from './Plot';
import { applyNorm } from '../ui/norm';
import type { NormSpec } from '../ui/norm';
import { fixed, fmt } from '../ui/format';
import { PRESETS, getPreset, presetToCsv } from '../physics/presets';
import { CONVENTIONS, SpectrumParseError, prepareFromText, prepareSpectrum } from '../physics/spectrum';
import type { PreparedSpectrum, SpectrumConvention } from '../physics/spectrum';
import { spectralExtent } from '../physics/descriptors';
import type { SpectralDescriptors } from '../physics/descriptors';
import { interpolateQ, trapz } from '../physics/grid';
import { HBAR_JS, KB_JK, SPECIES } from '../physics/constants';

type Source = 'preset' | 'data' | 'draw';
const KNOTS = 160;
const K_LIMIT = 6;

export function InitialStateCard({ presetKey, spectrum, desc, norm, speciesKey, onPreset, onCustom }: {
  presetKey: string | null;
  spectrum: PreparedSpectrum;
  desc: SpectralDescriptors;
  norm: NormSpec;
  speciesKey: string;
  onPreset: (key: string) => void;
  onCustom: (s: PreparedSpectrum) => void;
}) {
  const [source, setSource] = useState<Source>(presetKey ? 'preset' : 'data');
  const [convention, setConvention] = useState<SpectrumConvention>('n_k');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draw, setDraw] = useState<{ kMax: number; values: number[] } | null>(null);

  const ingest = (raw: string, label: string, src: 'paste' | 'file') => {
    try {
      onCustom(prepareFromText(raw, convention, label, src));
      setError(null);
    } catch (e) {
      setError(e instanceof SpectrumParseError ? e.message : String(e));
    }
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    file.text().then((t) => { setText(t); ingest(t, file.name, 'file'); });
  };

  const startDraw = () => {
    const kMax = Math.min(K_LIMIT, spectralExtent(spectrum.k, spectrum.q));
    const k = Float64Array.from({ length: KNOTS }, (_, i) => (i / (KNOTS - 1)) * kMax);
    const sampled = interpolateQ(Array.from(spectrum.k), Array.from(spectrum.q), k, { lower: 'constant' });
    const peak = Math.max(...sampled, 1e-30);
    setDraw({ kMax, values: Array.from(sampled, (v) => Math.max(0, v / peak)) });
  };

  const applyDraw = (values: number[], kMax: number) => {
    const k: number[] = [];
    for (let i = 1; i < KNOTS; i++) k.push((i / (KNOTS - 1)) * kMax);
    try {
      onCustom(prepareSpectrum({
        k_um_inv: k, values: values.slice(1), convention: 'Nk_over_N', label: 'Hand-drawn spectrum', source: 'paste', warnings: [],
      }));
      setError(null);
    } catch (e) {
      setError(e instanceof SpectrumParseError ? e.message : String(e));
    }
  };

  const choose = (next: Source) => {
    setSource(next);
    setError(null);
    if (next === 'draw') startDraw();
    if (next === 'data' && !text) setText(presetToCsv(presetKey ?? PRESETS[0].key));
  };

  const xMax = source === 'draw' && draw ? draw.kMax : spectralExtent(spectrum.k, spectrum.q);
  const series: Series[] = [];
  if (source === 'draw' && draw) {
    series.push({
      id: 'draw', label: 'drawn Nₖ (peak = 1)', color: 'var(--loop)', width: 2.2,
      x: Array.from({ length: KNOTS }, (_, i) => (i / (KNOTS - 1)) * draw.kMax), y: draw.values,
    });
  } else {
    series.push({ id: 'profile', label: 'profile on the input grid', x: spectrum.k, y: applyNorm(spectrum.q, norm), color: 'var(--accent)', width: 2 });
    if (spectrum.raw.source !== 'preset' || spectrum.raw.convention === 'n_k') {
      series.push({ id: 'raw', label: 'supplied points', x: spectrum.raw.k_um_inv, y: applyNorm(spectrum.qRaw, norm), color: 'var(--ink)', kind: 'points' });
    }
  }

  const preset = presetKey ? getPreset(presetKey) : null;
  const notes = preset?.hideImportNotes ? [] : spectrum.raw.warnings;
  const species = SPECIES[speciesKey] ?? SPECIES.K39;
  const meanK2_um2 = trapz(Float64Array.from(spectrum.q, (q, i) => q * spectrum.k[i] ** 2), spectrum.k);
  const energyPerParticle_nK = (HBAR_JS ** 2 / (2 * species.massKg * KB_JK)) * 1e21 * meanK2_um2;

  return (
    <Card
      label="Initial state"
      title={spectrum.raw.label}
      ariaLabel="Initial state"
      actions={(
        <Segmented ariaLabel="Source" value={source} onChange={choose}
          options={[{ id: 'preset', label: 'Presets' }, { id: 'data', label: 'Paste or upload' }, { id: 'draw', label: 'Draw' }]} />
      )}
    >
      {source === 'preset' && (
        <div className="chips" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={p.key === presetKey} title={p.description}
              onClick={() => onPreset(p.key)}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {source === 'data' && (
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
        >
          <div className="toolbar">
            <Segmented<SpectrumConvention> ariaLabel="Second column" value={convention} onChange={setConvention}
              options={CONVENTIONS.map((c) => ({ id: c.id, label: c.id === 'n_k' ? 'density n(k)' : 'shell Nₖ/N', title: c.detail }))} />
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Choose file</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.dat" className="visually-hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            aria-label="Two columns: k in μm⁻¹, then the chosen quantity" placeholder="k (μm⁻¹), value" />
          <div className="toolbar">
            <span className="hint">Two columns, k in μm⁻¹ first. Commas, tabs or spaces; a header row is optional. Drop a file anywhere here.</span>
            <span className="spacer" />
            <button type="button" className="btn primary" onClick={() => ingest(text, 'Pasted spectrum', 'paste')}>Load</button>
          </div>
        </div>
      )}

      {source === 'draw' && (
        <p className="hint">Paint the shell distribution <b>Nₖ(k)</b> with the mouse or a finger. Only the shape matters: it is normalised to the atom number. The solver picks it up when you release.</p>
      )}

      <Plot
        series={series}
        xLabel="k (μm⁻¹)"
        yLabel={source === 'draw' ? 'Nₖ (relative)' : norm.axis}
        xDomain={[0, xMax]}
        yDomain={source === 'draw' ? [0, 1.15] : undefined}
        formatX={(v) => v.toFixed(3)}
        formatY={(v) => fmt(v, 4)}
        aspect={2}
        minHeight={200}
        maxHeight={320}
        editableSeries={source === 'draw' && draw ? {
          id: 'draw', min: 0, max: 1.15,
          onChange: (values) => setDraw((d) => (d ? { ...d, values } : d)),
          onCommit: (values) => applyDraw(values, draw.kMax),
        } : undefined}
      />
      <div className="legend">{series.map((s) => <LegendItem key={s.id} color={s.color} label={s.label} />)}</div>

      {preset?.formula && source === 'preset' && <Tex block math={preset.formula} />}

      <dl className="kv">
        <dt>kinetic energy per particle <Tex math="E/N" /> (nK)</dt><dd>{fixed(energyPerParticle_nK, 3)}</dd>
        <dt>peak <Tex math="k_{p,0}" /> (μm⁻¹)</dt><dd>{fixed(desc.kp0_um_inv, 4)}</dd>
        <dt>mean <Tex math="\langle k\rangle" /> (μm⁻¹)</dt><dd>{fixed(desc.mean_k_um_inv, 4)}</dd>
        <dt>full width at half maximum (μm⁻¹)</dt><dd>{fixed(desc.fwhm_um_inv, 4)}</dd>
        <dt>prominent maxima</dt><dd>{desc.modeCount}</dd>
      </dl>

      {error && <div className="notice bad">{error}</div>}
      {notes.length > 0 && (
        <div className="notice"><b>Import notes</b><ul>{notes.map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}
    </Card>
  );
}
