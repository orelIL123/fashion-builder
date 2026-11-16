# Look-check in the real app: whole pieces filled (front red, back blue, sleeves yellow/orange, collar green), 4 camera views.
# python3 tools/jersey/shots.py <out_prefix>   (local server on :8765)
import sys
from playwright.sync_api import sync_playwright
out = sys.argv[1]; GQ = sys.argv[2] if len(sys.argv) > 2 else 'jersey'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
    page = b.new_context(viewport={'width': 1100, 'height': 900}).new_page()
    page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
    page.goto('http://127.0.0.1:8765/?g=' + GQ, wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
    page.evaluate('() => window.__FB.grantLocalTestAccess()')
    page.wait_for_selector('#loading', state='hidden', timeout=60000); page.wait_for_timeout(1000)
    page.evaluate('''async () => { const FB = window.__FB; FB.getLayers().length = 0;
      const sq = async col => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0,0,64,64);
        for (let i = 0; i < 64; i += 8){ g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
        const img = new Image(); img.src = c.toDataURL(); await img.decode(); return img; };
      for (const [id, col] of [['front','#e02020'],['back','#2040e0'],['sleeveR','#f0d000'],['sleeveL','#f08000'],['rib','#10b040']]){ const b = FB.pieceById[id].box;
        FB.addImage(await sq(col), id, (b[0]+b[2])/2, (b[1]+b[3])/2, 90); }
      FB.composeSheet(); FB.renderLayers(); FB.commit(); }''')
    page.click('#v3d'); page.wait_for_timeout(500)
    gl = page.locator('#gl')
    for cam in ['front', 'back', 'side']:
        page.click(f'[data-cam="{cam}"]'); page.wait_for_timeout(1800); gl.screenshot(path=f'{out}_{cam}.png')
    page.evaluate('() => { const d = window.__dbg; d.controls.setAzimuthalAngle ? null : null; const c = d.camera; const r = Math.hypot(c.position.x, c.position.z); c.position.set(-r*0.75, c.position.y + 0.25, r*0.66); d.controls.update(); }')
    page.mouse.move(550, 450); page.wait_for_timeout(1800); gl.screenshot(path=f'{out}_q34.png')
    b.close()
