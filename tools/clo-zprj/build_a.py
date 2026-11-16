# Step A: CLO .zprj -> seam-welded, UV-packed OBJ (UV islands = pattern pieces at true size) + pattern.json.
# python3 build_a.py <spec.json> <out_prefix> <file.zprj>   (needs numpy + scipy)
import sys, json, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from clo_load import load
from scipy.spatial import cKDTree

spec = json.load(open(sys.argv[1])); OUT = sys.argv[2]; SRC = sys.argv[3] if len(sys.argv) > 3 else spec['pac']
ps = {p['name']: p for p in load(SRC)}
SHEET = spec.get('sheetCm', 128); GAP = spec.get('gapCm', 2.0)

def boundary_loops(tri):
    from collections import defaultdict
    cnt = defaultdict(int)
    for t in tri:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            cnt[(a, b)] += 1
    nxt = {}
    for (a, b) in cnt:
        if (b, a) not in cnt: nxt[a] = b
    loops, seen = [], set()
    for s in list(nxt):
        if s in seen: continue
        L = [s]; seen.add(s); c = nxt[s]
        while c != s and c not in seen and c in nxt:
            L.append(c); seen.add(c); c = nxt[c]
        loops.append(L)
    return loops

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; n = np.linalg.norm(ab)
    d = np.abs(ab[0]*(pts[:,1]-a[1]) - ab[1]*(pts[:,0]-a[0])) / n if n > 1e-9 else np.linalg.norm(pts - a, axis=1)
    i = int(np.argmax(d))
    if d[i] > eps: return np.vstack([rdp(pts[:i+1], eps)[:-1], rdp(pts[i:], eps)])
    return np.vstack([a, b])

pieces = []
for s in spec['pieces']:
    p = ps[s['src']]
    used = np.unique(p['tri'])
    remap = -np.ones(len(p['p3']), int); remap[used] = np.arange(len(used))
    P = dict(s, v=p['p3'][used] / 1000.0, r=p['rest'][used] / 10.0, t=remap[p['tri']])
    if s.get('flipU'): P['r'][:, 0] *= -1
    loops = boundary_loops(P['t'])
    P['loops'] = loops
    P['bnd'] = np.unique(np.concatenate(loops))
    pieces.append(P)

# ---- weld seams: pull boundary vertices onto the neighbouring pieces' boundary polylines ----
TH = spec.get('weldMm', 7) / 1000.0
def seg_project(q, A, B):
    ab = B - A; t = np.clip(((q[:, None, :] - A[None]) * ab[None]).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12)[None], 0, 1)
    proj = A[None] + t[..., None] * ab[None]
    d = np.linalg.norm(q[:, None, :] - proj, axis=-1)
    k = d.argmin(1); return proj[np.arange(len(q)), k], d[np.arange(len(q)), k]
stats = []
NIT = spec.get('weldIters', 8)
for it in range(NIT):
    segs = []
    for pi, P in enumerate(pieces):
        for L in P['loops']:
            L = np.array(L); L2 = np.roll(L, -1)
            segs.append((pi, P['v'][L], P['v'][L2], P['r'][L], P['r'][L2]))
    moves = []
    for pi, P in enumerate(pieces):
        q = P['v'][P['bnd']]; q2 = P['r'][P['bnd']]
        best = np.full(len(q), np.inf); bp = q.copy()
        for (pj, A, B, A2, B2) in segs:
            mid = (A + B) / 2; tr = cKDTree(mid)
            dd, _ = tr.query(q, k=1)
            idx = np.where(dd < TH * 4)[0]
            if not len(idx): continue
            k = min(8, len(mid)); _, kn = tr.query(q[idx], k=k); kn = kn.reshape(len(idx), -1)
            for j, qi in enumerate(idx):
                ks = kn[j]
                if pj == pi:  # self seam (e.g. underarm): only segments far away on the flat pattern
                    far = np.minimum(np.linalg.norm(A2[ks] - q2[qi], axis=1), np.linalg.norm(B2[ks] - q2[qi], axis=1)) > 3.0
                    ks = ks[far]
                    if not len(ks): continue
                pr, d = seg_project(q[qi:qi+1], A[ks], B[ks])
                if d[0] < best[qi]: best[qi] = d[0]; bp[qi] = pr[0]
        ok = best < TH
        moves.append((pi, P['bnd'][ok], (q[ok] + bp[ok]) / 2))
        stats.append((it, P['id'], int(ok.sum()), len(q), round(float(np.median(best[ok]) * 1000), 3) if ok.any() else 0, round(float(best[ok].max()*1000),2) if ok.any() else 0))
    for pi, ids, newp in moves: pieces[pi]['v'][ids] = newp
