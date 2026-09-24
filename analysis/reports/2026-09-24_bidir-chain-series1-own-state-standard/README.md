# 2026-09-24_bidir-chain-series1-own-state-standard

UV clock of the bubble chain (N → ∞, rung weight 1, Bose +1) at standard accuracy: the t = 0 state measured with each a (series 1), smoothed, with its own N/V, at a = 150, 300, 600 a₀ (the values of measured series 1), each run to t ā = 320 ms (ā = a/300 a₀), stopped if N or E drifts by more than 10%. Energy conservation is needed for the UV exponents and for p_UV in t → t ā^p, measured 1.1(1).

- Command: `npx tsx analysis/study.ts analysis/studies/bidir-chain-series1-own-state-standard.json --parallel 3 --no-plots`
- Solver commit: d02a10f (with uncommitted solver changes)
- Started 2026-09-24T20:51:11.987Z, finished 2026-09-24T21:00:40.066Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| measured_d150_150a0_chain | Bubble chain, N → ∞ | standard | 11.2 | time | 14.76 | 333 | 65 |
| measured_d600_600a0_chain | Bubble chain, N → ∞ | standard | 11.3 | drift | 15.23 | 567 | 49 |
| measured_d300_300a0_chain | Bubble chain, N → ∞ | standard | 11.6 | time | 16.60 | 511 | 58 |

Figures (each with a .npz of the plotted arrays): bidir_clock.pdf, bidir_collapse.pdf, bidir_condensate.pdf, bidir_exponents.pdf, bidir_initial_frames_per_a.pdf, bidir_kE_four_clocks.pdf, bidir_kE_three_clocks.pdf, bidir_p_optimal.pdf, bidir_spectra.pdf, bidir_temps.pdf, ell.pdf, kp_gallery.pdf, nk_fixed.pdf, rate.pdf, rate_vs_a.pdf, spectra.pdf, spectra_Ek.pdf, spectra_Nk.pdf
