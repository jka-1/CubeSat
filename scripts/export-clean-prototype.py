"""Export only the supplied prototype's mechanical appearance for the web twin.

Blender --background --disable-autoexec SOURCE.blend --python this.py -- OUTPUT.glb
The source file is never saved; electronics, flight concept and workbench are excluded.
"""
import bpy, sys, json, hashlib
from pathlib import Path
from mathutils import Matrix

output = Path(sys.argv[sys.argv.index('--') + 1])
source = Path(bpy.data.filepath)
names = ['Chassis_Body_A', 'Chassis_Body_B', 'RemovableTop_Front_A',
         'RemovableTop_Front_B', 'WingArm_01', 'WingArm_02', 'WingArm_03',
         'WingArm_04', 'SolarPanel_01', 'SolarPanel_02']
scene = bpy.context.scene
# Selection must include the hidden prototype collection, without importing
# its cinematic registration, camera animation, or parent transforms.
for collection in bpy.data.collections:
    collection.hide_viewport = False
    collection.hide_render = False
for obj in scene.objects:
    obj.select_set(False)
copies = []
for name in names:
    original = bpy.data.objects[name]
    obj = bpy.data.objects.new('Clean_' + name, original.data.copy())
    scene.collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    # The original CAD colors multiply the new PBR finishes otherwise.
    for attribute in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(attribute)
    obj.select_set(True)
    copies.append(obj)
bpy.context.view_layer.objects.active = copies[0]
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
    use_selection=True, export_animations=False, export_cameras=False,
    export_lights=False, export_extras=False, export_yup=True)
report = {'source': source.name, 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'outputSHA256': hashlib.sha256(output.read_bytes()).hexdigest(),
          'components': names, 'policy': 'Mechanical appearance only. Original runtime ownership, transforms, electronics and live LCD retained.'}
output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('CLEAN_EXPORT', json.dumps(report), flush=True)
