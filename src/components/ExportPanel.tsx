/**
 * Export any saved profile — the imported initial spectrum, or a WKE snapshot
 * from the last classical/quantum run — as a two-column table in whichever
 * convention and k unit the user needs downstream.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Field, Metric } from '../ui/primitives';
import { EXPORT_CONVENTIONS, EXPORT_K_UNITS, exportProfile } from '../physics/export';
import type { ExportConvention, ExportKUnit } from '../physics/export';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { KernelType } from '../physics/collision';
import type { WKEResult } from '../types/wke';
import { seconds } from '../ui/theme';

interface SourceOption {
  id: string;
  label: string;
  k: ArrayLike<number>;
  q: ArrayLike<number>;
}

export function ExportPanel({
  spectrum, runs,
}: {
  spectrum: PreparedSpectrum | null;
  runs: Partial<Record<KernelType, WKEResult>>;
}) {
  const sources: SourceOption[] = useMemo(() => {
    const out: SourceOption[] = [];
    if (spectrum) out.push({ id: 'initial', label: 'Initial spectrum (imported)', k: spectrum.k, q: spectrum.q });
    for (const kernel of ['classical', 'quantum'] as KernelType[]) {
      const r = runs[kernel];
      if (!r) continue;
      for (let i = 0; i < r.snapshots.length; i++) {
        const s = r.snapshots[i];
        if (s.stage === 'sample') continue; // keep the picker to the meaningful checkpoints
        const label = s.stage === 'initial'
          ? `${kernel}: t = 0`
          : s.stage === 'final'
            ? `${kernel}: Δt₁ᐟ₂ (${seconds(s.t_s)})`
            : `${kernel}: k_p/k_p,0 = ${s.stage} (${seconds(s.t_s)})`;
        out.push({ id: `${kernel}:${i}`, label, k: r.k_um_inv, q: s.q });
      }
    }
    return out;
  }, [spectrum, runs]);

  const [sourceId, setSourceId] = useState<string>(sources[0]?.id ?? '');
  useEffect(() => {
    if (!sources.some((s) => s.id === sourceId)) setSourceId(sources[0]?.id ?? '');
  }, [sources, sourceId]);
  const [convention, setConvention] = useState<ExportConvention>('Nk_over_N');
  const [kUnit, setKUnit] = useState<ExportKUnit>('um_inv');

  const active = sources.find((s) => s.id === sourceId) ?? sources[0];

  const result = useMemo(() => {
    if (!active) return null;
    return exportProfile(active.k, active.q, {
      convention,
      kUnit,
      atomNumber: null,
      fallbackScale: spectrum?.rawIntegral ?? null,
    });
  }, [active, convention, kUnit, spectrum]);

  const download = () => {
    if (!result || !active) return;
    const blob = new Blob([result.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.id.replace(/[:\s]/g, '_')}_${result.kColumn}_${result.valueColumn}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.csv);
  };

  if (!spectrum) {
    return (
      <Card title="Export">
        <p className="text-2xs text-slate-500 dark:text-slate-400">
          Load a spectrum in Solver first.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Export profile">
        <div className="space-y-3">
          <Field label="Source">
            <select className="select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          {sources.length === 1 && (
            <p className="text-2xs text-slate-500 dark:text-slate-400">
              Run the WKE in the Simulate tab to also export intermediate cascade states.
            </p>
          )}

          <Field label="Convention">
            <select className="select" value={convention} onChange={(e) => setConvention(e.target.value as ExportConvention)}>
              {EXPORT_CONVENTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>

          <Field label="k unit">
            <select className="select" value={kUnit} onChange={(e) => setKUnit(e.target.value as ExportKUnit)}>
              {EXPORT_K_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </Field>

          {result && (
            <>
              <Metric label="rows" value={String(active?.k.length ?? 0)} />
              <Metric label="scale" value={result.scaleNote} />
              <div className="flex gap-2 pt-1">
                <button className="btn-primary text-xs" onClick={download}>Download CSV</button>
                <button className="btn-secondary text-xs" onClick={copy}>Copy to clipboard</button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card title="Preview" subtitle={result ? `${result.kColumn}, ${result.valueColumn}` : undefined}>
        <textarea
          readOnly
          spellCheck={false}
          className="input font-mono text-3xs h-72 resize-y"
          value={result?.csv ?? ''}
        />
      </Card>
    </div>
  );
}
