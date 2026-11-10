# Fashion Builder

A garment editor in the browser: a sewing-pattern sheet and a live 3D shirt side by side. Place a print on a pattern piece (or drag it directly on the 3D shirt) and it lands exactly there on the garment, because the 3D mesh's UVs *are* the sewing pattern.

**Live:** https://orelil123.github.io/fashion-builder/

Marker: `FB-OPEN-V1` (in page source).

## Features

- **Brush paint** on 2D pattern pieces and on the 3D shirt (UV-mapped). Color, size, opacity, hardness, eraser, clear.
- **Front ↔ Back dragging**: artwork layers can be dragged across packed pattern pieces (and across the 3D garment). Use **→ Front / → Back** as a shortcut.

- **Views:** Sewing pattern · Split · 3D, outside / inside pattern sides, front / back / side cameras, auto-rotate
- **Pattern table:** tool rail (select · pan · photo · text · brush), mm / cm / inch, zoom bar, and a **Trims** switch that also lays out the small pieces (inner hems and cuffs, facings, neck tapes) so every printable area of the 3D garment can be reached in 2D
- **Size chart:** a graded spec for the factory — 13 points of measure (A–M) measured from the pattern, XS–3XL, tolerances, grade rules, cm / inch, every cell editable, exports to CSV / PNG and is added to the print ZIP
- **Garments:** a garment picker on the 3D pane (`?g=<id>`), driven by a small registry in `src/app.js`
- **Design:** image and text layers on the **2D pattern map** (and 3D), click-to-place, opacity, flip, rotate handle, lock/duplicate/reorder, 35 fonts (incl. Hebrew), inside prints (neck label), solid or gradient fabric colour, rib colour, washes, save/load in browser
- **Export:** 3D PNG (catalogue / dark / transparent), 2D pattern PNG + SVG, print files (ZIP), sublimation panels, spec sheet, **360° turntable video (~5s WebM/MP4)** (Pro)
- **Access:** Currently open to everyone, with full editor features (all fonts, no watermark, video, up to 50 saved designs). A small header note says **Currently free — pricing may change at any time / כרגע חינם — ייתכנו שינויים בכל עת**. Invite-only code is kept behind `ACCESS_GATE` in `src/auth.js` (set to `true` to require approval again).

Turntable video is recorded in-browser (2D mirror of the WebGL canvas + `captureStream(0)` / `requestFrame`). Some browsers omit duration metadata on the WebM; the file still plays.

## Invite-only access
**Currently off.** `ACCESS_GATE` in `src/auth.js` is `false`, so the editor opens immediately with Pro-equivalent features and ignores any stale invite session in `localStorage`. Set it to `true` and rebuild to require approval again.

When the gate is on, the editor is blocked until a request is **approved server-side** (not just in `localStorage`).

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

## Speed
- **One local request for the 3D runtime.** three.js r170 and the eight add-ons the app uses are tree-shaken into `assets/vendor/three.fb.min.js` (≈165 KB gzipped) and preloaded, instead of ~20 unbundled module requests to a CDN. JSZip is local too and only loads when a ZIP is exported.
- **Nothing blocks the first frame.** The font stylesheet is non-blocking and faces download only when used; the access check runs in parallel with the editor boot; the garment download starts from the `<head>`.
- **Render on demand.** The 3D view draws only when the camera, the artwork or a control changes — an idle tab uses no GPU. *Adaptive* quality drops the fold-shadow (AO) pass while the camera moves on GPUs that cannot hold ~40 fps, and adds it back on the first still frame.
- **Cheap edits.** The print sheet is composed at most once per frame; the fabric base and the wash are cached; only the side (outside / inside) that changed is repainted and re-uploaded; undo snapshots reuse the encoded brush layer.

## Dead zones
`repairCoverage()` runs when a garment loads: every mesh triangle whose UVs fall outside the traced pattern outlines is added to the printable area, and the whole sheet is primed with the fabric colour. On the raglan tee that was 659 triangles (≈71 cm² of neck / raglan seam tape) that used to render black and could not be painted. The Scene tab's Spec box reports the result. Brush strokes no longer drag a streak across the print sheet when they cross a seam.

## Adding a garment
1. Export a GLB whose UV islands are the pattern pieces (meshopt compression is supported) and a `pattern.json` with the piece outlines (`blender/` has the pipeline).
2. Put both in `assets/<id>/` and add one entry to `GARMENTS` at the top of `src/app.js` (`name`, `sub`, `glb`, `pattern`, `sleeve: 'raglan' | 'set-in'`).
3. `python3 src/build.py`. The garment appears in the picker; the size chart measures it from its outlines (`front`, `back`, `sleeveR/L`, `rib`, and pieces labelled *Hem band* / *cuff* when present).

## Vendored libraries
`assets/vendor/three.fb.min.js` is built from `src/vendor/three-entry.js`. If `app.js` starts using a `THREE.*` name that is not exported there, `build.py` stops and names it: add it to the entry file and run `src/vendor/build.sh` (needs Node 18+).

## How the 3D shirt looks real
1. **A real garment mesh** made from sewn pattern pieces (CLO / Marvelous style), not an AI-generated scan.
2. **UV islands = pattern pieces**, so the 2048 px print sheet maps 1:1 onto the fabric. `assets/pattern.json` holds the piece outlines.
3. **Fabric shading:** MeshPhysicalMaterial with sheen, knit normal, crumple normal, per-piece rib texture.
4. **Studio look:** environment lighting, gobo spotlight, GTAO, neutral tone mapping.

## Layout
| Path | What |
|---|---|
| `index.html` | built app |
| `assets/shirt.glb`, `assets/pattern.json` | raglan tee + hanger (meshopt-compressed) and its pattern pieces |
| `assets/fb/` | oversized tee (second garment) |
| `assets/vendor/` | three.js r170 bundle (MIT) and JSZip (MIT / GPLv3) |
| `src/vendor/` | entry file + script that rebuild the three.js bundle |
| `tests/` | Playwright checks (`speed_coverage_sizechart_test.py` covers speed, dead zones and the size chart) |
| `src/auth.js` | AuthService (plans + optional invite gate via `ACCESS_GATE`) |
| `src/app.js`, `src/index.src.html`, `src/build.py` | edit here, then `python3 src/build.py` |
| `blender/` | Blender pipeline |

## Run locally
```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
(macOS: double-click `start.command`.)


### Build marker
`FB-OPEN-V1` — editor is open to everyone; invite gate is off (`ACCESS_GATE=false`).
