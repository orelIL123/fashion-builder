import os, json, base64, re, sys
H = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(H)
s = open(os.path.join(H, 'index.src.html')).read()
p = json.dumps(json.load(open(os.path.join(R, 'assets/pattern.json'))), separators=(',', ':'))
auth = open(os.path.join(H, 'auth.js')).read()
app = open(os.path.join(H, 'app.js')).read()

# three.js is vendored as ONE tree-shaken file (assets/vendor/three.fb.min.js). Fail loudly if app.js starts using
# something the bundle does not export, instead of shipping a page that dies at runtime.
entry = open(os.path.join(H, 'vendor/three-entry.js')).read()
exported = set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', ' '.join(re.findall(r'export\s*\{([^}]*)\}', entry))))
used = set(re.findall(r'THREE\.([A-Za-z_][A-Za-z0-9_]*)', app))
for names in re.findall(r"import\s*\{([^}]*)\}\s*from\s*'three'", app):
    used |= set(n.strip() for n in names.split(',') if n.strip())
missing = sorted(used - exported)
if missing:
    sys.exit('three.js vendor bundle is missing: ' + ', '.join(missing)
             + '\nAdd them to src/vendor/three-entry.js and rebuild the bundle (see README, "Vendored libraries").')

js = app.replace('__PATTERN__', p)
# Bundle auth service ahead of the app (single ES module for GitHub Pages)
bundled = auth + '\n' + js
s = s.replace('__SCRIPT__', '<script type="module">\n' + bundled + '\n</script>')

# Single-file variant (index.artifact.html): garment and three.js inlined, nothing fetched from this repo.
glb = base64.b64encode(open(os.path.join(R, 'assets/shirt.glb'), 'rb').read()).decode()
three = base64.b64encode(open(os.path.join(R, 'assets/vendor/three.fb.min.js'), 'rb').read()).decode()
art = s.replace('"./assets/vendor/three.fb.min.js"', '"data:text/javascript;base64,' + three + '"')
logo = base64.b64encode(open(os.path.join(R, 'assets/logo-dark.png'), 'rb').read()).decode()
art = art.replace('./assets/logo-dark.png', 'data:image/png;base64,' + logo)
art = art.replace('<link rel="modulepreload" href="./assets/vendor/three.fb.min.js">\n', '')
art = art.replace("'assets/vendor/jszip.min.js'", "'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'")
open(os.path.join(H, 'index.artifact.html'), 'w').write(
    art.replace('<script type="module">', '<script>window.__GLB_B64="' + glb + '";</script>\n<script type="module">', 1)
)
open(os.path.join(R, 'index.html'), 'w').write(
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<link rel="icon" type="image/png" href="./assets/favicon.png">\n'
    + s.replace('<div class="app">', '</head><body>\n<div class="app">', 1)
    + '\n</body></html>\n'
)
print('built index.html + index.artifact.html')
