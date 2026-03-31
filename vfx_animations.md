# WebXR Animation & Transition Reference — Quest 3

All code: THREE r152 global build, no EffectComposer, no post-processing.
Target: 72fps on Quest 3. Budget: <200 draw calls, <100k tris.

---

## Table of Contents

1. [Easing Functions (Complete Set)](#1-easing-functions)
2. [Animation Timer Utility](#2-animation-timer)
3. [Camera / Movement Animations](#3-camera--movement)
4. [Object Animations](#4-object-animations)
5. [Transition Effects](#5-transition-effects)
6. [UI / Card Animations for VR](#6-ui--card-animations)
7. [Performance Notes](#7-performance-notes)

---

## 1. Easing Functions

Complete set — all take `t` in `[0, 1]`, return `[0, 1]`.

```javascript
const Ease = {
  // ── Linear ──
  linear: t => t,

  // ── Quadratic ──
  inQuad:    t => t * t,
  outQuad:   t => t * (2 - t),
  inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // ── Cubic ──
  inCubic:    t => t * t * t,
  outCubic:   t => (--t) * t * t + 1,
  inOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // ── Quartic ──
  inQuart:    t => t * t * t * t,
  outQuart:   t => 1 - (--t) * t * t * t,
  inOutQuart: t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,

  // ── Quintic ──
  inQuint:    t => t * t * t * t * t,
  outQuint:   t => 1 + (--t) * t * t * t * t,
  inOutQuint: t => t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t,

  // ── Sine ──
  inSine:    t => 1 - Math.cos(t * Math.PI / 2),
  outSine:   t => Math.sin(t * Math.PI / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,

  // ── Exponential ──
  inExpo:    t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  outExpo:   t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inOutExpo: t => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // ── Circular ──
  inCirc:    t => 1 - Math.sqrt(1 - t * t),
  outCirc:   t => Math.sqrt(1 - (--t) * t),
  inOutCirc: t => t < 0.5
    ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
    : (Math.sqrt(1 - (-2 * t + 2) * (-2 * t + 2)) + 1) / 2,

  // ── Elastic ──
  inElastic: t => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
  },
  outElastic: t => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },
  inOutElastic: t => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI / 4.5))) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI / 4.5))) / 2 + 1;
  },

  // ── Back (overshoot) ──
  inBack: t => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
  outBack: t => {
    const s = 1.70158;
    return (t -= 1) * t * ((s + 1) * t + s) + 1;
  },
  inOutBack: t => {
    const s = 1.70158 * 1.525;
    return t < 0.5
      ? (2 * t) * (2 * t) * ((s + 1) * 2 * t - s) / 2
      : ((2 * t - 2) * (2 * t - 2) * ((s + 1) * (t * 2 - 2) + s) + 2) / 2;
  },

  // ── Bounce ──
  outBounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1)          return n1 * t * t;
    else if (t < 2 / d1)     return n1 * (t -= 1.5 / d1) * t + 0.75;
    else if (t < 2.5 / d1)   return n1 * (t -= 2.25 / d1) * t + 0.9375;
    else                      return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inBounce: t => 1 - Ease.outBounce(1 - t),
  inOutBounce: t => t < 0.5
    ? (1 - Ease.outBounce(1 - 2 * t)) / 2
    : (1 + Ease.outBounce(2 * t - 1)) / 2,
};
```

---

## 2. Animation Timer

Minimal tween engine. Zero allocations per frame. Use this to drive all animations below.

```javascript
class Anim {
  constructor() {
    this._tweens = [];
  }

  /**
   * @param {number} duration — seconds
   * @param {function} easeFn — from Ease above
   * @param {function} onUpdate(t) — t is eased 0..1
   * @param {function} [onComplete] — called once at end
   * @returns {object} handle with .cancel()
   */
  tween(duration, easeFn, onUpdate, onComplete) {
    const tw = { elapsed: 0, duration, easeFn, onUpdate, onComplete, done: false };
    this._tweens.push(tw);
    return {
      cancel: () => { tw.done = true; }
    };
  }

  /** Call once per frame with delta in seconds */
  tick(dt) {
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const tw = this._tweens[i];
      if (tw.done) { this._tweens.splice(i, 1); continue; }
      tw.elapsed += dt;
      let raw = Math.min(tw.elapsed / tw.duration, 1);
      tw.onUpdate(tw.easeFn(raw));
      if (raw >= 1) {
        tw.done = true;
        if (tw.onComplete) tw.onComplete();
        this._tweens.splice(i, 1);
      }
    }
  }

  /** Sequence: runs animations one after another */
  sequence(steps) {
    let idx = 0;
    const next = () => {
      if (idx >= steps.length) return;
      const s = steps[idx++];
      this.tween(s.duration, s.ease || Ease.linear, s.update, () => {
        if (s.complete) s.complete();
        next();
      });
    };
    next();
  }
}

// Global instance
const anim = new Anim();

// In your animate loop:
// const clock = new THREE.Clock();
// function animate() { anim.tick(clock.getDelta()); ... }
```

---

## 3. Camera / Movement

### 3a. Smooth Zoom with Easing

Move galaxyGroup toward/away from viewer. Works in WebXR because it transforms the group, not the camera.

```javascript
function smoothZoom(galaxyGroup, targetScale, duration, easeFn) {
  const startScale = galaxyGroup.scale.x;
  const startPos = galaxyGroup.position.clone();
  // Zoom toward a target point (e.g., a selected node)
  return anim.tween(duration, easeFn || Ease.outCubic, t => {
    const s = THREE.MathUtils.lerp(startScale, targetScale, t);
    galaxyGroup.scale.setScalar(s);
  });
}

// Usage examples with different easings:
// smoothZoom(galaxyGroup, 0.004, 1.5, Ease.outCubic);    // gentle zoom in
// smoothZoom(galaxyGroup, 0.004, 1.0, Ease.outExpo);     // fast then settle
// smoothZoom(galaxyGroup, 0.004, 2.0, Ease.outElastic);  // bouncy zoom
// smoothZoom(galaxyGroup, 0.004, 1.2, Ease.outBack);     // overshoot zoom
```

### 3b. Smooth Position Transition (Viewpoint Switch)

```javascript
function smoothMoveTo(galaxyGroup, targetPos, targetScale, duration, easeFn) {
  const startPos = galaxyGroup.position.clone();
  const startScale = galaxyGroup.scale.x;
  easeFn = easeFn || Ease.inOutCubic;

  return anim.tween(duration, easeFn, t => {
    galaxyGroup.position.lerpVectors(startPos, targetPos, t);
    const s = THREE.MathUtils.lerp(startScale, targetScale, t);
    galaxyGroup.scale.setScalar(s);
  });
}

// Fly to a specific node:
function flyToNode(galaxyGroup, node, xrScale) {
  const nodeWorld = new THREE.Vector3();
  node.mesh.getWorldPosition(nodeWorld);

  // Target: node at eye level, 0.5m in front of viewer
  const targetPos = new THREE.Vector3(
    -nodeWorld.x, 1.4 - nodeWorld.y, -4 - nodeWorld.z
  );
  const targetScale = xrScale * 3; // zoom in 3x
  return smoothMoveTo(galaxyGroup, targetPos, targetScale, 2.0, Ease.inOutCubic);
}
```

### 3c. CatmullRom Fly-Through Path

```javascript
function createFlyPath(points) {
  // points: array of THREE.Vector3 — the waypoints
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);

  return {
    curve,
    /**
     * Animate galaxyGroup position along the path
     * @param {THREE.Group} galaxyGroup
     * @param {number} duration — total seconds
     * @param {function} easeFn
     */
    fly(galaxyGroup, duration, easeFn) {
      const startPos = galaxyGroup.position.clone();
      return anim.tween(duration, easeFn || Ease.inOutSine, t => {
        const point = curve.getPointAt(t);
        galaxyGroup.position.copy(point);
      });
    }
  };
}

// Usage:
// const path = createFlyPath([
//   new THREE.Vector3(0, 1.4, -4),
//   new THREE.Vector3(2, 2.0, -6),
//   new THREE.Vector3(-1, 1.0, -3),
//   new THREE.Vector3(0, 1.4, -4),
// ]);
// path.fly(galaxyGroup, 8.0, Ease.inOutSine);
```

### 3d. Warp Speed / Hyperspace Jump

Stretches star points along the camera forward axis using a vertex shader. Zero CPU cost.

```javascript
function createWarpStars(count) {
  count = count || 2000;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    speeds[i] = 0.5 + Math.random() * 1.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uWarp:     { value: 0 },  // 0 = normal, 1 = full warp
      uTime:     { value: 0 },
      uStretch:  { value: 8.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSpeed;
      uniform float uWarp, uTime, uStretch;
      varying float vAlpha;
      varying float vStretch;

      void main() {
        vec3 pos = position;

        // Move stars toward camera during warp
        float z = mod(pos.z + uTime * aSpeed * 10.0 * uWarp, 40.0) - 20.0;
        pos.z = z;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);

        // Stretch points into lines during warp
        float stretch = uWarp * uStretch * aSpeed;
        vStretch = stretch;
        vAlpha = mix(0.3, 1.0, uWarp) * smoothstep(-20.0, -2.0, mvPos.z);

        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = mix(1.5, 2.5, uWarp);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(0.8, 0.85, 1.0, a);
      }
    `
  });

  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;

  let warpTarget = 0;

  return {
    mesh: stars,
    /** Start warp effect */
    engage() { warpTarget = 1; },
    /** End warp effect */
    disengage() { warpTarget = 0; },
    tick(time) {
      // Smooth transition to warp state
      mat.uniforms.uWarp.value += (warpTarget - mat.uniforms.uWarp.value) * 0.05;
      mat.uniforms.uTime.value = time;
    }
  };
}

// Budget: 1 draw call, 2000 vertices
// Usage:
// const warp = createWarpStars(2000);
// scene.add(warp.mesh);
// warp.engage();  // start hyperspace
// warp.disengage(); // exit hyperspace
// In animate: warp.tick(clock.getElapsedTime());
```

### 3e. Warp Jump with Line Stretching (Full Hyperspace)

For a more dramatic streak effect using LineSegments instead of points:

```javascript
function createHyperspaceStreaks(count) {
  count = count || 500;
  const positions = new Float32Array(count * 6); // 2 verts per line
  const speeds = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 16;
    const y = (Math.random() - 0.5) * 16;
    const z = Math.random() * -40;
    const spd = 0.5 + Math.random();
    // Start vertex
    positions[i * 6]     = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    // End vertex (same point initially)
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = z;
    speeds[i * 2] = spd;
    speeds[i * 2 + 1] = spd;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uWarp: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSpeed;
      uniform float uWarp, uTime;
      varying float vAlpha;

      void main() {
        vec3 pos = position;
        float z = mod(pos.z + uTime * aSpeed * 15.0 * uWarp, 40.0) - 40.0;
        pos.z = z;

        // Every other vertex is the tail (offset by index parity)
        float isTail = mod(float(gl_VertexID), 2.0);
        pos.z += isTail * uWarp * aSpeed * 4.0; // stretch tail backward

        vAlpha = uWarp * 0.6 * smoothstep(-40.0, -5.0, pos.z);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.7, 0.8, 1.0, vAlpha);
      }
    `
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;

  let warpTarget = 0;
  return {
    mesh: lines,
    engage() { warpTarget = 1; },
    disengage() { warpTarget = 0; },
    tick(time) {
      mat.uniforms.uWarp.value += (warpTarget - mat.uniforms.uWarp.value) * 0.04;
      mat.uniforms.uTime.value = time;
    }
  };
}
// Budget: 1 draw call, 1000 vertices
```

### 3f. Orbital Camera Around Object

```javascript
function orbitAround(galaxyGroup, centerWorldPos, radius, duration, easeFn) {
  const startPos = galaxyGroup.position.clone();
  // Calculate offset so the target stays centered
  const offset = new THREE.Vector3();

  return anim.tween(duration, easeFn || Ease.inOutSine, t => {
    const angle = t * Math.PI * 2;
    offset.set(
      Math.sin(angle) * radius,
      0,
      Math.cos(angle) * radius
    );
    galaxyGroup.position.copy(startPos).add(offset);
  });
}
```

### 3g. Slow Motion / Time Dilation Visual

Scale the delta time multiplier + visual effect:

```javascript
let timeScale = 1.0;
let timeScaleTarget = 1.0;

function setSlowMotion(scale, duration) {
  timeScaleTarget = scale; // e.g., 0.2 for 5x slow-mo
  // Optional: animate a vignette or chromatic shift
  anim.tween(duration || 0.5, Ease.outCubic, t => {
    timeScale = THREE.MathUtils.lerp(1.0, scale, t);
  });
}

function resumeNormal(duration) {
  const from = timeScale;
  anim.tween(duration || 0.5, Ease.outCubic, t => {
    timeScale = THREE.MathUtils.lerp(from, 1.0, t);
  });
}

// In animate loop:
// const rawDelta = clock.getDelta();
// const dt = rawDelta * timeScale;
// anim.tick(dt);
// Pass dt to all shader uTime increments
```

---

## 4. Object Animations

### 4a. Pop-In with Overshoot (Entrance)

```javascript
function popIn(mesh, targetScale, duration) {
  mesh.scale.setScalar(0.001);
  mesh.visible = true;
  const ts = targetScale || 1;

  return anim.tween(duration || 0.6, Ease.outBack, t => {
    mesh.scale.setScalar(ts * t);
  });
}

// Staggered group entrance:
function popInGroup(meshes, targetScale, staggerDelay) {
  staggerDelay = staggerDelay || 0.05;
  meshes.forEach((mesh, i) => {
    mesh.scale.setScalar(0.001);
    mesh.visible = true;
    setTimeout(() => {
      popIn(mesh, targetScale, 0.6);
    }, i * staggerDelay * 1000);
  });
}
```

### 4b. Fade In/Out with Opacity

```javascript
function fadeIn(mesh, duration) {
  mesh.material.transparent = true;
  mesh.material.opacity = 0;
  mesh.visible = true;

  return anim.tween(duration || 0.5, Ease.outCubic, t => {
    mesh.material.opacity = t;
  });
}

function fadeOut(mesh, duration, removeOnComplete) {
  mesh.material.transparent = true;
  const startOpacity = mesh.material.opacity;

  return anim.tween(duration || 0.5, Ease.inCubic, t => {
    mesh.material.opacity = startOpacity * (1 - t);
  }, () => {
    if (removeOnComplete) mesh.visible = false;
  });
}
```

### 4c. Dissolve Shader (Pattern-Based Fade)

```javascript
function createDissolveMaterial(baseColor, dissolveColor) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uProgress: { value: 0 },       // 0 = solid, 1 = gone
      uBaseColor: { value: new THREE.Color(baseColor || 0xe8d89a) },
      uEdgeColor: { value: new THREE.Color(dissolveColor || 0xff6600) },
      uEdgeWidth: { value: 0.05 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress, uEdgeWidth;
      uniform vec3 uBaseColor, uEdgeColor;
      varying vec3 vPos;

      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                       mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                       mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }

      void main() {
        float n = noise(vPos * 5.0);
        float edge = smoothstep(uProgress - uEdgeWidth, uProgress, n);
        float alpha = smoothstep(uProgress, uProgress + 0.01, n);
        vec3 col = mix(uEdgeColor, uBaseColor, edge);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `
  });
}

// Usage:
// const mat = createDissolveMaterial(0xe8d89a, 0xff4400);
// mesh.material = mat;
// anim.tween(1.5, Ease.inCubic, t => { mat.uniforms.uProgress.value = t; });
```

### 4d. Rotation with Wobble / Precession

```javascript
function wobbleRotation(mesh, amplitude, frequency) {
  amplitude = amplitude || 0.15; // radians
  frequency = frequency || 1.0;

  // Call in animate loop with elapsed time
  return function tick(time) {
    mesh.rotation.x = Math.sin(time * frequency) * amplitude;
    mesh.rotation.z = Math.cos(time * frequency * 0.7) * amplitude * 0.6;
  };
}

// Precession (spinning top motion):
function precessRotation(mesh, spinSpeed, precessSpeed, tiltAngle) {
  spinSpeed = spinSpeed || 2.0;
  precessSpeed = precessSpeed || 0.3;
  tiltAngle = tiltAngle || 0.3;

  return function tick(time) {
    mesh.rotation.y = time * spinSpeed;
    mesh.rotation.x = Math.sin(time * precessSpeed) * tiltAngle;
    mesh.rotation.z = Math.cos(time * precessSpeed) * tiltAngle;
  };
}
```

### 4e. Floating / Bobbing Idle

```javascript
function floatingBob(mesh, amplitude, speed, offset) {
  amplitude = amplitude || 0.1;
  speed = speed || 1.0;
  offset = offset || 0; // phase offset for variety
  const baseY = mesh.position.y;

  return function tick(time) {
    mesh.position.y = baseY + Math.sin(time * speed + offset) * amplitude;
  };
}

// Group with varied phases:
function floatingBobGroup(meshes, amplitude, speed) {
  const ticks = meshes.map((mesh, i) =>
    floatingBob(mesh, amplitude, speed, i * 1.3)
  );
  return function tick(time) {
    for (let i = 0; i < ticks.length; i++) ticks[i](time);
  };
}
```

### 4f. Pulse / Heartbeat Glow

Shader-based emissive pulse. No extra draw calls.

```javascript
function createPulseGlowMaterial(baseColor, glowColor, glowIntensity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uBaseColor: { value: new THREE.Color(baseColor || 0x445566) },
      uGlowColor: { value: new THREE.Color(glowColor || 0xe8d89a) },
      uIntensity: { value: glowIntensity || 1.5 },
      uSpeed:     { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIntensity, uSpeed;
      uniform vec3 uBaseColor, uGlowColor;
      varying vec3 vNormal, vViewDir;

      void main() {
        float fresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
        fresnel = pow(fresnel, 2.0);

        // Heartbeat: two quick pulses then pause
        float t = mod(uTime * uSpeed, 1.5);
        float beat = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.08, 0.2, t))
                   + smoothstep(0.25, 0.33, t) * (1.0 - smoothstep(0.33, 0.5, t));
        beat *= 0.5;

        vec3 glow = uGlowColor * fresnel * uIntensity * (0.3 + beat * 0.7);
        gl_FragColor = vec4(uBaseColor + glow, 1.0);
      }
    `
  });
}

// Simple sinusoidal pulse (lighter than heartbeat):
function simplePulse(mesh, minScale, maxScale, speed) {
  minScale = minScale || 0.95;
  maxScale = maxScale || 1.05;
  speed = speed || 2.0;

  return function tick(time) {
    const s = THREE.MathUtils.lerp(minScale, maxScale,
      (Math.sin(time * speed) + 1) * 0.5);
    mesh.scale.setScalar(s);
  };
}
```

### 4g. Spring Physics (Damped Oscillation)

```javascript
class Spring {
  constructor(stiffness, damping, mass) {
    this.k = stiffness || 120;   // spring constant
    this.d = damping || 12;      // damping coefficient
    this.m = mass || 1;          // mass
    this.value = 0;
    this.target = 0;
    this.velocity = 0;
  }

  setTarget(target) {
    this.target = target;
  }

  /** Call every frame with delta time in seconds */
  update(dt) {
    // Clamp dt to prevent explosion
    dt = Math.min(dt, 0.033);

    const force = -this.k * (this.value - this.target);
    const dampForce = -this.d * this.velocity;
    const accel = (force + dampForce) / this.m;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;

    return this.value;
  }

  /** True when settled (close to target, low velocity) */
  isSettled() {
    return Math.abs(this.value - this.target) < 0.001
        && Math.abs(this.velocity) < 0.001;
  }
}

// Usage — spring-based scale:
// const scaleSpring = new Spring(150, 15, 1);
// scaleSpring.value = 1;
// scaleSpring.setTarget(2);
// In animate:
//   const s = scaleSpring.update(dt);
//   mesh.scale.setScalar(s);

// Usage — spring-based position:
// const posSpring = { x: new Spring(100, 12), y: new Spring(100, 12), z: new Spring(100, 12) };
// posSpring.x.setTarget(5);
// In animate:
//   mesh.position.set(posSpring.x.update(dt), posSpring.y.update(dt), posSpring.z.update(dt));
```

### 4h. Morph Between Shapes

Use morph targets with BufferGeometry:

```javascript
function createMorphingMesh(geoA, geoB, material) {
  // geoA and geoB must have the same vertex count
  const baseGeo = geoA.clone();
  const morphPositions = geoB.attributes.position.array;
  baseGeo.morphAttributes.position = [
    new THREE.Float32BufferAttribute(morphPositions, 3)
  ];

  material.morphTargets = true; // r152 flag
  const mesh = new THREE.Mesh(baseGeo, material);
  mesh.morphTargetInfluences = [0]; // 0 = geoA, 1 = geoB

  return {
    mesh,
    /** Morph from current state to target (0 or 1) */
    morphTo(target, duration, easeFn) {
      const start = mesh.morphTargetInfluences[0];
      return anim.tween(duration || 1.0, easeFn || Ease.inOutCubic, t => {
        mesh.morphTargetInfluences[0] = THREE.MathUtils.lerp(start, target, t);
      });
    }
  };
}

// Usage:
// const sphere = new THREE.SphereGeometry(1, 32, 16);
// const box = new THREE.BoxGeometry(1.5, 1.5, 1.5, 32, 16, 1); // must match vert count!
// WARNING: vertex counts must match. Use same segment counts or resample.
```

---

## 5. Transition Effects

### 5a. Ripple / Shockwave from a Point

Vertex-shader displacement. Apply to any mesh. No extra draw calls.

```javascript
function createRippleShader(baseColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uOrigin:   { value: new THREE.Vector3() },
      uSpeed:    { value: 5.0 },
      uAmplitude:{ value: 0.3 },
      uDecay:    { value: 2.0 },
      uColor:    { value: new THREE.Color(baseColor || 0xe8d89a) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uSpeed, uAmplitude, uDecay;
      uniform vec3 uOrigin;
      varying float vDisp;
      varying vec3 vNormal;

      void main() {
        float dist = length(position - uOrigin);
        float wave = sin(dist * 10.0 - uTime * uSpeed) * uAmplitude;
        wave *= exp(-dist * uDecay) * exp(-uTime * 0.5);
        vec3 displaced = position + normal * wave;
        vDisp = wave;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vDisp;
      varying vec3 vNormal;

      void main() {
        float light = max(dot(vNormal, vec3(0.3, 1.0, 0.5)), 0.2);
        vec3 col = uColor * light + vec3(1.0, 0.8, 0.3) * abs(vDisp) * 3.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

// Expanding ring shockwave (screen-space, for flat planes / particles):
function createShockwaveRing(origin, maxRadius) {
  const geo = new THREE.RingGeometry(0.01, 0.02, 64);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xe8d89a,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  mesh.lookAt(origin.clone().add(new THREE.Vector3(0, 1, 0)));

  maxRadius = maxRadius || 5;
  let handle;

  return {
    mesh,
    fire(duration) {
      mesh.visible = true;
      mat.opacity = 1;
      handle = anim.tween(duration || 1.5, Ease.outQuart, t => {
        const r = t * maxRadius;
        mesh.scale.setScalar(r);
        mat.opacity = 1 - t;
      }, () => {
        mesh.visible = false;
      });
    }
  };
}
// Budget: 1 draw call
```

### 5b. Particle Dissolve (Object Breaks into Particles)

```javascript
function createParticleDissolve(mesh, particleCount) {
  particleCount = particleCount || 500;
  const bbox = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  const delays = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    // Start at random points within bounding box
    positions[i * 3]     = center.x + (Math.random() - 0.5) * size.x;
    positions[i * 3 + 1] = center.y + (Math.random() - 0.5) * size.y;
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z;

    // Random outward velocity
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    velocities[i * 3]     = dir.x * (1 + Math.random() * 2);
    velocities[i * 3 + 1] = dir.y * (1 + Math.random() * 2);
    velocities[i * 3 + 2] = dir.z * (1 + Math.random() * 2);

    delays[i] = Math.random() * 0.3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  // Store originals
  geo.setAttribute('aOrigin', new THREE.BufferAttribute(positions.slice(), 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uProgress: { value: 0 },
      uColor:    { value: new THREE.Color(0xe8d89a) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aVelocity, aOrigin;
      attribute float aDelay;
      uniform float uProgress;
      varying float vAlpha;

      void main() {
        float t = max(uProgress - aDelay, 0.0) / (1.0 - aDelay);
        t = clamp(t, 0.0, 1.0);

        vec3 pos = mix(aOrigin, aOrigin + aVelocity * 3.0, t);
        pos.y += t * t * -2.0; // gravity

        vAlpha = 1.0 - t;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = mix(3.0, 1.0, t);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(uColor, a);
      }
    `
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;

  return {
    mesh: points,
    /** Dissolve over duration seconds */
    dissolve(duration, easeFn) {
      mesh.visible = false;
      points.visible = true;
      return anim.tween(duration || 2.0, easeFn || Ease.outCubic, t => {
        mat.uniforms.uProgress.value = t;
      }, () => {
        points.visible = false;
      });
    }
  };
}
// Budget: 1 draw call, 500 vertices
```

### 5c. Energy Beam Between Two Objects

```javascript
function createEnergyBeam(color, segments) {
  segments = segments || 32;
  const positions = new Float32Array(segments * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(color || 0x44aaff) },
      uAlpha: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vT;

      void main() {
        // Compute parametric t (0..1) along the beam
        // Using vertex index approximation via position
        vT = float(gl_VertexID) / ${(segments - 1).toFixed(1)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uColor;
      varying float vT;

      void main() {
        // Pulsing energy along beam
        float pulse = sin(vT * 20.0 - uTime * 8.0) * 0.5 + 0.5;
        float edge = sin(vT * 3.14159) ; // fade at endpoints
        float a = pulse * edge * uAlpha;
        gl_FragColor = vec4(uColor * (1.0 + pulse * 0.5), a);
      }
    `
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;

  const _startPos = new THREE.Vector3();
  const _endPos = new THREE.Vector3();

  return {
    mesh: line,
    /**
     * Update beam endpoints each frame.
     * @param {THREE.Vector3} start
     * @param {THREE.Vector3} end
     * @param {number} time
     */
    tick(start, end, time) {
      mat.uniforms.uTime.value = time;
      const posArr = geo.attributes.position.array;
      for (let i = 0; i < segments; i++) {
        const t = i / (segments - 1);
        // Lerp with slight sine wave offset for organic feel
        const wave = Math.sin(t * Math.PI * 3 + time * 4) * 0.05;
        posArr[i * 3]     = THREE.MathUtils.lerp(start.x, end.x, t) + wave;
        posArr[i * 3 + 1] = THREE.MathUtils.lerp(start.y, end.y, t) + wave;
        posArr[i * 3 + 2] = THREE.MathUtils.lerp(start.z, end.z, t);
      }
      geo.attributes.position.needsUpdate = true;
    },
    setAlpha(a) { mat.uniforms.uAlpha.value = a; }
  };
}
// Budget: 1 draw call
```

### 5d. Trail Effect Behind Moving Object

```javascript
function createTrail(length, color) {
  length = length || 50;
  const positions = new Float32Array(length * 3);
  const alphas = new Float32Array(length);
  for (let i = 0; i < length; i++) alphas[i] = 1.0 - i / length;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color || 0xe8d89a) },
      uOpacity: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uOpacity);
      }
    `
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;

  return {
    mesh: line,
    /** Call every frame with the current head position */
    push(pos) {
      const arr = geo.attributes.position.array;
      // Shift all positions back by one
      for (let i = (length - 1) * 3; i >= 3; i -= 3) {
        arr[i]     = arr[i - 3];
        arr[i + 1] = arr[i - 2];
        arr[i + 2] = arr[i - 1];
      }
      arr[0] = pos.x;
      arr[1] = pos.y;
      arr[2] = pos.z;
      geo.attributes.position.needsUpdate = true;
    }
  };
}
// Budget: 1 draw call
```

### 5e. Light Speed Streaks During Fast Travel

Combine with warp stars (Section 3d) and add a radial zoom shader on a full-screen quad:

```javascript
function createSpeedLines(count) {
  count = count || 300;
  const positions = new Float32Array(count * 6);
  const randoms = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    // Distributed on a cylinder around the forward axis
    const angle = Math.random() * Math.PI * 2;
    const radius = 1 + Math.random() * 8;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    // Front point
    positions[i * 6]     = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = -5 - Math.random() * 30;
    // Back point (same XY, offset Z)
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = positions[i * 6 + 2] - 0.1;

    randoms[i * 2]     = Math.random();
    randoms[i * 2 + 1] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSpeed:    { value: 0 },
      uTime:     { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aRandom;
      uniform float uSpeed, uTime;
      varying float vAlpha;

      void main() {
        vec3 pos = position;

        // Move along Z and loop
        float speed = uSpeed * (0.5 + aRandom * 1.0);
        pos.z = mod(pos.z + uTime * speed * 20.0, 35.0) - 35.0;

        // Stretch: every other vertex is the tail
        float isTail = mod(float(gl_VertexID), 2.0);
        pos.z -= isTail * uSpeed * (0.5 + aRandom) * 3.0;

        vAlpha = uSpeed * 0.8;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.7, 0.8, 1.0, vAlpha);
      }
    `
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;

  return {
    mesh: lines,
    setSpeed(s) { mat.uniforms.uSpeed.value = s; },
    tick(time) { mat.uniforms.uTime.value = time; },
  };
}
// Budget: 1 draw call, 600 vertices
```

---

## 6. UI / Card Animations for VR

All use three-mesh-ui or canvas textures on planes. Keep under 50 canvas textures total.

### 6a. Card Flip Reveal

```javascript
function createFlipCard(front, back, width, height) {
  width = width || 0.3;
  height = height || 0.2;

  const group = new THREE.Group();

  // Front face
  const frontGeo = new THREE.PlaneGeometry(width, height);
  const frontMesh = new THREE.Mesh(frontGeo, front); // front is a material
  group.add(frontMesh);

  // Back face (flipped)
  const backGeo = new THREE.PlaneGeometry(width, height);
  const backMesh = new THREE.Mesh(backGeo, back);
  backMesh.rotation.y = Math.PI;
  group.add(backMesh);

  let isFlipped = false;

  return {
    group,
    flip(duration) {
      const targetY = isFlipped ? 0 : Math.PI;
      const startY = group.rotation.y;
      isFlipped = !isFlipped;

      return anim.tween(duration || 0.6, Ease.inOutCubic, t => {
        group.rotation.y = THREE.MathUtils.lerp(startY, targetY, t);
      });
    }
  };
}
```

### 6b. Slide-In from Side

```javascript
function slideIn(mesh, fromDirection, distance, duration) {
  // fromDirection: 'left', 'right', 'top', 'bottom'
  distance = distance || 0.5;
  duration = duration || 0.5;

  const targetPos = mesh.position.clone();
  const startPos = targetPos.clone();

  switch (fromDirection) {
    case 'left':   startPos.x -= distance; break;
    case 'right':  startPos.x += distance; break;
    case 'top':    startPos.y += distance; break;
    case 'bottom': startPos.y -= distance; break;
  }

  mesh.position.copy(startPos);
  mesh.material.transparent = true;
  mesh.material.opacity = 0;
  mesh.visible = true;

  return anim.tween(duration, Ease.outCubic, t => {
    mesh.position.lerpVectors(startPos, targetPos, t);
    mesh.material.opacity = t;
  });
}
```

### 6c. Typewriter Text (Troika)

```javascript
function typewriterText(troikaText, fullString, charsPerSecond) {
  charsPerSecond = charsPerSecond || 30;
  const totalDuration = fullString.length / charsPerSecond;
  let currentLen = 0;

  return anim.tween(totalDuration, Ease.linear, t => {
    const len = Math.floor(t * fullString.length);
    if (len !== currentLen) {
      currentLen = len;
      troikaText.text = fullString.substring(0, currentLen);
      troikaText.sync();
    }
  });
}

// Usage:
// const label = new troika_three_text.Text();
// label.font = undefined; // uses default
// label.fontSize = 0.02;
// label.color = 0xe8d89a;
// label.anchorX = 'left';
// typewriterText(label, 'Hello, World!', 20);
```

### 6d. Progress Bar

```javascript
function createProgressBar(width, height, bgColor, fillColor) {
  width = width || 0.3;
  height = height || 0.015;
  const group = new THREE.Group();

  // Background
  const bgGeo = new THREE.PlaneGeometry(width, height);
  const bgMat = new THREE.MeshBasicMaterial({
    color: bgColor || 0x222222,
    transparent: true, opacity: 0.6,
  });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  group.add(bg);

  // Fill bar
  const fillGeo = new THREE.PlaneGeometry(width, height);
  const fillMat = new THREE.MeshBasicMaterial({
    color: fillColor || 0xe8d89a,
    transparent: true, opacity: 0.9,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.z = 0.001; // slightly in front
  fill.scale.x = 0.001;
  fill.position.x = -width / 2;
  group.add(fill);

  return {
    group,
    /** Set progress 0..1 */
    setProgress(p) {
      p = Math.max(0, Math.min(1, p));
      fill.scale.x = Math.max(p, 0.001);
      fill.position.x = -width / 2 + (width * p) / 2;
    },
    /** Animate to target over duration */
    animateTo(target, duration) {
      const start = fill.scale.x;
      return anim.tween(duration || 0.5, Ease.outCubic, t => {
        const p = THREE.MathUtils.lerp(start, target, t);
        fill.scale.x = Math.max(p, 0.001);
        fill.position.x = -width / 2 + (width * p) / 2;
      });
    }
  };
}
// Budget: 2 draw calls
```

### 6e. Toast Notification

```javascript
function createToast(message, duration) {
  duration = duration || 3.0;

  // Canvas texture for text
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20, 18, 30, 0.9)';
  ctx.roundRect(0, 0, 512, 64, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 180, 120, 0.3)';
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, 512, 64, 12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(232, 216, 154, 0.9)';
  ctx.font = '600 22px Helvetica Neue, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, 256, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.045), mat);

  return {
    mesh,
    show(parent, position) {
      mesh.position.copy(position || new THREE.Vector3(0, 0.15, -0.4));
      parent.add(mesh);

      // Slide up + fade in
      const startY = mesh.position.y - 0.03;
      const endY = mesh.position.y;
      mesh.position.y = startY;

      anim.sequence([
        { duration: 0.3, ease: Ease.outCubic, update: t => {
          mat.opacity = t;
          mesh.position.y = THREE.MathUtils.lerp(startY, endY, t);
        }},
        { duration: duration - 0.6, ease: Ease.linear, update: () => {} },
        { duration: 0.3, ease: Ease.inCubic, update: t => {
          mat.opacity = 1 - t;
        }, complete: () => {
          parent.remove(mesh);
          tex.dispose();
          mat.dispose();
        }},
      ]);
    }
  };
}
// Budget: 1 draw call, 1 canvas texture (disposed after use)
```

### 6f. Button Press Feedback (Scale Bounce)

```javascript
function buttonBounce(mesh, duration) {
  const originalScale = mesh.scale.clone();

  // Quick shrink then overshoot back
  anim.sequence([
    { duration: (duration || 0.3) * 0.3, ease: Ease.inQuad, update: t => {
      const s = 1 - t * 0.15; // shrink to 85%
      mesh.scale.copy(originalScale).multiplyScalar(s);
    }},
    { duration: (duration || 0.3) * 0.7, ease: Ease.outElastic, update: t => {
      const s = 0.85 + t * 0.15; // bounce back to 100%
      mesh.scale.copy(originalScale).multiplyScalar(s);
    }},
  ]);
}

// For three-mesh-ui buttons:
function setupMeshUIButton(block, onActivate) {
  block.setupState({
    state: 'hovered',
    onSet: () => {
      anim.tween(0.15, Ease.outCubic, t => {
        block.set({ backgroundOpacity: THREE.MathUtils.lerp(0.3, 0.5, t) });
      });
    }
  });
  block.setupState({
    state: 'idle',
    onSet: () => {
      anim.tween(0.15, Ease.outCubic, t => {
        block.set({ backgroundOpacity: THREE.MathUtils.lerp(0.5, 0.3, t) });
      });
    }
  });
  block.setupState({
    state: 'selected',
    onSet: () => {
      buttonBounce(block, 0.3);
      if (onActivate) onActivate();
    }
  });
}
```

---

## 7. Performance Notes

### Rules for 72fps on Quest 3

1. **Never use EffectComposer** -- broken in stereo WebXR, kills framerate.
2. **Prefer vertex shaders** over fragment shaders for animation. Vertex work is cheaper on Quest's tile-based GPU (Adreno 740).
3. **Avoid `overdraw`** -- large transparent quads with additive blending are expensive. Keep transparent objects small or use `depthWrite: false` with `depthTest: true`.
4. **`sizeAttenuation: false`** for all Points materials. `sizeAttenuation: true` with large size values causes massive overdraw.
5. **Particle budgets**: 2000-5000 particles per Points system. Total across all systems: <10k.
6. **Canvas textures**: <50 total. Use 128x64 or 256x64 max. Dispose when done.
7. **Troika text**: <30 labels. Stagger `sync()` calls 50ms apart.
8. **Draw calls**: Each mesh/points/lines = 1 draw call. Budget: <200 total.
9. **Morph targets**: max 2 per mesh. GPU handles them but adds ALU cost.
10. **Animation ticks**: Keep all animation math in JS lightweight. The real cost is shader work -- keep fragment shaders short (under 20 lines of math).

### Quest 3 Shader Complexity Budget

| Shader Type | Safe Instruction Count | Danger Zone |
|---|---|---|
| Vertex | < 50 ALU ops | > 100 |
| Fragment | < 30 ALU ops | > 60 |
| Fragment (full screen) | < 15 ALU ops | > 30 |
| Texture samples per frag | < 4 | > 8 |

### Frame Budget at 72fps

- Total frame time: **13.9ms**
- GPU render: ~8ms max
- JS animate loop: ~2ms max
- Browser/compositor overhead: ~3ms

### Profiling

```javascript
// Frame time monitor (remove in production)
let _frameTimes = [];
function profileFrame(renderer) {
  const info = renderer.info;
  _frameTimes.push(performance.now());
  if (_frameTimes.length > 60) _frameTimes.shift();
  if (_frameTimes.length > 1) {
    const avg = (_frameTimes[_frameTimes.length-1] - _frameTimes[0]) / (_frameTimes.length - 1);
    // Log every 120 frames
    if (renderer.info.render.frame % 120 === 0) {
      console.log(
        `FPS: ${(1000/avg).toFixed(1)} | ` +
        `Draws: ${info.render.calls} | ` +
        `Tris: ${info.render.triangles} | ` +
        `Textures: ${info.memory.textures}`
      );
    }
  }
}
```

### Integration Template

```javascript
// Drop this into your animate() function:
const clock = new THREE.Clock();
const anim = new Anim(); // from Section 2

function animate() {
  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  anim.tick(dt);

  // Update continuous effects
  // warp.tick(elapsed);
  // trail.push(someObject.position);
  // wobble.tick(elapsed);
  // pulseGlow.uniforms.uTime.value = elapsed;

  // Render
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```
