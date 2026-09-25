# Analysis studies

Headless runs of the app's own solver, organised as reproducible studies with figures.

## Layout

| Path | In git | What |
| --- | --- | --- |
| `run.ts` | yes | One run: a state, a value of a, a model; writes one JSON (see below). |
| `study.ts` | yes | Runs a study definition in parallel under per-run wall-time caps, then the plots. |
| `promote.ts` | yes | Copies a finished study into `reports/`. |
| `studies/*.json` | yes | Study definitions: question, model, accuracy, target k_ξ/k_p, caps, runs. |
| `plots/*` | yes | Figure scripts (Python, matplotlib) sharing one house style (`plots/common`). |
| `results/<date>_<study>/` | no | Every study run: exploratory, test and superseded results. |
| `reports/<date>_<study>/` | yes | Promoted results only: README, manifest, figures with their data. |
| `.venv/` | no | Local plotting environment. |

## Running

```sh
python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt   # once
npx tsx analysis/study.ts analysis/studies/chain-gaussian-a-scan.json          # runs, then plots
analysis/.venv/bin/python analysis/plots/make_all.py analysis/results/<study>  # redo plots only
npx tsx analysis/promote.ts <study-folder-name>                                 # keep it
npm run test:audit                                                              # reports are published
```

A study folder holds `study.json` (the definition as run), `manifest.json` (command, solver git
commit and whether solver files had uncommitted changes, timings, status of every run),
`runs/*.json`, `plots/*.pdf` and a generated `README.md` with a table of all runs.

## Conventions

- **Every figure has its data.** `plots/<name>.pdf` comes with `plots/<name>.npz` holding
  exactly the arrays drawn, keyed `<run>__<quantity>` (and `guide__*` for guide lines).
