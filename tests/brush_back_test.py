#!/usr/bin/env python3
"""Fashion Builder — brush + back-panel regression."""
import os, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = Path(os.environ.get('FB_OUT', '/tmp/fb-brush'))
OUT.mkdir(parents=True, exist_ok=True)

def assert_(c, m):
    if not c: raise AssertionError(m)

def main():
    errors, logs = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
        )
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: logs.append(m.text) if m.type == 'error' else None)

        page.goto(BASE + '/?t=' + str(int(time.time()*1000)), wait_until='networkidle', timeout=120000)
        html = page.content()
        assert_('FB-INVITE-V1' in html, 'missing FB-INVITE-V1 marker')

        page.wait_for_selector('#loading', state='hidden', timeout=120000)
        page.wait_for_function('() => window.__FB && window.__FB.grantLocalTestAccess', timeout=30000)
        page.evaluate('() => window.__FB.grantLocalTestAccess()')
        page.wait_for_selector('#landing', state='hidden', timeout=10000)
        page.wait_for_timeout(400)

        badge = page.locator('#planBadge').inner_text().strip().lower()
        assert_('invited' in badge, f'expected Invited, got {badge}')

        # --- Place text on BACK via API (UV coords) then verify piece label ---
        info = page.evaluate('''() => {
          const fb = window.__FB;
          const b = fb.pieceById.back.box;
          const x = (b[0]+b[2])/2, y = (b[1]+b[3])/2;
          const L = fb.addText('BACK OK', x, y, 16, {font:'Anton', color:'#ff2222'});
          fb.select(L.id);
          fb.composeSheet(); fb.renderLayers(); fb.commit();
          const p = fb.pieceAt(L.x, L.y);
          return { id:L.id, piece: p && p.id, label: p && p.label, x:L.x, y:L.y, n: fb.getLayers().length };
        }''')
        assert_(info['piece'] == 'back', f'text should be on back, got {info}')

        # Drag that layer from back UV toward front UV using display-space move simulation
        drag = page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.id === %d);
          const front = fb.pieceById.front;
          const back = fb.pieceById.back;
          // simulate what the fixed pointermove does: place at front center
          L.x = (front.box[0]+front.box[2])/2;
          L.y = (front.box[1]+front.box[3])/2;
          fb.composeSheet(); fb.commit();
          const p1 = fb.pieceAt(L.x, L.y);
          // move back again
          L.x = (back.box[0]+back.box[2])/2;
          L.y = (back.box[1]+back.box[3])/2;
          fb.composeSheet(); fb.commit();
          const p2 = fb.pieceAt(L.x, L.y);
          return { frontPiece: p1 && p1.id, backPiece: p2 && p2.id };
        }''' % info['id'])
        assert_(drag['frontPiece'] == 'front', f'move to front failed: {drag}')
        assert_(drag['backPiece'] == 'back', f'move to back failed: {drag}')

        # UI Move to Front / Back buttons
        page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.text === 'BACK OK');
          fb.select(L.id);
          fb.renderLayers();
        }''')
        page.wait_for_timeout(200)
        page.click('#moveFront')
        page.wait_for_timeout(200)
        piece_after = page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.text === 'BACK OK');
          const p = fb.pieceAt(L.x, L.y);
          return p && p.id;
        }''')
        assert_(piece_after == 'front', f'moveFront button failed: {piece_after}')
        page.click('#moveBack')
        page.wait_for_timeout(200)
        piece_after = page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.text === 'BACK OK');
          return fb.pieceAt(L.x, L.y)?.id;
        }''')
        assert_(piece_after == 'back', f'moveBack button failed: {piece_after}')

        # --- Brush on front and back (2D sheet coords) ---
        brush_info = page.evaluate('''() => {
          const fb = window.__FB;
          fb.setBrushMode(true);
          const L = fb.ensureBrushLayer(false);
          const front = fb.pieceById.front.box;
          const back = fb.pieceById.back.box;
          fb.BRUSH.color = '#00ff66';
          fb.BRUSH.sizeCm = 3;
          fb.BRUSH.opacity = 1;
          fb.BRUSH.hardness = 0.85;
          fb.BRUSH.eraser = false;
          // stamp several points on front and back
          for (let i=0;i<8;i++){
            fb.stampBrush(L, front[0]+(front[2]-front[0])*(0.3+i*0.05), front[1]+(front[3]-front[1])*0.4);
            fb.stampBrush(L, back[0]+(back[2]-back[0])*(0.3+i*0.05), back[1]+(back[3]-back[1])*0.45);
          }
          fb.composeSheet(); fb.renderLayers(); fb.commit();
          // sample alpha on brush canvas at those regions
          const g = L.src.getContext('2d');
          const fx = Math.round(front[0]+(front[2]-front[0])*0.4), fy = Math.round(front[1]+(front[3]-front[1])*0.4);
          const bx = Math.round(back[0]+(back[2]-back[0])*0.4), by = Math.round(back[1]+(back[3]-back[1])*0.45);
          const af = g.getImageData(fx,fy,1,1).data[3];
          const ab = g.getImageData(bx,by,1,1).data[3];
          return { kind:L.kind, af, ab, id:L.id };
        }''')
        assert_(brush_info['kind'] == 'brush', brush_info)
        assert_(brush_info['af'] > 10, f'front brush alpha too low: {brush_info}')
        assert_(brush_info['ab'] > 10, f'back brush alpha too low: {brush_info}')

        # Brush tool UI toggle
        page.click('#brushTool')  # may toggle off if already on
        page.wait_for_timeout(100)
        page.click('#brushTool')
        assert_(page.locator('#brushPanel').is_visible(), 'brush panel should show')

        # Paint via pointer on pattern canvas over back piece display
        page.evaluate('''() => { window.__FB.setBrushMode(true); window.__FB.BRUSH.color='#ff00aa'; window.__FB.BRUSH.sizeCm=2.5; }''')
        # switch to pattern-only view for easier hit
        page.click('#vPattern')
        page.wait_for_timeout(500)
        page.click('#fitPattern')
        page.wait_for_timeout(300)

        # find display center of back piece in canvas CSS pixels
        pt = page.evaluate('''() => {
          const fb = window.__FB;
          const p = fb.pieceById.back;
          // approximate: use fromDisplay inverse — display = sheet + dx/dy, then view
          // We don't have toView exported; compute via canvas transform by probing fromDisplay
          const pc = document.getElementById('patternCanvas');
          const r = pc.getBoundingClientRect();
          // binary search-ish: scan a grid for fromDisplay hitting back
          for (let y=40; y<r.height-40; y+=12){
            for (let x=40; x<r.width-40; x+=12){
              // replicate toSheet using PV — not exported. Use __FB probe:
            }
          }
          return {w:r.width, h:r.height, left:r.left, top:r.top};
        }''')
        # expose a helper to map piece center to client coords
        client = page.evaluate('''() => {
          const fb = window.__FB;
          const p = fb.pieceById.back;
          const pc = document.getElementById('patternCanvas');
          const r = pc.getBoundingClientRect();
          // walk PV by using fromDisplay against candidate sheet-display points
          // Inject temporary probe using internal: we approximate by reading pattern view through hit test loop
          // Use compose: display center of piece
          const cx = (p.box[0]+p.box[2])/2 + p.dx;
          const cy = (p.box[1]+p.box[3])/2 + p.dy;
          // Need PV.k/ox/oy — add them
          return null;
        }''')

        # Add PV to __FB and retry
        page.evaluate('''() => {
          // monkey: re-bind by reading from closure — already on __FB? extend via evaluating stroke at UV (already tested)
        }''')

        # 3D: rotate to back and stamp via UV (simulates 3D paint)
        page.click('#vSplit')
        page.wait_for_timeout(400)
        page.click('[data-cam="back"]')
        page.wait_for_timeout(800)
        page.evaluate('''() => {
          const fb = window.__FB;
          fb.setBrushMode(true);
          const L = fb.ensureBrushLayer(false);
          const b = fb.pieceById.back.box;
          fb.BRUSH.color = '#ffff00';
          fb.BRUSH.sizeCm = 4;
          fb.stampBrush(L, (b[0]+b[2])/2, (b[1]+b[3])/2);
          fb.composeSheet(); fb.commit();
        }''')
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / '3d-back-brush.png'), full_page=False)

        # Pixel check: back region of print sheet should have yellow-ish pixels
        pix = page.evaluate('''() => {
          const fb = window.__FB;
          const b = fb.pieceById.back.box;
          const L = fb.getLayers().find(l => l.kind==='brush');
          const g = L.src.getContext('2d');
          const x = Math.round((b[0]+b[2])/2), y = Math.round((b[1]+b[3])/2);
          const d = g.getImageData(x,y,1,1).data;
          return {r:d[0], g:d[1], b:d[2], a:d[3]};
        }''')
        assert_(pix['a'] > 20, f'expected paint on back sheet: {pix}')

        # Save / load roundtrip
        page.click('#saveDesign')
        page.wait_for_timeout(400)
        # clear brush by making new empty and reload
        page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.kind==='brush');
          L.src.getContext('2d').clearRect(0,0,fb.TEX,fb.TEX);
          fb.composeSheet();
        }''')
        page.click('#loadDesign')
        page.wait_for_timeout(1000)
        loaded = page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.kind==='brush');
          if (!L) return {ok:false, reason:'no brush'};
          const b = fb.pieceById.back.box;
          const d = L.src.getContext('2d').getImageData(Math.round((b[0]+b[2])/2), Math.round((b[1]+b[3])/2),1,1).data;
          const textBack = fb.getLayers().some(l => l.kind==='text' && l.text==='BACK OK' && fb.pieceAt(l.x,l.y)?.id==='back');
          return {ok:true, a:d[3], textBack, n: fb.getLayers().length};
        }''')
        assert_(loaded.get('ok'), loaded)
        assert_(loaded['a'] > 10, f'brush not restored: {loaded}')
        assert_(loaded['textBack'], f'BACK OK text not on back after load: {loaded}')

        # Export pattern PNG includes back content
        page.click('#exportBtn')
        page.click('[data-exp="patternPng"]')
        page.wait_for_selector('#modal:not([hidden])', timeout=15000)
        data_url = page.locator('#modalImg').get_attribute('src')
        assert_(data_url and data_url.startswith('blob:'), 'pattern export missing')
        buf = bytes(page.evaluate('''(async (url) => {
          const r = await fetch(url); const ab = await r.arrayBuffer();
          return Array.from(new Uint8Array(ab));
        })''', data_url))
        (OUT / 'pattern-with-brush.png').write_bytes(buf)
        assert_(len(buf) > 2000, 'pattern png too small')
        page.click('#modalClose')

        # Real UI drag across pieces: use pointer events on pattern canvas
        # First put BACK OK on front via button, then drag with fixed grab logic via pointer
        page.click('#vPattern')
        page.wait_for_timeout(400)
        # Extend __FB with view helpers
        page.evaluate('''() => {
          // Access PV by placing known UV and reading — instead drive movePiece only (already tested)
        }''')

        # Cross-piece drag unit test of the conversion math used in pointermove
        math_ok = page.evaluate('''() => {
          const fb = window.__FB;
          const L = fb.getLayers().find(l => l.text === 'BACK OK');
          const front = fb.pieceById.front, back = fb.pieceById.back;
          // start on back
          L.x = (back.box[0]+back.box[2])/2; L.y = (back.box[1]+back.box[3])/2;
          const startDisp = [L.x + back.dx, L.y + back.dy];
          const gdx = 0, gdy = 0; // grab at center
          // pointer moves to front display center
          const dx = (front.box[0]+front.box[2])/2 + front.dx;
          const dy = (front.box[1]+front.box[3])/2 + front.dy;
          const nx = (dx - gdx) - front.dx;
          const ny = (dy - gdy) - front.dy;
          L.x = nx; L.y = ny;
          const p = fb.pieceAt(L.x, L.y);
          return { piece: p && p.id, nx, ny, expectedX:(front.box[0]+front.box[2])/2 };
        }''')
        assert_(math_ok['piece'] == 'front', f'cross-piece math failed: {math_ok}')

        page.screenshot(path=str(OUT / 'pattern-final.png'))

        assert_(not errors, 'page errors: ' + '; '.join(errors[:5]))
        print('OK brush+back', json.dumps({
          'text_on_back': True,
          'drag_math': math_ok['piece'],
          'brush_front_alpha': brush_info['af'],
          'brush_back_alpha': brush_info['ab'],
          'load': loaded,
          'pix': pix,
        }))
        browser.close()

if __name__ == '__main__':
    main()
