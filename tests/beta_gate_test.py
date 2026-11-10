#!/usr/bin/env python3
"""FB-BETA-V1: email + one-time code gate, session re-validation, admin revoke.

Uses separate TEST codes (created via admin-codes) and deletes them afterwards.
Never redeems the 15 real tester codes.
"""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
OUT = Path(os.environ.get('FB_OUT', '/tmp/fb-beta'))
OUT.mkdir(parents=True, exist_ok=True)
ANON = os.environ.get(
    'FB_ANON',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZWttcmtjc29wc3hja3hlZm5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjQyMzMsImV4cCI6MjEwMTYwMDIzM30.jga5TlzxyEFzgV6bsaSdzW_mQOtFo_i7-7dSd4gzvdU',
)
FN = 'https://ilekmrkcsopsxckxefns.supabase.co/functions/v1'


def admin_key():
    k = os.environ.get('FB_ADMIN_KEY', '').strip()
    if k:
        return k
    p = Path('/workspace/fashion-builder-admin-key.txt')
    if p.exists():
        return p.read_text(encoding='utf-8').splitlines()[0].strip()
    raise SystemExit('FB_ADMIN_KEY is missing and /workspace/fashion-builder-admin-key.txt was not found')


ADMIN = admin_key()


def assert_(c, m):
    if not c:
        raise AssertionError(m)


def admin_call(page, body):
    return page.evaluate(
        '''async ({fn, anon, key, body}) => {
          const r = await fetch(`${fn}/admin-codes`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${anon}`,
              apikey: anon,
              'x-admin-key': key,
            },
            body: JSON.stringify(body),
          });
          const data = await r.json().catch(() => ({ ok:false, error: r.statusText }));
          data._http = r.status;
          return data;
        }''',
        {'fn': FN, 'anon': ANON, 'key': ADMIN, 'body': body},
    )


def new_context(browser, storage=None):
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
    return context, page, errors, logs


def check_errors(errors, logs, name):
    fatal = [e for e in errors if 'ResizeObserver' not in e and 'favicon' not in e]
    assert_(not fatal, f'{name}: page errors: ' + ' | '.join(fatal))
    return logs


def wait_gate(page):
    html = page.content()
    assert_('FB-BETA-V1' in html, 'missing FB-BETA-V1 marker')
    assert_('FB-OPEN-V1' not in html, 'old FB-OPEN-V1 marker still present')
    assert_('const ACCESS_GATE = false' in html, 'ACCESS_GATE should stay false')
    assert_('const BETA_GATE = true' in html, 'BETA_GATE should be true')
    page.wait_for_function('() => window.AuthService && document.getElementById("gateForm") && document.getElementById("gateForm").onsubmit', timeout=60000)
    page.wait_for_selector('#landing:not([hidden])', timeout=20000)
    landing = page.locator('#landing').inner_text()
    assert_('גרסת בטא' in landing and 'Beta version' in landing, f'missing beta title, got {landing[:400]!r}')
    assert_('Currently free — pricing may change at any time' in landing, 'missing English free note')
    assert_('כרגע חינם — ייתכנו שינויים בכל עת' in landing, 'missing Hebrew free note')
    assert_(page.locator('#gateEmail').is_visible(), 'email field hidden')
    assert_(page.locator('#gateCode').is_visible(), 'code field hidden')


def enter(page, email, code):
    page.fill('#gateEmail', email)
    page.fill('#gateCode', code)
    page.click('#gateSubmit')


def wait_editor(page, timeout=30000):
    page.wait_for_selector('#landing', state='hidden', timeout=timeout)
    page.wait_for_function('() => window.AuthService && AuthService.isApproved()', timeout=timeout)


def snapshot_session(page):
    return page.evaluate('() => JSON.parse(localStorage.getItem("fb-beta-session-v1") || "null")')


