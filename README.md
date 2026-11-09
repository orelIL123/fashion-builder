# Fashion Builder

A garment editor in the browser: a sewing-pattern sheet and a live 3D shirt side by side. Place a print on a pattern piece (or drag it directly on the 3D shirt) and it lands exactly there on the garment, because the 3D mesh's UVs *are* the sewing pattern.

**Live:** https://orelil123.github.io/fashion-builder/

Marker: `FB-SAAS-V1` (in page source).

## Features
- **Views:** Sewing pattern · Split · 3D, outside / inside pattern sides, front / back / side cameras, auto-rotate
- **Design:** image and text layers on the **2D pattern map** (and 3D), click-to-place, opacity, flip, rotate handle, lock/duplicate/reorder, 35 fonts (incl. Hebrew), inside prints (neck label), solid or gradient fabric colour, rib colour, washes, save/load in browser
- **Export:** 3D PNG (catalogue / dark / transparent), 2D pattern PNG + SVG, print files (ZIP), sublimation panels, spec sheet, **360° turntable video (~5s WebM/MP4)** (Pro)
- **SaaS (front-end demo):** Free vs Pro (₪40/mo), sign up / log in, access codes, plan-gated fonts / layers / video / watermark

## Plans (demo, client-side)
| | Free | Pro · ₪40/mo |
|---|---|---|
| Layers | 3 | Unlimited |
| Fonts | 6 starters (incl. Hebrew) | All 35 |
| Exports | PNG/SVG with watermark | No watermark |
| Video | — | Turntable WebM/MP4 |
| Saves | 1 in this browser | Up to 50 named designs |

**Demo access codes** (unlock Pro without payment): `PRO40`, `FRIENDS`, `DEMO40`

Turntable video is recorded in-browser (2D mirror of the WebGL canvas + `captureStream(0)` / `requestFrame`). Some browsers omit duration metadata on the WebM; the file still plays.

Payments are **not** connected yet — the Subscribe button shows “Payments coming soon”. Redeem a code instead.

### Auth security note
This is a **demo only**. Accounts live in `localStorage` on the user’s device. Passwords are never stored in plain text (SHA-256 + random salt via SubtleCrypto), but there is **no server**, so this is **not** secure authentication. Anyone with DevTools can bypass plan checks. Treat codes and “Pro” as a UX prototype.

### Swapping in real auth + billing later
Auth/plan logic lives in `src/auth.js` as `AuthService`. Keep the same surface (`signup`, `login`, `logout`, `getPlan`, `redeemCode`, `canUseFont`, …) and replace the localStorage backend with:

1. **Supabase Auth** — email/password (or magic link); store `plan` on `profiles` / `subscriptions`.
2. **Billing** — Stripe, Tranzila, or PayPlus checkout; webhook → set `plan='pro'` until `current_period_end`.
3. **Access codes** — server table of one-time/multi-use codes; redeem via Edge Function.
4. **Design library** — move saved designs from localStorage to a `designs` table (RLS by `user_id`).

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
| `src/auth.js` | Auth / plan service (swap for Supabase later) |
| `src/app.js`, `src/index.src.html`, `src/build.py` | edit here, then `python3 src/build.py` |
| `blender/` | Blender pipeline |

## Run locally
```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
(macOS: double-click `start.command`.)
