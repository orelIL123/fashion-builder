# Read the pattern pieces out of a CLO garment (.pac inside .zpac inside .zprj): per piece the flat 2D mesh (mm),
# the draped 3D position of every vertex (mm, Y up, front +Z) and the triangles. Only geometry is read — no fabrics,
# prints, graphics or trims.
import os, struct, sys, zipfile, io, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pac import node, lst

def getmap(d, o): return {n: (t, vo, vs) for n, t, vo, vs in node(d, o)}
def path(d, o, *keys):
    for k in keys:
        t, o, s = getmap(d, o)[k]
    return o
def raw(d, o, k):
    t, vo, vs = getmap(d, o)[k]; return d[vo:vo+vs]
def val(d, o, k):
    t, vo, vs = getmap(d, o)[k]; b = d[vo:vo+vs]
    if t == 15:
        try: return b.decode()
        except UnicodeDecodeError: return b
    if t == 5: return struct.unpack('<I', b)[0]
    if t == 4: return struct.unpack('<i', b)[0]
    if t == 6: return struct.unpack('<f', b)[0]
    if t == 1: return b[0]
    return np.frombuffer(b, '<f4')

def pac_bytes(fn):
    """.zprj / .zpac are zip containers (with a CLO header); return the garment .pac bytes."""
    if fn.endswith('.pac'): return open(fn, 'rb').read()
    z = zipfile.ZipFile(fn)
    zpac = [n for n in z.namelist() if n.endswith('.zpac')]
    if zpac: z = zipfile.ZipFile(io.BytesIO(z.read(zpac[0])))
    return z.read([n for n in z.namelist() if n.endswith('.pac')][0])

def load(fn):
    d = pac_bytes(fn)
    pe = path(d, 0, 'mapPatternEditor', 'mapPatternList')
    t, els = lst(d, getmap(d, pe)['listPattern'][1])
    out = []
    for i, (eo, es) in enumerate(els):
        m = getmap(d, eo)
        m2 = path(d, eo, 'mapFabricShape2D', 'mapMesh2D')
        out.append(dict(i=i, name=val(d, m['mapElement'][1], 'qsNameUTF8'),
            rest=np.frombuffer(raw(d, m2, 'baRest'), '<f4').reshape(-1, 2).astype(float),
            tri=np.frombuffer(raw(d, m2, 'baTri'), '<u4').reshape(-1, 3).astype(int),
            p3=np.frombuffer(raw(d, eo, 'baPosition3D'), '<f4').reshape(-1, 3).astype(float),
            lay=val(d, m['mapPatternDynamics'][1], 'iLayer'), arr=val(d, m['mapArrange'][1], 'qsNameUTF8')))
    return out

if __name__ == '__main__':  # list the pieces of a .zprj
    for p in load(sys.argv[1]):
        q, r = p['p3'], p['rest']
        print(f"{p['i']:2d} {p['name']:24s} layer {p['lay']:2d} verts {len(q):6d} tris {len(p['tri']):6d} flat {np.ptp(r,0).round(0)} mm  3D min {q.min(0).round(0)} max {q.max(0).round(0)}")
