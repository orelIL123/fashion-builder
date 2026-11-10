import numpy as np, trimesh, scipy.sparse as sp
from scipy.sparse.csgraph import dijkstra, connected_components
d=np.load('main.npz'); V=d['V'].astype(np.float64); s=np.load('seg1.npz'); keep=s['keep']
F=d['F'][keep]; zc=s['zc'][keep]; side=s['side'][keep]; fh=np.load('firsthit.npy'); cnt3=np.load('layers.npz')['cnt3']
m=trimesh.Trimesh(V,F,process=False); C=m.triangles_center; N=m.face_normals; nF=len(F); A=m.area_faces
adj=m.face_adjacency; ang=m.face_adjacency_angles
G=sp.coo_matrix((np.ones(len(adj)),(adj[:,0],adj[:,1])),shape=(nF,nF))
nc,cl=connected_components(G,directed=False); big=np.bincount(cl)[cl]>=400
x,y,z=C.T; ax=np.abs(x); front=z>zc; thick=fh>0.0115
NAMES=['body','sleeveR','sleeveL','hood','cordR','cordL']
band=(ax>0.025)&(ax<0.08)&(y<0.745)&(z>0.03)
seed={
 'body': (ax<0.17)&(y>0.06)&(y<0.68)&~(band&thick) & ~((~front)&(cnt3>=2)) | ((~front)&(ax<0.15)&(y<0.66)),
 'sleeveR':(side==-1)&(y>0.12)&(y<0.45),
 'sleeveL':(side==1)&(y>0.12)&(y<0.45),
 'hood': (y>0.86) | ((cnt3>=2)&(y>0.70)&(ax<0.2)&~band) | (thick&(y>0.72)&~band),
 'cordR': band&thick&(x<0)&(y>0.36), 'cordL': band&thick&(x>0)&(y>0.36),
}
dist=np.linalg.norm(C[adj[:,0]]-C[adj[:,1]],axis=1); w=dist*(1+80*(1-np.cos(ang)))
W=sp.coo_matrix((np.r_[w,w],(np.r_[adj[:,0],adj[:,1]],np.r_[adj[:,1],adj[:,0]])),shape=(nF,nF)).tocsr()
src=[];srcl=[]
order=['cordR','cordL','hood','sleeveR','sleeveL','body']  # earlier wins on overlap
taken=np.zeros(nF,bool)
for k in order:
    ii=np.where(seed[k]&big&~taken)[0]; taken[ii]=True; src+=list(ii); srcl+=[NAMES.index(k)]*len(ii)
src=np.array(src); srcl=np.array(srcl)
_,_,sources=dijkstra(W,directed=False,indices=src,min_only=True,return_predecessors=True)
lut=np.full(nF,-1); lut[src]=srcl; L=np.where(sources>=0,lut[np.maximum(sources,0)],-1); L[~big]=-1
# cords: keep only the largest connected part of each, the rest goes to its neighbour (body / hood)
def relabel_small(L, lab, fallback):
    ii=np.where(L==lab)[0]
    if not len(ii): return
    msk=np.zeros(nF,bool); msk[ii]=True; g=G.tocsr()[msk][:,msk]; n,c=connected_components(g,directed=False)
    bc=np.bincount(c); 
    for j in range(n):
        if bc[j]<bc.max(): L[ii[c==j]]=fallback
for k in ('cordR','cordL'): relabel_small(L,NAMES.index(k),0)
# fine pieces
P=np.full(nF,'',dtype=object)
body=L==0
P[body&front]='front'; P[body&~front]='back'
P[body&(y<0.057)&front]='hemF'; P[body&(y<0.057)&~front]='hemB'
for s_,nm in ((-1,'R'),(1,'L')):
    ii=np.where(L==NAMES.index('sleeve'+nm))[0]; Q=C[ii]; mu=Q.mean(0); _,_,vt=np.linalg.svd(Q-mu,full_matrices=False); a=vt[0]
    if a[1]>0: a=-a  # pointing down the arm
    t=(Q-mu)@a; tmax=np.percentile(t,99.7)
    cuff=t>tmax-0.066
    P[ii]=np.where(cuff,'cuff'+nm,'sleeve'+nm)
hi=np.where(L==NAMES.index('hood'))[0]; P[hi]=np.where(x[hi]<0,'hoodR','hoodL')
P[L==NAMES.index('cordR')]='cordR'; P[L==NAMES.index('cordL')]='cordL'
P[P=='']='drop'
for k in sorted(set(P)): print(k,(P==k).sum(),round(A[P==k].sum()*1e4),'cm2')
np.savez('pieces_lab.npz',V=V,F=F,P=P.astype(str),zc=zc)
keys=sorted(set(P)); np.savez('vis_p.npz',V=V,F=F,L=np.array([keys.index(p) for p in P]))
print(keys)
