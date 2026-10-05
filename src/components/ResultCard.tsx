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
import type { Sign, WKESnapshot } from '../types/wke';
import type { ReactNode } from 'react';
import { driftVerdict, loopVerdict, modelColor, runLabel, sharePercent, terminationVerdict } from '../ui/runView';
import type { Verdict } from '../ui/runView';
import { POLE_DRESSING_LIMIT } from '../physics/rhs';
import { MODEL_BY_ID } from '../physics/models';
import { PRECISION } from '../physics/precision';
import type { RunProgress, RunRecord, SignProgress } from '../state/useRunLibrary';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { DerivedSystem } from '../physics/parameters';
import type { SimulationSettings } from '../state/useSimulationSettings';

export interface ScaleSummary {
  kXi: number | null;
  t0_s: number | null;
}

/** The state shown in the spectrum panel; for a ±a pair also the −a state at the same time. */
export interface FrameView {
  snap: WKESnapshot;
  k: Float64Array;
  partnerSnap?: WKESnapshot | null;
}

/** Validity verdicts of one finished run. */
function runVerdicts(rec: RunRecord, stale: boolean): Verdict[] {
  const r = rec.result;
  const out: Verdict[] = [terminationVerdict(r)];
  const lv = loopVerdict(r);
  if (lv) out.push(lv);
  out.push(driftVerdict(r));
  if (r.gridCoverage < 0.99) {
    out.push({ tone: 'warn', text: `grid holds ${pct(r.gridCoverage)} of the spectrum`, title: 'Part of the spectrum lies outside the solver grid and was renormalised away.' });
  }
  const check = rec.check;
  if (check === 'pending') out.push({ tone: 'info', text: 'checking convergence', title: 'Rerunning one accuracy level higher.' });
  else if (check) {
    const d = Math.abs(check.dtRel ?? NaN);
    const tone: Tone = !Number.isFinite(d) ? 'warn' : d < 0.005 ? 'ok' : d < 0.02 ? 'warn' : 'bad';
    out.push({
      tone,
      text: Number.isFinite(d) ? `converged to ${pct(d, 2)} vs ${PRECISION[check.level].label}` : 'convergence check incomplete',
      title: `Stop time and kₚ(t) compared with a rerun at ${PRECISION[check.level].label}. Largest kₚ difference: ${pct(check.kpMaxRel, 2)}.`,
    });
  }
  if (stale) out.push({ tone: 'info', text: 'setup changed since this run', title: 'Run again to update.' });
  return out;
}

/** The live pole or bracket readout of a running loop model. */
function liveLoopText(p: Pick<SignProgress, 'loopDressing' | 'poleIndicator' | 'poleShare'>, hasPole: boolean): string {
  let s = `loop dressing ${fmt(p.loopDressing, 3)}`;
  if (Number.isFinite(p.poleIndicator ?? NaN)) s += ` · ${hasPole ? 'largest sampled vertex weight' : 'smallest bracket'} ${fmt(p.poleIndicator, 3)}`;
  if (Number.isFinite(p.poleShare ?? NaN)) s += ` · M > ${POLE_DRESSING_LIMIT} on ${sharePercent(p.poleShare!)} of the rate`;
  return s;
}

