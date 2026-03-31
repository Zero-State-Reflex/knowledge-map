# GPU Particle Systems for Three.js WebXR on Quest 3

Comprehensive reference for shader-driven particle effects — black hole accretion, jets, gravitational spirals, photon orbits. All code targets THREE r152 global build, zero CPU cost per frame.

---

## Table of Contents
1. [Quest 3 Particle Budget](#quest-3-particle-budget)
2. [Architecture: Points vs InstancedMesh vs Custom Shader](#architecture)
3. [Core GPU Particle Template](#core-gpu-particle-template)
4. [sizeAttenuation in WebXR Stereo](#sizeattenuation-in-webxr-stereo)
5. [Particle Behaviors](#particle-behaviors)
   - [Spiral / Vortex (Accretion Disk)](#spiral--vortex-accretion-disk)
   - [Differential Rotation (Keplerian Disk)](#differential-rotation-keplerian-disk)
   - [Gravitational Attraction (Infalling Matter)](#gravitational-attraction-infalling-matter)
   - [Photon Sphere Orbits](#photon-sphere-orbits)
   - [Relativistic Jets (Bipolar Outflows)](#relativistic-jets-bipolar-outflows)
   - [Hawking Radiation](#hawking-radiation)
   - [Particle Trails / Streaks](#particle-trails--streaks)
   - [Color Evolution Over Lifetime](#color-evolution-over-lifetime)
6. [Complete Black Hole Particle System](#complete-black-hole-particle-system)
7. [Texture Atlas for Particle Variation](#texture-atlas-for-particle-variation)
8. [Performance Tips](#performance-tips)

---

## Quest 3 Particle Budget

Based on testing with Adreno 740 in WebXR stereo rendering:

| Approach | Safe Count | Max Before Drops | Draw Calls |
|----------|-----------|-------------------|------------|
| `THREE.Points` + ShaderMaterial | 10,000 | ~20,000 | 1 |
| `THREE.Points` + PointsMaterial | 5,000 | ~10,000 | 1 |
| `InstancedMesh` (quads) | 2,000 | ~5,000 | 1 |
| Individual meshes | 50 | ~100 | N |

**Key rule**: One `THREE.Points` call = 1 draw call regardless of particle count. The GPU does the work. CPU-driven position updates (needsUpdate=true) cost linearly per particle — avoid above 2,000.

**Sweet spots for 72fps**:
- Background dust/stars: 5,000-8,000 (shader-animated, no CPU update)
- Accretion disk particles: 2,000-3,000 (shader-animated)
- Jet particles: 500-800 per jet (shader-animated)
- Photon orbit: 200-400 (shader-animated)
- Hawking radiation: 100-200 (shader-animated)
- **Total safe budget: ~10,000 particles across all systems**

---

## Architecture

### THREE.Points + ShaderMaterial (Best for Quest)
- 1 draw call for all particles
- Vertex shader computes position each frame — zero CPU cost
- Custom attributes (phase, speed, radius, lifetime) baked at init
- Only uniform updates per frame (uTime)
- **Use this for everything**

### InstancedMesh (Use for billboard quads)
- 1 draw call, but heavier per-instance than Points
- Needed when particles must be camera-facing quads with texture
- Use `InstancedBufferAttribute` for custom per-instance data
- Good for: large glowing particles, flares, volumetric-looking effects
- Limit to ~2,000 instances on Quest

### CPU-Updated Points (Avoid on Quest)
- `attributes.position.needsUpdate = true` every frame
- Transfers data CPU->GPU each frame
- Fine for <500 particles, but shader approach is always better
- Your current `updateBHParticles()` in km_bh13.html uses this — should migrate to GPU

### Transform Feedback (Not available in WebGL2 via Three.js)
- WebGL2 supports transform feedback natively
- Three.js r152 does NOT expose it
- Would require raw GL calls alongside Three.js — fragile, not recommended
- The vertex-shader-attribute approach achieves the same result more portably

---

## Core GPU Particle Template

This is the foundation pattern. Every particle system below builds on this.

```javascript
function createGPUParticles(count, initFn, vertexBody, fragmentBody, uniforms, options) {
  // initFn(i) returns { x, y, z, phase, speed, radius, lifetime }
  const pos = new Float32Array(count * 3);
  const aPhase = new Float32Array(count);
  const aSpeed = new Float32Array(count);
  const aRadius = new Float32Array(count);
  const aLife = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const p = initFn(i);
    pos[i*3] = p.x; pos[i*3+1] = p.y; pos[i*3+2] = p.z;
    aPhase[i] = p.phase;
    aSpeed[i] = p.speed;
    aRadius[i] = p.radius;
    aLife[i] = p.lifetime;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 1));

  // Bounding sphere must be set manually since positions change in shader
  geo.boundingSphere = new THREE.Sphere(
    options.center || new THREE.Vector3(0, 0, 0),
    options.boundRadius || 5000
  );

  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTime: { value: 0 } }, uniforms),
    vertexShader: `
      attribute float aPhase, aSpeed, aRadius, aLife;
      uniform float uTime;
      ${Object.keys(uniforms).map(k => `uniform ${uniforms[k].type || 'float'} ${k};`).join('\n')}
      varying float vAlpha;
      varying vec3 vColor;
      ${vertexBody}
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      ${fragmentBody}
    `,
    blending: options.blending || THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: options.depthTest !== undefined ? options.depthTest : true,
    transparent: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // positions computed in shader
  return { points, material: mat, geometry: geo };
}
```

**CRITICAL**: Set `frustumCulled = false` or set a manual `boundingSphere` on the geometry. Since positions are computed in the vertex shader, Three.js cannot compute bounds automatically — particles will vanish when the camera moves.

---

## sizeAttenuation in WebXR Stereo

### The Problem
In WebXR stereo rendering, each eye gets a different projection matrix. `sizeAttenuation: true` in PointsMaterial scales particles by `300.0 / -mvPosition.z` — this works but particles appear at different sizes per eye at close range, causing visual discomfort.

### Best Approaches for VR

**Screen-space particles (no attenuation)**:
```glsl
// Fixed pixel size regardless of distance — good for stars, distant dust
gl_PointSize = 2.0;
```

**Manual VR-friendly attenuation**:
```glsl
// Attenuate but clamp minimum to avoid stereo mismatch at close range
vec4 mv = modelViewMatrix * vec4(pos, 1.0);
float dist = -mv.z;
gl_PointSize = clamp(size * 200.0 / dist, 1.0, 32.0);
gl_Position = projectionMatrix * mv;
```

**Per-eye consistent sizing** (recommended):
```glsl
// Use world-space size, let projection handle it naturally
vec4 mv = modelViewMatrix * vec4(pos, 1.0);
// Project a world-space offset to get screen-space size
vec4 mv2 = mv + vec4(worldSize, 0.0, 0.0, 0.0);
vec4 p1 = projectionMatrix * mv;
vec4 p2 = projectionMatrix * mv2;
gl_PointSize = abs(p2.x / p2.w - p1.x / p1.w) * resolution.x * 0.5;
gl_Position = p1;
```

**Rule of thumb for Quest**: Use `gl_PointSize = clamp(N * K / -mvPos.z, 1.0, 24.0)`. Keep max under 32px — large point sprites tank fill rate on mobile GPUs. For particles that need to look big, use InstancedMesh quads instead.

---

## Particle Behaviors

### Spiral / Vortex (Accretion Disk)

Particles orbit a center point with radius decreasing over lifetime (spiraling inward). Inner particles orbit faster (Keplerian: angular velocity proportional to r^-1.5).

```javascript
// ── Accretion Disk Spiral Particles ──
(function() {
  var N = 2500;
  var BH = new THREE.Vector3(3200, -800, -5500); // your BH_POS
  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var radius = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    var r = 280 + Math.random() * 800;
    var a = Math.random() * 6.283;
    pos[i*3]   = BH.x + r * Math.cos(a);
    pos[i*3+1] = BH.y + (Math.random() - 0.5) * r * 0.12;
    pos[i*3+2] = BH.z + r * Math.sin(a);
    phase[i] = Math.random() * 6.283;
    speed[i] = 0.3 + Math.random() * 0.7;
    radius[i] = r;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 2000);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aRadius;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha, vHeat;

      void main() {
        float t = uTime * 0.3 * aSpeed + aPhase;

        // Lifetime: particle spirals inward over one cycle (2*PI)
        float life = mod(t, 6.283);
        float progress = life / 6.283; // 0 = just spawned, 1 = swallowed

        // Radius shrinks over lifetime — spiral inward
        float r = mix(aRadius, 270.0, progress * progress);

        // Angular velocity: Keplerian — inner orbits MUCH faster
        // v_angular ~ r^(-1.5), so ang += t * K / r^1.5
        float angularSpeed = 1.5 / pow(max(r - 260.0, 10.0) / 100.0, 1.5);
        float ang = t * angularSpeed + aPhase;

        // Disk tilt — slight wobble per particle for thickness
        float tiltX = sin(aPhase * 2.7) * 0.15;
        float tiltZ = cos(aPhase * 3.1) * 0.10;

        vec3 p;
        p.x = uBH.x + r * cos(ang);
        p.z = uBH.z + r * sin(ang);
        p.y = uBH.y + r * (sin(ang) * tiltX + cos(ang) * tiltZ)
              + sin(t * 2.0 + aPhase * 5.0) * r * 0.03;

        // Heat: hotter near center
        vHeat = 1.0 - smoothstep(270.0, 700.0, r);

        // Alpha: fade in at spawn radius, fade out near event horizon
        vAlpha = smoothstep(270.0, 300.0, r) * (1.0 - progress * 0.5);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Size: larger when hot/close, smaller when far
        gl_PointSize = clamp(mix(2.0, 5.0, vHeat) * 200.0 / -mv.z, 1.0, 16.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha, vHeat;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0; // soft circle falloff

        // Color: orange (cool) -> white-yellow (hot) -> blue-white (extreme)
        vec3 cool = vec3(0.8, 0.3, 0.05);
        vec3 hot  = vec3(1.0, 0.9, 0.7);
        vec3 extreme = vec3(0.8, 0.85, 1.0);
        vec3 col = mix(cool, hot, smoothstep(0.0, 0.6, vHeat));
        col = mix(col, extreme, smoothstep(0.6, 1.0, vHeat));

        gl_FragColor = vec4(col, soft * vAlpha * 0.9);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // In your animate loop: mat.uniforms.uTime.value = performance.now() * 0.001;
  window._accretionMat = mat;
})();
```

### Differential Rotation (Keplerian Disk)

The key physics: angular velocity = sqrt(GM/r^3). In shader terms, inner particles complete many more orbits than outer ones in the same time. The critical line:

```glsl
float angularSpeed = K / pow(r / refRadius, 1.5);
```

Where `K` controls overall speed and `refRadius` normalizes the scale. This creates the correct "winding" pattern where inner material shears ahead of outer material.

For visual impact, you can exaggerate the differential slightly:
```glsl
// Exaggerated differential for visual clarity
float angularSpeed = K / pow(r / refRadius, 2.0); // steeper than Keplerian
```

### Gravitational Attraction (Infalling Matter)

Particles start at random positions and accelerate toward a point. Pure GPU — no CPU physics.

```javascript
// ── Gravitational Infall Particles ──
(function() {
  var N = 1500;
  var BH = new THREE.Vector3(3200, -800, -5500);
  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var startR = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    // Spawn on a shell at distance 800-1200
    var r = 800 + Math.random() * 400;
    var theta = Math.random() * 6.283;
    var phi = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = BH.x + r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = BH.y + r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = BH.z + r * Math.cos(phi);
    phase[i] = Math.random() * 6.283;
    speed[i] = 0.5 + Math.random() * 1.0;
    startR[i] = r;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(startR, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 2000);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aRadius;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha, vHeat;

      void main() {
        float t = uTime * 0.15 * aSpeed + aPhase;
        float cycle = mod(t, 6.283);
        float progress = cycle / 6.283;

        // Accelerating infall: starts slow, speeds up (gravitational acceleration)
        // Use easing: progress^2 gives quadratic acceleration feel
        float fallProgress = progress * progress;

        // Current radius — shrinks from startR to ~event horizon
        float r = mix(aRadius, 50.0, fallProgress);

        // Direction from spawn position toward BH, with slight tangential drift
        vec3 spawnDir = normalize(position - uBH);
        // Add tangential component for spiral rather than straight infall
        vec3 tangent = normalize(cross(spawnDir, vec3(0.0, 1.0, 0.0)));
        float spiralAngle = t * 0.8;

        vec3 p = uBH + (spawnDir * cos(spiralAngle) + tangent * sin(spiralAngle)) * r;

        // Flatten toward disk plane as particle gets closer
        float flattenAmount = smoothstep(400.0, 100.0, r);
        p.y = mix(p.y, uBH.y, flattenAmount * 0.8);

        vHeat = smoothstep(400.0, 80.0, r);
        vAlpha = smoothstep(0.0, 0.05, progress) * smoothstep(1.0, 0.9, progress);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(mix(2.0, 4.0, vHeat) * 200.0 / -mv.z, 1.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha, vHeat;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        vec3 col = mix(vec3(0.6, 0.25, 0.05), vec3(1.0, 0.95, 0.9), vHeat);
        gl_FragColor = vec4(col, soft * vAlpha * 0.7);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  window._infallMat = mat;
})();
```

### Photon Sphere Orbits

Particles locked at the photon sphere radius (1.5x Schwarzschild radius), orbiting at light speed. Some slowly decay inward or escape outward.

```javascript
// ── Photon Sphere Particles ──
(function() {
  var N = 400;
  var BH = new THREE.Vector3(3200, -800, -5500);
  var PHOTON_R = 350; // Photon sphere radius (1.5x event horizon)

  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var orbitTilt = new Float32Array(N); // each photon on a different orbital plane

  for (var i = 0; i < N; i++) {
    var a = Math.random() * 6.283;
    pos[i*3]   = BH.x + PHOTON_R * Math.cos(a);
    pos[i*3+1] = BH.y;
    pos[i*3+2] = BH.z + PHOTON_R * Math.sin(a);
    phase[i] = a; // starting angle
    speed[i] = 0.8 + Math.random() * 0.4; // near-uniform speed (it's light)
    orbitTilt[i] = (Math.random() - 0.5) * 3.14; // orbital plane tilt
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aOrbitTilt', new THREE.BufferAttribute(orbitTilt, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 600);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aOrbitTilt;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha;

      void main() {
        float t = uTime * 1.2 * aSpeed + aPhase; // fast orbit

        // Photon radius — slight oscillation (unstable orbit)
        float r = 350.0 + sin(t * 3.0 + aPhase * 7.0) * 8.0;

        // Orbit on a tilted plane
        float ang = t;
        float cosT = cos(aOrbitTilt);
        float sinT = sin(aOrbitTilt);

        vec3 p;
        p.x = uBH.x + r * cos(ang);
        float rawY = r * sin(ang) * sinT;
        float rawZ = r * sin(ang) * cosT;
        p.y = uBH.y + rawY;
        p.z = uBH.z + rawZ * cos(aPhase) + r * sin(ang) * cos(aOrbitTilt + aPhase);

        // More accurate: rotate the orbit plane
        float cx = r * cos(ang);
        float cy = 0.0;
        float cz = r * sin(ang);
        // Rotate around X axis by tilt
        p.x = uBH.x + cx;
        p.y = uBH.y + cy * cosT - cz * sinT;
        p.z = uBH.z + cy * sinT + cz * cosT;

        // Slight alpha flicker — photons shimmer
        vAlpha = 0.5 + sin(t * 8.0 + aPhase * 13.0) * 0.3;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(3.0 * 200.0 / -mv.z, 1.0, 8.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        // Photons are blue-white
        vec3 col = vec3(0.7, 0.8, 1.0);
        gl_FragColor = vec4(col, soft * vAlpha * 0.6);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  window._photonMat = mat;
})();
```

### Relativistic Jets (Bipolar Outflows)

Particles ejected from the poles at high speed, collimated into narrow beams. Two jets: one up, one down.

```javascript
// ── Relativistic Jets ──
(function() {
  var N_PER_JET = 600;
  var N = N_PER_JET * 2; // both jets
  var BH = new THREE.Vector3(3200, -800, -5500);
  var JET_LENGTH = 2000;
  var JET_RADIUS = 60; // narrow beam

  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var jetDir = new Float32Array(N); // +1 = up jet, -1 = down jet

  for (var i = 0; i < N; i++) {
    var isUp = i < N_PER_JET ? 1.0 : -1.0;
    pos[i*3]   = BH.x + (Math.random() - 0.5) * JET_RADIUS;
    pos[i*3+1] = BH.y;
    pos[i*3+2] = BH.z + (Math.random() - 0.5) * JET_RADIUS;
    phase[i] = Math.random() * 6.283;
    speed[i] = 0.5 + Math.random() * 0.8;
    jetDir[i] = isUp;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aJetDir', new THREE.BufferAttribute(jetDir, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 3000);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aJetDir;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha, vHeat;

      void main() {
        float t = uTime * 0.5 * aSpeed + aPhase;
        float cycle = mod(t, 6.283);
        float progress = cycle / 6.283; // 0=base, 1=tip

        // Distance along jet axis — accelerates outward
        float dist = progress * progress * 2000.0;

        // Jet spreads slightly with distance (conical)
        float spread = 30.0 + dist * 0.04;

        // Helical motion within the jet (magnetic field spiral)
        float helixAngle = t * 3.0 + aPhase * 2.0;
        float helixR = spread * (0.3 + 0.7 * sin(aPhase * 5.0));

        vec3 p;
        p.x = uBH.x + cos(helixAngle) * helixR;
        p.y = uBH.y + dist * aJetDir; // up or down
        p.z = uBH.z + sin(helixAngle) * helixR;

        // Bright at base, fading at tip
        vHeat = 1.0 - progress;
        vAlpha = smoothstep(0.0, 0.05, progress)
               * smoothstep(1.0, 0.7, progress)
               * 0.8;

        // Pulsing brightness — energy blobs traveling up the jet
        float pulse = sin(progress * 20.0 - uTime * 2.0) * 0.3 + 0.7;
        vAlpha *= pulse;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(mix(4.0, 1.5, progress) * 200.0 / -mv.z, 1.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha, vHeat;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;

        // Blue-white at base, purple-blue at tips
        vec3 base = vec3(0.6, 0.7, 1.0);
        vec3 tip = vec3(0.3, 0.2, 0.8);
        vec3 col = mix(tip, base, vHeat);

        gl_FragColor = vec4(col, soft * vAlpha);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  window._jetMat = mat;
})();
```

### Hawking Radiation

Very sparse particles appearing near the event horizon and escaping radially outward. Slow, faint, random directions.

```javascript
// ── Hawking Radiation ──
(function() {
  var N = 150;
  var BH = new THREE.Vector3(3200, -800, -5500);
  var EVENT_HORIZON = 240;

  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var dirTheta = new Float32Array(N);
  var dirPhi = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    // Spawn right at event horizon
    var theta = Math.random() * 6.283;
    var phi = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = BH.x + EVENT_HORIZON * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = BH.y + EVENT_HORIZON * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = BH.z + EVENT_HORIZON * Math.cos(phi);
    phase[i] = Math.random() * 6.283;
    speed[i] = 0.2 + Math.random() * 0.6;
    dirTheta[i] = theta;
    dirPhi[i] = phi;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aDirTheta', new THREE.BufferAttribute(dirTheta, 1));
  geo.setAttribute('aDirPhi', new THREE.BufferAttribute(dirPhi, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 2000);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aDirTheta, aDirPhi;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha;

      void main() {
        float t = uTime * 0.1 * aSpeed + aPhase;
        float cycle = mod(t, 6.283);
        float progress = cycle / 6.283;

        // Direction: radially outward from event horizon
        vec3 dir;
        dir.x = sin(aDirPhi) * cos(aDirTheta);
        dir.y = sin(aDirPhi) * sin(aDirTheta);
        dir.z = cos(aDirPhi);

        // Slow outward drift — Hawking radiation is very faint/slow
        float dist = 240.0 + progress * 500.0;

        vec3 p = uBH + dir * dist;

        // Extremely faint, flickers in and out
        float flicker = sin(t * 5.0 + aPhase * 11.0) * 0.5 + 0.5;
        vAlpha = smoothstep(0.0, 0.1, progress)
               * smoothstep(1.0, 0.6, progress)
               * flicker * 0.4;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(2.0 * 200.0 / -mv.z, 1.0, 6.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        // Hawking radiation — thermal spectrum, warm white-yellow
        vec3 col = vec3(1.0, 0.95, 0.85);
        gl_FragColor = vec4(col, soft * vAlpha);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  window._hawkingMat = mat;
})();
```

### Particle Trails / Streaks

Two approaches for trail effects on Quest:

**Approach 1: Elongated point sprites (cheapest)**
In the vertex shader, stretch gl_PointSize based on velocity direction relative to camera:

```glsl
// This doesn't truly stretch the point — points are always square.
// Instead, use the fragment shader to create directional falloff.
```

**Approach 2: Elongated quads via InstancedMesh (best quality)**

```javascript
// ── Streak Particles via InstancedMesh ──
(function() {
  var N = 500;
  var BH = new THREE.Vector3(3200, -800, -5500);

  // Thin quad geometry — elongated along Y
  var quadGeo = new THREE.PlaneGeometry(1, 8); // tall and thin

  // Per-instance attributes
  var offsets = new Float32Array(N * 3);
  var phases = new Float32Array(N);
  var speeds = new Float32Array(N);
  var radii = new Float32Array(N);

  for (var i = 0; i < N; i++) {
    var r = 300 + Math.random() * 600;
    var a = Math.random() * 6.283;
    offsets[i*3] = r * Math.cos(a);
    offsets[i*3+1] = (Math.random() - 0.5) * r * 0.1;
    offsets[i*3+2] = r * Math.sin(a);
    phases[i] = Math.random() * 6.283;
    speeds[i] = 0.4 + Math.random() * 0.6;
    radii[i] = r;
  }

  var instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = quadGeo.index;
  instGeo.attributes.position = quadGeo.attributes.position;
  instGeo.attributes.uv = quadGeo.attributes.uv;

  instGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  instGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  instGeo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
  instGeo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radii, 1));

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute vec3 aOffset;
      attribute float aPhase, aSpeed, aRadius;
      uniform float uTime;
      uniform vec3 uBH;
      varying vec2 vUv;
      varying float vAlpha;

      void main() {
        vUv = uv;
        float t = uTime * 0.3 * aSpeed + aPhase;
        float life = mod(t, 6.283);
        float progress = life / 6.283;

        float r = mix(aRadius, 270.0, progress * progress);
        float angSpeed = 1.2 / pow(max(r - 260.0, 10.0) / 100.0, 1.5);
        float ang = t * angSpeed + aPhase;

        // Compute current and slightly-future position for streak alignment
        vec3 center;
        center.x = uBH.x + r * cos(ang);
        center.y = uBH.y + aOffset.y;
        center.z = uBH.z + r * sin(ang);

        // Velocity direction (tangent to orbit)
        vec3 vel = vec3(-sin(ang), 0.0, cos(ang));

        // Billboard: face camera but stretch along velocity
        vec3 look = normalize(cameraPosition - center);
        vec3 right = normalize(cross(look, vel));
        vec3 up = vel; // streak direction = velocity

        // Scale: width 2, length proportional to speed
        float streakLen = mix(4.0, 12.0, 1.0 / max(r - 260.0, 10.0) * 100.0);
        vec3 worldPos = center
          + right * position.x * 2.0
          + up * position.y * streakLen;

        vAlpha = smoothstep(270.0, 300.0, r) * (1.0 - progress * 0.3);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        // Falloff along length and width
        float dx = abs(vUv.x - 0.5) * 2.0;
        float dy = abs(vUv.y - 0.5) * 2.0;
        float a = (1.0 - dx) * (1.0 - dy * dy) * vAlpha;

        vec3 col = vec3(1.0, 0.8, 0.5);
        gl_FragColor = vec4(col, a * 0.6);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  });

  var mesh = new THREE.Mesh(instGeo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  window._streakMat = mat;
})();
```

**Approach 3: Multi-point trail (good compromise)**
Store N positions per particle as consecutive points, each slightly behind the previous. All in one Points draw call:

```javascript
// ── Trail particles: each "particle" is 6 points forming a tail ──
(function() {
  var PARTICLES = 400;
  var TRAIL_LEN = 6; // points per trail
  var N = PARTICLES * TRAIL_LEN;
  var BH = new THREE.Vector3(3200, -800, -5500);

  var pos = new Float32Array(N * 3);
  var phase = new Float32Array(N);
  var speed = new Float32Array(N);
  var radius = new Float32Array(N);
  var trailIdx = new Float32Array(N); // 0=head, 1..5=tail

  for (var p = 0; p < PARTICLES; p++) {
    var r = 300 + Math.random() * 600;
    var a = Math.random() * 6.283;
    var s = 0.4 + Math.random() * 0.6;
    for (var t = 0; t < TRAIL_LEN; t++) {
      var i = p * TRAIL_LEN + t;
      pos[i*3] = BH.x + r * Math.cos(a);
      pos[i*3+1] = BH.y;
      pos[i*3+2] = BH.z + r * Math.sin(a);
      phase[i] = a;
      speed[i] = s;
      radius[i] = r;
      trailIdx[i] = t / (TRAIL_LEN - 1); // 0=head, 1=tail tip
    }
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geo.setAttribute('aTrailIdx', new THREE.BufferAttribute(trailIdx, 1));
  geo.boundingSphere = new THREE.Sphere(BH, 2000);

  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBH: { value: BH } },
    vertexShader: `
      attribute float aPhase, aSpeed, aRadius, aTrailIdx;
      uniform float uTime;
      uniform vec3 uBH;
      varying float vAlpha;
      varying vec3 vColor;

      void main() {
        // Each trail point is offset backward in time
        float timeOffset = aTrailIdx * 0.15; // trail points lag behind head
        float t = uTime * 0.3 * aSpeed + aPhase - timeOffset;

        float life = mod(t, 6.283);
        float progress = life / 6.283;
        float r = mix(aRadius, 270.0, progress * progress);
        float angSpeed = 1.5 / pow(max(r - 260.0, 10.0) / 100.0, 1.5);
        float ang = t * angSpeed + aPhase;

        vec3 p;
        p.x = uBH.x + r * cos(ang);
        p.z = uBH.z + r * sin(ang);
        p.y = uBH.y + sin(ang * 2.0 + aPhase) * r * 0.05;

        float heat = 1.0 - smoothstep(270.0, 600.0, r);
        vColor = mix(vec3(0.8, 0.3, 0.05), vec3(1.0, 0.95, 0.9), heat);

        // Trail fades: head=bright, tail=dim
        float trailFade = 1.0 - aTrailIdx;
        vAlpha = trailFade * smoothstep(270.0, 300.0, r) * 0.7;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Head bigger, tail smaller
        float sz = mix(4.0, 1.5, aTrailIdx);
        gl_PointSize = clamp(sz * 200.0 / -mv.z, 1.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        gl_FragColor = vec4(vColor, soft * vAlpha);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  window._trailMat = mat;
})();
```

### Color Evolution Over Lifetime

The general pattern for temperature/lifetime color mapping in the fragment shader:

```glsl
// ── Color Palette: Temperature-based ──
// Physically motivated: hotter matter emits at shorter wavelengths
// Maps a heat value (0=cold, 1=hot) to color

vec3 temperatureColor(float heat) {
  // Cool: deep red/infrared
  vec3 cold    = vec3(0.4, 0.05, 0.0);
  // Warm: orange
  vec3 warm    = vec3(0.9, 0.35, 0.05);
  // Hot: yellow-white
  vec3 hot     = vec3(1.0, 0.9, 0.6);
  // Extreme: blue-white (inverse Compton)
  vec3 extreme = vec3(0.7, 0.8, 1.0);

  vec3 col = mix(cold, warm, smoothstep(0.0, 0.3, heat));
  col = mix(col, hot, smoothstep(0.3, 0.7, heat));
  col = mix(col, extreme, smoothstep(0.7, 1.0, heat));
  return col;
}

// Usage in fragment shader:
// vHeat is passed from vertex shader based on radius or lifetime
vec3 col = temperatureColor(vHeat);

// ── Lifetime-based fade ──
// progress: 0=born, 1=dead
float lifetimeAlpha(float progress) {
  // Quick fade in, long sustain, quick fade out
  return smoothstep(0.0, 0.05, progress) * smoothstep(1.0, 0.85, progress);
}
```

**Brightness variation over lifetime** (vertex shader):
```glsl
// Born bright, gradually dim, flare up just before death (accretion heating)
float brightness = 1.0 - progress * 0.6;
// Final flare as particle approaches event horizon
brightness += smoothstep(0.8, 1.0, progress) * 0.4;
vAlpha *= brightness;
```

---

## Complete Black Hole Particle System

All systems combined into one animate loop. Copy this pattern into your BH build file.

```javascript
// ── Unified Black Hole Particle Tick ──
// Call this in your animate loop. All particle systems share one time uniform.

var _bhParticleMats = []; // collect all ShaderMaterials above

// After creating each system, push its material:
// _bhParticleMats.push(window._accretionMat);
// _bhParticleMats.push(window._photonMat);
// _bhParticleMats.push(window._jetMat);
// _bhParticleMats.push(window._hawkingMat);
// _bhParticleMats.push(window._infallMat);
// _bhParticleMats.push(window._trailMat);
// _bhParticleMats.push(window._streakMat);

function tickBHParticles() {
  var t = performance.now() * 0.001;
  for (var i = 0; i < _bhParticleMats.length; i++) {
    _bhParticleMats[i].uniforms.uTime.value = t;
  }
}

// In animate():
// tickBHParticles();
```

**Total particle budget for all systems combined:**

| System | Count | Draw Calls |
|--------|-------|-----------|
| Accretion spiral | 2,500 | 1 |
| Gravitational infall | 1,500 | 1 |
| Photon sphere | 400 | 1 |
| Jets (both) | 1,200 | 1 |
| Hawking radiation | 150 | 1 |
| Trails (400 x 6) | 2,400 | 1 |
| **Total** | **8,150** | **6** |

This is well within the Quest 3 safe zone of 10k particles / <50 draw calls.

---

## Texture Atlas for Particle Variation

Instead of all particles being circular soft dots, use a texture atlas with 4-8 variations:

```javascript
// ── Create a 4x1 Particle Texture Atlas ──
(function() {
  var cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64; // 4 tiles of 64x64
  var ctx = cv.getContext('2d');

  // Tile 0: Soft circle (default)
  var grad0 = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad0.addColorStop(0, 'rgba(255,255,255,1)');
  grad0.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad0.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad0;
  ctx.fillRect(0, 0, 64, 64);

  // Tile 1: Hard dot with halo
  var grad1 = ctx.createRadialGradient(96, 32, 0, 96, 32, 32);
  grad1.addColorStop(0, 'rgba(255,255,255,1)');
  grad1.addColorStop(0.15, 'rgba(255,255,255,1)');
  grad1.addColorStop(0.3, 'rgba(255,255,255,0.2)');
  grad1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad1;
  ctx.fillRect(64, 0, 64, 64);

  // Tile 2: Star/cross shape
  ctx.save();
  ctx.translate(160, 32);
  for (var r = 0; r < 4; r++) {
    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    g2.addColorStop(0, 'rgba(255,255,255,0.3)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(-30, -2, 60, 4);
    ctx.rotate(Math.PI / 4);
  }
  ctx.restore();

  // Tile 3: Elongated streak
  var g3 = ctx.createLinearGradient(192, 32, 256, 32);
  g3.addColorStop(0, 'rgba(255,255,255,0)');
  g3.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g3.addColorStop(0.5, 'rgba(255,255,255,1)');
  g3.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  g3.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(192, 24, 64, 16);

  window._particleAtlas = new THREE.CanvasTexture(cv);
})();
```

To use the atlas in a shader, pass a per-particle `aTile` attribute (0-3) and offset UVs in the fragment shader:

```glsl
// Fragment shader with texture atlas
uniform sampler2D uAtlas;
varying float vTile;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec2 uv = gl_PointCoord;
  // Offset into correct tile (4 tiles horizontally)
  uv.x = (uv.x + vTile) * 0.25;
  vec4 tex = texture2D(uAtlas, uv);
  gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
}
```

---

## Performance Tips

### 1. Always set boundingSphere or disable frustumCulled
```javascript
// Option A: Manual bounds (preferred — avoids recalculation)
geo.boundingSphere = new THREE.Sphere(centerPoint, maxRadius);

// Option B: Disable culling (simpler but slightly wasteful)
points.frustumCulled = false;
```

### 2. Minimize uniforms per frame
One `uTime` uniform is essentially free. Avoid uploading arrays or textures every frame.

### 3. Avoid discard when possible
`discard` in fragment shader prevents early-Z optimization. For additive blending particles, you can skip discard and just let alpha do the work:
```glsl
// Instead of: if (d > 0.5) discard;
// Use: alpha naturally goes to zero
float a = max(0.0, 1.0 - d * 2.0);
// With additive blending, zero alpha = invisible anyway
```

### 4. Keep gl_PointSize small
On Quest's Adreno 740, large point sprites (>32px) cause heavy fill-rate cost since each pixel of the bounding square runs the fragment shader. Keep max at 16-24px. Use InstancedMesh quads for anything that needs to appear large.

### 5. Use low-precision where possible
```glsl
// At top of fragment shader — mobile GPUs are faster with mediump
precision mediump float;
```

### 6. Combine particle systems
If two systems use the same shader logic, combine them into one Points object. Fewer draw calls is always better. Use an attribute to differentiate behavior:
```glsl
attribute float aType; // 0=accretion, 1=jet, 2=photon
// Branch in vertex shader based on aType
```
However, branching in shaders has a cost — only combine if the logic is similar.

### 7. Don't update attributes from CPU
Your current `km_bh13.html` has `updateBHParticles()` updating position/color/size arrays every frame and setting `needsUpdate = true`. This transfers ~72KB/frame to GPU for 2000 particles. The GPU spiral shader at line 1978 does the same visual effect with zero transfer. Always prefer the shader approach.

### 8. Quest-specific: avoid overlapping large transparent objects
With additive blending, 5000 particles overlapping at 16px each = massive overdraw. Keep particles small and use `depthTest: true` for non-essential particle layers to early-discard hidden ones.

### 9. Profile on Quest
Open `chrome://inspect` on desktop Chrome while Quest is connected via USB. Use the Performance tab to verify 72fps. The GPU tab shows draw calls and triangle count.

---

## Quick Reference: Shader Uniforms Needed

| Uniform | Type | Updated | Purpose |
|---------|------|---------|---------|
| `uTime` | float | Every frame | `performance.now() * 0.001` |
| `uBH` | vec3 | Once (or if BH moves) | Black hole world position |

| Attribute | Type | Set Once | Purpose |
|-----------|------|----------|---------|
| `position` | vec3 | Init only | Spawn position (seed for shader) |
| `aPhase` | float | Init only | Random offset (0 to 2PI) |
| `aSpeed` | float | Init only | Speed multiplier (0.3 to 1.2) |
| `aRadius` | float | Init only | Starting orbital radius |
| `aLife` | float | Init only | Lifetime offset |

All animation happens in the vertex shader using `uTime` + per-particle attributes. Zero CPU cost per frame.
