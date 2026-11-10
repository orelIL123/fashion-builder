#!/usr/bin/env python3
"""FB-OPEN-V1: gate is off. App loads directly with full features, even with stale invite localStorage."""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = Path(os.environ.get('FB_OUT', '/tmp/fb-open'))
OUT.mkdir(parents=True, exist_ok=True)

STALE = {
    'fb-invite-session-v1': json.dumps({
        'email': 'orel895@gmail.com',
        'name': 'orel',
        'status': 'pending',
    }),
}

def assert_(c, m):
    if not c:
        raise AssertionError(m)

def run_scenario(browser, name, storage=None):
    errors, logs = [], []
    context = browser.new_context(accept_downloads=True, viewport={'width': 1400, 'height': 900})
    if storage:
        context.add_init_script(
            '''const data = %s;
               for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);'''
            % json.dumps(storage)
        )
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: logs.append(m.text) if m.type == 'error' else None)
    page.goto(BASE + '/?t=' + str(int(time.time() * 1000)), wait_until='domcontentloaded', timeout=120000)

    html = page.content()
    assert_('FB-OPEN-V1' in html, f'{name}: missing FB-OPEN-V1 marker')
    assert_('FB-INVITE-V1' not in html, f'{name}: old FB-INVITE-V1 marker still present')
    assert_('const ACCESS_GATE = false' in html, f'{name}: ACCESS_GATE should be false in the bundle')

    page.wait_for_function('() => window.AuthService && window.__FB', timeout=60000)
    page.wait_for_selector('#landing', state='hidden', timeout=15000)
    page.wait_for_selector('#loading', state='hidden', timeout=120000)

    landing_hidden = page.evaluate('() => document.getElementById("landing").hidden')
    assert_(landing_hidden, f'{name}: landing/gate should stay hidden')
    assert_(not page.locator('#gateForm').is_visible(), f'{name}: gate form is visible')
    assert_(not page.locator('#gatePending').is_visible(), f'{name}: pending screen is visible')

    note = page.locator('#freeNote').inner_text()
    assert_('Currently free — pricing may change at any time' in note, f'{name}: missing English free note, got {note!r}')
    assert_('כרגע חינם — ייתכנו שינויים בכל עת' in note, f'{name}: missing Hebrew free note, got {note!r}')

    st = page.evaluate('''() => ({
      gate: AuthService.ACCESS_GATE,
      plan: AuthService.getPlan().id,
      watermark: AuthService.needsWatermark(),
      video: AuthService.canExportVideo(),
      fonts: AuthService.getPlan().allFonts,
      maxLayers: AuthService.getPlan().maxLayers,
    })''')
    assert_(st['gate'] is False, f'{name}: ACCESS_GATE should be false, got {st}')
    assert_(st['plan'] == 'pro', f'{name}: expected pro plan, got {st}')
    assert_(st['watermark'] is False, f'{name}: watermark should be off, got {st}')
    assert_(st['video'] is True, f'{name}: video export should be allowed, got {st}')
    assert_(st['fonts'] is True, f'{name}: all fonts should be allowed, got {st}')
    assert_(st['maxLayers'] is None or st['maxLayers'] > 100, f'{name}: unlimited layers expected, got {st}')

    # Pattern PNG export
    page.click('#exportBtn')
    page.click('[data-exp="patternPng"]')
    page.wait_for_selector('#modal:not([hidden])', timeout=20000)
    data_url = page.locator('#modalImg').get_attribute('src')
    assert_(data_url and data_url.startswith('blob:'), f'{name}: pattern modal missing blob')
    buf = bytes(page.evaluate('''(async (url) => {
      const r = await fetch(url); const ab = await r.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    })''', data_url))
    (OUT / f'{name}-pattern.png').write_bytes(buf)
    assert_(len(buf) > 1000, f'{name}: pattern png too small: {len(buf)}')
    page.click('#modalClose')

    # 3D catalogue PNG
    page.click('#exportBtn')
    page.click('[data-exp="catalogue"]')
    page.wait_for_selector('#modal:not([hidden])', timeout=30000)
    cat_url = page.locator('#modalImg').get_attribute('src')
    cat_buf = bytes(page.evaluate('''(async (url) => {
      const r = await fetch(url); const ab = await r.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    })''', cat_url))
    (OUT / f'{name}-catalogue.png').write_bytes(cat_buf)
    assert_(len(cat_buf) > 2000, f'{name}: catalogue png too small: {len(cat_buf)}')
    page.click('#modalClose')

    fatal = [e for e in errors if 'ResizeObserver' not in e and 'favicon' not in e]
    assert_(not fatal, f'{name}: page errors: ' + ' | '.join(fatal))

    context.close()
    return {
        'name': name,
        'plan': st,
        'patternBytes': len(buf),
        'catalogueBytes': len(cat_buf),
        'consoleErrors': logs[:5],
    }

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
        )
        fresh = run_scenario(browser, 'fresh')
        stale = run_scenario(browser, 'stale-localStorage', storage=STALE)
        browser.close()
        print(json.dumps({'ok': True, 'fresh': fresh, 'stale': stale}, indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
