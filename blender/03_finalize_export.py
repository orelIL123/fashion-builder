# Fashion Builder - step 3: bake drape result, smooth, add thickness, export GLB (shirt + hanger + hook).
import bpy, bmesh

FRAME = 60
OUT = "/Users/x/Desktop/Fashion_Builder/assets/shirt.glb"
sc = bpy.context.scene
src = bpy.data.objects['ShirtSewn']
sc.frame_set(FRAME)
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(src.evaluated_get(dg))
old = bpy.data.objects.get('ShirtFinal')
if old:
    bpy.data.objects.remove(old, do_unlink=True)
obj = bpy.data.objects.new('ShirtFinal', me)
sc.collection.objects.link(obj)
obj.vertex_groups.clear() if hasattr(obj.vertex_groups, 'clear') else None
src.hide_viewport = True; src.hide_render = True

# shoulder-line group: the welded shoulder seams sit on the hanger and pick up a sawtooth; smooth them hard
S = 0.01
top = {}
for v in me.vertices:
    b = int(round(v.co.x/S)); top[b] = max(top.get(b, -9), v.co.z)
vg = obj.vertex_groups.new(name='shoulder')
for v in me.vertices:
    ax = abs(v.co.x)/S
    if ax < 31:
        dz = (top[int(round(v.co.x/S))] - v.co.z)/S
        if dz < 3.0:
            vg.add([v.index], max(0.0, 1.0 - dz/3.0), 'REPLACE')
# refit hanger + hook under the settled shoulder line
import math
from mathutils import Vector
def tube(name, path, r, seg=16, flat=1.0):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    bmt = bmesh.new(); rings = []
    for i, p in enumerate(path):
        p = Vector(p); t = (Vector(path[min(i+1, len(path)-1)]) - Vector(path[max(i-1, 0)])).normalized()
        n1 = t.cross(Vector((0, 1, 0)))
        if n1.length < 1e-4: n1 = t.cross(Vector((1, 0, 0)))
        n1.normalize(); n2 = t.cross(n1).normalized()
        rings.append([bmt.verts.new(p + n1*math.cos(2*math.pi*k/seg)*r + n2*math.sin(2*math.pi*k/seg)*r*flat) for k in range(seg)])
    for i in range(len(rings)-1):
        for k in range(seg):
            bmt.faces.new((rings[i][k], rings[i][(k+1) % seg], rings[i+1][(k+1) % seg], rings[i+1][k]))
    bmt.faces.new(rings[0][::-1]); bmt.faces.new(rings[-1])
    m = bpy.data.meshes.new(name); bmt.to_mesh(m); bmt.free()
    o = bpy.data.objects.new(name, m); sc.collection.objects.link(o)
    for p in m.polygons: p.use_smooth = True
    mat = bpy.data.materials.get('HangerMat') or bpy.data.materials.new('HangerMat'); m.materials.append(mat)
    return o
def top_at(xcm):
    ks = [k for k in top if abs(k - xcm) <= 3]
    return sum(top[k] for k in ks)/len(ks)/S
R = 0.9; pts = []; zc = None
for i in range(81):
    x = -21 + 42*i/80
    z = top_at(x) - R - 1.0
    pts.append((x*S, 0.0, z*S))
    if abs(x) < 0.3: zc = z
pts = [(p[0], p[1], sum(q[2] for q in pts[max(0,i-4):i+5])/len(pts[max(0,i-4):i+5])) for i, p in enumerate(pts)]
zc = pts[40][2]/S
tube('Hanger', pts, R*S, 16, 0.55)
hk = [(0, 0, (zc + 9.0*i/8)*S) for i in range(9)]
for i in range(1, 24):
    a = math.pi*1.3*i/23
    hk.append((2.8*S*(1-math.cos(a)), 0, (zc + 9.0 + 2.8*math.sin(a))*S))
tube('Hook', hk, 0.3*S, 10)
sh = obj.modifiers.new('ShoulderSmooth', 'SMOOTH'); sh.factor = 1.0; sh.iterations = 25; sh.vertex_group = 'shoulder'
# light relax to remove sim jitter, keep big folds
lap = obj.modifiers.new('Lap', 'LAPLACIANSMOOTH')
lap.lambda_factor = 1.2; lap.lambda_border = 0.0; lap.iterations = 6; lap.use_volume_preserve = True; lap.use_normalized = True
sm = obj.modifiers.new('Smooth', 'SMOOTH'); sm.factor = 0.6; sm.iterations = 6
sub = obj.modifiers.new('Sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
sol = obj.modifiers.new('Thick', 'SOLIDIFY'); sol.thickness = 0.0022; sol.offset = -1.0
sol.use_rim = True; sol.material_offset = 0; sol.material_offset_rim = 0
sol.use_even_offset = True
for p in me.polygons:
    p.use_smooth = True

for o in bpy.data.objects:
    o.select_set(False)
for n in ('ShirtFinal', 'Hanger', 'Hook'):
    bpy.data.objects[n].select_set(True)
bpy.context.view_layer.objects.active = obj
for n in ('Hanger', 'Hook'):
    h = bpy.data.objects[n]
    if not h.data.materials:
        m = bpy.data.materials.get('HangerMat') or bpy.data.materials.new('HangerMat')
        h.data.materials.append(m)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_texcoords=True, export_normals=True, export_materials='PLACEHOLDER')
import os
ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
result = {'bytes': os.path.getsize(OUT), 'verts': len(ev.vertices), 'tris': sum(len(p.vertices)-2 for p in ev.polygons)}
