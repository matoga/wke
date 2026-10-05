# Two-dimensional Fig 4c analogue

This directory is a standalone model of a homogeneous, isotropic 2D Bose gas. It maps the 13 measured 3D series in `data/fig4c_data.json` to quasi-2D inputs, evolves their measured radial spectral shapes with a 2D bubble-chain wave kinetic equation, and plots (m/ħ) dℓ̄²/dt against (ℓ̄/ξ)². The original 3D directory is independent. The published 3D points and the x/56 guide are grey, qualitative references, not 2D measurements or fitted predictions.

## Run

From this directory:

```sh
ACCURACY=draft ./run_all.sh
```

The runner uses `../analysis/.venv/bin/python` when available and otherwise `python3`; set `PYTHON` to choose another interpreter with NumPy and Matplotlib. `ACCURACY` accepts `draft`, `standard`, or `high`; `KERNEL` accepts `quantum` or `classical`; `WALL` is the time cap in seconds per series; `JOBS` sets concurrent runs. The default is 1500 seconds and four jobs. Each run writes `out/runs/sNN.json`; the plotter writes `out/fig4c.pdf`, `.npz`, and `.wl`. `fig4c_2d_wolfram.wl` can redraw the saved arrays if WolframScript is installed. The Python plotter also accepts `--equal`, `--sqrt`, `--ytop`, and `--pdf`.

For a single series, `plot_inv_kp2.py out/runs/s05.json out/s05_invkp2_vs_t.pdf` plots `1/k_p²` against `t` on linear axes and saves the plotted arrays beside the PDF as `.npz`. Following the 3D `kp_gallery` convention, it marks `1/k_ξ²`, starts both axes at zero, and labels a wall-capped trajectory. Here `k_p` comes from the smooth peak fit of `k f(k)` in 2D; the 3D gallery uses the peak of `k² f(k)`, so the two are not directly the same observable.

`run_all.sh` also writes `out/kp_time_gallery.pdf`, `out/kp_rate_gallery.pdf`, and `out/kp_galleries.npz`. The time gallery plots `1/k_p²` against `t` for each series on linear axes, with `1/k_ξ²` marked. The Fig 4c-style rate figure plots `(m/ħ) d(k_p⁻²)/dt` against `(k_ξ/k_p)²`: pooled means and between-series standard deviations on the left, individual curves plus pooled points on a logarithmic or symmetric-log rate axis on the right. Each rate is the centred local-quadratic slope of 11 neighbouring samples of its displayed time curve; five endpoint samples on each side are excluded. The runner also saves three rainbow snapshot galleries and their `.npz` arrays: `2piknk_gallery.pdf` for `N_k = 2π k n_k` on linear axes, `nk_gallery.pdf` for occupation `n_k` on log-log axes with a lower plot bound of one atom per mode, and `ek_gallery.pdf` for `E_k ∝ k³ n_k` on linear axes. Each uses up to nine snapshots per series. Labels give `g̃` and mapped 2D density `n₂`. These figures contain no 3D data or guides.

The `out-kp/` sample was rerun with `ACCURACY=draft WALL=240 JOBS=4`. All 11 series reached the 240-second wall cap before their configured `k_ξ/k_p` targets. Their endpoint `k_p/k_ξ` ranges from 0.338 to 0.735, and `1/k_p²` from 5.38 to 61.00 µm². The largest endpoint particle-number and energy drifts are 29.5% and 62.8%, respectively, so late portions with substantial drift should not be treated as quantitatively converged kinetic predictions.

A single run can be made with:

```sh
node wke_chain_2d.ts --series 1 --accuracy draft --kernel classical --wall 60
```

`--chain off` sets the vertex factor to one for a classical collision and conservation diagnostic. `--lz L` overrides the confinement length in micrometres. `--q-nodes N` sets the ordinary angular projection order (default 4 in draft, 12 in standard/high); `--tau-stop T` stops at dimensionless time T for comparisons. `--n-grid N`, `--panels N`, and `--channel-cell W` permit convergence checks of the momentum and transfer discretizations. Draft now uses two partner-momentum panels. Node 22.6 or later is required.

For quick checks, add `--diagnostic rj --chain off --kernel classical` to compare the thermal Rayleigh–Jeans RHS with a perturbed spectrum, `--diagnostic bubble` to print the Gaussian-spectrum bubble at a fixed (Q, ω), or `--diagnostic bench` to time three RHS calls. `verify_2d.py` compares the 2D angular formulas with independent direct angular quadrature.

## Mapping and scales

