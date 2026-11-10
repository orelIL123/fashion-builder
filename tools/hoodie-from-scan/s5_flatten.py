import numpy as np, trimesh, igl, json, scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from collections import Counter
d=np.load('pieces_lab.npz',allow_pickle=True); V=d['V']; F=d['F']; P=d['P'].astype(object); zc=d['zc']
m=trimesh.Trimesh(V,F,process=False); C=m.triangles_center; nF=len(F); A3=m.area_faces
adj=m.face_adjacency
_h=(np.char.startswith(P.astype(str),'hood'))&(np.abs(C[:,0])>0.185)&(C[:,1]<0.82)
P[_h]=np.where(C[_h,2]>zc[_h],'front','back')
x_,y_,z_=C.T; ax_=np.abs(x_); fr_=z_>zc; Ps=P.astype(str)
hoodrule=(~np.char.startswith(Ps,'cord'))&(Ps!='drop')&(((ax_<0.185)&((y_>0.805)|(fr_&(y_>0.74+0.42*ax_))))|((ax_<0.24)&(y_>0.83)))
P[hoodrule]=np.where(x_[hoodrule]<0,'hoodR','hoodL')
nb=[[] for _ in range(nF)]
for a,b in adj: nb[a].append(b); nb[b].append(a)
# smoothing: majority filter (keeps the clean front/back/hem/cuff cuts mostly intact)
for it in range(12):
    Q=P.copy()
    for f in range(nF):
        if P[f]=='drop': continue
        c=Counter(P[g] for g in nb[f] if P[g]!='drop'); c[P[f]]+=1
        lab,n=c.most_common(1)[0]
        if n>=3 and lab!=P[f]: Q[f]=lab
    P=Q
# every piece = one connected island: stray bits join their neighbours
Gm=sp.coo_matrix((np.ones(len(adj)),(adj[:,0],adj[:,1])),shape=(nF,nF)).tocsr()
for it in range(3):
    for k in sorted(set(P)-{'drop'}):
        ii=np.where(P==k)[0]; msk=np.zeros(nF,bool); msk[ii]=True
        n,c=connected_components(Gm[msk][:,msk],directed=False); bc=np.bincount(c)
        for j in range(n):
            if bc[j]==bc.max(): continue
            fs=ii[c==j]; cc=Counter(P[g] for f in fs for g in nb[f] if P[g]!=k and P[g]!='drop')
            P[fs]=cc.most_common(1)[0][0] if cc else 'drop'
# close pinholes: faces the visibility filter dropped but that sit inside a piece come back
full=np.load('main.npz')['F']; keep=np.load('seg1.npz')['keep']; mf=trimesh.Trimesh(V,full,process=False)
kid=-np.ones(len(full),int); kid[np.where(keep)[0]]=np.arange(keep.sum())
lab_full=np.full(len(full),'',dtype=object); lab_full[keep]=P
fadj=mf.face_adjacency; fnb=[[] for _ in range(len(full))]
for a,b in fadj: fnb[a].append(b); fnb[b].append(a)
added=0
for it in range(4):
    new={}
    for f in np.where(lab_full=='')[0]:
        c=Counter(lab_full[g] for g in fnb[f] if lab_full[g] not in ('','drop'))
        if sum(c.values())>=2: new[f]=c.most_common(1)[0][0]
    for f,l in new.items(): lab_full[f]=l
    added+=len(new)
print('pinhole faces added',added)
sel=np.where(lab_full!='')[0]; F=full[sel]; P=lab_full[sel]
m=trimesh.Trimesh(V,F,process=False); C=m.triangles_center; nF=len(F)
np.save('P_final.npy',P.astype(str)); np.save('F_final.npy',F)
out={}
import networkx as nx
from scipy.sparse.csgraph import dijkstra as _dij
def cut_tube(Fp, inner_dir):
    """Open a tube along its underarm line: shortest path between the two rims that prefers the inner side, then split it."""
    e=np.sort(np.vstack([Fp[:,[0,1]],Fp[:,[1,2]],Fp[:,[2,0]]]),1); ue,cnt=np.unique(e,axis=0,return_counts=True)
    Gb=nx.Graph(); Gb.add_edges_from(map(tuple,ue[cnt==1])); loops=sorted(nx.connected_components(Gb),key=len,reverse=True)
    if len(loops)<2: return Fp,[]
    L1,L2=list(loops[0]),list(loops[1])
    Cp=V[Fp].mean(1); mu=Cp.mean(0); _,_,vt=np.linalg.svd(Cp-mu,full_matrices=False); ax=vt[0]
    vs=np.unique(Fp); P3=V[vs]; t=(P3-mu)@ax; tb=np.round(t*30).astype(int); cen=np.zeros_like(P3)
    for b_ in np.unique(tb): q=tb==b_; cen[q]=P3[q].mean(0)
    r=P3-cen; r-=(r@ax)[:,None]*ax; r/=np.linalg.norm(r,axis=1,keepdims=True)+1e-9
    idir=inner_dir-ax*(inner_dir@ax); idir/=np.linalg.norm(idir); score=dict(zip(vs,(r@idir)))
    n=len(V)+1; ll=np.linalg.norm(V[ue[:,0]]-V[ue[:,1]],axis=1)
    pen=np.array([1+40*(1-(score[a_]+score[b_])/2)**2 for a_,b_ in ue])
    W=sp.coo_matrix((np.r_[ll*pen,ll*pen],(np.r_[ue[:,0],ue[:,1]],np.r_[ue[:,1],ue[:,0]])),shape=(len(V),len(V))).tocsr()
    D,pred,srcs=_dij(W,directed=False,indices=L1,min_only=True,return_predecessors=True)
    end=L2[int(np.argmin(D[L2]))]; path=[end]
    while pred[path[-1]]>=0: path.append(pred[path[-1]])
    cut=set(tuple(sorted(x)) for x in zip(path[:-1],path[1:]))
    Fp=Fp.copy(); newV=[]
    for v in path:
        fs=np.where((Fp==v).any(1))[0]
        if len(fs)<2: continue
        g=nx.Graph(); g.add_nodes_from(fs)
        for i_ in range(len(fs)):
            for j_ in range(i_+1,len(fs)):
                sh=set(Fp[fs[i_]])&set(Fp[fs[j_]])
                if len(sh)==2:
                    o=(sh-{v}).pop() if v in sh else None
                    if o is not None and tuple(sorted((v,o))) not in cut: g.add_edge(fs[i_],fs[j_])
        comps=list(nx.connected_components(g))
        for comp in comps[1:]:
            nid=len(V)+len(extraV)+len(newV); newV.append(v)
            for fi in comp: Fp[fi][Fp[fi]==v]=nid
    return Fp,newV
