# Fashion Builder

A garment editor in the browser: a sewing-pattern sheet and a live 3D shirt side by side. Place a print on a pattern piece (or drag it directly on the 3D shirt) and it lands exactly there on the garment, because the 3D mesh's UVs *are* the sewing pattern.

**Live:** https://orelil123.github.io/fashion-builder/

Marker: `FB-BETA-V1` (in page source).

## Features

- **Brush paint** on 2D pattern pieces and on the 3D shirt (UV-mapped). Color, size, opacity, hardness, eraser, clear.
- **Paint over anything:** brush strokes always land on top of the photos and text already on the garment (a new paint layer is started when a photo sits above the old one).
- **Remove background:** one click on an image layer makes its plain backdrop transparent (runs in the browser, with a tolerance slider and Restore). Best for logos and product shots on a flat background.
- **Front ↔ Back dragging**: artwork layers can be dragged across packed pattern pieces (and across the 3D garment). Use **→ Front / → Back** as a shortcut.

- **Views:** Sewing pattern · Split · 3D, outside / inside pattern sides, front / back / side cameras, auto-rotate
- **Pattern table:** tool rail (select · pan · photo · text · brush), mm / cm / inch, zoom bar, and a **Trims** switch that also lays out the small pieces (inner hems and cuffs, facings, neck tapes) so every printable area of the 3D garment can be reached in 2D
- **Size chart:** a graded spec for the factory — 13 points of measure (A–M) measured from the pattern, XS–3XL, tolerances, grade rules, cm / inch, every cell editable, exports to CSV / PNG and is added to the print ZIP
- **Garments:** a garment picker on the 3D pane (`?g=<id>`), driven by a small registry in `src/app.js`
- **Design:** image and text layers on the **2D pattern map** (and 3D), click-to-place, opacity, flip, rotate handle, lock/duplicate/reorder, 35 fonts (incl. Hebrew), inside prints (neck label), solid or gradient fabric colour, rib colour, washes, save/load in browser
- **Export:** 3D PNG (catalogue / dark / transparent), 2D pattern PNG + SVG, print files (ZIP), sublimation panels, spec sheet, **360° turntable video (~5s, MP4 / H.264 when the browser can record it, WebM otherwise)** (Pro). Free-plan image exports carry a small Stylooks logo watermark (bottom-right, on its own footer strip on the pattern sheet so it never covers a piece); beta testers get no watermark.
- **Access:** Beta gate — testers enter with an **email + one-time access code**. Approved testers get full editor features (all fonts, no watermark, video, up to 50 saved designs). A header note says **Currently free — pricing may change at any time / כרגע חינם — ייתכנו שינויים בכל עת**. The old invite-approval flow stays behind `ACCESS_GATE` (still `false`).

Turntable video is recorded in-browser (2D mirror of the WebGL canvas + `captureStream(0)` / `requestFrame`). MP4 (`avc1`) is preferred because it plays everywhere (Facebook, Instagram, iPhone); browsers that cannot record MP4 fall back to WebM (VP9 / VP8), which may omit duration metadata but still plays. The recorder runs on wall-clock time, so on a very slow GPU (software rendering) the clip comes out longer than 5 s.

`tests/exports_visual_test.py` writes every export to `FB_OUT` (pattern PNG/SVG, catalogue, spec sheet, both ZIPs, the video and four frames from it); `FB_WATERMARK=1` forces the free-plan watermark on.

## Beta access
The landing screen is labelled **גרסת בטא / Beta version**. A tester enters their email and a one-time access code (`FB-XXXX-XXXX`).