export function ResultCard({
  record, partner, aAbs_a0, stale, progress, settings, derived, desc, scales, frame, canRun, runBlocker, onRun, onRunAll, onCancel, onStopAndReset,
}: {
  frame: FrameView | null;
  /** the run shown: the only one, or the +a run of a ±a pair */
  record: RunRecord | null;
  /** the −a run of a ±a pair; undefined outside pair mode */
  partner?: RunRecord | null;
  aAbs_a0: number | null;
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
  // While a new run (or a continuation) is computing, the previous result no longer describes what is shown.
  const superseded = progress.running && progress.purpose !== 'check';
  const r = superseded ? null : record?.result ?? null;
  const frameView = frame ? (() => {
    const { snap, k } = frame;
    const e = Float64Array.from(snap.q, (v, i) => v * k[i] * k[i]);
    return { t_s: snap.t_s, kp: snap.kp_um_inv, kE: peakMomentum(k, e), loop: snap.mHist ? (snap.loop ?? null) : null };
  })() : null;
  const pairMode = partner !== undefined;
  const t = time(r?.dtTarget_s ?? null);
  const check = record?.check;
  const pm = check && check !== 'pending' && check.dtRel != null ? Math.abs(check.dtRel) : null;
  const badges = r && record ? runVerdicts(record, stale) : [];
  const hasPole = MODEL_BY_ID[settings.model].hasPole;

  const running = progress.running;
  const pairLabel = pairMode ? ' ±a' : '';
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
      {pairMode ? (
        <PairHero record={record} partner={partner} aAbs_a0={aAbs_a0} stale={stale} progress={progress}
          superseded={superseded} stopKpFraction={settings.stopKpFraction} model={settings.model} hasPole={hasPole} />
      ) : (<>
      <div className="hero">
        <span className="label">
          Time for <Tex math="k_p" /> to fall to {settings.stopKpFraction} <Tex math="k_{p,0}" />
        </span>
        <div className="hero-num" aria-live="polite">
          {superseded ? <span className="pending">running</span> : r && r.dtTarget_s != null ? t.value : r ? 'not reached' : 'n/a'}
          {r && r.dtTarget_s != null && <small>{t.unit}</small>}
          {pm != null && r && <span className="pm">± {pct(pm, 2)}</span>}
        </div>
        <div className="hero-sub">
          {superseded ? (
            <><b>{progress.label.split(' · ')[0]}</b> · {progress.phase === 'setup' ? 'building tables' : progress.t_s != null ? <>reached <Tex math="t" /> = {timeText(progress.t_s)}</> : 'starting'}</>
          ) : r ? (
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
      {r?.breakdown && !r.terminationMessage && (
        <div className="notice">
          From t = {timeText(r.breakdown.t_s)} the model is outside its controlled range: {r.breakdown.message.replace(/\.$/, '')}.
          The run went on because stopping at breakdown is off; treat later results as model-dependent.
        </div>
      )}
      </>)}

      <dl className="kv">
        <dt>peak <Tex math="k_{p,0}" /> (μm⁻¹)</dt><dd>{fixed(desc.kp0_um_inv, 4)}</dd>
        <dt>density <Tex math="n" /> (μm⁻³)</dt><dd>{fmt(derived.density_um3)}</dd>
        <dt><Tex math="na" /> (μm⁻²)</dt><dd>{pairMode && derived.na_um2 != null ? `± ${fmt(Math.abs(derived.na_um2))}` : fmt(derived.na_um2)}</dd>
        <dt><Tex math="k_\xi = \sqrt{8\pi n|a|}" /> (μm⁻¹)</dt><dd>{fmt(scales.kXi)}</dd>
        <dt>time unit <Tex math="t_0 = \hbar/|g|n" /> (ms)</dt><dd>{scales.t0_s != null ? fmt(scales.t0_s * 1e3) : 'n/a'}</dd>
      </dl>
      {frameView && (
        <dl className="kv now" aria-live="off">
          <dt className="kv-head">At <Tex math="t" /> = {timeText(frameView.t_s)}</dt><dd />
          <dt title="Peak of the shell spectrum k²nₖ.">peak <Tex math="k_p(t)" />{pairMode ? ', +a' : ''} (μm⁻¹)</dt><dd>{fixed(frameView.kp, 4)}</dd>
          {pairMode && frame?.partnerSnap && (
            <><dt title="Peak of the shell spectrum k²nₖ of the −a run at the same time.">peak <Tex math="k_p(t)" />, −a (μm⁻¹)</dt><dd>{fixed(frame.partnerSnap.kp_um_inv, 4)}</dd></>
          )}
          <dt title="Peak of k⁴nₖ, where the kinetic energy sits; found like kₚ.">energy peak <Tex math="k_E(t)" /> (μm⁻¹)</dt><dd>{fixed(frameView.kE, 4)}</dd>
          <dt><Tex math="k_p/k_{p,0}" /></dt><dd>{fixed(frameView.kp / desc.kp0_um_inv, 4)}</dd>
          {frameView.loop != null && (
            <><dt title="Mean of M − 1 over the collisions, weighted by their rate.">loop strength <Tex math="\langle M\rangle - 1" /></dt><dd>{signed(frameView.loop, 4)}</dd></>
          )}
        </dl>
      )}

      {running && <div className="progress" aria-hidden="true"><span style={{ width: `${Math.round(100 * Math.min(1, Math.max(0.03, progress.pct)))}%` }} /></div>}
      <Status state={statusState}>{statusText}</Status>
      {running && !pairMode && progress.loopDressing != null && settings.model !== 'bare' && (
        <div className="hint">live {liveLoopText(progress, hasPole)}</div>
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
            Run {pairMode ? '±a' : 'simulation'} ({MODEL_BY_ID[settings.model].short})
          </button>
        )}
        <button type="button" className="btn big" onClick={onRunAll} disabled={!canRun || running}>
          Run all models{pairLabel}
        </button>
      </div>
    </Card>
  );
}

/**
 * Headline of a ±a pair: one column per sign with its stop time, live progress and verdicts, and below them
 * the ratio of the two stop times.
 */
function PairHero({ record, partner, aAbs_a0, stale, progress, superseded, stopKpFraction, model, hasPole }: {
  record: RunRecord | null;
  partner: RunRecord | null | undefined;
  aAbs_a0: number | null;
  stale: boolean;
  progress: RunProgress;
  superseded: boolean;
  stopKpFraction: number;
  model: RunRecord['result']['model'];
  hasPole: boolean;
}) {
  const cols: Array<{ sign: Sign; rec: RunRecord | null }> = [{ sign: 1, rec: record }, { sign: -1, rec: partner ?? null }];
  const even = !superseded && (record?.mirrored || partner?.mirrored);
  const tp = superseded ? null : record?.result.dtTarget_s ?? null;
  const tm = superseded ? null : partner?.result.dtTarget_s ?? null;
  const err = (rec: RunRecord | null | undefined) => (rec?.check && rec.check !== 'pending' && rec.check.dtRel != null ? Math.abs(rec.check.dtRel) : null);
  let ratioLine: ReactNode = null;
  if (even) {
    ratioLine = <>The bare equation is even in <Tex math="a" />: one run stands for both signs.</>;
  } else if (tp != null && tm != null) {
    const ratio = tm / tp;
    const ep = err(record), em = err(partner);
    const tol = ep != null && em != null ? ep + em : null;
    const verdict = tol != null && Math.abs(ratio - 1) <= tol
      ? `equal within the convergence checks (± ${pct(tol, 2)})`
      : ratio < 1 ? `attraction ${pct(1 - ratio)} faster` : `attraction ${pct(ratio - 1)} slower`;
    ratioLine = <><Tex math="t_-/t_+" /> = {ratio.toFixed(4)} · {verdict}</>;
  } else if (!superseded && (record || partner)) {
    ratioLine = <span className="muted">The ratio needs both runs to reach the target.</span>;
  }
  const aText = aAbs_a0 != null ? fmt(aAbs_a0, 4) : '|a|';
  return (
    <div className="hero">
      <span className="label">
        Time for <Tex math="k_p" /> to fall to {stopKpFraction} <Tex math="k_{p,0}" />
      </span>
      <div className="pair-hero">
        {cols.map(({ sign, rec }) => {
          const r = superseded ? null : rec?.result ?? null;
          const live = superseded ? progress.perSign[sign > 0 ? '+' : '-'] : undefined;
          const t = time(r?.dtTarget_s ?? null);
          const e = r ? err(rec) : null;
          return (
            <div key={sign} className="pair-col" aria-label={`a = ${sign > 0 ? '+' : '−'}${aText} a₀`}>
              <div className="pair-head">
                <span className="sw" style={{ ['--c' as string]: modelColor(r?.model ?? model, sign) }} />
                <Tex math={`a = ${sign > 0 ? '+' : '-'}${aText}\\,a_0`} />
              </div>
              <div className="hero-num" aria-live="polite">
                {superseded
                  ? <span className="pending">{live?.done ? 'done' : 'running'}</span>
                  : r && r.dtTarget_s != null ? t.value : r ? 'not reached' : 'n/a'}
                {r && r.dtTarget_s != null && <small>{t.unit}</small>}
                {e != null && <span className="pm">± {pct(e, 2)}</span>}
              </div>
              {superseded && live && (
                <>
                  <div className="progress" aria-hidden="true"><span style={{ width: `${Math.round(100 * Math.min(1, Math.max(0.03, live.pct)))}%` }} /></div>
                  <div className="hint">
                    {live.phase === 'setup' ? 'building tables' : live.pct >= 1 && !live.done ? 'target reached, evolving on with the other sign' : `${Math.round(100 * live.pct)}%`}
                    {live.t_s != null ? <> · <Tex math="t" /> = {timeText(live.t_s)}</> : null}
                    {live.kp != null ? <> · <Tex math="k_p" /> = {fmt(live.kp, 4)} μm⁻¹</> : null}
                  </div>
                  {live.loopDressing != null && model !== 'bare' && (
                    <div className="hint" title={liveLoopText(live, hasPole)}>
                      ⟨M⟩ − 1 = {fmt(live.loopDressing, 3)}
                      {Number.isFinite(live.poleShare ?? NaN) ? ` · M > ${POLE_DRESSING_LIMIT} on ${sharePercent(live.poleShare!)}` : ''}
                    </div>
                  )}
                </>
              )}
              {r && rec && (
                <div className="badges">
                  {runVerdicts(rec, stale).map((b) => <Badge key={b.text} tone={b.tone} title={b.title}>{b.text}</Badge>)}
                </div>
              )}
              {r?.terminationMessage && <div className="notice bad">{r.terminationMessage}</div>}
              {r?.breakdown && !r.terminationMessage && (
                <div className="notice">
                  From t = {timeText(r.breakdown.t_s)} the model is outside its controlled range; later results are model-dependent.
                </div>
              )}
              {!superseded && !rec && <p className="hint">Not run at this sign yet.</p>}
            </div>
          );
        })}
      </div>
      {ratioLine && <div className="pair-ratio">{ratioLine}</div>}
    </div>
  );
}
