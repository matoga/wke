# Bose Gas Kinetics

A browser solver for the isotropic wave kinetic equation of a three-dimensional Bose gas. Give it a momentum
spectrum, a density and a scattering length, and it integrates the four-wave kinetic equation forward in time,
either bare or with loop-renormalised collisions, and shows how the spectrum cascades and how fast its peak moves.

Everything runs in the page: no backend, no network request after the page has loaded, no data leaves the browser.
The collision sum is split across the processor's cores with Web Workers.

## Setup

```bash
npm install
npm run dev        # development server
npm run build      # typecheck, then a static bundle in dist/
npm run preview    # serve the bundle
npm test           # physics, loop models, UI smoke test, provenance audit
npm run bench      # manual convergence benchmark (slow)
```

The bundle in `dist/` is static and can be served from any file server. It cannot be opened as a bare `file://`
URL, because module Web Workers need an HTTP origin.

## What is solved

For occupations much larger than one, the momentum distribution of a weakly interacting gas with contact coupling
g = 4πħ²a/m obeys the four-wave kinetic equation. In units where ω_p = p², τ = ħt/2m and λ = 4πa,

```
∂τ n₁ = 16πλ² ∫ d³p₂ d³p₃ d³p₄  n₁n₂n₃n₄ (1/n₁ + 1/n₂ − 1/n₃ − 1/n₄) M₁₂₃₄  δ(ω₁ + ω₂ − ω₃ − ω₄) δ³(p₁ + p₂ − p₃ − p₄)
```

The spectrum is isotropic, so the solver works with |p| only and does every angular integral exactly. The models
differ in the collision dressing M, built from two one-loop bubbles of the current spectrum: the particle-particle
bubble L₊ at total momentum |p₁ + p₂| and the exchange bubble L₋ at transfer |p₄ − p₂|. The app's Method section
gives both in full.

| Model | Dressing M | Contents |
| --- | --- | --- |
| Bare | 1 | Leading order. Even in a. |
| One loop, N = 1 | 1 + 2⟨Re L₊⟩ + 8⟨Re L₋⟩ | Exact next order for a one-component gas. Odd in a. |
| Bubble chain, N → ∞ | ⟨\|1 − L₋\|⁻²⟩ | Large-N exchange chain on the one-component tree level. |
| O(N) model, large N | as the chain, with t → 2N t | N-component model at leading order in 1/N. |
| Heuristic, N = 1 | ⟨\|1 − 4L₋\|⁻²⟩ | Exchange chain with the one-component rung weight. Omits L₊ and crossed diagrams; its pole location is not derived. |

⟨·⟩ is the average over the angular configurations of each collision: for fixed magnitudes the transferred
momentum is uniformly distributed over an interval of length 2·min(p₁, p₂, p₃, p₄), and the whole dressing is
averaged there. Loops scale as (k_ξ/k_p)² with k_ξ = √(8πn|a|), so the classical dynamics depend on n and a only
through na and the sign of a. Attractive gases (a < 0) are supported.

The loop models use classical wave statistics; the bare equation can add the Bose f → f + 1 terms. A one-loop run
stops when its bracket turns negative on more than 0.1% of the collision weight, and a resummed run stops when
1/|1 − cL₋|² reaches 10.

## Using the app

- **Initial state**: pick a preset, paste or upload two columns (k in μm⁻¹, then either the isotropic density n(k)
  with N = 4π∫k²n(k)dk, or the shell distribution Nₖ/N), or draw Nₖ(k) by hand. The convention is never guessed.
- **Setup**: the model, the accuracy level, the stop target kₚ/kₚ,₀, and the gas: species, scattering length a (a₀),
  and either N with a box volume V (μm³), N with a cylinder (L, R/L), or the density n (μm⁻³) directly.
- **Result**: the time for the peak kₚ to fall to the target, with verdicts on loop strength, run outcome and
  conservation. **Run all models** runs every model on the same setup for comparison.
- **Evolving spectrum**: replay of the saved states, animated or overlaid; **Continue** integrates further from the
  last state.
- **Export**: CSV of the initial spectrum, the final state, the whole trajectory, or kₚ(t) of all compared runs,
  each with a header recording model, accuracy and parameters.

## Accuracy

One control sets grid size, partner quadrature, loop tables and integrator tolerance together, so only validated
combinations run. Tick **Check convergence** to rerun any run one level higher and report the difference.

ACCURACY_TABLE

## Implementation

| File | Role |
| --- | --- |
| `src/physics/collision.ts` | Reduced collision event table: Gauss-Legendre partner quadrature, per-target and per-pair layout, partitioning by target. |
| `src/physics/loops.ts` | Loop functionals H(x) and J(x) by exact product integration; Re L₊, Re L₋ and Im L₋ as divided differences. |
| `src/physics/channels.ts` | Cumulative t-channel tables per (target, partner) pair for the angular averages. |
| `src/physics/rhs.ts` | Right-hand sides of all models, with diagnostics and stop rules. |
| `src/physics/integrator.ts` | Adaptive Dormand-Prince 5(4) with dense output and event location on kₚ(t). |
| `src/physics/simulate.ts` | One run from input spectrum to packaged result, independent of threading. |
| `src/workers/` | Solver worker and the pool of compute workers that share the collision sum. |
| `src/state/`, `src/components/` | Application state and the interface. |

## Validation

`docs/VALIDATION.md` describes the test suites and the convergence study.
