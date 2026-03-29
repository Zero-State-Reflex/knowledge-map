# Quest VR Development Notes

## What Works (from official Three.js examples)
- Controllers added to `scene` during init (not sessionstart)
- `renderer.setAnimationLoop(animate)` called right after `xr.enabled = true`
- Ray lines: simple `Line` geometry, 5 units long
- `HTMLMesh` from `three/addons/interactive/HTMLMesh.js` for VR UI
- `InteractiveGroup` from `three/addons/interactive/InteractiveGroup.js` for pointer events
- Objects at room scale (1 unit = 1 meter)

## What Breaks on Quest
- 212+ canvas textures (procedural planet textures)
- `sizeAttenuation: true` particles (scale-dependent sizing)
- `document.body.style.display = 'none'` kills renderer
- Adding children to controllers during sessionstart (vs init)
- `renderer.xr.getCamera().position` returns (0,0,0)
- Scene rotation (breaks XR tracking)
- Additive blending with many transparent objects
- Large transparent planes (blocked by Quest's 2D page panel)

## Working Architecture
- Galaxy content in `_galaxyGroup` scaled to 0.002
- Controllers at world scale on `scene`
- body.style.opacity = '0' removes invisible 2D blocker
- Menu: use HTMLMesh + InteractiveGroup (not custom 3D planes)
