import numpy as np, trimesh, scipy.sparse as sp
from scipy.sparse.csgraph import dijkstra, connected_components
d=np.load('main.npz'); V=d['V'].astype(np.float64); F=d['F']
m=trimesh.Trimesh(V,F,process=False)
C=m.triangles_center; N=m.face_normals; A=m.area_faces; nF=len(F)
# ---- 1. visibility from outside (ambient-occlusion style escape fraction)
rng=np.random.default_rng(1); K=48
ray=trimesh.ray.ray_pyembree.RayMeshIntersector(m)
esc=np.zeros(nF)
for k in range(K):
    r=rng.normal(size=(nF,3)); r/=np.linalg.norm(r,axis=1,keepdims=True)
    r=r*np.sign((r*N).sum(1))[:,None]; r=0.5*r+N; r/=np.linalg.norm(r,axis=1,keepdims=True) # biased to the normal
    hit=ray.intersects_any(C+N*2e-4, r)
    esc+= ~hit
esc/=K
# ---- 2. radial (outer vs lining) test
yb=np.round(C[:,1]*50).astype(int)
zc=np.zeros(nF)
for b in np.unique(yb):
    s=(yb==b)&(np.abs(C[:,0])<0.15)
    zc[yb==b]=(C[s,2].max()+C[s,2].min())/2 if s.sum()>10 else 0
rad=np.stack([C[:,0],np.zeros(nF),C[:,2]-zc],1); rad/=np.linalg.norm(rad,axis=1,keepdims=True)+1e-9
tor=(N*rad).sum(1)
hc=np.array([0,0.835,-0.03]); hv=C-hc; hv/=np.linalg.norm(hv,axis=1,keepdims=True)
hood=(N*hv).sum(1)
# sleeves: radial from per-slice centroid of the sleeve tube (zone |x|>0.27 or below-armpit side components)
side=np.zeros(nF,int)
sel=np.where(C[:,1]<0.47)[0]; sub=sp.coo_matrix((np.ones(len(m.face_adjacency)),(m.face_adjacency[:,0],m.face_adjacency[:,1])),shape=(nF,nF)).tocsr()
mask=np.zeros(nF,bool); mask[sel]=True
G=sub[mask][:,mask]; nc,lab=connected_components(G,directed=False)
for c in range(nc):
    ii=sel[lab==c]; mx=C[ii,0].mean()
    if len(ii)>1000 and abs(mx)>0.2: side[ii]=np.sign(mx)
side[(C[:,1]>=0.47)&(np.abs(C[:,0])>0.265)&(C[:,1]<0.82)]=np.sign(C[(C[:,1]>=0.47)&(np.abs(C[:,0])>0.265)&(C[:,1]<0.82),0])
sl=np.zeros(nF)
for s in (-1,1):
    ii=np.where(side==s)[0]; P=C[ii]; mu=P.mean(0); u,S,vt=np.linalg.svd(P-mu,full_matrices=False); ax=vt[0]
    t=(P-mu)@ax; tb=np.round(t*40).astype(int)
    cen=np.zeros_like(P)
    for b in np.unique(tb): q=tb==b; cen[q]=P[q].mean(0)
    rv=P-cen; rv-= (rv@ax)[:,None]*ax; rv/=np.linalg.norm(rv,axis=1,keepdims=True)+1e-9
    sl[ii]=(N[ii]*rv).sum(1)
zone=np.where(side!=0,1,np.where(C[:,1]>0.80,2,0))
test=np.where(zone==1,sl,np.where(zone==2,hood,tor))
keep=(test>-0.15)&(esc>0.04)
print('kept',keep.sum(),'of',nF,'area',A[keep].sum(),'of',A.sum())
np.savez('seg1.npz',keep=keep,esc=esc,test=test,zone=zone,side=side,zc=zc)
