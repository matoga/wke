/**
 * Sensitivity sliders. These update the analytical result on every tick; the
 * WKE is only re-run when the user presses Run in the simulation panel, so
 * dragging never queues a solve.
 */

import React from 'react';
import { Card, Slider, Metric, Callout } from '../ui/primitives';
import { sig, expo, seconds, pct } from '../ui/theme';
import { predictDeltaT, inferNA } from '../physics/calibration';
import { BOHR_RADIUS_UM } from '../physics/constants';
import type { SpectralDescriptors } from '../physics/descriptors';
import type { ParameterMode } from '../types/wke';

export interface SliderState {
  a_a0: number;
  density_um3: number;
  dtScale: number;
}

export function SensitivityCard({
  mode, desc, state, base, onChange, onRestore, onApply, dirty,
}: {
  mode: ParameterMode;
  desc: SpectralDescriptors | null;
  state: SliderState;
  /** the values the sliders were initialized from, for the restore button */
  base: SliderState & { dt_measured_s: number | null };
  onChange: (s: SliderState) => void;
  onRestore: () => void;
  onApply: () => void;
  dirty: boolean;
}) {
  if (!desc) return null;

  const inverse = mode === 'measured_dt';
  const na = state.density_um3 * state.a_a0 * BOHR_RADIUS_UM;
  const dtBase = base.dt_measured_s;
  const dtScaled = dtBase != null ? dtBase * state.dtScale : null;

  const naInferred = dtScaled != null && dtScaled > 0 ? inferNA(desc, dtScaled) : null;
  const dtPredicted = na > 0 ? predictDeltaT(desc, na) : null;

  const baseNa = base.density_um3 * base.a_a0 * BOHR_RADIUS_UM;

  return (
    <Card
      title="Sensitivity"
      actions={
        <button
          className="btn-secondary text-2xs py-1"
          onClick={onRestore}
          disabled={!dirty}
        >
          Restore inputs
        </button>
      }
    >
      <div className="space-y-3">
        <Slider
          label="scattering length a"
          unit="a₀"
          value={state.a_a0}
          min={Math.max(1, base.a_a0 / 10)}
          max={base.a_a0 * 10}
          log
          format={(v) => v.toPrecision(4)}
          onChange={(v) => onChange({ ...state, a_a0: v })}
        />
        {!inverse && (
          <Slider
            label="density n"
            unit="μm⁻³"
            value={state.density_um3}
            min={base.density_um3 / 10}
            max={base.density_um3 * 10}
            log
            format={(v) => v.toPrecision(4)}
            onChange={(v) => onChange({ ...state, density_um3: v })}
          />
        )}
        {inverse && dtBase != null && (
          <Slider
            label="measured Δt₁ᐟ₂ scale"
            unit="×"
            value={state.dtScale}
            min={0.25}
            max={4}
            log
            format={(v) => v.toFixed(3)}
            onChange={(v) => onChange({ ...state, dtScale: v })}
          />
        )}

        <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
          {inverse ? (
            <>
              <Metric label="scaled Δt₁ᐟ₂" value={seconds(dtScaled)} />
              <Metric label="inferred na" value={naInferred != null ? expo(naInferred) : '-'} unit="μm⁻²" emphasis />
              <Metric
                label="n from slider a"
                value={naInferred != null ? sig(naInferred / (state.a_a0 * BOHR_RADIUS_UM)) : '-'}
                unit="μm⁻³"
              />
            </>
          ) : (
            <>
              <Metric label="na" value={expo(na)} unit="μm⁻²" />
              <Metric label="formula Δt₁ᐟ₂" value={seconds(dtPredicted)} emphasis />
              <Metric
                label="change vs measured values"
                value={baseNa > 0 ? pct((na - baseNa) / baseNa) : '-'}
                title="Δt scales as (na)⁻², so a 10% change in na moves Δt by about 21%."
              />
            </>
          )}
        </div>

        {dirty && (
          <>
            <Callout tone="warning">
              Preview only. Apply this scenario before running the WKE.
            </Callout>
            <button className="btn-primary w-full justify-center text-xs" onClick={onApply}>
              Use for next simulation
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
