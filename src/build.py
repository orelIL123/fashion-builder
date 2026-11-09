import os, json, base64
H = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(H)
s = open(os.path.join(H, 'index.src.html')).read()
p = json.dumps(json.load(open(os.path.join(R, 'assets/pattern.json'))), separators=(',', ':'))
auth = open(os.path.join(H, 'auth.js')).read()
js = open(os.path.join(H, 'app.js')).read().replace('__PATTERN__', p)
# Bundle auth service ahead of the app (single ES module for GitHub Pages)
bundled = auth + '\n' + js
s = s.replace('__SCRIPT__', '<script type="module">\n' + bundled + '\n</script>')
glb = base64.b64encode(open(os.path.join(R, 'assets/shirt.glb'), 'rb').read()).decode()
open(os.path.join(H, 'index.artifact.html'), 'w').write(
    s.replace('<script type="module">', '<script>window.__GLB_B64="' + glb + '";</script>\n<script type="module">', 1)
)
open(os.path.join(R, 'index.html'), 'w').write(
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + s.replace('<div class="app">', '</head><body>\n<div class="app">', 1)
    + '\n</body></html>\n'
)
print('built index.html + index.artifact.html')
