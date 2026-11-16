"""Shared check for the CLO 3D jerseys (?g=raglanjersey, ?g=womenjersey): the garment loads with all its pattern pieces on the table,
the mesh is plain white (no original prints/stripes/logos), a red print on the front piece shows on the 3D front only, a blue print on
the back piece shows on the 3D back only, every piece takes paint, the pattern sheet exports, and the size chart defaults to the
garment's standard chart. Screenshots go to FB_SHOTS when set. Run a local server first: python3 -m http.server 8765"""
import io, json, os
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = os.environ.get('FB_SHOTS', '')


def assert_(c, m):
    if not c: raise AssertionError(m)


def share(png, test):
    im = Image.open(io.BytesIO(png)).convert('RGB'); w, h = im.size; n = r = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            p = im.getpixel((x, y)); n += 1; r += test(p)
    return r / n


RED = lambda p: p[0] > 150 and p[0] > 1.7*p[1] and p[0] > 1.7*p[2]
BLUE = lambda p: p[2] > 120 and p[2] > 1.7*p[0] and p[2] > 1.4*p[1]
COLOURED = lambda p: max(p) - min(p) > 60  # saturated print colour (the studio backdrop is a pale tint)


def run(gid, ids, name, chart, A, C):
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/?g=' + gid, wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#loading', state='hidden', timeout=90000); page.wait_for_timeout(1500)
        info = page.evaluate('''() => { const FB = window.__FB; const ms = window.__dbg.shirtMeshes; return { gid: FB.GID, ids: FB.pieces().map(p => p.id), shown: FB.SHOWN().length,
          cover: FB.COVER.done, tris: ms.reduce((a, m) => a + m.geometry.index.count / 3, 0), inside: ms.every(m => !!m.geometry.attributes.aInside),
          name: document.getElementById('gName').textContent }; }''')
        assert_(info['gid'] == gid and info['name'] == name, f'garment not loaded: {info}')
        assert_(sorted(info['ids']) == sorted(ids) and info['shown'] == len(ids), f'pieces: {info}')
        assert_(info['cover'] and info['tris'] > 60000 and info['inside'], f'mesh / coverage / _INSIDE problem: {info}')
        # 1. blank garment: plain white, no leftover prints, stripes or logos from the CLO file
        page.evaluate('() => { const FB = window.__FB, S = FB.getS(); S.fabric = S.rib = "#ffffff"; FB.getLayers().length = 0; FB.composeSheet(); FB.renderLayers(); FB.commit(); }')
        page.click('#vPattern'); page.wait_for_timeout(700); page.click('#v3d'); page.wait_for_timeout(800); gl = page.locator('#gl')
        glshot = lambda **k: page.screenshot(clip=gl.bounding_box(), timeout=90000, **k)  # clip shot: no element-stability wait on slow software GL
        for cam in ('front', 'back'):
            page.click(f'[data-cam="{cam}"]'); page.wait_for_timeout(1500); png = glshot()
            if OUT: open(os.path.join(OUT, f'clo_{gid}_blank_{cam}.png'), 'wb').write(png)
            col = share(png, COLOURED); assert_(col < 0.01, f'blank {cam} is not plain ({col:.4f} coloured)')
        # 2. red square on the front, blue on the back, yellow/orange on every other piece
        page.evaluate('''async (ids) => { const FB = window.__FB; FB.getLayers().length = 0;
          const sq = async col => { const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 200, 200);
            const img = new Image(); img.src = c.toDataURL(); await img.decode(); return img; };
          const put = async (id, col, cm, fy=0.42) => { const b = FB.pieceById[id].box; FB.addImage(await sq(col), id, (b[0]+b[2])/2, b[1] + (b[3]-b[1])*fy, cm); };
          await put('front', '#e01010', 22); await put('back', '#1030e0', 22);
          for (const id of ids) if (id !== 'front' && id !== 'back') await put(id, id.endsWith('L') || id.startsWith('uaL') ? '#f0b000' : '#f0e000', 70, 0.5);
          FB.composeSheet(); FB.renderLayers(); FB.commit(); }''', ids)
        page.click('#vPattern'); page.wait_for_timeout(700)
        menu = page.evaluate("() => [...document.querySelectorAll('#garmentMenu [role=menuitemradio]')].map(b => b.textContent)")
        assert_(any(name in t for t in menu), f'{name} missing from the garment picker: {menu}')
        page.evaluate('() => { window.__wmOrig = AuthService.needsWatermark; AuthService.needsWatermark = () => true; }')
        page.click('#exportBtn'); page.click('[data-exp="patternPng"]'); page.wait_for_selector('#modal:not([hidden])', timeout=60000)
        sheet = bytes(page.evaluate('async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer()))', page.locator('#modalImg').get_attribute('src')))
        page.click('#modalClose'); page.evaluate('() => { AuthService.needsWatermark = window.__wmOrig; }')
        if OUT: open(os.path.join(OUT, f'clo_{gid}_sheet.png'), 'wb').write(sheet)
        sw, sh = Image.open(io.BytesIO(sheet)).size; assert_(sw > 1500 and sh > 1000, f'pattern sheet export size {sw}x{sh}')
        if OUT: page.screenshot(path=os.path.join(OUT, f'clo_{gid}_2d.png'))
        page.click('#v3d'); page.wait_for_timeout(500); page.click('[data-cam="front"]'); page.wait_for_timeout(1800)
        front = glshot()
        if OUT: open(os.path.join(OUT, f'clo_{gid}_front.png'), 'wb').write(front)
        rf = share(front, RED); assert_(rf > 0.01, f'red print on the front piece is not visible on the 3D front ({rf:.4f})')
        page.click('[data-cam="back"]'); page.wait_for_timeout(1800); back = glshot()
        if OUT: open(os.path.join(OUT, f'clo_{gid}_back.png'), 'wb').write(back)
        rb = share(back, RED); assert_(rb < rf / 4, f'front print shows through on the back ({rb:.4f} vs {rf:.4f})')
        bb, bf = share(back, BLUE), share(front, BLUE)
        assert_(bb > 0.01 and bf < bb / 4, f'back print: blue on back {bb:.4f}, on front {bf:.4f}')
        page.click('[data-cam="side"]'); page.wait_for_timeout(1500)
        if OUT: glshot(path=os.path.join(OUT, f'clo_{gid}_side.png'))
        page.click('#sizeChartBtn'); page.wait_for_selector('#sizeModal:not([hidden])', timeout=10000); page.wait_for_timeout(400)
        if OUT: page.screenshot(path=os.path.join(OUT, f'clo_{gid}_sizechart.png'))
        sc = page.evaluate('() => { const S = window.__FB.sizeChart(); return {src: S.source, A: S.rows[0].v, C: S.rows[2].v, D: S.rows[3].v, E: S.rows[4].v}; }')
        assert_(sc and sc['src'] == chart, f'size chart should default to the {chart} preset: {sc}')
        assert_(sc['A'] == A and sc['C'] == C and sc['E'][2] > 12 and sc['D'][2] > 50, f'chart values: {sc}')
        fatal = [e for e in errors if 'ResizeObserver' not in e]; assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        b.close()
    print('OK', gid, json.dumps({'pieces': len(info['ids']), 'tris': info['tris'], 'redFront': round(rf, 4), 'redBack': round(rb, 4), 'blueBack': round(bb, 4), 'blueFront': round(bf, 4), 'chart': sc}))
