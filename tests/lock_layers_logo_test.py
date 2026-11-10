#!/usr/bin/env python3
"""Lock keeps a layer fixed in 2D and 3D, the Layers popover lists layers, and the logo is in the header.
Run a local server first: python3 -m http.server 8765"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = os.environ.get('FB_SHOTS', '')


def assert_(c, m):
    if not c:
        raise AssertionError(m)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_context(viewport={'width': 1100, 'height': 700}).new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#landing', state='hidden', timeout=10000)

        print('booted', flush=True)
        # logo
        logo = page.evaluate("() => { const i = document.querySelector('header .logo'); return i && { ok: i.complete && i.naturalWidth > 100, h: i.getBoundingClientRect().height }; }")
        assert_(logo and logo['ok'] and 20 < logo['h'] < 60, f'header logo missing or broken: {logo}')

        info = page.evaluate('''async () => { const FB = window.__FB, f = FB.pieceById.front.box, cx = (f[0]+f[2])/2, cy = f[1] + 45*FB.PX;
          FB.getLayers().length = 0; const c = document.createElement('canvas'); c.width = c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#d01818'; g.fillRect(0,0,300,300);
          const img = new Image(); img.src = c.toDataURL(); await img.decode();
          const L = FB.addImage(img, 'photo', cx, cy, 20); FB.select(L.id); FB.composeSheet(); FB.renderLayers(); FB.commit(); return { id: L.id, cx, cy }; }''')
        pos = lambda: page.evaluate('(id) => { const L = window.__FB.getLayers().find(l => l.id === id); return [L.x, L.y, L.locked]; }', info['id'])
        pt = page.evaluate('''({cx, cy}) => { const FB = window.__FB, p = FB.pieceById.front, r = document.getElementById('patternCanvas').getBoundingClientRect();
          const [vx, vy] = FB.toView(cx + p.dx, cy + p.dy); return { x: r.left + vx, y: r.top + vy }; }''', info)

        def drag2d(dx):
            page.mouse.move(pt['x'], pt['y']); page.mouse.down(); page.mouse.move(pt['x'] + dx / 2, pt['y'], steps=4); page.mouse.move(pt['x'] + dx, pt['y'], steps=4); page.mouse.up(); page.wait_for_timeout(200)

        # unlocked: it moves in 2D
        before = pos(); drag2d(40); moved = pos()
        assert_(abs(moved[0] - before[0]) > 5, f'unlocked layer should move in 2D: {before} -> {moved}')
        print('2d move ok', flush=True)
        # lock from the rail: it must stay put in 2D
        page.click('#railLock'); assert_(pos()[2] is True, 'rail lock button should lock the layer')
        assert_(page.get_attribute('#railLock', 'aria-pressed') == 'true', 'rail lock should show pressed')
        assert_(page.inner_text('#lock3dT') == 'Unlock', '3D lock button should offer Unlock')
        pt = page.evaluate('''({cx, cy}) => { const L = window.__FB.getLayers().at(-1); return null; }''', info) or pt
        pt = page.evaluate('''(id) => { const FB = window.__FB, L = FB.getLayers().find(l => l.id === id), p = FB.pieceAt(L.x, L.y), r = document.getElementById('patternCanvas').getBoundingClientRect();
          const [vx, vy] = FB.toView(L.x + p.dx, L.y + p.dy); return { x: r.left + vx, y: r.top + vy }; }''', info['id'])
        before = pos(); drag2d(60); after = pos()
        assert_(before[:2] == after[:2], f'locked layer moved in 2D: {before} -> {after}')
        page.keyboard.press('ArrowRight'); assert_(pos()[:2] == before[:2], 'arrow keys must not nudge a locked layer')

        print('2d lock ok', flush=True)
        # 3D: find the layer on the garment by sweeping the canvas, then drag it
        r = page.evaluate("() => { const b = document.getElementById('gl').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }")
        page.evaluate('({id, cx, cy}) => { const FB = window.__FB, L = FB.getLayers().find(l => l.id === id); L.x = cx; L.y = cy; FB.composeSheet(); FB.select(id); }', info)
        page.wait_for_timeout(800)
        def find_hit():
            for fy in (.45, .5, .55, .6, .65, .4, .7, .35):
                for fx in (.5, .45, .55, .4, .6):
                    x, y = r[0] + r[2] * fx, r[1] + r[3] * fy
                    page.mouse.move(x, y); page.wait_for_timeout(60); page.mouse.move(x + 1, y); page.wait_for_timeout(60)
                    c = page.evaluate("() => document.getElementById('gl').style.cursor")
                    if c in ('move', 'not-allowed'): return x, y, c
            return None
        def drag3d(x, y):
            b = pos(); page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 40, y, steps=2); page.mouse.up(); page.wait_for_timeout(150)
            return pos()[:2] != b[:2]
        hit = find_hit()
        if not hit and OUT: page.screenshot(path=os.path.join(OUT, 'lock_fail.png'))
        assert_(hit, f'could not find the layer on the 3D garment (layer at {pos()})')
        assert_(hit[2] == 'not-allowed', f'locked layer should show a not-allowed cursor in 3D, got {hit[2]}')
        assert_(not drag3d(hit[0], hit[1]), 'locked layer moved in 3D')
        page.evaluate('(id) => window.__FB.select(id)', info['id'])
        page.click('#lock3d'); assert_(pos()[2] is False, '3D lock button should unlock')
        hit = find_hit(); assert_(hit and hit[2] == 'move', f'unlocked layer should show a move cursor in 3D: {hit}')
        assert_(drag3d(hit[0], hit[1]), 'unlocked layer should be draggable in 3D')
        page.evaluate('(id) => window.__FB.select(id)', info['id'])
        page.click('#lock3d'); assert_(pos()[2] is True, '3D lock button should lock again')

        # layers popover
        page.click('#railLayers'); assert_(page.is_visible('#layersPop'), 'layers popover should open')
        assert_(page.locator('#layersPopList .layer').count() == 1, 'popover should list the layer')
        page.locator('#layersPopList .layer button[aria-label^="Unlock"]').click(); assert_(pos()[2] is False, 'row lock icon should toggle')
        page.locator('#layersPopList .layer button[aria-label^="Lock"]').click(); assert_(pos()[2] is True, 'row lock icon should lock')
        if OUT: page.screenshot(path=os.path.join(OUT, 'lock_layers.png'))
        page.click('#layersPopClose'); assert_(not page.is_visible('#layersPop'), 'popover should close')
        fatal = [e for e in errors if 'ResizeObserver' not in e]
        assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        browser.close()
    print('OK lock/layers/logo')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
