import numpy as np, sys
from PIL import Image, ImageDraw
from view import render, shade
d=np.load(sys.argv[1]); V,F=d['V'],d['F']
col=shade(V,F) if 'L' not in d else None
if 'L' in d:
    pal=np.array([[200,200,200],[230,80,80],[80,160,230],[90,200,90],[240,200,60],[200,90,220],[60,210,200],[250,140,40],[140,100,60],[120,120,250],[255,255,255]])
    base=pal[d['L']%len(pal)].astype(float); col=shade(V,F,base)
res=900; out=[]
for v in sys.argv[3].split(','):
    im=Image.fromarray(render(V,F,col,v,res)); dr=ImageDraw.Draw(im); s=res/1.05
    for k in range(-50,51,5):
        x=(k/100+0.5)*s; dr.line([(x,0),(x,res)],fill=(255,0,0) if k%10==0 else (255,180,180),width=1)
        if k%10==0: dr.text((x+2,2),str(k),fill=(200,0,0))
    for k in range(-5,100,5):
        y=res-(k/100+0.05)*s; dr.line([(0,y),(res,y)],fill=(0,0,255) if k%10==0 else (180,180,255),width=1)
        if k%10==0: dr.text((2,y-12),str(k),fill=(0,0,200))
    out.append(np.array(im))
Image.fromarray(np.concatenate(out,1)).save(sys.argv[2])
