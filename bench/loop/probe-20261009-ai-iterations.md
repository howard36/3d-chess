# Probe: Hard's search, skipping an iteration predicted not to finish (rejected)

Lens 2's idea: at Hard (timeMs 1800) a pass the clock stops is thrown away whole, and the page waits for it; don't start a pass predicted to overrun. Probe: a 40-ply game (medium against itself, 60 ms a move) as positions; at each, Hard's `chooseMove` from base 454bd45 and from the branch, alternated, same seed; vite-node under Node 24, nothing else running. 2026-10-09 ~17:25–17:38Z.

| Variant | median ms a move (base → head) | mean | moves over 1.5 s | depth median | same move | head shallower |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| next ≈ last × (last / the one before) | 1466 → 1151 | 1463 → 1152 | 19 → 12 | 5 → 4 | 37 of 40 | 11 of 40 |
| next ≥ 2 × last | 1543 → 1514 | 1443 → 1456 | 21 → 20 | 4 → 4 | 39 of 40 | 2 of 40 |

The growth-ratio predictor cut the wait by 315 ms a move but stopped short of passes base finished in 11 of 40 positions (iteration times swing between ×1.5 and ×10 from one depth to the next), a weaker computer. The conservative one keeps the depth but saves nothing. Rejected; `search.ts` unchanged. Per-move rows (base/head ms, depth):

Ratio: 1487/1459 d3/3 | 1364/1397 d3/3 | 1809/384 d2/2 | 1406/1089 d3/3 | 1428/262 d4/2 | 1804/1802 d2/2 | 1272/1353 d3/3 | 1805/1805 d2/2 | 1805/1804 d2/2 | 1805/1806 d2/2 | 1803/241 d2/2 | 1803/1807 d3/3 | 1221/1166 d3/3 | 1238/140 d4/2 | 1128/1135 d5/5 | 1806/1803 d3/3 | 969/434 d5/3 | 1301/545 d5/3 | 1808/833 d5/5 | 916/937 d5/5 | 813/719 d4/4 | 1444/1409 d4/4 | 1803/827 d6/6 | 1669/1348 d6/6 | 1730/1473 d5/5 | 1262/736 d4/3 | 1620/951 d5/4 | 1336/1438 d5/5 | 1804/1810 d5/5 | 1028/516 d5/3 | 1803/1803 d5/5 | 1796/1802 d6/5 | 1804/1800 d5/6 | 1654/1637 d6/6 | 1805/1806 d5/5 | 939/899 d6/6 | 849/515 d5/4 | 1079/599 d6/5 | 1345/804 d8/7 | 974/990 d8/8

Floor: 1667/1339 d3/3 | 1396/1494 d3/3 | 1807/1802 d2/2 | 1098/1028 d3/3 | 1060/1063 d4/4 | 1805/1802 d2/2 | 1231/1281 d3/3 | 1806/1808 d2/2 | 1806/1803 d2/2 | 1597/1590 d3/3 | 1804/1803 d2/2 | 860/1806 d3/3 | 1139/1149 d3/3 | 983/1036 d4/4 | 987/1068 d5/5 | 1804/1804 d3/3 | 979/1014 d5/5 | 1317/1213 d5/5 | 1805/1804 d5/5 | 1115/975 d5/5 | 1765/887 d5/4 | 1335/1534 d4/4 | 820/1802 d6/6 | 1650/1472 d6/6 | 1711/1735 d5/5 | 1068/717 d4/3 | 1076/1235 d5/5 | 1310/1277 d5/5 | 1804/1806 d5/5 | 1365/1320 d6/6 | 1539/1602 d6/6 | 1546/1486 d6/6 | 1804/1802 d5/5 | 1805/1808 d5/5 | 1802/1807 d4/4 | 1802/1806 d5/5 | 1805/1803 d4/4 | 877/883 d5/5 | 1806/1804 d4/4 | 974/967 d4/4
