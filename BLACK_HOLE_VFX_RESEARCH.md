# Cinematic Black Hole VFX -- Quest 3 WebXR Reference

All techniques below are designed for:
- THREE.ShaderMaterial (r152 global build)
- No EffectComposer, no post-processing
- Stereo VR compatible (works per-eye automatically)
- Under 200 draw calls total scene budget
- Mobile GPU (Adreno 740, Quest 3)

---

## Table of Contents

1. [Gravitational Lensing Shaders](#1-gravitational-lensing-shaders)
2. [Accretion Disk Rendering](#2-accretion-disk-rendering)
3. [Blackbody Radiation Colors](#3-blackbody-radiation-colors)
4. [Doppler Beaming & Relativistic Shift](#4-doppler-beaming--relativistic-shift)
5. [Cinematic Visual Techniques](#5-cinematic-visual-techniques)
6. [Wormhole Tunnel Effect](#6-wormhole-tunnel-effect)
7. [Film & Game Reference Analysis](#7-film--game-reference-analysis)
8. [Quest 3 Integration Strategy](#8-quest-3-integration-strategy)
9. [Complete Drop-in Black Hole Function](#9-complete-drop-in-black-hole-function)

---

## 1. Gravitational Lensing Shaders

### 1A. The Physics (Simplified)

In general relativity, light follows geodesics in curved spacetime. Near a Schwarzschild black hole (non-rotating), the key parameters are:

- **Schwarzschild radius**: `rs = 2GM/c^2` (event horizon)
- **Photon sphere**: `r = 1.5 * rs` (light orbits the hole)
- **ISCO** (innermost stable circular orbit): `r = 3 * rs` (inner edge of accretion disk)

The gravitational force on a photon includes a relativistic correction term:

```
F = -GM/r^2 * (1 + 3 * L^2 / (r^2 * c^2))
```

where L is the specific angular momentum. In shader code with normalized units (rs = 1, c = 1), this simplifies to an inverse-cube attractive force that bends light rays.

### 1B. Approach Comparison for Quest 3

| Technique | Quality | GPU Cost | Quest 3 Viable? |
|---|---|---|---|
| Full RK4 geodesic integration (per pixel) | Physically accurate | 64-128 steps/pixel | NO -- too expensive |
| Verlet integration (per pixel, 32 steps) | Good approximation | 32 steps/pixel | MARGINAL -- only on small mesh |
| Precomputed deflection LUT (Bruneton) | Excellent, constant time | 1 texture lookup/pixel | YES -- best quality/perf |
| Analytical approximation (no marching) | Stylized but convincing | ~0 extra cost | YES -- cheapest |
| Mesh-based distortion (vertex shader) | Crude but fast | 0 fragment cost | YES -- fallback |

**Recommended for Quest 3**: Hybrid approach -- analytical approximation on a sphere mesh with a single-pass fragment shader. No ray marching. The black hole is rendered as a BackSide sphere that distorts the background via UV manipulation.

### 1C. Simplified Lensing -- Analytical Approximation (Quest 3 Safe)

This shader goes on a large BackSide sphere around the black hole. It samples the scene's background (stars/skybox) and distorts the sampling direction to simulate lensing. No ray marching needed.

**Key insight**: Instead of tracing rays through curved spacetime, we compute the deflection angle analytically from the impact parameter (closest approach distance) and apply it to the view direction.

The Einstein deflection angle for a Schwarzschild black hole:

```
delta_phi = 4GM / (b * c^2) = 2 * rs / b
```

where `b` is the impact parameter. For stronger fields (closer to photon sphere), higher-order terms matter:

```
delta_phi = 2*rs/b + 15*pi*rs^2 / (16*b^2) + ...
```

```glsl
// GRAVITATIONAL LENSING -- Analytical Approximation
// Apply to a BackSide sphere centered on the black hole
// Radius should be ~3-4x the visual event horizon

uniform float uTime;
uniform float uSchwarzschildRadius; // normalized, e.g. 1.0
uniform float uMass;                // controls lensing strength
uniform vec3 uBHPos;                // black hole world position
uniform samplerCube uSkybox;        // environment cubemap (or procedural)

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// -- Vertex Shader --
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}

// -- Fragment Shader --
// Bend the view ray around the black hole analytically

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 toBH = uBHPos - cameraPosition;

  // Impact parameter: perpendicular distance of ray from BH center
  float tClosest = dot(toBH, viewDir);
  vec3 closestPoint = cameraPosition + viewDir * tClosest;
  float b = length(closestPoint - uBHPos); // impact parameter

  float rs = uSchwarzschildRadius;
  float photonSphere = 1.5 * rs;

  // Deflection angle (higher-order Schwarzschild approximation)
  float deflection = 0.0;
  if (b > photonSphere) {
    // Safe region: use analytical deflection
    deflection = 2.0 * rs / b + 1.5 * rs * rs / (b * b);
  } else if (b > rs) {
    // Near photon sphere: strong lensing, clamp to prevent artifacts
    deflection = 3.14159; // light wraps around
  }
  // Inside event horizon: pure black (handled by the horizon sphere)

  // Apply deflection: bend viewDir toward the BH
  vec3 toCenter = normalize(uBHPos - closestPoint);
  vec3 bentDir = normalize(viewDir + toCenter * deflection * uMass);

  // Sample the background with bent direction
  vec3 skyColor = textureCube(uSkybox, bentDir).rgb;

  // Einstein ring: bright ring at the photon sphere projection
  float ringDist = abs(b - photonSphere) / rs;
  float einsteinRing = exp(-ringDist * ringDist * 8.0) * 0.5;
  skyColor += vec3(0.6, 0.7, 1.0) * einsteinRing;

  // Fade to black near event horizon
  float horizonFade = smoothstep(rs, rs * 1.8, b);
  skyColor *= horizonFade;

  // Chromatic aberration near the hole
  float chromShift = deflection * 0.02;
  vec3 bentR = normalize(bentDir + toCenter * chromShift);
  vec3 bentB = normalize(bentDir - toCenter * chromShift);
  skyColor.r = mix(skyColor.r, textureCube(uSkybox, bentR).r, 0.3);
  skyColor.b = mix(skyColor.b, textureCube(uSkybox, bentB).b, 0.3);

  gl_FragColor = vec4(skyColor, 1.0);
}
```

### 1D. Lensing Without Cubemap (Procedural Stars)

If you don't want to render a cubemap (saves a render pass), you can distort procedural stars directly in the lensing shader:

```glsl
// Star field with gravitational distortion -- no cubemap needed
// This replaces the skybox sampling with inline procedural stars

float proceduralStars(vec3 dir) {
  // Voronoi-based star field
  vec2 uv = vec2(atan(dir.z, dir.x) / 6.2832 + 0.5, acos(dir.y) / 3.1416);
  vec2 cell = floor(uv * 300.0);
  vec2 f = fract(uv * 300.0);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 nb = vec2(float(x), float(y));
      vec2 pt = vec2(hash(cell + nb), hash(cell + nb + 100.0));
      d = min(d, length(nb + pt - f));
    }
  }
  float star = 1.0 - smoothstep(0.0, 0.025, d);
  star *= step(0.92, hash(cell + 42.0));
  return star;
}

// In fragment shader, replace textureCube with:
float starBright = proceduralStars(bentDir);
vec3 starColor = mix(vec3(1.0, 0.9, 0.7), vec3(0.7, 0.8, 1.0), hash(floor(bentDir.xz * 100.0)));
vec3 skyColor = starColor * starBright;
```

### 1E. Ray-Marched Lensing (Higher Quality, Use Sparingly)

For when you want physically-based lensing on a single full-screen quad (e.g., a special cinematic moment). **Warning: expensive on Quest 3 -- limit to 16-24 steps max.**

```glsl
// Schwarzschild geodesic via Verlet integration
// Units: rs = 1.0 (Schwarzschild radius)
// Run this on a full-screen BackSide sphere

uniform float uTime;
uniform float uRS;          // Schwarzschild radius in world units
uniform vec3  uBHWorldPos;  // black hole center

const int MAX_STEPS = 20;   // Quest 3 budget: keep <= 24
const float STEP_SIZE = 0.4;

// Schwarzschild force with relativistic correction
// For a photon: F = -1.5 * rs * h^2 / r^5, where h = |r x v|
vec3 schwarzschildForce(vec3 pos, vec3 vel, float rs) {
  float r = length(pos);
  float r2 = r * r;
  vec3 crossRV = cross(pos, vel);
  float h2 = dot(crossRV, crossRV);
  // Newtonian + GR correction
  return -pos / (r * r2) * (1.0 + 1.5 * h2 / r2);
}

// Accretion disk intersection test (thin disk in XZ plane)
bool diskIntersect(vec3 p0, vec3 p1, float innerR, float outerR,
                   out vec3 hitPos, out float hitR) {
  // Check if ray segment crosses y=0 plane
  if (p0.y * p1.y < 0.0) {
    float t = p0.y / (p0.y - p1.y);
    hitPos = mix(p0, p1, t);
    hitR = length(hitPos.xz);
    return hitR > innerR && hitR < outerR;
  }
  return false;
}

void main() {
  vec3 rayDir = normalize(vWorldPos - cameraPosition);
  vec3 pos = vWorldPos - uBHWorldPos; // relative to BH center
  float rs = uRS;
  vec3 vel = rayDir * STEP_SIZE;

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(pos);
    float adaptiveStep = STEP_SIZE * clamp(r / (3.0 * rs), 0.2, 2.0);

    // Verlet integration (symplectic, better energy conservation than Euler)
    vec3 halfVel = vel + schwarzschildForce(pos, vel, rs) * adaptiveStep * 0.5;
    pos += halfVel * adaptiveStep;
    vel = halfVel + schwarzschildForce(pos, halfVel, rs) * adaptiveStep * 0.5;

    float newR = length(pos);

    // Hit event horizon?
    if (newR < rs) {
      color = vec3(0.0);
      alpha = 1.0;
      break;
    }

    // Hit accretion disk?
    vec3 hitPos;
    float hitR;
    vec3 prevPos = pos - vel * adaptiveStep;
    if (diskIntersect(prevPos, pos, 1.5 * rs, 8.0 * rs, hitPos, hitR)) {
      float temp = 1.0 - (hitR - 1.5 * rs) / (6.5 * rs);
      color = blackbodyColor(mix(2000.0, 12000.0, temp * temp));
      float brightness = pow(1.5 * rs / hitR, 3.0) * 2.0;
      color *= brightness;
      alpha = smoothstep(8.0 * rs, 6.0 * rs, hitR);
      break;
    }

    // Escaped to infinity -- sample background stars
    if (newR > 20.0 * rs) {
      vec3 dir = normalize(vel);
      color = vec3(proceduralStars(dir));
      alpha = 1.0;
      break;
    }
  }

  gl_FragColor = vec4(color, alpha);
}
```

---

## 2. Accretion Disk Rendering

### 2A. Physics Background

A thin accretion disk (Shakura-Sunyaev model, simplified) has:
- **Inner edge** at ISCO: `r = 3 * rs` (6GM/c^2)
- **Temperature profile**: `T(r) ~ r^(-3/4)` -- hottest at inner edge
- **Orbital velocity**: Keplerian, `v ~ r^(-1/2)` -- inner orbits faster
- **Luminosity**: `L ~ r^(-3)` -- overwhelmingly bright near ISCO
- **Color**: follows blackbody radiation (white-blue inner, orange-red outer)

### 2B. Shader-Based Accretion Disk (Single Ring Mesh)

Instead of 8 separate ring meshes (current approach = 8 draw calls), use a single RingGeometry with a ShaderMaterial that handles the full temperature/color gradient, rotation animation, and turbulence.

```javascript
// Accretion Disk -- Single draw call, full cinematic quality
function createAccretionDisk(bhPos, innerRadius, outerRadius, tiltEuler) {
  // High-res ring: 128 radial segments, 32 rings
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 32);

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:       { value: 0 },
      uInnerR:     { value: innerRadius },
      uOuterR:     { value: outerRadius },
      uBrightness: { value: 1.5 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRadius;
      varying float vAngle;
      uniform float uInnerR;
      uniform float uOuterR;
      uniform float uTime;

      void main() {
        vUv = uv;

        // Compute radius and angle from ring geometry position
        vRadius = length(position.xy);
        vAngle = atan(position.y, position.x);

        // Keplerian rotation: inner orbits faster
        // Angular velocity ~ r^(-3/2)
        float normalizedR = (vRadius - uInnerR) / (uOuterR - uInnerR);
        float angularVel = 1.0 / pow(max(normalizedR, 0.01) + 0.1, 1.5);
        float rotation = uTime * angularVel * 0.3;

        // Rotate vertex around origin
        float c = cos(rotation);
        float s = sin(rotation);
        vec3 rotPos = vec3(
          position.x * c - position.y * s,
          position.x * s + position.y * c,
          position.z
        );

        gl_Position = projectionMatrix * modelViewMatrix * vec4(rotPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uInnerR;
      uniform float uOuterR;
      uniform float uBrightness;

      varying vec2 vUv;
      varying float vRadius;
      varying float vAngle;

      // Blackbody color (Tanner Helland / CIE 1964)
      vec3 blackbody(float tempKelvin) {
        float t = tempKelvin / 1000.0;
        vec3 c;
        if (t < 6.6) c.r = 1.0;
        else c.r = 1.292 * pow(t - 6.0, -0.1332);
        if (t < 6.6) c.g = 0.39 * log(t) - 0.634;
        else c.g = 1.129 * pow(t - 6.0, -0.0755);
        if (t < 19.0) {
          if (t < 2.0) c.b = 0.0;
          else c.b = 0.543 * log(t - 1.0) - 1.186;
        } else c.b = 1.0;
        return clamp(c, 0.0, 1.0);
      }

      // Simplex-ish noise for turbulence
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(0.877, 0.479, -0.479, 0.877);
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = rot * p * 2.01;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        float normalizedR = (vRadius - uInnerR) / (uOuterR - uInnerR);
        normalizedR = clamp(normalizedR, 0.0, 1.0);

        // Temperature: inner edge ~10000K, outer edge ~2000K
        // T ~ r^(-3/4) from Shakura-Sunyaev
        float tempK = mix(12000.0, 1800.0, pow(normalizedR, 0.75));
        vec3 diskColor = blackbody(tempK);

        // Luminosity profile: inner rings MUCH brighter
        float luminosity = pow(1.0 - normalizedR, 3.0) * uBrightness;

        // Turbulence -- spiral arms and hot spots
        float angle = vAngle + uTime * 0.2;
        vec2 noiseUV = vec2(angle * 3.0, normalizedR * 8.0);
        float turb = fbm(noiseUV + uTime * 0.15);
        float spiralArm = sin(angle * 2.0 - normalizedR * 12.0 + uTime * 0.5)
                          * 0.5 + 0.5;

        // Hot spots (bright clumps in the disk)
        float hotspot = smoothstep(0.55, 0.7, turb) * 2.0;

        // Combine
        float brightness = luminosity * (0.6 + turb * 0.4 + spiralArm * 0.3
                                         + hotspot * 0.5);

        // Inner edge glow (ISCO emission)
        float innerGlow = exp(-normalizedR * 8.0) * 3.0;
        diskColor += vec3(0.5, 0.6, 1.0) * innerGlow;

        // Outer edge fade
        float outerFade = smoothstep(1.0, 0.85, normalizedR);
        float innerFade = smoothstep(0.0, 0.02, normalizedR);

        float alpha = brightness * outerFade * innerFade;
        alpha = clamp(alpha, 0.0, 0.9);

        gl_FragColor = vec4(diskColor * brightness, alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(bhPos);
  if (tiltEuler) mesh.rotation.copy(tiltEuler);

  return {
    mesh,
    tick: function(time) {
      mat.uniforms.uTime.value = time;
    }
  };
}
```

**Draw call cost**: 1 (down from 8 in current implementation)

### 2C. Secondary Disk Image (Lensed Back-Side)

In real black hole images (and Interstellar), you see the back side of the accretion disk warped over the top and bottom of the black hole -- light from behind bends around. To fake this cheaply:

```javascript
// Second ring mesh, tilted perpendicular and scaled to wrap over the horizon
// This creates the "hat brim" effect seen in Interstellar
function createSecondaryDiskImage(bhPos, horizonRadius) {
  const geo = new THREE.RingGeometry(horizonRadius * 0.95, horizonRadius * 1.6, 128, 4);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRadius;
      void main() {
        vUv = uv;
        vRadius = length(position.xy);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vRadius;
      void main() {
        // Thin bright arc that hugs the horizon
        float glow = exp(-pow(vUv.y - 0.5, 2.0) * 50.0);
        float pulse = sin(vUv.x * 40.0 - uTime * 3.0) * 0.3 + 0.7;
        vec3 col = mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.95, 0.9), glow);
        float alpha = glow * pulse * 0.4;
        gl_FragColor = vec4(col, alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(bhPos);
  // Tilt perpendicular to main disk -- this is the "over the top" image
  mesh.rotation.x = Math.PI * 0.5;

  return {
    mesh,
    tick: function(time) { mat.uniforms.uTime.value = time; }
  };
}
```

**Draw call cost**: 1 additional

### 2D. Accretion Particle Spiral (GPU-Animated, Enhanced)

Improved vertex shader with proper Keplerian spiraling + inspiraling decay:

```glsl
// Enhanced accretion particle vertex shader
attribute float aPhase;
attribute float aSpeed;
attribute float aRadius;
attribute float aSeed;

uniform float uTime;
uniform vec3 uBH;
uniform float uInnerR;

varying float vTemp;
varying float vAlpha;

void main() {
  float t = uTime * 0.3 * aSpeed + aPhase;

  // Particles slowly spiral inward over their lifetime
  float life = mod(t, 12.566); // two full orbits before reset
  float decay = 1.0 - life / 12.566;
  float r = aRadius * decay + uInnerR;

  // Keplerian angular velocity: omega ~ r^(-3/2)
  float omega = 1.0 / pow(r / uInnerR, 1.5);
  float angle = t * omega + aPhase;

  // Disk plane with slight vertical wobble
  float diskThickness = r * 0.04;
  float verticalOffset = sin(t * 2.0 + aSeed * 10.0) * diskThickness;

  vec3 pos;
  pos.x = uBH.x + r * cos(angle);
  pos.z = uBH.z + r * sin(angle);
  pos.y = uBH.y + verticalOffset;

  // Temperature: hotter near center
  vTemp = 1.0 - smoothstep(uInnerR, uInnerR * 5.0, r);

  // Fade at edges
  vAlpha = smoothstep(uInnerR * 0.9, uInnerR * 1.2, r)
         * smoothstep(aRadius * 1.1, aRadius * 0.7, r)
         * (0.5 + 0.5 * decay);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = mix(2.0, 5.0, vTemp);
  gl_Position = projectionMatrix * mvPos;
}
```

```glsl
// Enhanced accretion particle fragment shader
varying float vTemp;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float soft = 1.0 - d * 2.0;

  // Temperature-based color
  vec3 cool = vec3(0.8, 0.25, 0.05);  // deep red/orange
  vec3 warm = vec3(1.0, 0.7, 0.2);    // orange-yellow
  vec3 hot  = vec3(1.0, 0.95, 0.85);  // white-hot

  vec3 col;
  if (vTemp < 0.5) col = mix(cool, warm, vTemp * 2.0);
  else col = mix(warm, hot, (vTemp - 0.5) * 2.0);

  gl_FragColor = vec4(col, soft * vAlpha * 0.7);
}
```

---

## 3. Blackbody Radiation Colors

### 3A. GLSL Blackbody Function

Based on the Tanner Helland algorithm (derived from Mitchell Charity's CIE 1964 blackbody data). This maps temperature in Kelvin to linear RGB:

```glsl
// Attempt to approximate blackbody radiation color
// Input: temperature in Kelvin (1000 - 40000)
// Output: linear RGB color (not sRGB!)
// Based on Tanner Helland / CIE 1964 10-degree CMF data

vec3 blackbodyColor(float tempK) {
  float t = clamp(tempK, 1000.0, 40000.0) / 100.0;

  vec3 color;

  // Red
  if (t <= 66.0) {
    color.r = 1.0;
  } else {
    color.r = 1.2929 * pow(t - 60.0, -0.1332);
  }

  // Green
  if (t <= 66.0) {
    color.g = 0.3901 * log(t) - 0.6318;
  } else {
    color.g = 1.1298 * pow(t - 60.0, -0.0755);
  }

  // Blue
  if (t >= 190.0) {
    color.b = 1.0;
  } else if (t <= 19.0) {
    color.b = 0.0;
  } else {
    color.b = 0.5432 * log(t - 10.0) - 1.1962;
  }

  return clamp(color, 0.0, 1.0);
}
```

### 3B. Accretion Disk Temperature Profile

```glsl
// Shakura-Sunyaev thin disk temperature profile (simplified)
// r: distance from center in units of Schwarzschild radius
// Returns temperature in Kelvin

float diskTemperature(float r, float rs) {
  float rISCO = 3.0 * rs;
  if (r < rISCO) return 0.0;

  // T(r) ~ T_max * (r/rISCO)^(-3/4) * [1 - sqrt(rISCO/r)]^(1/4)
  float x = r / rISCO;
  float Tmax = 15000.0; // peak temperature at ISCO in Kelvin

  // The full Novikov-Thorne profile:
  float T = Tmax * pow(x, -0.75) * pow(1.0 - 1.0 / sqrt(x), 0.25);

  return T;
}
```

### 3C. Temperature Color Map for the Disk

| Temperature (K) | Color | Location |
|---|---|---|
| 1500-2000 | Deep red | Outer disk edge |
| 3000-4000 | Orange-red | Mid-outer disk |
| 5000-6000 | Yellow-white | Mid disk |
| 8000-10000 | White | Inner disk |
| 12000-15000 | Blue-white | ISCO region |
| 20000+ | Deep blue-violet | Jet base |

---

## 4. Doppler Beaming & Relativistic Shift

### 4A. The Physics

Material orbiting the black hole at relativistic speeds produces two effects:
1. **Doppler shift**: approaching side appears blue-shifted (brighter), receding side appears red-shifted (dimmer)
2. **Relativistic beaming**: the approaching side is dramatically brightened (the "headlight effect")

The Doppler factor:

```
delta = 1 / (gamma * (1 - beta * cos(theta)))
```

where beta = v/c, gamma = 1/sqrt(1-beta^2), theta = angle between velocity and line of sight.

The observed frequency shifts by delta, and the observed intensity shifts by delta^3 (for a continuous spectrum) or delta^4 (for a line emitter).

### 4B. GLSL Doppler Implementation

```glsl
// Add to accretion disk fragment shader
// Requires: orbital velocity direction at each disk point

uniform vec3 uCamPos;

float computeDoppler(vec3 diskPos, vec3 orbitDir, vec3 camPos, float orbitalSpeed) {
  vec3 toCamera = normalize(camPos - diskPos);
  float cosTheta = dot(orbitDir, toCamera);

  float beta = orbitalSpeed;
  float gamma = 1.0 / sqrt(1.0 - beta * beta);

  // Doppler factor
  float delta = 1.0 / (gamma * (1.0 - beta * cosTheta));

  return delta;
}

// Apply Doppler to disk color:
// float doppler = computeDoppler(...);
// Shift temperature: T_observed = T_emitted * doppler
// Shift brightness: I_observed = I_emitted * doppler^3
//
// vec3 shiftedColor = blackbodyColor(tempK * doppler) * pow(doppler, 3.0);
```

### 4C. Simplified Doppler (Cheaper -- Quest 3 Recommended)

```glsl
// Simplified Doppler: just brighten the approaching side
float simpleDoppler(float angle, float viewAngle, float orbitalSpeed) {
  float approach = cos(angle - viewAngle + 1.5708);
  float boost = 1.0 + approach * orbitalSpeed * 3.0;
  return clamp(boost, 0.3, 3.0);
}

// In disk fragment shader:
// float doppler = simpleDoppler(vAngle, cameraAngle, 0.3 * (1.0 - normalizedR));
// diskColor *= doppler;
// diskColor = mix(diskColor, vec3(0.6, 0.7, 1.0), max(doppler - 1.5, 0.0) * 0.3);
// diskColor = mix(diskColor, vec3(1.0, 0.4, 0.2), max(1.0 - doppler, 0.0) * 0.5);
```

---

## 5. Cinematic Visual Techniques

### 5A. Heat Haze / Space Distortion

A vertex-shader based distortion on a transparent sphere around the black hole. Wobbles vertices to create a shimmering heat-haze effect. Zero fragment cost.

```javascript
function createHeatHaze(bhPos, radius) {
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0.03 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      void main() {
        vNormal = normalize(normalMatrix * normal);

        // Distort vertex positions with animated noise
        vec3 noiseInput = position * 3.0 + uTime * 0.5;
        float n = hash(floor(noiseInput * 2.0));
        vec3 displaced = position + normal * sin(n * 6.28 + uTime * 2.0) * uStrength;

        vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        // Fresnel-based transparency: more visible at edges
        float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 4.0);
        vec3 col = vec3(0.1, 0.12, 0.18);
        gl_FragColor = vec4(col, fresnel * 0.15);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(bhPos);
  return {
    mesh,
    tick: function(time) { mat.uniforms.uTime.value = time; }
  };
}
```

**Draw call cost**: 1

### 5B. Mesh-Based Light Streaks (No Post-Processing Lens Flare)

Elongated quads that point toward the camera, positioned around the accretion disk's brightest points:

```javascript
function createLightStreaks(bhPos, count, radius) {
  count = count || 6;
  const group = new THREE.Group();

  const streakGeo = new THREE.PlaneGeometry(1, 1);
  const streakMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffaa44) },
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
        // Horizontal streak shape: bright center, fading to edges
        float xFade = exp(-pow(vUv.x - 0.5, 2.0) * 8.0);
        float yFade = exp(-pow(vUv.y - 0.5, 2.0) * 80.0); // very thin
        float streak = xFade * yFade;
        float shimmer = sin(vUv.x * 20.0 + uTime * 3.0) * 0.3 + 0.7;
        vec3 col = mix(uColor, vec3(1.0, 0.95, 0.9), yFade);
        gl_FragColor = vec4(col, streak * shimmer * 0.4);
      }
    `
  });

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const streak = new THREE.Mesh(streakGeo, streakMat.clone());
    streak.scale.set(radius * 0.8, radius * 0.05, 1);
    streak.position.set(
      bhPos.x + Math.cos(angle) * radius * 0.3,
      bhPos.y + Math.sin(angle) * radius * 0.1,
      bhPos.z
    );
    streak.lookAt(bhPos);
    group.add(streak);
  }

  return {
    group,
    tick: function(time, camera) {
      streakMat.uniforms.uTime.value = time;
      group.children.forEach(s => {
        s.quaternion.copy(camera.quaternion);
      });
    }
  };
}
```

**Draw call cost**: 6 (one per streak)

### 5C. Background Star Distortion Near the Hole

If using the procedural skybox shader from `vfx_shaders.js`, add a distortion pass inside that shader based on proximity to the black hole's projected position:

```glsl
// Add to the skybox fragment shader (createSpaceSkybox)
// This distorts stars near the black hole without a separate pass

uniform vec3 uBHDir;       // normalized direction from camera to BH
uniform float uBHAngSize;  // angular size of BH influence zone

// In main(), after computing dir:
float bhAngle = acos(clamp(dot(dir, uBHDir), -1.0, 1.0));
float bhInfluence = 1.0 - smoothstep(0.0, uBHAngSize, bhAngle);

// Bend star lookup direction toward/around the BH
if (bhInfluence > 0.01) {
  vec3 towardBH = normalize(uBHDir - dir * dot(dir, uBHDir));
  // Lensing: stars near the BH appear displaced outward
  float displacement = bhInfluence * bhInfluence * 0.3;
  dir = normalize(dir - towardBH * displacement);

  // Einstein ring: stars at a specific angle get amplified
  float ringAngle = uBHAngSize * 0.4;
  float ringBright = exp(-pow(bhAngle - ringAngle, 2.0) / 0.001) * 5.0;
  // Add ringBright to star brightness later
}

// Use the modified 'dir' for all star lookups
// This creates visible warping of the star field near the BH
```

### 5D. Chromatic Aberration Near Event Horizon

```glsl
// Chromatic aberration: split RGB channels with different deflection
// This simulates wavelength-dependent lensing

// In the lensing fragment shader, replace single sample with:
float chromStrength = 0.015 * deflection;
vec3 offsetR = toCenter * chromStrength;
vec3 offsetB = -toCenter * chromStrength;

vec3 finalColor;
finalColor.r = sampleBackground(bentDir + offsetR);  // red bends more
finalColor.g = sampleBackground(bentDir);             // green is reference
finalColor.b = sampleBackground(bentDir + offsetB);   // blue bends less

// This is physically backwards (shorter wavelengths bend more in GR)
// but the reversed version looks more cinematic (Interstellar did this too)
```

---

## 6. Wormhole Tunnel Effect

### 6A. Wormhole Geometry (from Interstellar)

The Interstellar wormhole is a 3D sphere that, when entered, connects to another region of space through a tunnel whose shape is described by the Ellis metric. The tunnel radius varies with proper distance.

For a game/VR effect, simplify to a cylinder with varying radius:

```javascript
// Enhanced wormhole tunnel -- single draw call
// Based on the existing createWormhole() in vfx_shaders.js
// Enhanced with proper throat shape and color grading

function createCinematicWormhole(length, throatRadius, mouthRadius) {
  length = length || 30;
  throatRadius = throatRadius || 1.0;
  mouthRadius = mouthRadius || 3.0;

  // Custom tube geometry: wider at mouths, narrow at throat (center)
  const segments = 64;
  const radialSegments = 48;
  const positions = [];
  const uvs = [];
  const indices = [];

  // Generate vertices with Ellis-metric-inspired profile
  // r(l) = sqrt(throat^2 + l^2) -- the embedding of a wormhole
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = (t - 0.5) * length;
    const r = Math.sqrt(throatRadius * throatRadius + z * z * 0.1);
    const radius = Math.min(r, mouthRadius);

    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      positions.push(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z
      );
      uvs.push(j / radialSegments, t);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 2.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vDepth = position.z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      varying vec2 vUv;
      varying float vDepth;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1,0)), f.x),
          mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p); p = p * 2.01 + 0.1; a *= 0.5;
        }
        return v;
      }

      void main() {
        float angle = vUv.x * 6.28318;
        float along = vUv.y;

        // Swirling energy: multiple spiral layers
        float swirl1 = angle + along * 10.0 + uTime * uSpeed;
        float swirl2 = angle * 1.5 - along * 7.0 + uTime * uSpeed * 0.7;
        float swirl3 = angle * 0.5 + along * 15.0 - uTime * uSpeed * 1.3;

        float n1 = fbm(vec2(swirl1, along * 4.0));
        float n2 = fbm(vec2(swirl2, along * 3.0) + 5.0);
        float n3 = fbm(vec2(swirl3, along * 5.0) + 10.0);

        // Throat glow: brightest at center
        float throat = 1.0 - abs(along - 0.5) * 2.0;
        float throatGlow = pow(throat, 2.0);

        float streaks = pow(n1, 2.0) * 0.8 + pow(n2, 3.0) * 0.5;

        // Color: blue-white at throat, orange at mouths
        vec3 throatColor = vec3(0.5, 0.7, 1.0);
        vec3 mouthColor = vec3(1.0, 0.5, 0.2);
        vec3 energyColor = vec3(0.3, 0.5, 1.0);

        vec3 col = mix(mouthColor, throatColor, throatGlow);
        col += energyColor * streaks * 0.5;
        col += vec3(1.0, 0.9, 0.8) * pow(n3, 4.0) * 0.3;

        // Grid lines (like Interstellar)
        float gridU = abs(sin(angle * 8.0)) * 0.05;
        float gridV = abs(sin(along * 40.0 - uTime * uSpeed * 2.0)) * 0.03;
        col += vec3(0.4, 0.6, 1.0) * (gridU + gridV) * throatGlow;

        // Speed lines traveling through tunnel
        float speedLine = pow(abs(sin(along * 60.0 - uTime * 8.0
                                     + angle * 2.0)), 20.0);
        col += vec3(0.8, 0.9, 1.0) * speedLine * 0.5;

        float alpha = (0.15 + streaks * 0.3 + throatGlow * 0.2);
        alpha *= smoothstep(0.0, 0.05, along) * smoothstep(1.0, 0.95, along);

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.7));
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);

  return {
    mesh,
    tick: function(time) { mat.uniforms.uTime.value = time; }
  };
}
```

**Draw call cost**: 1

---

## 7. Film & Game Reference Analysis

### 7A. Interstellar's Gargantua (2014)

**Paper**: "Gravitational Lensing by Spinning Black Holes in Astrophysics, and in the Movie Interstellar" -- Oliver James, Eugenie von Tunzelmann, Paul Franklin, Kip Thorne (Classical and Quantum Gravity, 2015).

**DNGR (Double Negative Gravitational Renderer)**:
- Ray-bundle tracing (not individual rays) for anti-aliasing
- Full Kerr metric (spinning black hole, spin parameter a = 0.999)
- Each pixel traced a beam of light backwards through curved spacetime
- Used 4th-order Runge-Kutta integration of the geodesic equations
- Accretion disk: volumetric with Doppler shift and gravitational redshift
- Rendered at IMAX resolution, took ~100 hours per frame on render farm

**Key Visual Features to Replicate**:
1. **Double image of disk**: The back of the disk is visible above AND below the black hole (light wraps around)
2. **Asymmetric brightness**: One side of the disk is much brighter (Doppler beaming from approaching material)
3. **Einstein ring**: A thin bright ring at the photon sphere
4. **Star distortion**: Background stars are visibly displaced and amplified near the hole
5. **Thin disk**: The accretion disk is geometrically thin but optically thick

**Simplification for Real-Time**:
- Replace ray-bundle tracing with analytical deflection (Section 1C)
- Use a second ring mesh for the secondary disk image (Section 2C)
- Bake the Doppler asymmetry into the disk shader (Section 4C)
- The double-image of the disk is the most recognizable feature -- prioritize this

### 7B. Elite: Dangerous

**Technique**: Full-screen post-process gravitational lensing
- Renders the scene normally, then applies a UV distortion pass
- The distortion map is based on the projected position and angular size of the black hole
- Uses a pre-computed LUT for the deflection angle vs. impact parameter
- Chromatic aberration added in the distortion pass
- The accretion disk is a flat textured mesh with animated UVs

**Simplification from Interstellar**:
- No volumetric disk (flat texture)
- No Doppler asymmetry (symmetric brightness)
- Simpler deflection model (not full Kerr metric)
- Still looks extremely impressive because the lensing distortion is the dominant visual cue

**What to steal**: The observation that a simple UV distortion of the background is enough to sell the effect. You don't need physically accurate geodesics.

### 7C. No Man's Sky

**Technique**: Mostly artistic/stylized
- Black holes are visually a dark sphere with a bright accretion ring
- Simple radial distortion shader (fish-eye effect centered on the hole)
- Particle effects for approaching debris
- Screen-space color grading (shift to blue/purple near the hole)
- The "entering" animation is a tunnel effect with speed lines

**Simplification from Elite**:
- No per-pixel lensing of background
- Just a radial distortion post-effect
- Accretion disk is a simple glowing ring, not physically motivated

**What to steal**: The tunnel transition effect when entering. Simple radial distortion is very cheap and still reads as "black hole."

### 7D. Real-Time Simplification Hierarchy

From most expensive to cheapest, all still read as "black hole":

| Level | Technique | Draw Calls | GPU Cost |
|---|---|---|---|
| S | Per-pixel geodesic ray march (Bruneton) | 1 full-screen | Very High |
| A | Per-pixel analytical deflection (Section 1C) | 1 sphere | High |
| B | Render-to-texture + distortion quad (current vfx_shaders.js) | +1 full pass | Medium |
| C | Vertex-displaced lensing sphere + disk shader | 3-4 meshes | Low |
| D | MeshBasic rings + particles (current km_bh13) | ~23 meshes | Very Low |

**Recommended for Quest 3**: Level C in VR, Level B in desktop mode. The existing Level D implementation works but can be consolidated.

---

## 8. Quest 3 Integration Strategy

### 8A. Draw Call Budget

Current black hole in km_bh13.html: ~23 draw calls (1 horizon + 1 photon sphere + 6 halos + 8 disk rings + 6 jets + 1 particles).

**Optimized version**:

| Component | Draw Calls | Notes |
|---|---|---|
| Event horizon sphere | 1 | Black sphere, depthWrite true |
| Lensing sphere (BackSide) | 1 | Analytical lensing shader (Section 1C) |
| Accretion disk (single ring) | 1 | Full shader disk (Section 2B) |
| Secondary disk image | 1 | Lensed back-side (Section 2C) |
| Accretion particles | 1 | GPU-animated Points (Section 2D) |
| Heat haze sphere | 1 | Optional, subtle distortion (Section 5A) |
| Relativistic jets | 1 | Single mesh, both jets as one geometry |
| **Total** | **6-7** | Down from 23 |

### 8B. Stereo VR Compatibility

All techniques above use standard THREE.ShaderMaterial which Three.js automatically renders twice (once per eye) in WebXR mode. No special handling needed because:

1. All effects are mesh-based (spheres, rings, planes) -- not screen-space
2. No EffectComposer or render-to-texture required
3. `modelViewMatrix` and `projectionMatrix` are automatically set per-eye by Three.js
4. Depth testing works naturally in stereo

**The one exception**: The render-to-texture lensing from `vfx_shaders.js` (`createGravityLensing`) does NOT work in VR because it renders to a single texture, not per-eye. Use the mesh-based analytical lensing (Section 1C) instead.

### 8C. Performance Tips for Quest 3

1. **Limit ray march steps**: If using ray-marched lensing, cap at 16 steps. 20 is borderline, 32 will drop frames.
2. **Reduce ring geometry**: 64 radial segments is enough (not 128). Use 16 rings instead of 32.
3. **Skip the secondary disk image**: The biggest visual win for the least cost is the single accretion disk shader. The secondary image is a nice-to-have.
4. **Particle count**: 1000-2000 particles is safe. Each is just a vertex shader calculation.
5. **Avoid overlapping transparency**: The biggest GPU killer on Quest is overdraw from overlapping transparent objects. Keep additive-blended layers to 3-4 max in any pixel.
6. **Texture-based noise**: If fbm() in the disk shader causes frame drops, pre-bake a noise texture (256x256) and sample it instead of computing noise per-pixel per-frame.

### 8D. LOD Strategy

```javascript
// Reduce black hole detail based on distance
function updateBlackHoleLOD(bhGroup, cameraDistance) {
  const near = 500;
  const far = 3000;
  const t = Math.max(0, Math.min(1, (cameraDistance - near) / (far - near)));

  // Disable secondary disk image when far
  if (secondaryDisk) secondaryDisk.visible = t < 0.5;

  // Disable heat haze when far
  if (heatHaze) heatHaze.visible = t < 0.3;

  // Reduce particle opacity when far
  if (particleMat) particleMat.uniforms.uAlpha.value = 1.0 - t * 0.7;

  // Disable lensing sphere when very far (just show the basic rings)
  if (lensingMesh) lensingMesh.visible = t < 0.7;
}
```

---

## 9. Complete Drop-in Black Hole Function

This consolidates everything above into a single function matching the km-quest architecture:

```javascript
// ============================================================
// CINEMATIC BLACK HOLE -- Quest 3 VR Safe
// Total: 5 draw calls, ~8k tris, 1 Points object
// Drop-in replacement for buildBlackHole() in km_bh*.html
// ============================================================

