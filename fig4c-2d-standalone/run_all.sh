#!/usr/bin/env bash
# Run the WKE for every series of the Fig 4c analogue, then make the figure.
#
#   ./run_all.sh                                   standard accuracy, Bose +1, 25 min cap per run
#   ACCURACY=draft KERNEL=classical ./run_all.sh   any of: ACCURACY draft|standard|high, KERNEL quantum|classical,
#                                                  WALL (s per run), JOBS (parallel runs), OUT (output folder)
# Series 8 and 10 (the two low-N series) are not run; fig4c.py leaves them out.
set -euo pipefail
cd "$(dirname "$0")"

ACCURACY=${ACCURACY:-standard}
KERNEL=${KERNEL:-quantum}
WALL=${WALL:-1500}
JOBS=${JOBS:-4}
OUT=${OUT:-out}
DENSITY2=${DENSITY2:-}
LENGTH_STOP=${LENGTH_STOP:-}
PYTHON=${PYTHON:-../analysis/.venv/bin/python}
if [[ ! -x "$PYTHON" ]]; then PYTHON=python3; fi
SERIES="1 2 3 4 5 6 7 9 11 12 13"
MPLCONFIGDIR=${MPLCONFIGDIR:-$OUT/.matplotlib}
mkdir -p "$MPLCONFIGDIR"
export MPLCONFIGDIR

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<6)) { console.error("needs Node 22.6 or newer, found "+process.version); process.exit(1) }'
"$PYTHON" -c 'import numpy, matplotlib' || { echo "needs Python with numpy and matplotlib"; exit 1; }

mkdir -p "$OUT/runs"
echo "11 series, $ACCURACY, $KERNEL, $JOBS at a time, cap $WALL s each -> $OUT"
start=$(date +%s)
run_one() {
  local density_args=()
  local length_args=()
  if [[ -n "$DENSITY2" ]]; then density_args=(--density2 "$DENSITY2"); fi
  if [[ -n "$LENGTH_STOP" ]]; then length_args=(--length-stop-um "$LENGTH_STOP"); fi
  node --no-warnings wke_chain_2d.ts --series "$1" --accuracy "$ACCURACY" --kernel "$KERNEL" --wall "$WALL" \
    "${density_args[@]}" "${length_args[@]}" --out "$OUT/runs/s$(printf %02d "$1").json"
}
export -f run_one
export ACCURACY KERNEL WALL OUT DENSITY2 LENGTH_STOP
printf '%s\n' $SERIES | xargs -P "$JOBS" -n 1 bash -c 'run_one "$0"'
echo "all runs done in $(( $(date +%s) - start )) s"
"$PYTHON" fig4c_2d.py "$OUT"
"$PYTHON" fig4c_kp_2d.py "$OUT"
"$PYTHON" nk_gallery_2d.py "$OUT"
if command -v wolframscript >/dev/null && wolframscript -code 1 >/dev/null 2>&1; then
  wolframscript -file fig4c_2d_wolfram.wl "$OUT"
fi
