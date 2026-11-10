#!/usr/bin/env python3
"""Hoodie garment (?g=hoodie): loads, every piece is on the table, a print placed on the front piece in 2D shows up on the
front of the 3D hoodie, the back camera works, and the size chart uses the Gildan 18500 hoodie preset.
Screenshots go to FB_SHOTS when set. Run a local server first: python3 -m http.server 8765"""
import io, json, os, sys
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = os.environ.get('FB_SHOTS', '')


def assert_(c, m):
    if not c: raise AssertionError(m)


def red_share(png):
    im = Image.open(io.BytesIO(png)).convert('RGB'); w, h = im.size; n = r = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            p = im.getpixel((x, y)); n += 1; r += p[0] > 150 and p[0] > 1.7*p[1] and p[0] > 1.7*p[2]
    return r / n


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/?g=hoodie', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#loading', state='hidden', timeout=60000); page.wait_for_timeout(1500)
        info = page.evaluate('''() => { const FB = window.__FB; return { gid: FB.GID, ids: FB.pieces().map(p => p.id), shown: FB.SHOWN().length,
          cover: FB.COVER.done, tris: window.__dbg.shirtMeshes.reduce((a, m) => a + m.geometry.index.count / 3, 0), name: document.getElementById('gName').textContent }; }''')
        assert_(info['gid'] == 'hoodie', f'garment not loaded: {info}')
        for k in ['front', 'back', 'sleeveR', 'sleeveL', 'hoodR', 'hoodL', 'cuffR', 'cuffL', 'hemF', 'hemB', 'cordR', 'cordL']:
            assert_(k in info['ids'], f'missing piece {k}')
        assert_(info['cover'] and info['tris'] > 30000, f'mesh / coverage problem: {info}')
        # clear the starter design, then put a big red square in the middle of the front piece
        page.evaluate('''async () => { const FB = window.__FB, f = FB.pieceById.front.box; FB.getLayers().length = 0;
          const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#e01010'; g.fillRect(0, 0, 200, 200);
          const img = new Image(); img.src = c.toDataURL(); await img.decode();
          const L = FB.addImage(img, 'red', (f[0]+f[2])/2, f[1] + (f[3]-f[1])*0.42, 24); FB.composeSheet(); FB.renderLayers(); FB.commit(); }''')
        page.click('#vPattern'); page.wait_for_timeout(700)
        if OUT: page.screenshot(path=os.path.join(OUT, 'hoodie_2d.png'))
        page.click('#v3d'); page.wait_for_timeout(500); page.click('[data-cam="front"]'); page.wait_for_timeout(1800)
        gl = page.locator('#gl'); front = gl.screenshot()
        if OUT: open(os.path.join(OUT, 'hoodie_3d_front.png'), 'wb').write(front)
        rf = red_share(front); assert_(rf > 0.01, f'red print on the front piece is not visible on the 3D front ({rf:.4f})')
        page.click('[data-cam="back"]'); page.wait_for_timeout(1800); back = gl.screenshot()
        if OUT: open(os.path.join(OUT, 'hoodie_3d_back.png'), 'wb').write(back)
        rb = red_share(back); assert_(rb < rf / 4, f'front print shows through on the back ({rb:.4f} vs {rf:.4f})')
        page.click('[data-cam="side"]'); page.wait_for_timeout(1500)
        if OUT: gl.screenshot(path=os.path.join(OUT, 'hoodie_3d_side.png'))
        page.click('#sizeChartBtn'); page.wait_for_selector('#sizeModal:not([hidden])', timeout=10000); page.wait_for_timeout(400)
        if OUT: page.screenshot(path=os.path.join(OUT, 'hoodie_sizechart.png'))
        sc = page.evaluate('() => { const S = window.__FB.sizeChart(); return {src: S.source, A: S.rows[0].v, C: S.rows[2].v, E: S.rows[4].v}; }')
        assert_(sc and sc['src'] == 'gildan18500', f'size chart should default to the hoodie preset: {sc}')
        assert_(sc['A'][2] == 55.9 and sc['C'][2] == 71.1 and sc['E'][2] == 86.4 and sc['E'][0] == 82.6 and sc['A'] == [45.7, 50.8, 55.9, 61.0, 66.0, 71.1, 76.2] and sc['C'][6] == 81.3, f'hoodie chart values: {sc}')
        fatal = [e for e in errors if 'ResizeObserver' not in e]; assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        b.close()
    print('OK hoodie', json.dumps({'pieces': len(info['ids']), 'shown': info['shown'], 'tris': info['tris'], 'redFront': round(rf, 4), 'redBack': round(rb, 4), 'chart': sc}))


if __name__ == '__main__':
    try: main()
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
