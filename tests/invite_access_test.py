#!/usr/bin/env python3
"""Invite-only access E2E. Phases: request (UI + pending), then finish (after tokens)."""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FB_BASE', 'http://127.0.0.1:8765')
STATE = Path(os.environ.get('FB_INVITE_STATE', '/tmp/fb-invite-test.json'))
ANON = os.environ.get(
    'FB_ANON',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZWttcmtjc29wc3hja3hlZm5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjQyMzMsImV4cCI6MjEwMTYwMDIzM30.jga5TlzxyEFzgV6bsaSdzW_mQOtFo_i7-7dSd4gzvdU',
)
FN = 'https://ilekmrkcsopsxckxefns.supabase.co/functions/v1'


def assert_(c, m):
    if not c:
        raise AssertionError(m)


def api(page, name, body):
    return page.evaluate(
        '''async ({name, body, fn, anon}) => {
          const r = await fetch(`${fn}/${name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
            body: JSON.stringify(body),
          });
          return await r.json();
        }''',
        {'name': name, 'body': body, 'fn': FN, 'anon': ANON},
    )


def new_page(playwright):
    browser = playwright.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'])
    context = browser.new_context()
    page = context.new_page()
    errors, logs = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: logs.append(m.text) if m.type == 'error' else None)
    page.goto(BASE + '/?t=' + str(int(time.time() * 1000)), wait_until='domcontentloaded', timeout=120000)
    assert_('FB-INVITE-V1' in page.content(), 'missing FB-INVITE-V1 marker')
    page.wait_for_selector('#landing:not([hidden])', timeout=20000)
    page.wait_for_function(
        '() => window.AuthService && document.getElementById("gateForm") && document.getElementById("gateForm").onsubmit',
        timeout=30000,
    )
    return browser, page, errors, logs


def check_errors(errors, logs):
    fatal = [e for e in errors if 'ResizeObserver' not in e and 'favicon' not in e]
    assert_(not fatal, 'page errors: ' + ' | '.join(fatal))
    return logs


def phase_request():
    errors = []
    with sync_playwright() as p:
        browser, page, errors, logs = new_page(p)
        # Copy on the gate
        landing = page.locator('#landing').inner_text()
        assert_('Request access' in landing and 'בקשת גישה' in landing, 'missing bilingual title')
        assert_('Currently free — pricing may change at any time' in landing, 'missing English free note')
        assert_('כרגע חינם — ייתכנו שינויים בכל עת' in landing, 'missing Hebrew free note')
        assert_(page.locator('#upgradeBtn').is_hidden() or not page.locator('#upgradeBtn').is_visible(), 'upgrade button should be hidden')
        assert_(page.locator('#landingPricing').is_hidden() or not page.locator('#landingPricing').is_visible(), 'pricing cards should be hidden')

        stamp = int(time.time())
        approve_email = f'fb.invite.test+{stamp}@example.com'
        page.fill('#gateName', 'TEST — Playwright e2e')
        page.fill('#gateEmail', approve_email)
        page.click('#gateSubmit')
        page.wait_for_selector('#gatePending:not([hidden])', timeout=30000)
        pend = page.locator('#gatePending').inner_text()
        assert_('pending approval' in pend.lower(), f'expected pending message, got {pend}')
        assert_('ממתינה לאישור' in pend, f'expected Hebrew pending, got {pend}')

        st = api(page, 'check-status', {'email': approve_email})
        assert_(st.get('status') == 'pending', f'check-status should be pending, got {st}')

        # Already-requested tab should also show pending
        # (request response already updated the session)

        state = {
            'approve_email': approve_email,
            'reject_email': os.environ.get('FB_REJECT_EMAIL', ''),
            'requested_at': stamp,
        }
        STATE.write_text(json.dumps(state, indent=2))
        logs = check_errors(errors, logs)
        print(json.dumps({'ok': True, 'phase': 'request', **state, 'consoleErrors': logs[:5]}, indent=2))
        browser.close()


def phase_finish():
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    approve_email = os.environ.get('FB_APPROVE_EMAIL') or state.get('approve_email')
    reject_email = os.environ.get('FB_REJECT_EMAIL') or state.get('reject_email')
    assert_(approve_email, 'missing approve email')
    assert_(reject_email, 'missing reject email (set FB_REJECT_EMAIL)')

    with sync_playwright() as p:
        browser, page, errors, logs = new_page(p)

        # Confirm approved via API, then log in
        st = api(page, 'check-status', {'email': approve_email})
        assert_(st.get('status') == 'approved', f'expected approved, got {st}')

        page.click('#gateTabLogin')
        page.fill('#gateEmail', approve_email)
        page.click('#gateSubmit')
        page.wait_for_selector('#landing', state='hidden', timeout=20000)
        page.wait_for_selector('#loading', state='hidden', timeout=120000)
        page.wait_for_timeout(600)
        badge = page.locator('#planBadge').inner_text().strip().lower()
        assert_('invited' in badge, f'expected Invited badge, got {badge}')
        assert_(page.locator('#upgradeBtn').is_hidden() or not page.locator('#upgradeBtn').is_visible(), 'upgrade still hidden after login')

        # Invited = full features, no watermark helper
        needs_wm = page.evaluate('() => window.AuthService.needsWatermark()')
        can_video = page.evaluate('() => window.AuthService.canExportVideo()')
        assert_(needs_wm is False, 'approved user should have no watermark')
        assert_(can_video is True, 'approved user should be able to export video')

        # Logout and check rejected path
        page.click('#accountBtn')
        page.click('#accLogout')
        page.wait_for_selector('#landing:not([hidden])', timeout=10000)

        st_r = api(page, 'check-status', {'email': reject_email})
        assert_(st_r.get('status') == 'rejected', f'expected rejected, got {st_r}')

        page.click('#gateTabLogin')
        page.fill('#gateEmail', reject_email)
        page.click('#gateSubmit')
        page.wait_for_selector('#gateRejected:not([hidden])', timeout=20000)
        rej = page.locator('#gateRejected').inner_text()
        assert_('wasn' in rej.lower() or 'not approved' in rej.lower() or 'אושרה' in rej, f'expected polite reject, got {rej}')
        assert_(page.locator('#landing').is_visible(), 'rejected user must not enter the editor')

        logs = check_errors(errors, logs)
        print(json.dumps({
            'ok': True,
            'phase': 'finish',
            'approve_email': approve_email,
            'reject_email': reject_email,
            'badge': badge,
            'watermark': needs_wm,
            'video': can_video,
            'consoleErrors': logs[:5],
        }, indent=2))
        browser.close()


if __name__ == '__main__':
    phase = 'request'
    if len(sys.argv) > 1:
        phase = sys.argv[1].lstrip('-')
    try:
        import urllib.request
        html = urllib.request.urlopen(BASE + '/', timeout=10).read().decode('utf-8', 'replace')
        if 'const ACCESS_GATE = false' in html:
            print('SKIP invite_access_test: ACCESS_GATE is off (FB-OPEN-V1). Re-enable the flag to run this suite.')
            sys.exit(0)
        if phase == 'finish':
            phase_finish()
        else:
            phase_request()
    except Exception as e:
        print('TEST_FAIL', e, file=sys.stderr)
        sys.exit(1)
