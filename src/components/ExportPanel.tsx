/**
 * Export any saved profile — the imported initial spectrum, or a WKE snapshot
 * from the last classical/quantum run — as a two-column table in whichever
 * convention and k unit the user needs downstream.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Field, Metric, Badge, SegmentedControl } from '../ui/primitives';
import { EXPORT_CONVENTIONS, EXPORT_K_UNITS, exportProfile, exportTrajectory } from '../physics/export';
import type { ExportConvention, ExportKUnit } from '../physics/export';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { KernelType } from '../physics/collision';
import type { DerivedPhysics, ParameterMode, RunProvenance, WKEResult } from '../types/wke';
import { seconds } from '../ui/theme';

interface SourceOption {
  id: string;
  label: string;
  k: ArrayLike<number>;
  q: ArrayLike<number>;
  atomNumber: number | null;
  metadata: Record<string, string | number | null>;
}

type ExportScope = 'profile' | 'trajectory';

export function ExportPanel({
  spectrum, runs, atomNumber, provenance, mode, speciesKey, derived,
}: {
  spectrum: PreparedSpectrum | null;
  runs: Partial<Record<KernelType, WKEResult>>;
  atomNumber: number | null;
  provenance: RunProvenance | null;
  mode: ParameterMode;
  speciesKey: string;
  derived: DerivedPhysics;
}) {
  const sources: SourceOption[] = useMemo(() => {
    const out: SourceOption[] = [];
    if (spectrum) out.push({
      id: 'initial', label: 'Initial spectrum (current)', k: spectrum.k, q: spectrum.q,
      atomNumber,
      metadata: {
        source: 'current initial spectrum', spectrum: spectrum.raw.label, mode, species: speciesKey,
        density_um3: derived.density_um3, a_a0: derived.a_a0, na_um2: derived.na_um2,
        atom_number: derived.N, volume_um3: derived.V_um3,
      },
    });
    for (const kernel of ['classical', 'quantum'] as KernelType[]) {
      const r = runs[kernel];
      if (!r) continue;
      for (let i = 0; i < r.snapshots.length; i++) {
        const s = r.snapshots[i];
        if (s.stage === 'sample') continue; // keep the picker to the meaningful checkpoints
        const label = s.stage === 'initial'
          ? `${kernel}: t = 0`
          : s.stage === 'final'
            ? r.reachedHalf
              ? `${kernel}: Δt₁ᐟ₂ (${seconds(s.t_s)})`
              : `${kernel}: run limit reached (${seconds(s.t_s)})`
            : s.stage === 'continued'
              ? `${kernel}: continuation started (${seconds(s.t_s)})`
              : s.stage === 'extended'
                ? `${kernel}: extension ended (${seconds(s.t_s)})`
            : `${kernel}: k_p/k_p,0 = ${s.stage} (${seconds(s.t_s)})`;
        out.push({
          id: `${kernel}:${i}`, label, k: r.k_um_inv, q: s.q,
          atomNumber: provenance?.N ?? null,
          metadata: {
            source: 'solver run', kernel, stage: s.stage, time_s: s.t_s,
            reached_half_time: r.reachedHalf ? 'true' : 'false',
            spectrum: provenance?.spectrumLabel ?? null, mode: provenance?.mode ?? null,
            species: provenance?.speciesKey ?? null, density_um3: provenance?.density_um3 ?? r.scales.density_um3,
            a_a0: provenance?.a_a0 ?? null, na_um2: provenance?.na_um2 ?? r.scales.na_um2,
            atom_number: provenance?.N ?? null, volume_um3: provenance?.V_um3 ?? null,
            tau_max: provenance?.tauMax ?? null, rtol: provenance?.rtol ?? null,
            snapshots: provenance?.nSnapshots ?? null, run_id: r.runId,
          },
        });
      }
    }
    return out;
  }, [spectrum, runs, atomNumber, provenance, mode, speciesKey, derived]);

  const [sourceId, setSourceId] = useState<string>(sources[0]?.id ?? '');
  useEffect(() => {
    if (!sources.some((s) => s.id === sourceId)) setSourceId(sources[0]?.id ?? '');
  }, [sources, sourceId]);
  const [convention, setConvention] = useState<ExportConvention>('Nk_over_N');
  const [kUnit, setKUnit] = useState<ExportKUnit>('um_inv');
  const [scope, setScope] = useState<ExportScope>('profile');
  const availableKernels = (['classical', 'quantum'] as KernelType[]).filter((kernel) => runs[kernel]);
  const [trajectoryKernel, setTrajectoryKernel] = useState<KernelType>(availableKernels[0] ?? 'classical');
  useEffect(() => {
    if (!runs[trajectoryKernel] && availableKernels[0]) setTrajectoryKernel(availableKernels[0]);
  }, [runs, trajectoryKernel, availableKernels]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const active = sources.find((s) => s.id === sourceId) ?? sources[0];

  const result = useMemo(() => {
    if (!active) return null;
    return exportProfile(active.k, active.q, {
      convention,
      kUnit,
      atomNumber: active.atomNumber,
      fallbackScale: spectrum?.rawIntegral ?? null,
    });
  }, [active, convention, kUnit, spectrum]);

  const trajectoryResult = useMemo(() => {
    const run = runs[trajectoryKernel];
    if (!run) return null;
    return exportTrajectory(
      run.k_um_inv,
      run.snapshots,
      run.scales.density_um3,
    );
  }, [runs, trajectoryKernel]);

  const exportText = useMemo(() => {
    if (scope === 'trajectory') {
      const run = runs[trajectoryKernel];
      if (!trajectoryResult || !run) return '';
      const metadata = [
        '# wke_export_version: 1',
        '# source: solver trajectory',
        `# kernel: ${trajectoryKernel}`,
        `# run_id: ${run.runId}`,
        `# curves: ${trajectoryResult.curves}`,
      ];
      return [...metadata, trajectoryResult.csv].join('\n');
    }
    if (!result || !active) return '';
    const metadata = Object.entries(active.metadata)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `# ${key}: ${value}`);
    return [`# wke_export_version: 1`, ...metadata, result.csv].join('\n');
  }, [scope, active, result, runs, trajectoryKernel, trajectoryResult]);

  const download = () => {
    if (scope === 'profile' && (!result || !active)) return;
    if (scope === 'trajectory' && !trajectoryResult) return;
    const blob = new Blob([exportText], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scope === 'trajectory'
      ? `${trajectoryKernel}_all_curves_k_n_k_time.csv`
      : `${active!.id.replace(/[:\s]/g, '_')}_${result!.kColumn}_${result!.valueColumn}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
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
          <SegmentedControl
            className="w-full"
            value={scope}
            onChange={setScope}
            options={[
              { id: 'profile', label: 'Single curve' },
              { id: 'trajectory', label: 'All time curves', disabled: availableKernels.length === 0 },
            ]}
          />
          {scope === 'trajectory' ? (
            <>
              <Field label="Kernel">
                <select className="select" value={trajectoryKernel}
                  onChange={(e) => setTrajectoryKernel(e.target.value as KernelType)}>
                  {availableKernels.map((kernel) => <option key={kernel} value={kernel}>{kernel}</option>)}
                </select>
              </Field>
              {trajectoryResult && (
                <>
                  <Metric label="curves" value={String(trajectoryResult.curves)} />
                  <Metric label="rows" value={String(trajectoryResult.rows)} />
                  <Metric label="scale" value={trajectoryResult.scaleNote} />
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Long-form CSV with columns <span className="font-mono">k_um_inv,n_k,time_s</span>.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button className="btn-primary text-xs" onClick={download}>Download CSV</button>
                    <button className="btn-secondary text-xs" onClick={copy}>Copy to clipboard</button>
                    {copyStatus === 'copied' && <Badge tone="success">Copied</Badge>}
                    {copyStatus === 'failed' && <Badge tone="danger">Copy failed</Badge>}
                  </div>
                </>
              )}
            </>
          ) : <>
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
              <p className="text-2xs text-slate-500 dark:text-slate-400">
                Parameter and run provenance is included as re-importable <span className="font-mono">#</span> comment lines.
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary text-xs" onClick={download}>Download CSV</button>
                <button className="btn-secondary text-xs" onClick={copy}>Copy to clipboard</button>
                {copyStatus === 'copied' && <Badge tone="success">Copied</Badge>}
                {copyStatus === 'failed' && <Badge tone="danger">Copy failed</Badge>}
              </div>
            </>
          )}
          </>}
        </div>
      </Card>

      <Card title="Preview" subtitle={scope === 'trajectory'
        ? 'k_um_inv, n_k, time_s'
        : result ? `${result.kColumn}, ${result.valueColumn}` : undefined}>
        <textarea
          readOnly
          spellCheck={false}
          className="input font-mono text-3xs h-72 resize-y"
          value={exportText}
        />
      </Card>
    </div>
  );
}
