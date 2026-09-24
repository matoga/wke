# 2026-09-24_bidir-bare-quantum

Quench-cooled box of 39K (the published bidirectional scaling measurements): the averaged measured t = 0 state, N/V = 1.3170 µm⁻³, evolved to 2560 ms at the ten measured values of a. Do the IR and UV collapse with t → t (a/300 a₀)^p, and with which p, compared with the measured p_IR = 0.9(1) and p_UV = 1.1(1)? Bare WKE with the Bose +1 terms. It blows up in finite time at the onset of condensation (k_p runs to the grid floor); the stop at k_ξ/k_p = 300 ends the run there.

- Command: `npx tsx analysis/study.ts analysis/studies/bidir-bare-quantum.json --no-plots`
- Solver commit: d02a10f (with uncommitted solver changes)
- Started 2026-09-24T18:48:03.826Z, finished 2026-09-24T18:48:13.858Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| measured_d_100a0_bare | Bare WKE | standard | 11.8 | target | 128.71 | 5 | 57 |
| measured_d_140a0_bare | Bare WKE | standard | 11.8 | target | 321.23 | 5 | 50 |
| measured_d_150a0_bare | Bare WKE | standard | 11.8 | target | 324.41 | 5 | 45 |
| measured_d_200a0_bare | Bare WKE | standard | 11.8 | target | 136.17 | 5 | 42 |
| measured_d_280a0_bare | Bare WKE | standard | 11.8 | target | 269.96 | 5 | 35 |
| measured_d_300a0_bare | Bare WKE | standard | 11.8 | target | 276.15 | 5 | 31 |
| measured_d_400a0_bare | Bare WKE | standard | 11.8 | target | 163.43 | 5 | 27 |
| measured_d_570a0_bare | Bare WKE | standard | 11.8 | target | 231.43 | 5 | 21 |
| measured_d_600a0_bare | Bare WKE | standard | 11.8 | target | 304.26 | 3 | 19 |
| measured_d_800a0_bare | Bare WKE | standard | 11.8 | target | 323.15 | 3 | 13 |

Figures (each with a .npz of the plotted arrays): bidir_clock.pdf, bidir_collapse.pdf, bidir_condensate.pdf, bidir_exponents.pdf, bidir_spectra.pdf, bidir_temps.pdf, ell.pdf, kp_gallery.pdf, nk_fixed.pdf, rate.pdf, rate_vs_a.pdf, spectra.pdf, spectra_Ek.pdf, spectra_Nk.pdf
