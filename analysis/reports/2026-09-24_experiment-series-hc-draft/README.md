# 2026-09-24_experiment-series-hc-draft

All 13 published series (protocol, a, N, V) with heuristic C (bubble chain, rung weight 1.85) and the Bose +1 terms, draft accuracy. Each run stops at k_p = π/V^(1/3), twice past the box scale 2π/V^(1/3).

- Command: `npx tsx analysis/study.ts analysis/studies/experiment-series-hc-draft.json --no-plots --parallel 13`
- Solver commit: b4d6756 (with uncommitted solver changes)
- Started 2026-09-24T13:07:27.195Z, finished 2026-09-24T13:27:29.270Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s13_measured_c3_50a0_heuristic-c | Heuristic C, fitted | draft | 20.0 | target | 7.41 | 47 | 40 |
| s03_measured_c3_100a0_heuristic-c | Heuristic C, fitted | draft | 20.0 | target | 9.82 | 64 | 39 |
| s07_measured_c3_200a0_heuristic-c | Heuristic C, fitted | draft | 20.0 | target | 13.59 | 252 | 39 |
| s02_measured_c2_100a0_heuristic-c | Heuristic C, fitted | draft | 21.4 | target | 10.09 | 82 | 40 |
| s04_measured_c2_400a0_heuristic-c | Heuristic C, fitted | draft | 21.4 | wall-cap | 19.05 | 1200 | 39 |
| s09_measured_c1_70a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 7.64 | 53 | 38 |
| s01_measured_c1_100a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 10.29 | 103 | 39 |
| s11_measured_c1_140a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 12.06 | 119 | 40 |
| s06_measured_c1_200a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 14.22 | 167 | 38 |
| s12_measured_c1_280a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 20.03 | 186 | 33 |
| s05_measured_c1_400a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | wall-cap | 21.88 | 1200 | 31 |
| s08_measured_c1_400a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 9.74 | 60 | 40 |
| s10_measured_c1_400a0_heuristic-c | Heuristic C, fitted | draft | 21.6 | target | 11.77 | 88 | 29 |

Figures (each with a .npz of the plotted arrays): ell.pdf, experiment_D.pdf, experiment_collapse.pdf, experiment_kappa.pdf, experiment_rate.pdf, kp_gallery.pdf, nk_fixed.pdf, rate.pdf, rate_vs_a.pdf, spectra.pdf, spectra_Ek.pdf, spectra_Nk.pdf
