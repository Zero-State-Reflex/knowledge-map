# Quest 3 WebXR — Proven Patterns & Limits

## GPU Budgets (Hard Limits)
| Resource | Safe | Danger |
|---|---|---|
| Draw calls | < 50 | > 100 |
| Triangles | < 100k | > 200k |
| Textures | 1024x1024 max | > 2048 |
| Points/particles | 5-10k | > 20k |
| Text labels (troika) | < 30 | > 100 |
| Frame budget | 13.9ms (72Hz) | Miss = judder/white |

## White Screen of Death
- GPU memory overflow from too many textures/geometries
- Quest browser silently kills WebGL context — no error
- Stereo VR = everything rendered TWICE
- ALWAYS dispose unused resources

## The 2D Panel Problem (UNSOLVED on Quest)
- Quest browser renders 2D page as floating panel in VR
- `dom-overlay` NOT supported on Quest for immersive-vr
- No API to hide it — it's a Quest browser limitation
- Workaround: minimize 2D page content, panel sits beside user
- body.opacity=0 helps but doesn't fully eliminate

## VR UI Menus — What Actually Works
1. **three-mesh-ui** — Most battle-tested, flexbox layout, MSDF fonts
2. **CanvasUI** — Canvas2D rendered to texture on a plane
3. **Roll-your-own canvas textures** — Simple, zero dependencies
4. HTMLMesh — UNRELIABLE on Quest. Avoid.
5. CSS3DRenderer — Does NOT work in WebXR stereo. Avoid.

## 3D Text Labels — What Works
1. **troika-three-text** — SDF rendering, crisp at any distance, 1 draw call each
   - Keep under 30 instances on Quest
   - Stagger .sync() calls across frames
2. **Canvas texture sprites** — Bake text to canvas, use as sprite
   - Better for 50+ labels (fewer draw calls if batched)
   - Each unique canvas = 1 texture = 1 draw call

## Particles — What Works
- THREE.Points with 5-10k vertices is safe
- Use `sizeAttenuation: true` with size in meters (0.01-0.05)
- Shader-animated particles avoid CPU overhead (50k+ possible)
- `depthWrite: false` critical for transparency
- Additive blending OK but increases GPU fill rate

## Scaling Large Scenes
- `scene.scale` has NO EFFECT in WebXR mode!
- Use a content wrapper group: `worldGroup.scale.setScalar(0.001)`
- Controllers/UI stay at scene level (world scale)
- Lights may render wrong when scaled — use unlit materials or scene-level lights

## Architecture for Knowledge Map VR
```
scene (unscaled, world coordinates = meters)
  ├── galaxyGroup (scaled 0.002, all planet/star content)
  ├── xrController0 (world scale, with ray line)
  ├── xrController1 (world scale, with ray line)
  └── vrMenuGroup (world scale, three-mesh-ui or canvas-based)
```
