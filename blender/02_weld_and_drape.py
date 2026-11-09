# Fashion Builder - step 2: freeze the sewn shirt (stage-1 frame), weld seams, pin shoulders on a fitted hanger, drape with gravity.
import bpy, bmesh, math
from mathutils import Vector

SEW_FRAME = 10
S = 0.01
sc = bpy.context.scene
src = bpy.data.objects['Shirt']
src.modifiers['Cloth'].show_viewport = True
src.hide_viewport = False
sc.frame_set(SEW_FRAME)
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(src.evaluated_get(dg))
me.name = 'ShirtSewn'
for o in [o for o in bpy.data.objects if o.name in ('ShirtSewn', 'Hanger', 'Hook')]:
    bpy.data.objects.remove(o, do_unlink=True)
src.hide_viewport = True; src.hide_render = True
src.modifiers['Cloth'].show_viewport = False

bm = bmesh.new(); bm.from_mesh(me)
face_edges = set(e for f in bm.faces for e in f.edges)
wire = [e for e in bm.edges if e not in face_edges]
seam_verts = set(v for e in wire for v in e.verts)
bmesh.ops.delete(bm, geom=wire, context='EDGES')
bmesh.ops.remove_doubles(bm, verts=list(seam_verts), dist=0.006)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me); bm.free()
for p in me.polygons:
    p.use_smooth = True
obj = bpy.data.objects.new('ShirtSewn', me)
sc.collection.objects.link(obj)

# ---------- pin group along the shoulder line ----------
body_v = set()
for p in me.polygons:
    if p.material_index == 0:
        body_v.update(p.vertices)
bins = {}
for i in body_v:
    co = me.vertices[i].co
    if abs(co.x) < 0.30:
        b = int(round(co.x/S))
        bins[b] = max(bins.get(b, -9), co.z)
pg = obj.vertex_groups.new(name='pin')
pinned = 0
for i in body_v:
    co = me.vertices[i].co
    ax = abs(co.x)/S
    if 9.5 < ax < 21.5:
        ztop = bins.get(int(round(co.x/S)), -9)
        dz = (ztop - co.z)/S
        if dz < 1.6:
            w = 1.0 if ax < 19.5 else (21.5 - ax)/2.0
            pg.add([i], max(0.0, w), 'REPLACE'); pinned += 1

# ---------- hanger fitted under the shoulder line ----------
def ztop_at(xcm):
    ks = [k for k in bins if abs(k - xcm) <= 1]
    return max(bins[k] for k in ks)/S if ks else None

def tube(name, path, r, seg=14, flat=1.0):
    bmt = bmesh.new(); rings = []
    for i, p in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(i+1, len(path)-1)]) - Vector(path[max(i-1, 0)])).normalized()
        n1 = t.cross(Vector((0, 1, 0)))
        if n1.length < 1e-4:
            n1 = t.cross(Vector((1, 0, 0)))
        n1.normalize(); n2 = t.cross(n1).normalized()
        rings.append([bmt.verts.new(p + n1*math.cos(2*math.pi*k/seg)*r + n2*math.sin(2*math.pi*k/seg)*r*flat) for k in range(seg)])
    for i in range(len(rings)-1):
        for k in range(seg):
            bmt.faces.new((rings[i][k], rings[i][(k+1) % seg], rings[i+1][(k+1) % seg], rings[i+1][k]))
    bmt.faces.new(rings[0][::-1]); bmt.faces.new(rings[-1])
    m = bpy.data.meshes.new(name); bmt.to_mesh(m); bmt.free()
    o = bpy.data.objects.new(name, m); sc.collection.objects.link(o)
    for p in m.polygons:
        p.use_smooth = True
    return o

R = 1.0
pts = []
zc = None
for i in range(81):
    x = -22.5 + 45*i/80
    ax = abs(x)
    if ax > 10:
        z = ztop_at(x) - R - 0.35
    else:
        z10 = ztop_at(10.5 if x >= 0 else -10.5) - R - 0.35
        z = z10 + (10 - ax)*0.12 + 0.35*math.cos(ax/10*math.pi/2)
    pts.append((x*S, 0.0, z*S))
    if abs(x) < 0.3:
        zc = z
hanger = tube('Hanger', pts, R*S, 16, 0.55)
hk = []
for i in range(9):
    hk.append((0, 0, (zc + 9.0*i/8)*S))
for i in range(1, 24):
    a = math.pi*1.3*i/23
    hk.append((2.8*S*(1-math.cos(a)), 0, (zc + 9.0 + 2.8*math.sin(a))*S))
hook = tube('Hook', hk, 0.3*S, 10)
hanger.modifiers.new('Collision', 'COLLISION')
hanger.collision.thickness_outer = 0.003
hanger.collision.cloth_friction = 30

# ---------- drape sim ----------
sc.frame_start = 1; sc.frame_end = 70
cm = obj.modifiers.new('Cloth', 'CLOTH')
cs = cm.settings
cs.quality = 10
cs.mass = 0.16
cs.air_damping = 3.0
cs.tension_stiffness = 30; cs.compression_stiffness = 30
cs.shear_stiffness = 12; cs.bending_stiffness = 8.0
cs.tension_damping = 8; cs.compression_damping = 8; cs.shear_damping = 8
cs.bending_damping = 0.8
cs.vertex_group_mass = 'pin'
cs.pin_stiffness = 5
cs.use_pressure = True
cs.uniform_pressure_force = 0.7
cs.effector_weights.gravity = 1.0
cc = cm.collision_settings
cc.use_collision = True; cc.distance_min = 0.003
cc.use_self_collision = True; cc.self_distance_min = 0.0025
cc.collision_quality = 4
cm.point_cache.frame_start = 1; cm.point_cache.frame_end = 70
sc.frame_set(1)
result = {'verts': len(me.vertices), 'faces': len(me.polygons), 'pinned': pinned, 'seamverts': len(seam_verts), 'hangerZc': round(zc, 2)}
