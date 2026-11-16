# Step B (Blender 4.2): smooth sim noise, decimate (seams pinned), add cloth thickness with _INSIDE, export GLB
import bpy, bmesh, sys, os
argv = sys.argv[sys.argv.index('--')+1:]
SRC, OUT = argv[0], argv[1]; RATIO = float(argv[2]) if len(argv) > 2 else 0.5; THICK = float(argv[3]) if len(argv) > 3 else 0.0022
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=SRC, forward_axis='NEGATIVE_Z', up_axis='Y')
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
obj.name = 'Garment'; me = obj.data
for m in me.materials:
    m.name = 'Rib' if m.name.lower().startswith('rib') else 'Fabric'
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
# boundary vertices (seams + hems) are pinned while smoothing / decimating so the welded seams stay closed
bm = bmesh.new(); bm.from_mesh(me)
bnd = [v.index for v in bm.verts if v.is_boundary]
bm.free()
vb = obj.vertex_groups.new(name='border'); vb.add(bnd, 1.0, 'REPLACE')
vi = obj.vertex_groups.new(name='interior'); vi.add([i for i in range(len(me.vertices)) if i not in set(bnd)], 1.0, 'REPLACE')
lap = obj.modifiers.new('Lap', 'LAPLACIANSMOOTH'); lap.lambda_factor = 0.8; lap.lambda_border = 0.0; lap.iterations = int(os.environ.get('LAP', 4)); lap.use_volume_preserve = True; lap.use_normalized = True
lap.vertex_group = 'interior'
bpy.ops.object.modifier_apply(modifier='Lap')
if RATIO < 1:
    dec = obj.modifiers.new('Dec', 'DECIMATE'); dec.decimate_type = 'COLLAPSE'; dec.ratio = RATIO; dec.vertex_group = 'interior'; dec.vertex_group_factor = 1.0
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='Dec')
for p in me.polygons: p.use_smooth = True
sol = obj.modifiers.new('Thick', 'SOLIDIFY'); sol.thickness = THICK; sol.offset = -1.0; sol.use_rim = True; sol.use_even_offset = True
obj.vertex_groups.new(name='inner'); sol.shell_vertex_group = 'inner'
bpy.ops.object.modifier_apply(modifier='Thick')
gi = obj.vertex_groups['inner'].index
att = me.attributes.new('_INSIDE', 'FLOAT', 'POINT')
vals = [0.0]*len(me.vertices)
for v in me.vertices:
    for g in v.groups:
        if g.group == gi and g.weight > 0.5: vals[v.index] = 1.0
att.data.foreach_set('value', vals)
for n in ('border', 'interior', 'inner'):
    obj.vertex_groups.remove(obj.vertex_groups[n])
bpy.ops.export_scene.gltf(export_attributes=True, filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_texcoords=True, export_normals=True, export_materials='PLACEHOLDER')
print('RESULT', {'verts': len(me.vertices), 'tris': sum(len(p.vertices)-2 for p in me.polygons), 'inner': int(sum(vals)), 'bytes': os.path.getsize(OUT)})
