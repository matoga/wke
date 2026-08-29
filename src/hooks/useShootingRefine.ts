/**
 * "Refine with simulation": a small shooting method that corrects the
 * calibration-formula na against the actual classical WKE, for when a measured
 * Δt₁ᐟ₂ is available.
 *
 * The formula inversion na = √(κ k_p² C_shape / Δt) is exact for the formula,
 * but the formula is itself only an approximation of the kinetic equation
 * (see docs/VALIDATION.md §5 — residuals up to ~19% on a real profile). This
 * refines na so that the *direct solve*, not the formula, reproduces the
 * measured time.
 *
 * Classical Δt(na) depends on n and a only through na (validated in
 * cross_validation.test.ts), and is very nearly ∝ na⁻² — so the shooting
 * method is a Newton-style update on that near-power-law rather than a blind
 * bisection: na_{i+1} = na_i · √(Δt(na_i) / Δt_target). It converges in a
 * handful of solves.
 */

import { useCallback, useRef, useState } from 'react';
import { BOHR_RADIUS_UM, REFERENCE_DENSITY_UM3 } from '../physics/constants';
import type { KernelType } from '../physics/collision';
import type { WKERunRequest, WKEResponse } from '../types/wke';

export interface ShootingStep {
  iteration: number;
  na_um2: number;
  dtWKE_s: number;
}

export interface ShootingResult {
  na_um2: number;
  dtWKE_s: number;
  steps: ShootingStep[];
  converged: boolean;
}

const MAX_ITERATIONS = 6;
const TOLERANCE = 0.002; // 0.2% on Δt

export function useShootingRefine() {
  const workerRef = useRef<Worker | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ShootingStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runOnce = useCallback((q: number[], density_um3: number, a_a0: number, speciesKey: string): Promise<number> => {
    workerRef.current ??= new Worker(new URL('../workers/wke.worker.ts', import.meta.url), { type: 'module' });
    const worker = workerRef.current;
    const runId = `shoot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent<WKEResponse>) => {
        const msg = e.data;
        if (msg.runId !== runId) return;
        if (msg.type === 'progress') return;
        worker.removeEventListener('message', handler);
        if (msg.type === 'error') { reject(new Error(msg.message)); return; }
        if (!msg.reachedHalf || msg.dtHalf_s == null) {
          reject(new Error('classical run did not reach k_p,0/2 within the time budget'));
          return;
        }
        resolve(msg.dtHalf_s);
      };
      worker.addEventListener('message', handler);
      const req: WKERunRequest = {
        type: 'run',
        runId,
        kernel: 'classical' as KernelType,
        q,
        density_um3,
        a_a0,
        speciesKey,
        tauMax: 400,
        rtol: 1e-6,
        nSnapshots: 8, // the shooting method only reads dtHalf_s, not the timeline
      };
      worker.postMessage(req);
    });
  }, []);

  const refine = useCallback(async (
    q: number[],
    naGuess_um2: number,
    dtTarget_s: number,
    speciesKey: string,
  ): Promise<ShootingResult> => {
    setRunning(true);
    setError(null);
    setSteps([]);
    const history: ShootingStep[] = [];
    let na = naGuess_um2;

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const a_a0 = na / REFERENCE_DENSITY_UM3 / BOHR_RADIUS_UM;
        const dt = await runOnce(q, REFERENCE_DENSITY_UM3, a_a0, speciesKey);
        const step = { iteration: i + 1, na_um2: na, dtWKE_s: dt };
        history.push(step);
        setSteps([...history]);

        const rel = Math.abs(dt - dtTarget_s) / dtTarget_s;
        if (rel < TOLERANCE) {
          return { na_um2: na, dtWKE_s: dt, steps: history, converged: true };
        }
        na = na * Math.sqrt(dt / dtTarget_s);
      }
      return {
        na_um2: history[history.length - 1].na_um2,
        dtWKE_s: history[history.length - 1].dtWKE_s,
        steps: history,
        converged: false,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setRunning(false);
    }
  }, [runOnce]);

  const reset = useCallback(() => { setSteps([]); setError(null); }, []);

  return { refine, running, steps, error, reset };
}
