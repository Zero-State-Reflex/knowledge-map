# Planet Visual Effects Reference — Quest 3 WebXR / Three.js r152

All code uses the global THREE build (no ES modules). No EffectComposer. Every effect targets <200 total draw calls across 217 planets. Vertex-shader animation preferred over CPU.

**Existing budget per planet (from km_bh13.html):**
- 1 draw call: planet mesh (shared SphereGeometry, MeshPhongMaterial)
- 1 draw call: atmosphere sprite (SpriteMaterial, additive)
- 1 draw call (top 30 only): Fresnel atmosphere mesh (BackSide ShaderMaterial)

**Strategy for 217 planets:** Most effects below are applied only to the *focused/hovered* planet (1-3 at a time), not all 217. Idle animations that touch all planets must be vertex-shader-only on shared uniforms.

---

## 1. Planet Selection Effects

### 1A. Expanding Ring of Light

Zero extra draw calls — reuses the planet's own ShaderMaterial via a uniform.

```javascript
// ── SELECTION RING — Expanding light ring on planet surface ──
// Budget: 0 extra draw calls (injected into planet's material)
// Apply to the selected planet's mesh.material

function createSelectionRingMaterial(baseColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uSelected:   { value: 0.0 }, // 0=off, 1=on
      uSelectTime: { value: 0.0 }, // time when selected
      uBaseColor:  { value: new THREE.Color(baseColor) },
      uMap:        { value: null }, // assign planet texture
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSelected, uSelectTime;
      uniform vec3 uBaseColor;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 tex = texture2D(uMap, vUv).rgb;
        vec3 col = tex * uBaseColor;

        // Fresnel rim
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        col += uBaseColor * fresnel * 0.3;

        // Selection ring expanding from equator
        if (uSelected > 0.5) {
          float elapsed = uTime - uSelectTime;
          float ringPos = fract(elapsed * 0.5); // ring travels pole-to-pole in 2s
          float lat = vUv.y; // 0=south pole, 1=north pole
          float ringDist = abs(lat - ringPos);
          float ring = exp(-ringDist * ringDist * 800.0); // tight gaussian
          float fade = 1.0 - smoothstep(0.0, 2.0, elapsed); // fade after 2s
          // Second ring going opposite direction
          float ringPos2 = 1.0 - ringPos;
          float ring2 = exp(-(lat - ringPos2) * (lat - ringPos2) * 800.0);
          col += uBaseColor * 2.0 * (ring + ring2) * fade;
        }

        // Emissive boost
        col += uBaseColor * 0.15;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

// Usage:
// When selecting a planet:
//   const mat = createSelectionRingMaterial(domainColor);
//   mat.uniforms.uMap.value = planet.mesh.material.map;
//   planet.mesh.material = mat;
//   mat.uniforms.uSelected.value = 1.0;
//   mat.uniforms.uSelectTime.value = currentTime;
// In animate loop:
//   mat.uniforms.uTime.value = time;
```

### 1B. Aura/Halo Pulse

Modifies the existing atmosphere sprite — zero extra draw calls.

```javascript
// ── AURA PULSE — Animate existing atmosphere sprite on selection ──
// Budget: 0 extra draw calls (modifies existing atm sprite)

function updateAuraPulse(node, time, isSelected) {
  if (!node.atmMat) return;
  if (isSelected) {
    // Pulsing glow: base 0.5 + sine wave 0.2 amplitude
    const pulse = 0.5 + Math.sin(time * 3.0) * 0.2;
    node.atmMat.opacity = pulse;
    // Scale breathe
    const breathe = 1.0 + Math.sin(time * 2.0) * 0.08;
    const baseScale = node.size * 2.2 * 5 * 2.5; // PLANET_SCALE=5, glow=2.5x
    node.atm.scale.setScalar(baseScale * breathe);
  } else {
    node.atmMat.opacity = 0.3; // default
  }
}

// Also boost Fresnel atmosphere if present:
function updateFresnelPulse(node, time, isSelected) {
  if (!node._fresnelAtm) return;
  const mat = node._fresnelAtm.material;
  if (isSelected) {
    mat.uniforms.coeff.value = 0.56 + Math.sin(time * 3.0) * 0.15;
    mat.uniforms.power.value = 3.0 + Math.sin(time * 2.5) * 0.8;
  } else {
    mat.uniforms.coeff.value = 0.56;
    mat.uniforms.power.value = 4.0;
  }
}
```

### 1C. Orbiting Selection Indicator

One extra draw call for the focused planet only.

```javascript
// ── ORBITING DOT — Small sphere orbiting selected planet ──
// Budget: 1 draw call (only on focused planet)

function createOrbitIndicator(color) {
  const geo = new THREE.SphereGeometry(1, 8, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: color || 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dot = new THREE.Mesh(geo, mat);
  dot.visible = false;

  // Trail ring (same draw call approach — use a RingGeometry)
  const trailGeo = new THREE.RingGeometry(0.95, 1.05, 64, 1);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color || 0xffffff) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
        float trail = fract(angle / 6.2832 - uTime * 0.3);
        float alpha = trail * 0.3;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.visible = false;

  return {
    dot, trail,
    show: function(node) {
      dot.visible = true;
      trail.visible = true;
      const planetRadius = node.size * 2.2 * 5; // PLANET_SCALE
      dot.scale.setScalar(planetRadius * 0.08);
      trail.scale.setScalar(planetRadius * 1.5);
      trail.position.set(node.x, node.y, node.z);
    },
    hide: function() {
      dot.visible = false;
      trail.visible = false;
    },
    tick: function(node, time, camera) {
      if (!dot.visible) return;
      const planetRadius = node.size * 2.2 * 5;
      const orbitR = planetRadius * 1.5;
      const speed = 1.5;
      dot.position.set(
        node.x + Math.cos(time * speed) * orbitR,
        node.y + Math.sin(time * speed * 0.7) * orbitR * 0.3,
        node.z + Math.sin(time * speed) * orbitR
      );
      // Billboard the trail ring toward camera
      trail.lookAt(camera.position);
      trailMat.uniforms.uTime.value = time;
    }
  };
}
```

### 1D. Energy Shield (Hexagonal Grid)

Replaces the Fresnel atmosphere temporarily — zero net draw calls if planet already has one.

```javascript
// ── ENERGY SHIELD — Hex grid appearing on selection ──
// Budget: 0 extra if replacing fresnel atm, or 1 draw call on non-fresnel planets

function createEnergyShield(radius, color) {
  const geo = new THREE.IcosahedronGeometry(radius, 3); // 3 subdivisions ≈ 1280 tris
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(color || 0x44aaff) },
      uAlpha: { value: 0.0 }, // animate 0→1 on select
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvp.xyz);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uColor;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      // Hex grid SDF
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, vec2(0.866, 0.5)), p.y);
      }
      float hexGrid(vec2 uv, float scale) {
        uv *= scale;
        vec2 g = vec2(1.732, 1.0) * 0.5;
        vec2 a = mod(uv, g) - g * 0.5;
        vec2 b = mod(uv + g * 0.5, g) - g * 0.5;
        float da = hexDist(a);
        float db = hexDist(b);
        float d = min(da, db);
        // Edge line
        return smoothstep(0.4, 0.42, d);
      }

      void main() {
        // Project 3D position to spherical UV
        vec3 n = normalize(vPos);
        float u = atan(n.z, n.x) / 6.2832 + 0.5;
        float v = acos(n.y) / 3.1416;
        vec2 hexUv = vec2(u * 6.0, v * 3.0);

        float hex = hexGrid(hexUv, 8.0);

        // Fresnel edge glow
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);

        // Impact ripple at a random point (animated)
        float ripple = 0.0;
        vec3 hitDir = normalize(vec3(sin(uTime * 0.7), cos(uTime * 0.5), sin(uTime * 0.3)));
        float hitDot = max(dot(n, hitDir), 0.0);
        float hitRing = abs(hitDot - fract(uTime * 2.0) * 0.3 - 0.7);
        ripple = exp(-hitRing * hitRing * 200.0) * step(0.7, hitDot);

        float alpha = (hex * 0.3 + fresnel * 0.5 + ripple * 0.8) * uAlpha;
        vec3 col = uColor * (1.0 + fresnel * 0.5 + ripple * 2.0);

        gl_FragColor = vec4(col, alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;

  return {
    mesh, mat,
    activate: function(node) {
      const planetR = node.size * 2.2 * 5;
      mesh.scale.setScalar(planetR * 1.15);
      mesh.position.set(node.x, node.y, node.z);
      mesh.visible = true;
    },
    deactivate: function() {
      mesh.visible = false;
      mat.uniforms.uAlpha.value = 0;
    },
    tick: function(time, dt) {
      if (!mesh.visible) return;
      // Fade in
      mat.uniforms.uAlpha.value = Math.min(1.0, mat.uniforms.uAlpha.value + dt * 2.0);
      mat.uniforms.uTime.value = time;
    }
  };
}
```

### 1E. Chromatic Surface Pulse

Zero extra draw calls — shader replacement on existing mesh.

