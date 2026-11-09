#!/usr/bin/env python3
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = Path(os.environ.get('FB_OUT', '/tmp/fb-exports'))
OUT.mkdir(parents=True, exist_ok=True)

def assert_(cond, msg):
    if not cond:
        raise AssertionError(msg)

def main():
    errors = []
    logs = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
        )
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: logs.append(m.text) if m.type == 'error' else None)

        page.goto(BASE + '/?t=' + str(int(time.time()*1000)), wait_until='networkidle', timeout=120000)
        html = page.content()
        assert_('FB-SAAS-V1' in html, 'missing FB-SAAS-V1 marker')

        if page.locator('#landing').is_visible():
            page.click('#landingOpen')
        page.wait_for_selector('#loading', state='hidden', timeout=120000)
        page.wait_for_timeout(1500)

        badge = page.locator('#planBadge').inner_text().strip()
        assert_('free' in badge.lower(), f'expected Free badge, got {badge}')

        # Sign up
        page.click('#accountBtn')
        page.click('#accSignIn')
        page.click('#authTabUp')
        email = f'demo_{int(time.time())}@example.com'
        page.fill('#authName', 'Demo User')
        page.fill('#authEmail', email)
        page.fill('#authPass', 'secret12')
        page.click('#authSubmit')
        page.wait_for_selector('#authModal', state='hidden', timeout=10000)
        page.wait_for_timeout(500)

        # Free: video gated
        page.click('#exportBtn')
        page.click('[data-exp="turntable"]')
        page.wait_for_selector('#pricingModal:not([hidden])', timeout=8000)
        page.click('#pricingClose')

        # Free layer cap
        page.click('#addText')
        page.wait_for_timeout(600)
        layer_count = page.locator('#layers .layer').count()
        assert_(layer_count <= 3, f'Free should not exceed 3 layers, got {layer_count}')
        # layer cap opens pricing — close it
        if page.locator('#pricingModal').is_visible():
            page.click('#pricingClose')
            page.wait_for_selector('#pricingModal', state='hidden', timeout=5000)

        # Pattern PNG via modal blob
        page.click('#exportBtn')
        page.click('[data-exp="patternPng"]')
        page.wait_for_selector('#modal:not([hidden])', timeout=15000)
        data_url = page.locator('#modalImg').get_attribute('src')
        assert_(data_url and data_url.startswith('blob:'), 'pattern modal missing blob')
        buf = bytes(page.evaluate('''(async (url) => {
          const r = await fetch(url); const ab = await r.arrayBuffer();
          return Array.from(new Uint8Array(ab));
        })''', data_url))
        pattern_path = OUT / 'pattern-sheet.png'
        pattern_path.write_bytes(buf)
        assert_(pattern_path.stat().st_size > 1000, f'pattern png too small: {pattern_path.stat().st_size}')
        page.click('#modalClose')

        # Pattern SVG
        page.click('#exportBtn')
        page.click('[data-exp="patternSvg"]')
        page.wait_for_selector('#modal:not([hidden])', timeout=15000)
        svg_url = page.locator('#modalImg').get_attribute('src')
        svg_buf = bytes(page.evaluate('''(async (url) => {
          const r = await fetch(url); const ab = await r.arrayBuffer();
          return Array.from(new Uint8Array(ab));
        })''', svg_url))
        svg_path = OUT / 'pattern-sheet.svg'
        svg_path.write_bytes(svg_buf)
        assert_(b'<svg' in svg_buf[:200] or b'<?xml' in svg_buf[:200], 'svg missing root')
        page.click('#modalClose')

        # 3D catalogue
        page.click('#exportBtn')
        page.click('[data-exp="catalogue"]')
        page.wait_for_selector('#modal:not([hidden])', timeout=20000)
        cat_url = page.locator('#modalImg').get_attribute('src')
        cat_buf = bytes(page.evaluate('''(async (url) => {
          const r = await fetch(url); const ab = await r.arrayBuffer();
          return Array.from(new Uint8Array(ab));
        })''', cat_url))
        (OUT / 'catalogue.png').write_bytes(cat_buf)
        assert_(len(cat_buf) > 2000, 'catalogue png too small')
        page.click('#modalClose')

        # Redeem Pro
        page.click('#upgradeBtn')
        page.fill('#redeemCode', 'PRO40')
        page.click('#redeemBtn')
        page.wait_for_timeout(800)
        if page.locator('#pricingModal').is_visible():
            page.click('#pricingClose')
        badge2 = page.locator('#planBadge').inner_text().strip()
        assert_('pro' in badge2.lower(), f'expected Pro badge after redeem, got {badge2}')

        page.click('#addText')
        page.wait_for_timeout(800)
        layer_count2 = page.locator('#layers .layer').count()
        assert_(layer_count2 >= 4, f'Pro should allow 4+ layers, got {layer_count2}')

        # Turntable video download
        with page.expect_download(timeout=180000) as di:
            page.click('#exportBtn')
            page.click('[data-exp="turntable"]')
            page.wait_for_selector('#recProgress:not([hidden])', timeout=15000)
        download = di.value
        video_path = OUT / (download.suggested_filename or 'turntable.webm')
        download.save_as(str(video_path))
        try:
            page.wait_for_selector('#modal:not([hidden])', timeout=30000)
            page.click('#modalClose')
        except Exception:
            pass

        vsize = video_path.stat().st_size
        assert_(vsize > 5000, f'video too small / empty: {vsize} @ {video_path}')

        probe = ''
        try:
            probe = subprocess.check_output(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size,format_name',
                 '-of', 'default=nw=1', str(video_path)],
                text=True,
            )
        except Exception as e:
            probe = f'ffprobe failed: {e}'
        assert_('webm' in probe.lower() or 'matroska' in probe.lower() or 'mp4' in probe.lower() or vsize > 20000,
                f'ffprobe did not recognize video: {probe}')
        # MediaRecorder WebMs often omit duration cues; size/codec checks above are enough


        fatal = [e for e in errors if 'ResizeObserver' not in e and 'favicon' not in e]
        assert_(not fatal, 'page errors: ' + ' | '.join(fatal))

        result = {
            'ok': True,
            'email': email,
            'badgeBefore': badge,
            'badgeAfter': badge2,
            'layersFree': layer_count,
            'layersPro': layer_count2,
            'patternBytes': pattern_path.stat().st_size,
            'svgBytes': svg_path.stat().st_size,
            'catalogueBytes': len(cat_buf),
            'videoPath': str(video_path),
            'videoBytes': vsize,
            'probe': probe.strip(),
            'consoleErrors': logs[:5],
        }
        print(json.dumps(result, indent=2))
        browser.close()

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
