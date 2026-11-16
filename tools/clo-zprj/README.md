# CLO 3D project (.zprj) → Stylooks garment

Builds `assets/jersey-raglan/` (`?g=raglanjersey`) and `assets/jersey-setin/` (`?g=setinjersey`) straight from the CLO project
files, without CLO. A `.zprj` is a zip (behind a short CLO header) holding a `.zpac`, which is again a zip holding the garment
`.pac`. The `.pac` is a tagged binary tree (`pac.py` reads it); every pattern piece carries its flat 2D mesh (`baRest`, mm),
the draped 3D position of each of those vertices (`baPosition3D`, mm, Y up, front +Z) and the triangles (`baTri`).

1. `build_a.py` takes the pieces named in `<garment>.json` (inner facings and every fabric, print, graphic, logo and trim are
   left out — the garment ships plain white), pulls the seam edges of neighbouring pieces together in 3D (seams close to <0.1 mm),
   packs the flat pieces at true size on a 128 cm sheet (CLO orientation, outside view) and writes an OBJ + `pattern.json`.
2. `build_b.py` (Blender 4.2) lightly smooths the simulation noise (seams pinned), decimates by half, adds 2.2 mm cloth
   thickness with rims and the `_INSIDE` attribute, and exports a GLB; `gltf-transform meshopt` compresses it.

```bash
BLENDER=/path/to/blender PY=python-with-scipy tools/clo-zprj/build.sh raglanjersey raglan.zprj assets/jersey-raglan
BLENDER=/path/to/blender PY=python-with-scipy tools/clo-zprj/build.sh setinjersey setin.zprj assets/jersey-setin
python3 clo_load.py file.zprj   # list the pieces of any CLO project (name, layer, size, 3D position)
```
To add another CLO garment: list its pieces with `clo_load.py`, write a `<id>.json` (ids `front`, `back`, `sleeveR`/`sleeveL`
= wearer's side, `rib` for a collar, `cuff…` labels for cuffs), run `build.sh`, and add a GARMENTS entry in `src/app.js`.