- **Runs** (`runs/*.json`, schema `wke-analysis-run/1`): settings, scales, initial k_p and
  E/N, rate points and occupation snapshots, `status` (`target`, `wall-cap`, `pole`,
  `nonfinite`, or `running` for a stopped run's last save).
- **The rate** (m/ħ) d(1/k_p²)/dt is taken at each sample from the collision term itself: the
  smooth peak k_p is differentiated along df/dτ. No time window is used, so fast late
  evolution is resolved. The error bar is the spread over two peak-fit widths and two steps.
- **The coherence length** is ℓ³ = f(k→0)/(η n), f the occupation per mode, n the density and η the
  equilibrium condensed fraction, so that ℓ³ = V in equilibrium. For Bose +1 runs η = η_eq, the
  ideal-Bose condensed fraction at the run's n and initial E/N; classical runs use η = 1, because
  their Rayleigh-Jeans equilibrium depends on the grid cutoff. **Notation:** the length with η = 1,
  ℓ̄³ = f(k→0)/n, is always written ℓ̄ (classical runs, and the raw `ell_um`, `ellRate`, `ellRateErr`
  fields that `run.ts` stores); ℓ is reserved for the η_eq-normalised length. Figures and `.npz` keys
  follow this (`ellbar_*` against `ell_*`), and a figure refuses to mix the two. f₀ = f(k→0) is e^A from a least-squares fit ln f = A + B k² over
  all grid points with k ≤ k_p/5 (the low-k plateau), and (m/ħ) dℓ²/dt is taken from the
  collision term through the same fit at every rate sample. The error bar is the spread over the
  fit windows k_p/5 and k_p/10 and two steps. Runs made before this was recorded fall back to finite differences
  over the n_k snapshots, without error bars (`plots/ell.pdf`, which says so in its title).
- **k_p** is the vertex of a parabola fitted to ln(k² n_k) against ln k with weights
  exp(−(L_max − L)/δ), δ = 0.02, so it has no steps when grid points enter or leave the fit.
- **The grid** is extended down to `pMin` k_ξ (default 0.001) at the accuracy level's
  points per decade, so k_ξ/k_p up to about 25 stays resolved.
- **Units** in round brackets; E/N is the kinetic energy per atom of the initial state,
  ħ²⟨k²⟩/2m, which does not depend on a.
- **Figure style:** marker = initial state, colour = a (ordered scale), points with error
  bars without caps, guides as thin grey labelled lines, legends outside the axes.

## Comparison with experiment

A study with an `experiment` field is compared with the published measurements of coherence spreading
in a box of ³⁹K (13 series). The data folder is not in the repository: pass it as
`make_all.py <study> --experiment <dir>` or set `WKE_EXPERIMENT_DATA`. Each run carries its series
number as a label (`"label": "s01"` in the study, so the file is `s01_...json`), with the series'
protocol (P1, P2, P3 = the presets Measured state C1, C2, C3), a and density N/V, and a target
k_p = π/V^(1/3), twice past the box scale 2π/V^(1/3). `plots/experiment.py` then draws:

- `experiment_rate`: (m/ħ) dℓ²/dt against (ℓ/ξ)² with the published points (lin-log, log-log, lin-lin);
- `experiment_D`: D against na, t* against the published t*, and (ℓ/ξ)² at t*. D and t* come for both
  from the same linear fit ℓ² = D (ħ/m)(t − t*) over (ℓ/ξ)² from 200 to 1000, which reproduces the
  published D and t* from the published series;
- `experiment_collapse`: ℓ² against t − t* and (ℓ/ξ)² against (t − t*)/t_ξ;
- `experiment_kappa`: the IR exponent κ of n_k ∝ 1/(1 + (k/k₀)^κ) for the WKE and the measured spectra,
  and one n_k comparison at k_p ≪ k_ξ matched in ℓ.
- `fig4c` (`plots/fig4c.py`): the Fig 4c analogue in the paper's style. Each series' WKE rate and (ℓ/ξ)² are
  sampled at that series' measured times, pooled, and binned with edges halfway between the published
  (ℓ/ξ)² values; error bars are standard errors. Left: WKE only; right: with the published points and the
  per-series WKE curves. Guides: (ℓ/ξ)²/56 (ℓ² ∝ exp(t/τ), τ = 56 t_ξ) and D = 3.4. Series 8 and 10 (low N)
  are left out; variants:
  - `fig4c_all_sets`: fig4c with every series;
  - `fig4c_resc`: fig4c with the WKE rates divided by 3.3;
  - `fig4c_mod2`: η_eq recomputed at every sample from the drifting particle number and energy;
  - `fig4c_mod3`: η(t) from a μ = 0 Bose-Einstein fit of the thermal tail (check figure `fig4c_mod3_eta`);
  - `fig4c_kp`: the same with 1/k_p in place of ℓ, the published points and D rescaled by 1/c²;
  - `fig4_mod`: the ℓ figure with the WKE taken through k_p, ℓ = c/k_p.
  c = k_p ℓ is fitted on the WKE alone. These use the wide peak k_p of N_k ∝ k² n_k (`run.ts` fields `kpw_um_inv`,
  `kpwRate`: a parabola of ln N_k over the top ≳ max/2), which does not hop between the bumps of a broad top.
  `plots/kp_extraction.py` shows the extraction on the spectra.

The published ℓ uses the same normalisation as ℓ here at early times but carries a deconvolution
that is not undone; the published n_k is per volume, n_k = V f/(2π)³; the published spectra of
series 1 to 3 are labelled by t − t*.

## Bidirectional scaling experiment

A study with a `bidirectional` field is compared with the published measurements of bidirectional
dynamic scaling in a quench-cooled box of ³⁹K: N ≈ 2.7×10⁴ atoms in a cylinder of diameter 25 µm and
length 42 µm, E/N ≈ 12 nK, with a = 100 to 800 a₀ switched on at t = 0. The data folder is not in the
repository: pass it as `make_all.py <study> --bidir-data <dir>` or set `WKE_BIDIR_DATA`.

- **Initial state.** `Measured state D` (`measured_d`) is the average of the ten measured t = 0 spectra.
  Every a starts from the same state, because the state is prepared with a → 0. It is built by
  `plots/bidir_initial.py` into `shared-data/measured-state-d.json` and holds N/V = 1.317 µm⁻³. The
  spectrum is cut at its first negative point (4.35 µm⁻¹), which keeps the measured E/N = 11.7 nK;
  clipping the noisy tail to zero would add 10%.
- **Runs.** They stop at a physical time (`tmax_ms`, 2560 ms) and take snapshots at given times
  (`snapTimes_ms`). These are 20 per decade, plus the measured times t and t (300 a₀/a), so that
  comparisons at equal t ā need no interpolation. A stop at k_ξ/k_p = 300 ends a run that blows up;
  `breakdown: "stop"` ends a one-loop run when its bracket turns negative.
- **Analysis.** `plots/bidir_fit.py` treats the WKE and the measured n_k alike. Applied to the data, it
  reproduces:
  - the published α and β at 150, 300 and 600 a₀, within their errors;
  - p_IR, p_UV = 0.93(11), 1.25(39) from series 1 and 1.00(2), 1.13(13) from series 2, against the
    published 0.9(1) and 1.1(1);
  - T_low at every time;
  - N_QC from 80 ms on, and Δ_k at every time.

  The definitions it uses:
  - T_peak: ħ²k_peak²/2m = 1.594 k_B T, the peak of a μ = 0 Bose E_k;
  - T_low: E_k = 4πV k_B T k²/(2π)³, fitted over 0.5 to 1.2 µm⁻¹;
  - N_QC: the intercept of a line fitted to F_k over 0.8 to 1.2 µm⁻¹;
  - Δ_k: the k where F_k minus the fitted thermal line reaches N_QC/2.
- **Figures.**
  - `bidir_spectra`: N_k and E_k at 300 a₀.
  - `bidir_temps`: T_peak and T_low.
  - `bidir_condensate`: N_QC/N and Δ_k against t ā.
  - `bidir_exponents`: α_IR/3, β_IR, α_UV/5, β_UV per a.
  - `bidir_collapse`: the IR and UV collapse.
  - `bidir_clock`: the clock exponent p of t → t (a/300 a₀)^p in two ways. First, the best collapse of
    all a together over t ā ∈ [20, 160] ms. Second, p = −d ln t_level/d ln a, from the time at which
    each a reaches a level of N_QC/N (IR) or T_peak (UV), plotted against the stage of the evolution.
  - `plots/bidir_summary.json` holds the fitted numbers.
- **Limits.**
  - The WKE has no box, so it has no Heisenberg floor Δ_k^H ≈ 0.2 µm⁻¹.
  - The published n_k carries the time-of-flight resolution; the WKE is compared from the first
    measured bin (0.028 µm⁻¹) on.
  - The bare WKE with Bose +1 blows up in finite time at the onset of condensation.
  - The one-loop model is run classically, because the +1 is not defined for its particle-particle
    bubble.

### Findings (reports of 2026-09-24)

- **Measured clock.** The fits reproduce the published exponents. Matching the measured E_k of 150, 300
  and 600 a₀ at equal t (a/300 a₀)^p gives p = 1.15 ± 0.05 (`bidir_p_optimal`). A time offset (coil
  lag) δt raises the best p roughly linearly: 1.2 at 0 ms, 1.5 at 10 ms, about 2 only at 19 ms
  (`bidir_coil_lag_scan`).
- **Bare WKE with Bose +1** blows up at the onset of condensation, at exactly t = 23.8 ms (300 a₀/a)²,
  so p = 2 and no scaling window is reached.
- **One loop (classical)** breaks down at t = 0 for every a. Its bracket is negative on 43 to 99 % of the
  collision weight: k_ξ/k_p ≈ 0.7 to 1.2 is outside perturbation theory.
- **Bubble chain (large-N, Bose +1) and heuristic C** give the measured UV exponents (α_UV ≈ −0.66,
  β_UV ≈ −0.14). Their clock is near a² at 100 to 280 a₀, both from the collapse and from the energy peak
  k_E.
- **Large-N started from each a's own measured t = 0 state** (150, 300, 600 a₀) crosses over from p ≈ 2.2
  (150 to 300 a₀) to p ≈ 1.4 (300 to 600 a₀). The measured values are 1.35 and 0.95. Overall p = 1.8,
  against 1.15 measured, and the model is about twice as fast as the data.
- **Initial states.** The averaged state `measured_d` carries a lumpy UV tail from the noisy series 2
  spectra. That distorts the energy-peak clock, so use the per-a states `measured_d150/300/600`
  (`bidir_initial.py --series1`: ln n_k interpolated monotonically through the points above 2σ).
- **Energy drift of the bubble chain.** The drift grows with a and time. At standard accuracy E rises
  1.5 to 4 % by t ā = 160 ms and 9 % by 320 ms at 300 a₀; the draft study reached ×2 to ×12 by t ā ≈ 2 s.
  Runs therefore use `maxDrift`, and late-time results of the draft study are not physical.
- **Extra figures** (k_E clocks, optimal p, coil lag, E_k videos) come from `plots/bidir_extra/`.

## Known issues

- **Kinetic energy drift** (found 2026-09-24 in `chain-standard-3states`, bubble chain, standard
  accuracy, not investigated). From the n_k snapshots, ∫k⁴f dk rises by 4 to 11% while k_ξ/k_p goes
  from its initial value to about 10, then drops by up to 14% over the last snapshots (for example
  1.03 → 0.86 for Prepared state A at 30 a₀); particle number holds to within 3%. Not yet known
  whether this is the solver or the snapshot quadrature. Figures that use E/N (such as the √(gn/(E/N))
  axis of `rate_vs_a.pdf`) use the initial value.