```javascript
// ── CHROMATIC PULSE — Color wave rippling across planet surface ──
// Budget: 0 extra draw calls (replaces planet material temporarily)

function createChromaticPulseMaterial(baseColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uPulseTime:  { value: -10.0 }, // set to current time to trigger pulse
      uBaseColor:  { value: new THREE.Color(baseColor) },
      uMap:        { value: null },
      uPulseColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uPulseTime;
      uniform vec3 uBaseColor, uPulseColor;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 tex = texture2D(uMap, vUv).rgb;
        vec3 col = tex * uBaseColor;
        col += uBaseColor * 0.15; // emissive

        float elapsed = uTime - uPulseTime;
        if (elapsed < 2.0 && elapsed > 0.0) {
          // Spherical wave from north pole
          float lat = vUv.y;
          float wavePos = elapsed * 0.8; // wave speed
          float waveDist = abs(lat - wavePos);
          float wave = exp(-waveDist * waveDist * 300.0);

          // Chromatic shift — split into RGB channels offset by wave
          float rShift = wave * sin(elapsed * 8.0) * 0.3;
          float bShift = wave * cos(elapsed * 8.0) * 0.3;
          col.r += rShift + wave * 0.5;
          col.g += wave * 0.2;
          col.b += bShift + wave * 0.5;

          // Brighten
          col += uPulseColor * wave * 0.4 * (1.0 - elapsed / 2.0);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

// Usage: set uPulseTime = currentTime to fire a pulse
```

### 1F. Scale Pulse (Breathe)

Pure CPU, zero draw calls. Most efficient selection feedback.

```javascript
// ── SCALE PULSE — Subtle breathe in/out on selection ──
// Budget: 0 draw calls, negligible CPU

function updateScalePulse(node, time, isSelected) {
  const baseScale = node.size * 2.2 * 5; // PLANET_SCALE
  if (isSelected) {
    const breathe = 1.0 + Math.sin(time * 2.5) * 0.06; // 6% scale variation
    node.mesh.scale.setScalar(baseScale * breathe);
    // Sync atmosphere
    if (node.atm) {
      node.atm.scale.setScalar(baseScale * 2.5 * breathe);
    }
    if (node._fresnelAtm) {
      node._fresnelAtm.scale.setScalar(baseScale * 1.25 * breathe);
    }
  } else {
    node.mesh.scale.setScalar(baseScale);
  }
}
```

---

## 2. Planet Hover Effects

### 2A. Subtle Glow Increase

Cheapest hover effect. Reuses existing sprite.

```javascript
// ── HOVER GLOW — Increase atmosphere opacity on hover ──
// Budget: 0 draw calls

function applyHoverGlow(node, isHovered) {
  if (!node.atmMat) return;
  if (isHovered) {
    // Smooth lerp toward target
    node.atmMat.opacity = THREE.MathUtils.lerp(node.atmMat.opacity, 0.55, 0.1);
    node.mesh.material.emissiveIntensity = THREE.MathUtils.lerp(
      node.mesh.material.emissiveIntensity, 0.25, 0.1
    );
  } else {
    node.atmMat.opacity = THREE.MathUtils.lerp(node.atmMat.opacity, 0.3, 0.08);
    node.mesh.material.emissiveIntensity = THREE.MathUtils.lerp(
      node.mesh.material.emissiveIntensity, 0.015, 0.08
    );
  }
}
```

### 2B. Outline / Silhouette Highlight

Uses the existing Fresnel atmosphere approach but with a brighter, sharper edge. For planets that already have a Fresnel atm, just tweak uniforms. For others, temporarily add one.

```javascript
// ── OUTLINE HIGHLIGHT — Sharp fresnel edge on hover ──
// Budget: 0 extra for top-30 planets (already have fresnel), 1 draw call for others

// Shared outline geometry and material (reuse for whichever planet is hovered)
const _outlineGeo = new THREE.SphereGeometry(1, 24, 16);
const _outlineMat = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvp = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mvp.xyz);
      gl_Position = projectionMatrix * mvp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uPower;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      float rim = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), uPower);
      // Sharp outline: step instead of smooth gradient
      float outline = smoothstep(0.3, 0.6, rim);
      gl_FragColor = vec4(uColor * 1.5, outline * 0.8);
    }
  `,
  uniforms: {
    uColor: { value: new THREE.Color(0xffffff) },
    uPower: { value: 2.0 },
  },
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const _outlineMesh = new THREE.Mesh(_outlineGeo, _outlineMat);
_outlineMesh.visible = false;

function showOutline(node, scene) {
  const r = node.size * 2.2 * 5 * 1.12; // slightly larger than planet
  _outlineMesh.scale.setScalar(r);
  _outlineMesh.position.set(node.x, node.y, node.z);
  _outlineMat.uniforms.uColor.value.set(
    node.mesh.material.color || node.mesh.material.uniforms?.uBaseColor?.value || 0xffffff
  );
  _outlineMesh.visible = true;
  if (!_outlineMesh.parent) scene.add(_outlineMesh);
}

function hideOutline() {
  _outlineMesh.visible = false;
}
```

### 2C. Hover Tooltip (VR — three-mesh-ui or troika)

```javascript
// ── VR HOVER LABEL — troika text that fades in on hover ──
// Budget: 1 draw call (single troika text, only when hovering)

// Reuse a single troika text instance — move it to whichever planet is hovered
let _hoverLabel = null;

function initHoverLabel(scene) {
  // Using troika-three-text (already loaded via CDN)
  _hoverLabel = new troika_three_text.Text();
  _hoverLabel.fontSize = 60;
  _hoverLabel.color = 0xffffff;
  _hoverLabel.anchorX = 'center';
  _hoverLabel.anchorY = 'bottom';
  _hoverLabel.outlineWidth = 3;
  _hoverLabel.outlineColor = 0x000000;
  _hoverLabel.material.transparent = true;
  _hoverLabel.material.depthTest = false;
  _hoverLabel.visible = false;
  scene.add(_hoverLabel);
}

function showHoverLabel(node, camera) {
  if (!_hoverLabel) return;
  _hoverLabel.text = node.id;
  _hoverLabel.visible = true;
  const planetR = node.size * 2.2 * 5;
  _hoverLabel.position.set(node.x, node.y + planetR * 1.8, node.z);
  // Face camera
  _hoverLabel.quaternion.copy(camera.quaternion);
  _hoverLabel.sync();
}

function hideHoverLabel() {
  if (_hoverLabel) _hoverLabel.visible = false;
}
```

### 2D. Gravitational Lens Distortion

This is expensive (render-to-texture). Only use on desktop, skip in VR.

```javascript
// ── GRAVITATIONAL LENS — Per-planet distortion without EffectComposer ──
// Budget: 1 full-screen draw call + 1 RTT pass (DESKTOP ONLY — skip in VR)
// This reuses the same approach from vfx_shaders.js createGravityLensing()
// but scoped to any planet position instead of just the black hole.

// QUEST 3 ALTERNATIVE: Fake it with a radial-distort sprite behind the planet
function createFakeLensSprite(color) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.3, 'rgba(80,120,255,0.05)');
  grad.addColorStop(0.6, 'rgba(80,120,255,0.12)');
  grad.addColorStop(0.85, 'rgba(80,120,255,0.03)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;

  return {
    sprite, mat,
    show: function(node) {
      const r = node.size * 2.2 * 5 * 4;
      sprite.scale.set(r, r, 1);
      sprite.position.set(node.x, node.y, node.z);
      sprite.visible = true;
    },
    hide: function() { sprite.visible = false; mat.opacity = 0; },
    tick: function(dt) {
      if (!sprite.visible) return;
      mat.opacity = Math.min(0.15, mat.opacity + dt * 0.3);
    }
  };
}
```

### 2E. Orbiting Particle Ring on Hover

Single Points draw call, vertex-shader animated.

```javascript
// ── HOVER PARTICLE RING — Ring of particles orbiting hovered planet ──
// Budget: 1 draw call (Points), vertex-shader animation

function createHoverParticleRing(particleCount) {
  particleCount = particleCount || 64;
  const positions = new Float32Array(particleCount * 3);
  const phases = new Float32Array(particleCount);
  const speeds = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2;
    positions[i * 3]     = Math.cos(angle); // unit circle, scaled in shader
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle);
    phases[i] = angle;
    speeds[i] = 0.8 + Math.random() * 0.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:    { value: 0 },
      uRadius:  { value: 1.0 },
      uCenter:  { value: new THREE.Vector3() },
      uColor:   { value: new THREE.Color(0x44aaff) },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase, aSpeed;
      uniform float uTime, uRadius, uOpacity;
      uniform vec3 uCenter;
      varying float vAlpha;
      void main() {
        float angle = aPhase + uTime * aSpeed;
        vec3 p = uCenter + vec3(
          cos(angle) * uRadius,
          sin(angle * 0.3 + uTime) * uRadius * 0.15,
          sin(angle) * uRadius
        );
        vAlpha = uOpacity * (0.5 + 0.5 * sin(angle * 3.0 + uTime * 2.0));
        vec4 mvp = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 3.0; // sizeAttenuation:false equivalent
        gl_Position = mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        gl_FragColor = vec4(uColor * 1.5, soft * vAlpha);
      }
    `
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;

  return {
    points, mat,
    show: function(node) {
      const r = node.size * 2.2 * 5 * 1.8;
      mat.uniforms.uRadius.value = r;
      mat.uniforms.uCenter.value.set(node.x, node.y, node.z);
      mat.uniforms.uColor.value.set(
        node.mesh.material.color?.getHex?.() || 0x44aaff
      );
      points.visible = true;
    },
    hide: function() {
      points.visible = false;
      mat.uniforms.uOpacity.value = 0;
    },
    tick: function(time, dt) {
      if (!points.visible) return;
      mat.uniforms.uTime.value = time;
      mat.uniforms.uOpacity.value = Math.min(0.8, mat.uniforms.uOpacity.value + dt * 2.0);
    }
  };
}
```

