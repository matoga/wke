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
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
OUT=${OUT:-out}
SERIES="1 2 3 4 5 6 7 9 11 12 13"

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<6)) { console.error("needs Node 22.6 or newer, found "+process.version); process.exit(1) }'
python3 -c 'import numpy, matplotlib' || { echo "needs python3 with numpy and matplotlib"; exit 1; }

mkdir -p "$OUT/runs"
echo "11 series, $ACCURACY, $KERNEL, $JOBS at a time, cap $WALL s each -> $OUT"
start=$(date +%s)
run_one() {
  node --no-warnings wke_chain.ts --series "$1" --accuracy "$ACCURACY" --kernel "$KERNEL" --wall "$WALL" \
    --out "$OUT/runs/s$(printf %02d "$1").json"
}
export -f run_one
export ACCURACY KERNEL WALL OUT
printf '%s\n' $SERIES | xargs -P "$JOBS" -n 1 bash -c 'run_one "$0"'
echo "all runs done in $(( $(date +%s) - start )) s"
python3 fig4c.py "$OUT"
if command -v wolframscript >/dev/null; then wolframscript -file fig4c_wolfram.wl "$OUT"; fi