For each source series with 3D density n₃ and scattering length a, choose a confinement length ℓ_z = n₃^(-1/3), then n₂ = n₃ℓ_z and g̃ = √(8π)a/ℓ_z. The coupling is g₂ = ħ²g̃/m. The 2D healing length and time are ξ = 1/√(2g̃n₂) and t₀ = 1/( (ħ/m)g̃n₂). This mapping is a model choice. It approximately preserves the source scales; it does not reconstruct a measured 2D gas. With `--lz`, n₂ and g̃ change together. The source volume V gives the illustrative area A = V^(2/3) and ceiling (ℓ̄/ξ)² = A/ξ².

The measured radial n_k shape is retained, but the 2D shell density is q(k) ∝ 2πk n_k. After normalization, f(k) = 2πn₂q(k)/k, so n₂ = (1/2π)∫ kf(k) dk. The peak is that of kf. The kinetic energy is proportional to ∫k³f dk. The low-k fit ln f = A₀ + Bk² estimates f₀, giving ℓ̄² = f₀/n₂ and (m/ħ)dℓ̄²/dt from the collision RHS.

## Collision and bubble

Energy conservation fixes p₃² = p₁² + p₂² − p² in p = kξ. For each event, the 2D momentum delta leaves an integral over Q = |p − p₁|. If a = |p−p₁|, b = p+p₁, c = |p₂−p₃|, and d = p₂+p₃, the angular measure is proportional to

∫ Q dQ / √[(Q²−a²)(b²−Q²)(Q²−c²)(d²−Q²)]

between max(a,c) and min(b,d). The undressed angular integral is evaluated exactly as K(k)/(2P), with P=max(pp₃,p₁p₂) and k=min(pp₃,p₁p₂)/P, using an arithmetic-geometric mean for K. The chain average uses a cosine substitution in Q² at the square-root endpoints. Its positive angular weights are compressed into sparse projections onto a table of the dressed vertex. Transfer cells near a small denominator receive adaptive angular refinement. A single inverse-square-root quadrilateral factor is not the fully integrated 2D angular kernel.

The retarded bubble uses the 2D angular integral 2π/√[(A+i0)²−(2sQ)²]. Its real and imaginary radial integrals are precomputed as matrices of exact moments against the piecewise-linear hat basis for f. The chain vertex is |1−L₋|⁻², evaluated over each event's Q measure. `SOLVER.md` explains the implementation by numbered source section.

At positive temperature a uniform 2D gas has no true condensate. The figure therefore uses ℓ̄ without any equilibrium condensed-fraction correction. Comparison with the 3D experiment is qualitative. The finite grid, source-spectrum mapping, and illustrative area ceiling limit physical interpretation.

## Numerical checks

`verify_2d.py` checks the elliptic formula against independent endpoint quadrature at three geometries (relative error below 6×10⁻¹³), then compares the collision transfer integral with a direct three-angle integral regularized by a narrow Gaussian delta. At its sample geometry the latter two agree within 1.5%; that residual includes the finite delta width. It also compares the bubble square-root expression with direct angular quadrature for a Gaussian f at three frequencies, including both signs of ω, with relative error below 0.01%. A separate Gaussian test of the tabulated hat-function bubble against direct radial integration agreed within 0.02% at (Q, ω) = (0.7, 1.1). The classical Rayleigh–Jeans RHS has an RMS 0.00060 times that of a mildly perturbed spectrum on the draft grid. A chain-off series-1 draft run reached its target with N/N₀ from 0.9935 to 1.0305 and E/E₀ from 0.9337 to 1.0295. These finite-grid drifts should be considered when reading small rates.

WolframScript is optional for the redraw. This environment has the command but no WolframKernel, so the angular and bubble checks above used independent NumPy quadrature instead of Wolfram MCP.

The draft solver caches each pair's bubble-table lookups and each event's sparse vertex projection. Near-pole refinement is selected by a prefix count of flagged transfer cells. With the final two-panel draft rule, all 11 series were evolved to τ=1 using 4 and 24 angular projection nodes. Their largest relative differences were 0.62% in kξ/kp, 0.05% in ℓ̄, and 0.41% in the growth rate (using a 5%-of-peak floor near rate zero). In a serial series-5 initial-state benchmark, four nodes took 1.18 seconds to set up and 42 ms per RHS, versus 3.47 seconds and 63 ms with 24 nodes. Five representative series (3, 4, 5, 7, 13) were also compared with the standard momentum grid at τ=1; the largest differences were 1.63% in kξ/kp, 0.04% in ℓ̄, and 0.35% in the growth rate. A one-panel draft rule had a 10.4% growth-rate error for series 5, which is why the default uses two panels. These are early-time convergence checks, not a late-time error bound. The sample `out/fig4c.pdf` was regenerated with `ACCURACY=draft WALL=20 JOBS=4`. All 11 runs reached the wall cap; their maximum particle-number and energy drifts were 1.3% and 4.6%. The figure represents finite-time draft trajectories, and conservation drift should be checked before interpreting small rates.
