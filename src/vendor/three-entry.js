// Vendor entry: only what src/app.js uses (tree-shaken three r170 + addons in ONE request).
// Rebuild: see README "Vendored libraries". build.py verifies every THREE.<name> used in app.js is exported here.
export { Box3, CanvasTexture, Color, DirectionalLight, DoubleSide, Group, HalfFloatType, MathUtils, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, NeutralToneMapping, NoColorSpace, PMREMGenerator, PerspectiveCamera,
  PlaneGeometry, Raycaster, RepeatWrapping, SRGBColorSpace, Scene, SpotLight, VSMShadowMap, Vector2, Vector3,
  WebGLRenderTarget, WebGLRenderer, BufferGeometry, BufferAttribute, LinearFilter, LinearMipmapLinearFilter } from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
