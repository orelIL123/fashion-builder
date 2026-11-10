#!/usr/bin/env python3
"""Every export produces a real, non-empty file: pattern PNG/SVG, catalogue PNG, print + sublimation ZIPs, spec sheet
and the turntable video (MP4 when the browser can record it). With FB_WATERMARK=1 the free-plan watermark is forced on so
the Stylooks logo can be checked in the images. Files land in FB_OUT (default /tmp/fb-exports-visual).
Run a local server first: python3 -m http.server 8765"""
import io, json, os, subprocess, sys, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = Path(os.environ.get('FB_OUT', '/tmp/fb-exports-visual')); OUT.mkdir(parents=True, exist_ok=True)
WM = os.environ.get('FB_WATERMARK') == '1'


def assert_(c, m):
    if not c: raise AssertionError(m)


def main():
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
        page = b.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 900}).new_page()
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', lambda r: r.abort() if 'fonts.g' in r.request.url else r.continue_())
        page.goto(BASE + '/', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__dbg', timeout=180000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#landing', state='hidden', timeout=10000)
        if WM: page.evaluate('() => { AuthService.needsWatermark = () => true; }')
        page.evaluate('''async () => { const FB = window.__FB, f = FB.pieceById.front.box; const c = document.createElement('canvas'); c.width = c.height = 300;
          const g = c.getContext('2d'); g.fillStyle = '#d01818'; g.fillRect(0,0,300,300); g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText('FB', 60, 190);
          const img = new Image(); img.src = c.toDataURL(); await img.decode(); FB.addImage(img, 'photo', (f[0]+f[2])/2, f[1] + 40*FB.PX, 22); FB.composeSheet(); FB.renderLayers(); FB.commit(); }''')
        page.wait_for_timeout(800)
        fetch = lambda url: bytes(page.evaluate('async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer()))', url))

        def modal_export(key, name):
            page.click('#exportBtn'); page.click(f'[data-exp="{key}"]')
            page.wait_for_selector('#modal:not([hidden])', timeout=30000)
            data = fetch(page.locator('#modalImg').get_attribute('src')); (OUT / name).write_bytes(data); page.click('#modalClose')
            res[name] = len(data); return data

        modal_export('patternPng', 'pattern-sheet.png'); modal_export('patternSvg', 'pattern-sheet.svg')
        modal_export('catalogue', 'catalogue.png'); modal_export('spec', 'spec-sheet.png')
        for key in ('print', 'sublimation'):
            with page.expect_download(timeout=60000) as d:
                page.click('#exportBtn'); page.click(f'[data-exp="{key}"]')
            f = OUT / d.value.suggested_filename; d.value.save_as(str(f)); page.click('#modalClose')
            z = zipfile.ZipFile(f); names = z.namelist(); assert_(len(names) > 5, f'{key} zip has too few files: {names}')
            bad = [n for n in names if not n.endswith('/') and z.getinfo(n).file_size < 60]; assert_(not bad, f'{key} zip has empty files: {bad}')
            res[f.name] = len(names)
            if key == 'print': (OUT / 'zip-front.png').write_bytes(z.read(next(n for n in names if n.startswith('pieces/Front'))))
        with page.expect_download(timeout=180000) as d:
            page.click('#exportBtn'); page.click('[data-exp="turntable"]')
        v = OUT / d.value.suggested_filename; d.value.save_as(str(v)); res['video'] = v.name
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(v)]))
        st = probe['streams'][0]; res['codec'] = st['codec_name']; res['size'] = [st['width'], st['height']]; res['format'] = probe['format']['format_name']
        n = int(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(v)], text=True).strip().strip(','))
        res['frames'] = n; assert_(n >= 60, f'video has only {n} frames')
        for i, t in enumerate(('0.3', '1.5', '2.7', '4.2')):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', t, '-i', str(v), '-frames:v', '1', str(OUT / f'frame-{i}.png')], check=True)
        fatal = [e for e in errors if 'ResizeObserver' not in e]; assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
        b.close()
    print('OK', json.dumps(res))


if __name__ == '__main__':
    try: main()
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