---

## 3. Planet Transition Animations

### 3A. Camera Approach with Detail Pop-in

```javascript
// ── ZOOM TRANSITION — Planet grows + detail pops in as camera approaches ──
// Budget: 0 draw calls (modifies existing uniforms and scale)

function createZoomTransition() {
  let _active = false;
  let _node = null;
  let _startTime = 0;
  let _startPos = new THREE.Vector3();
  let _endPos = new THREE.Vector3();
  let _startTarget = new THREE.Vector3();
  let _endTarget = new THREE.Vector3();
  const _duration = 1.5; // seconds

  return {
    start: function(node, camera) {
      _active = true;
      _node = node;
      _startTime = performance.now() / 1000;
      _startPos.copy(camera.position);
      _startTarget.set(node.x, node.y, node.z);
      _endTarget.copy(_startTarget);

      // End position: offset from planet surface
      const planetR = node.size * 2.2 * 5;
      const dir = camera.position.clone().sub(_startTarget).normalize();
      _endPos.copy(_startTarget).addScaledVector(dir, planetR * 3.5);
    },

    tick: function(time, camera) {
      if (!_active || !_node) return false;
      const elapsed = time - _startTime;
      let t = Math.min(elapsed / _duration, 1.0);

      // Ease in-out cubic
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Move camera
      camera.position.lerpVectors(_startPos, _endPos, t);
      // Look at planet
      const lookTarget = new THREE.Vector3().lerpVectors(_startTarget, _endTarget, t);
      camera.lookAt(lookTarget);

      // Detail pop-in: increase texture detail at 60% approach
      if (t > 0.6 && _node._detailPopped !== true) {
        _node._detailPopped = true;
        // Swap to higher detail texture (256x128 instead of 128x64)
        // This is a signal to your texture baking system
        if (_node._rebakeHighRes) _node._rebakeHighRes();
      }

      if (t >= 1.0) {
        _active = false;
        return true; // done
      }
      return false;
    },

    isActive: function() { return _active; },
  };
}
```

### 3B. Atmosphere Thickening on Approach

```javascript
// ── ATMOSPHERE THICKEN — Atmosphere grows as camera gets close ──
// Budget: 0 draw calls (modifies existing meshes)

function updateAtmosphereByDistance(node, camera) {
  const planetR = node.size * 2.2 * 5;
  const dist = camera.position.distanceTo(
    new THREE.Vector3(node.x, node.y, node.z)
  );
  const maxDist = planetR * 20;
  const minDist = planetR * 2;

  // Proximity factor: 0 (far) to 1 (close)
  const proximity = 1.0 - THREE.MathUtils.clamp(
    (dist - minDist) / (maxDist - minDist), 0, 1
  );

  // Atmosphere sprite grows
  if (node.atm) {
    const baseGlow = planetR * 2.5;
    const extraGlow = planetR * 1.5 * proximity;
    const scale = baseGlow + extraGlow;
    node.atm.scale.setScalar(scale);
    node.atmMat.opacity = 0.3 + proximity * 0.35;
  }

  // Fresnel atmosphere intensifies
  if (node._fresnelAtm) {
    const mat = node._fresnelAtm.material;
    mat.uniforms.coeff.value = 0.56 + proximity * 0.25;
    mat.uniforms.power.value = 4.0 - proximity * 1.5; // softer falloff = thicker
    node._fresnelAtm.scale.setScalar(planetR * (1.25 + proximity * 0.2));
  }
}
```

### 3C. Surface Detail Enhancement (LOD Texture Swap)

```javascript
// ── TEXTURE LOD — Swap planet texture resolution based on distance ──
// Budget: 0 draw calls, GPU memory for one high-res texture at a time

function createTextureLODManager(renderer) {
  let _highResNode = null;
  let _highResRT = null;

  // Create a single reusable high-res render target
  const HIGH_RES = 256; // 256x128
  _highResRT = new THREE.WebGLRenderTarget(HIGH_RES, HIGH_RES / 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  return {
    // Call when a planet becomes focused
    upgradeTexture: function(node, bakeScene, bakeCam, bakeMaterial) {
      // Release previous high-res
      if (_highResNode && _highResNode !== node) {
        // Rebake at low res (128x64)
        this.downgradeTexture(_highResNode, bakeScene, bakeCam, bakeMaterial);
      }

      _highResNode = node;

      // Render high-res texture
      renderer.setRenderTarget(_highResRT);
      // Configure bake material for this planet's type
      // (assumes bakeMaterial has uniforms for seed, palette, etc.)
      renderer.render(bakeScene, bakeCam);
      renderer.setRenderTarget(null);

      node.mesh.material.map = _highResRT.texture;
      node.mesh.material.needsUpdate = true;
    },

    downgradeTexture: function(node, bakeScene, bakeCam, bakeMaterial) {
      // Rebake at standard resolution
      const lowRT = new THREE.WebGLRenderTarget(128, 64);
      renderer.setRenderTarget(lowRT);
      renderer.render(bakeScene, bakeCam);
      renderer.setRenderTarget(null);
      node.mesh.material.map = lowRT.texture;
      node.mesh.material.needsUpdate = true;
    },

    dispose: function() {
      if (_highResRT) _highResRT.dispose();
    }
  };
}
```

### 3D. Ring System Appears at Close Range

```javascript
// ── RING FADE-IN — Planet ring becomes visible when camera is close ──
// Budget: 1 draw call per ringed planet (only visible when close)
// Uses the createPlanetRings() from vfx_shaders.js

function createProximityRing(node, scene, innerR, outerR) {
  const planetR = node.size * 2.2 * 5;
  innerR = innerR || planetR * 1.4;
  outerR = outerR || planetR * 2.5;

  // Use the ring from vfx_shaders.js
  const ring = createPlanetRings(innerR, outerR, -0.3 * Math.PI);
  ring.mesh.position.set(node.x, node.y, node.z);
  ring.mesh.visible = false;
  ring.mesh.material.uniforms.uAlpha = { value: 0 };
  scene.add(ring.mesh);

  node._ring = ring;

  return {
    tick: function(time, camera) {
      const dist = camera.position.distanceTo(
        new THREE.Vector3(node.x, node.y, node.z)
      );
      const fadeStart = planetR * 15;
      const fadeEnd = planetR * 8;
      const visibility = 1.0 - THREE.MathUtils.clamp(
        (dist - fadeEnd) / (fadeStart - fadeEnd), 0, 1
      );

      ring.mesh.visible = visibility > 0.01;
      if (ring.mesh.visible) {
        ring.mesh.material.opacity = visibility;
        ring.tick(time);
      }
    }
  };
}
```

### 3E. Moons Fade In When Close

```javascript
// ── MOON FADE — Moons appear as you approach ──
// Budget: 1-3 draw calls per moon (only on focused planet)
// The existing km_bh13.html buildMoons() creates them on focus.
// This version adds a distance-based fade.

function createMoon(parentNode, scene, orbitRadius, moonSize, color, speed) {
  const geo = new THREE.SphereGeometry(moonSize, 12, 8);
  const mat = new THREE.MeshPhongMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.1,
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  scene.add(mesh);

  const phase = Math.random() * Math.PI * 2;
  const tilt = (Math.random() - 0.5) * 0.5;

  return {
    mesh, mat,
    tick: function(time, camera) {
      // Orbit
      const angle = time * speed + phase;
      mesh.position.set(
        parentNode.x + Math.cos(angle) * orbitRadius,
        parentNode.y + Math.sin(angle * 0.3 + tilt) * orbitRadius * 0.2,
        parentNode.z + Math.sin(angle) * orbitRadius
      );

      // Distance-based fade
      const dist = camera.position.distanceTo(mesh.position);
      const planetR = parentNode.size * 2.2 * 5;
      const fadeStart = planetR * 12;
      const fadeEnd = planetR * 6;
      const alpha = 1.0 - THREE.MathUtils.clamp(
        (dist - fadeEnd) / (fadeStart - fadeEnd), 0, 1
      );
      mesh.visible = alpha > 0.01;
      mat.opacity = alpha;
    },
    dispose: function() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    }
  };
}
```

