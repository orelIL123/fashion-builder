# Fashion Builder

A garment editor in the browser: a sewing-pattern sheet and a live 3D shirt side by side. Place a print on a pattern piece (or drag it directly on the 3D shirt) and it lands exactly there on the garment, because the 3D mesh's UVs *are* the sewing pattern.

**Live:** https://orelil123.github.io/fashion-builder/

Marker: `FB-INVITE-V1` (in page source).

## Features

- **Brush paint** on 2D pattern pieces and on the 3D shirt (UV-mapped). Color, size, opacity, hardness, eraser, clear.
- **Front ↔ Back dragging**: artwork layers can be dragged across packed pattern pieces (and across the 3D garment). Use **→ Front / → Back** as a shortcut.

- **Views:** Sewing pattern · Split · 3D, outside / inside pattern sides, front / back / side cameras, auto-rotate
- **Design:** image and text layers on the **2D pattern map** (and 3D), click-to-place, opacity, flip, rotate handle, lock/duplicate/reorder, 35 fonts (incl. Hebrew), inside prints (neck label), solid or gradient fabric colour, rib colour, washes, save/load in browser
- **Export:** 3D PNG (catalogue / dark / transparent), 2D pattern PNG + SVG, print files (ZIP), sublimation panels, spec sheet, **360° turntable video (~5s WebM/MP4)** (Pro)
- **Access:** Invite-only. Request access with an email; Orel approves or rejects from a notification email. Approved users get the full editor (all fonts, no watermark, video, up to 50 saved designs). **Currently free — pricing may change at any time.**

Turntable video is recorded in-browser (2D mirror of the WebGL canvas + `captureStream(0)` / `requestFrame`). Some browsers omit duration metadata on the WebM; the file still plays.

## Invite-only access
The editor is gated until a request is **approved server-side** (not just in `localStorage`).

1. A visitor enters their email (name optional) on **Request access / בקשת גישה**.
2. Edge Function `request-access` inserts a `pending` row and notifies `orel895@gmail.com` via [FormSubmit.co](https://formsubmit.co) with **Approve** and **Reject** links.
3. Those links open Edge Function `decide` and update the row. The visitor returns, enters the same email, and `check-status` lets them in if approved.

**Supabase:** project `orelIL123's Project` (ref `ilekmrkcsopsxckxefns`, org TooLive). Fashion Builder tables/functions are isolated (`public.fb_access_requests` + `request-access` / `decide` / `check-status`). This project already hosted another app; a brand-new Supabase project was quoted at $10/month, so this one was reused.

**What Orel must do once:** the first FormSubmit notification is an activation email. Open it in `orel895@gmail.com` and click the confirmation link. After that, new requests arrive with Approve / Reject links. FormSubmit also keeps submissions for 30 days if you confirm later.

**Limitations**
- Login after approval is email-only (no password / magic link). Anyone who knows an approved email can enter. Fine for a small designer group; swap in Supabase Auth later if needed.
- Requesters are not emailed when you decide — they come back and enter their email to see the status.
- FormSubmit must be activated once, as above.
- The gate is enforced by the server for approval state, but this is still a static GitHub Pages app: a determined user can hide the overlay with DevTools. They cannot change the server-side status.
- Saved designs still live in the browser, not in the cloud.
- Paid plans are hidden (code kept). Planned later: ~₪30/month.

Rebuild after edits: `python3 src/build.py` (bundles `auth.js` + `app.js` into `index.html`).

## How the 3D shirt looks real
1. **A real garment mesh** made from sewn pattern pieces (CLO / Marvelous style), not an AI-generated scan.
2. **UV islands = pattern pieces**, so the 2048 px print sheet maps 1:1 onto the fabric. `assets/pattern.json` holds the piece outlines.
3. **Fabric shading:** MeshPhysicalMaterial with sheen, knit normal, crumple normal, per-piece rib texture.
4. **Studio look:** environment lighting, gobo spotlight, GTAO, neutral tone mapping.

## Layout
| Path | What |
|---|---|
| `index.html` | built app (three.js r170 from jsDelivr) |
| `assets/shirt.glb` | raglan tee + hanger (meshopt-compressed) |
| `assets/pattern.json` | pattern pieces |
| `src/auth.js` | Invite-only AuthService (Supabase functions) + plan helpers |
| `src/app.js`, `src/index.src.html`, `src/build.py` | edit here, then `python3 src/build.py` |
| `blender/` | Blender pipeline |

## Run locally
```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
(macOS: double-click `start.command`.)


### Build marker
`FB-INVITE-V1` — invite-only access (request / approve / reject).
