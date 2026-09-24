# 2026-09-24_bidir-heuristic-c-uv-standard

UV clock of heuristic C (bubble chain with rung weight 1.85, Bose +1) at standard accuracy: the averaged measured t = 0 state of the quench-cooled box at a = 50, 100, 140, 200 a₀, each run to t ā = 320 ms (ā = a/300 a₀), stopped if N or E drifts by more than 5%. Energy conservation is needed for the UV exponents and for p_UV in t → t ā^p, measured 1.1(1).

- Command: `npx tsx analysis/study.ts analysis/studies/bidir-heuristic-c-uv-standard.json --parallel 4 --no-plots`
- Solver commit: d02a10f (with uncommitted solver changes)
- Started 2026-09-24T19:59:42.407Z, finished 2026-09-24T20:02:12.499Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| measured_d_50a0_heuristic-c | Heuristic C, fitted | standard | 11.8 | time | 6.12 | 95 | 82 |
| measured_d_100a0_heuristic-c | Heuristic C, fitted | standard | 11.8 | time | 7.58 | 149 | 75 |
| measured_d_140a0_heuristic-c | Heuristic C, fitted | standard | 11.8 | time | 7.96 | 133 | 72 |
| measured_d_200a0_heuristic-c | Heuristic C, fitted | standard | 11.8 | time | 8.55 | 140 | 68 |

Figures (each with a .npz of the plotted arrays): bidir_clock.pdf, bidir_collapse.pdf, bidir_condensate.pdf, bidir_exponents.pdf, bidir_spectra.pdf, bidir_temps.pdf, ell.pdf, kp_gallery.pdf, nk_fixed.pdf, rate.pdf, rate_vs_a.pdf, spectra.pdf, spectra_Ek.pdf, spectra_Nk.pdf
