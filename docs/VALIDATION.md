# Validation

How the solver is checked, and how accurate it is. Everything below is reproduced by

```bash
npm test          # physics, loop models, UI smoke test, provenance audit
npm run bench     # convergence study (slow; see scripts/convergence-bench.ts)
```

## 1. Bare kinetic equation against an independent solver

`tests/physics.test.ts` compares the browser solver with fixtures from an independent reference solver
(`shared-data/fixtures.json`). For this comparison it uses the reference's own configuration, the hidden *parity*
level: 500 grid points on p ∈ (0.01, 20), 16 Gauss nodes per segment, and the three-point peak estimator.

| Check | Result |
| --- | --- |
| Collision events | 488 560, identical to the reference |
| ξ, t₀, N_cal, na | agree to 10⁻¹² |
| Descriptors kₚ,₀, ⟨k⟩, FWHM of the three reference spectra | agree to 10⁻¹⁰ |
| Half-time, classical and Bose +1 kernels, three spectra | within 1% (the requirement) |
| kₚ(t) at the reference's output times | within 2 × 10⁻³ |
| Partitioned right-hand sides (used for multi-threading) | add up to the full one to 10⁻¹³ |
| Bare dynamics for a and −a | identical to 10⁻¹² |
| Dynamics at (n, a) and (4n, a/4) | identical stop time to 2 × 10⁻³ |
| Continuing a finished run | reproduces an uninterrupted run to 5 × 10⁻⁴ in kₚ |

These checks prove the port is faithful. They do not prove it is accurate: the parity configuration is itself
under-resolved (section 3).

## 2. Loop functionals and renormalised models

`tests/loops.test.ts` checks the loop machinery against values computed independently in the continuum (adaptive
quadrature, cross-checked by Monte Carlo over the resonant manifold), for a Gaussian shell at k_ξ/kₚ = 0.15.

| Check | Result |
| --- | --- |
| H(x) at five points, 500-point grid | within 5.4 × 10⁻⁴ |
| same on a 2000-point grid | within 3.3 × 10⁻⁵ (second-order convergence) |
| Re L₋ and Im L₋ at six (Q, ω), Re L₊ at four (P, ω₊) | within 10⁻³ |
| Static limit χ₀ = −(1/N_cal)∫f dp | within 10⁻⁴ |
| Power-law spectrum f ∝ s^(−7/3) | within 2 × 10⁻⁵ |
| C_model/C_bare at five grid momenta, one loop, chain, heuristic A, both signs of a | within 4.5 × 10⁻³ (parity), 4 × 10⁻³ (Standard), 4 × 10⁻⁴ (High quadrature) |
| Loops switched off | every model equals the bare equation to 10⁻¹³ |
| One loop is odd in a | C(+a) + C(−a) = 2 C_bare to 10⁻¹⁴ |
| First order | (heuristic A − bare) = 4 (chain − bare) to 10⁻⁴; heuristic B = one loop to 1.3 × 10⁻⁴ |
| Number and energy balance | within 15% of the bare scheme's for every model and sign |
| Rayleigh-Jeans state | stays a fixed point at the bare discretisation level |
| Pole and negative-bracket stops | trip at strong coupling and end the run cleanly |

The largest ratio deviations sit on the upper flank of the shell, where the error is the bare partner quadrature,
not the loops.

## 3. Convergence of the stop time

`scripts/convergence-bench.ts` runs the bare classical equation to kₚ = kₚ,₀/2 on a Gaussian shell and on a
measured spectrum with structure, at the reference conditions (³⁹K, n = 2.8331 μm⁻³, a = 50 a₀), varying the state
grid and the partner quadrature independently.

**The peak estimator.** With a three-point parabola through the grid maximum, the stop time scattered by ±0.2%
between grids and did not converge: late in a run the peak is broad and flat, and grid-level wiggles move its
maximum. kₚ is now the vertex of a least-squares parabola through the top 2% of ln(k² n_k) against ln k. With it,
the stop time converges monotonically and the jitter of kₚ(t) falls from 4 × 10⁻³ to below 6 × 10⁻⁴.

**Quadrature.** At 1000 grid points, 12 Gauss nodes on 2 panels per segment change the Gaussian's stop time by
less than 10⁻⁴ against 12 × 3 and 16 × 4. Fewer nodes (8 × 2) are off by 1 to 3%. The partner quadrature is
therefore fixed at 12 × 2 above Draft, and the accuracy levels refine the grid.

**Grid.** Stop time relative to the 2000-point value:

| Grid points | Gaussian shell | Gaussian at 4 × na | Measured spectrum |
| --- | --- | --- | --- |
| 400 | −1.0 × 10⁻³ | −3.2 × 10⁻⁴ | −6.4 × 10⁻⁴ |
| 500 (Standard) | −4.8 × 10⁻⁴ | −4.9 × 10⁻⁴ | +3.9 × 10⁻³ |
| 700 | −2.6 × 10⁻⁴ | −3.3 × 10⁻⁴ | +2.6 × 10⁻³ |
| 1000 (High) | −1.7 × 10⁻⁴ | −1.1 × 10⁻⁴ | +1.3 × 10⁻⁴ |
| 1400 | −1.0 × 10⁻⁴ | −2.5 × 10⁻⁵ | −4.2 × 10⁻⁴ |

The parity configuration (500 points, 16 × 1) is 5% off on the measured spectrum: its single low-momentum panel
spans seven e-folds with 16 nodes, coarser than a spectral peak.

## 4. Accuracy levels

| Level | Grid | Quadrature | Events | Stop time, smooth shell | Stop time, structured spectrum |
| --- | --- | --- | --- | --- | --- |
| Draft | 300 | 12 × 1 | 0.17 M | about 2% | about 4% |
| Standard | 500 | 12 × 2 | 1.1 M | 0.05% | 0.5% |
| High | 1000 | 12 × 2 | 2.2 M | 0.02% | 0.1% |
| Reference | 2000 | 12 × 2 | 4.4 M | reference | reference |

**Check convergence** in the app reruns any run one level higher and reports the difference in stop time and the
largest difference in kₚ(t).

## 5. Interface

`tests/ui_smoke.test.tsx` mounts the application in jsdom with a stub solver. It checks the model and accuracy
controls, negative scattering lengths, runs of one and of all models, the comparison table, the pole-stop message,
the convergence check, continuation, and the text rules: no em dashes, units in round brackets, no fixed-width
fonts, equations typeset.

`tests/audit.test.ts` scans sources, tests, scripts, documentation, data and the built bundle for identifiers from
a private list (held only as hashes), preprint identifiers, local paths, references to scripts outside the app, em
dashes and fixed-width fonts.

## 6. Performance

Measured in Chrome on an 8-core laptop with 7 compute workers, Gaussian shell, reference conditions.

| Run | Wall time |
| --- | --- |
| One loop, Standard | about 12 s |
| All four models, Standard | about 25 s |
| All four models, Draft | about 4 s |

A loop-model right-hand side costs 10 to 20 times a bare one: the loop functionals and channel tables are rebuilt
at every evaluation.
