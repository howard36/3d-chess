#!/bin/sh
# as screen_all.sh, with engine3 (the 78-number form and safe mobility) against base78
cd "$(dirname "$0")/.."
for t in "$@"; do
  PV_ENGINE=engine3 python3 screen.py --nodes 20000 --n 1000 --new @terms/$t.txt --old @terms/base78.txt --tag s_$t --seed 75000 > terms/s_$t.log 2>&1
done
