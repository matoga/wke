# Validation

Browser-vs-Python cross validation of the TypeScript WKE port, and performance measurements.

Reproduce with:

```bash
# regenerate the Python reference (from the repository root)
PYTHONPATH=src .venv/bin/python scripts/generate_ts_fixtures.py

# run the browser-side suite
cd apps/na-wke-calibrator && npm test
```

**Result: 109 physics assertions pass, 0 fail; 39 UI assertions pass, 0 fail.**

---

## 1. Reference configuration

Both implementations solve the same problem on the same grid.

| | |
| --- | --- |
| State grid | $p = $ 500 log-spaced points on $[0.01, 20]$ |
| Collision cutoff | $p_{\rm coll,max} = 20/\sqrt2$ |
| Quadrature | Gauss–Legendre, $n_{q,\rm low} = n_{q,\rm high} = 16$ |
| Collision events | 488 560 |
| Species | $^{39}$K, $m = 38.96370668\ \mathrm{u}$ |
| Reference density | $n = 2.8331\ \mu\mathrm{m}^{-3}$ |
| Reference scattering length | $a = 50\ a_0$ |
| $na$ | $7.496059781\times10^{-3}\ \mu\mathrm{m}^{-2}$ |
| $\xi$ | $2.30389960057421\ \mu\mathrm{m}$ |
| $t_0$ | $6.513138256\times10^{-3}\ \mathrm{s}$ |
| $N_{\rm cal}$ | $1367.7675286548$ |
| Python integrator | SciPy `solve_ivp`, DOP853, `rtol=1e-6`, `atol=1e-9`, terminal $k_p$ event |
| Browser integrator | Dormand–Prince 5(4) + FSAL, `rtol=1e-7`, `atol=1e-10`, bisection on Hermite dense output |

The event function is identical in both: $g(\tau) = k_p(\tau) - k_{p,0}/2$, terminal,
downward-crossing, with $k_p$ from the same three-point parabolic estimator on $\ln(k^2 f)$.

---

## 2. Collision operator

The kinematics table and the right-hand side are ported literally from `wke/geometry.py`,
`wke/kernel.py` and `wke/collision.py`. Compared against a Python dump of
`CollisionOperator.components(f_0)` on the canonical Gaussian:

| Grid | Events (TS / Python) | max rel. error, gain | max rel. error, loss |
| --- | --- | --- | --- |
| $N = 120$ | 116 192 / 116 192 | $3.2\times10^{-14}$ | $2.7\times10^{-14}$ |
| $N = 500$ | 488 560 / 488 560 | $4.1\times10^{-14}$ | $3.5\times10^{-14}$ |

Both kernels (classical and quantum) reach the same level. The event count matching exactly
confirms the segment splitting and the kinematic validity test agree cell for cell.

Supporting checks in the suite: Gauss–Legendre $n$-point rules integrate degree $2n-1$
exactly to $10^{-13}$; the log-transformed rule reproduces $\int_a^b dp = b - a$; the
log-$p$ interpolation map is exact for functions linear in $\ln p$; $\xi$, $t_0$, $N_{\rm cal}$
and $na$ match the Python `PhysicalScales` properties to $\le 10^{-12}$.

---

## 3. Descriptors

Computed on the canonical descriptor grid, which is the reference solver grid, so this is an
exact comparison rather than one limited by resampling.

| Profile | $k_{p,0}$ | $\langle k\rangle$ | FWHM | $\delta_k$ | $w$ | $C_{\rm shape}$ |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical Gaussian | 1.999867 | 2.000000 | 0.659968 | $+6.674\times10^{-5}$ | 0.330006 | 1.116898 |
| Prepared State 3 | 1.948393 | 1.952887 | 0.612134 | $+2.306\times10^{-3}$ | 0.314174 | 1.134005 |
| Simon Set 93 | 1.857966 | 1.786986 | 0.781968 | $-3.820\times10^{-2}$ | 0.420873 | 0.949679 |

Values in $\mu\mathrm{m}^{-1}$ where dimensional. Browser-vs-Python agreement:

| Quantity | Worst relative difference | Tolerance |
| --- | --- | --- |
| $\int q\,dk$ | $< 10^{-10}$ | $10^{-10}$ |
| $k_{p,0}$ | $1.2\times10^{-13}$ | $10^{-10}$ |
| $\langle k\rangle$ | $4.4\times10^{-16}$ | $10^{-10}$ |
| FWHM | $0$ (bitwise) | $10^{-10}$ |
| $\delta_k$ | $< 10^{-12}$ abs. | $10^{-12}$ abs. |
| $w$ | $< 10^{-10}$ | $10^{-10}$ |
| $C_{\rm shape}$ | $1.9\times10^{-14}$ | $10^{-10}$ |
| $A_{\rm ref}$, $A_{\rm pred}$ | $< 10^{-12}$ | $10^{-12}$ |