function createCinematicBlackHole(position, schwarzschildRadius) {
  const RS = schwarzschildRadius || 260;
  const BH = position.clone();
  const group = new THREE.Group();
  const tiltEuler = new THREE.Euler(0.38, 0.22, 0.0);

  // -- 1. Event Horizon -- pure black sphere --
  const horizonGeo = new THREE.SphereGeometry(RS, 32, 24);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    depthWrite: true,
  });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.position.copy(BH);
  horizon.userData.isBlackHole = true;
  group.add(horizon);

  // -- 2. Lensing Shell -- analytical gravitational lensing --
  const lensGeo = new THREE.SphereGeometry(RS * 4, 48, 32);
  const lensMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uRS: { value: RS },
      uBH: { value: BH },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRS;
      uniform vec3 uBH;
      varying vec3 vWorldPos;

      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

      float stars(vec3 dir) {
        vec2 uv = vec2(atan(dir.z,dir.x)/6.2832+0.5,
                       acos(clamp(dir.y,-1.0,1.0))/3.1416);
        vec2 cell = floor(uv * 250.0);
        vec2 f = fract(uv * 250.0);
        float d = 1.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 nb=vec2(float(x),float(y));
          vec2 pt=vec2(hash(cell+nb),hash(cell+nb+100.0));
          d=min(d,length(nb+pt-f));
        }
        return (1.0-smoothstep(0.0,0.03,d))*step(0.9,hash(cell+42.0));
      }

      void main() {
        vec3 viewDir = normalize(vWorldPos - cameraPosition);
        vec3 toBH = uBH - cameraPosition;

        float tClosest = dot(toBH, viewDir);
        vec3 closest = cameraPosition + viewDir * tClosest;
        float b = length(closest - uBH);

        float rs = uRS;
        float photonR = 1.5 * rs;

        // Analytical deflection
        float deflection = 0.0;
        if (b > photonR) {
          deflection = 2.0 * rs / b + 1.5 * rs * rs / (b * b);
        } else if (b > rs) {
          deflection = 3.14159;
        }

        vec3 toCenter = normalize(uBH - closest);
        vec3 bentDir = normalize(viewDir + toCenter * deflection);

        // Sample stars with bent direction
        float starBright = stars(bentDir);
        vec3 starCol = mix(vec3(1.0,0.9,0.7), vec3(0.7,0.8,1.0),
                           hash(floor(bentDir.xz*100.0)));
        vec3 col = starCol * starBright * 1.5;

        // Einstein ring
        float ringDist = abs(b - photonR) / rs;
        col += vec3(0.5, 0.6, 1.0) * exp(-ringDist*ringDist*6.0) * 0.4;

        // Chromatic aberration
        float chromShift = deflection * 0.01;
        vec3 bentR = normalize(bentDir + toCenter * chromShift);
        vec3 bentB = normalize(bentDir - toCenter * chromShift);
        col.r = mix(col.r, stars(bentR) * 1.5, 0.3);
        col.b = mix(col.b, stars(bentB) * 1.5, 0.3);

        // Horizon fade
        col *= smoothstep(rs, rs * 2.0, b);

        // Transparency: only visible where there's lensing
        float alpha = smoothstep(rs * 4.0, rs * 2.0, b);

        gl_FragColor = vec4(col, alpha);
      }
    `
  });
  const lensMesh = new THREE.Mesh(lensGeo, lensMat);
  lensMesh.position.copy(BH);
  group.add(lensMesh);

  // -- 3. Accretion Disk -- single shader ring --
  const diskInner = RS * 1.05;
  const diskOuter = RS * 3.5;
  const diskGeo = new THREE.RingGeometry(diskInner, diskOuter, 96, 24);
  const diskMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:   { value: 0 },
      uInnerR: { value: diskInner },
      uOuterR: { value: diskOuter },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRadius;
      varying float vAngle;
      uniform float uInnerR, uOuterR, uTime;

      void main() {
        vUv = uv;
        vRadius = length(position.xy);
        vAngle = atan(position.y, position.x);

        float normR = (vRadius - uInnerR) / (uOuterR - uInnerR);
        float angVel = 1.0 / pow(max(normR, 0.01) + 0.1, 1.5);
        float rot = uTime * angVel * 0.3;
        float c = cos(rot), s = sin(rot);
        vec3 rp = vec3(
          position.x*c - position.y*s,
          position.x*s + position.y*c,
          position.z
        );

        gl_Position = projectionMatrix * modelViewMatrix * vec4(rp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uInnerR, uOuterR;
      varying vec2 vUv;
      varying float vRadius, vAngle;

      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                   mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p){
        float v=0.0,a=0.5; mat2 rot=mat2(0.877,0.479,-0.479,0.877);
        for(int i=0;i<4;i++){v+=a*noise(p);p=rot*p*2.01;a*=0.5;} return v;
      }

      vec3 blackbody(float t){
        t=clamp(t,1000.0,40000.0)/100.0;
        vec3 c;
        c.r=t<=66.0?1.0:1.293*pow(t-60.0,-0.1332);
        c.g=t<=66.0?0.390*log(t)-0.632:1.130*pow(t-60.0,-0.0755);
        c.b=t>=190.0?1.0:(t<=19.0?0.0:0.543*log(t-10.0)-1.196);
        return clamp(c,0.0,1.0);
      }

      void main() {
        float normR = clamp((vRadius-uInnerR)/(uOuterR-uInnerR), 0.0, 1.0);

        // Temperature: T ~ r^(-3/4)
        float tempK = mix(14000.0, 1800.0, pow(normR, 0.75));
        vec3 col = blackbody(tempK);

        // Luminosity: inner >> outer
        float lum = pow(1.0-normR, 3.0) * 2.0;

        // Turbulence
        float ang = vAngle + uTime * 0.2;
        float turb = fbm(vec2(ang*3.0, normR*8.0) + uTime*0.15);
        float spiral = sin(ang*2.0 - normR*12.0 + uTime*0.5)*0.5+0.5;
        float hotspot = smoothstep(0.55,0.7,turb)*2.0;

        float brightness = lum*(0.6+turb*0.4+spiral*0.3+hotspot*0.5);

        // Doppler asymmetry (approaching side brighter)
        float doppler = 1.0 + sin(vAngle + 0.5)*0.4*(1.0-normR);
        brightness *= doppler;

        // Blue boost on approaching side
        col = mix(col, vec3(0.6,0.7,1.0), max(doppler-1.2,0.0)*0.3);

        // Inner glow
        col += vec3(0.4,0.5,1.0) * exp(-normR*8.0) * 3.0;

        // Fades
        float alpha = brightness
          * smoothstep(1.0, 0.85, normR)
          * smoothstep(0.0, 0.02, normR);

        gl_FragColor = vec4(col * brightness, clamp(alpha, 0.0, 0.85));
      }
    `
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  disk.position.copy(BH);
  disk.rotation.copy(tiltEuler);
  group.add(disk);

  // -- 4. Secondary Disk Image (lensed back-side) --
  const secGeo = new THREE.RingGeometry(RS * 0.95, RS * 1.8, 96, 4);
  const secMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float glow = exp(-pow(vUv.y-0.5,2.0)*50.0);
        float pulse = sin(vUv.x*40.0-uTime*3.0)*0.3+0.7;
        vec3 col = mix(vec3(1.0,0.6,0.2), vec3(1.0,0.95,0.85), glow);
        gl_FragColor = vec4(col, glow*pulse*0.3);
      }
    `
  });
  const secDisk = new THREE.Mesh(secGeo, secMat);
  secDisk.position.copy(BH);
  secDisk.rotation.set(
    tiltEuler.x + Math.PI*0.5, tiltEuler.y, tiltEuler.z
  );
  group.add(secDisk);

  // -- 5. Accretion Particles (GPU spiral) --
  const PN = 1500;
  const pp = new Float32Array(PN*3);
  const pPhase = new Float32Array(PN);
  const pSpeed = new Float32Array(PN);
  const pRadius = new Float32Array(PN);
  const pSeed = new Float32Array(PN);

  for (let i = 0; i < PN; i++) {
    const r = diskInner + Math.random() * (diskOuter - diskInner);
    const a = Math.random() * 6.283;
    pp[i*3]   = BH.x + r * Math.cos(a);
    pp[i*3+1] = BH.y + (Math.random()-0.5) * r * 0.08;
    pp[i*3+2] = BH.z + r * Math.sin(a);
    pPhase[i] = Math.random() * 6.283;
    pSpeed[i] = 0.5 + Math.random() * 0.8;
    pRadius[i] = r;
    pSeed[i] = Math.random();
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  pGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhase, 1));
  pGeo.setAttribute('aSpeed', new THREE.BufferAttribute(pSpeed, 1));
  pGeo.setAttribute('aRadius', new THREE.BufferAttribute(pRadius, 1));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));

  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBH: { value: BH },
      uInnerR: { value: diskInner },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase, aSpeed, aRadius, aSeed;
      uniform float uTime;
      uniform vec3 uBH;
      uniform float uInnerR;
      varying float vTemp, vAlpha;

      void main() {
        float t = uTime * 0.3 * aSpeed + aPhase;
        float life = mod(t, 12.566);
        float decay = 1.0 - life / 12.566;
        float r = aRadius * decay + uInnerR;

        float omega = 1.0 / pow(r / uInnerR, 1.5);
        float angle = t * omega + aPhase;

        float vertOff = sin(t*2.0+aSeed*10.0) * r * 0.04;

        vec3 pos;
        pos.x = uBH.x + r * cos(angle);
        pos.z = uBH.z + r * sin(angle);
        pos.y = uBH.y + vertOff;

        vTemp = 1.0 - smoothstep(uInnerR, uInnerR*5.0, r);
        vAlpha = smoothstep(uInnerR*0.9, uInnerR*1.2, r)
               * smoothstep(aRadius*1.1, aRadius*0.7, r)
               * (0.5+0.5*decay);

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = mix(2.0, 4.0, vTemp);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTemp, vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if(d > 0.5) discard;
        float soft = 1.0 - d * 2.0;
        vec3 cool = vec3(0.8,0.25,0.05);
        vec3 warm = vec3(1.0,0.7,0.2);
        vec3 hot  = vec3(1.0,0.95,0.85);
        vec3 col = vTemp<0.5
          ? mix(cool,warm,vTemp*2.0)
          : mix(warm,hot,(vTemp-0.5)*2.0);
        gl_FragColor = vec4(col, soft*vAlpha*0.7);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  group.add(new THREE.Points(pGeo, pMat));

  // -- Animation tick --
  return {
    group: group,
    horizon: horizon,
    tick: function(time) {
      lensMat.uniforms.uTime.value = time;
      diskMat.uniforms.uTime.value = time;
      secMat.uniforms.uTime.value = time;
      pMat.uniforms.uTime.value = time;
    },
    setLOD: function(cameraDistance) {
      const t = Math.max(0, Math.min(1,
        (cameraDistance - 500) / 2500));
      secDisk.visible = t < 0.5;
      lensMesh.visible = t < 0.7;
    }
  };
}

// -- Usage --
// const bh = createCinematicBlackHole(
//   new THREE.Vector3(3200, -800, -5500), 260
// );
// scene.add(bh.group);
// blackHoleMesh = bh.horizon; // for raycasting
//
// In animate():
//   bh.tick(performance.now() * 0.001);
//   bh.setLOD(camera.position.distanceTo(BH_POS));
```