---

## 4. Planet Atmosphere / Surface Shaders

### 4A. Animated Atmosphere with Moving Cloud Layers

Two-layer approach: planet surface (standard texture) + cloud layer via shader on the same mesh. Zero extra draw calls — replaces MeshPhongMaterial.

```javascript
// ── CLOUD LAYER PLANET — Animated clouds over textured surface ──
// Budget: 0 extra draw calls (replaces planet material)

function createCloudPlanetMaterial(surfaceColor, cloudColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uMap:        { value: null }, // surface texture
      uBaseColor:  { value: new THREE.Color(surfaceColor) },
      uCloudColor: { value: new THREE.Color(cloudColor || 0xffffff) },
      uCloudSpeed: { value: 0.02 },
      uCloudDensity: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvp.xyz);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCloudSpeed, uCloudDensity;
      uniform vec3 uBaseColor, uCloudColor;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(0.87, 0.48, -0.48, 0.87);
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = rot * p * 2.0; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 surface = texture2D(uMap, vUv).rgb * uBaseColor;

        // Cloud layer 1 (high altitude, fast)
        vec2 cloudUv1 = vUv * vec2(3.0, 1.5) + vec2(uTime * uCloudSpeed, 0.0);
        float cloud1 = fbm(cloudUv1 * 4.0);
        cloud1 = smoothstep(0.4, 0.7, cloud1);

        // Cloud layer 2 (low altitude, slower, different direction)
        vec2 cloudUv2 = vUv * vec2(2.5, 1.2) + vec2(-uTime * uCloudSpeed * 0.6, uTime * 0.005);
        float cloud2 = fbm(cloudUv2 * 3.0 + 10.0);
        cloud2 = smoothstep(0.5, 0.8, cloud2);

        float totalCloud = min(1.0, (cloud1 + cloud2 * 0.6)) * uCloudDensity;

        // Composite
        vec3 col = mix(surface, uCloudColor, totalCloud);

        // Simple diffuse lighting from view direction
        float diffuse = max(dot(vNormal, vViewDir), 0.0) * 0.5 + 0.5;
        col *= diffuse;

        // Fresnel rim
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        col += uCloudColor * fresnel * 0.2;

        // Emissive
        col += uBaseColor * 0.1;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}
```

### 4B. Lava Planet with Flowing Magma Veins

```javascript
// ── LAVA PLANET — Flowing magma veins with hot glow ──
// Budget: 0 extra (replaces material)

function createLavaPlanetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvp.xyz);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 uv = vUv;

        // Crust: dark rock
        float rock = fbm(uv * 8.0 + vec2(0.0, uTime * 0.01));
        vec3 rockCol = mix(vec3(0.08, 0.05, 0.03), vec3(0.15, 0.1, 0.08), rock);

        // Magma veins: animated cracks
        float vein1 = fbm(uv * 6.0 + vec2(uTime * 0.03, uTime * 0.02));
        float vein2 = fbm(uv * 4.0 + vec2(-uTime * 0.02, uTime * 0.015) + 5.0);
        // Crack pattern — thin lines where noise crosses 0.5
        float crack1 = 1.0 - smoothstep(0.0, 0.06, abs(vein1 - 0.5));
        float crack2 = 1.0 - smoothstep(0.0, 0.08, abs(vein2 - 0.5));
        float magma = max(crack1, crack2 * 0.7);

        // Magma glow color (temperature gradient)
        vec3 magmaCol = mix(
          vec3(1.0, 0.2, 0.0),  // dark red
          vec3(1.0, 0.8, 0.1),  // bright yellow
          magma * magma
        );

        // Hot spots (wider magma pools)
        float pool = fbm(uv * 3.0 + uTime * 0.01 + 20.0);
        pool = smoothstep(0.65, 0.75, pool);
        magma = max(magma, pool * 0.6);

        vec3 col = mix(rockCol, magmaCol, magma);

        // Emission from magma
        col += magmaCol * magma * 0.8;

        // Lighting
        float diffuse = max(dot(vNormal, vViewDir), 0.0) * 0.3 + 0.7;
        col *= diffuse;

        // Hot rim (subsurface scattering fake)
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.0);
        col += vec3(1.0, 0.3, 0.0) * fresnel * magma * 0.5;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}
```

### 4C. Ocean Planet with Animated Waves

```javascript
// ── OCEAN PLANET — Animated wave normal perturbation ──
// Budget: 0 extra (replaces material)

function createOceanPlanetMaterial(deepColor, shallowColor) {
  deepColor = deepColor || new THREE.Color(0x001133);
  shallowColor = shallowColor || new THREE.Color(0x0066aa);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:         { value: 0 },
      uDeepColor:    { value: deepColor },
      uShallowColor: { value: shallowColor },
      uMap:          { value: null }, // optional land mask texture
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeepColor, uShallowColor;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        vec2 uv = vUv;

        // Wave normal perturbation (two layers, different speeds)
        vec2 wave1 = vec2(
          noise(uv * 20.0 + vec2(uTime * 0.08, uTime * 0.05)) - 0.5,
          noise(uv * 20.0 + vec2(uTime * 0.06, -uTime * 0.04) + 50.0) - 0.5
        ) * 0.08;

        vec2 wave2 = vec2(
          noise(uv * 40.0 + vec2(-uTime * 0.12, uTime * 0.07) + 100.0) - 0.5,
          noise(uv * 40.0 + vec2(uTime * 0.09, uTime * 0.11) + 150.0) - 0.5
        ) * 0.04;

        vec3 perturbedNormal = normalize(vNormal + vec3(wave1 + wave2, 0.0).xzy);

        // Fresnel for water
        float fresnel = pow(1.0 - max(dot(perturbedNormal, vViewDir), 0.0), 4.0);

        // Depth variation
        float depth = noise(uv * 5.0 + uTime * 0.005);

        // Water color
        vec3 waterCol = mix(uDeepColor, uShallowColor, depth * 0.5 + fresnel * 0.5);

        // Specular highlight (sun reflection)
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        vec3 halfDir = normalize(lightDir + vViewDir);
        float spec = pow(max(dot(perturbedNormal, halfDir), 0.0), 64.0);
        waterCol += vec3(1.0, 0.95, 0.8) * spec * 0.8;

        // Foam at wave peaks
        float foam = smoothstep(0.55, 0.6, noise(uv * 30.0 + vec2(uTime * 0.1, 0.0)));
        waterCol += vec3(0.8, 0.9, 1.0) * foam * 0.3;

        // Atmosphere edge glow
        waterCol += uShallowColor * fresnel * 0.3;

        gl_FragColor = vec4(waterCol, 1.0);
      }
    `
  });
}
```

### 4D. Ice Planet with Crystalline Shimmer

```javascript
// ── ICE PLANET — Crystalline cracks with shimmer ──
// Budget: 0 extra (replaces material)

function createIcePlanetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap:  { value: null },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      // Voronoi for crystal facets
      float voronoi(vec2 p) {
        vec2 n = floor(p);
        vec2 f = fract(p);
        float md = 8.0;
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = vec2(hash(n + g), hash(n + g + 100.0));
          vec2 r = g + o - f;
          float d = dot(r, r);
          md = min(md, d);
        }
        return sqrt(md);
      }

      void main() {
        vec2 uv = vUv;

        // Base ice color
        vec3 iceBase = mix(vec3(0.7, 0.85, 0.95), vec3(0.5, 0.7, 0.9), noise(uv * 4.0));

        // Cracks (Voronoi edges)
        float v1 = voronoi(uv * 12.0);
        float v2 = voronoi(uv * 6.0 + 3.0);
        float cracks = smoothstep(0.05, 0.0, v1) + smoothstep(0.08, 0.0, v2) * 0.5;
        vec3 crackCol = vec3(0.3, 0.6, 0.9); // Blue glow in cracks
        iceBase = mix(iceBase, crackCol, cracks * 0.6);

        // Crystalline shimmer (view-dependent iridescence)
        float shimmer = noise(uv * 50.0 + vViewDir.xy * 3.0 + uTime * 0.1);
        shimmer = pow(shimmer, 3.0);
        vec3 iridescentCol = vec3(
          0.5 + 0.5 * sin(shimmer * 6.28 + 0.0),
          0.5 + 0.5 * sin(shimmer * 6.28 + 2.09),
          0.5 + 0.5 * sin(shimmer * 6.28 + 4.18)
        );
        iceBase += iridescentCol * shimmer * 0.15;

        // Fresnel (ice is highly reflective at edges)
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        iceBase += vec3(0.8, 0.9, 1.0) * fresnel * 0.4;

        // Specular
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        vec3 halfDir = normalize(lightDir + vViewDir);
        float spec = pow(max(dot(vNormal, halfDir), 0.0), 128.0);
        iceBase += vec3(1.0) * spec * 0.6;

        // Subsurface light in cracks (animated)
        float subsurface = cracks * (0.5 + 0.5 * sin(uTime * 0.5 + uv.x * 10.0));
        iceBase += crackCol * subsurface * 0.3;

        gl_FragColor = vec4(iceBase, 1.0);
      }
    `
  });
}
```

