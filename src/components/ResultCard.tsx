/**
 * Headline result of the selected run: the time for k_p to fall to the chosen
 * fraction of its initial value, the validity verdicts, the scales, and the
 * run controls.
 */

import { Badge, Card, Status } from '../ui/primitives';
import type { Tone } from '../ui/primitives';
import { Tex } from '../ui/Tex';
import { duration, fixed, fmt, pct, signed, time, timeText } from '../ui/format';
import { peakMomentum } from '../physics/descriptors';
import type { WKESnapshot } from '../types/wke';
import { driftVerdict, loopVerdict, runLabel, terminationVerdict } from '../ui/runView';
import { MODEL_BY_ID } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { RunProgress, RunRecord } from '../state/useRunLibrary';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { DerivedSystem } from '../physics/parameters';
import type { SimulationSettings } from '../state/useSimulationSettings';

export interface ScaleSummary {
  kXi: number | null;
  t0_s: number | null;
}

/** The state shown in the spectrum panel. */
export interface FrameView {
  snap: WKESnapshot;
  k: Float64Array;
}

export function ResultCard({
  record, stale, progress, settings, derived, desc, scales, frame, canRun, runBlocker, onRun, onRunAll, onCancel, onStopAndReset,
}: {
  frame: FrameView | null;
  record: RunRecord | null;
  stale: boolean;
  progress: RunProgress;
  settings: SimulationSettings;
  derived: DerivedSystem;
  desc: SpectralDescriptors;
  scales: ScaleSummary;
  canRun: boolean;
  runBlocker: string | null;
  onRun: () => void;
  onRunAll: () => void;
  onCancel: () => void;
  onStopAndReset: () => void;
}) {
  const r = record?.result ?? null;
  const frameView = frame ? (() => {
    const { snap, k } = frame;
    const e = Float64Array.from(snap.q, (v, i) => v * k[i] * k[i]);
    return { t_s: snap.t_s, kp: snap.kp_um_inv, kE: peakMomentum(k, e), loop: snap.mHist ? (snap.loop ?? null) : null };
  })() : null;
  const t = time(r?.dtTarget_s ?? null);
  const check = record?.check;
  const pm = check && check !== 'pending' && check.dtRel != null ? Math.abs(check.dtRel) : null;

  const badges: Array<{ tone: Tone; text: string; title: string }> = [];
  if (r) {
    badges.push(terminationVerdict(r));
    const lv = loopVerdict(r);
    if (lv) badges.push(lv);
    badges.push(driftVerdict(r));
    if (r.gridCoverage < 0.99) {
      badges.push({ tone: 'warn', text: `grid holds ${pct(r.gridCoverage)} of the spectrum`, title: 'Part of the spectrum lies outside the solver grid and was renormalised away.' });
    }
    if (check === 'pending') badges.push({ tone: 'info', text: 'checking convergence', title: 'Rerunning one accuracy level higher.' });
    else if (check) {
      const d = Math.abs(check.dtRel ?? NaN);
      const tone: Tone = !Number.isFinite(d) ? 'warn' : d < 0.005 ? 'ok' : d < 0.02 ? 'warn' : 'bad';
      badges.push({
        tone,
        text: Number.isFinite(d) ? `converged to ${pct(d, 2)} vs ${PRECISION[check.level].label}` : 'convergence check incomplete',
        title: `Stop time and kₚ(t) compared with a rerun at ${PRECISION[check.level].label}. Largest kₚ difference: ${pct(check.kpMaxRel, 2)}.`,
      });
    }
    if (stale) badges.push({ tone: 'info', text: 'setup changed since this run', title: 'Run again to update.' });
  }

  const running = progress.running;
  const statusState = progress.error ? 'error' : running ? 'running' : r ? 'done' : 'idle';
  let statusText: string;
  if (progress.error) statusText = progress.error;
  else if (running) {
    const where = progress.stopping ? 'stopping after the current solver step'
      : progress.phase === 'setup'
      ? 'building tables'
      : `${Math.round(100 * progress.pct)}%${progress.t_s != null ? ` · t = ${time(progress.t_s).value} ${time(progress.t_s).unit}` : ''}`;
    statusText = `${progress.label} · ${where}${progress.kp != null ? ` · kₚ = ${fmt(progress.kp, 4)} μm⁻¹` : ''}${progress.elapsed_ms != null ? ` · ${duration(progress.elapsed_ms)}` : ''}${progress.queued ? ` · ${progress.queued} queued` : ''}`;
  } else if (r) {
    statusText = `${runLabel(r)} · ${PRECISION[r.accuracy].label} · ${duration(r.wallTime_ms + r.setup_ms)} · ${r.nSteps} steps · ${(r.nEvents / 1e6).toFixed(2)} M collision events · ${r.threads} thread${r.threads === 1 ? '' : 's'}`;
  } else statusText = runBlocker ?? 'Ready. Choose a model and run.';

  return (
    <Card ariaLabel="Result">
      <div className="hero">
        <span className="label">
          Time for <Tex math="k_p" /> to fall to {settings.stopKpFraction} <Tex math="k_{p,0}" />
        </span>
        <div className="hero-num" aria-live="polite">
          {r && r.dtTarget_s != null ? t.value : r ? 'not reached' : 'n/a'}
          {r && r.dtTarget_s != null && <small>{t.unit}</small>}
          {pm != null && <span className="pm">± {pct(pm, 2)}</span>}
        </div>
        <div className="hero-sub">
          {r ? (
            <><b>{MODEL_BY_ID[r.model].label}</b>{r.kernel === 'quantum' ? ', Bose +1 statistics' : ''} · {PRECISION[r.accuracy].label} accuracy</>
          ) : 'Run a model to measure the relaxation time.'}
        </div>
      </div>

      {badges.length > 0 && (
        <div className="badges">
          {badges.map((b) => <Badge key={b.text} tone={b.tone} title={b.title}>{b.text}</Badge>)}
        </div>
      )}
      {r?.terminationMessage && <div className="notice bad">{r.terminationMessage}</div>}

      <dl className="kv">
        <dt>peak <Tex math="k_{p,0}" /> (μm⁻¹)</dt><dd>{fixed(desc.kp0_um_inv, 4)}</dd>
        <dt>density <Tex math="n" /> (μm⁻³)</dt><dd>{fmt(derived.density_um3)}</dd>
        <dt><Tex math="na" /> (μm⁻²)</dt><dd>{fmt(derived.na_um2)}</dd>
        <dt><Tex math="k_\xi = \sqrt{8\pi n|a|}" /> (μm⁻¹)</dt><dd>{fmt(scales.kXi)}</dd>
        <dt>time unit <Tex math="t_0 = \hbar/|g|n" /> (ms)</dt><dd>{scales.t0_s != null ? fmt(scales.t0_s * 1e3) : 'n/a'}</dd>
      </dl>
      {frameView && (
        <dl className="kv now" aria-live="off">
          <dt className="kv-head">At <Tex math="t" /> = {timeText(frameView.t_s)}</dt><dd />
          <dt title="Peak of the shell spectrum k²nₖ.">peak <Tex math="k_p(t)" /> (μm⁻¹)</dt><dd>{fixed(frameView.kp, 4)}</dd>
          <dt title="Peak of k⁴nₖ, where the kinetic energy sits; found like kₚ.">energy peak <Tex math="k_E(t)" /> (μm⁻¹)</dt><dd>{fixed(frameView.kE, 4)}</dd>
          <dt><Tex math="k_p/k_{p,0}" /></dt><dd>{fixed(frameView.kp / desc.kp0_um_inv, 4)}</dd>
          {frameView.loop != null && (
            <><dt title="Mean of M − 1 over the collisions, weighted by their rate.">loop strength <Tex math="\langle M\rangle - 1" /></dt><dd>{signed(frameView.loop, 4)}</dd></>
          )}
        </dl>
      )}

      {running && <div className="progress" aria-hidden="true"><span style={{ width: `${Math.round(100 * Math.min(1, Math.max(0.03, progress.pct)))}%` }} /></div>}
      <Status state={statusState}>{statusText}</Status>
      {running && progress.loopDressing != null && settings.model !== 'bare' && (
        <div className="hint">
          live loop dressing {fmt(progress.loopDressing, 3)}
          {Number.isFinite(progress.poleIndicator ?? NaN) ? ` · ${MODEL_BY_ID[settings.model].hasPole ? 'vertex weight' : 'smallest bracket'} ${fmt(progress.poleIndicator, 3)}` : ''}
        </div>
      )}

      <div className="toolbar">
        {running ? (
          <>
            <button type="button" className="btn big" onClick={onCancel} disabled={progress.stopping}
              title="Stop after the current solver step and keep the partial run.">{progress.stopping ? 'Stopping…' : 'Stop'}</button>
            <button type="button" className="btn big danger" onClick={onStopAndReset}
              title="Stop the calculation and clear the saved runs from this page.">Stop &amp; Reset</button>
          </>
        ) : (
          <button type="button" className="btn primary big" onClick={onRun} disabled={!canRun} title={runBlocker ?? undefined}>
            Run simulation ({MODEL_BY_ID[settings.model].short})
          </button>
        )}
        <button type="button" className="btn big" onClick={onRunAll} disabled={!canRun || running}>
          Run all models
        </button>
      </div>
    </Card>
  );
}
