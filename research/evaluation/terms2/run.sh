#!/bin/sh
cd "$(dirname "$0")/.."
for t in "$@"; do
  PV_ENGINE=engine3 python3 screen.py --nodes 20000 --n 1000 --new @terms2/$t.txt --old @terms2/base.txt --tag s2_$t --seed 85000 > terms2/s2_$t.log 2>&1
done
