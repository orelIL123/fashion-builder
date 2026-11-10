import numpy as np, sys
from PIL import Image
def render(V,F,col,axis,res=700,flip=False):
    # orthographic z-buffer raster, view along -axis
    if axis=='front': X,Y,Z=V[:,0],V[:,1],V[:,2]
    elif axis=='back': X,Y,Z=-V[:,0],V[:,1],-V[:,2]
    elif axis=='side': X,Y,Z=-V[:,2],V[:,1],V[:,0]
    elif axis=='side2': X,Y,Z=V[:,2],V[:,1],-V[:,0]
    elif axis=='top': X,Y,Z=V[:,0],-V[:,2],V[:,1]
    lo=np.array([-0.5,-0.05]); s=res/1.05
    px=((X-lo[0])*s); py=res-((Y-lo[1])*s)
    img=np.full((res,res,3),255,np.uint8); zb=np.full((res,res),-1e9)
    tri=F
    for t,(a,b,c) in enumerate(tri):
        xs=px[[a,b,c]]; ys=py[[a,b,c]]; zs=Z[[a,b,c]]
        x0,x1=int(max(0,xs.min())),int(min(res-1,xs.max()+1)); y0,y1=int(max(0,ys.min())),int(min(res-1,ys.max()+1))
        if x1<x0 or y1<y0: continue
        gx,gy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        d=(ys[1]-ys[2])*(xs[0]-xs[2])+(xs[2]-xs[1])*(ys[0]-ys[2])
        if abs(d)<1e-12: continue
        l0=((ys[1]-ys[2])*(gx-xs[2])+(xs[2]-xs[1])*(gy-ys[2]))/d; l1=((ys[2]-ys[0])*(gx-xs[2])+(xs[0]-xs[2])*(gy-ys[2]))/d; l2=1-l0-l1
        m=(l0>=0)&(l1>=0)&(l2>=0)
        if not m.any(): continue
        z=l0*zs[0]+l1*zs[1]+l2*zs[2]
        yy=(gy[m]-.5).astype(int); xx=(gx[m]-.5).astype(int); zz=z[m]
        w=zz>zb[yy,xx]; zb[yy[w],xx[w]]=zz[w]; img[yy[w],xx[w]]=col[t]
    return img
def shade(V,F,base=None):
    n=np.cross(V[F[:,1]]-V[F[:,0]],V[F[:,2]]-V[F[:,0]]); n/=np.linalg.norm(n,axis=1,keepdims=True)+1e-12
    l=np.clip(0.35+0.65*np.abs(n@np.array([0.3,0.5,0.8])/np.linalg.norm([0.3,0.5,0.8])),0,1)
    if base is None: base=np.full((len(F),3),200.)
    return (base*l[:,None]).astype(np.uint8)
def sheet(V,F,col,out,views=('front','back','side','top')):
    ims=[render(V,F,col,v) for v in views]
    Image.fromarray(np.concatenate(ims,1)).save(out)
if __name__=='__main__':
    d=np.load(sys.argv[1]); V,F=d['V'],d['F']; sheet(V,F,shade(V,F),sys.argv[2])
