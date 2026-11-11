import sys, math
from PIL import Image
from playwright.sync_api import sync_playwright
prefix=sys.argv[1]; url=sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:8765/?g=hoodie'
VIEWS={'front':(0,0.05,1),'back':(0,0.05,-1),'left':(1,0.05,0),'right':(-1,0.05,0),'top':(0.05,1,0.25),'under':(0.05,-1,0.35),'frontlow':(0.4,-0.5,1),'hoodin':(0,0.25,1)}
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader']); pg=b.new_page(viewport={'width':1200,'height':900})
    pg.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
    pg.goto(url,timeout=120000); pg.wait_for_function('() => window.__FB && window.__dbg && window.__dbg.shirtMeshes.length',timeout=180000)
    pg.evaluate('() => window.__FB.grantLocalTestAccess()'); pg.wait_for_timeout(800); pg.click('#v3d'); pg.wait_for_timeout(1200)
    pg.evaluate("() => { window.__FB.getLayers().length = 0; window.__FB.composeSheet(); }")
    tiles=[]
    for k,(x,y,z) in VIEWS.items():
        d = 0.75 if k=='hoodin' else 2.0
        cy = 0.33 if k=='hoodin' else 0.0
        pg.evaluate(f"""() => {{ const D=window.__dbg, c=D.camera, t=D.controls.target; t.set(0,{cy},0); const n=Math.hypot({x},{y},{z});
           c.position.set({x}/n*{d}, {cy}+{y}/n*{d}, {z}/n*{d}); c.lookAt(t); D.controls.update(); D.render(); }}""")
        pg.wait_for_timeout(900); f=f'/workspace/shots/{prefix}_{k}.png'; pg.locator('#gl').screenshot(path=f); tiles.append(Image.open(f).convert('RGB'))
    w,h=tiles[0].size; s=0.4; th=[t.resize((int(w*s),int(h*s))) for t in tiles]
    sheet=Image.new('RGB',(th[0].width*4,th[0].height*2))
    for i,t in enumerate(th): sheet.paste(t,((i%4)*t.width,(i//4)*t.height))
    sheet.save(f'/workspace/shots/{prefix}_sheet.png'); b.close()
