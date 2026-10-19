"""A vs B at equal nodes from randomized openings, each opening played twice with colours swapped."""
import sys, collections, math
from pv import *
def match(nA, nB, featA, featB, valsA, valsB, n, seed=7000, board=START, rand_plies=8, nodes_b=None, workers=4):
    jobs=[]
    for i in range(n):
        a_white = i % 2 == 0
        jobs.append(dict(id=i, board=board, rand_plies=rand_plies, rand_margin=40, seed=seed + i // 2, keep=3,
            nodes_w=nA if a_white else nB, nodes_b=nB if a_white else nA,
            vals_w=valsA if a_white else valsB, vals_b=valsB if a_white else valsA,
            feat_w=featA if a_white else featB, feat_b=featB if a_white else featA))
    res,_=run_jobs(jobs, workers=workers, progress=False)
    sc=[]; dA=[]; dB=[]
    for i,r in res.items():
        a_white = i % 2 == 0
        sc.append(r['result'] if a_white else 1-r['result'])
        dA.append(r['depth_w'] if a_white else r['depth_b']); dB.append(r['depth_b'] if a_white else r['depth_w'])
    m,se=score_stats(sc)
    elo = -400*math.log10(1/m-1) if 0<m<1 else float('nan')
    return m, se, elo, sum(dA)/len(dA), sum(dB)/len(dB), collections.Counter(r['reason'] for r in res.values())
if __name__=='__main__':
    nodes=int(sys.argv[1]); fa=int(sys.argv[2]); fb=int(sys.argv[3]); n=int(sys.argv[4])
    m,se,elo,da,db,c=match(nodes,nodes,fa,fb,vals(CUR),vals(CUR),n)
    print(f'nodes {nodes}: feat {fa} vs {fb}: score {m:.3f} ± {se:.3f} ({elo:+.0f} Elo), depth {da:.2f} vs {db:.2f}', dict(c))
