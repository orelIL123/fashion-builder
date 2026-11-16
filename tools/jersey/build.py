# Football jersey: run inside Blender 4.2 (background):  JERSEY_OUT=/tmp/jersey blender -b -P tools/jersey/build.py
# 01 drafts the 5 pieces (front, back, 2 set-in short sleeves, collar), meshes + sews them; 02 welds and drapes on a hanger;
# 03 smooths, adds thickness and exports the GLB. Then: npx gltf-transform meshopt jersey_raw.glb assets/jersey/jersey.glb
import bpy, os, sys
H = os.path.dirname(os.path.abspath(__file__))
def run(name):
    g = {'__name__': '__main__', '__file__': os.path.join(H, name)}
    exec(compile(open(os.path.join(H, name)).read(), name, 'exec'), g); print(name, g.get('result')); sys.stdout.flush()
sc = bpy.context.scene
run('01_build_pattern.py')
for f in range(1, 11): sc.frame_set(f)
run('02_weld_and_drape.py')
for f in range(1, 61): sc.frame_set(f)
run('03_finalize_export.py')
