# Fashion Builder - step 1: build sewing pattern pieces, mesh them, add sewing springs + hanger, set up cloth sim.
# All pattern units are cm. Blender units are meters (x0.01).
import bpy, bmesh, math, json, os
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

OUT = "/Users/x/Desktop/Fashion_Builder/assets"
os.makedirs(OUT, exist_ok=True)
H = 1.1          # target edge length (cm)
GAP = 3.0        # initial half-gap between front and back panels (cm)
S = 0.01         # cm -> m

# ---------- clean scene ----------
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    bpy.data.meshes.remove(m)

def ell(rx, ry, a0, a1, n=80):
    return [(rx*math.cos(a0+(a1-a0)*i/n), ry*math.sin(a0+(a1-a0)*i/n)) for i in range(n+1)]

def plen(p):
    return sum(math.dist(p[i], p[i+1]) for i in range(len(p)-1))

def resample(p, N):
    L = [0.0]
    for i in range(len(p)-1):
        L.append(L[-1] + math.dist(p[i], p[i+1]))
    out, j = [], 0
    for k in range(N+1):
        t = L[-1]*k/N
        while j < len(p)-2 and L[j+1] < t:
            j += 1
        seg = (L[j+1]-L[j]) or 1.0
        f = (t-L[j])/seg
        out.append((p[j][0]+(p[j+1][0]-p[j][0])*f, p[j][1]+(p[j+1][1]-p[j][1])*f))
    return out

# ---------- pattern (oversized drop-shoulder tee) ----------
def body(neck_depth):
    return [
        ('hem',   [(-30, -72), (30, -72)]),
        ('sideR', [(30, -72), (30, -26)]),
        ('armR',  [(30, -26), (30, -4)]),
        ('shR',   [(30, -4), (9, 0)]),
        ('neck',  ell(9, neck_depth, 0, -math.pi)),
        ('shL',   [(-9, 0), (-30, -4)]),
        ('armL',  [(-30, -4), (-30, -26)]),
        ('sideL', [(-30, -26), (-30, -72)]),
    ]

cap = [(u, 2.0*math.cos(math.pi*u/44)) for u in [22 - 44*i/60 for i in range(61)]]
def sleeve():
    return [
        ('cuff', [(-18, -22), (18, -22)]),
        ('ua',   [(18, -22), (22, 0)]),
        ('capF', cap[:31]),
        ('capB', cap[30:]),
        ('ub',   [(-22, 0), (-18, -22)]),
    ]

pieces = {'front': body(9.0), 'back': body(2.5), 'sleeveR': sleeve(), 'sleeveL': sleeve()}
lenF = plen(dict(pieces['front'])['neck']); lenB = plen(dict(pieces['back'])['neck'])
LrF, LrB, RH = 0.93*lenF, 0.93*lenB, 2.6
Lr = LrF + LrB
pieces['rib'] = [
    ('ribF', [(0, 0), (LrF, 0)]),
    ('ribB', [(LrF, 0), (Lr, 0)]),
    ('endB', [(Lr, 0), (Lr, RH)]),
    ('top',  [(Lr, RH), (0, RH)]),
    ('endA', [(0, RH), (0, 0)]),
]

seams = [
    (('front', 'shR'), ('back', 'shL')), (('front', 'shL'), ('back', 'shR')),
    (('front', 'sideR'), ('back', 'sideL')), (('front', 'sideL'), ('back', 'sideR')),
    (('sleeveR', 'capF'), ('front', 'armR')), (('sleeveR', 'capB'), ('back', 'armL')),
    (('sleeveL', 'capF'), ('front', 'armL')), (('sleeveL', 'capB'), ('back', 'armR')),
    (('sleeveR', 'ua'), ('sleeveR', 'ub')), (('sleeveL', 'ua'), ('sleeveL', 'ub')),
    (('rib', 'ribF'), ('front', 'neck')), (('rib', 'ribB'), ('back', 'neck')),
    (('rib', 'endA'), ('rib', 'endB')),
]

# segment sample counts (paired seams share N)
Nseg = {}
for pn, segs in pieces.items():
    h = 0.8 if pn == 'rib' else H
    for sn, pts in segs:
        Nseg[(pn, sn)] = max(2, math.ceil(plen(pts)/h))
for a, b in seams:
    n = max(Nseg[a], Nseg[b]); Nseg[a] = Nseg[b] = n

# ---------- sheet layout (128cm sheet, like a 2048px texture at 16px/cm) ----------
SHEET = 128.0
layout = {
    'front':   lambda x, y: (x + 32, y + 75),
    'back':    lambda x, y: (x + 96, y + 75),
    'sleeveR': lambda x, y: (x + 24, y + 102),
    'sleeveL': lambda x, y: (x + 72, y + 102),
    'rib':     lambda x, y: (x + 2,  y + 110),
}