extraV=[]
pieces={}
for k in sorted(set(P)-{'drop'}):
    Fp=F[P==k]
    if k.startswith('sleeve') or k.startswith('cuff'):
        s=-1 if k.endswith('R') else 1
        Fp,newV=cut_tube(Fp, np.array([-s,-0.5,0.]))  # underarm: towards the body and down
        extraV+=newV
    pieces[k]=Fp
VV=np.vstack([V, V[extraV]]) if extraV else V
src_index=np.r_[np.arange(len(V)), np.array(extraV,int)]
res={}
for k,Fp in pieces.items():
    used=np.unique(Fp); loc=-np.ones(len(VV),int); loc[used]=np.arange(len(used)); f=loc[Fp]; v=VV[used]
    # topology
    e=np.sort(np.vstack([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]),1); ue,cnt=np.unique(e,axis=0,return_counts=True)
    nonman=(cnt>2).sum(); bnd=ue[cnt==1]
    import networkx as nx
    Gb=nx.Graph(); Gb.add_edges_from(map(tuple,bnd)); loops=nx.number_connected_components(Gb)
    eul=len(v)-len(ue)+len(f); genus=(2-eul-loops)/2
    bl=igl.boundary_loop(f.astype(np.int64))
    bl=np.array(bl); 
    # LSCM with two far-apart boundary vertices
    pb=v[bl]; i0=0; dd=np.linalg.norm(pb-pb[i0],axis=1); i1=int(np.argmax(dd)); dd=np.linalg.norm(pb-pb[i1],axis=1); i0=int(np.argmax(dd))
    b=np.array([bl[i0],bl[i1]],dtype=np.int64); bc=np.array([[0,0],[np.linalg.norm(pb[i0]-pb[i1]),0]])
    try: uv,_=igl.lscm(v,f.astype(np.int64),b,bc)
    except RuntimeError:
        # unreferenced / degenerate bits: fall back to a harmonic map onto a circle
        bnd=igl.map_vertices_to_circle(v,bl.astype(np.int64)); uv=igl.harmonic(v,f.astype(np.int64),bl.astype(np.int64),bnd,1)
    a3=np.linalg.norm(np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]]),axis=1)/2
    def sarea(u): return ((u[f[:,1],0]-u[f[:,0],0])*(u[f[:,2],1]-u[f[:,0],1])-(u[f[:,2],0]-u[f[:,0],0])*(u[f[:,1],1]-u[f[:,0],1]))/2
    sa=sarea(uv)
    if sa.sum()<0: uv[:,0]*=-1; sa=-sa
    uv*=np.sqrt(a3.sum()/sa.sum())
    # ARAP refinement (true scale)
    try:
        data=igl.ARAPData(); data.with_dynamics=False; data.energy=igl.ARAP_ENERGY_TYPE_ELEMENTS; data.max_iter=60
        fa=f[a3>1e-9].astype(np.int64)
        bfix=np.array([bl[0]],dtype=np.int32)
        igl.arap_precomputation(v,fa,2,bfix,data)
        uv2=igl.arap_solve(uv[bfix].copy(),data,uv.copy())
        if np.isfinite(uv2).all():
            s2=sarea(uv2)
            if s2.sum()<0: uv2[:,0]*=-1; s2=-s2
            if (s2<=0).sum()<= (sa<=0).sum()+5: uv=uv2; sa=s2
    except Exception as ex: print('arap failed',k,ex)
    # rotate so world up (+y) points up the pattern
    Aq=np.c_[uv,np.ones(len(uv))]; coef,*_=np.linalg.lstsq(Aq,v[:,1],rcond=None); g=coef[:2]; th=np.arctan2(g[0],g[1])
    R=np.array([[np.cos(th),-np.sin(th)],[np.sin(th),np.cos(th)]]); uv=uv@R.T
    sa=sarea(uv); ratio=sa/a3
    res[k]=dict(nf=len(f),nv=len(v),loops=loops,genus=genus,nonman=int(nonman),flipped=int((sa<=0).sum()),
        area3=round(a3.sum()*1e4),area2=round(sa.sum()*1e4),dist_p5_p95=np.percentile(ratio,[5,95]).round(2).tolist(),
        size_cm=((uv.max(0)-uv.min(0))*100).round(1).tolist())
    np.savez(f'piece_{k}.npz',v=v,f=f,uv=uv*100,src=src_index[used])
    print(k,res[k])
json.dump(res,open('flatten_report.json','w'),indent=1)