for s in stats[:len(pieces)]: print('weld0', s)
for s in stats[-len(pieces):]: print('weld', s)

# ---- pack pieces on the sheet at true size (cm), keep CLO orientation ----
for P in pieces:
    P['w'] = P['r'][:, 0].max() - P['r'][:, 0].min(); P['h'] = P['r'][:, 1].max() - P['r'][:, 1].min()
order = sorted(range(len(pieces)), key=lambda i: (-pieces[i]['h']))
if spec.get('order'): order = [next(i for i, P in enumerate(pieces) if P['id'] == pid) for pid in spec['order']]
x = y = GAP; rowH = 0
for i in order:
    P = pieces[i]
    if x + P['w'] + GAP > SHEET: x = GAP; y += rowH + GAP; rowH = 0
    P['off'] = np.array([x - P['r'][:, 0].min(), y - P['r'][:, 1].min()])
    x += P['w'] + GAP; rowH = max(rowH, P['h'])
top = y + rowH + GAP
print('sheet used height', round(top, 1), 'of', SHEET)
assert top <= SHEET, 'pieces do not fit'

# ---- write OBJ (Y up, front +Z, metres) + pattern.json ----
out_p = []
with open(OUT + '.obj', 'w') as f:
    f.write('mtllib none.mtl\no Garment\n')
    vo = 1
    for P in pieces:
        for v in P['v']: f.write('v %.5f %.5f %.5f\n' % tuple(v))
    for P in pieces:
        sx = P['r'] + P['off']
        for (a, b) in sx: f.write('vt %.6f %.6f\n' % (a / SHEET, b / SHEET))  # OBJ v is bottom-up
    vbase = 1; tbase = 1
    for P in pieces:
        f.write('usemtl %s\n' % ('Rib' if P.get('rib') else 'Fabric'))
        for t in P['t']:
            a, b, c = t + vbase; ta, tb, tc = t + tbase
            f.write('f %d/%d %d/%d %d/%d\n' % (a, ta, b, tb, c, tc))
        vbase += len(P['v']); tbase += len(P['v'])
    for P in pieces:
        sx = P['r'] + P['off']
        L = max(P['loops'], key=len)
        poly = sx[L]
        # outer loop must be the longest by perimeter
        per = lambda l: np.linalg.norm(np.diff(sx[l + [l[0]]], axis=0), axis=1).sum()
        L = max(P['loops'], key=per); poly = sx[L]
        poly = rdp(np.vstack([poly, poly[:1]]), 0.06)[:-1]
        d = {'id': P['id'], 'label': P['label'], 'outline': [[round(a, 3), round(b, 3)] for a, b in poly],
             'bbox': [round(float(sx[:, 0].min()), 3), round(float(sx[:, 1].min()), 3), round(float(sx[:, 0].max()), 3), round(float(sx[:, 1].max()), 3)]}
        if P.get('minor'): d['minor'] = True
        out_p.append(d)
        print(P['id'], P['label'], 'size cm', round(P['w'], 1), round(P['h'], 1), 'outline pts', len(poly), 'loops', len(P['loops']), 'tris', len(P['t']))
pat = {'sheetCm': SHEET, 'pxPerCm': 16, 'source': 'clo', 'labels': 'wearer', 'mirrorSleeve': False, 'pieces': out_p}
pat.update(spec.get('patternExtra', {}))
json.dump(pat, open(OUT + '_pattern.json', 'w'), separators=(',', ':'))
