# Shell thickness per kept face: distance to the first surface behind it (fabric ≈ 8.5 mm; drawstrings / pocket ≥ 12 mm).
import numpy as np, trimesh
d=np.load('main.npz'); V=d['V'].astype(np.float64); Fall=d['F']; keep=np.load('seg1.npz')['keep']
full=trimesh.Trimesh(V,Fall,process=False); F=Fall[keep]; m=trimesh.Trimesh(V,F,process=False); C=m.triangles_center; N=m.face_normals
ray=trimesh.ray.ray_pyembree.RayMeshIntersector(full)
o=C-N*1e-4; loc,ri,ti=ray.intersects_location(o,-N,multiple_hits=False)
fh=np.full(len(F),1.0); fh[ri]=np.linalg.norm(loc-o[ri],axis=1)
np.save('firsthit.npy',fh); print('thickness mm p5/p50/p95', np.percentile(fh*1000,[5,50,95]).round(2))
