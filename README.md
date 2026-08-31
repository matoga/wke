# WKE Solver

A local wave kinetic equation solver for isotropic momentum spectra. Its calibration workflow
infers box-trap volume from the atomic species, atom number $N$, scattering length $a$, and the
measured time $\Delta t_{1/2}$ for the spectral peak $k_p$ to fall to half its initial value.

It does two things and shows them side by side:

1. **The fast analytical calibration.** Descriptors of the initial spectrum
   ($k_{p,0}$, $\langle k\rangle$, FWHM) feed a closed-form relation between $na$ and
   $\Delta t_{1/2}$.
2. **The direct kinetic solve.** The validated isotropic four-wave wave-kinetic equation is
   integrated in the browser, in a Web Worker, and its own $\Delta t_{1/2}$ is reported.

Everything runs in the page. There is no backend, no network request after the initial
page load, and no data leaves the browser.

---

## Setup

```bash
cd apps/na-wke-calibrator
npm install
npm run dev
```

Then open the URL Vite prints (typically <http://localhost:5173/>).

| Command | What it does |
| --- | --- |
| `npm run dev` | development server with hot reload |
| `npm run build` | typecheck and produce a static bundle in `dist/` |
| `npm run preview` | serve the production bundle |
| `npm run typecheck` | `tsc --noEmit` over `src` and `tests` |
| `npm run test` | physics cross-validation + headless UI smoke test |
| `npm run test:physics` | browser-vs-Python cross validation only |

The built bundle in `dist/` is fully static and can be opened from any static file server.
It cannot be opened as a bare `file://` URL, because ES-module Web Workers require an HTTP
origin.

Fixtures and presets are regenerated from the Python solver with:

```bash
# from the repository root, with the project venv
PYTHONPATH=src .venv/bin/python scripts/generate_ts_fixtures.py
```

---

## Units

Everything user-facing is in micrometres and seconds. Nothing is expressed in
dimensionless solver units except where explicitly labelled $\tau$ or $p$.

| Quantity | Symbol | Unit |
| --- | --- | --- |
| Wavevector | $k$ | $\mu\mathrm{m}^{-1}$ |
| Number density | $n$ | $\mu\mathrm{m}^{-3}$ |
| Volume | $V$ | $\mu\mathrm{m}^{3}$ |
| Scattering length | $a$ | $a_0$ (entered), $\mu\mathrm{m}$ (internal) |
| Interaction parameter | $na$ | $\mu\mathrm{m}^{-2}$ |
| Transport time | $\Delta t_{1/2}$ | s |
| Calibration constant | $\kappa$ | $\mathrm{s}\,\mu\mathrm{m}^{-2}$ |
| Reference prefactor | $A_{\rm ref}=\kappa k_{p,0}^2$ | $\mathrm{s}\,\mu\mathrm{m}^{-4}$ |

The Bohr-radius conversion is explicit and tested:
$a_0 = 5.29177210903\times10^{-5}\,\mu\mathrm{m}$, so $a = 50\,a_0$ is
$2.6459\times10^{-3}\,\mu\mathrm{m}$.

Derived scales, matching the Python `PhysicalScales`:

$$\xi = \frac{1}{\sqrt{8\pi n a}},\qquad
t_0 = \frac{\hbar}{g n} = \frac{m}{4\pi\hbar\,na},\qquad
N_{\rm cal} = 4\pi^2 n \xi^3,\qquad
g = \frac{4\pi\hbar^2 a}{m}.$$

---

## Spectrum conventions

The app **never guesses** which convention your second column uses. You pick it explicitly,
and the choice is shown alongside the imported data.

| Selector | Columns | Meaning |
| --- | --- | --- |
| Radial density $n(k)$ | `k_um_inv, n_k` | $\int d^3k\, n(k) = N$. Converted with $N_k = 4\pi k^2 n(k)$. |
| Shell density $N_k/N$ | `k_um_inv, Nk_over_N` | Already $\propto q(k)$; only rescaled. |

In both cases the internal working quantity is the normalized shell density

$$q(k) = \frac{N_k}{N},\qquad \int q(k)\,dk = 1,$$

and the Bose occupation used by the solver is $f(k) = 2\pi^2 n\, q(k) / k^2$.

$q$ is a solver variable, not something anyone measures, so no axis in the app is labelled
with it. Every spectrum plot shows $N_k$ under one of two conventions, chosen once with the
switch in the header:

| Switch | Shows | Scale |
| --- | --- | --- |
| `N_k / N` | the unit-normalized profile | $\int dk = 1$ |
| `N_k` | the shell spectrum on the atom-number scale | $\int dk = N$ when $N$ is known, otherwise the integral of the imported column |

Spectrum plots use linear axes in both $k$ and $N_k$. The $k$ axis starts at zero and ends
where 99.9% of the spectral weight has accumulated, so the empty high-$k$ tail of the solver
grid (which runs to $8.68\ \mu\mathrm{m}^{-1}$) does not eat half the panel. In the simulation
panel that range is fixed from the initial state, so the axis does not jump between frames
while the peak migrates downward.

The normalization switch is purely a display choice: it applies to the imported points, the interpolated
profile, and the evolving spectrum in the simulation panel simultaneously, and nothing about
the descriptors, the calibration or the solver depends on it. When the experimental norm is
selected but no absolute scale is available, the app says so in the plot caption rather than
inventing one.

The two conventions are not interchangeable: for the canonical Gaussian, reading the same
numbers as $n(k)$ rather than $N_k/N$ moves $k_{p,0}$ from $2.000$ to $2.075\ \mu\mathrm{m}^{-1}$.
Picking the wrong one is a silent 4% error in $k_{p,0}$ and a ~15% error in $na$.

Input can be pasted, dropped, or chosen with a file picker. Header rows are optional and
auto-detected; comma, tab, semicolon and whitespace separators all work; `#` comments and
non-numeric rows are skipped and counted. Negative values are clipped to zero and reported.
Both the imported points and the interpolated profile are drawn together, under whichever
normalization the header switch selects.

### Resampling

All spectra are resampled onto a **canonical descriptor grid**: 500 logarithmically spaced
points, defined as the solver grid $p \in [0.01, 20]$ divided by the reference healing
length $\xi_{\rm ref} = 2.30389960057421\ \mu\mathrm{m}$, i.e. $k \in [0.00434, 8.68]\ \mu\mathrm{m}^{-1}$.
Fixing this grid is what lets the browser reproduce the Python descriptors exactly rather
than to within an interpolation error. Weight falling outside the grid is reported, not
silently discarded.

---

## Workflows

### 1. Known atoms, volume, interactions

Enter $N$, $V$ and $a$. The app computes $n = N/V$ and $na$, predicts $\Delta t_{1/2}$ from
the calibration formula, and — on demand — runs the WKE for the direct answer.

### 2. Known density and interactions

Enter $n$ and $a$. Same as above without the volume bookkeeping.

### 3. Measured transport calibration

Enter a measured $\Delta t_{1/2}$. The app inverts the calibration for $na$. Then:

- if $a$ is supplied, $n = na/a$;
- if $N$ is supplied too, $V = N/n$.

If only $na$ is identifiable, no $n$ and no $V$ are invented — the fields stay empty and the
reason is stated. A classical WKE rerun at the inferred $na$ is still available as a
consistency check, because the classical dynamics depend on $n$ and $a$ only through their
product (see below). Quantum reruns are disabled with an explanation, since the Bose $+1$
factors compare $f$ against unity and therefore need $n$ and $a$ separately.

### Sensitivity sliders

Sliders for $a$, $n$, and (in measured-$\Delta t$ mode) a scale multiplier on the measured
time update the **analytical** result on every tick. The WKE is only re-run when you press
Run or Re-run — dragging never queues a solve. **Restore measured values** returns the
sliders to the entered parameters.

### Cylinder volume input

In "Atoms, volume, interactions" mode, "from R, L →" switches the volume field to a cylinder:
enter a length $L$ and an aspect ratio $\rho = R/L$ (default $1/2$, editable), and
$V = \pi R^2 L$ with $R = \rho L$ is computed and used everywhere $V$ would otherwise be.

### Refine na with simulation

The calibration formula's na is exact for the formula, but the formula is itself only an
approximation of the kinetic equation — see the accuracy note above. In "Measured transport
calibration" mode, **Refine with simulation** takes the formula's na as a starting guess and
re-solves the classical WKE a handful of times, updating
$na_{i+1} = na_i \sqrt{\Delta t_{\rm WKE}(na_i) / \Delta t_{\rm measured}}$
— valid because the classical dynamics depend on $n$ and $a$ only through their product and
$\Delta t_{\rm WKE}(na)$ is very nearly $\propto na^{-2}$ — until the *simulated* half-time
matches the measurement to within 0.2%, typically in 3–5 solves.

---

## Equations

### Calibration

$$A_{\rm ref} = \kappa\, k_{p,0}^2,\qquad \kappa = 3.932378\times10^{-6}\ \mathrm{s}\,\mu\mathrm{m}^{-2}$$

$$\delta_k = \frac{\langle k\rangle - k_{p,0}}{k_{p,0}},\qquad w = \frac{\rm FWHM}{k_{p,0}}$$

$$C_{\rm shape} = 1.3465 + 2.7162\,\delta_k - 0.6963\,w$$

$$na = \sqrt{\frac{\kappa\, k_{p,0}^2\, C_{\rm shape}}{\Delta t_{1/2}}},\qquad
\Delta t_{1/2}^{\rm formula} = \frac{\kappa\, k_{p,0}^2\, C_{\rm shape}}{(na)^2}$$

$k_{p,0}$ comes from a three-point parabolic fit to $\ln(k^2 f)$ against $\ln k$ around the
spectral maximum; $\langle k\rangle = \int k\,q(k)\,dk$; the FWHM uses linearly interpolated
half-maximum crossings. The same peak estimator is used for the initial $k_{p,0}$, for the
evolving $k_p(t)$, and for the half-crossing target $k_{p,0}/2$.

### Kinetic equation

The reduced isotropic four-wave collision integral, in dimensionless $p = k\xi$ and
$\tau = t/t_0$:

$$\frac{\partial f(p)}{\partial\tau} = \frac{4\pi}{N_{\rm cal}^2}
\int dp_1\,dp_2\; p_1 p_2\, K(p,p_1,p_2,p_3)\,\big[\,\mathcal{G} - \mathcal{L}\,\big],
\qquad p_3^2 = p_1^2 + p_2^2 - p^2,$$

with the bare isotropic kernel $K = \min(p,p_1,p_2,p_3)/p$ and

$$\text{classical:}\quad \mathcal{G} = f_1 f_2 (f + f_3),\qquad \mathcal{L} = f f_3 (f_1 + f_2)$$

$$\text{quantum:}\quad \mathcal{G} = f_1 f_2 (1 + f + f_3),\qquad \mathcal{L} = f f_3 (1 + f_1 + f_2)$$

The classical kernel is homogeneous of degree three in $f$, and $f \propto n$ while $\xi$ and
$t_0$ depend on $n$ and $a$ only through $na$. So the classical $\Delta t_{1/2}$ is a function
of $na$ alone — which is exactly why the calibration can be inverted for $na$ without knowing
$n$ and $a$ separately. This invariance is asserted in the test suite.

---

## Implementation

- **Collision geometry** — a direct port of `wke/geometry.py`. Kinematics are precomputed
  once into flat typed arrays (488 560 events on the 500-point grid, ~80 ms to build), then
  each right-hand-side evaluation is one linear sweep, ~4 ms.
- **Quadrature** — Gauss–Legendre nodes by Newton iteration, log-transformed as in
  `wke/grid.py`, with the same segment splitting at the target $p$.
- **Integrator** — adaptive Dormand–Prince 5(4) with FSAL, terminal event detection on
  $k_p(\tau) - k_{p,0}/2$ located by bisection on the Hermite dense output. The Python
  reference uses DOP853 with SciPy's Brent root-find; the two agree to $\sim10^{-6}$.
- **Threading** — all numerics run in a Web Worker. The geometry is cached on $N_{\rm cal}$,
  so switching kernel or re-running with the same parameters skips the rebuild.

A typical solve is around one second, so the app **always runs at validated accuracy**
(500-point grid, 16-node quadrature, `rtol = 1e-7`). There is no reduced "preview" mode,
because a coarser one would not materially improve interaction speed.

A run saves 150 states — always the finest setting, since the extra cost is a few hundred KB of
memory and negligible CPU, not a real tradeoff — at $k_p/k_{p,0} = 0.9$, $0.75$ and $0.5$, at the
$\Delta t_{1/2}$ crossing, plus evenly-spaced samples in between, all timestamped in physical
seconds. Two ways to look at them, toggled with **Animate / All times**:

- **Animate** plays through one state at a time. Playback is driven by timestamp, not by a
  state's position in the list: Play advances real simulated time at a fixed wall-clock rate (the
  whole run plays through in about six seconds regardless of how long $\Delta t_{1/2}$ actually
  is), and the scrubber's range is $[0, t_{\rm end}]$ in seconds — both show the nearest saved
  state to the current time.
