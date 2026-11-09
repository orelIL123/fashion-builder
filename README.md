# Fashion Builder

A garment editor in the browser: a sewing-pattern sheet and a live 3D shirt side by side. Place a print on a pattern piece (or drag it directly on the 3D shirt) and it lands exactly there on the garment, because the 3D mesh's UVs *are* the sewing pattern.

**Live:** open `index.html` through any web server (GitHub Pages, or `start.command` locally).

## Features
- **Views:** Sewing pattern · Split · 3D, outside / inside pattern sides, front / back / side cameras, auto-rotate
- **Design:** image and text layers, inside prints (neck label), solid or gradient fabric colour, rib colour, washes (acid, caustic, vintage, tie-dye)
- **Appearance:** material presets (cotton, heavyweight, fleece, piqué, poly), fold shadows (GTAO), wrinkles, knit texture, knit size, brightness, contrast
- **Scene:** studio environment light, key light angle, backdrop colours, projected backdrop light (leaf, palm, blinds, window), hanger colours
- **Export:** catalogue render, print files (ZIP), sublimation panels with 1 cm bleed (ZIP), spec sheet, 360° turntable video
- Undo / redo, paste images with ⌘V, drag and drop

## How the 3D shirt looks real
1. **A real garment mesh** made from sewn pattern pieces (CLO / Marvelous style), not an AI-generated scan.
2. **UV islands = pattern pieces**, so the 2048 px print sheet maps 1:1 onto the fabric. `assets/pattern.json` holds the piece outlines read from those islands.
3. **Fabric shading:** MeshPhysicalMaterial with sheen, a tiling knit normal map, a ridged-noise crumple normal, and per-piece rib texture.
4. **Studio look:** environment lighting, a spotlight projecting a gobo onto the backdrop with soft VSM shadows, GTAO ambient occlusion, neutral tone mapping.

## Layout
| Path | What |
|---|---|
| `index.html` | built app (three.js r170 from jsDelivr) |
| `assets/shirt.glb` | raglan tee + fitted hanger (meshopt-compressed) |
| `assets/pattern.json` | pattern pieces (sheet cm, per-piece scale) |
| `assets/fb/` | alternative oversized tee, cloth-simulated from scratch in Blender |
| `src/` | `app.js`, `index.src.html`, `build.py` — edit here, then `python3 src/build.py` |
| `blender/` | Blender pipeline: build pattern → sew + drape → smooth + export |

## Run locally
```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
(macOS: double-click `start.command`.)
