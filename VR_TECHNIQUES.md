# VR Planet Rendering — Master Technique Guide

## Planet Scale Fix
Current: 15 scene units × 0.002 scale = 3cm in VR (marble-sized)
Target: 30-50cm diameter (basketball to beach ball)
**Solution**: Multiply planet mesh scale by 5x in the node mesh loop
```
mesh.scale.setScalar(n.size * 2.2 * 5)  // was * 2.2
```
Atmosphere and labels need matching adjustment.

## Earth Planet
- Assign to "Earth & Space" domain or "Astrophysics" node
- Use Solar System Scope 2K texture: `2k_earth_daymap.jpg`
- Add cloud layer (separate sphere 1.02x, counter-rotating)
- Night lights texture on dark side via emissive map
- For Quest: skip normal/specular maps (save GPU), just day + clouds

## Fresnel Atmosphere (already implemented in Phase 3)
- BackSide sphere at 1.15-1.18x planet radius
- Additive blending, no depth write
- coeff: 0.6, power: 5.0 for soft halo
- Domain-colored per planet

## Procedural Planet Textures (GPU Shader)
The research found a complete simplex noise GLSL shader that can render:
- Rocky planets (craters + terrain noise)
- Gas giants (latitude banding + turbulence)
- Ice planets (smooth with subtle features)
- Verdant planets (green/brown noise)

Each planet gets a unique seed from its node ID. Three colors per domain.
Zero texture downloads. Runs once on GPU per frame.

**BUT for Quest**: better to bake to small canvas textures (128x64) once
at load time, then use as regular textures. The current `makePlanetTexture()`
already does this — it just needs to run at lower resolution to not crash Quest.

## Canvas Texture Strategy for Quest
- Current: 512×256 per planet → 212 textures → white screen
- Fix: 64×32 per planet → tiny textures, fast to generate
- Or: 128×64 for top 30, skip rest (keep solid color)
- Generate in batches of 4 with setTimeout (already implemented)

## NASA Texture Sources (free, self-host required)
- Solar System Scope: https://www.solarsystemscope.com/textures/
- NASA Visible Earth: https://visibleearth.nasa.gov/
- Planet Pixel Emporium: http://planetpixelemporium.com/

## Cinematic Techniques (from research)
- ACESFilmicToneMapping DOES work in WebXR ✓
- Exposure 1.0-1.5 for cinematic look
- Fog (FogExp2) creates depth/atmosphere at distance
- Stars: sizeAttenuation:false + size 1.4 = screen-space dots that work
- Lens flare: THREE.Lensflare addon — confirmed working in WebXR
- God rays: mesh-based (cone geometry + additive blend) since EffectComposer broken

## Particle Dust (shader-animated, no CPU cost)
Vertex shader can animate positions:
```glsl
uniform float time;
void main() {
  vec3 pos = position;
  pos.x += sin(time * 0.5 + position.y * 10.0) * 0.01;
  pos.y += cos(time * 0.3 + position.x * 8.0) * 0.008;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = 3.0 * (300.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
```
This moves particles on GPU — zero CPU overhead per frame.

## Draw Call Budget (Phase 3 current)
| Item | Count |
|------|-------|
| Planet meshes | 212 |
| Atmosphere sprites | 212 |
| Fresnel atmospheres | 30 |
| Troika labels | 26 |
| Stars | 1 |
| Black hole | ~23 |
| Nebula | 8 |
| Edge lines | 1 |
| Lights | 4 |
| Controllers + rays | 4 |
| **Total** | **~521** |

## Next Optimizations
1. InstancedMesh for planets → 212 meshes → 1 draw call
2. Skip atmosphere sprites for small planets → 212 → ~50
3. Use FogExp2 to naturally hide distant objects
4. Frustum culling (enabled by default in Three.js)
