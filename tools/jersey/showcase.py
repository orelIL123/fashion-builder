# Jersey-style demo design (stripes, chest text, name + number on the back) -> <out>_front/back/side.png and <out>_2d.png
import sys
from playwright.sync_api import sync_playwright
out = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
    page = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
    page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
    page.goto('http://127.0.0.1:8765/?g=jersey', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
    page.evaluate('() => window.__FB.grantLocalTestAccess()')
    page.wait_for_selector('#loading', state='hidden', timeout=60000); page.wait_for_timeout(1000)
    page.evaluate('''async () => { const FB = window.__FB; FB.getLayers().length = 0;
      const img = async (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
        const i = new Image(); i.src = c.toDataURL(); await i.decode(); return i; };
      const stripes = await img(640, 800, (g, w, h) => { for (let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? '#f4f4f0' : '#c8102e'; g.fillRect(i*w/8, 0, w/8, h); } });
      const red = await img(64, 64, (g) => { g.fillStyle = '#c8102e'; g.fillRect(0, 0, 64, 64); });
      const white = await img(64, 64, (g) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 64, 64); });
      const pc = id => { const b = FB.pieceById[id].box; return [(b[0]+b[2])/2, (b[1]+b[3])/2]; };
      for (const id of ['front', 'back']){ const [x, y] = pc(id); FB.addImage(stripes, id+' stripes', x, y, 70); }
      for (const id of ['sleeveR', 'sleeveL']){ const [x, y] = pc(id); FB.addImage(red, id, x, y, 60); }
      { const [x, y] = pc('rib'); FB.addImage(white, 'collar', x, y, 60); }
      const f = FB.pieceById.front.box, bk = FB.pieceById.back.box;
      const dark = {color:'#14171c', font:'Anton'};
      FB.addText('STYLOOKS', (f[0]+f[2])/2, f[1] + 20*FB.PX, 26, dark);
      FB.addText('AHARON', (bk[0]+bk[2])/2, bk[1] + 15*FB.PX, 26, dark);
      FB.addText('10', (bk[0]+bk[2])/2, bk[1] + 36*FB.PX, 26, dark);
      for (const L of FB.getLayers()) if (L.kind === 'text') await FB.rebuildText(L);
      FB.composeSheet(); FB.renderLayers(); FB.commit(); }''')
    page.wait_for_timeout(800)
    page.click('#vPattern'); page.wait_for_timeout(800); page.screenshot(path=f'{out}_2d.png')
    page.click('#v3d'); page.wait_for_timeout(500); gl = page.locator('#gl')
    for cam in ['front', 'back', 'side']:
        page.click(f'[data-cam="{cam}"]'); page.wait_for_timeout(2000); gl.screenshot(path=f'{out}_{cam}.png')
    b.close()
