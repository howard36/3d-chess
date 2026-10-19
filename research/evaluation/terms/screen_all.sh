#!/bin/sh
# each candidate term on the tuned evaluation against it, 1,000 games at 20k nodes, the same openings
cd "$(dirname "$0")/.."
for t in "$@"; do
  PV_ENGINE=engine2 python3 screen.py --nodes 20000 --n 1000 --new @terms/$t.txt --old @terms/base.txt --tag s_$t --seed 75000 > terms/s_$t.log 2>&1
done
