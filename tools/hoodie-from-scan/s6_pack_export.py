import numpy as np, json, glob, struct, trimesh, networkx as nx
from scipy.signal import fftconvolve
from scipy.ndimage import binary_dilation
from shapely.geometry import Polygon
from PIL import Image, ImageDraw
RES=2  # raster cells per cm for packing
GAP=1.0 # cm between pieces
LAB={'front':'Front','back':'Back','sleeveR':'Right sleeve','sleeveL':'Left sleeve','hoodR':'Hood · right','hoodL':'Hood · left',
     'cuffR':'Right cuff','cuffL':'Left cuff','hemF':'Hem band · front','hemB':'Hem band · back','cordR':'Drawstring · right','cordL':'Drawstring · left'}
ORDER=['front','back','sleeveR','sleeveL','hoodR','hoodL','hemF','hemB','cuffR','cuffL','cordR','cordL']
PC={}
for k in ORDER:
    d=np.load(f'piece_{k}.npz'); uv=d['uv']-d['uv'].min(0); PC[k]=dict(v=d['v'],f=d['f'],uv=uv,src=d['src'])
def outline(uv,f):
    e=np.sort(np.vstack([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]),1); ue,c=np.unique(e,axis=0,return_counts=True)
    G=nx.Graph(); G.add_edges_from(map(tuple,ue[c==1])); loops=list(nx.connected_components(G))
    # exterior = loop enclosing the largest area
    best=None
    for L in loops:
        try: cyc=[u for u,_ in nx.find_cycle(G.subgraph(L))]
        except Exception: continue
        poly=Polygon(uv[cyc]); 
        if best is None or abs(poly.area)>abs(best[1].area): best=(cyc,poly)
    poly=best[1].buffer(0)
    if poly.geom_type!='Polygon': poly=max(poly.geoms,key=lambda g:g.area)
    poly=Polygon(poly.exterior).buffer(0.9,join_style=1).buffer(-0.9,join_style=1)
    if poly.geom_type!='Polygon': poly=max(poly.geoms,key=lambda g:g.area)
    poly=Polygon(poly.exterior).simplify(0.15,preserve_topology=True)
    return poly
def mask(uv,f,pad):
    sz=np.ceil((uv.max(0)+2*pad)*RES).astype(int)+2
    im=Image.new('1',(sz[0],sz[1]),0); dr=ImageDraw.Draw(im)
    for t in f: dr.polygon([((uv[i,0]+pad)*RES,(uv[i,1]+pad)*RES) for i in t],fill=1)
    m=np.array(im,bool); return binary_dilation(m,iterations=int(pad*RES))
MASKS={}
def pack(S,keyf):
    H=W=int(S*RES); occ=np.zeros((H,W),bool); pos={}
    for k in sorted(ORDER,key=keyf):
        if k not in MASKS: MASKS[k]=mask(PC[k]['uv'],PC[k]['f'],GAP/2).astype(float)
        m=MASKS[k]; mh,mw=m.shape
        if mh>H or mw>W: return None
        ov=fftconvolve(occ.astype(float),m[::-1,::-1],mode='valid')  # overlap for every top-left
        ok=np.argwhere(ov<0.5)
        if not len(ok): return None
        # bottom-left fill in sheet terms: prefer small row (y in uv space = up), then small x
        i=ok[np.lexsort((ok[:,1],ok[:,0]))[0]]
        occ[i[0]:i[0]+mh,i[1]:i[1]+mw]|=m>0.5; pos[k]=(i[1]/RES+GAP/2, i[0]/RES+GAP/2)
    return pos
KEYS=[lambda k:-PC[k]['uv'].max(0).prod(), lambda k:-PC[k]['uv'].max(0)[1], lambda k:-PC[k]['uv'].max(0)[0], lambda k:-len(PC[k]['f'])]
done=False
for S in range(128,220,2):
    for kf in KEYS:
        pos=pack(S,kf)
        if pos: done=True; break
    if done: break
