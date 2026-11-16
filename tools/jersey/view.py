# Quick check renders: blender -b -P tools/jersey/view.py -- <glb> <out_prefix>   (front, back, both sides, 3/4, under)
import bpy, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--')+1:]; glb, out = args[:2]; tex = args[2] if len(args) > 2 else None
zoom = float(args[3]) if len(args) > 3 else 1.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_cavity = True; sc.display.shading.show_backface_culling = False
sc.render.resolution_x = 700; sc.render.resolution_y = 800
cols = [(0.2, 0.45, 0.85, 1), (0.9, 0.2, 0.2, 1), (0.6, 0.6, 0.6, 1), (0.3, 0.3, 0.3, 1)]
for i, m in enumerate(bpy.data.materials): m.diffuse_color = cols[i % 4]
if tex:  # colour every piece from a sheet image through the mesh UVs
    img = bpy.data.images.load(tex); sc.display.shading.color_type = 'TEXTURE'
    for m in bpy.data.materials:
        m.use_nodes = True; nt = m.node_tree; t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        nt.links.new(t.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color']); nt.nodes.active = t
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
for name, az, el in [('front', 0, 5), ('back', 180, 5), ('right', 90, 5), ('left', -90, 5), ('q34', 35, 20), ('under', 20, -45)]:
    a, e = math.radians(az), math.radians(el); d = 2.4/zoom
    cam.location = Vector((d*math.sin(a)*math.cos(e), -d*math.cos(a)*math.cos(e), -0.35 + d*math.sin(e)))
    cam.rotation_euler = (Vector((0, 0, -0.35)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}_{name}.png'; bpy.ops.render.render(write_still=True)
