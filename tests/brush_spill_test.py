#!/usr/bin/env python3
"""Paint near the edge of a pattern piece must stay on that piece.
Pieces sit a few pixels apart on the print sheet, so an unclipped brush stamp used to land on unrelated parts of the
garment. Run a local server first: python3 -m http.server 8765"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess && window.__FB.grantLocalTestAccess()')
        page.wait_for_timeout(800)
        page.click('#vPattern'); page.wait_for_timeout(600)
        page.click('#brushTool')
        page.evaluate("() => { const B = window.__FB.BRUSH; B.color = '#ff00ff'; B.sizeCm = 8; B.opacity = 1; B.hardness = 0.9; B.eraser = false; }")
        out = {}
        for pid in ['front', 'back', 'sleeveR']:
            pts = page.evaluate('''(pid) => { const FB = window.__FB, p = FB.pieceById[pid], r = document.getElementById('patternCanvas').getBoundingClientRect();
              const cx = (p.box[0]+p.box[2])/2, cy = (p.box[1]+p.box[3])/2, res = [], step = Math.max(1, p.pts.length/40|0);
              for (let i = 0; i < p.pts.length; i += step) { const [x, y] = p.pts[i], ix = x+(cx-x)*0.03, iy = y+(cy-y)*0.03; if (FB.pieceAt(ix, iy) !== p) continue;
                const [vx, vy] = FB.toView(ix + p.dx, iy + p.dy); res.push([r.left + vx, r.top + vy]); }
              return res; }''', pid)
            assert len(pts) > 10, f'not enough edge points on {pid}'
            for x, y in pts:
                page.mouse.move(x, y); page.mouse.down(); page.mouse.up()
            page.wait_for_timeout(300)
            res = page.evaluate('''(pid) => { const FB = window.__FB, p = FB.pieceById[pid], L = FB.getLayers().filter(l => l.kind === 'brush').at(-1);
              const count = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; };
              const t = document.createElement('canvas'); t.width = L.src.width; t.height = L.src.height; const g = t.getContext('2d', { willReadFrequently: true });
              g.drawImage(L.src, 0, 0); const all = count(t);
              g.globalCompositeOperation = 'destination-out'; g.fill(p.path); g.lineWidth = 2; g.stroke(p.path); const outside = count(t);
              FB.brushClear && FB.brushClear(); L.src.getContext('2d').clearRect(0, 0, t.width, t.height); return { painted: all, outside }; }''', pid)
            out[pid] = res
            assert res['painted'] > 5000, f'{pid}: brush did not paint ({res})'
            assert res['outside'] == 0, f"{pid}: {res['outside']} painted pixels landed outside the piece"
        assert not [e for e in errors if 'ResizeObserver' not in e], 'page errors: ' + ' | '.join(errors)
        print('OK', json.dumps(out))
        browser.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