- **All times** overlays every saved state at once (subsampled to ~24 for legibility), each
  coloured by a blue-to-red ramp keyed to its time, so the whole cascade's shape is visible in one
  glance instead of a sequence of frames.

Either way it is a replay of already-computed states, never a re-integration, so it costs nothing.

**Continue simulating.** A finished run only covers $t \in [0, \Delta t_{1/2}]$ by construction —
that is where the physically interesting event is. To see the cascade continue past it, press
**Continue →**: the solver resumes from the exact raw state the previous segment ended on (not a
re-normalized approximation of it) and integrates further, by default doubling the elapsed time.
The extension is stitched onto the existing timeline — Play and the scrubber immediately cover
the longer range, and the resume point is marked "resumed here". Repeated presses keep extending
further. Continuation carries no half-time target of its own; it simply keeps advancing until
its time budget runs out, so k_p can be watched decaying well past the calibration's reference
point.

## Layout

The app is three tabs, one per workflow:

- **Simulate** — pick a preset, paste/drop/type data, or draw N_k(k) by hand on a lin-lin
  canvas; press Run and watch it evolve. The WKE panel sits on top since the evolving spectrum
  is the thing you watch; below it, the **Initial state** panel (import controls merged with the
  descriptors they produce, so nothing about k_p,0 or C_shape is a mystery) sits beside a compact
  reference card of the calibration formulas, so neither has to stretch full width.