1. Edge Function `redeem-code` binds an unused code to that email and marks it `used`. The same email + code can sign back in later (a new session token is issued). Any other email is rejected.
2. The browser stores only the email and a session token. On every load, `validate-session` re-checks the code server-side. If the owner has **revoked** the code, the tester is blocked.
3. The owner manages codes at [`admin.html`](https://orelil123.github.io/fashion-builder/admin.html) (protected by an admin key, not in this repo). Actions: list, revoke, restore, generate a new code.

Codes are stored as SHA-256 hashes in `public.fb_beta_codes` (RLS on, no anon access). Plaintext codes are never kept in the database.

**Supabase:** project `orelIL123's Project` (ref `ilekmrkcsopsxckxefns`, org TooLive). Fashion Builder tables/functions are isolated (`public.fb_beta_*`, `public.fb_access_requests` + `redeem-code` / `validate-session` / `admin-codes`, and the older invite functions). This project already hosted another app; a brand-new Supabase project was quoted at $10/month, so this one was reused.

The previous invite-approval flow (`ACCESS_GATE`, `request-access` / `decide` / `check-status`) is still in the repo but **off**.

**Limitations**
- This is still a static GitHub Pages app: a determined user can hide the overlay with DevTools. They cannot mint a valid session or un-revoke a code without the server.
- Saved designs still live in the browser, not in the cloud.
- Paid plans are hidden (code kept). Planned later: ~₪30/month.
- Testers are not emailed a confirmation; they keep the code they were given.

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

## Hoodie (third garment, `?g=hoodie`)
`assets/hoodie/hoodie.glb` + `assets/hoodie/pattern.json` come from a 3D **scan** (1.5M triangles, closed shell with an outer and an inner surface, a scan UV atlas of ~7,000 islands), not from a sewing pattern. `tools/hoodie-from-scan/` turns it into a garment the editor can use (`pip install fast-simplification trimesh embreex libigl shapely networkx scipy pillow`, then run `s1` … `s6` in order (s1 also writes `main.npz`, the largest connected shell), `HOODIE_OBJ=<scan.obj>`):

1. `s1_decimate.py` — fast_simplification to 100k triangles (metres, y up, front +z).
2. `s2_segment.py`, `s3b_layers.py`, `s3c_thickness.py` — keep only the **outer** fabric surface: an escape-ray visibility test plus "normal points away from the body / sleeve / hood axis". The lining is dropped; the app draws the garment double-sided and shows the inside print on the back faces, as with the tees.
3. `s4_label.py` — pieces: multi-seed Dijkstra over the face graph with a crease penalty (body / sleeves / hood / drawstrings), shell thickness for the drawstrings, hem band = bottom 5.7 cm, cuffs = last 6.6 cm of each sleeve, front / back split at the side seams.
4. `s5_flatten.py` — sleeves and cuffs are cut open along the underarm (shortest path between the two rims), every piece is flattened with **LSCM** and relaxed with ARAP at true scale (area error within ±5 % for 90 % of the triangles, no flipped triangles on the main pieces).
5. `s6_pack_export.py` — pieces packed on the print sheet (1 cm apart), outlines traced, GLB written (fabric + rib meshes) and compressed with meshopt (`npx gltf-transform meshopt`).

Result: 12 pieces — Front (pocket included), Back, Right / Left sleeve, Hood · right / left, Hem band · front / back, Right / Left cuff, Drawstring · right / left (the drawstrings are under **Trims**). 46k triangles, 378 KB.

**Print sheet is 164 cm, not 128 cm:** the hoodie has 1.63 m² of fabric and a 128 cm sheet is only 1.64 m², so the pieces cannot fit at true size. Scaling them down would make every print size in cm wrong, so the sheet grows instead (2624 px at 16 px/cm).

**Size chart:** defaults to *Standard · hoodie (Gildan 18500)* — chest, body length (HPS) and centre-back sleeve are the official published values; the other points are measured from the hoodie's own pattern pieces.

**Known limits:** piece edges follow the scan's triangles, so outlines are a little ragged on the 2D table; the kangaroo pocket is part of the front piece (it is fused to the front in the scan); the drawstrings are flattened as half tubes.

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
| `assets/hoodie/` | pullover hoodie (third garment, from a 3D scan) — `tools/hoodie-from-scan/` rebuilds it |
| `assets/vendor/` | three.js r170 bundle (MIT) and JSZip (MIT / GPLv3) |
| `src/vendor/` | entry file + script that rebuild the three.js bundle |
| `tests/` | Playwright checks (`speed_coverage_sizechart_test.py` covers speed, dead zones and the size chart) |
| `src/auth.js` | AuthService (plans + beta gate; invite leftovers behind `ACCESS_GATE`)
| `admin.html` | Owner admin for beta codes | |
| `src/app.js`, `src/index.src.html`, `src/build.py` | edit here, then `python3 src/build.py` |
| `blender/` | Blender pipeline |

## Run locally
```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
(macOS: double-click `start.command`.)


### Build marker
`FB-BETA-V1` — beta gate on (email + one-time code); invite `ACCESS_GATE` is still off.