---

## Key Sources & References

- [Gravitational Lensing by Spinning Black Holes -- Oliver James / Kip Thorne (arXiv)](https://arxiv.org/abs/1502.03808)
- [oseiskar/black-hole -- WebGL Schwarzschild lensing](https://github.com/oseiskar/black-hole)
- [Bruneton Real-time Black Hole Shader](https://ebruneton.github.io/black_hole_shader/)
- [Bruneton functions.glsl](https://ebruneton.github.io/black_hole_shader/black_hole/functions.glsl.html)
- [Bruneton model.glsl](https://ebruneton.github.io/black_hole_shader/black_hole/model.glsl.html)
- [Shadertoy: Black hole with accretion disk](https://www.shadertoy.com/view/tsBXW3)
- [Shadertoy: Black Hole with Disk](https://www.shadertoy.com/view/cstBRj)
- [Silvera0218/BlackHole-Simulation](https://github.com/Silvera0218/BlackHole-Simulation)
- [SushantGagneja/Black-Hole-simulation (Kerr + Doppler)](https://github.com/SushantGagneja/Black-Hole-simulation)
- [Three.js Roadmap: Raytracing a Black Hole with WebGPU](https://threejsroadmap.com/blog/raytracing-a-black-hole-with-webgpu)
- [Raymarching: Simulating a Black Hole (Johan Svensson)](https://medium.com/dotcrossdot/raymarching-simulating-a-black-hole-53624a3684d3)
- [Building a Black Hole Shader in Godot 4](https://tkte.ch/articles/2026/01/15/godot-blackhole-shader.html)
- [chrismatgit/black-hole-simulation (React/Three.js)](https://github.com/chrismatgit/black-hole-simulation)
- [Blackbody Rendering (Miles Macklin)](https://blog.mmacklin.com/2010/12/29/blackbody-rendering/)
- [Kelvin to RGB Algorithm (Tanner Helland)](https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html)
- [Shadertoy: Blackbody Radiation](https://www.shadertoy.com/view/llsGDB)
- [Building Gargantua (CERN Courier)](https://cerncourier.com/a/building-gargantua/)
- [The Singular Pull of Black Holes in Games (Space.com)](https://www.space.com/black-holes-in-games)
- [Black Hole rendering (Alexandre Prieur / ENS)](https://www.eleves.ens.fr/home/aprieur/bh_render.html)
- [Rantonels/Starless -- Python ray tracer](https://rantonels.github.io/starless/)
- [KristiDodaj/Black-Hole-Simulator](https://github.com/KristiDodaj/Black-Hole-Simulator)
- [CS184 Final Project: Black Hole Raymarcher](https://celticspwn.github.io/CS184FinalProject/final.html)
