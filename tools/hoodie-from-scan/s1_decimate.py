import numpy as np, fast_simplification, time, sys
import os
D=os.environ.get('HOODIE_OBJ','hoodie_scan.obj')  # the original 1.5M-triangle scan (not in the repo)
t=time.time(); V=[]; F=[]
with open(D) as f:
    for line in f:
        if line.startswith('v '): V.append(line[2:])
        elif line.startswith('f '):
            F.append(' '.join(x.split('/')[0] for x in line[2:].split()))
V=np.loadtxt(V, dtype=np.float64); F=np.loadtxt(F, dtype=np.int64)-1
print('parsed', V.shape, F.shape, time.time()-t, V.min(0), V.max(0))
P,Fo=fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_reduction=1-100000/len(F))
print('decimated', P.shape, Fo.shape)
np.savez('dec.npz', V=P, F=Fo)
import trimesh
m=trimesh.Trimesh(P,Fo,process=True); m=max(m.split(only_watertight=False),key=lambda b:len(b.faces))  # drop 2-triangle specks
np.savez('main.npz',V=m.vertices,F=m.faces); print('main shell',m.faces.shape,'watertight',m.is_watertight)
