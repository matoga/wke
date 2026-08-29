/**
 * A compact reminder of which spectrum is loaded, shown at the top of the
 * Calibrate tab so its numbers are never a mystery — the spectrum itself is
 * picked in the Simulate tab, not here.
 */

import React from 'react';
import { Badge } from '../ui/primitives';
import { sig } from '../ui/theme';
import type { PreparedSpectrum } from '../physics/spectrum';
import type { SpectralDescriptors } from '../physics/descriptors';

export function SpectrumSummaryStrip({
  spectrum, desc, onGoToSimulate,
}: {
  spectrum: PreparedSpectrum | null;
  desc: SpectralDescriptors | null;
  onGoToSimulate: () => void;
}) {
  return (
    <div className="card px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-2xs text-slate-500 dark:text-slate-400 shrink-0">Using</span>
      {spectrum && desc ? (
        <>
          <span className="text-sm font-medium">{spectrum.raw.label}</span>
          <Badge tone="neutral">k_p,0 = {sig(desc.kp0_um_inv, 3)} μm⁻¹</Badge>
          <Badge tone="neutral">C_shape = {desc.c_shape.toFixed(3)}</Badge>
        </>
      ) : (
        <span className="text-sm text-slate-500 dark:text-slate-400">no spectrum loaded</span>
      )}
      <button className="btn-ghost text-2xs py-1 ml-auto" onClick={onGoToSimulate}>
        Change in Simulate →
      </button>
    </div>
  );
}