- **Calibrate** — get na, n or V from known parameters, or invert a measured Δt₁ᐟ₂. A summary
  strip reminds you which spectrum is active (change it back in Simulate). Includes a cylinder
  geometry input (R, L, with an editable R/L ratio) as an alternative to entering V directly,
  and a "refine with simulation" shooting method that corrects the formula's na against the
  actual classical WKE.
- **Export** — save any saved state (the imported spectrum, or a WKE snapshot from the last
  run) as k, N_k in whichever convention (unit norm, experimental scale, or radial n_k) and k
  unit (μm⁻¹ or m⁻¹) you need downstream.

Every spectrum plot in the app uses linear axes with a fixed range while a simulation plays —
in the WKE panel, the linear panel shows N_k(k) (the shell-integrated quantity whose peak is
literally k_p), the log-log panel shows n_k, the mean occupation number in atoms per mode fixed
above 0.3 (a mode holding fewer atoms than that is essentially unoccupied and not worth the
space), and k_p(t) is linear from zero — so nothing rescales frame to frame while you watch the
cascade. On the Calibrate tab, Transport time and the calibration map sit side by side rather
than each stretching full width.
Where a plot's width is free (not dictated by a data table beside it), its height follows a
golden-ratio aspect.

---

## Presets

| Preset | $k_{p,0}$ ($\mu\mathrm{m}^{-1}$) | $\delta_k$ | $w$ | $C_{\rm shape}$ | Note |
| --- | --- | --- | --- | --- | --- |
| Canonical Gaussian | 1.9999 | +0.0001 | 0.3300 | 1.1169 | $\sigma = 0.14\,k_p$ reference |
| Prepared State 1 | 1.1461 | +0.0457 | 0.4628 | 1.1484 | at the low-$k_p$ boundary |
| Prepared State 3 | 1.9484 | +0.0023 | 0.3142 | 1.1340 | validation benchmark |
| Prepared State 5 | 2.9452 | +0.0039 | 0.2231 | 1.2018 | near the high-$k_p$ boundary |
| Prepared State 7 | 3.8968 | −0.0048 | 0.1892 | 1.2018 | **outside** the certified range |
| Simon Set 93 | 1.8580 | −0.0382 | 0.4209 | 0.9497 | measured external-holdout profile |