### 4E. Gas Giant with Animated Band Flow

```javascript
// ── GAS GIANT — Jupiter-style animated bands with storm spots ──
// Budget: 0 extra (replaces material)

function createGasGiantMaterial(palette, seed) {
  // palette: array of vec3 colors, e.g. [[0.8,0.6,0.3],[0.6,0.4,0.2],...]
  // For simplicity, pass two main colors
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uSeed:   { value: seed || 42.0 },
      uColor1: { value: new THREE.Color(palette?.[0] || 0xcc8844) },
      uColor2: { value: new THREE.Color(palette?.[1] || 0x886633) },
      uColor3: { value: new THREE.Color(palette?.[2] || 0xeebb77) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvp.xyz);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSeed;
      uniform vec3 uColor1, uColor2, uColor3;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      float hash(vec2 p) { return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 uv = vUv;

        // Latitude-dependent flow speed (differential rotation)
        float lat = uv.y;
        float flowSpeed = 0.015 * (1.0 + sin(lat * 3.14159) * 0.5);
        vec2 flowUv = vec2(uv.x + uTime * flowSpeed, uv.y);

        // Banded structure
        float warp = fbm(flowUv * vec2(2.0, 4.0)) * 0.15;
        float bands = sin((lat + warp) * 3.14159 * 8.0) * 0.5 + 0.5;

        // Turbulence in bands
        float turb = fbm(flowUv * vec2(8.0, 4.0) + uTime * 0.01);
        float detail = fbm(flowUv * vec2(16.0, 8.0) - uTime * 0.005 + 20.0);

        float t = bands * 0.6 + turb * 0.3 + detail * 0.1;

        // Three-color palette blend
        vec3 col;
        if (t < 0.5) {
          col = mix(uColor1, uColor2, t * 2.0);
        } else {
          col = mix(uColor2, uColor3, (t - 0.5) * 2.0);
        }

        // Great storm spot (fixed latitude, rotating)
        vec2 stormCenter = vec2(
          fract(0.3 + uTime * 0.008),
          0.35 + hash(vec2(uSeed, 0.0)) * 0.3
        );
        float du = min(abs(uv.x - stormCenter.x), 1.0 - abs(uv.x - stormCenter.x));
        float dv = uv.y - stormCenter.y;
        float stormDist = sqrt(du * du * 4.0 + dv * dv) / 0.06;
        if (stormDist < 1.0) {
          // Spiral pattern inside storm
          float angle = atan(dv, du) + stormDist * 4.0 - uTime * 0.5;
          float spiral = sin(angle * 3.0) * 0.5 + 0.5;
          vec3 stormCol = mix(uColor3, vec3(1.0, 0.95, 0.85), spiral * 0.4);
          float blend = 1.0 - stormDist;
          blend = blend * blend;
          col = mix(col, stormCol, blend);
        }

        // Lighting
        float diffuse = max(dot(vNormal, vViewDir), 0.0) * 0.4 + 0.6;
        col *= diffuse;

        // Limb darkening
        float limb = max(dot(vNormal, vViewDir), 0.0);
        col *= 0.6 + 0.4 * limb;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}
```

### 4F. Ringed Planet with Rotating Particle Ring

Already in `vfx_shaders.js` as `createPlanetRings()`. Here is a lighter-weight version specifically optimized for the knowledge map's 217-planet context:

```javascript
// ── LIGHTWEIGHT RING — For specific planets, 1 draw call ──
// Budget: 1 draw call per ring

function createLightRing(innerR, outerR, color, seed) {
  const geo = new THREE.RingGeometry(innerR, outerR, 64, 1);
  // Fix UVs to radial
  const pos = geo.attributes.position;
  const uvs = geo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    uvs.setXY(i,
      (r - innerR) / (outerR - innerR),
      Math.atan2(y, x) / (Math.PI * 2) + 0.5
    );
  }

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(color || 0xccaa88) },
      uSeed:  { value: seed || 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSeed;
      uniform vec3 uColor;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n + uSeed) * 43758.5453); }

      void main() {
        float r = vUv.x; // 0=inner, 1=outer

        // Ring bands with gaps (Cassini division style)
        float band = 1.0;
        band *= smoothstep(0.0, 0.05, r); // inner fade
        band *= smoothstep(1.0, 0.95, r); // outer fade
        band *= 1.0 - 0.7 * smoothstep(0.0, 0.02, abs(r - 0.4)); // gap
        band *= 1.0 - 0.5 * smoothstep(0.0, 0.03, abs(r - 0.7)); // gap 2

        // Density variation
        float density = 0.5 + 0.5 * sin(r * 60.0 + uSeed * 10.0);
        density = mix(0.6, 1.0, density);

        // Slight sparkle rotation
        float angle = vUv.y * 6.2832;
        float sparkle = hash(floor(angle * 100.0 + r * 50.0 + uTime * 0.5));
        sparkle = step(0.97, sparkle);

        vec3 col = uColor * density;
        col += vec3(1.0) * sparkle * 0.3;

        float alpha = band * density * 0.6 + sparkle * 0.2;
        gl_FragColor = vec4(col, alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  // Tilt the ring
  mesh.rotation.x = Math.PI * 0.5 + (seed || 0) * 0.3;

  return {
    mesh,
    tick: function(time) {
      mat.uniforms.uTime.value = time;
      // Slow ring rotation
      mesh.rotation.z += 0.001;
    }
  };
}
```

### 4G. Bioluminescent Planet (Glowing Spots)

```javascript
// ── BIOLUMINESCENT PLANET — Glowing organic spots that pulse ──
// Budget: 0 extra (replaces material)

function createBioLumPlanetMaterial(baseColor, glowColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uBaseColor: { value: new THREE.Color(baseColor || 0x112211) },
      uGlowColor: { value: new THREE.Color(glowColor || 0x00ff88) },
      uMap:       { value: null },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvp.xyz);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBaseColor, uGlowColor;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      // Voronoi for organic cell shapes
      vec2 voronoi(vec2 p) {
        vec2 n = floor(p), f = fract(p);
        float md = 8.0, md2 = 8.0;
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = vec2(hash(n + g), hash(n + g + 100.0));
          // Animate cell centers slightly
          o = 0.5 + 0.4 * sin(uTime * 0.3 + 6.28 * o);
          float d = length(g + o - f);
          if (d < md) { md2 = md; md = d; }
          else if (d < md2) { md2 = d; }
        }
        return vec2(md, md2);
      }

      void main() {
        vec2 uv = vUv;
        vec3 col = uBaseColor;

        if (uMap != null) {
          col *= texture2D(uMap, uv).rgb;
        }

        // Bioluminescent spots (Voronoi cells)
        vec2 v = voronoi(uv * 8.0);
        float cellEdge = v.y - v.x; // edge detection
        float cellCenter = 1.0 - smoothstep(0.0, 0.3, v.x);

        // Pulsing glow per cell (different phase per cell position)
        float cellId = hash(floor(uv * 8.0));
        float pulse = sin(uTime * (1.0 + cellId * 2.0) + cellId * 6.28) * 0.5 + 0.5;

        // Network veins (edges between cells)
        float veins = smoothstep(0.05, 0.0, cellEdge);

        // Combine glow
        float glow = cellCenter * pulse * 0.6 + veins * 0.4;
        col += uGlowColor * glow;

        // Some cells darker (dormant)
        float dormant = step(0.6, cellId);
        col = mix(col, uBaseColor, dormant * 0.5);

        // Fresnel
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);
        col += uGlowColor * fresnel * 0.2;

        // Lighting
        float diffuse = max(dot(vNormal, vViewDir), 0.0) * 0.3 + 0.7;
        col *= diffuse;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}
```

---

## 5. Planet Idle Animations

### 5A. Slow Rotation

Already implemented in km_bh13.html:

```javascript
// In animate loop:
mesh.rotation.y += mesh.userData.rotSpeed;
```

### 5B. Cloud Layer at Different Speed

If using the cloud planet material from 4A, the cloud speed is controlled by `uCloudSpeed`. For a simpler approach without replacing materials on all 217 planets, animate the UV offset of a second texture. However, since Quest can only handle ~50 canvas textures total, this is best reserved for the focused planet only.

For ALL planets — inject a time-varying emissive pattern via a single shared uniform:

```javascript
// ── AMBIENT SHIMMER — Subtle animated emissive on all 217 planets ──
// Budget: 0 draw calls (modifies emissiveIntensity per frame)
// CPU cost: 217 Math.sin calls per frame (~negligible)

function updateAllPlanetShimmer(nodes, time) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.mesh || !n.mesh.material) continue;
    // Each planet shimmers at a slightly different frequency/phase
    const phase = n.id.charCodeAt(0) * 0.1 + n.id.charCodeAt(1) * 0.05;
    const shimmer = 0.015 + Math.sin(time * 0.5 + phase) * 0.008;
    n.mesh.material.emissiveIntensity = shimmer;
  }
}
```

