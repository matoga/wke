"""Plot inverse peak-momentum squared against time for one 2D WKE run."""

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", help="JSON output from wke_chain_2d.ts")
    parser.add_argument("output", help="output PDF or PNG path")
    args = parser.parse_args()

    with open(args.run, encoding="utf-8") as file:
        run = json.load(file)
    t = np.asarray(run["points"]["t_s"], dtype=float)
    x = np.asarray(run["points"]["X"], dtype=float)
    k_xi = float(run["scales"]["kXi_um_inv"])
    kp = k_xi / x
    inv_kp2 = (x / k_xi) ** 2
    if not len(t) or not np.all(np.isfinite(inv_kp2)):
        raise ValueError("run has no finite trajectory samples")

    settings = run["settings"]
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.plot(t, inv_kp2, "-", color="#3b6fb6", lw=0.8, alpha=0.7)
    ax.plot(t, inv_kp2, "o", ms=2.5, mec="#3b6fb6", mfc="#d7e2f4", mew=0.5,
            label=r"$1/k_p^2$")
    ax.axhline(1 / k_xi**2, color="0.45", lw=0.8, label=r"$1/k_\xi^2$")
    ax.set(xlabel="t (s)", ylabel=r"$1/k_p^2$ ($\mu$m$^2$)")
    ax.set_xlim(left=0)
    ax.set_ylim(bottom=0)
    ax.set_title(f"2D series {settings['series']}: {settings['protocol']}, "
                 f"a = {settings['a_a0']:g} a₀, {settings['accuracy']} "
                 f"({run['status']})", fontsize=9)
    ax.grid(alpha=0.3)
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(args.output)
    np.savez(Path(args.output).with_suffix(".npz"), t_s=t, kp_um_inv=kp,
             inv_kp2_um2=inv_kp2, kxi_um_inv=k_xi,
             guide_inv_kxi2_um2=1 / k_xi**2)
    print(f"{len(t)} samples; t={t[0]:.6g}–{t[-1]:.6g} s; "
          f"1/kp²={inv_kp2[0]:.6g}–{inv_kp2[-1]:.6g} µm²; "
          f"status={run['status']}; saved {args.output}")


if __name__ == "__main__":
    main()