Any preset can be replaced immediately by pasted or uploaded data.

---

## Limitations

**Certified domain.** The classical calibration is certified for

$$1.15 \le k_{p,0} \le 3.00\ \mu\mathrm{m}^{-1},\qquad |\delta_k| \lesssim 0.08,
\qquad 0.18 \le w \le 0.65,$$

with unimodal profiles. Outside it the formula is still evaluated, but the UI marks the
state as **extrapolation**, lists which bound was crossed, and states that the quoted
uncertainties do not apply. The direct WKE simulation remains valid everywhere the solver
grid resolves the spectrum.

**Two different accuracy numbers.** These are not the same quantity and must not be
conflated:

- **Synthetic grouped-CV spread $\approx 2.1\%$ (1σ).** Measured on solver-generated
  profiles. This is *not* the accuracy to expect on real data.
- **Empirical external-holdout RMS $= 6.15\%$.** Measured on held-out measured profiles.

Residuals on measured profiles are profile dependent. For Simon Set 93 the formula and the
direct classical WKE differ by 19% at the reference $na$ — see `docs/VALIDATION.md`.

**Species.** $\kappa$ was calibrated for $^{39}$K. Because $t_0 = m/(4\pi\hbar\,na)$, the WKE
$\Delta t_{1/2}$ scales with atomic mass while $\kappa$ carries no mass factor. Selecting
another species is supported and the mass enters the simulation correctly, but the app warns
that the formula and the simulation will then differ by roughly the mass ratio. Species
constants live in one table in `src/physics/constants.ts`.

**Solver grid coverage.** The solver grid is expressed in $p = k\xi$. Its upper bound grows at
weak coupling so that it always retains at least the reference physical $k$ range; this gives
the energy-carrying direct cascade room above the initial spectrum. The fraction of
$\int q\,dk$ captured initially is also computed and a warning is shown when it drops below
99%.

**Conservation.** Number and energy moments drift by $10^{-3}$–$10^{-2}$ over a run. This is
the truncated-grid discretization error of the reference scheme, not a solver defect, and the
same drift is present in the Python implementation. It is reported live.

---

## Validation

`docs/VALIDATION.md` holds the browser-vs-Python benchmark table and the performance
measurements. Summary: **109 physics assertions pass**, half-times agree with the Python
solver to $\le 2\times10^{-6}$ relative — five orders of magnitude inside the 1% target — and
$k_p(t)$ checkpoints agree to $\le 6\times10^{-6}$.