# ---------- 3D placement ----------
neck3d = []  # filled after sampling
def place(pn, x, y):
    if pn == 'front':
        return Vector((x, -GAP, y))
    if pn == 'back':
        return Vector((-x, GAP, y))
    if pn in ('sleeveR', 'sleeveL'):
        s = 1 if pn == 'sleeveR' else -1
        t = min(max(-y/22.0, 0.0), 1.0)
        hw = 22 - 4*t
        k = hw/22.0
        th = math.pi*max(-1.0, min(1.0, x/hw))
        return Vector((s*(31 - y), -3.0*k*math.sin(th), -15 + 10.0*k*math.cos(th)))
    if pn == 'rib':
        f = min(max(x/Lr, 0.0), 1.0)
        L = neck3d_cum[-1]*f
        j = 0
        while j < len(neck3d)-2 and neck3d_cum[j+1] < L:
            j += 1
        seg = (neck3d_cum[j+1]-neck3d_cum[j]) or 1.0
        base = neck3d[j].lerp(neck3d[j+1], (L-neck3d_cum[j])/seg)
        inward = Vector((-base.x, -base.y, 0))
        if inward.length > 1e-6:
            inward.normalize()
        return base + Vector((0, 0, 0.8*y)) + inward*0.25*y

def inside(p, poly):
    x, y = p; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1) + x1:
            c = not c
    return c

def dseg(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx-ax, by-ay
    L2 = dx*dx+dy*dy or 1e-9
    t = max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L2))
    return math.hypot(px-(ax+t*dx), py-(ay+t*dy))

verts3d, uvs, faces, fmat, piece_of_face = [], [], [], [], []
seg_ids = {}
pattern_json = {'sheetCm': SHEET, 'pxPerCm': 16, 'pieces': []}
order = ['front', 'back', 'sleeveR', 'sleeveL', 'rib']
labels = {'front': 'Front', 'back': 'Back', 'sleeveR': 'Right sleeve', 'sleeveL': 'Left sleeve', 'rib': 'Neck rib'}

for pn in order:
    segs = pieces[pn]
    boundary, ranges = [], {}
    for sn, pts in segs:
        sp = resample(pts, Nseg[(pn, sn)])
        ranges[sn] = (len(boundary), len(sp))
        boundary.extend(sp[:-1])
    nb = len(boundary)
    if pn == 'back':  # neck loop for rib placement: front neck then back neck
        fr = seg_ids[('front', 'neck')]
        neck3d = [verts3d[i].copy()/S for i in fr]
        a, n = ranges['neck']
        bk = [place('back', *boundary[(a+i) % nb]) for i in range(n)]
        neck3d += bk[1:]
        neck3d_cum = [0.0]
        for i in range(len(neck3d)-1):
            neck3d_cum.append(neck3d_cum[-1] + (neck3d[i+1]-neck3d[i]).length)
    # interior hex grid
    h = 0.8 if pn == 'rib' else H
    xs = [p[0] for p in boundary]; ys = [p[1] for p in boundary]
    interior = []
    row = 0; y = min(ys) + h*0.5
    while y < max(ys):
        x = min(xs) + (h*0.5 if row % 2 else 0) + h*0.25
        while x < max(xs):
            if inside((x, y), boundary):
                d = min(dseg((x, y), boundary[i], boundary[(i+1) % nb]) for i in range(nb))
                if d > 0.55*h:
                    interior.append((x, y))
            x += h
        y += h*0.866; row += 1
    pts2 = boundary + interior
    cons_edges = [(i, (i+1) % nb) for i in range(nb)]
    vo, eo, fo, ov, oe, of = delaunay_2d_cdt([Vector(p) for p in pts2], cons_edges, [list(range(nb))], 1, 1e-6)
    inmap = {}
    for oi, lst in enumerate(ov):
        for ii in lst:
            inmap[ii] = oi
    base = len(verts3d)
    for v in vo:
        verts3d.append(place(pn, v.x, v.y)*S)
        sx, sy = layout[pn](v.x, v.y)
        uvs.append((sx/SHEET, sy/SHEET))
    for f in fo:
        faces.append([base+i for i in f])
        fmat.append(1 if pn == 'rib' else 0)
    for sn, (a, n) in ranges.items():
        seg_ids[(pn, sn)] = [base + inmap[(a+i) % nb] for i in range(n)]
    outline = [layout[pn](*boundary[i]) for i in range(nb)]
    pattern_json['pieces'].append({'id': pn, 'label': labels[pn],
        'outline': [[round(x, 2), round(y, 2)] for x, y in outline],
        'bbox': [min(p[0] for p in outline), min(p[1] for p in outline), max(p[0] for p in outline), max(p[1] for p in outline)]})

