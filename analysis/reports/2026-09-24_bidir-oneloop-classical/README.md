# 2026-09-24_bidir-oneloop-classical

Quench-cooled box of 39K (the published bidirectional scaling measurements): the averaged measured t = 0 state, N/V = 1.3170 µm⁻³, evolved to 2560 ms at the ten measured values of a. Do the IR and UV collapse with t → t (a/300 a₀)^p, and with which p, compared with the measured p_IR = 0.9(1) and p_UV = 1.1(1)? One loop, classical kernel (the +1 is not defined for its particle-particle bubble). Stops at breakdown (negative bracket).

- Command: `npx tsx analysis/study.ts analysis/studies/bidir-oneloop-classical.json --no-plots`
- Solver commit: d02a10f (with uncommitted solver changes)
- Started 2026-09-24T18:48:14.440Z, finished 2026-09-24T18:48:19.101Z

| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| measured_d_100a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_140a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_150a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_200a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_280a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_300a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_400a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_570a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 2 | 1 |
| measured_d_600a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 1 | 1 |
| measured_d_800a0_one-loop | One loop, N = 1 | standard | 11.8 | pole | nan | 1 | 1 |

Stop messages:

- measured_d_100a0_one-loop: The one-loop bracket turned negative on 42.8% of the collision weight: perturbation theory has broken down.
- measured_d_140a0_one-loop: The one-loop bracket turned negative on 56.7% of the collision weight: perturbation theory has broken down.
- measured_d_150a0_one-loop: The one-loop bracket turned negative on 60.0% of the collision weight: perturbation theory has broken down.
- measured_d_200a0_one-loop: The one-loop bracket turned negative on 74.1% of the collision weight: perturbation theory has broken down.
- measured_d_280a0_one-loop: The one-loop bracket turned negative on 87.0% of the collision weight: perturbation theory has broken down.
- measured_d_300a0_one-loop: The one-loop bracket turned negative on 89.0% of the collision weight: perturbation theory has broken down.
- measured_d_400a0_one-loop: The one-loop bracket turned negative on 95.2% of the collision weight: perturbation theory has broken down.
- measured_d_570a0_one-loop: The one-loop bracket turned negative on 98.2% of the collision weight: perturbation theory has broken down.
- measured_d_600a0_one-loop: The one-loop bracket turned negative on 98.3% of the collision weight: perturbation theory has broken down.
- measured_d_800a0_one-loop: The one-loop bracket turned negative on 98.8% of the collision weight: perturbation theory has broken down.

Figures (each with a .npz of the plotted arrays): bidir_clock.pdf, bidir_collapse.pdf, bidir_condensate.pdf, bidir_exponents.pdf, bidir_spectra.pdf, bidir_temps.pdf, rate_vs_a.pdf
