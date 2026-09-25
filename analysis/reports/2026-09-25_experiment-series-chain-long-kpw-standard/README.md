# 2026-09-25_experiment-series-chain-long-kpw-standard

All 13 published series (protocol, a, N, V) with the bubble chain (N → ∞) and the Bose +1 terms, standard accuracy, run longer for the Fig 4c analogue, with the wide peak k_p of N_k (window N_k ≥ max/2) and its rate recorded: each run stops at k_ξ/k_p set to reach (ℓ/ξ)² ≈ 2000 (5% margin), past the box ceiling ℓ = V^(1/3) for the low-na series.

- Command: `npx tsx analysis/study.ts analysis/studies/experiment-series-chain-long-kpw-standard.json --no-plots --parallel 8`
- Solver commit: 8a99a00
- Started 2026-09-25T09:42:46.787Z, finished 2026-09-25T10:16:23.045Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s13_measured_c3_50a0_chain | Bubble chain, N → ∞ | standard | 20.0 | target | 14.98 | 569 | 40 |
| s03_measured_c3_100a0_chain | Bubble chain, N → ∞ | standard | 20.0 | target | 14.84 | 640 | 40 |
| s07_measured_c3_200a0_chain | Bubble chain, N → ∞ | standard | 20.0 | target | 14.54 | 537 | 39 |
| s02_measured_c2_100a0_chain | Bubble chain, N → ∞ | standard | 21.4 | target | 14.60 | 456 | 39 |
| s04_measured_c2_400a0_chain | Bubble chain, N → ∞ | standard | 21.4 | target | 14.59 | 514 | 40 |
| s09_measured_c1_70a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 14.75 | 538 | 39 |
| s01_measured_c1_100a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 14.43 | 445 | 39 |
| s11_measured_c1_140a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 14.01 | 475 | 39 |
| s06_measured_c1_200a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 13.95 | 544 | 40 |
| s12_measured_c1_280a0_chain | Bubble chain, N → ∞ | standard | 21.6 | wall-cap | 20.26 | 1500 | 39 |
| s08_measured_c1_400a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 13.80 | 297 | 40 |
| s10_measured_c1_400a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 11.81 | 302 | 39 |
| s05_measured_c1_400a0_chain | Bubble chain, N → ∞ | standard | 21.6 | target | 17.98 | 1220 | 39 |

Figures (each with a .npz of the plotted arrays; only the Fig 4 analogues are kept in this report): fig4_mod.pdf, fig4c.pdf, fig4c_all_sets.pdf, fig4c_kp.pdf, fig4c_mod2.pdf, fig4c_mod3.pdf, fig4c_mod3_eta.pdf, fig4c_resc.pdf