# ---------- sewing edges ----------
sew = set()
for a, b in seams:
    A, B = seg_ids[a], seg_ids[b]
    d1 = sum((verts3d[A[i]]-verts3d[B[i]]).length for i in range(len(A)))
    d2 = sum((verts3d[A[i]]-verts3d[B[-1-i]]).length for i in range(len(A)))
    if d2 < d1:
        B = B[::-1]
    for i in range(len(A)):
        if A[i] != B[i]:
            sew.add(tuple(sorted((A[i], B[i]))))

me = bpy.data.meshes.new('Shirt')
me.from_pydata([tuple(v) for v in verts3d], list(sew), faces)
me.update()
uvl = me.uv_layers.new(name='UVMap')
for poly in me.polygons:
    poly.material_index = fmat[poly.index]
    for li in poly.loop_indices:
        uvl.data[li].uv = uvs[me.loops[li].vertex_index]
for name, col in (('Body', (0.9, 0.9, 0.88, 1)), ('Rib', (0.85, 0.85, 0.83, 1))):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = col
    me.materials.append(mat)
shirt = bpy.data.objects.new('Shirt', me)
bpy.context.scene.collection.objects.link(shirt)
for p in me.polygons:
    p.use_smooth = True

# make face winding consistent & outward per piece (front faces -Y, back +Y)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me); bm.free()

# ---------- hanger collider ----------
def tube(name, path, r, seg=12):
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(i+1, len(path)-1)]) - Vector(path[max(i-1, 0)])).normalized()
        n1 = t.cross(Vector((0, 1, 0)))
        if n1.length < 1e-4:
            n1 = t.cross(Vector((1, 0, 0)))
        n1.normalize(); n2 = t.cross(n1).normalized()
        rings.append([bm.verts.new(p + (n1*math.cos(2*math.pi*k/seg) + n2*math.sin(2*math.pi*k/seg))*r) for k in range(seg)])
    for i in range(len(rings)-1):
        for k in range(seg):
            bm.faces.new((rings[i][k], rings[i][(k+1) % seg], rings[i+1][(k+1) % seg], rings[i+1][k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(name, m); bpy.context.scene.collection.objects.link(o)
    for p in m.polygons:
        p.use_smooth = True
    return o

bar = []
for i in range(61):
    x = -23 + 46*i/60
    z = -3.6 - 3.4*(abs(x)/23)**1.15 + 0.6*math.exp(-(x/4)**2)
    bar.append((x*S, 0, z*S))
hanger = tube('Hanger', bar, 0.95*S, 14)
hk = [(0, 0, -3.0*S)]
for i in range(1, 9):
    hk.append((0, 0, (-3.0 + 9.0*i/8)*S))
for i in range(1, 22):
    a = math.pi*i/21*1.25
    hk.append((2.6*S*(1-math.cos(a)), 0, (6.0 + 2.6*math.sin(a))*S))
hook = tube('Hook', hk, 0.28*S, 10)
col = hanger.modifiers.new('Collision', 'COLLISION')
hanger.collision.thickness_outer = 0.004
hanger.collision.cloth_friction = 20

# ---------- cloth sim ----------
sc = bpy.context.scene
sc.frame_start = 1; sc.frame_end = 90
cm = shirt.modifiers.new('Cloth', 'CLOTH')
cs = cm.settings
cs.quality = 8
cs.mass = 0.15
cs.air_damping = 1.0
cs.tension_stiffness = 18; cs.compression_stiffness = 18
cs.shear_stiffness = 6; cs.bending_stiffness = 0.25
cs.tension_damping = 5; cs.compression_damping = 5; cs.shear_damping = 5
cs.use_sewing_springs = True
cs.sewing_force_max = 0.0
cs.shrink_min = 0.0
cs.use_pressure = True
cs.uniform_pressure_force = 1.2
cs.pressure_factor = 1.0
cs.effector_weights.gravity = 0.0
cs.keyframe_insert('uniform_pressure_force', frame=1)
cs.effector_weights.keyframe_insert('gravity', frame=28)
cs.effector_weights.gravity = 1.0
cs.effector_weights.keyframe_insert('gravity', frame=42)
cs.uniform_pressure_force = 0.35
cs.keyframe_insert('uniform_pressure_force', frame=42)
cc = cm.collision_settings
cc.use_collision = True
cc.distance_min = 0.003
cc.use_self_collision = True
cc.self_distance_min = 0.0025
cc.collision_quality = 3
cm.point_cache.frame_start = 1; cm.point_cache.frame_end = 90

with open(os.path.join(OUT, 'pattern.json'), 'w') as f:
    json.dump(pattern_json, f)
sc.frame_set(1)
result = {'verts': len(me.vertices), 'faces': len(me.polygons), 'sew': len(sew),
          'pieces': {p['id']: len(p['outline']) for p in pattern_json['pieces']}}
