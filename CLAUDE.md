# Knowledge Map VR — Project Rules

## CRITICAL: One Change At A Time
- NEVER push multiple features in one commit
- Test each change on a NEW filename (km_vr_xxx.html)
- NEVER modify a file the user confirmed working
- Tag every confirmed-working state with `git tag`
- If something breaks, revert to the last tagged state IMMEDIATELY

## Working Base
- Last confirmed: `working-vr-phase4` tag
- Latest iteration: `km_vr_phase4e.html`
- Stable fallback: `km_vr_stable.html` (bare minimum that works)

## Quest 3 GPU Limits (HARD — violate these = white screen)
| Resource | Safe | DANGER |
|---|---|---|
| Draw calls | < 200 | > 300 = white screen |
| Triangles | < 100k | > 200k |
| Textures per planet | 128x64 max | 512x256 = crash |
| Canvas textures total | < 50 | 212 = crash |
| Troika text labels | < 30 | > 50 = frame drops |
| Particles (Points) | 5-10k | > 20k |

## What BREAKS Quest (never do these)
- `scene.scale` in WebXR (has NO EFFECT)
- EffectComposer / UnrealBloomPass (broken in WebXR stereo)
- HTMLMesh (unreliable on Quest)
- CSS3DRenderer (doesn't work in WebXR)
- `document.body.style.display = 'none'` (kills renderer)
- `document.body.style.visibility = 'hidden'` (kills renderer)
- Adding children to controllers during `sessionstart` (use init time)
- 212 individual canvas textures (GPU memory overflow)
- Procedural textures at 512x256 (the old `makePlanetTexture`)
- `sizeAttenuation: true` with large size values on Points
- Additive blending on many overlapping large transparent objects

## What WORKS on Quest (use these patterns)
- `document.body.style.opacity = '0'` (hides 2D panel, keeps renderer)
- `galaxyGroup` pattern (wrapper group scaled 0.002, scene unscaled)
- Controllers at scene level (world scale), NOT inside galaxyGroup
- `renderer.setAnimationLoop(animate)` (sole animation driver)
- `renderer.xr.enabled = true` at renderer creation
- `renderer.xr.setReferenceSpaceType('local-floor')`
- GPU-baked textures via WebGLRenderTarget (128x64 per planet)
- Fresnel backside shader for atmosphere (no post-processing)
- troika-three-text for SDF labels (stagger sync() 50ms apart)
- three-mesh-ui for menus (MSDF fonts)
- ACESFilmicToneMapping (works in WebXR, per-material)
- Shader-animated particles (vertex shader, zero CPU cost)
- Stars: `sizeAttenuation: false` with screen-space size

## Architecture
```
scene (unscaled, meters)
├── galaxyGroup (scaled 0.002)
│   ├── planet meshes (shared SphereGeometry, GPU-baked textures)
│   ├── atmosphere sprites (depthTest:false, additive blend)
│   ├── Fresnel atmosphere meshes (top 30, backside shader)
│   ├── troika labels (top 25)
│   ├── connection lines (single BufferGeometry)
│   ├── stars (Points, sizeAttenuation:false)
│   ├── black hole + accretion disk
│   └── nebula sprites
├── xrController0 + ray line (world scale)
├── xrController1 + ray line (world scale)
└── vrMenu (world scale, three-mesh-ui or canvas)
```

## VR Session Setup (exact pattern)
```javascript
renderer.xr.addEventListener('sessionstart', () => {
  _galaxyGroup = new THREE.Group();
  const children = [...scene.children];
  children.forEach(child => _galaxyGroup.add(child));
  _galaxyGroup.scale.setScalar(XR_SCALE);
  _galaxyGroup.position.set(0, 1.4, -4);
  scene.add(_galaxyGroup);
  scene.add(xrController0);
  scene.add(xrController1);
  document.body.style.opacity = '0';
});
```

## Planet Select (angle-based, not raycasting)
Raycasting misses tiny scaled meshes. Use angle-based proximity:
```javascript
// Find closest node within 7-degree cone from controller ray
let bestAngle = 0.12;
for (const n of nodes) {
  n.mesh.getWorldPosition(_xrNodeWorld);
  const toNode = _xrNodeWorld.clone().sub(_xrRayOrigin).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, toNode.dot(_xrRayDir))));
  if (angle < bestAngle) { bestAngle = angle; bestNode = n; }
}
```

## VR Effects Budget
Skip in VR to save draw calls:
- Pulses, shooting stars, trails, constellations
- Moons, ship, ripples, focus edges
- These add 200-1000 draw calls and push Quest over limit

## Menu (UNSOLVED — Quest 2D Panel Problem)
- Quest browser renders 2D page as floating panel in VR
- No API to fully remove it
- `body.opacity=0` helps but doesn't eliminate
- Menu at 35-45% scale near controller hand works sometimes
- Use Meta button on headset to exit VR (reliable fallback)

## CDN Libraries (verified working with THREE r152 global build)
```html
<script src="https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/troika-worker-utils@0.52.0/dist/troika-worker-utils.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/webgl-sdf-generator@1.1.1/dist/webgl-sdf-generator.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bidi-js@1.0.3/dist/bidi.js"></script>
<script src="https://cdn.jsdelivr.net/npm/troika-three-utils@0.52.4/dist/troika-three-utils.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/troika-three-text@0.52.4/dist/troika-three-text.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three-mesh-ui@6.5.4/build/three-mesh-ui.min.js"></script>
```

## Texture Baking (GPU path — replaces old canvas approach)
```javascript
// Render procedural noise to WebGLRenderTarget per planet
const rt = new THREE.WebGLRenderTarget(128, 64);
renderer.setRenderTarget(rt);
renderer.render(bakeScene, bakeCam);
renderer.setRenderTarget(null);
n.mesh.material.map = rt.texture;
```

## Reference Projects (studied)
- Project Flowerbed (Meta) — three-mesh-ui, instanced meshes, 72fps Quest
- toji WebXR Particles — 100k particles via GPU Transform Feedback
- threex.planets — NASA texture planet generators
- Solar System Scope — free 2K planet textures