All six shipped presets additionally match their Python-computed $k_{p,0}$ and
$C_{\rm shape}$ to $\le 3.4\times10^{-14}$.

> **Note on a fixed bug.** The first port used an incorrect closed form for the parabola
> coefficients, which flipped the sign of the quadratic term. The estimator then always fell
> back to the grid-point argmax, giving $k_{p,0} = 2.0114$ instead of $1.9999\ \mu\mathrm{m}^{-1}$
> for the canonical Gaussian — a 0.58% error in $k_{p,0}$, and 8% in $C_{\rm shape}$ through
> $\delta_k$. It is now a Lagrange-form evaluation and agrees to $10^{-13}$.

---

## 4. Half-times

The primary benchmark. Target was $\lesssim 1\%$; achieved agreement is
$\le 1.9\times10^{-6}$ — five orders of magnitude inside it.

| Profile | Kernel | Python $\Delta t_{1/2}$ (s) | Browser $\Delta t_{1/2}$ (s) | Rel. difference |
| --- | --- | --- | --- | --- |
| Canonical Gaussian | classical | 0.3131915 | 0.3131915 | $1.1\times10^{-7}$ |
| Canonical Gaussian | quantum | 0.3058593 | 0.3058599 | $1.9\times10^{-6}$ |
| Prepared State 3 | classical | 0.2846574 | 0.2846578 | $1.2\times10^{-6}$ |
| Prepared State 3 | quantum | 0.2820872 | 0.2820873 | $4.8\times10^{-7}$ |
| Simon Set 93 | classical | 0.1925359 | 0.1925361 | $1.2\times10^{-6}$ |
| Simon Set 93 | quantum | 0.1930905 | 0.1930907 | $1.2\times10^{-6}$ |

### $k_p(t)$ checkpoints

Compared at exactly the times SciPy reported, using the browser integrator's Hermite dense
output — no interpolation enters the comparison.

| Profile | Kernel | Checkpoints | Worst rel. difference |
| --- | --- | --- | --- |
| Canonical Gaussian | classical | 96 | $2.4\times10^{-6}$ |
| Canonical Gaussian | quantum | 94 | $3.6\times10^{-6}$ |
| Prepared State 3 | classical | 87 | $3.9\times10^{-6}$ |
| Prepared State 3 | quantum | 87 | $6.4\times10^{-6}$ |
| Simon Set 93 | classical | 59 | $2.0\times10^{-6}$ |
| Simon Set 93 | quantum | 59 | $5.8\times10^{-6}$ |

> Comparing $k_p(t)$ requires care: the estimator's argmax hops by a grid cell as the
> spectrum flattens mid-cascade, so $k_p(\tau)$ is piecewise smooth with jumps. Interpolating
> a step-resolution track across such a jump produces spurious differences up to 8% even when
> the two solvers are on the same trajectory. Evaluating both at identical times removes this
> entirely.

### Structural checks

- All runs reach $k_p = k_{p,0}/2$ and record the $0.90$, $0.75$, $0.50$ stage snapshots.
- $k_{p,0}$ from the occupation $f$ equals $k_{p,0}$ from $q$ to $1.2\times10^{-13}$.
- Density reconstruction $\frac{1}{2\pi^2}\int k^2 f\,dk = n$ to $1.6\times10^{-16}$.
- **$na$-invariance:** doubling $n$ and halving $a$ (i.e. $n \to 4n$, $a \to a/4$) changes the
  classical $\Delta t_{1/2}$ by $2.3\times10^{-6}$, confirming that the classical dynamics
  depend on $n$ and $a$ only through their product — the premise of the inverse workflow.

### Continue simulating (resume correctness)

"Continue" resumes a finished run from its exact raw end state rather than restarting or
approximating it. Verified by comparing a resumed two-segment run against a single uninterrupted
run of the same total duration, both from the same initial spectrum:

| Check | Result | Tolerance |
| --- | --- | --- |
| $k_p$ at the common end time | $7.5\times10^{-9}$ | $5\times10^{-4}$ |
| spectrum shape at the common end time | $3.5\times10^{-3}$ | $10^{-2}$ |

$k_p$ — the quantity $\Delta t_{1/2}$ and the timeline both key off — matches to essentially
machine precision. The spectrum shape agrees only to $\sim 3\times10^{-3}$ because resuming
restarts the adaptive step-size controller from scratch at the handoff state, so the two paths
take a different sequence of steps forward even though each step independently satisfies the
same `rtol`; this is expected numerical-path sensitivity, not an inconsistency in the resume.

> **Note on a fixed bug.** The original "final" snapshot was labelled with the exact half-crossing
> time `tauHalf` but actually held the state from the *end of the accepted step* containing that
> crossing — computed via a Hermite call with `h = 0`, which just returns the input unchanged.
> The mislabelling was invisible in the UI (the discrepancy is a fraction of one step, well under
> plotting resolution) but broke exact resume: continuing from that state while telling the
> integrator it started at `tauHalf` silently lost the sub-step remainder every time. The state is
> now captured with the correct dense-output evaluation at the moment the crossing is detected.

