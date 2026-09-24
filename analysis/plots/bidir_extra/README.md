# Extra figures of the bidirectional scaling studies

Scripts for the figures made after the standard set of `bidirectional.py`. Run from the app folder with
the data folder in `WKE_BIDIR_DATA`, for example

```sh
WKE_BIDIR_DATA=<dir> analysis/.venv/bin/python analysis/plots/bidir_extra/p_opt_model.py
```

| Script | Figure (in the study named in the script) |
| --- | --- |
| `kE2.py` | shared: k_E, the peak of E_k from a parabola over E_k ≥ 0.6 of the maximum (1/σ weights for measured spectra) |
| `kE_diag3.py <a>` | `bidir_kE_extraction3_<a>a0`: the k_E fit on every measured spectrum of series 1 |
| `kE_three_clocks_chain.py`, `kE_three_clocks_own.py`, `kE_four_clocks_own.py` | `bidir_kE_three_clocks`, `bidir_kE_four_clocks`: k_E against t ā^p, p = 0, 1, (1.8), 2 |
| `p_opt_model.py` | `bidir_p_optimal`: optimal p from the E_k mismatch between values of a, large-N and measured |
| `scan_p_dt.py`, `scan_pretty.py` | `bidir_coil_lag_scan`: measured optimal p against a time offset (coil lag) δt |
| `ek_video.py <a>` | `bidir_Ek_video_<a>a0.mp4`: E_k of a large-N run against the measured spectra (env `STUDY`, `COL`) |
| `init_frames.py` | `bidir_initial_frames_per_a`: the initial state of each run against the measured t = 0 spectrum |