def main():
    created_ids = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
        )
        try:
            # --- admin: wrong key rejected, list + generate TEST codes ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            bad = page.evaluate(
                '''async ({fn, anon}) => {
                  const r = await fetch(`${fn}/admin-codes`, {
                    method: 'POST',
                    headers: { 'Content-Type':'application/json', Authorization:'Bearer '+anon, apikey:anon, 'x-admin-key':'wrong' },
                    body: JSON.stringify({ action:'list' }),
                  });
                  return r.status;
                }''',
                {'fn': FN, 'anon': ANON},
            )
            assert_(bad == 401, f'admin should 401 on a bad key, got {bad}')

            listed = admin_call(page, {'action': 'list'})
            assert_(listed.get('ok'), f'admin list failed: {listed}')
            before = len(listed.get('codes') or [])

            a = admin_call(page, {'action': 'generate', 'note': 'TEST playwright A'})
            b = admin_call(page, {'action': 'generate', 'note': 'TEST playwright B'})
            assert_(a.get('ok') and a.get('code'), f'generate A failed: {a}')
            assert_(b.get('ok') and b.get('code'), f'generate B failed: {b}')
            created_ids.extend([a['item']['id'], b['item']['id']])
            code_a, code_b = a['code'], b['code']
            assert_(code_a.startswith('FB-') and code_a != code_b, f'bad generated codes: {code_a} {code_b}')

            listed2 = admin_call(page, {'action': 'list'})
            assert_(listed2.get('ok') and len(listed2['codes']) == before + 2, f'list count after generate: {listed2}')
            check_errors(errors, logs, 'admin-setup')
            ctx.close()

            email1 = f'fb.beta.test.a+{int(time.time())}@example.com'
            email2 = f'fb.beta.test.b+{int(time.time())}@example.com'

            # --- valid code + email enters, full features ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            enter(page, email1, code_a)
            wait_editor(page)
            st = page.evaluate('''() => ({
              gate: AuthService.ACCESS_GATE,
              beta: AuthService.BETA_GATE,
              plan: AuthService.getPlan().id,
              watermark: AuthService.needsWatermark(),
              video: AuthService.canExportVideo(),
              fonts: AuthService.getPlan().allFonts,
              approved: AuthService.isApproved(),
              email: AuthService.getUser() && AuthService.getUser().email,
            })''')
            assert_(st['gate'] is False, f'ACCESS_GATE should stay false, got {st}')
            assert_(st['beta'] is True, f'BETA_GATE should be true, got {st}')
            assert_(st['approved'] and st['plan'] == 'pro', f'expected approved pro, got {st}')
            assert_(st['watermark'] is False and st['video'] is True and st['fonts'] is True, f'expected full features, got {st}')
            assert_(st['email'] == email1, f'email mismatch {st}')
            note = page.locator('#freeNote').inner_text()
            assert_('Currently free — pricing may change at any time' in note, f'missing header free note: {note!r}')
            sess1 = snapshot_session(page)
            assert_(sess1 and sess1.get('token') and sess1.get('status') == 'ok', f'missing session: {sess1}')
            check_errors(errors, logs, 'first-entry')
            ctx.close()

            # --- same code, other email rejected ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            enter(page, email2, code_a)
            page.wait_for_function(
                '() => (document.getElementById("gateError")||{}).textContent && document.getElementById("gateError").textContent.length > 0',
                timeout=20000,
            )
            err = page.locator('#gateError').inner_text()
            assert_('already been used' in err.lower() or 'כבר שומש' in err, f'expected used-code error, got {err!r}')
            assert_(page.locator('#landing').is_visible(), 'other email should stay on the gate')
            approved = page.evaluate('() => AuthService.isApproved()')
            assert_(not approved, 'other email must not be approved')
            check_errors(errors, logs, 'other-email')
            ctx.close()

            # --- same code, same email re-enters (other device / fresh storage) ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            enter(page, email1, code_a)
            wait_editor(page)
            st2 = page.evaluate('() => ({ approved: AuthService.isApproved(), email: AuthService.getUser().email })')
            assert_(st2['approved'] and st2['email'] == email1, f're-entry failed: {st2}')
            sess2 = snapshot_session(page)
            assert_(sess2 and sess2.get('token'), 're-entry missing token')
            check_errors(errors, logs, 're-entry')
            # keep this context's storage to test revoke-on-reload
            token_after = sess2['token']
            ctx.close()

            # --- revoke blocks the session on the next load ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            rev = admin_call(page, {'action': 'revoke', 'id': a['item']['id']})
            assert_(rev.get('ok') and rev.get('status') == 'revoked', f'revoke failed: {rev}')
            ctx.close()

            ctx, page, errors, logs = new_context(browser, storage={
                'fb-beta-session-v1': json.dumps({'email': email1, 'token': token_after, 'status': 'ok'}),
            })
            page.wait_for_function('() => window.AuthService', timeout=60000)
            page.wait_for_selector('#landing:not([hidden])', timeout=30000)
            page.wait_for_function('() => !AuthService.isApproved()', timeout=20000)
            # revoked panel or form should be visible — not the editor
            landing_vis = page.evaluate('() => !document.getElementById("landing").hidden')
            assert_(landing_vis, 'revoked session should see the gate')
            revoked_panel = page.evaluate('() => !document.getElementById("gateRevoked").hidden')
            form_vis = page.evaluate('() => !document.getElementById("gateForm").hidden')
            assert_(revoked_panel or form_vis, 'expected revoked panel or form after revoke')
            if revoked_panel:
                body = page.locator('#gateRevoked').inner_text()
                assert_('blocked' in body.lower() or 'נחסמה' in body, f'revoked copy missing: {body!r}')
            # attempting the same code again should also fail
            if not page.locator('#gateForm').is_visible():
                if page.locator('#gateNewCode').count():
                    page.click('#gateNewCode')
            if page.locator('#gateForm').is_visible():
                enter(page, email1, code_a)
                page.wait_for_function(
                    '() => (document.getElementById("gateError")||{}).textContent && document.getElementById("gateError").textContent.length > 0',
                    timeout=20000,
                )
                err2 = page.locator('#gateError').inner_text().lower()
                assert_('revoked' in err2 or 'נחסם' in err2, f'expected revoked error, got {err2!r}')
            check_errors(errors, logs, 'revoked-reload')
            ctx.close()

            # --- admin restore + list reflects status ---
            ctx, page, errors, logs = new_context(browser)
            wait_gate(page)
            rest = admin_call(page, {'action': 'restore', 'id': a['item']['id']})
            assert_(rest.get('ok') and rest.get('status') == 'used', f'restore should return used, got {rest}')
            listed3 = admin_call(page, {'action': 'list'})
            row = next(c for c in listed3['codes'] if c['id'] == a['item']['id'])
            assert_(row['status'] == 'used' and row['used_by_email'] == email1, f'restored row: {row}')

            # after restore, same email can enter again
            enter(page, email1, code_a)
            wait_editor(page)
            check_errors(errors, logs, 'restore')
            ctx.close()

            # --- admin.html UI: login, list, revoke ---
            admin_page_ctx = browser.new_context(viewport={'width': 1200, 'height': 900})
            ap = admin_page_ctx.new_page()
            aerr = []
            ap.on('pageerror', lambda e: aerr.append(str(e)))
            ap.goto(BASE + '/admin.html?t=' + str(int(time.time() * 1000)), wait_until='domcontentloaded', timeout=60000)
            assert_('FB-BETA-V1' in ap.content(), 'admin.html missing marker')
            ap.fill('#adminKey', ADMIN)
            ap.click('#loginBtn')
            ap.wait_for_selector('#panel:not([hidden])', timeout=20000)
            table = ap.locator('#rows').inner_text()
            assert_('FB-' in table, f'admin table empty? {table!r}')
            # revoke code B from the UI (still unused)
            # find the row with hint of code B (FB-XXXX-••••)
            hint_b = code_b[:7] + '-••••'
            # click Revoke on a row that contains the hint — may be more than one if unlucky; use JS
            clicked = ap.evaluate(
                '''(hint) => {
                  const rows = [...document.querySelectorAll('#rows tr')];
                  const row = rows.find(r => r.innerText.includes(hint));
                  if (!row) return false;
                  const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Revoke');
                  if (!btn) return false;
                  btn.click();
                  return true;
                }''',
                hint_b,
            )
            assert_(clicked, f'could not find revoke button for {hint_b}')
            ap.wait_for_timeout(1500)
            rowb = None
            listed4 = None
            # verify via API from this page
            listed4 = admin_call(ap, {'action': 'list'})
            rowb = next(c for c in listed4['codes'] if c['id'] == b['item']['id'])
            assert_(rowb['status'] == 'revoked', f'UI revoke did not stick: {rowb}')
            assert_(not aerr, 'admin.html JS errors: ' + ' | '.join(aerr))
            admin_page_ctx.close()

            print(json.dumps({
                'ok': True,
                'generated': 2,
                'email1': email1,
                'features': st,
                'revokedThenRestored': True,
                'adminUiRevoke': True,
            }, indent=2))
        finally:
            # Always try to delete TEST codes, even on failure.
            try:
                cleanup_ctx = browser.new_context()
                cp = cleanup_ctx.new_page()
                cp.goto(BASE + '/?t=cleanup', wait_until='domcontentloaded', timeout=60000)
                cp.wait_for_function('() => window.AuthService', timeout=30000)
                listed = admin_call(cp, {'action': 'list'})
                for c in (listed.get('codes') or []):
                    note = c.get('note') or ''
                    if note.startswith('TEST') or c['id'] in created_ids:
                        admin_call(cp, {'action': 'delete', 'id': c['id']})
                leftover = admin_call(cp, {'action': 'list'})
                still = [c for c in (leftover.get('codes') or []) if (c.get('note') or '').startswith('TEST') or c['id'] in created_ids]
                if still:
                    print('WARN leftover TEST codes:', still, file=sys.stderr)
                cleanup_ctx.close()
            except Exception as e:
                print('WARN cleanup failed:', e, file=sys.stderr)
            browser.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