### 5C. Aurora Effects at Poles

Applied only to focused planet or top-N planets. Zero extra draw calls — uses the planet's ShaderMaterial.

```javascript
// ── AURORA — Polar light curtain via vertex + fragment shader ──
// Budget: 1 draw call (thin cone mesh at planet poles)
// Only spawn on the focused planet

function createAurora(planetRadius, color) {
  // Cone mesh at the pole — open-ended, additive
  const coneH = planetRadius * 0.6;
  const coneR = planetRadius * 0.5;
  const geo = new THREE.ConeGeometry(coneR, coneH, 32, 8, true);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(color || 0x00ff66) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      varying float vAngle;
      uniform float uTime;
      void main() {
        vY = uv.y;
        vAngle = atan(position.x, position.z);

        // Vertex animation: wave the curtain
        vec3 p = position;
        float wave = sin(vAngle * 3.0 + uTime * 2.0) * 0.1;
        float wave2 = sin(vAngle * 7.0 - uTime * 1.5) * 0.05;
        p.x += p.x * (wave + wave2);
        p.z += p.z * (wave + wave2);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying float vY;
      varying float vAngle;

      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // Curtain pattern
        float curtain = sin(vAngle * 5.0 + uTime * 1.5) * 0.5 + 0.5;
        curtain *= sin(vAngle * 13.0 - uTime * 0.8) * 0.5 + 0.5;

        // Fade with height
        float heightFade = smoothstep(0.0, 0.2, vY) * smoothstep(1.0, 0.6, vY);

        // Color shift (green to purple at edges)
        vec3 col = mix(uColor, vec3(0.4, 0.1, 0.6), vY * 0.5);

        // Shimmer
        float shimmer = hash(floor(vAngle * 20.0) + floor(uTime * 4.0)) * 0.3;

        float alpha = curtain * heightFade * (0.15 + shimmer);
        gl_FragColor = vec4(col * 1.5, alpha);
      }
    `
  });

  const northAurora = new THREE.Mesh(geo, mat);
  northAurora.rotation.x = Math.PI; // flip for north pole
  northAurora.visible = false;

  // South aurora — clone and flip
  const southAurora = new THREE.Mesh(geo, mat.clone());
  southAurora.visible = false;

  return {
    north: northAurora,
    south: southAurora,
    show: function(node) {
      const r = node.size * 2.2 * 5;
      northAurora.position.set(node.x, node.y + r * 0.85, node.z);
      southAurora.position.set(node.x, node.y - r * 0.85, node.z);
      northAurora.scale.setScalar(r * 0.01); // scale adjusted to planet
      southAurora.scale.setScalar(r * 0.01);
      northAurora.visible = true;
      southAurora.visible = true;
    },
    hide: function() {
      northAurora.visible = false;
      southAurora.visible = false;
    },
    tick: function(time) {
      mat.uniforms.uTime.value = time;
      if (southAurora.material !== mat) {
        southAurora.material.uniforms.uTime.value = time;
      }
    }
  };
}
```

### 5D. Lightning Flashes in Atmosphere

Zero extra draw calls — brief emissive spike on the atmosphere sprite.

```javascript
// ── LIGHTNING FLASH — Random brief brightness spikes on atmosphere ──
// Budget: 0 draw calls (modifies existing sprite opacity)
// Applied to focused planet only, or randomly to nearby planets

function updateLightningFlash(node, time) {
  if (!node._nextFlash) {
    node._nextFlash = time + 2 + Math.random() * 8; // 2-10 seconds between flashes
  }
  if (time > node._nextFlash) {
    node._flashEnd = time + 0.05 + Math.random() * 0.1; // 50-150ms flash
    node._nextFlash = time + 2 + Math.random() * 8;
    // Double-flash 30% of the time
    if (Math.random() < 0.3) {
      node._flash2Start = time + 0.15;
      node._flash2End = time + 0.2;
    }
  }

  let flashIntensity = 0;
  if (node._flashEnd && time < node._flashEnd) {
    flashIntensity = 1.0;
  }
  if (node._flash2Start && time > node._flash2Start && time < node._flash2End) {
    flashIntensity = 0.7;
  }

  if (flashIntensity > 0 && node.atmMat) {
    node.atmMat.opacity = 0.3 + flashIntensity * 0.5;
    node.mesh.material.emissiveIntensity = 0.015 + flashIntensity * 0.3;
  }
}
```

### 5E. Meteor Impacts (Brief Surface Flash)

```javascript
// ── METEOR IMPACT — Brief flash at random point on surface ──
// Budget: 0 extra draw calls (emissive manipulation)
// For visual pop, combine with a sprite flash

function createMeteorImpactManager(scene) {
  // Reuse a single small sprite for impact flash
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.visible = false;
  scene.add(flashMesh);

  let _active = false;
  let _startTime = 0;
  let _duration = 0.3;

  return {
    trigger: function(node, time) {
      if (_active) return;
      _active = true;
      _startTime = time;

      const planetR = node.size * 2.2 * 5;
      // Random point on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      flashMesh.position.set(
        node.x + Math.sin(phi) * Math.cos(theta) * planetR * 1.02,
        node.y + Math.cos(phi) * planetR * 1.02,
        node.z + Math.sin(phi) * Math.sin(theta) * planetR * 1.02
      );
      flashMesh.scale.setScalar(planetR * 0.3);
      flashMesh.visible = true;
    },

    tick: function(time, camera) {
      if (!_active) return;
      const t = (time - _startTime) / _duration;
      if (t >= 1) {
        _active = false;
        flashMesh.visible = false;
        flashMat.opacity = 0;
        return;
      }
      flashMat.opacity = (1 - t) * 0.8;
      flashMesh.scale.setScalar(flashMesh.scale.x * (1 + t * 0.5));
      flashMesh.lookAt(camera.position);
    }
  };
}
```

### 5F. Orbiting Debris / Asteroids

For focused planet only. Single instanced draw call.

```javascript
// ── ORBITING DEBRIS — Small rocks orbiting focused planet ──
// Budget: 1 draw call (InstancedMesh)

