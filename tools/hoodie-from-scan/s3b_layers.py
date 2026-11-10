import numpy as np, trimesh
d=np.load('main.npz'); V=d['V'].astype(np.float64); Fall=d['F']; s=np.load('seg1.npz'); keep=s['keep']
full=trimesh.Trimesh(V,Fall,process=False)
F=Fall[keep]; m=trimesh.Trimesh(V,F,process=False); C=m.triangles_center; N=m.face_normals
ray=trimesh.ray.ray_pyembree.RayMeshIntersector(full)
o=C-N*1e-4; dirs=-N
loc,ri,ti=ray.intersects_location(o,dirs,multiple_hits=True)
dd=np.linalg.norm(loc-o[ri],axis=1)
cnt3=np.bincount(ri[dd<0.03],minlength=len(F)); cnt15=np.bincount(ri[dd<0.015],minlength=len(F))
np.savez('layers.npz',cnt3=cnt3,cnt15=cnt15)
print(np.bincount(np.minimum(cnt3,6)))
np.savez('vis_layers.npz',V=V,F=F,L=np.minimum(cnt3,6))
