/** CSV downloads: the initial spectrum, a run's trajectory, and k_p(t) of all runs. */

import { useState } from 'react';
import { Card, Field, Segmented } from '../ui/primitives';
import { EXPORT_CONVENTIONS, EXPORT_K_UNITS, exportProfile, exportTrajectory } from '../physics/export';
import type { ExportConvention, ExportKUnit } from '../physics/export';
import { MODEL_BY_ID } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { RunRecord } from '../state/useRunLibrary';
import { runLabel } from '../ui/runView';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function header(lines: string[]): string {
  return lines.map((l) => `# ${l}`).join('\n');
}

function runHeader(rec: RunRecord): string[] {
  const r = rec.result;
  return [
    `model: ${MODEL_BY_ID[r.model].label}${r.kernel === 'quantum' ? ', Bose +1 statistics' : ''}`,
    `accuracy: ${PRECISION[r.accuracy].label}`,
    `density n = ${r.scales.density_um3} um^-3, signed na = ${r.scales.na_um2} um^-2`,
    `healing length xi = ${r.scales.xi_um} um, time unit t0 = ${r.scales.t0_s} s`,
    `stop at k_p/k_p0 = ${r.stopKpFraction}: ${r.dtTarget_s != null ? `${r.dtTarget_s} s` : 'not reached'} (${r.termination})`,
  ];
}

/** File-name suffix of a run's sign of a: "_plus" or "_minus". */
const signSuffix = (rec: RunRecord) => (rec.result.scales.sign > 0 ? '_plus' : '_minus');

export function ExportCard({ spectrum, atomNumber, shown, compared }: {
  spectrum: PreparedSpectrum;
  atomNumber: number | null;
  /** the runs shown: one, or both signs of a ±a pair */
  shown: RunRecord[];
  compared: RunRecord[];
}) {
  const pair = shown.length > 1;
  const fileBase = (rec: RunRecord) => `${slug(runLabel(rec.result))}${pair ? signSuffix(rec) : ''}`;
  const [convention, setConvention] = useState<ExportConvention>('Nk_over_N');
  const [kUnit, setKUnit] = useState<ExportKUnit>('um_inv');
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const exportInitial = () => {
    const out = exportProfile(spectrum.k, spectrum.q, { convention, kUnit, atomNumber, fallbackScale: spectrum.rawIntegral });
    download(`${slug(spectrum.raw.label)}-initial.csv`, `${header([spectrum.raw.label, out.scaleNote])}\n${out.csv}`);
  };

  const exportFinal = () => {
    for (const rec of shown) {
      const last = rec.result.snapshots.at(-1)!;
      const out = exportProfile(rec.result.k_um_inv, last.q, { convention, kUnit, atomNumber, fallbackScale: null });
      download(`${fileBase(rec)}-final.csv`,
        `${header([...runHeader(rec), `state at t = ${last.t_s} s`, out.scaleNote])}\n${out.csv}`);
    }
  };

  const exportTrajectoryCsv = () => {
    for (const rec of shown) {
      const r = rec.result;
      const out = exportTrajectory(r.k_um_inv, r.snapshots, r.scales.density_um3);
      download(`${fileBase(rec)}-trajectory.csv`, `${header([...runHeader(rec), out.scaleNote])}\n${out.csv}`);
    }
  };

  const exportKp = () => {
    const lines = ['model,sign_a,accuracy,t_s,k_p_um_inv,k_p_over_k_p0,loop_dressing'];
    for (const rec of compared) {
      const r = rec.result;
      const name = runLabel(r).replace(/,/g, ';');
      for (let i = 0; i < r.kpTrack.t_s.length; i++) {
        lines.push([name, r.scales.sign > 0 ? '+' : '-', r.accuracy, r.kpTrack.t_s[i], r.kpTrack.kp[i], r.kpTrack.kp[i] / r.kp0_um_inv, r.kpTrack.loop[i]]
          .map((v) => (typeof v === 'number' ? v.toPrecision(9) : v)).join(','));
      }
    }
    download('peak-momentum-all-models.csv', lines.join('\n'));
  };

  return (
    <Card label="Export" ariaLabel="Export">
      <div className="inputs">
        <Field label="Spectrum as">
          <select value={convention} onChange={(e) => setConvention(e.target.value as ExportConvention)}>
            {EXPORT_CONVENTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="k in">
          <Segmented ariaLabel="k unit" value={kUnit} onChange={setKUnit}
            options={EXPORT_K_UNITS.map((u) => ({ id: u.id, label: u.label }))} />
        </Field>
      </div>
      <div className="toolbar">
        <button type="button" className="btn" onClick={exportInitial}>Initial spectrum</button>
        <button type="button" className="btn" onClick={exportFinal} disabled={shown.length === 0}>Final state{pair ? 's, ±a' : ''}</button>
        <button type="button" className="btn" onClick={exportTrajectoryCsv} disabled={shown.length === 0}>Whole trajector{pair ? 'ies, ±a' : 'y'}</button>
        <button type="button" className="btn" onClick={exportKp} disabled={compared.length === 0}>kₚ(t), all models</button>
      </div>
      <p className="hint">
        Trajectories are long-format rows of k, occupation nₖ and time for every saved state. Each file starts with
        comment lines recording the model, accuracy and parameters.
      </p>
    </Card>
  );
}