function createOrbitalDebris(scene, count) {
  count = count || 20;
  const geo = new THREE.TetrahedronGeometry(1, 0); // 4 triangles per asteroid
  const mat = new THREE.MeshPhongMaterial({
    color: 0x666666,
    emissive: 0x222222,
    emissiveIntensity: 0.1,
    flatShading: true,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.visible = false;
  scene.add(mesh);

  const _dummy = new THREE.Object3D();
  const _orbitData = [];
  for (let i = 0; i < count; i++) {
    _orbitData.push({
      angle: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.5,
      radius: 0, // set on show()
      tilt: (Math.random() - 0.5) * 0.6,
      size: 0.3 + Math.random() * 0.7,
      rotSpeed: 1 + Math.random() * 3,
    });
  }

  return {
    mesh,
    show: function(node) {
      const planetR = node.size * 2.2 * 5;
      for (let i = 0; i < count; i++) {
        _orbitData[i].radius = planetR * (2.0 + Math.random() * 1.5);
        _orbitData[i].cx = node.x;
        _orbitData[i].cy = node.y;
        _orbitData[i].cz = node.z;
      }
      mesh.visible = true;
    },
    hide: function() { mesh.visible = false; },
    tick: function(time) {
      if (!mesh.visible) return;
      for (let i = 0; i < count; i++) {
        const d = _orbitData[i];
        const a = d.angle + time * d.speed;
        _dummy.position.set(
          d.cx + Math.cos(a) * d.radius,
          d.cy + Math.sin(a * 0.3 + d.tilt) * d.radius * 0.15,
          d.cz + Math.sin(a) * d.radius
        );
        _dummy.scale.setScalar(d.size);
        _dummy.rotation.set(time * d.rotSpeed, time * d.rotSpeed * 0.7, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
}
```

---

## 6. Planet Connection Effects

### 6A. Pulsing Glow Lines Between Related Planets

Already in vfx_shaders.js as `createConstellationLine()`. Here is a version optimized for 217 planets with potentially hundreds of connections, using a single merged BufferGeometry:

```javascript
// ── MERGED CONNECTION LINES — All connections in 1 draw call ──
// Budget: 1 draw call for ALL connections (single BufferGeometry)
// This is the CRITICAL optimization for Quest 3

function createConnectionSystem(maxConnections) {
  maxConnections = maxConnections || 500;
  const SEGS_PER_LINE = 2; // Just endpoints — straight lines
  const totalVerts = maxConnections * SEGS_PER_LINE;

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const progress = new Float32Array(totalVerts); // for pulse animation
  const lineIndex = new Float32Array(totalVerts); // which line this vert belongs to

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geo.setAttribute('aLineId', new THREE.BufferAttribute(lineIndex, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPulseSpeed: { value: 0.5 },
      uBaseAlpha: { value: 0.08 },
    },
    vertexShader: /* glsl */ `
      attribute float aProgress;
      attribute float aLineId;
      varying float vAlpha;
      varying vec3 vColor;
      uniform float uTime, uPulseSpeed, uBaseAlpha;
      void main() {
        vColor = color;
        // Pulse traveling along line, unique phase per line
        float phase = aLineId * 0.618; // golden ratio spacing
        float pulsePos = fract(uTime * uPulseSpeed + phase);
        float dist = min(abs(aProgress - pulsePos), 1.0 - abs(aProgress - pulsePos));
        vAlpha = uBaseAlpha + exp(-dist * dist * 50.0) * 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor * 1.5, vAlpha);
      }
    `
  });

  const lines = new THREE.LineSegments(geo, mat);
  let _activeCount = 0;

  return {
    lines,
    // Build all connections at init time
    setConnections: function(connectionList) {
      // connectionList: [{from: node, to: node, color: THREE.Color}, ...]
      _activeCount = Math.min(connectionList.length, maxConnections);
      for (let i = 0; i < _activeCount; i++) {
        const c = connectionList[i];
        const idx = i * SEGS_PER_LINE;

        // Start point
        positions[idx * 3]     = c.from.x;
        positions[idx * 3 + 1] = c.from.y;
        positions[idx * 3 + 2] = c.from.z;
        // End point
        positions[(idx + 1) * 3]     = c.to.x;
        positions[(idx + 1) * 3 + 1] = c.to.y;
        positions[(idx + 1) * 3 + 2] = c.to.z;

        const col = c.color || new THREE.Color(0x4488cc);
        colors[idx * 3]     = col.r; colors[idx * 3 + 1] = col.g; colors[idx * 3 + 2] = col.b;
        colors[(idx+1) * 3] = col.r; colors[(idx+1) * 3 + 1] = col.g; colors[(idx+1) * 3 + 2] = col.b;

        progress[idx] = 0;
        progress[idx + 1] = 1;

        lineIndex[idx] = i;
        lineIndex[idx + 1] = i;
      }
      geo.setDrawRange(0, _activeCount * SEGS_PER_LINE);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.aProgress.needsUpdate = true;
      geo.attributes.aLineId.needsUpdate = true;
    },

    // Highlight connections to/from a specific node
    highlightNode: function(node) {
      // Increase alpha for this node's connections
      mat.uniforms.uBaseAlpha.value = 0.15;
    },
    unhighlight: function() {
      mat.uniforms.uBaseAlpha.value = 0.08;
    },

    tick: function(time) {
      mat.uniforms.uTime.value = time;
    }
  };
}
```

### 6B. Energy Beam for Navigation

Already in vfx_shaders.js as `createEnergyBeam()`. Use it when navigating between planets:

```javascript
// ── NAVIGATION BEAM — Fire when jumping between planets ──
// Budget: 2-3 draw calls (beam + glow), temporary

function fireNavigationBeam(scene, fromNode, toNode, duration) {
  duration = duration || 1.5;
  const start = new THREE.Vector3(fromNode.x, fromNode.y, fromNode.z);
  const end = new THREE.Vector3(toNode.x, toNode.y, toNode.z);
  const color1 = fromNode.mesh.material.color?.getHex?.() || 0x4488ff;
  const color2 = toNode.mesh.material.color?.getHex?.() || 0xff4488;

  const beam = createEnergyBeam(start, end, color1, color2);
  scene.add(beam.group);

  const startTime = performance.now() / 1000;
  let disposed = false;

  return {
    tick: function(time) {
      if (disposed) return true;
      beam.tick(time);
      const elapsed = time - startTime;
      if (elapsed > duration) {
        scene.remove(beam.group);
        disposed = true;
        return true; // done
      }
      // Fade out in last 30%
      const fade = elapsed > duration * 0.7
        ? 1.0 - (elapsed - duration * 0.7) / (duration * 0.3)
        : 1.0;
      beam.group.children.forEach(c => {
        if (c.material) c.material.opacity *= fade;
      });
      return false;
    }
  };
}
```

### 6C. Domain Constellation Highlight

```javascript
// ── DOMAIN CONSTELLATION — Highlight all planets in same domain ──
// Budget: 1 draw call (LineSegments connecting same-domain planets)

function createDomainConstellation(nodes, domainColors) {
  // Pre-compute connection pairs per domain
  const domainNodes = {};
  nodes.forEach(n => {
    if (!domainNodes[n.domain]) domainNodes[n.domain] = [];
    domainNodes[n.domain].push(n);
  });

  // Build a spanning tree per domain (not fully connected — too many lines)
  const pairs = [];
  Object.keys(domainNodes).forEach(domain => {
    const dns = domainNodes[domain];
    if (dns.length < 2) return;
    // Connect each node to its nearest neighbor in the domain
    for (let i = 1; i < dns.length; i++) {
      let bestDist = Infinity, bestJ = 0;
      for (let j = 0; j < i; j++) {
        const dx = dns[i].x - dns[j].x;
        const dy = dns[i].y - dns[j].y;
        const dz = dns[i].z - dns[j].z;
        const d = dx*dx + dy*dy + dz*dz;
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      pairs.push({
        from: dns[i],
        to: dns[bestJ],
        color: new THREE.Color(domainColors[domain] || '#aaaaaa'),
      });
    }
  });

  // Now use the connection system from 6A
  const system = createConnectionSystem(pairs.length);
  system.setConnections(pairs);
  system.lines.visible = false; // hidden by default

  return {
    lines: system.lines,
    showDomain: function(domain) {
      // Show only this domain's connections
      // For simplicity, show all but boost the matching domain's alpha
      system.lines.visible = true;
    },
    hide: function() {
      system.lines.visible = false;
    },
    tick: function(time) {
      if (system.lines.visible) system.tick(time);
    }
  };
}
```

### 6D. Gravitational Distortion Lines

Visual indicator of planet "mass" (importance). Uses curved lines bending toward large planets.

```javascript
// ── GRAVITY FIELD LINES — Curved lines bending toward massive planets ──
// Budget: 1 draw call (single LineSegments)

function createGravityFieldLines(scene, majorNodes, lineCount) {
  lineCount = lineCount || 40;
  const SEGS = 8; // points per line
  const totalVerts = lineCount * SEGS;
  const positions = new Float32Array(totalVerts * 3);
  const alphas = new Float32Array(totalVerts);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x334466) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      uniform float uTime;
      void main() {
        vAlpha = aAlpha * (0.5 + 0.5 * sin(uTime + aAlpha * 6.28));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * 0.3);
      }
    `
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.visible = false;
  scene.add(lines);

  return {
    lines,
    buildAround: function(node) {
      // Generate field lines radiating from node, curving toward nearby major planets
      const center = new THREE.Vector3(node.x, node.y, node.z);
      const planetR = node.size * 2.2 * 5;

      for (let i = 0; i < lineCount; i++) {
        // Random direction from planet
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const dir = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );

        for (let j = 0; j < SEGS; j++) {
          const t = j / (SEGS - 1);
          const r = planetR * (1.5 + t * 4);
          const idx = (i * SEGS + j) * 3;
          positions[idx]     = center.x + dir.x * r;
          positions[idx + 1] = center.y + dir.y * r;
          positions[idx + 2] = center.z + dir.z * r;
          alphas[i * SEGS + j] = 1.0 - t;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      lines.visible = true;
    },
    hide: function() { lines.visible = false; },
    tick: function(time) {
      if (lines.visible) mat.uniforms.uTime.value = time;
    }
  };
}
```

---

## 7. Performance Strategy for 217 Planets on Quest 3

### Draw Call Budget

| Component | Count | Draw Calls | Notes |
|-----------|-------|------------|-------|
| Planet meshes | 217 | 217 | Shared geometry, individual materials |
| Atmosphere sprites | 217 | 217* | *Batched by Three.js if same material |
| Fresnel atmosphere | 30 | 30 | Top 30 planets only |
| Stars | 1 | 1 | Single Points mesh |
| Skybox | 1 | 1 | Single sphere |
| Connection lines | 1 | 1 | Merged LineSegments |
| Black hole + disk | 2 | 2 | |
| **Subtotal (always on)** | | **~270** | OVER BUDGET |

### Reduction Strategies

1. **InstancedMesh for planets** (BIGGEST WIN): Replace 217 individual meshes with 1 InstancedMesh. Requires per-instance color via instanced attribute instead of individual materials. Saves ~216 draw calls.

```javascript
// ── INSTANCED PLANETS — 217 planets in 1 draw call ──
function createInstancedPlanets(nodes, sphereGeo) {
  const count = nodes.length;

  // Custom ShaderMaterial with per-instance color + texture atlas UV
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAtlas: { value: null }, // texture atlas for all planets
    },
    vertexShader: /* glsl */ `
      attribute vec3 instanceColor;
      attribute float instanceRotSpeed;
      attribute vec4 instanceUvRect; // x,y = offset, z,w = size in atlas

      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vColor = instanceColor;
        vNormal = normalize(normalMatrix * normal);

        // Per-instance rotation
        float angle = uTime * instanceRotSpeed;
        float ca = cos(angle), sa = sin(angle);
        vec3 rotated = vec3(
          position.x * ca - position.z * sa,
          position.y,
          position.x * sa + position.z * ca
        );

        // Atlas UV mapping
        vUv = uv * instanceUvRect.zw + instanceUvRect.xy;

        vec4 mvPos = modelViewMatrix * vec4(rotated, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 tex = texture2D(uAtlas, vUv).rgb;
        vec3 col = tex * vColor;
        float diff = max(dot(vNormal, vViewDir), 0.0) * 0.5 + 0.5;
        col *= diff;
        col += vColor * 0.15; // emissive
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        col += vColor * fresnel * 0.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const mesh = new THREE.InstancedMesh(sphereGeo, mat, count);

  // Set up per-instance attributes
  const instanceColors = new Float32Array(count * 3);
  const instanceRotSpeeds = new Float32Array(count);
  const instanceUvRects = new Float32Array(count * 4);

  const dummy = new THREE.Object3D();
  const PLANET_SCALE = 5;

  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    dummy.position.set(n.x, n.y, n.z);
    dummy.scale.setScalar(n.size * 2.2 * PLANET_SCALE);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const col = new THREE.Color(n.domainColor || '#aaaaaa');
    instanceColors[i * 3] = col.r;
    instanceColors[i * 3 + 1] = col.g;
    instanceColors[i * 3 + 2] = col.b;

    instanceRotSpeeds[i] = 0.0015 + (n.id.charCodeAt(0) % 10) * 0.0003;

    // Atlas UV rect (compute based on grid layout)
    const atlasW = 16; // 16x16 grid = 256 slots for 217 planets
    const ax = (i % atlasW) / atlasW;
    const ay = Math.floor(i / atlasW) / atlasW;
    instanceUvRects[i * 4] = ax;
    instanceUvRects[i * 4 + 1] = ay;
    instanceUvRects[i * 4 + 2] = 1.0 / atlasW;
    instanceUvRects[i * 4 + 3] = 1.0 / atlasW;
  }

  mesh.geometry.setAttribute('instanceColor',
    new THREE.InstancedBufferAttribute(instanceColors, 3));
  mesh.geometry.setAttribute('instanceRotSpeed',
    new THREE.InstancedBufferAttribute(instanceRotSpeeds, 1));
  mesh.geometry.setAttribute('instanceUvRect',
    new THREE.InstancedBufferAttribute(instanceUvRects, 4));

  mesh.instanceMatrix.needsUpdate = true;

  return { mesh, mat };
}
// 217 planets → 1 draw call. Saves ~216 draw calls.
```

2. **Texture Atlas**: Bake all 217 planet textures into a single atlas (16x16 grid of 128x64 tiles = 2048x1024 texture). One texture bind instead of 217.

```javascript
// ── TEXTURE ATLAS BAKING ──
function bakeTextureAtlas(renderer, nodes, bakeScene, bakeCam, bakeMat) {
  const TILE_W = 128, TILE_H = 64;
  const GRID = 16; // 16x16 = 256 slots
  const atlasRT = new THREE.WebGLRenderTarget(TILE_W * GRID, TILE_H * GRID, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const viewport = new THREE.Vector4();

  renderer.setRenderTarget(atlasRT);
  renderer.clear();

  for (let i = 0; i < nodes.length && i < GRID * GRID; i++) {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    viewport.set(col * TILE_W, row * TILE_H, TILE_W, TILE_H);
    renderer.setViewport(viewport);
    renderer.setScissor(viewport);
    renderer.setScissorTest(true);

    // Configure bake material for this planet's type/seed
    // bakeMat.uniforms.uSeed.value = nodes[i].seed;
    // bakeMat.uniforms.uType.value = nodes[i].planetType;

    renderer.render(bakeScene, bakeCam);
  }

  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);

  return atlasRT.texture;
}
```

3. **Sprite batching for atmospheres**: Use a single Points mesh with 217 points for all atmosphere glows instead of 217 Sprites.

```javascript
// ── ATMOSPHERE POINTS — All 217 glows in 1 draw call ──
function createAtmospherePoints(nodes, glowTexture) {
  const count = nodes.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    positions[i * 3]     = n.x;
    positions[i * 3 + 1] = n.y;
    positions[i * 3 + 2] = n.z;

    const col = new THREE.Color(n.domainColor || '#aaaaaa');
    colors[i * 3]     = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    sizes[i] = n.size * 2.2 * 5 * 2.5; // planet scale * glow multiplier
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    vertexColors: true,
    uniforms: {
      uMap: { value: glowTexture },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColor;
      varying float vSize;
      void main() {
        vColor = color;
        vSize = size;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        // sizeAttenuation: true equivalent but controllable
        gl_PointSize = size * (300.0 / -mvPos.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 128.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * tex.rgb, tex.a * 0.3);
      }
    `
  });

  return new THREE.Points(geo, mat);
  // 217 atmospheres → 1 draw call
}
```

### Optimized Budget (After Instancing)

| Component | Draw Calls |
|-----------|------------|
| Instanced planets | 1 |
| Atmosphere points | 1 |
| Fresnel atm (top 30) | 30 |
| Stars | 1 |
| Skybox | 1 |
| Connections | 1 |
| Black hole + disk | 2 |
| Selection effects (focused) | 3-5 |
| Hover effects | 2 |
| **Total** | **~43-45** |

This is well within Quest 3's safe limit of <200.

### Additional Performance Notes

- **Shader complexity**: Quest 3 GPU (Adreno 740) handles fragment shaders well but struggles with many draw calls. Prefer complex shaders on few objects over simple shaders on many objects.
- **Texture size**: The atlas at 2048x1024 is well within Quest 3's 4096x4096 limit.
- **FBM octaves**: Keep to 4-5 octaves max in fragment shaders. Each octave is a texture fetch equivalent in cost.
- **Transparent sorting**: Minimize overlapping transparent objects. The atmosphere Points mesh handles this by being a single sorted layer.
- **Uniform updates**: Updating 1-5 uniforms per frame for effects on the focused planet is negligible.
- **Vertex count**: Each planet at 16x12 segments = 192 vertices. With InstancedMesh, that's 192 vertices * 217 instances = ~41k vertices. Well under the 100k triangle limit.
- **Avoid**: `discard` in fragment shaders on large surfaces (breaks early-Z), frequent geometry.dispose(), runtime BufferGeometry creation.

---

## 8. Integration Pattern

```javascript
// ── RECOMMENDED ANIMATE LOOP STRUCTURE ──

// Init phase
const orbitIndicator = createOrbitIndicator(0xffffff);
scene.add(orbitIndicator.dot);
scene.add(orbitIndicator.trail);

const hoverParticles = createHoverParticleRing();
scene.add(hoverParticles.points);

const energyShield = createEnergyShield(1, 0x44aaff);
scene.add(energyShield.mesh);

const debris = createOrbitalDebris(scene);
const aurora = createAurora(1, 0x00ff66);
scene.add(aurora.north);
scene.add(aurora.south);

// In animate(time):
function animatePlanetEffects(time, dt) {
  // Hover effects (applied to hoveredNode)
  if (hoveredNode) {
    applyHoverGlow(hoveredNode, true);
    showOutline(hoveredNode, scene);
    hoverParticles.show(hoveredNode);
    hoverParticles.tick(time, dt);
  } else {
    hideOutline();
    hoverParticles.hide();
  }

  // Selection effects (applied to focusedNode)
  if (focusedNode) {
    updateAuraPulse(focusedNode, time, true);
    updateFresnelPulse(focusedNode, time, true);
    updateScalePulse(focusedNode, time, true);
    orbitIndicator.show(focusedNode);
    orbitIndicator.tick(focusedNode, time, camera);
    energyShield.activate(focusedNode);
    energyShield.tick(time, dt);
    debris.show(focusedNode);
    debris.tick(time);
    aurora.show(focusedNode);
    aurora.tick(time);
    updateAtmosphereByDistance(focusedNode, camera);
    updateLightningFlash(focusedNode, time);
  } else {
    orbitIndicator.hide();
    energyShield.deactivate();
    debris.hide();
    aurora.hide();
  }

  // Ambient (all planets, cheap)
  updateAllPlanetShimmer(nodes, time);

  // Unhover non-hovered nodes
  nodes.forEach(n => {
    if (n !== hoveredNode && n !== focusedNode) {
      applyHoverGlow(n, false);
    }
  });
}
```

---

## 9. VR-Specific Gotchas

1. **sizeAttenuation**: Use `false` for Points in VR. `true` causes massive particles at VR scale.
2. **galaxyGroup scale**: All positions above assume world-space. If using galaxyGroup at 0.002 scale, multiply all effect sizes accordingly or add effects inside galaxyGroup.
3. **depthTest: false** on atmospheres prevents z-fighting in stereo.
4. **Additive blending overlap**: Too many additive-blended layers stacking = washed out white. Limit to 2-3 additive layers per planet max.
5. **controller ray intersection**: Use angle-based picking (from CLAUDE.md), not raycasting, for hover detection.
6. **Frame budget**: Quest 3 targets 72fps = 13.9ms per frame. Keep all effect updates under 2ms combined.