---

## 5. Formula against the direct solve

Distinct from the port validation above: this is how well the *calibration* reproduces the
*physics*, at the reference $na = 7.496\times10^{-3}\ \mu\mathrm{m}^{-2}$.

| Profile | $\Delta t_{1/2}^{\rm formula}$ (s) | $\Delta t_{1/2}^{\rm WKE}$ (s) | Difference | Domain |
| --- | --- | --- | --- | --- |
| Canonical Gaussian | 0.31261 | 0.31319 | $-0.19\%$ | inside |
| Prepared State 3 | 0.30127 | 0.28466 | $+5.84\%$ | inside |
| Simon Set 93 | 0.22943 | 0.19254 | $+19.16\%$ | inside |

This is a property of the calibration, not of the port — the browser and Python solvers agree
on the WKE column to $10^{-6}$. It is the concrete reason the app reports the synthetic
grouped-CV spread ($\approx 2.1\%$, 1σ, on solver-generated profiles) separately from the
empirical external-holdout RMS ($6.15\%$), and states that measured-profile residuals are
profile dependent. Simon Set 93 is a measured external-holdout profile and is the worst of
the three by a wide margin, despite sitting inside the certified $k_{p,0}$ range.

---

## 6. Performance

Measured on an Apple M1 Pro, macOS 26.5.1, Node v26.7.0 (V8, single thread), running the
production code path with `rtol = 1e-7` on the 500-point grid.

| Stage | Time |
| --- | --- |
| Collision geometry build (488 560 events) | 80 ms, once per $N_{\rm cal}$, then cached |
| Single right-hand-side evaluation | ≈ 4 ms |

| Profile | Kernel | Wall time | Accepted steps | Rejected | RHS evals |
| --- | --- | --- | --- | --- | --- |
| Canonical Gaussian | classical | 0.71 s | 45 | 0 | 271 |
| Canonical Gaussian | quantum | 0.72 s | 46 | 0 | 277 |
| Prepared State 3 | classical | 0.69 s | 44 | 0 | 265 |
| Prepared State 3 | quantum | 0.70 s | 44 | 0 | 265 |
| Simon Set 93 | classical | 0.63 s | 38 | 0 | 229 |
| Simon Set 93 | quantum | 0.60 s | 39 | 0 | 235 |

**Typical classical run: ≈ 0.7 s. Typical quantum run: ≈ 0.7 s.** The quantum kernel costs
essentially nothing extra — the $+1$ factors are a handful of additions inside a loop already
dominated by memory traffic over the event table.

Because a run is about a second, the app always executes at validated accuracy. A reduced
"preview" mode was considered and deliberately not shipped: it would not materially improve
interaction speed, and it would introduce a second, unvalidated numerical path.

Tolerance sensitivity, canonical Gaussian classical:

| `rtol` | Steps | Wall time | Rel. difference vs Python |
| --- | --- | --- | --- |
| $10^{-6}$ | 34 | 0.6 s | $1\times10^{-6}$ |
| $10^{-7}$ (shipped) | 45 | 0.7 s | $1\times10^{-7}$ |
| $10^{-8}$ | 62 | 0.9 s | $< 10^{-7}$ |

### Bundle

| Asset | Size | Gzipped |
| --- | --- | --- |
| `index.js` | 244.9 kB | 86.6 kB |
| `index.css` | 28.9 kB | 5.0 kB |
| `wke.worker.js` | 12.0 kB | — |

Production build: **PASS** (`tsc && vite build`, 51 modules, ~1 s).

### Not measured

In-browser Chromium wall times were **not** measured. The only Chrome instance reachable from
this session runs on a different machine and cannot connect to the local dev server, and the
server was deliberately not exposed on the network to work around that. The numbers above are
Node/V8 on the same code path and the same hardware the worker would use, which is the
closest honest proxy; they are not a substitute for a browser measurement, and browser timings
will additionally include worker startup and structured-clone cost for the snapshot payload.

---

## 7. UI coverage

`tests/ui_smoke.test.tsx` mounts the full React tree in jsdom with a stubbed Web Worker and
asserts: the app mounts; the default preset loads and produces $k_{p,0} \approx 2$; the domain
verdict renders; both accuracy figures ($2.1\%$ synthetic, $6.15\%$ empirical) are shown as
separate quantities; switching to measured-$\Delta t$ mode reveals the inverse workflow;
clearing $a$ leaves $n$ and $V$ unidentified rather than invented; and selecting the
out-of-range Prepared State 7 preset flags extrapolation and names the bound that was crossed.

The solver itself is not exercised there — it is covered by the physics suite above.
