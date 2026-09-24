# 2026-09-24_bidir-chain-uv-standard

UV clock of the bubble chain (N → ∞, rung weight 1, Bose +1) at standard accuracy: the averaged measured t = 0 state of the quench-cooled box at a = 100, 140, 200, 280 a₀, each run to t ā = 320 ms (ā = a/300 a₀), stopped if N or E drifts by more than 5%. Energy conservation is needed for the UV exponents and for p_UV in t → t ā^p, measured 1.1(1).

- Command: `npx tsx analysis/study.ts analysis/studies/bidir-chain-uv-standard.json --parallel 4 --no-plots`
- Solver commit: d02a10f (with uncommitted solver changes)
- Started 2026-09-24T19:45:11.915Z, finished 2026-09-24T19:53:01.714Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| measured_d_100a0_chain | Bubble chain, N → ∞ | standard | 11.8 | time | 14.13 | 276 | 75 |
| measured_d_140a0_chain | Bubble chain, N → ∞ | standard | 11.8 | time | 15.22 | 469 | 72 |
| measured_d_200a0_chain | Bubble chain, N → ∞ | standard | 11.8 | time | 15.92 | 421 | 68 |
| measured_d_280a0_chain | Bubble chain, N → ∞ | standard | 11.8 | drift | 12.80 | 216 | 59 |

Figures (each with a .npz of the plotted arrays): bidir_clock.pdf, bidir_collapse.pdf, bidir_condensate.pdf, bidir_exponents.pdf, bidir_spectra.pdf, bidir_temps.pdf, ell.pdf, kp_gallery.pdf, nk_fixed.pdf, rate.pdf, rate_vs_a.pdf, spectra.pdf, spectra_Ek.pdf, spectra_Nk.pdf
