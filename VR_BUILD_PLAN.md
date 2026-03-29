# Knowledge Map VR — Rebuild Plan

## Research Summary (from studying real Quest 3 WebXR apps)

### What Works on Quest 3
- **Fresnel backside shader** for atmosphere glow (no EffectComposer needed)
- **512x512 textures** for planets (1024 max for hero planets)
- **InstancedMesh** for stars/particles (1 draw call for thousands)
- **troika-three-text** for labels (max 25-30 on Quest)
- **three-mesh-ui** for VR menus (MSDF fonts, hover/select states)
- **galaxyGroup pattern** for scaling (scene.scale doesn't work in WebXR)
- **body.style.opacity = '0'** to reduce 2D browser panel interference

### What Breaks Quest 3
- EffectComposer / UnrealBloomPass (doesn't support WebXR stereo)
- >1024x1024 textures
- >200 draw calls
- >100k triangles total
- HTMLMesh (unreliable)
- CSS3DRenderer (doesn't work in WebXR)
- scene.scale (no effect in WebXR)
- 212 individual canvas textures (GPU memory overflow → white screen)

## Architecture

```
scene (unscaled, meters)
├── galaxyGroup (scaled 0.002)
│   ├── all planet meshes (shared SphereGeometry)
│   ├── atmosphere meshes (Fresnel backside shader)
│   ├── troika labels (top 25)
│   ├── connection lines (single BufferGeometry)
│   ├── stars (Points, sizeAttenuation: false)
│   ├── black hole + accretion disk
│   └── nebula sprites
├── xrController0 + ray line
├── xrController1 + ray line
└── vrMenu (three-mesh-ui Block at world scale)
```

## Implementation Steps

### Phase 1: Core Scene (must work before anything else)
1. Start from km_vr_stable.html (confirmed working)
2. Replace procedural canvas textures with pre-baked 512x512 JPEG textures
   - Use NASA/Solar System Scope texture maps
   - Load via TextureLoader with LoadingManager
   - Show 3D loading bar in VR while textures load
3. Add Fresnel atmosphere shader (backside sphere, additive blend)
4. Test on Quest → confirm no white screen

### Phase 2: Labels
1. Add troika-three-text (UMD build via CDN)
2. Top 25 planet labels only
3. fontSize: node.size * 0.12 (scales with importance)
4. Black outline for readability
5. Test on Quest → confirm performance

### Phase 3: Menu
1. Add three-mesh-ui (UMD build via CDN)
2. MSDF Roboto font from CDN
3. Panel at world scale: (-0.3, 1.2, -0.6)
4. Buttons: EXIT VR, RECENTER, RESTART
5. Controller raycasting for hover/select
6. Test on Quest → confirm interaction

### Phase 4: Polish
1. Particles via InstancedMesh (1 draw call for 2000+ stars)
2. Boost atmosphere glow
3. Ring effects on larger planets
4. Connection line visibility boost

## Key Code Patterns

### Fresnel Atmosphere (proven, no post-processing)
```javascript
const atmosVert = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const atmosFrag = `
  varying vec3 vNormal;
  uniform vec3 glowColor;
  void main() {
    float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 6.0);
    gl_FragColor = vec4(glowColor, 1.0) * intensity;
  }
`;
// Apply to a SphereGeometry 1.15x planet size, side: BackSide, additive blending
```

### InstancedMesh for particles (1 draw call)
```javascript
const geo = new THREE.SphereGeometry(0.02, 4, 4);
const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const stars = new THREE.InstancedMesh(geo, mat, 2000);
const dummy = new THREE.Object3D();
for (let i = 0; i < 2000; i++) {
  dummy.position.set(random(), random(), random());
  dummy.updateMatrix();
  stars.setMatrixAt(i, dummy.matrix);
}
stars.instanceMatrix.needsUpdate = true;
```

### Draw Call Budget
| Item | Count | Draw Calls |
|------|-------|------------|
| Planets (shared geo) | 212 | 212 (1 each) |
| Atmospheres | 212 | 212 |
| Labels (troika) | 25 | 25 |
| Stars (instanced) | 2000 | 1 |
| Connections | 1 | 1 |
| Black hole | ~10 | ~10 |
| Menu | ~5 | ~5 |
| **TOTAL** | | **~466** |

**Problem**: 212 planets + 212 atmospheres = 424 draw calls alone. Need to reduce.

**Solutions**:
- InstancedMesh for planets (1 draw call for all 212)
- Skip individual atmosphere meshes; use a single shared glow sprite (like current)
- Or: only render atmosphere on the 30 largest planets

### Revised Budget with InstancedMesh
| Item | Draw Calls |
|------|------------|
| Planets (InstancedMesh) | 1 |
| Atmosphere sprites (shared material) | ~30 |
| Labels (troika, top 25) | 25 |
| Stars (instanced) | 1 |
| Connections | 1 |
| Black hole | ~10 |
| Menu | ~5 |
| **TOTAL** | **~73** ✅ |
