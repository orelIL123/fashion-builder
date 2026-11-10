#!/usr/bin/env python3
"""Brush paint lands on top of an added image, and Remove background cuts a plain backdrop.
Run a local server first: python3 -m http.server 8765"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')


def assert_(c, m):
    if not c:
        raise AssertionError(m)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#landing', state='hidden', timeout=10000)

        # an older brush layer exists, then a photo (white backdrop, red disc) is added on the front piece
        info = page.evaluate('''async () => { const FB = window.__FB, f = FB.pieceById.front.box, cx = (f[0]+f[2])/2, cy = f[1] + 45*FB.PX;
          FB.ensureBrushLayer(false);
          const c = document.createElement('canvas'); c.width = c.height = 400; const g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0,0,400,400); g.fillStyle = '#d01818'; g.beginPath(); g.arc(200,200,120,0,7); g.fill();
          const img = new Image(); img.src = c.toDataURL(); await img.decode();
          const L = FB.addImage(img, 'photo', cx, cy, 20); FB.select(L.id); FB.composeSheet(); FB.renderLayers(); FB.commit();
          return { id: L.id, cx, cy, layers: FB.getLayers().length }; }''')

        # paint a green stroke across the photo in the 2D pattern
        page.click('#brushTool')
        page.evaluate("() => { window.__FB.BRUSH.color = '#00ff00'; window.__FB.BRUSH.sizeCm = 3; window.__FB.BRUSH.opacity = 1; window.__FB.BRUSH.hardness = 0.95; }")
        pt = page.evaluate('''({cx, cy}) => { const FB = window.__FB, p = FB.pieceById.front, r = document.getElementById('patternCanvas').getBoundingClientRect();
          const [vx, vy] = FB.toView(cx + p.dx, cy + p.dy); return { x: r.left + vx, y: r.top + vy, k: FB.PV.k }; }''', info)
        page.mouse.move(pt['x'] - 20, pt['y']); page.mouse.down(); page.mouse.move(pt['x'], pt['y'], steps=6); page.mouse.move(pt['x'] + 20, pt['y'], steps=6); page.mouse.up()
        page.wait_for_timeout(600)
        res = page.evaluate('''({cx, cy}) => { const FB = window.__FB; FB.composeSheet(); const d = FB.sheetCanvas().getContext('2d').getImageData(cx|0, cy|0, 1, 1).data;
          const Ls = FB.getLayers(); return { px: [...d], kinds: Ls.map(l => l.kind), top: Ls.at(-1).kind }; }''', info)
        assert_(res['px'][1] > 200 and res['px'][0] < 80, f"paint should be visible on top of the photo, sheet pixel is {res['px']} (layers {res['kinds']})")
        assert_(res['top'] == 'brush', f"paint layer should sit above the photo: {res['kinds']}")
        page.click('#brushTool')

        # remove the photo's background
        page.evaluate('(id) => window.__FB.select(id)', info['id'])
        page.click('#bgRemove'); page.wait_for_timeout(400)
        bg = page.evaluate('''(id) => { const L = window.__FB.getLayers().find(l => l.id === id), c = L.src, g = c.getContext('2d');
          const a = (x, y) => g.getImageData(x, y, 1, 1).data[3]; return { corner: a(3, 3), edge: a(c.width - 4, c.height >> 1), centre: a(c.width >> 1, c.height >> 1), hasOrig: !!L.orig }; }''', info['id'])
        assert_(bg['corner'] == 0 and bg['edge'] == 0, f'background should be transparent: {bg}')
        assert_(bg['centre'] == 255 and bg['hasOrig'], f'subject should stay opaque: {bg}')
        assert_(page.locator('#bgRestore').is_visible(), 'Restore should be offered after removal')
        page.click('#undo'); page.wait_for_timeout(300)
        undone = page.evaluate('(id) => { const L = window.__FB.getLayers().find(l => l.id === id); return !(L.src instanceof HTMLCanvasElement); }', info['id'])
        assert_(undone, 'undo should bring the original image back')
        page.click('#redo'); page.wait_for_timeout(300)
        page.evaluate('(id) => window.__FB.select(id)', info['id'])
        page.click('#bgRestore'); page.wait_for_timeout(300)
        restored = page.evaluate('(id) => { const L = window.__FB.getLayers().find(l => l.id === id); return !(L.src instanceof HTMLCanvasElement) && !L.orig; }', info['id'])
        assert_(restored, 'Restore should bring the original image back')

        fatal = [e for e in errors if 'ResizeObserver' not in e]
        assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        print('OK', json.dumps({'paintPixel': res['px'], 'layers': res['kinds'], 'bg': bg}))
        browser.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
