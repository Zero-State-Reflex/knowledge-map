# Star Visual Effects — Quest 3 WebXR Reference

All code targets Three.js r152 global build (`THREE.*`), no EffectComposer, no modules.
Budget: under 200 draw calls total, vertex-shader-driven animation, zero CPU per-particle cost.

---

## Table of Contents

1. [Star Rendering Techniques](#1-star-rendering-techniques)
2. [Star Field Effects](#2-star-field-effects)
3. [Constellation Effects](#3-constellation-effects)
4. [Nebula and Gas Cloud Effects](#4-nebula-and-gas-cloud-effects)
5. [Performance Notes for Quest 3](#5-performance-notes-for-quest-3)

---

## 1. Star Rendering Techniques

### 1A. Points vs Billboard Quads vs InstancedMesh

| Technique | Draw Calls | Triangle Count | Best For |
|-----------|-----------|----------------|----------|
| `THREE.Points` + ShaderMaterial | **1** | 0 (point sprites) | 5k-10k background stars |
| InstancedMesh (quad planes) | **1** | 2 per star | 50-200 featured stars with custom shapes |
| Individual billboard sprites | N per star | 2 each | Avoid on Quest |

**Verdict for Quest 3:** Use `THREE.Points` with a custom `ShaderMaterial` for the bulk star field (1 draw call for thousands of stars). Use a single `InstancedMesh` of quads for 20-50 "hero" stars that need glow halos (1 draw call). Total: 2 draw calls for the entire sky.

### 1B. ShaderMaterial Star Points with Per-Star Twinkle, Color, and Glow

This is the workhorse. One `THREE.Points` object, one draw call, handles twinkle, spectral color, variable brightness, and a soft glow disc all in the fragment shader.

```javascript
function createStarField(count, radius) {
  const positions = new Float32Array(count * 3);
  const temps     = new Float32Array(count);     // color temperature class
  const seeds     = new Float32Array(count);     // unique per-star random
  const baseSizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform distribution on sphere
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    positions[i*3]   = radius * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i*3+2] = radius * Math.cos(phi);

    // Spectral class: 0=M(red) 1=K(orange) 2=G(yellow) 3=F(white)
    //                 4=A(blue-white) 5=B(blue) 6=O(deep blue)
    // Weighted toward cooler stars (realistic distribution)
    const r = Math.random();
    temps[i] = r < 0.40 ? 0.0   // M — 40%
             : r < 0.65 ? 1.0   // K — 25%
             : r < 0.80 ? 2.0   // G — 15%
             : r < 0.90 ? 3.0   // F — 10%
             : r < 0.96 ? 4.0   // A — 6%
             : r < 0.99 ? 5.0   // B — 3%
             : 6.0;              // O — 1%

    seeds[i] = Math.random() * 100.0;

    // Size distribution: most tiny, few medium, rare bright
    const s = Math.random();
    baseSizes[i] = s < 0.85 ? 0.8 + Math.random() * 1.0
                 : s < 0.96 ? 2.0 + Math.random() * 2.0
                 : 4.0 + Math.random() * 3.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aTemp',     new THREE.BufferAttribute(temps, 1));
  geo.setAttribute('aSeed',     new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aBaseSize', new THREE.BufferAttribute(baseSizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float aTemp;
      attribute float aSeed;
      attribute float aBaseSize;

      varying float vTemp;
      varying float vBrightness;

      uniform float uTime;

      // Pseudo-random hash
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      void main() {
        vTemp = aTemp;

        // ── Twinkle / scintillation ──
        // Multiple sine waves at different frequencies = organic flicker
        float t = uTime;
        float flicker = sin(t * 1.7 + aSeed * 6.28) * 0.15
                      + sin(t * 3.1 + aSeed * 12.56) * 0.10
                      + sin(t * 7.3 + aSeed * 3.14) * 0.05;

        // Occasional deep dip (atmospheric scintillation)
        float dip = smoothstep(0.85, 1.0, sin(t * 0.4 + aSeed * 25.0)) * 0.4;

        vBrightness = clamp(0.7 + flicker - dip, 0.15, 1.0);

        // ── Variable star pulsing (only for ~5% of stars) ──
        float isVariable = step(0.95, hash(aSeed));
        float pulse = sin(t * (0.3 + hash(aSeed + 1.0) * 0.7)) * 0.4;
        vBrightness += isVariable * pulse;
        vBrightness = clamp(vBrightness, 0.1, 1.2);

        // ── Size ──
        float size = aBaseSize * (0.85 + flicker * 0.3);
        // Variable stars physically grow/shrink
        size += isVariable * pulse * 1.5;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(size, 0.5);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vTemp;
      varying float vBrightness;

      // ── Blackbody color from spectral class index ──
      // Pre-baked RGB for each class (in linear space)
      vec3 spectralColor(float temp) {
        // M=0  K=1  G=2  F=3  A=4  B=5  O=6
        vec3 M = vec3(1.0, 0.50, 0.20);  // 3000K  red-orange
        vec3 K = vec3(1.0, 0.72, 0.42);  // 4500K  orange
        vec3 G = vec3(1.0, 0.92, 0.70);  // 5500K  yellow (Sun)
        vec3 F = vec3(1.0, 0.97, 0.90);  // 6500K  yellow-white
        vec3 A = vec3(0.85, 0.90, 1.0);  // 8500K  white-blue
        vec3 B = vec3(0.68, 0.78, 1.0);  // 20000K blue
        vec3 O = vec3(0.55, 0.62, 1.0);  // 40000K deep blue

        // Discrete lookup with slight blend between neighbors
        float t = clamp(temp, 0.0, 6.0);
        if (t < 1.0) return mix(M, K, t);
        if (t < 2.0) return mix(K, G, t - 1.0);
        if (t < 3.0) return mix(G, F, t - 2.0);
        if (t < 4.0) return mix(F, A, t - 3.0);
        if (t < 5.0) return mix(A, B, t - 4.0);
        return mix(B, O, t - 5.0);
      }

      void main() {
        // ── Soft circle with glow halo ──
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float dist = length(uv);

        // Hard bright core
        float core = 1.0 - smoothstep(0.0, 0.35, dist);
        // Soft glow falloff (the "halo")
        float glow = exp(-dist * dist * 3.5) * 0.6;
        // Faint outer corona
        float corona = exp(-dist * 1.8) * 0.15;

        float alpha = core + glow + corona;
        alpha *= vBrightness;

        if (alpha < 0.01) discard;

        vec3 color = spectralColor(vTemp);
        // Core is white-hot, halo shows star color
        vec3 coreColor = mix(color, vec3(1.0), 0.7);
        vec3 finalColor = mix(color * (glow + corona), coreColor * core, core);
        finalColor *= vBrightness;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false; // sky sphere always visible

  return { mesh: stars, material: mat };
}

// Usage:
const starField = createStarField(8000, 9000);
scene.add(starField.mesh);

// In animation loop:
function animate() {
  const t = performance.now() * 0.001;
  starField.material.uniforms.uTime.value = t;
}
```

**Draw calls: 1.** Handles twinkle, spectral color, variable stars, glow halo, and corona — all GPU-side.

---

### 1C. Spectral Class Color Reference

| Class | Temp (K) | RGB (linear) | Example Stars |
|-------|----------|-------------|---------------|
| O | 30,000-50,000 | (0.55, 0.62, 1.0) | Naos, Zeta Puppis |
| B | 10,000-30,000 | (0.68, 0.78, 1.0) | Rigel, Spica |
| A | 7,500-10,000 | (0.85, 0.90, 1.0) | Sirius, Vega |
| F | 6,000-7,500 | (1.0, 0.97, 0.90) | Canopus, Procyon |
| G | 5,200-6,000 | (1.0, 0.92, 0.70) | Sun, Alpha Centauri A |
| K | 3,700-5,200 | (1.0, 0.72, 0.42) | Arcturus, Aldebaran |
| M | 2,400-3,700 | (1.0, 0.50, 0.20) | Betelgeuse, Proxima Centauri |

### 1D. Blackbody Kelvin-to-RGB GLSL Function

For cases where you want continuous temperature mapping (e.g., heating/cooling effects):

```glsl
// Based on Tanner Helland / Neil Bartlett approximation
// Input: temperature in Kelvin (1000-40000)
// Output: linear RGB
vec3 blackbody(float tempK) {
  float t = clamp(tempK, 1000.0, 40000.0) / 100.0;
  vec3 color;

  // Red
  if (t <= 66.0) {
    color.r = 1.0;
  } else {
    color.r = 1.292936186 * pow(t - 60.0, -0.1332047592);
  }

  // Green
  if (t <= 66.0) {
    color.g = 0.3900815788 * log(t) - 0.6318414438;
  } else {
    color.g = 1.129890861 * pow(t - 60.0, -0.0755148492);
  }

  // Blue
  if (t >= 66.0) {
    color.b = 1.0;
  } else if (t <= 19.0) {
    color.b = 0.0;
  } else {
    color.b = 0.5432067891 * log(t - 10.0) - 1.19625409;
  }

  return clamp(color, 0.0, 1.0);
}
```

---

### 1E. Hero Star Glow Halos (InstancedMesh Billboard Quads)

For 20-50 prominent stars that need large visible glow halos (brighter than what point sprites can achieve), use a single InstancedMesh of camera-facing quads:

```javascript
function createHeroStarHalos(starPositions, starColors, starSizes) {
  // starPositions: array of THREE.Vector3
  // starColors: array of THREE.Color
  // starSizes: array of float (world-space radius)
  const count = starPositions.length;
  const geo = new THREE.PlaneGeometry(2, 2); // unit quad, scaled per instance

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vPulse;

      uniform float uTime;

      attribute vec3 instanceColor;

      void main() {
        vUv = uv;
        vColor = instanceColor;

        // Billboard: extract camera-right and camera-up from view matrix
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

        // Instance transform gives us position and scale
        vec3 worldPos = (instanceMatrix * vec4(0,0,0,1)).kind;
        float scale   = length((instanceMatrix * vec4(1,0,0,0)).xyz);

        vec3 vertPos = worldPos
                     + camRight * position.x * scale
                     + camUp    * position.y * scale;

        gl_Position = projectionMatrix * viewMatrix * vec4(vertPos, 1.0);

        vPulse = sin(uTime * 1.5 + float(gl_InstanceID) * 2.5) * 0.15 + 1.0;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vPulse;

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float dist = length(uv);

        // Bright core
        float core = exp(-dist * dist * 20.0);
        // Inner glow
        float glow = exp(-dist * dist * 3.0) * 0.5;
        // Outer halo
        float halo = exp(-dist * 1.5) * 0.12;
        // Diffraction spikes (4-point star)
        float spikes = 0.0;
        float ax = abs(uv.x);
        float ay = abs(uv.y);
        spikes += exp(-ax * 12.0) * exp(-ay * 80.0) * 0.3;
        spikes += exp(-ay * 12.0) * exp(-ax * 80.0) * 0.3;

        float alpha = (core + glow + halo + spikes) * vPulse;
        if (alpha < 0.005) discard;

        vec3 col = mix(vColor, vec3(1.0), core * 0.8);
        col *= vPulse;

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);

  // Per-instance color attribute
  const colorArray = new Float32Array(count * 3);

  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.copy(starPositions[i]);
    dummy.scale.setScalar(starSizes[i]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    colorArray[i*3]   = starColors[i].r;
    colorArray[i*3+1] = starColors[i].g;
    colorArray[i*3+2] = starColors[i].b;
  }
  mesh.instanceMatrix.needsUpdate = true;

  geo.setAttribute('instanceColor',
    new THREE.InstancedBufferAttribute(colorArray, 3));

  return { mesh, material: mat };
}
```

**Note on the billboard vertex shader:** The key trick is extracting the camera right/up vectors from the `viewMatrix` and constructing vertex positions manually. This makes quads always face the camera without needing `lookAt()` calls per frame (zero CPU cost).

**Fix for the code above** — the `worldPos` line has a typo. Corrected:
```javascript
// In the vertex shader, replace:
//   vec3 worldPos = (instanceMatrix * vec4(0,0,0,1)).kind;
// with:
//   vec3 worldPos = (instanceMatrix * vec4(0,0,0,1)).xyz;
```

---

### 1F. Star Corona / Atmosphere Effect

For a star that needs a visible atmosphere (like viewing a star up close), use a backside Fresnel sphere — the same technique used for planet atmospheres, but with additive blending and a hotter color:

```javascript
function createStarCorona(starMesh, color, coronaScale) {
  // coronaScale: 1.3 to 2.0 (how far the corona extends)
  const geo = new THREE.SphereGeometry(1, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime:  { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
        // Sharp falloff from edge
        float corona = pow(fresnel, 2.5);

        // Animated turbulence at the edge
        float turb = sin(vNormal.x * 15.0 + uTime * 2.0) * 0.08
                   + sin(vNormal.y * 20.0 + uTime * 1.5) * 0.06;

        corona += turb * fresnel;
        corona = clamp(corona, 0.0, 1.0);

        // White-hot at edge, colored further out
        vec3 col = mix(uColor, vec3(1.0, 0.95, 0.8), pow(fresnel, 4.0));

        gl_FragColor = vec4(col, corona * 0.7);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });

  const corona = new THREE.Mesh(geo, mat);
  corona.scale.setScalar(coronaScale);
  starMesh.add(corona); // child of star, inherits position

  return { mesh: corona, material: mat };
}
```

**Draw calls: 1 per star corona.** Use only for 1-3 featured stars that the user can approach closely.

---

## 2. Star Field Effects

### 2A. Parallax Star Layers for VR Depth

VR stereo rendering naturally gives depth from eye separation, but distant stars have zero parallax. To fake depth perception, use 3 star layers at different radii so head movement produces visible parallax:

```javascript
function createParallaxStarLayers() {
  // Near layer: fewer, brighter, more parallax
  const near = createStarField(200, 800);
  // Mid layer: moderate
  const mid  = createStarField(2000, 3000);
  // Far layer: many, faint, nearly no parallax
  const far  = createStarField(6000, 9000);

  return { near, mid, far };
}

// All 3 layers = 3 draw calls total for the entire sky
```

The near layer (radius 800) will shift noticeably with head movement in VR, giving a strong sense of depth. The far layer at 9000 stays essentially fixed.

---

### 2B. Shooting Stars / Meteor Streaks

A pool of reusable shooting stars using a single `THREE.Points` object with a trail rendered via a line strip. Each meteor is a set of trail vertices that get updated per frame.

```javascript
function createShootingStarSystem(maxActive) {
  // Each meteor = 20 trail segments
  const TRAIL_LEN = 20;
  const TOTAL_VERTS = maxActive * TRAIL_LEN;

  const positions = new Float32Array(TOTAL_VERTS * 3);
  const alphas    = new Float32Array(TOTAL_VERTS);
  // Pre-fill trail alphas (head=1, tail=0)
  for (let m = 0; m < maxActive; m++) {
    for (let t = 0; t < TRAIL_LEN; t++) {
      alphas[m * TRAIL_LEN + t] = 1.0 - (t / TRAIL_LEN);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('alpha',    new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(1.0, 3.5, alpha); // head larger
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = length(uv);
        float circle = 1.0 - smoothstep(0.0, 1.0, d);
        float a = circle * vAlpha;
        if (a < 0.01) discard;
        // White-blue hot head, fading to warm tail
        vec3 col = mix(vec3(1.0, 0.85, 0.5), vec3(0.8, 0.9, 1.0), vAlpha);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  // Meteor state
  const meteors = [];
  for (let i = 0; i < maxActive; i++) {
    meteors.push({
      active: false,
      origin: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 0,
      headPos: new THREE.Vector3(),
      trail: [] // ring buffer of past positions
    });
  }

  function spawnMeteor() {
    const m = meteors.find(m => !m.active);
    if (!m) return;

    // Random origin on upper hemisphere shell
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random()); // upper half
    const r = 4000 + Math.random() * 2000;
    m.origin.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    m.headPos.copy(m.origin);

    // Velocity: tangential to sphere, slight inward
    const speed = 30 + Math.random() * 60;
    m.velocity.set(
      -Math.sin(theta) * speed,
      -Math.cos(phi) * speed * 0.5,
      -Math.cos(theta) * speed
    );

    m.life = 0;
    m.maxLife = 60 + Math.random() * 90; // 1-2.5 seconds at 60fps
    m.trail = [];
    m.active = true;
  }

  function tick() {
    // Random chance to spawn
    if (Math.random() < 0.008) spawnMeteor(); // ~every 2 seconds

    const posAttr = geo.getAttribute('position');

    for (let i = 0; i < maxActive; i++) {
      const m = meteors[i];
      const base = i * TRAIL_LEN;

      if (m.active) {
        m.headPos.add(m.velocity);
        m.trail.unshift(m.headPos.clone());
        if (m.trail.length > TRAIL_LEN) m.trail.pop();

        m.life++;
        if (m.life >= m.maxLife) m.active = false;

        // Write trail positions
        for (let t = 0; t < TRAIL_LEN; t++) {
          const idx = base + t;
          if (t < m.trail.length) {
            posAttr.array[idx*3]   = m.trail[t].x;
            posAttr.array[idx*3+1] = m.trail[t].y;
            posAttr.array[idx*3+2] = m.trail[t].z;
          } else {
            // Hide unused segments at origin
            posAttr.array[idx*3] = posAttr.array[idx*3+1] = posAttr.array[idx*3+2] = 0;
          }
        }
      } else {
        // Park all vertices at zero (invisible due to alpha=0 at point size 0)
        for (let t = 0; t < TRAIL_LEN; t++) {
          const idx = (base + t) * 3;
          posAttr.array[idx] = posAttr.array[idx+1] = posAttr.array[idx+2] = 99999;
        }
      }
    }
    posAttr.needsUpdate = true;
  }

  return { mesh: points, tick, spawnMeteor };
}

// Usage:
const shootingStars = createShootingStarSystem(3);
scene.add(shootingStars.mesh);

// In animate():
shootingStars.tick();
```

**Draw calls: 1.** Up to 3 simultaneous meteors, each with a 20-point trail. Total vertices: 60 — negligible GPU cost.

---

### 2C. Star Birth (Nebula Condensation)

A cloud of particles that slowly contracts into a bright point. Uses a single `THREE.Points` object with vertex shader animation:

```javascript
function createStarBirth(center, cloudRadius) {
  const PARTICLES = 500;
  const offsets = new Float32Array(PARTICLES * 3);  // random cloud offsets
  const seeds   = new Float32Array(PARTICLES);

  for (let i = 0; i < PARTICLES; i++) {
    // Random position in sphere (cube rejection is fine for 500)
    let x, y, z;
    do {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      z = (Math.random() - 0.5) * 2;
    } while (x*x + y*y + z*z > 1);
    offsets[i*3]   = x * cloudRadius;
    offsets[i*3+1] = y * cloudRadius;
    offsets[i*3+2] = z * cloudRadius;
    seeds[i] = Math.random() * 100;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uProgress: { value: 0 },  // 0=cloud, 1=collapsed star
      uCenter:   { value: center.clone() },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uCenter;
      attribute float aSeed;
      varying float vAlpha;

      void main() {
        // Lerp from cloud position to center
        float p = clamp(uProgress, 0.0, 1.0);
        // Ease-in (accelerating collapse)
        float ease = p * p * p;

        vec3 cloudPos = position + uCenter;
        vec3 starPos  = uCenter;

        // Spiral while collapsing
        float angle = uTime * 2.0 + aSeed * 6.28;
        float spiralR = length(position.xz) * (1.0 - ease) * 0.3;
        vec3 spiral = vec3(cos(angle) * spiralR, 0.0, sin(angle) * spiralR);

        vec3 finalPos = mix(cloudPos, starPos, ease) + spiral * (1.0 - ease);

        vAlpha = mix(0.3, 1.0, ease);

        vec4 mvPos = modelViewMatrix * vec4(finalPos, 1.0);
        gl_PointSize = mix(2.0, 5.0, ease) * (1.0 + sin(uTime * 5.0 + aSeed) * 0.2);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      uniform float uProgress;

      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = length(uv);
        float circle = 1.0 - smoothstep(0.0, 1.0, d);
        float a = circle * vAlpha;
        if (a < 0.01) discard;

        // Color shifts from cool nebula blue/red to hot white
        vec3 coolColor = vec3(0.4, 0.2, 0.6);
        vec3 hotColor  = vec3(1.0, 0.95, 0.85);
        vec3 col = mix(coolColor, hotColor, uProgress);

        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;

  // Animate: call advanceProgress(dt) each frame
  // dt ~0.003 for a ~5 second collapse
  function advanceProgress(dt) {
    mat.uniforms.uProgress.value = Math.min(
      mat.uniforms.uProgress.value + dt, 1.0
    );
  }

  return { mesh, material: mat, advanceProgress };
}

// Usage:
const birth = createStarBirth(new THREE.Vector3(500, 200, -3000), 300);
scene.add(birth.mesh);

// In animate():
birth.material.uniforms.uTime.value = performance.now() * 0.001;
birth.advanceProgress(0.003);
```

**Draw calls: 1.**

---

### 2D. Supernova Explosion

Reverse of star birth — rapid expansion from a point with a blinding flash, expanding shell, and fade:

```javascript
function createSupernova(center) {
  const PARTICLES = 800;
  // Random direction vectors (on unit sphere)
  const dirs  = new Float32Array(PARTICLES * 3);
  const seeds = new Float32Array(PARTICLES);

  for (let i = 0; i < PARTICLES; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    dirs[i*3]   = Math.sin(phi) * Math.cos(theta);
    dirs[i*3+1] = Math.sin(phi) * Math.sin(theta);
    dirs[i*3+2] = Math.cos(phi);
    seeds[i] = Math.random() * 100;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dirs, 3));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uProgress: { value: 0 },   // 0 = flash, 1 = fully expanded/faded
      uCenter:   { value: center.clone() },
      uRadius:   { value: 800.0 }, // max expansion radius
    },
    vertexShader: `
      uniform float uTime;
      uniform float uProgress;
      uniform vec3  uCenter;
      uniform float uRadius;
      attribute float aSeed;
      varying float vAlpha;
      varying float vProgress;

      void main() {
        vProgress = uProgress;
        // Fast initial burst, then deceleration
        float expand = 1.0 - pow(1.0 - uProgress, 3.0);
        float radius = expand * uRadius;

        // Each particle flies outward along its direction
        // Add slight variation in speed
        float speedVar = 0.7 + fract(aSeed * 7.37) * 0.6;
        vec3 pos = uCenter + position * radius * speedVar;

        // Turbulence
        pos.x += sin(uTime * 3.0 + aSeed) * radius * 0.02;
        pos.y += cos(uTime * 2.5 + aSeed * 1.7) * radius * 0.02;

        // Fade out as it expands
        vAlpha = 1.0 - smoothstep(0.3, 1.0, uProgress);
        // Boost early brightness (the flash)
        vAlpha += (1.0 - smoothstep(0.0, 0.1, uProgress)) * 2.0;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        // Particles grow then shrink
        float size = mix(5.0, 2.0, uProgress);
        size *= (1.0 - smoothstep(0.7, 1.0, uProgress)); // shrink to nothing at end
        gl_PointSize = max(size, 0.5);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vProgress;

      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = length(uv);
        float circle = 1.0 - smoothstep(0.0, 1.0, d);

        float a = circle * vAlpha;
        if (a < 0.005) discard;

        // White flash -> orange -> red as it cools
        vec3 col;
        if (vProgress < 0.1) {
          col = vec3(1.0, 1.0, 1.0); // blinding white
        } else if (vProgress < 0.4) {
          float t = (vProgress - 0.1) / 0.3;
          col = mix(vec3(1.0, 1.0, 0.9), vec3(1.0, 0.6, 0.2), t);
        } else {
          float t = (vProgress - 0.4) / 0.6;
          col = mix(vec3(1.0, 0.6, 0.2), vec3(0.8, 0.15, 0.05), t);
        }

        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;

  // Add a central flash sphere (2 extra draw calls)
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(center);

  // Expanding shock ring
  const ringGeo = new THREE.RingGeometry(0.8, 1.0, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff6633,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(center);

  function tick(dt) {
    // dt ~ 0.005 for ~3 second explosion
    mat.uniforms.uProgress.value = Math.min(
      mat.uniforms.uProgress.value + dt, 1.0
    );
    const p = mat.uniforms.uProgress.value;
    mat.uniforms.uTime.value = performance.now() * 0.001;

    // Flash sphere: bright then fade rapidly
    const flashScale = 20 + p * 200;
    flash.scale.setScalar(flashScale);
    flash.material.opacity = Math.max(0, 1.0 - p * 4.0);
    flash.visible = p < 0.3;

    // Shock ring: expands outward
    const ringScale = p * 600;
    ring.scale.setScalar(ringScale);
    ring.material.opacity = Math.max(0, 0.6 - p * 0.8);
    ring.visible = p > 0.05 && p < 0.8;

    // Billboard ring toward camera (call from animate)
    // ring.lookAt(camera.position) -- or use the billboard shader approach
  }

  return { particles: mesh, flash, ring, tick };
}

// Usage:
const nova = createSupernova(new THREE.Vector3(1000, 500, -4000));
scene.add(nova.particles);
scene.add(nova.flash);
scene.add(nova.ring);

// In animate():
nova.tick(0.005);
```

**Draw calls: 3** (particles + flash sphere + shock ring).

---

### 2E. Binary Star Orbiting Pair

Two stars orbiting their common center of mass. Pure math in the animation loop, no extra draw calls if using existing star meshes:

```javascript
function createBinaryStar(center, orbitRadius, period, colorA, colorB) {
  // Star A (larger)
  const geoA = new THREE.SphereGeometry(1, 16, 12);
  const matA = new THREE.MeshBasicMaterial({ color: colorA });
  const starA = new THREE.Mesh(geoA, matA);
  starA.scale.setScalar(40);

  // Star B (smaller)
  const geoB = new THREE.SphereGeometry(1, 16, 12);
  const matB = new THREE.MeshBasicMaterial({ color: colorB });
  const starB = new THREE.Mesh(geoB, matB);
  starB.scale.setScalar(25);

  // Glow halos (additive backside spheres) — 2 more draw calls
  function makeGlow(parent, color, scale) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float f = 1.0 - abs(dot(vNormal, vViewDir));
          float glow = pow(f, 3.0);
          gl_FragColor = vec4(uColor, glow * 0.5);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
    mesh.scale.setScalar(scale);
    parent.add(mesh);
  }

  makeGlow(starA, colorA, 1.4);
  makeGlow(starB, colorB, 1.5);

  const group = new THREE.Group();
  group.position.copy(center);
  group.add(starA);
  group.add(starB);

  function tick(time) {
    const angle = (time / period) * Math.PI * 2;
    // Mass ratio: A is 1.6x mass of B
    const rA = orbitRadius * 0.38;  // smaller orbit for heavier star
    const rB = orbitRadius * 0.62;

    starA.position.set(Math.cos(angle) * rA, 0, Math.sin(angle) * rA);
    starB.position.set(-Math.cos(angle) * rB, 0, -Math.sin(angle) * rB);
  }

  return { group, tick };
}

// Usage:
const binary = createBinaryStar(
  new THREE.Vector3(2000, 300, -3500),
  120, // orbit radius
  8,   // period in seconds
  0x88aaff, // blue-white primary
  0xffaa66  // orange companion
);
scene.add(binary.group);

// In animate():
binary.tick(performance.now() * 0.001);
```

**Draw calls: 4** (2 star spheres + 2 glow halos).

---

### 2F. Pulsar with Rotating Beam

A rapidly spinning neutron star with two opposing cone beams. Uses a pair of cone meshes with additive blending, rotated in the animation loop:

```javascript
function createPulsar(center, beamLength, spinSpeed) {
  const group = new THREE.Group();
  group.position.copy(center);

  // Neutron star core (tiny bright sphere)
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xccddff,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), coreMat);
  core.scale.setScalar(8);
  group.add(core);

  // Glow around core
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x6688cc,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), glowMat);
  glow.scale.setScalar(18);
  group.add(glow);

  // Beam cones — opposing directions along Y axis
  const beamGeo = new THREE.ConeGeometry(beamLength * 0.08, beamLength, 8, 1, true);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      varying float vY;
      void main() {
        vY = position.y / ${beamLength.toFixed(1)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vY;
      void main() {
        // Fade along beam length
        float fade = 1.0 - abs(vY);
        fade = pow(fade, 0.5); // bright near star, fading outward
        // Also fade at the wide end
        float tip = smoothstep(0.0, 0.3, abs(vY));
        float alpha = fade * (1.0 - tip * 0.7) * 0.35;
        vec3 col = vec3(0.5, 0.7, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const beam1 = new THREE.Mesh(beamGeo, beamMat);
  beam1.position.y = beamLength * 0.5;
  group.add(beam1);

  const beam2 = new THREE.Mesh(beamGeo, beamMat);
  beam2.position.y = -beamLength * 0.5;
  beam2.rotation.x = Math.PI;
  group.add(beam2);

  // Tilt the whole beam axis
  const beamAxis = new THREE.Group();
  beamAxis.add(beam1);
  beamAxis.add(beam2);
  beamAxis.rotation.z = 0.4; // 23 degree tilt from spin axis
  group.add(beamAxis);

  function tick(time) {
    // Rapid spin
    beamAxis.rotation.y = time * spinSpeed;
  }

  return { group, tick };
}

// Usage:
const pulsar = createPulsar(
  new THREE.Vector3(-1500, 600, -4000),
  400,  // beam length
  4.0   // rotations per second (radians/sec)
);
scene.add(pulsar.group);

// In animate():
pulsar.tick(performance.now() * 0.001);
```

**Draw calls: 4** (core sphere + glow sphere + 2 beam cones).

---

## 3. Constellation Effects

### 3A. Animated Line Drawing Between Stars

Draw constellation lines that "trace" from star to star with a growing animation. Uses a single `BufferGeometry` line with `setDrawRange` to animate:

```javascript
function createConstellationLines(starPositions, connections) {
  // starPositions: array of THREE.Vector3
  // connections: array of [indexA, indexB] pairs

  // Flatten all line segments into one buffer
  // Each connection = 2 vertices
  const totalVerts = connections.length * 2;
  const positions = new Float32Array(totalVerts * 3);
  const progress  = new Float32Array(totalVerts); // 0..1 per segment for ordering

  for (let i = 0; i < connections.length; i++) {
    const [a, b] = connections[i];
    const pa = starPositions[a];
    const pb = starPositions[b];
    positions[i*6]   = pa.x; positions[i*6+1] = pa.y; positions[i*6+2] = pa.z;
    positions[i*6+3] = pb.x; positions[i*6+4] = pb.y; positions[i*6+5] = pb.z;
    // Sequential progress: each segment draws one at a time
    progress[i*2]   = i / connections.length;
    progress[i*2+1] = i / connections.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDrawProgress: { value: 0 },   // 0 = nothing drawn, 1 = all drawn
      uGlow:         { value: 0 },    // pulse glow intensity
      uColor:        { value: new THREE.Color(0x4488ff) },
      uOpacity:      { value: 0.6 },
    },
    vertexShader: `
      attribute float aProgress;
      varying float vVisible;
      uniform float uDrawProgress;

      void main() {
        // This vertex is visible if overall draw progress has reached it
        vVisible = step(aProgress, uDrawProgress);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vVisible;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uGlow;

      void main() {
        if (vVisible < 0.5) discard;
        float alpha = uOpacity + uGlow * 0.3;
        gl_FragColor = vec4(uColor * (1.0 + uGlow * 0.5), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const lines = new THREE.LineSegments(geo, mat);

  // Animation controls
  let drawT = 0;
  let glowT = 0;
  let drawing = false;

  function startDrawing() {
    drawT = 0;
    drawing = true;
  }

  function tick(dt) {
    if (drawing) {
      drawT = Math.min(drawT + dt, 1.0);
      mat.uniforms.uDrawProgress.value = drawT;
      if (drawT >= 1.0) drawing = false;
    }

    // Subtle pulse after drawn
    if (drawT >= 1.0) {
      glowT += 0.02;
      mat.uniforms.uGlow.value = Math.sin(glowT) * 0.5 + 0.5;
    }
  }

  return { mesh: lines, startDrawing, tick };
}

// Usage:
const constell = createConstellationLines(
  [
    new THREE.Vector3(100, 200, -5000),
    new THREE.Vector3(300, 350, -5200),
    new THREE.Vector3(500, 180, -4800),
    new THREE.Vector3(450, 400, -5100),
  ],
  [[0,1], [1,2], [1,3], [2,3]]
);
scene.add(constell.mesh);

// Trigger drawing animation:
constell.startDrawing();

// In animate():
constell.tick(0.015); // ~1 second to draw all lines
```

**Draw calls: 1.**

---

### 3B. Proximity-Based Constellation Fade

Lines that appear when the user looks toward them and fade when they look away:

```javascript
function createProximityConstellations(constellations, camera) {
  // constellations: array of { center: Vector3, lines: LineSegments mesh }

  function tick() {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    for (const c of constellations) {
      const toConstell = c.center.clone().sub(camPos).normalize();
      const dot = camDir.dot(toConstell);

      // Visible when looking toward it (dot > 0.7 = within ~45 degrees)
      const targetOpacity = smoothstep(0.5, 0.85, dot) * 0.7;
      // Smooth lerp
      const current = c.lines.material.uniforms.uOpacity.value;
      c.lines.material.uniforms.uOpacity.value +=
        (targetOpacity - current) * 0.05;
    }
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  return { tick };
}
```

**Draw calls: 0 extra** (operates on existing constellation line meshes).

---

## 4. Nebula and Gas Cloud Effects

### 4A. Volumetric-Looking Nebula (Billboard Layers + Noise)

The cheapest way to fake volumetric nebulae on Quest: multiple overlapping billboard planes with noise-based transparency. Each plane is at a slightly different depth, giving parallax in VR stereo.

```javascript
function createNebula(center, radius, color, layerCount) {
  layerCount = layerCount || 5;
  const group = new THREE.Group();
  group.position.copy(center);

  // Generate a noise texture on canvas (shared by all layers)
  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = noiseCanvas.height = 256;
  const ctx = noiseCanvas.getContext('2d');
  const imgData = ctx.createImageData(256, 256);

  // Simple value noise
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      // Multiple octaves of noise via sine
      let n = 0;
      n += Math.sin(x * 0.03 + y * 0.02) * 0.5;
      n += Math.sin(x * 0.07 - y * 0.05 + 3.0) * 0.3;
      n += Math.sin(x * 0.13 + y * 0.11 + 7.0) * 0.2;
      n = (n + 1.0) * 0.5; // 0-1

      // Radial falloff from center
      const dx = (x - 128) / 128;
      const dy = (y - 128) / 128;
      const radial = 1.0 - Math.sqrt(dx*dx + dy*dy);
      const val = Math.max(0, n * radial);

      const c = new THREE.Color(color);
      imgData.data[idx]   = Math.round(c.r * 255);
      imgData.data[idx+1] = Math.round(c.g * 255);
      imgData.data[idx+2] = Math.round(c.b * 255);
      imgData.data[idx+3] = Math.round(val * 180); // alpha from noise
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const noiseTex = new THREE.CanvasTexture(noiseCanvas);

  const planeGeo = new THREE.PlaneGeometry(1, 1);

  for (let i = 0; i < layerCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: noiseTex,
      transparent: true,
      opacity: 0.12 + Math.random() * 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const plane = new THREE.Mesh(planeGeo, mat);

    // Offset each layer slightly in depth for VR parallax
    const depthOffset = (i - layerCount/2) * (radius * 0.15);
    plane.position.set(
      (Math.random() - 0.5) * radius * 0.3,
      (Math.random() - 0.5) * radius * 0.3,
      depthOffset
    );

    // Random rotation for variety
    plane.rotation.z = Math.random() * Math.PI;
    // Vary scale per layer
    const s = radius * (0.7 + Math.random() * 0.6);
    plane.scale.set(s, s * (0.6 + Math.random() * 0.8), 1);

    group.add(plane);
  }

  // Billboard the group toward camera each frame
  function tick(camera) {
    group.quaternion.copy(camera.quaternion);
  }

  return { group, tick };
}

// Usage:
const nebula1 = createNebula(
  new THREE.Vector3(3000, 1000, -6000),
  1500,
  0x442266, // purple
  5
);
scene.add(nebula1.group);

// In animate():
nebula1.tick(camera);
```

**Draw calls: 5 per nebula** (one per layer). Use 3-5 layers for a convincing look.

---

### 4B. Emission Nebula (Glowing Gas with Shader)

A single billboard quad with a procedural noise fragment shader. More visually rich than the canvas approach, still just 1 draw call:

```javascript
function createEmissionNebula(center, size, baseColor) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(baseColor) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;

      // Simple 2D noise
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1, 0));
        float c = hash(i + vec2(0, 1));
        float d = hash(i + vec2(1, 1));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float val = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 5; i++) {
          val += amp * noise(p);
          p *= 2.1;
          amp *= 0.5;
        }
        return val;
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float dist = length(uv);

        // Radial falloff
        float radial = 1.0 - smoothstep(0.0, 1.0, dist);

        // Animated FBM noise
        float t = uTime * 0.05;
        vec2 noiseUV = uv * 3.0 + vec2(t, -t * 0.7);
        float n = fbm(noiseUV);

        // Second noise layer for detail
        float n2 = fbm(uv * 5.0 + vec2(-t * 0.5, t * 0.3) + n * 0.5);

        float nebula = radial * n * 0.8 + radial * n2 * 0.4;
        nebula = pow(nebula, 1.5); // contrast boost

        // Color variation: hot spots are brighter/whiter
        vec3 col = uColor;
        vec3 hotColor = uColor + vec3(0.3, 0.2, 0.1);
        col = mix(col, hotColor, smoothstep(0.3, 0.7, n2));

        float alpha = nebula * 0.35;
        if (alpha < 0.005) discard;

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.scale.set(size, size * 0.8, 1);

  function tick(time, camera) {
    mat.uniforms.uTime.value = time;
    mesh.lookAt(camera.position);
  }

  return { mesh, tick };
}

// Usage:
const emNeb = createEmissionNebula(
  new THREE.Vector3(-2000, 500, -5000),
  2000,
  0x883366
);
scene.add(emNeb.mesh);

// In animate():
emNeb.tick(performance.now() * 0.001, camera);
```

**Draw calls: 1.** The FBM loop (5 iterations) runs per pixel but on a single billboard quad — manageable for Quest if the quad doesn't fill too much screen space.

---

### 4C. Planetary Nebula Rings

A ring of glowing expelled gas around a central white dwarf. Uses a torus geometry with a Fresnel-like shader:

```javascript
function createPlanetaryNebula(center, innerR, outerR) {
  const group = new THREE.Group();
  group.position.copy(center);

  // Central white dwarf (tiny bright point)
  const dwarfMat = new THREE.MeshBasicMaterial({ color: 0xeeeeff });
  const dwarf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), dwarfMat);
  dwarf.scale.setScalar(5);
  group.add(dwarf);

  // Ring / shell
  const ringGeo = new THREE.TorusGeometry(
    (innerR + outerR) / 2, // major radius
    (outerR - innerR) / 2, // tube radius
    16, 48
  );

  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uInnerColor: { value: new THREE.Color(0x22aaff) }, // blue-green inner
      uOuterColor: { value: new THREE.Color(0xff4422) }, // red outer
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      varying float vRingDist; // 0 at center of torus tube, 1 at edge

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vWorldPos = position;

        // Distance from torus center axis (gives inner vs outer edge)
        float majorR = ${((innerR + outerR) / 2).toFixed(1)};
        vec2 xz = position.xz;
        float distFromAxis = length(xz) - majorR;
        float tubeR = ${((outerR - innerR) / 2).toFixed(1)};
        vRingDist = distFromAxis / tubeR; // -1 inner, +1 outer

        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uInnerColor;
      uniform vec3 uOuterColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vRingDist;

      void main() {
        float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
        float shell = pow(fresnel, 1.5);

        // Color: blue inside, red outside (like real planetary nebulae)
        float t = vRingDist * 0.5 + 0.5; // 0-1
        vec3 col = mix(uInnerColor, uOuterColor, t);

        // Slight turbulence
        float turb = sin(vRingDist * 20.0 + uTime) * 0.05;
        shell += turb;

        float alpha = clamp(shell * 0.5, 0.0, 0.7);
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const ring = new THREE.Mesh(ringGeo, ringMat);
  group.add(ring);

  function tick(time) {
    ringMat.uniforms.uTime.value = time;
    // Slow rotation
    ring.rotation.y = time * 0.1;
  }

  return { group, tick };
}

// Usage:
const pNebula = createPlanetaryNebula(
  new THREE.Vector3(1500, -300, -4500),
  80, 180
);
scene.add(pNebula.group);

// In animate():
pNebula.tick(performance.now() * 0.001);
```

**Draw calls: 2** (white dwarf sphere + torus ring).

---

### 4D. Dark Nebula Silhouettes

Dark nebulae absorb light — they're visible as dark patches against the star field. Render as black billboard planes with noise-shaped alpha:

```javascript
function createDarkNebula(center, size) {
  const geo = new THREE.PlaneGeometry(1, 1);

  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1,0)), f.x),
          mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float dist = length(uv);

        float radial = 1.0 - smoothstep(0.0, 0.9, dist);
        float n = fbm(vUv * 4.0 + 0.5);

        // Dark: absorbs stars behind it
        float darkness = radial * n;
        darkness = smoothstep(0.15, 0.5, darkness);

        // Very dark brown-black with slight red tinge at edges
        vec3 col = vec3(0.02, 0.01, 0.01);
        float alpha = darkness * 0.85;
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    // NORMAL blending (not additive!) so it darkens
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.scale.set(size, size * 0.7, 1);

  function tick(camera) {
    mesh.lookAt(camera.position);
  }

  return { mesh, tick };
}

// Usage:
const darkNeb = createDarkNebula(
  new THREE.Vector3(-1000, 800, -7000),
  2500
);
scene.add(darkNeb.mesh);

// In animate():
darkNeb.tick(camera);
```

**Draw calls: 1.** Key detail: uses `NormalBlending` (not additive) so the black area actually obscures stars behind it.

---

## 5. Performance Notes for Quest 3

### Draw Call Budget

| Effect | Draw Calls | Notes |
|--------|-----------|-------|
| Main star field (Points) | 1 | 5k-8k stars, ShaderMaterial |
| Parallax layers (3x Points) | 3 | Near/mid/far |
| Hero star halos (InstancedMesh) | 1 | Up to 50 hero stars |
| Shooting stars (Points) | 1 | Pool of 3 meteors |
| Star birth (Points) | 1 | 500 particles |
| Supernova (Points + flash + ring) | 3 | Temporary event |
| Binary star | 4 | 2 stars + 2 glow halos |
| Pulsar | 4 | Core + glow + 2 beams |
| Constellation lines | 1 | All constellations in one buffer |
| Emission nebula (shader billboard) | 1 | Per nebula |
| Volumetric nebula (layered) | 3-5 | Per nebula |
| Planetary nebula | 2 | Dwarf + torus ring |
| Dark nebula | 1 | Per dark cloud |
| **Practical total** | **~20-30** | Choosing subset of above |

You cannot use all effects simultaneously. Pick a subset per scene. A good default:

- Star field (3 parallax layers): **3 draw calls**
- 2 emission nebulae: **2 draw calls**
- 1 dark nebula: **1 draw call**
- Constellation lines: **1 draw call**
- Shooting stars: **1 draw call**
- **Total sky: 8 draw calls** — leaves 192 for planets, UI, etc.

### Critical Quest 3 Rules

1. **Never use EffectComposer** — all glow/bloom is mesh-based or fragment-shader-based
2. **`sizeAttenuation: false`** for background stars (screen-space sizing stays crisp)
3. **`depthWrite: false`** on all transparent/additive materials
4. **`frustumCulled = false`** on sky-sphere-radius objects (always visible)
5. **Additive blending** for all luminous effects — cheap and looks great on black backgrounds
6. **Billboard via shader** (extract camera vectors from `viewMatrix`) instead of CPU `lookAt()`
7. **Keep FBM loops under 5 iterations** in fragment shaders on Quest's Adreno 740
8. **Shared geometries**: all nebula billboards share one `PlaneGeometry`, all star coronas share one `SphereGeometry`
9. **Canvas textures at 256x256 max** for noise textures — smaller is better
10. **Park unused vertices at (99999,99999,99999)** instead of removing them — avoids buffer reallocation

### Shader Performance Tips

- `discard` in fragment shader is not free — only discard truly invisible fragments (alpha < 0.01)
- `pow()` is expensive on mobile — use `x*x` instead of `pow(x, 2.0)` where possible
- `smoothstep` is cheaper than `pow` for falloff curves
- Keep varying count low (4-5 max) — each varying costs interpolation per pixel
- Noise functions: use the hash-based noise above (1 `sin` + 1 `fract`) rather than Perlin/Simplex (which need gradient tables)

### Animation Loop Integration

```javascript
function animate() {
  const t = performance.now() * 0.001;

  // Stars
  starField.material.uniforms.uTime.value = t;

  // Shooting stars
  shootingStars.tick();

  // Nebulae
  emNeb.tick(t, camera);
  darkNeb.tick(camera);

  // Constellation lines
  constell.tick(0.015);

  // Optional dramatic effects (enable/disable as needed)
  // birth.advanceProgress(0.003);
  // birth.material.uniforms.uTime.value = t;
  // nova.tick(0.005);
  // binary.tick(t);
  // pulsar.tick(t);

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

---

## Sources

- [Shader-Glow technique (stemkoski)](https://stemkoski.github.io/Three.js/Shader-Glow.html)
- [Three.js glow shader (Kade Keith)](https://kadekeith.me/2017/09/12/three-glow.html)
- [Procedural star rendering with WebGL shaders (Ben Podgursky)](https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/)
- [THRASTRO astronomical shaders](https://github.com/THRASTRO/thrastro-shaders)
- [Shadertoy glow tutorial](https://www.shadertoy.com/view/3s3GDn)
- [Shadertoy color temperature](https://www.shadertoy.com/view/lsSXW1)
- [Blackbody rendering (Miles Macklin)](https://blog.mmacklin.com/2010/12/29/blackbody-rendering/)
- [VR Me Up — InstancedMesh Performance](https://www.vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html)
- [WebXR Scene Optimization (Brandon Jones / toji)](https://toji.github.io/webxr-scene-optimization/)
- [High-speed Light Trails (Codrops)](https://tympanus.net/codrops/2019/11/13/high-speed-light-trails-in-three-js/)
- [Volumetric Light Rays (Codrops)](https://tympanus.net/codrops/2022/06/27/volumetric-light-rays-with-three-js/)
- [Stellar classification (Wikipedia)](https://en.wikipedia.org/wiki/Stellar_classification)
- [Three.js ShaderMaterial docs](https://threejs.org/docs/pages/ShaderMaterial.html)
- [Three.js InstancedMesh docs](https://threejs.org/docs/pages/InstancedMesh.html)
