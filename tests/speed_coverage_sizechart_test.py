#!/usr/bin/env python3
"""Speed, dead zones and size chart.

Checks that the page needs no CDN to boot, that the 3D view stops rendering when nothing changes,
that every mesh UV is paintable (no black seam tapes), and that the size chart measures the pattern,
grades, edits and exports. Run a local server first: python3 -m http.server 8765
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')


def assert_(cond, msg):
    if not cond:
        raise AssertionError(msg)


def boot(context, query=''):
    page = context.new_page()
    errors, hosts = [], set()
    page.on('pageerror', lambda e: errors.append(str(e)))
    # Fonts are the only thing allowed to come from another origin; block them so the test proves the app boots without them.
    page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
    page.on('request', lambda r: hosts.add(r.url.split('/')[2]) if r.url.startswith('http') else None)
    page.goto(BASE + '/' + query, wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('() => window.__FB && window.__dbg && window.__FB.COVER.done', timeout=180000)
    page.evaluate('() => window.__FB.grantLocalTestAccess()')
    page.wait_for_selector('#landing', state='hidden', timeout=10000)
    return page, errors, hosts


def main():
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        page, errors, hosts = boot(context)

        # --- speed: self-hosted runtime, no blocking third-party scripts
        scripts = page.evaluate('() => [...document.scripts].map(s => s.src).filter(Boolean)')
        assert_(not scripts, f'no external <script src> expected at boot, got {scripts}')
        other = {h for h in hosts if '127.0.0.1' not in h and 'localhost' not in h and 'fonts.g' not in h and 'supabase' not in h}
        assert_(not other, f'unexpected third-party hosts at boot: {other}')
        marks = page.evaluate("() => Object.fromEntries(performance.getEntriesByType('mark').map(m => [m.name, Math.round(m.startTime)]))")
        assert_('fb:boot' in marks and 'fb:garment' in marks, f'missing perf marks: {marks}')
        out['marks'] = marks

        # --- speed: nothing is rendered while the scene is still
        page.wait_for_timeout(2500)
        idle = page.evaluate('''async () => { const r = window.__dbg.renderer, a = r.info.render.frame;
          await new Promise(z => setTimeout(z, 1500)); return r.info.render.frame - a; }''')
        assert_(idle == 0, f'3D view should be idle when nothing changes, rendered {idle} passes')
        out['idleRenders'] = idle

        # --- speed: an unchanged sheet is not recomposed; moving an outside layer leaves the inside sheet alone
        compose = page.evaluate('''() => { const FB = window.__FB, L = FB.getLayers()[0];
          const t0 = performance.now(); for (let i = 0; i < 10; i++) FB.composeSheet(); const noop = (performance.now() - t0) / 10;
          const t1 = performance.now(); for (let i = 0; i < 10; i++) { L.x += 1; FB.composeSheet(); } const move = (performance.now() - t1) / 10;
          L.x -= 10; FB.composeSheet(); return { noop, move }; }''')
        out['composeMs'] = {k: round(v, 2) for k, v in compose.items()}

        # --- dead zones: every mesh triangle is paintable and the sheet has no hole under the mesh
        cover = page.evaluate('() => ({ tris: window.__FB.COVER.tris, cm2: window.__FB.COVER.cm2 })')
        holes = page.evaluate('''() => { const FB = window.__FB, c = FB.sheetCanvas(), g = c.getContext('2d'); let bad = 0, n = 0;
          for (const m of window.__dbg.shirtMeshes) { const uv = m.geometry.attributes.uv; const step = Math.max(1, Math.floor(uv.count / 4000));
            for (let i = 0; i < uv.count; i += step) { const d = g.getImageData(Math.min(c.width - 1, uv.getX(i) * FB.TEX | 0), Math.min(c.height - 1, uv.getY(i) * FB.TEX | 0), 1, 1).data; n++; if (d[3] < 250) bad++; } }
          return { bad, n }; }''')
        assert_(holes['bad'] == 0, f"{holes['bad']} of {holes['n']} sampled mesh UVs land on an unpainted part of the print sheet")
        out['coverage'] = {'repairedTris': cover['tris'], 'repairedCm2': round(cover['cm2'], 1), 'sampled': holes['n']}

        # --- dead zones: trims become reachable in the 2D drawing
        n0 = page.evaluate('() => window.__FB.SHOWN().length')
        page.click('#trimsT'); page.wait_for_timeout(300)
        n1 = page.evaluate('() => window.__FB.SHOWN().length')
        total = page.evaluate('() => window.__FB.pieces().length')
        assert_(n1 == total and n1 >= n0, f'trims should show every piece: {n0} -> {n1} of {total}')
        page.click('#trimsT'); page.wait_for_timeout(300)
        out['pieces'] = {'core': n0, 'withTrims': n1}

        # --- size chart: measured from the pattern, graded, editable, exportable
        page.click('#sizeChartBtn')
        page.wait_for_selector('#sizeModal:not([hidden])', timeout=5000)
        sc = page.evaluate('() => { const s = window.__FB.sizeChart(); return { base: s.baseSize, rows: s.rows, auto: Object.keys(s.auto) }; }')
        m = page.evaluate('() => window.__FB.measurePattern()')
        assert_(len(sc['rows']) == 13, f"expected 13 points of measure, got {len(sc['rows'])}")
        sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
        bi = sizes.index(sc['base'])
        chest = sc['rows'][0]
        assert_(abs(chest['v'][bi] - m['A']) < 0.06, f"base chest {chest['v'][bi]} should equal the measured pattern chest {m['A']}")
        assert_(all(abs((chest['v'][i + 1] - chest['v'][i]) - chest['grade']) < 0.11 for i in range(6)), f"chest is not graded evenly: {chest['v']}")
        assert_(30 < m['A'] < 90 and 50 < m['D'] < 100, f'implausible pattern measurements: {m}')
        # edit the base chest: the whole row shifts by the same amount
        cell = page.locator('#scTable tbody tr').nth(0).locator('td.base input')
        before = chest['v']
        cell.fill(str(round(before[bi] + 2, 1))); cell.press('Tab'); page.wait_for_timeout(200)
        after = page.evaluate('() => window.__FB.sizeChart().rows[0].v')
        assert_(all(abs((a - b) - 2) < 0.11 for a, b in zip(after, before)), f'editing the base size should shift the row: {before} -> {after}')
        with page.expect_download(timeout=10000) as di:
            page.click('#scCsv')
        csv = open(di.value.path(), encoding='utf-8-sig').read()
        assert_('Chest width' in csv and 'רוחב חזה' in csv and 'Tolerance' in csv, 'size chart CSV is missing columns')
        assert_(csv.count('\n') >= 18, 'size chart CSV is too short')
        page.click('#scIn'); page.wait_for_timeout(150)
        assert_(page.locator('#scTable tbody input').count() == 0, 'inch view should be read-only')
        page.click('#scReset'); page.wait_for_timeout(150)
        reset = page.evaluate('() => window.__FB.sizeChart().rows[0].v')
        assert_(abs(reset[bi] - m['A']) < 0.06, 'reset should return to the pattern measurements')
        page.click('#scClose')
        out['sizeChart'] = {'base': sc['base'], 'chest': before, 'measured': sorted(sc['auto'])}

        # --- units
        page.click('[data-unit="in"]'); page.wait_for_timeout(100)
        assert_(' in' in page.locator('#lwo').inner_text(), 'layer width should follow the unit switch')
        page.click('[data-unit="cm"]')

        fatal = [e for e in errors if 'ResizeObserver' not in e]
        assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        page.close()

        # --- second garment loads through the registry
        page2, errors2, _ = boot(context, '?g=oversized')
        g2 = page2.evaluate('() => ({ id: window.__FB.GID, shown: window.__FB.SHOWN().length, chest: window.__FB.measurePattern().A, name: document.getElementById("gName").textContent })')
        assert_(g2['id'] == 'oversized' and g2['shown'] >= 5 and g2['chest'] > 30, f'second garment did not load: {g2}')
        assert_(not [e for e in errors2 if 'ResizeObserver' not in e], 'page errors on second garment: ' + ' | '.join(errors2))
        out['garment2'] = g2
        browser.close()
    print('OK', json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
