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

## Known issues

- **Kinetic energy drift** (found 2026-09-24 in `chain-standard-3states`, bubble chain, standard
  accuracy, not investigated). From the n_k snapshots, ∫k⁴f dk rises by 4 to 11% while k_ξ/k_p goes
  from its initial value to about 10, then drops by up to 14% over the last snapshots (for example
  1.03 → 0.86 for Prepared state A at 30 a₀); particle number holds to within 3%. Not yet known
  whether this is the solver or the snapshot quadrature. Figures that use E/N (such as the √(gn/(E/N))
  axis of `rate_vs_a.pdf`) use the initial value.
