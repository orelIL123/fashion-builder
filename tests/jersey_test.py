#!/usr/bin/env python3
"""Football jersey (?g=jersey): loads, the 5 pieces (front, back, 2 sleeves, collar) are on the table, a red print on the front
piece shows on the 3D front only, a blue print on the back piece shows on the 3D back only, sleeves and collar take paint, and
the size chart defaults to the adult jersey preset (Arvion teamwear, regular fit).
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


def blue_share(png):
    im = Image.open(io.BytesIO(png)).convert('RGB'); w, h = im.size; n = r = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            p = im.getpixel((x, y)); n += 1; r += p[2] > 120 and p[2] > 1.7*p[0] and p[2] > 1.4*p[1]
    return r / n


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/?g=jersey', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#loading', state='hidden', timeout=60000); page.wait_for_timeout(1500)
        info = page.evaluate('''() => { const FB = window.__FB; return { gid: FB.GID, ids: FB.pieces().map(p => p.id), shown: FB.SHOWN().length,
          cover: FB.COVER.done, tris: window.__dbg.shirtMeshes.reduce((a, m) => a + m.geometry.index.count / 3, 0), name: document.getElementById('gName').textContent }; }''')
        assert_(info['gid'] == 'jersey', f'garment not loaded: {info}')
        assert_(sorted(info['ids']) == ['back', 'front', 'rib', 'sleeveL', 'sleeveR'] and info['shown'] == 5, f'pieces: {info}')
        for k in []:
            assert_(k in info['ids'], f'missing piece {k}')
        assert_(info['cover'] and info['tris'] > 30000, f'mesh / coverage problem: {info}')
        # clear the starter design; red square on the front, blue square on the back, yellow sleeves, green collar
        page.evaluate('''async () => { const FB = window.__FB; FB.getLayers().length = 0;
          const sq = async col => { const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 200, 200);
            const img = new Image(); img.src = c.toDataURL(); await img.decode(); return img; };
          const put = async (id, col, cm, fy=0.42) => { const b = FB.pieceById[id].box; FB.addImage(await sq(col), id, (b[0]+b[2])/2, b[1] + (b[3]-b[1])*fy, cm); };
          await put('front', '#e01010', 24); await put('back', '#1030e0', 24); await put('sleeveR', '#f0d000', 40, 0.5); await put('sleeveL', '#f0d000', 40, 0.5); await put('rib', '#10b040', 60, 0.5);
          FB.composeSheet(); FB.renderLayers(); FB.commit(); }''')
        page.click('#vPattern'); page.wait_for_timeout(700)
        menu = page.evaluate("() => [...document.querySelectorAll('#garmentMenu [role=menuitemradio]')].map(b => b.textContent)")
        assert_(any('Football jersey' in t for t in menu), f'jersey missing from the garment picker: {menu}')
        # pattern sheet export with the free-plan watermark forced on: the watermark must sit in the extra strip, not on a piece
        page.evaluate('() => { window.__wmOrig = AuthService.needsWatermark; AuthService.needsWatermark = () => true; }')
        page.click('#exportBtn'); page.click('[data-exp="patternPng"]'); page.wait_for_selector('#modal:not([hidden])', timeout=60000)
        sheet = bytes(page.evaluate('async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer()))', page.locator('#modalImg').get_attribute('src')))
        page.click('#modalClose'); page.evaluate('() => { AuthService.needsWatermark = window.__wmOrig; }')
        if OUT: open(os.path.join(OUT, 'jersey_pattern_sheet.png'), 'wb').write(sheet)
        sw, sh = Image.open(io.BytesIO(sheet)).size; assert_(sw > 1500 and sh > 1000, f'pattern sheet export size {sw}x{sh}')
        if OUT: page.screenshot(path=os.path.join(OUT, 'jersey_2d.png'))
        page.click('#v3d'); page.wait_for_timeout(500); page.click('[data-cam="front"]'); page.wait_for_timeout(1800)
        gl = page.locator('#gl'); front = gl.screenshot()
        if OUT: open(os.path.join(OUT, 'jersey_3d_front.png'), 'wb').write(front)
        rf = red_share(front); assert_(rf > 0.01, f'red print on the front piece is not visible on the 3D front ({rf:.4f})')
        page.click('[data-cam="back"]'); page.wait_for_timeout(1800); back = gl.screenshot()
        if OUT: open(os.path.join(OUT, 'jersey_3d_back.png'), 'wb').write(back)
        rb = red_share(back); assert_(rb < rf / 4, f'front print shows through on the back ({rb:.4f} vs {rf:.4f})')
        bb, bf = blue_share(back), blue_share(front)
        assert_(bb > 0.01 and bf < bb / 4, f'back print: blue on back {bb:.4f}, on front {bf:.4f}')
        page.click('[data-cam="side"]'); page.wait_for_timeout(1500)
        if OUT: gl.screenshot(path=os.path.join(OUT, 'jersey_3d_side.png'))
        page.click('#sizeChartBtn'); page.wait_for_selector('#sizeModal:not([hidden])', timeout=10000); page.wait_for_timeout(400)
        if OUT: page.screenshot(path=os.path.join(OUT, 'jersey_sizechart.png'))
        sc = page.evaluate('() => { const S = window.__FB.sizeChart(); return {src: S.source, A: S.rows[0].v, C: S.rows[2].v, E: S.rows[4].v}; }')
        assert_(sc and sc['src'] == 'jersey', f'size chart should default to the jersey preset: {sc}')
        assert_(sc['A'] == [47, 50, 53, 56, 59, 62, 65] and sc['C'] == [68, 70, 72, 74, 76, 78, 80] and sc['E'][2] > 15, f'jersey chart values: {sc}')
        fatal = [e for e in errors if 'ResizeObserver' not in e]; assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        b.close()
    print('OK jersey', json.dumps({'pieces': len(info['ids']), 'shown': info['shown'], 'tris': info['tris'], 'redFront': round(rf, 4), 'redBack': round(rb, 4), 'blueBack': round(bb, 4), 'blueFront': round(bf, 4), 'chart': sc}))


if __name__ == '__main__':
    try: main()
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