print('sheetCm',S)
pieces=[]; img=Image.new('RGB',(S*8,S*8),'white'); dr=ImageDraw.Draw(img)
for k in ORDER:
    ox,oy=pos[k]; PC[k]['uv2']=PC[k]['uv']+[ox,oy]
    poly=outline(PC[k]['uv2'],PC[k]['f']); pts=np.array(poly.exterior.coords)[:-1]
    if Polygon(pts).exterior.is_ccw is False: pass
    xs,ys=pts[:,0],pts[:,1]
    pieces.append({'id':k,'label':LAB[k],'minor':k.startswith('cord'),'outline':np.round(pts,2).tolist(),'bbox':[round(xs.min(),2),round(ys.min(),2),round(xs.max(),2),round(ys.max(),2)],
                   'areaCm2':round(float(Polygon(pts).area))})
    dr.polygon([(x*8,(S-y)*8) for x,y in pts],outline='black',fill=(200,210,240)); dr.text((xs.mean()*8,(S-ys.mean())*8),k,fill='red')
img.save('sheet_layout.png')
pat={'sheetCm':S,'pxPerCm':16,'source':'scan','labels':'wearer','mirrorSleeve':False,'stitches':False,'pieces':pieces}
json.dump(pat,open('pattern.json','w'),separators=(',',':'))
# ---- GLB (two meshes: fabric, rib) with smooth normals from the full shell
main=np.load('main.npz'); mm=trimesh.Trimesh(main['V'],main['F'],process=False); VN=mm.vertex_normals
def build(keys):
    P=[];N=[];T=[];I=[];base=0
    for k in keys:
        c=PC[k]; P.append(c['v']); N.append(VN[c['src']]); T.append(np.c_[c['uv2'][:,0]/S,(S-c['uv2'][:,1])/S]); I.append(c['f']+base); base+=len(c['v'])
    return [np.vstack(a).astype(np.float32) for a in (P,N,T)]+[np.vstack(I).astype(np.uint32).ravel()]
fab=build([k for k in ORDER if not (k.startswith('cuff') or k.startswith('hem'))]); rib=build([k for k in ORDER if k.startswith('cuff') or k.startswith('hem')])
bin_=b''; views=[]; acc=[]
def add(arr,target,typ,comp,minmax=False):
    global bin_
    off=len(bin_); data=arr.tobytes(); bin_+=data+b'\0'*((4-len(data)%4)%4)
    views.append({'buffer':0,'byteOffset':off,'byteLength':len(data),'target':target})
    a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if arr.ndim>1 else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    acc.append(a); return len(acc)-1
meshes=[]
for name,(p,n,t,i) in (('hoodie',fab),('hoodie_rib',rib)):
    ip=add(p,34962,'VEC3',5126,True); inn=add(n,34962,'VEC3',5126); it=add(t,34962,'VEC2',5126); ii=add(i,34963,'SCALAR',5125)
    meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':ip,'NORMAL':inn,'TEXCOORD_0':it},'indices':ii,'material':len(meshes)}]})
gl={'asset':{'version':'2.0','generator':'stylooks hoodie pipeline'},'scene':0,'scenes':[{'nodes':[0,1]}],
    'nodes':[{'name':'hoodie','mesh':0},{'name':'hoodie_rib','mesh':1}],'meshes':meshes,
    'materials':[{'name':'fabric','doubleSided':True},{'name':'rib','doubleSided':True}],
    'buffers':[{'byteLength':len(bin_)}],'bufferViews':views,'accessors':acc}
js=json.dumps(gl,separators=(',',':')).encode(); js+=b' '*((4-len(js)%4)%4)
glb=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin_))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin_),0x004E4942)+bin_
open('hoodie_raw.glb','wb').write(glb)
print('tris',(len(fab[3])+len(rib[3]))//3,'glb MB',len(glb)/1e6, 'pieces', [(p['id'],p['bbox']) for p in pieces])
