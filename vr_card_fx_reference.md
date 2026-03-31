# VR Info Card UI — Animation & Effects Reference

All code: THREE.js r152 global build, Quest 3 safe, no EffectComposer, no post-processing.
Budget: < 5 draw calls per effect. Uses troika-three-text for text, ShaderMaterial for FX.

---

## Table of Contents

1. [Card Deploy/Entrance Animations](#1-card-deployentrance-animations)
2. [Card Dismiss/Exit Animations](#2-card-dismissexit-animations)
3. [Card Materials & Surface Effects](#3-card-materials--surface-effects)
4. [Edge/Border Effects](#4-edgeborder-effects)
5. [Button Press/Interaction Animations](#5-button-pressinteraction-animations)
6. [Text Animations on Cards](#6-text-animations-on-cards)
7. [Ambient Card Effects](#7-ambient-card-effects)

---

## Base Card Setup

Every effect below assumes this card structure. The card lives inside `galaxyGroup` or at scene level in world-space (meters). Typical card size: 0.4m wide x 0.3m tall, positioned ~0.5m in front of the user.

```javascript
// ─── BASE CARD GROUP ─────────────────────────────────────────────────────
// All card elements live in this group for easy positioning & animation.
// Position this in front of the camera or attached to a controller.
// Budget: background plane = 1 draw call, border = 1, text = 1 each

function createCardGroup() {
  const card = new THREE.Group();
  card.userData.animState = { phase: 'idle', t: 0 };
  return card;
}

// Utility: smooth easing functions used throughout
function easeOutBack(t) {
  var c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }
function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
}
function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Utility: position card in front of VR camera
function positionCardInFrontOfCamera(card, camera, distance) {
  distance = distance || 0.5;
  var dir = new THREE.Vector3(0, 0, -1);
  dir.applyQuaternion(camera.quaternion);
  card.position.copy(camera.position).add(dir.multiplyScalar(distance));
  card.quaternion.copy(camera.quaternion);
}
```

---

## 1. Card Deploy/Entrance Animations

### 1A. Scale Up From Zero With Overshoot Bounce

Simple, cheap, effective. The card scales from 0 to ~1.15 then settles to 1.0 using `easeOutBack`. 0 draw calls added (just transforms the existing group).

```javascript
// ─── SCALE BOUNCE ENTRANCE ──────────────────────────────────────────────
// Usage:
//   var anim = scaleBounceEntrance(cardGroup);
//   // in animate loop:
//   anim.tick(deltaTime);  // deltaTime in seconds

function scaleBounceEntrance(cardGroup, duration) {
  duration = duration || 0.4;
  var elapsed = 0;
  var done = false;
  cardGroup.scale.setScalar(0.001); // start near-zero (avoid scale=0 issues)
  cardGroup.visible = true;

  return {
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      var s = easeOutBack(t); // overshoots to ~1.15 then settles to 1.0
      cardGroup.scale.setScalar(s);
      if (t >= 1.0) {
        cardGroup.scale.setScalar(1.0);
        done = true;
      }
    }
  };
}
```

### 1B. Unfold/Reveal From Center Line Outward

Uses a clipping-plane approach via a custom ShaderMaterial on the card background. The card appears to "open" from a vertical center line. 1 draw call for the card plane.

```javascript
// ─── UNFOLD REVEAL ──────────────────────────────────────────────────────
// The card plane uses a shader that clips pixels beyond a moving edge.
// uReveal goes 0 -> 1; at 0 nothing visible, at 1 full card.
// Budget: 1 draw call (replaces normal card background)

function createUnfoldCard(width, height, color) {
  width = width || 0.4;
  height = height || 0.3;
  color = color || 0x1a1a2e;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uReveal: { value: 0.0 },
      uColor:  { value: new THREE.Color(color) },
      uAlpha:  { value: 0.92 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        // Distance from center (0.5) on the X axis, normalized to 0..1
        float distFromCenter = abs(vUv.x - 0.5) * 2.0;
        // Clip everything beyond the current reveal radius
        float edge = smoothstep(uReveal, uReveal - 0.05, distFromCenter);
        if (edge < 0.01) discard;
        // Slight glow at the reveal edge
        float edgeGlow = smoothstep(uReveal - 0.08, uReveal, distFromCenter) * edge;
        vec3 col = mix(uColor, uColor + 0.3, edgeGlow);
        gl_FragColor = vec4(col, uAlpha * edge);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);

  var elapsed = 0;
  var animDuration = 0.5;
  var done = false;

  return {
    mesh: mesh,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      mat.uniforms.uReveal.value = easeOutCubic(t);
      if (t >= 1.0) {
        mat.uniforms.uReveal.value = 1.0;
        done = true;
      }
    },
    // Call to reverse (fold closed)
    reverse: function() {
      done = false;
      elapsed = 0;
      return {
        tick: function(dt) {
          if (done) return;
          elapsed += dt;
          var t = Math.min(elapsed / animDuration, 1.0);
          mat.uniforms.uReveal.value = 1.0 - easeInCubic(t);
          if (t >= 1.0) done = true;
        }
      };
    }
  };
}
```

### 1C. Slide In From Side With Deceleration

The card starts offset to the right and slides to its target position with easeOutCubic. Add a slight opacity fade-in for polish. 0 extra draw calls.

```javascript
// ─── SLIDE IN FROM SIDE ─────────────────────────────────────────────────
// Animates position.x offset and optional material opacity.
// slideDir: +1 = from right, -1 = from left

function slideInEntrance(cardGroup, slideDir, duration, slideDistance) {
  duration = duration || 0.45;
  slideDistance = slideDistance || 0.3; // meters
  slideDir = slideDir || 1;
  var elapsed = 0;
  var done = false;
  var startX = cardGroup.position.x + slideDir * slideDistance;
  var targetX = cardGroup.position.x;
  cardGroup.position.x = startX;

  // Optionally fade materials in the group
  var materials = [];
  cardGroup.traverse(function(child) {
    if (child.material && child.material.transparent) {
      materials.push({ mat: child.material, targetOpacity: child.material.opacity });
      child.material.opacity = 0;
    }
  });

  return {
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      var ease = easeOutCubic(t);
      cardGroup.position.x = startX + (targetX - startX) * ease;
      // Fade in over first 60% of animation
      var fadeT = Math.min(t / 0.6, 1.0);
      for (var i = 0; i < materials.length; i++) {
        materials[i].mat.opacity = materials[i].targetOpacity * fadeT;
      }
      if (t >= 1.0) {
        cardGroup.position.x = targetX;
        done = true;
      }
    }
  };
}
```

### 1D. Materialize / Scan Line Reveal (Top to Bottom)

A horizontal scan line sweeps down the card, revealing it top-to-bottom. The scan line glows. 1 draw call (shader on card plane).

```javascript
// ─── MATERIALIZE SCAN LINE REVEAL ───────────────────────────────────────
// uScanY goes from 1.0 (top) to 0.0 (bottom).
// Everything above the scan line is visible, below is invisible.
// A bright band at the scan line edge gives the "materializing" feel.
// Budget: 1 draw call

function createMaterializeCard(width, height, baseColor, scanColor) {
  width = width || 0.4;
  height = height || 0.3;
  baseColor = baseColor || 0x1a1a2e;
  scanColor = scanColor || 0x00ddff;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uScanY:    { value: 1.0 },    // 1 = nothing shown, 0 = fully revealed
      uColor:    { value: new THREE.Color(baseColor) },
      uScanCol:  { value: new THREE.Color(scanColor) },
      uAlpha:    { value: 0.92 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uScanY, uAlpha;
      uniform vec3 uColor, uScanCol;
      varying vec2 vUv;
      void main() {
        // vUv.y: 0 = bottom, 1 = top
        float revealed = step(uScanY, vUv.y);
        // But we want to reveal top-to-bottom, so invert:
        // When uScanY = 1.0, reveal where vUv.y > 1.0 = nothing
        // When uScanY = 0.0, reveal where vUv.y > 0.0 = everything
        // Actually: reveal = step(uScanY, vUv.y) means vUv.y >= uScanY
        // So uScanY=1.0 -> only top pixel. uScanY=0.0 -> everything. Correct.
        if (revealed < 0.5) discard;

        // Scan line glow band
        float dist = abs(vUv.y - uScanY);
        float scanBand = smoothstep(0.06, 0.0, dist);
        vec3 col = mix(uColor, uScanCol, scanBand * 0.8);
        // Slight horizontal scan line pattern (CRT feel)
        float scanlines = 0.95 + 0.05 * sin(vUv.y * 200.0);
        col *= scanlines;
        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);

  var elapsed = 0;
  var animDuration = 0.6;
  var done = false;

  return {
    mesh: mesh,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      // Sweep from top (1.0) to bottom (0.0)
      mat.uniforms.uScanY.value = 1.0 - easeOutCubic(t);
      if (t >= 1.0) {
        mat.uniforms.uScanY.value = 0.0;
        done = true;
      }
    }
  };
}
```

### 1E. Holographic Flicker-In

The card appears with rapid opacity oscillation that dampens over time, settling to solid. Looks like a hologram locking on. 1 draw call.

```javascript
// ─── HOLOGRAPHIC FLICKER-IN ─────────────────────────────────────────────
// Rapid opacity oscillation with decreasing amplitude.
// Uses a ShaderMaterial with uFlicker uniform.
// Budget: 1 draw call

function createHoloFlickerCard(width, height, baseColor) {
  width = width || 0.4;
  height = height || 0.3;
  baseColor = baseColor || 0x1a1a2e;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime:    { value: 0.0 },
      uRevealT: { value: 0.0 },   // 0..1 animation progress
      uColor:   { value: new THREE.Color(baseColor) },
      uGlowCol: { value: new THREE.Color(0x00ddff) }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRevealT;
      uniform vec3 uColor, uGlowCol;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // Flicker: rapid oscillation that dampens as uRevealT -> 1
        float flickerFreq = 30.0; // Hz
        float flickerAmp = (1.0 - uRevealT) * 0.8; // dampens to 0
        float flicker = 1.0 - flickerAmp * (0.5 + 0.5 * sin(uTime * flickerFreq));

        // Random dropout frames early in the animation
        float dropout = 1.0;
        if (uRevealT < 0.4) {
          float frame = floor(uTime * 20.0);
          dropout = step(0.3 * (1.0 - uRevealT * 2.5), hash(frame));
        }

        float alpha = flicker * dropout * uRevealT;

        // Horizontal scan distortion early on
        float distort = (1.0 - uRevealT) * 0.02;
        vec2 uv = vUv;
        uv.x += sin(vUv.y * 50.0 + uTime * 10.0) * distort;

        // Holo tint: more cyan early, settling to base color
        float holoMix = (1.0 - uRevealT) * 0.5;
        vec3 col = mix(uColor, uGlowCol, holoMix);

        // Scan lines
        float scanline = 0.92 + 0.08 * sin(uv.y * 300.0 + uTime * 5.0);
        col *= scanline;

        gl_FragColor = vec4(col, alpha * 0.92);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);

  var elapsed = 0;
  var animDuration = 0.8;
  var globalTime = 0;
  var done = false;

  return {
    mesh: mesh,
    done: function() { return done; },
    tick: function(dt) {
      globalTime += dt;
      mat.uniforms.uTime.value = globalTime;
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      mat.uniforms.uRevealT.value = easeOutCubic(t);
      if (t >= 1.0) {
        mat.uniforms.uRevealT.value = 1.0;
        done = true;
      }
    }
  };
}
```

### 1F. Particle Assembly

Particles start scattered randomly and converge into the card's rectangular shape. Uses a single Points object. 1 draw call.

```javascript
// ─── PARTICLE ASSEMBLY ENTRANCE ─────────────────────────────────────────
// Particles fly from random positions into the card rectangle.
// Uses GPU-driven animation in the vertex shader for zero CPU cost.
// Budget: 1 draw call (Points), ~500 particles
// After assembly completes, hide particles and show the actual card mesh.

function createParticleAssembly(width, height, particleCount, color) {
  width = width || 0.4;
  height = height || 0.3;
  particleCount = particleCount || 500;
  color = color || 0x00ddff;

  var positions = new Float32Array(particleCount * 3);
  var targets = new Float32Array(particleCount * 3);
  var randoms = new Float32Array(particleCount);

  for (var i = 0; i < particleCount; i++) {
    // Target: random point on the card rectangle
    targets[i * 3]     = (Math.random() - 0.5) * width;
    targets[i * 3 + 1] = (Math.random() - 0.5) * height;
    targets[i * 3 + 2] = 0;
    // Start: scattered in a sphere around the card
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.random() * Math.PI;
    var r = 0.2 + Math.random() * 0.3;
    positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    positions[i * 3 + 2] = Math.cos(phi) * r;
    randoms[i] = Math.random();
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0.0 },
      uColor:    { value: new THREE.Color(color) },
      uSize:     { value: 3.0 }
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTarget;
      attribute float aRandom;
      uniform float uProgress;
      uniform float uSize;
      varying float vAlpha;

      // Cubic bezier-ish path for organic feel
      vec3 curvedLerp(vec3 a, vec3 b, float t) {
        // Add a perpendicular arc
        vec3 mid = (a + b) * 0.5;
        mid.x += (aRandom - 0.5) * 0.15;
        mid.y += (aRandom - 0.5) * 0.15;
        mid.z += 0.1 * sin(aRandom * 6.28);
        // Quadratic bezier
        float it = 1.0 - t;
        return it * it * a + 2.0 * it * t * mid + t * t * b;
      }

      void main() {
        // Each particle has a staggered start based on aRandom
        float stagger = aRandom * 0.4; // up to 0.4s delay
        float localT = clamp((uProgress - stagger) / (1.0 - stagger), 0.0, 1.0);
        // Ease
        localT = localT * localT * (3.0 - 2.0 * localT); // smoothstep

        vec3 pos = curvedLerp(position, aTarget, localT);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uSize;
        // Fade out as particle reaches target
        vAlpha = 1.0 - localT * 0.3;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        // Soft circle point
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.2, d) * vAlpha;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });

  var points = new THREE.Points(geo, mat);

  var elapsed = 0;
  var animDuration = 1.0;
  var done = false;

  return {
    points: points,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      mat.uniforms.uProgress.value = t;
      if (t >= 1.0) {
        done = true;
        // After done, caller should: hide points, show actual card
        // points.visible = false; cardMesh.visible = true;
      }
    }
  };
}
```

### 1G. Fade In With Blur-to-Sharp (Opacity Progression)

True blur requires post-processing which is banned on Quest. Instead, simulate the "blur-to-sharp" feel by combining opacity fade with a noise-based dissolve pattern that goes from rough/scattered to clean. 1 draw call.

```javascript
// ─── FADE IN WITH SIMULATED BLUR-TO-SHARP ──────────────────────────────
// Combines opacity ramp with a noise dissolve that goes from rough to clean.
// The noise threshold shrinks as the card solidifies.
// Budget: 1 draw call

function createBlurToSharpCard(width, height, baseColor) {
  width = width || 0.4;
  height = height || 0.3;
  baseColor = baseColor || 0x1a1a2e;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uReveal: { value: 0.0 },
      uColor:  { value: new THREE.Color(baseColor) },
      uAlpha:  { value: 0.92 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal, uAlpha;
      uniform vec3 uColor;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        // Multi-scale noise for dissolve pattern
        float n = noise(vUv * 20.0) * 0.5 + noise(vUv * 50.0) * 0.3 + noise(vUv * 100.0) * 0.2;
        // Threshold: at uReveal=0, threshold=1 (nothing passes). At uReveal=1, threshold=0.
        float threshold = 1.0 - uReveal;
        float visible = smoothstep(threshold, threshold + 0.1, n);
        if (visible < 0.01) discard;
        float alpha = uAlpha * uReveal * visible;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);

  var elapsed = 0;
  var animDuration = 0.5;
  var done = false;

  return {
    mesh: mesh,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      mat.uniforms.uReveal.value = easeOutCubic(t);
      if (t >= 1.0) {
        mat.uniforms.uReveal.value = 1.0;
        done = true;
      }
    }
  };
}
```

---

## 2. Card Dismiss/Exit Animations

### 2A. Shrink to Point and Vanish

Reverse of scale bounce. Shrinks with easeInCubic acceleration to a point, then hides.

```javascript
// ─── SHRINK TO POINT EXIT ───────────────────────────────────────────────
function shrinkToPointExit(cardGroup, duration) {
  duration = duration || 0.3;
  var elapsed = 0;
  var done = false;

  return {
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      var s = 1.0 - easeInCubic(t);
      cardGroup.scale.setScalar(Math.max(s, 0.001));
      if (t >= 1.0) {
        cardGroup.visible = false;
        cardGroup.scale.setScalar(1.0);
        done = true;
      }
    }
  };
}
```

### 2B. Dissolve Into Particles

The card mesh hides and particles fly outward from where the card was. Reverse of particle assembly. 1 draw call (Points).

```javascript
// ─── DISSOLVE INTO PARTICLES EXIT ───────────────────────────────────────
// Spawns particles at the card surface, they fly outward and fade.
// Budget: 1 draw call (Points), ~400 particles

function createParticleDissolve(width, height, particleCount, color) {
  width = width || 0.4;
  height = height || 0.3;
  particleCount = particleCount || 400;
  color = color || 0x00ddff;

  var origins = new Float32Array(particleCount * 3);
  var velocities = new Float32Array(particleCount * 3);
  var randoms = new Float32Array(particleCount);

  for (var i = 0; i < particleCount; i++) {
    origins[i * 3]     = (Math.random() - 0.5) * width;
    origins[i * 3 + 1] = (Math.random() - 0.5) * height;
    origins[i * 3 + 2] = 0;
    // Velocities: outward burst
    velocities[i * 3]     = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2 + 0.1;
    randoms[i] = Math.random();
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(origins, 3));
  geo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0.0 },
      uColor:    { value: new THREE.Color(color) },
      uSize:     { value: 3.0 }
    },
    vertexShader: /* glsl */ `
      attribute vec3 aVelocity;
      attribute float aRandom;
      uniform float uProgress;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        float t = uProgress;
        // Stagger start
        float localT = clamp((t - aRandom * 0.3) / (1.0 - aRandom * 0.3), 0.0, 1.0);
        vec3 pos = position + aVelocity * localT;
        // Gravity pull down slightly
        pos.y -= localT * localT * 0.1;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uSize * (1.0 - localT);
        vAlpha = 1.0 - localT;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (length(c) > 0.5) discard;
        float a = smoothstep(0.5, 0.1, length(c)) * vAlpha;
        gl_FragColor = vec4(uColor, a);
      }
    `
  });

  var points = new THREE.Points(geo, mat);
  points.visible = false;

  var elapsed = 0;
  var animDuration = 0.8;
  var done = false;

  return {
    points: points,
    // Call start() when dismissing the card
    start: function() {
      points.visible = true;
      elapsed = 0;
      done = false;
    },
    done: function() { return done; },
    tick: function(dt) {
      if (done || !points.visible) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      mat.uniforms.uProgress.value = t;
      if (t >= 1.0) {
        points.visible = false;
        done = true;
      }
    }
  };
}
```

### 2C. Slide Out With Acceleration

Reverse of slide-in. Accelerates off-screen using easeInCubic.

```javascript
// ─── SLIDE OUT EXIT ─────────────────────────────────────────────────────
function slideOutExit(cardGroup, slideDir, duration, slideDistance) {
  duration = duration || 0.35;
  slideDistance = slideDistance || 0.4;
  slideDir = slideDir || 1;
  var elapsed = 0;
  var done = false;
  var startX = cardGroup.position.x;
  var targetX = startX + slideDir * slideDistance;

  var materials = [];
  cardGroup.traverse(function(child) {
    if (child.material && child.material.transparent) {
      materials.push({ mat: child.material, startOpacity: child.material.opacity });
    }
  });

  return {
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      var ease = easeInCubic(t);
      cardGroup.position.x = startX + (targetX - startX) * ease;
      // Fade out in last 40%
      var fadeT = Math.max(0, (t - 0.6) / 0.4);
      for (var i = 0; i < materials.length; i++) {
        materials[i].mat.opacity = materials[i].startOpacity * (1.0 - fadeT);
      }
      if (t >= 1.0) {
        cardGroup.visible = false;
        cardGroup.position.x = startX;
        done = true;
      }
    }
  };
}
```

### 2D. Shatter Into Fragments

The card plane is replaced by a grid of small quads that fly apart like shattering glass. Uses instanced rendering for 1 draw call. Requires pre-generating the fragment mesh.

```javascript
// ─── SHATTER EXIT ───────────────────────────────────────────────────────
// Replaces card with a grid of fragments that fly apart.
// Budget: 1 draw call (InstancedMesh, ~64 fragments)

function createShatterExit(width, height, gridX, gridY, baseColor) {
  width = width || 0.4;
  height = height || 0.3;
  gridX = gridX || 8;
  gridY = gridY || 8;
  baseColor = baseColor || 0x1a1a2e;

  var fragW = width / gridX;
  var fragH = height / gridY;
  var count = gridX * gridY;

  var fragGeo = new THREE.PlaneGeometry(fragW * 0.95, fragH * 0.95);
  var fragMat = new THREE.MeshBasicMaterial({
    color: baseColor,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide
  });
  var imesh = new THREE.InstancedMesh(fragGeo, fragMat, count);
  imesh.visible = false;

  // Store rest positions and random velocities
  var restMatrices = [];
  var velocities = [];
  var angularVels = [];
  var dummy = new THREE.Object3D();
  var idx = 0;
  for (var iy = 0; iy < gridY; iy++) {
    for (var ix = 0; ix < gridX; ix++) {
      var px = (ix + 0.5) * fragW - width / 2;
      var py = (iy + 0.5) * fragH - height / 2;
      dummy.position.set(px, py, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      imesh.setMatrixAt(idx, dummy.matrix);
      restMatrices.push(dummy.matrix.clone());
      // Random velocity (outward + slight forward)
      velocities.push(new THREE.Vector3(
        (px / width) * 0.5 + (Math.random() - 0.5) * 0.2,
        (py / height) * 0.5 + (Math.random() - 0.5) * 0.2,
        Math.random() * 0.2 + 0.05
      ));
      angularVels.push(new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 4
      ));
      idx++;
    }
  }
  imesh.instanceMatrix.needsUpdate = true;

  var elapsed = 0;
  var animDuration = 0.7;
  var done = false;

  return {
    mesh: imesh,
    // Call start() to trigger shatter (and hide the actual card)
    start: function() {
      imesh.visible = true;
      elapsed = 0;
      done = false;
      // Reset to rest positions
      for (var i = 0; i < count; i++) {
        imesh.setMatrixAt(i, restMatrices[i]);
      }
      imesh.instanceMatrix.needsUpdate = true;
    },
    done: function() { return done; },
    tick: function(dt) {
      if (done || !imesh.visible) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      var dummy = new THREE.Object3D();
      for (var i = 0; i < count; i++) {
        var rest = restMatrices[i];
        var restPos = new THREE.Vector3();
        restPos.setFromMatrixPosition(rest);
        dummy.position.copy(restPos).add(velocities[i].clone().multiplyScalar(t));
        dummy.position.y -= t * t * 0.3; // gravity
        dummy.rotation.set(
          angularVels[i].x * t,
          angularVels[i].y * t,
          angularVels[i].z * t
        );
        dummy.scale.setScalar(1.0 - t * 0.5);
        dummy.updateMatrix();
        imesh.setMatrixAt(i, dummy.matrix);
      }
      imesh.instanceMatrix.needsUpdate = true;
      fragMat.opacity = 0.92 * (1.0 - t);
      if (t >= 1.0) {
        imesh.visible = false;
        done = true;
      }
    }
  };
}
```

### 2E. Fold Closed Like a Book

Two halves of the card rotate inward around the center vertical axis and close flat. Uses two separate plane meshes. 2 draw calls.

```javascript
// ─── FOLD CLOSED EXIT ───────────────────────────────────────────────────
// Card splits into left/right halves that rotate closed like a book.
// Budget: 2 draw calls (left half + right half)

function createFoldClosedExit(width, height, baseColor) {
  width = width || 0.4;
  height = height || 0.3;
  baseColor = baseColor || 0x1a1a2e;

  var halfW = width / 2;
  var mat = new THREE.MeshBasicMaterial({
    color: baseColor,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide
  });

  // Left half: pivot on right edge (center line)
  var leftGeo = new THREE.PlaneGeometry(halfW, height);
  // Shift geometry so pivot is at right edge
  leftGeo.translate(-halfW / 2, 0, 0);
  var leftMesh = new THREE.Mesh(leftGeo, mat.clone());
  leftMesh.position.x = 0; // center of card

  // Right half: pivot on left edge (center line)
  var rightGeo = new THREE.PlaneGeometry(halfW, height);
  rightGeo.translate(halfW / 2, 0, 0);
  var rightMesh = new THREE.Mesh(rightGeo, mat.clone());
  rightMesh.position.x = 0;

  var group = new THREE.Group();
  group.add(leftMesh);
  group.add(rightMesh);
  group.visible = false;

  var elapsed = 0;
  var animDuration = 0.5;
  var done = false;

  return {
    group: group,
    start: function() {
      group.visible = true;
      leftMesh.rotation.y = 0;
      rightMesh.rotation.y = 0;
      leftMesh.material.opacity = 0.92;
      rightMesh.material.opacity = 0.92;
      elapsed = 0;
      done = false;
    },
    done: function() { return done; },
    tick: function(dt) {
      if (done || !group.visible) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      var ease = easeInCubic(t);
      // Left half rotates clockwise (positive Y), right half counter-clockwise
      leftMesh.rotation.y = ease * Math.PI * 0.5;
      rightMesh.rotation.y = -ease * Math.PI * 0.5;
      // Fade out in last 30%
      var fadeT = Math.max(0, (t - 0.7) / 0.3);
      leftMesh.material.opacity = 0.92 * (1.0 - fadeT);
      rightMesh.material.opacity = 0.92 * (1.0 - fadeT);
      if (t >= 1.0) {
        group.visible = false;
        done = true;
      }
    }
  };
}
```

---

## 3. Card Materials & Surface Effects

### 3A. Frosted Glass Material

Semi-transparent dark panel with subtle noise for a frosted look. No actual background blur (impossible without post-processing), but the visual reads as frosted glass in VR because there is no sharp background visible through it. 1 draw call.

```javascript
// ─── FROSTED GLASS CARD MATERIAL ────────────────────────────────────────
// Budget: 1 draw call

function createFrostedGlassMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:     { value: 0 },
      uBaseCol:  { value: new THREE.Color(0x0a0a1a) },
      uFrostCol: { value: new THREE.Color(0x2a3a5a) },
      uAlpha:    { value: 0.82 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uBaseCol, uFrostCol;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                   mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }

      void main() {
        // Frosted noise texture (static, no animation needed)
        float frost = noise(vUv * 80.0) * 0.4 + noise(vUv * 40.0) * 0.3 + noise(vUv * 20.0) * 0.3;
        vec3 col = mix(uBaseCol, uFrostCol, frost * 0.5);

        // Fresnel edge brightening (more opaque at glancing angles)
        float fresnel = 1.0 - abs(dot(vWorldNormal, vViewDir));
        fresnel = pow(fresnel, 2.0);
        col += vec3(0.15, 0.2, 0.35) * fresnel;

        // Very subtle shimmer
        float shimmer = noise(vUv * 30.0 + uTime * 0.3) * 0.03;
        col += shimmer;

        gl_FragColor = vec4(col, uAlpha + fresnel * 0.1);
      }
    `
  });
}
```

### 3B. Metallic / Brushed Metal Panel

Anisotropic highlight streaks simulating brushed aluminum. 1 draw call.

```javascript
// ─── BRUSHED METAL CARD MATERIAL ────────────────────────────────────────
// Simulates brushed metal with horizontal anisotropic streaks.
// Budget: 1 draw call

function createBrushedMetalMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uBaseCol:   { value: new THREE.Color(0x2a2a3a) },
      uHighlight: { value: new THREE.Color(0x6a7a9a) },
      uAlpha:     { value: 0.95 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseCol, uHighlight;
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vWorldNormal, vViewDir, vWorldPos;

      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // Brushed metal: horizontal streaks via high-freq Y noise
        float streak = 0.0;
        for (float i = 0.0; i < 4.0; i += 1.0) {
          float freq = 200.0 + i * 150.0;
          streak += (sin(vUv.y * freq + hash(i) * 100.0) * 0.5 + 0.5) * (0.3 / (i + 1.0));
        }
        streak = streak * 0.5 + 0.5;

        // Anisotropic specular: bright when view direction aligns with horizontal
        vec3 tangent = normalize(cross(vWorldNormal, vec3(0.0, 1.0, 0.0)));
        float aniso = pow(1.0 - abs(dot(vViewDir, tangent)), 4.0);

        vec3 col = mix(uBaseCol, uHighlight, streak * 0.4 + aniso * 0.6);

        // Slight fresnel
        float fresnel = pow(1.0 - abs(dot(vWorldNormal, vViewDir)), 3.0);
        col += vec3(0.1, 0.12, 0.18) * fresnel;

        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });
}
```

### 3C. Glassmorphism (Semi-Transparent With Subtle Refraction)

Uses view-dependent color shift to simulate light refraction through glass. 1 draw call.

```javascript
// ─── GLASSMORPHISM MATERIAL ─────────────────────────────────────────────
// Semi-transparent with chromatic shift at edges to simulate refraction.
// Budget: 1 draw call

function createGlassmorphismMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uAlpha:   { value: 0.55 },
      uBaseCol: { value: new THREE.Color(0x0a0a2a) },
      uTint:    { value: new THREE.Color(0x3355aa) }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      uniform vec3 uBaseCol, uTint;
      varying vec2 vUv;
      varying vec3 vWorldNormal, vViewDir;

      void main() {
        float fresnel = pow(1.0 - abs(dot(vWorldNormal, vViewDir)), 2.5);

        // Chromatic aberration at edges
        float r = fresnel * 1.0;
        float g = fresnel * 0.6;
        float b = fresnel * 0.3;
        vec3 chromatic = vec3(r, g, b) * 0.3;

        vec3 col = uBaseCol + uTint * fresnel * 0.4 + chromatic;

        // Subtle gradient from top to bottom
        col += vec3(0.02, 0.03, 0.06) * vUv.y;

        // Edge-aware alpha: more opaque at edges (simulates glass thickness)
        float alpha = uAlpha + fresnel * 0.3;

        gl_FragColor = vec4(col, alpha);
      }
    `
  });
}
```

### 3D. Animated Gradient Border

A separate border mesh around the card with a color that cycles around the perimeter. Uses a ring/frame geometry. 1 draw call for the border.

```javascript
// ─── ANIMATED GRADIENT BORDER ───────────────────────────────────────────
// A rectangular frame around the card with animated color cycling.
// Budget: 1 draw call (frame mesh)

function createAnimatedBorder(width, height, thickness, speed) {
  width = width || 0.4;
  height = height || 0.3;
  thickness = thickness || 0.006;
  speed = speed || 0.5;

  // Build a rectangular frame from a custom ShapeGeometry with hole
  var outerW = width / 2 + thickness;
  var outerH = height / 2 + thickness;
  var innerW = width / 2;
  var innerH = height / 2;

  var shape = new THREE.Shape();
  shape.moveTo(-outerW, -outerH);
  shape.lineTo(outerW, -outerH);
  shape.lineTo(outerW, outerH);
  shape.lineTo(-outerW, outerH);
  shape.lineTo(-outerW, -outerH);
  var hole = new THREE.Path();
  hole.moveTo(-innerW, -innerH);
  hole.lineTo(-innerW, innerH);
  hole.lineTo(innerW, innerH);
  hole.lineTo(innerW, -innerH);
  hole.lineTo(-innerW, -innerH);
  shape.holes.push(hole);
  var geo = new THREE.ShapeGeometry(shape);

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:  { value: 0 },
      uSpeed: { value: speed },
      uCol1:  { value: new THREE.Color(0x00ddff) },
      uCol2:  { value: new THREE.Color(0xff00aa) },
      uCol3:  { value: new THREE.Color(0xffdd00) },
      uWidth: { value: width },
      uHeight:{ value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSpeed, uWidth, uHeight;
      uniform vec3 uCol1, uCol2, uCol3;
      varying vec2 vPos;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        // Compute angle around the rectangle perimeter
        // Map position to a 0..1 parameter going around the border
        float hw = uWidth * 0.5;
        float hh = uHeight * 0.5;
        float angle = atan(vPos.y, vPos.x); // -PI..PI
        float t = angle / 6.2832 + 0.5; // 0..1

        // Animate
        t = fract(t + uTime * uSpeed);

        // Rainbow or 3-color gradient
        vec3 col = hsv2rgb(vec3(t, 0.8, 1.0));

        gl_FragColor = vec4(col, 0.9);
      }
    `
  });

  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0.001; // Slightly in front of card

  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 3E. Scan Line Overlay (Subtle CRT Effect)

A subtle horizontal scan line pattern overlaid on the card. NOT a flicker -- just faint lines that slowly scroll. Applied directly in the card's fragment shader or as a second pass plane. 1 draw call if integrated into card shader, otherwise +1.

```javascript
// ─── CRT SCAN LINE OVERLAY ─────────────────────────────────────────────
// Add this to any existing card fragment shader, or use as a separate
// overlay plane slightly in front of the card.
// Budget: 1 draw call (as overlay), 0 if integrated

// OPTION A: Integrate into existing shader — add these lines to fragmentShader:
/*
  // CRT scan lines — add before final gl_FragColor
  float scanLine = 0.95 + 0.05 * sin(vUv.y * 400.0);
  float scanScroll = 0.98 + 0.02 * sin(vUv.y * 400.0 - uTime * 2.0);
  col *= scanLine * scanScroll;
*/

// OPTION B: Separate overlay plane
function createScanLineOverlay(width, height) {
  width = width || 0.4;
  height = height || 0.3;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }
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
      varying vec2 vUv;
      void main() {
        // Faint horizontal lines
        float line = sin(vUv.y * 400.0) * 0.5 + 0.5;
        line = smoothstep(0.3, 0.7, line);
        // Slow scroll
        float scroll = sin(vUv.y * 400.0 - uTime * 1.5) * 0.5 + 0.5;
        scroll = smoothstep(0.4, 0.6, scroll);
        // Very subtle: mostly transparent, just darkens slightly
        float alpha = (1.0 - line * scroll) * 0.06;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0.002; // In front of card
  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 3F. Holographic Iridescent Surface

Color shifts based on viewing angle using a thin-film interference approximation. 1 draw call.

```javascript
// ─── HOLOGRAPHIC IRIDESCENT MATERIAL ────────────────────────────────────
// Thin-film interference colors that shift with viewing angle.
// Budget: 1 draw call

function createIridescentMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:    { value: 0 },
      uBaseCol: { value: new THREE.Color(0x0a0a1e) },
      uAlpha:   { value: 0.88 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uBaseCol;
      varying vec2 vUv;
      varying vec3 vWorldNormal, vViewDir;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        float cosAngle = abs(dot(vWorldNormal, vViewDir));

        // Thin-film interference: hue depends on angle
        float filmThickness = 2.5; // adjusts color range
        float hue = fract(cosAngle * filmThickness + uTime * 0.05);
        vec3 iridescence = hsv2rgb(vec3(hue, 0.6, 0.7));

        // Stronger at glancing angles (where thin-film is most visible)
        float fresnel = pow(1.0 - cosAngle, 3.0);
        vec3 col = mix(uBaseCol, iridescence, fresnel * 0.7 + 0.1);

        // Subtle position-based variation so it's not uniform
        float posVar = sin(vUv.x * 10.0 + vUv.y * 8.0 + uTime * 0.3) * 0.05;
        col += posVar;

        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });
}
```

### 3G. Matte Dark Panel With Glowing Edge Trim

A dark flat card with bright emissive edges. The card body is MeshBasicMaterial (dead simple), and the edge glow is a separate border mesh. 2 draw calls total.

```javascript
// ─── MATTE DARK PANEL + GLOWING EDGE TRIM ──────────────────────────────
// Budget: 2 draw calls (panel + edge)

function createMatteGlowPanel(width, height, edgeColor) {
  width = width || 0.4;
  height = height || 0.3;
  edgeColor = edgeColor || 0x00ddff;

  // Panel: dead simple dark material
  var panelGeo = new THREE.PlaneGeometry(width, height);
  var panelMat = new THREE.MeshBasicMaterial({
    color: 0x0d0d1a,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide
  });
  var panel = new THREE.Mesh(panelGeo, panelMat);

  // Edge glow: slightly larger plane behind with emissive shader
  var edgePad = 0.012;
  var edgeGeo = new THREE.PlaneGeometry(width + edgePad * 2, height + edgePad * 2);
  var edgeMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uColor:  { value: new THREE.Color(edgeColor) },
      uTime:   { value: 0 },
      uWidth:  { value: width + edgePad * 2 },
      uHeight: { value: height + edgePad * 2 },
      uInnerW: { value: width },
      uInnerH: { value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime, uWidth, uHeight, uInnerW, uInnerH;
      varying vec2 vUv;
      void main() {
        // Convert UV to position relative to center
        vec2 pos = (vUv - 0.5) * vec2(uWidth, uHeight);
        // Distance to inner rectangle edge
        vec2 inner = vec2(uInnerW * 0.5, uInnerH * 0.5);
        vec2 d = abs(pos) - inner;
        float dist = length(max(d, 0.0));
        // Only render the edge area
        if (d.x < -0.002 && d.y < -0.002) discard;
        // Glow falloff
        float glow = exp(-dist * 80.0);
        // Subtle pulse
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
        vec3 col = uColor * glow * pulse;
        gl_FragColor = vec4(col, glow * 0.9);
      }
    `
  });
  var edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.z = -0.001; // Behind the panel

  var group = new THREE.Group();
  group.add(panel);
  group.add(edge);

  return {
    group: group,
    panel: panel,
    edge: edge,
    tick: function(dt) {
      edgeMat.uniforms.uTime.value += dt;
    }
  };
}
```

---

## 4. Edge/Border Effects

### 4A. Animated Shimmer Traveling Around the Border

A bright highlight spot that travels around the card border continuously. 1 draw call (border mesh).

```javascript
// ─── TRAVELING SHIMMER BORDER ───────────────────────────────────────────
// A bright spot orbits the rectangular border.
// Budget: 1 draw call

function createShimmerBorder(width, height, thickness, color, speed) {
  width = width || 0.4;
  height = height || 0.3;
  thickness = thickness || 0.005;
  color = color || 0x00ddff;
  speed = speed || 0.3;

  // Perimeter calculation for consistent speed
  var perimeter = 2 * (width + height);

  // Build frame geometry (same as animated border)
  var outerW = width / 2 + thickness;
  var outerH = height / 2 + thickness;
  var innerW = width / 2;
  var innerH = height / 2;
  var shape = new THREE.Shape();
  shape.moveTo(-outerW, -outerH);
  shape.lineTo(outerW, -outerH);
  shape.lineTo(outerW, outerH);
  shape.lineTo(-outerW, outerH);
  shape.lineTo(-outerW, -outerH);
  var hole = new THREE.Path();
  hole.moveTo(-innerW, -innerH);
  hole.lineTo(-innerW, innerH);
  hole.lineTo(innerW, innerH);
  hole.lineTo(innerW, -innerH);
  hole.lineTo(-innerW, -innerH);
  shape.holes.push(hole);
  var geo = new THREE.ShapeGeometry(shape);

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color(color) },
      uBaseAlpha: { value: 0.3 },
      uWidth:     { value: width },
      uHeight:    { value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBaseAlpha, uWidth, uHeight;
      uniform vec3 uColor;
      varying vec2 vPos;

      // Map position on border to 0..1 perimeter parameter
      float borderParam(vec2 p) {
        float hw = uWidth * 0.5;
        float hh = uHeight * 0.5;
        // Which edge are we closest to?
        float perim = 2.0 * (uWidth + uHeight);
        // Top edge: right to left
        if (p.y > hh * 0.9) return (hw - p.x) / perim;
        // Left edge: top to bottom
        if (p.x < -hw * 0.9) return (uWidth + hh - p.y) / perim;
        // Bottom edge: left to right
        if (p.y < -hh * 0.9) return (uWidth + uHeight + p.x + hw) / perim;
        // Right edge: bottom to top
        return (2.0 * uWidth + uHeight + p.y + hh) / perim;
      }

      void main() {
        float param = borderParam(vPos);
        float shimmerPos = fract(uTime * 0.3); // 0..1 going around
        // Distance on the perimeter (wrapping)
        float dist = abs(param - shimmerPos);
        dist = min(dist, 1.0 - dist); // wrap-around
        // Bright spot with falloff
        float spot = exp(-dist * dist * 800.0);
        // Also a trailing tail
        float trail = exp(-dist * 60.0) * 0.3;
        float brightness = spot + trail + uBaseAlpha;
        gl_FragColor = vec4(uColor * brightness, brightness);
      }
    `
  });

  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0.001;

  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 4B. Pulsing Glow on Card Edges

The entire border breathes with a sine-wave brightness. Uses the same frame geometry as 3G's edge trim but with pulse animation. 1 draw call.

```javascript
// ─── PULSING GLOW BORDER ────────────────────────────────────────────────
// Entire border pulses glow. Simple and effective.
// Budget: 1 draw call
// Use the createMatteGlowPanel from 3G — the edgeMat already has uTime pulse.
// To make it a standalone pulsing border:

function createPulsingGlowBorder(width, height, color) {
  width = width || 0.4;
  height = height || 0.3;
  color = color || 0x00ddff;
  var pad = 0.015; // glow extends this far
  var geo = new THREE.PlaneGeometry(width + pad * 4, height + pad * 4);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:   { value: 0 },
      uColor:  { value: new THREE.Color(color) },
      uWidth:  { value: width },
      uHeight: { value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWidth, uHeight;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float totalW = uWidth + 0.06;
        float totalH = uHeight + 0.06;
        vec2 pos = (vUv - 0.5) * vec2(totalW, totalH);
        vec2 inner = vec2(uWidth * 0.5, uHeight * 0.5);
        vec2 d = abs(pos) - inner;
        // Inside the card area: transparent
        if (d.x < 0.0 && d.y < 0.0) discard;
        float dist = length(max(d, 0.0));
        float glow = exp(-dist * 50.0);
        float pulse = 0.6 + 0.4 * sin(uTime * 2.5);
        gl_FragColor = vec4(uColor * glow * pulse * 1.5, glow * pulse);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.001;
  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 4C. Electric/Lightning Edge Effect

Jagged lightning-like lines along the border using noise-displaced edge coordinates. 1 draw call.

```javascript
// ─── ELECTRIC LIGHTNING BORDER ──────────────────────────────────────────
// Noisy, jagged glow along the card edges. Budget: 1 draw call

function createLightningBorder(width, height, color) {
  width = width || 0.4;
  height = height || 0.3;
  color = color || 0x44aaff;
  var pad = 0.02;
  var geo = new THREE.PlaneGeometry(width + pad * 4, height + pad * 4);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:   { value: 0 },
      uColor:  { value: new THREE.Color(color) },
      uWidth:  { value: width },
      uHeight: { value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWidth, uHeight;
      uniform vec3 uColor;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise1d(float p) {
        float i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(hash(i), hash(i + 1.0), f);
      }

      void main() {
        float totalW = uWidth + 0.08;
        float totalH = uHeight + 0.08;
        vec2 pos = (vUv - 0.5) * vec2(totalW, totalH);
        vec2 inner = vec2(uWidth * 0.5, uHeight * 0.5);
        vec2 d = abs(pos) - inner;

        // Signed distance to rectangle edge
        float outside = length(max(d, 0.0));
        float inside = min(max(d.x, d.y), 0.0);
        float sdf = outside + inside;

        // Lightning displacement: use position along edge + time
        float edgeParam = atan(pos.y, pos.x) * 10.0;
        float lightning = noise1d(edgeParam + uTime * 8.0) * 0.015
                        + noise1d(edgeParam * 3.0 + uTime * 15.0) * 0.008;

        // Displaced distance
        float displaced = abs(sdf - lightning);

        // Sharp bright core + soft glow
        float core = exp(-displaced * 400.0);
        float glow = exp(-displaced * 80.0) * 0.4;

        // Flicker intensity
        float flicker = 0.7 + 0.3 * noise1d(uTime * 20.0);

        vec3 col = uColor * (core + glow) * flicker;
        float alpha = (core + glow) * flicker;

        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.001;
  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 4D. Gradient Edge That Shifts Color Over Time

Similar to 3D but just the edge smoothly transitions through colors. 1 draw call.

```javascript
// ─── COLOR-SHIFTING GRADIENT EDGE ───────────────────────────────────────
// The border hue rotates continuously over time.
// Budget: 1 draw call
// Reuse the pulsing glow border structure, change the fragment shader:

function createColorShiftBorder(width, height, speed) {
  width = width || 0.4;
  height = height || 0.3;
  speed = speed || 0.2;
  var pad = 0.012;
  var geo = new THREE.PlaneGeometry(width + pad * 4, height + pad * 4);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:   { value: 0 },
      uWidth:  { value: width },
      uHeight: { value: height }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWidth, uHeight;
      varying vec2 vUv;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        float totalW = uWidth + 0.048;
        float totalH = uHeight + 0.048;
        vec2 pos = (vUv - 0.5) * vec2(totalW, totalH);
        vec2 inner = vec2(uWidth * 0.5, uHeight * 0.5);
        vec2 d = abs(pos) - inner;
        if (d.x < 0.0 && d.y < 0.0) discard;
        float dist = length(max(d, 0.0));
        float glow = exp(-dist * 60.0);

        // Hue shifts with time
        float hue = fract(uTime * 0.15);
        vec3 col = hsv2rgb(vec3(hue, 0.7, 1.0)) * glow * 1.2;

        gl_FragColor = vec4(col, glow * 0.9);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.001;
  return {
    mesh: mesh,
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
    }
  };
}
```

### 4E. Corner Accent Animations (Brackets That Animate In)

Four corner bracket shapes that scale/slide into position when the card appears. Uses 4 small line segments (or 1 instanced mesh). Can be done with 4 simple meshes (4 draw calls, within budget) or 1 InstancedMesh.

```javascript
// ─── CORNER BRACKET ACCENTS ─────────────────────────────────────────────
// Four L-shaped brackets at the card corners that animate in.
// Budget: 1 draw call (InstancedMesh with 8 instances — 2 lines per corner)
// OR 4 draw calls with simple meshes (simpler code, still within budget)

function createCornerBrackets(width, height, bracketLen, thickness, color) {
  width = width || 0.4;
  height = height || 0.3;
  bracketLen = bracketLen || 0.04;
  thickness = thickness || 0.003;
  color = color || 0x00ddff;

  // 8 rectangles: 2 per corner (horizontal + vertical bar)
  var mat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.0 // starts invisible, animates in
  });

  // Corners: TL, TR, BL, BR
  var hw = width / 2;
  var hh = height / 2;
  var corners = [
    { x: -hw, y:  hh, dx:  1, dy: -1 }, // top-left
    { x:  hw, y:  hh, dx: -1, dy: -1 }, // top-right
    { x: -hw, y: -hh, dx:  1, dy:  1 }, // bottom-left
    { x:  hw, y: -hh, dx: -1, dy:  1 }  // bottom-right
  ];

  var group = new THREE.Group();
  var bars = [];

  corners.forEach(function(c) {
    // Horizontal bar
    var hGeo = new THREE.PlaneGeometry(bracketLen, thickness);
    var hMesh = new THREE.Mesh(hGeo, mat);
    hMesh.position.set(c.x + c.dx * bracketLen / 2, c.y, 0.002);
    group.add(hMesh);
    bars.push({ mesh: hMesh, targetX: hMesh.position.x, targetY: hMesh.position.y,
                startX: c.x, startY: c.y });

    // Vertical bar
    var vGeo = new THREE.PlaneGeometry(thickness, bracketLen);
    var vMesh = new THREE.Mesh(vGeo, mat);
    vMesh.position.set(c.x, c.y + c.dy * bracketLen / 2, 0.002);
    group.add(vMesh);
    bars.push({ mesh: vMesh, targetX: vMesh.position.x, targetY: vMesh.position.y,
                startX: c.x, startY: c.y });
  });

  var elapsed = 0;
  var animDuration = 0.4;
  var done = false;

  return {
    group: group,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / animDuration, 1.0);
      var ease = easeOutBack(t);
      mat.opacity = t * 0.9;
      for (var i = 0; i < bars.length; i++) {
        var b = bars[i];
        b.mesh.position.x = b.startX + (b.targetX - b.startX) * ease;
        b.mesh.position.y = b.startY + (b.targetY - b.startY) * ease;
      }
      if (t >= 1.0) {
        mat.opacity = 0.9;
        done = true;
      }
    }
  };
}
```

---

## 5. Button Press/Interaction Animations

### 5A. Scale Bounce on Press

Button shrinks to 0.85 on press, then bounces back to 1.0 with overshoot on release. 0 extra draw calls (transforms only).

```javascript
// ─── BUTTON SCALE BOUNCE ────────────────────────────────────────────────
// Attach to a button mesh or group.
// Call press() on selectstart, release() on selectend.
// Tick every frame.

function buttonScaleBounce(buttonMesh) {
  var state = 'idle'; // idle, pressing, releasing
  var elapsed = 0;
  var pressDuration = 0.08;
  var releaseDuration = 0.3;
  var pressScale = 0.85;

  return {
    press: function() {
      state = 'pressing';
      elapsed = 0;
    },
    release: function() {
      state = 'releasing';
      elapsed = 0;
    },
    tick: function(dt) {
      if (state === 'idle') return;
      elapsed += dt;
      if (state === 'pressing') {
        var t = Math.min(elapsed / pressDuration, 1.0);
        var s = 1.0 + (pressScale - 1.0) * easeOutCubic(t);
        buttonMesh.scale.setScalar(s);
        if (t >= 1.0) state = 'held';
      } else if (state === 'releasing') {
        var t = Math.min(elapsed / releaseDuration, 1.0);
        var s = pressScale + (1.0 - pressScale) * easeOutElastic(t);
        buttonMesh.scale.setScalar(s);
        if (t >= 1.0) {
          buttonMesh.scale.setScalar(1.0);
          state = 'idle';
        }
      }
    }
  };
}
```

### 5B. Ripple Effect From Press Point

A circular ripple expands from the press point on the button surface. Uses a shader on the button background. 0 extra draw calls (shader on existing button mesh).

```javascript
// ─── BUTTON RIPPLE EFFECT ───────────────────────────────────────────────
// Creates a ShaderMaterial for a button that shows a ripple on click.
// The ripple UV origin is set by calling triggerRipple(u, v).
// Budget: 0 extra draw calls (replaces button material)

function createRippleButtonMaterial(baseColor, rippleColor) {
  baseColor = baseColor || 0x1a2a4a;
  rippleColor = rippleColor || 0x00ddff;

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime:       { value: 0 },
      uBaseCol:    { value: new THREE.Color(baseColor) },
      uRippleCol:  { value: new THREE.Color(rippleColor) },
      uRippleT:    { value: -1.0 }, // negative = no ripple active
      uRippleUV:   { value: new THREE.Vector2(0.5, 0.5) },
      uAlpha:      { value: 0.9 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRippleT, uAlpha;
      uniform vec3 uBaseCol, uRippleCol;
      uniform vec2 uRippleUV;
      varying vec2 vUv;
      void main() {
        vec3 col = uBaseCol;

        if (uRippleT >= 0.0 && uRippleT < 1.0) {
          float dist = length(vUv - uRippleUV);
          float radius = uRippleT * 1.2; // expands beyond button
          float ring = smoothstep(radius - 0.08, radius, dist)
                     - smoothstep(radius, radius + 0.08, dist);
          float fade = 1.0 - uRippleT;
          col = mix(col, uRippleCol, ring * fade * 0.7);
          // Inner fill that fades
          float fill = smoothstep(radius + 0.05, radius - 0.1, dist);
          col = mix(col, uRippleCol, fill * fade * 0.15);
        }

        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });

  var rippleStartTime = -1;
  var rippleDuration = 0.5;

  return {
    material: mat,
    triggerRipple: function(u, v) {
      mat.uniforms.uRippleUV.value.set(u || 0.5, v || 0.5);
      mat.uniforms.uRippleT.value = 0.0;
      rippleStartTime = mat.uniforms.uTime.value;
    },
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
      if (rippleStartTime >= 0) {
        var elapsed = mat.uniforms.uTime.value - rippleStartTime;
        var t = elapsed / rippleDuration;
        if (t >= 1.0) {
          mat.uniforms.uRippleT.value = -1.0;
          rippleStartTime = -1;
        } else {
          mat.uniforms.uRippleT.value = t;
        }
      }
    }
  };
}
```

### 5C. Color Flash on Activation

Simple: on click, lerp button color to bright white/cyan, then back. 0 extra draw calls.

```javascript
// ─── COLOR FLASH ON CLICK ───────────────────────────────────────────────
// Works with MeshBasicMaterial or ShaderMaterial that has a color uniform.
// Budget: 0 extra draw calls

function colorFlashOnClick(material, flashColor, duration) {
  flashColor = flashColor ? new THREE.Color(flashColor) : new THREE.Color(0xffffff);
  duration = duration || 0.25;
  var originalColor = material.color ? material.color.clone() : new THREE.Color(0x1a2a4a);
  var elapsed = -1;
  var tempColor = new THREE.Color();

  return {
    trigger: function() {
      elapsed = 0;
    },
    tick: function(dt) {
      if (elapsed < 0) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      // Flash up fast (first 20%), then fade back (remaining 80%)
      var flash;
      if (t < 0.2) {
        flash = t / 0.2; // 0 to 1
      } else {
        flash = 1.0 - (t - 0.2) / 0.8; // 1 to 0
      }
      tempColor.copy(originalColor).lerp(flashColor, flash);
      if (material.color) {
        material.color.copy(tempColor);
      } else if (material.uniforms && material.uniforms.uBaseCol) {
        material.uniforms.uBaseCol.value.copy(tempColor);
      }
      if (t >= 1.0) {
        if (material.color) material.color.copy(originalColor);
        elapsed = -1;
      }
    }
  };
}
```

### 5D. Edge Glow Pulse on Hover

When a controller ray hovers over a button, the button edge glows. Implemented as a shader uniform toggle. 0 extra draw calls.

```javascript
// ─── BUTTON HOVER EDGE GLOW ────────────────────────────────────────────
// ShaderMaterial for a button that shows edge glow when hovered.
// Budget: 0 extra draw calls (IS the button material)

function createHoverGlowButtonMaterial(baseColor, glowColor) {
  baseColor = baseColor || 0x1a2a4a;
  glowColor = glowColor || 0x00ddff;

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uBaseCol:  { value: new THREE.Color(baseColor) },
      uGlowCol:  { value: new THREE.Color(glowColor) },
      uHover:    { value: 0.0 }, // 0 = not hovered, 1 = hovered
      uTime:     { value: 0.0 },
      uAlpha:    { value: 0.9 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseCol, uGlowCol;
      uniform float uHover, uTime, uAlpha;
      varying vec2 vUv;
      void main() {
        vec3 col = uBaseCol;
        // Edge distance
        vec2 edgeDist = min(vUv, 1.0 - vUv);
        float edge = min(edgeDist.x, edgeDist.y);
        // Edge glow when hovered
        float glow = smoothstep(0.08, 0.0, edge) * uHover;
        float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
        col = mix(col, uGlowCol, glow * pulse);
        // Slight overall brighten on hover
        col += uGlowCol * uHover * 0.05;
        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });

  var currentHover = 0;
  var targetHover = 0;

  return {
    material: mat,
    setHovered: function(hovered) {
      targetHover = hovered ? 1 : 0;
    },
    tick: function(dt) {
      mat.uniforms.uTime.value += dt;
      // Smooth transition
      currentHover += (targetHover - currentHover) * Math.min(dt * 12, 1);
      mat.uniforms.uHover.value = currentHover;
    }
  };
}
```

### 5E. Press-and-Hold Fill Animation (Radial Fill)

A radial fill that expands from center while the button is held. Completes at 100% after a set duration. 0 extra draw calls.

```javascript
// ─── PRESS AND HOLD RADIAL FILL ─────────────────────────────────────────
// The button fills with color radially from center while held.
// Budget: 0 extra draw calls (shader on button mesh)

function createHoldFillButtonMaterial(baseColor, fillColor, holdDuration) {
  baseColor = baseColor || 0x1a2a4a;
  fillColor = fillColor || 0x00dd88;
  holdDuration = holdDuration || 1.5; // seconds to fill completely

  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uBaseCol: { value: new THREE.Color(baseColor) },
      uFillCol: { value: new THREE.Color(fillColor) },
      uFill:    { value: 0.0 }, // 0..1
      uAlpha:   { value: 0.9 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseCol, uFillCol;
      uniform float uFill, uAlpha;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv - 0.5) * 2.0; // 0 at center, ~1.4 at corners
        float maxDist = 1.42; // diagonal distance
        float fillRadius = uFill * maxDist;
        float filled = smoothstep(fillRadius, fillRadius - 0.08, dist);
        vec3 col = mix(uBaseCol, uFillCol, filled);
        // Bright ring at fill edge
        float ring = smoothstep(fillRadius - 0.08, fillRadius, dist)
                   - smoothstep(fillRadius, fillRadius + 0.02, dist);
        col += uFillCol * ring * 0.5;
        gl_FragColor = vec4(col, uAlpha);
      }
    `
  });

  var holdElapsed = 0;
  var holding = false;
  var completed = false;

  return {
    material: mat,
    startHold: function() {
      holding = true;
      holdElapsed = 0;
      completed = false;
    },
    endHold: function() {
      holding = false;
      // Animate fill back to 0
    },
    isComplete: function() { return completed; },
    tick: function(dt) {
      if (holding) {
        holdElapsed += dt;
        var t = Math.min(holdElapsed / holdDuration, 1.0);
        mat.uniforms.uFill.value = t;
        if (t >= 1.0 && !completed) {
          completed = true;
        }
      } else if (mat.uniforms.uFill.value > 0) {
        // Drain back
        mat.uniforms.uFill.value = Math.max(0, mat.uniforms.uFill.value - dt * 3);
      }
    }
  };
}
```

### 5F. Click Spark/Particle Burst

A small particle burst on button click. Pre-allocated Points geometry, reactivated on each click. 1 draw call.

```javascript
// ─── CLICK SPARK BURST ──────────────────────────────────────────────────
// Small particle burst on button activation.
// Budget: 1 draw call (Points, 30 particles)

function createClickSpark(color) {
  color = color || 0x00ddff;
  var count = 30;
  var positions = new Float32Array(count * 3);
  var velocities = [];
  var lifetimes = new Float32Array(count);

  for (var i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    var angle = Math.random() * Math.PI * 2;
    var speed = 0.1 + Math.random() * 0.3;
    velocities.push(new THREE.Vector3(
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      (Math.random() - 0.5) * 0.1
    ));
    lifetimes[i] = 0;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  var mat = new THREE.PointsMaterial({
    color: color,
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  var points = new THREE.Points(geo, mat);
  points.visible = false;

  var active = false;
  var elapsed = 0;
  var sparkDuration = 0.4;

  return {
    points: points,
    // Call trigger(worldPosition) to fire sparks
    trigger: function(worldPos) {
      points.position.copy(worldPos);
      active = true;
      elapsed = 0;
      mat.opacity = 1;
      points.visible = true;
      // Reset positions to origin
      var pos = geo.attributes.position.array;
      for (var i = 0; i < count * 3; i++) pos[i] = 0;
      // Randomize velocities
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = 0.1 + Math.random() * 0.3;
        velocities[i].set(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          (Math.random() - 0.5) * 0.1
        );
      }
      geo.attributes.position.needsUpdate = true;
    },
    tick: function(dt) {
      if (!active) return;
      elapsed += dt;
      var t = elapsed / sparkDuration;
      if (t >= 1.0) {
        active = false;
        points.visible = false;
        return;
      }
      var pos = geo.attributes.position.array;
      for (var i = 0; i < count; i++) {
        pos[i * 3]     += velocities[i].x * dt;
        pos[i * 3 + 1] += velocities[i].y * dt - dt * dt * 0.5; // gravity
        pos[i * 3 + 2] += velocities[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1.0 - t;
    }
  };
}
```

### 5G. Haptic-Synced Visual Feedback Patterns

Quest 3 controllers support haptic pulses via the Gamepad API. Pair visual feedback with haptics for a satisfying interaction. No extra draw calls -- this is a coordination pattern.

```javascript
// ─── HAPTIC + VISUAL FEEDBACK ───────────────────────────────────────────
// Quest 3 haptic API + visual sync.
// Usage: call hapticVisualFeedback(session, controller, buttonAnim) on select.

function hapticVisualFeedback(xrSession, controller, visualCallback) {
  // controller = renderer.xr.getController(0) or (1)
  // The gamepad is accessible during the XR session via inputSource

  // Trigger visual
  if (visualCallback) visualCallback();

  // Trigger haptic
  if (xrSession && xrSession.inputSources) {
    for (var i = 0; i < xrSession.inputSources.length; i++) {
      var source = xrSession.inputSources[i];
      if (source.gamepad && source.gamepad.hapticActuators &&
          source.gamepad.hapticActuators.length > 0) {
        // Short pulse: 50ms at 50% intensity
        source.gamepad.hapticActuators[0].pulse(0.5, 50);
      }
      // Newer API (Quest 3 supports this)
      if (source.gamepad && source.gamepad.vibrationActuator) {
        source.gamepad.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: 50,
          weakMagnitude: 0.5,
          strongMagnitude: 0.3
        });
      }
    }
  }
}

// Example: combine with scale bounce + color flash + spark
/*
controller.addEventListener('selectstart', function(event) {
  if (hoveredButton) {
    scaleAnim.press();
    flashAnim.trigger();
    sparkAnim.trigger(hoveredButton.getWorldPosition(new THREE.Vector3()));
    hapticVisualFeedback(renderer.xr.getSession(), controller, null);
  }
});
controller.addEventListener('selectend', function(event) {
  if (hoveredButton) {
    scaleAnim.release();
  }
});
*/
```

---

## 6. Text Animations on Cards

All text animations use **troika-three-text**. Each troika Text instance is 1 draw call. Budget accordingly (keep total text objects < 30).

### 6A. Typewriter Reveal (Letter by Letter)

Troika does not support per-character reveal natively, but you can use `clipRect` or incrementally set `text` content. The `clipRect` approach is cheaper (no re-layout).

```javascript
// ─── TYPEWRITER TEXT REVEAL ─────────────────────────────────────────────
// Reveals text letter-by-letter by incrementally updating the text string.
// Budget: 1 draw call (troika Text)
// NOTE: troika re-syncs on text change, so we batch characters to reduce syncs.

function createTypewriterText(options) {
  var TText = troika_three_text.Text;
  var fullText = options.text || 'Hello World';
  var charDelay = options.charDelay || 0.03; // seconds per character
  var fontSize = options.fontSize || 0.018;
  var color = options.color || 0xffffff;
  var maxWidth = options.maxWidth || 0.35;

  var textMesh = new TText();
  textMesh.text = '';
  textMesh.fontSize = fontSize;
  textMesh.color = color;
  textMesh.maxWidth = maxWidth;
  textMesh.anchorX = 'left';
  textMesh.anchorY = 'top';
  textMesh.font = options.font || undefined; // uses default
  textMesh.sync();

  var elapsed = 0;
  var currentLen = 0;
  var done = false;
  var batchSize = 3; // reveal 3 chars per sync to reduce overhead
  var lastSyncLen = 0;

  return {
    mesh: textMesh,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var targetLen = Math.min(Math.floor(elapsed / charDelay), fullText.length);
      if (targetLen > currentLen) {
        currentLen = targetLen;
        // Only re-sync every batchSize characters or at end
        if (currentLen - lastSyncLen >= batchSize || currentLen >= fullText.length) {
          textMesh.text = fullText.substring(0, currentLen);
          textMesh.sync();
          lastSyncLen = currentLen;
        }
      }
      if (currentLen >= fullText.length) {
        textMesh.text = fullText;
        textMesh.sync();
        done = true;
      }
    },
    // Instantly show all text
    complete: function() {
      textMesh.text = fullText;
      textMesh.sync();
      currentLen = fullText.length;
      done = true;
    },
    // Reset for reuse
    reset: function(newText) {
      if (newText) fullText = newText;
      textMesh.text = '';
      textMesh.sync();
      elapsed = 0;
      currentLen = 0;
      lastSyncLen = 0;
      done = false;
    }
  };
}
```

### 6B. Fade In Per-Line With Stagger Delay

Each line of text fades in sequentially. Uses multiple troika Text objects (1 per line). Keep line count reasonable (3-5 lines max on a card).

```javascript
// ─── STAGGERED LINE FADE IN ────────────────────────────────────────────
// Each line is a separate troika Text that fades in with delay.
// Budget: 1 draw call per line (3-5 lines typical = 3-5 draw calls)

function createStaggeredLines(options) {
  var TText = troika_three_text.Text;
  var lines = options.lines || ['Line 1', 'Line 2', 'Line 3'];
  var fontSize = options.fontSize || 0.016;
  var lineHeight = options.lineHeight || 0.025;
  var color = options.color || 0xffffff;
  var staggerDelay = options.staggerDelay || 0.15; // seconds between lines
  var fadeDuration = options.fadeDuration || 0.3;
  var startY = options.startY || 0;

  var group = new THREE.Group();
  var textMeshes = [];

  for (var i = 0; i < lines.length; i++) {
    var t = new TText();
    t.text = lines[i];
    t.fontSize = fontSize;
    t.color = color;
    t.anchorX = 'left';
    t.anchorY = 'top';
    t.maxWidth = options.maxWidth || 0.35;
    t.position.y = startY - i * lineHeight;
    t.material.transparent = true;
    t.material.opacity = 0;
    t.sync();
    group.add(t);
    textMeshes.push(t);
  }

  var elapsed = 0;
  var done = false;

  return {
    group: group,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var allDone = true;
      for (var i = 0; i < textMeshes.length; i++) {
        var lineStart = i * staggerDelay;
        var lineT = Math.max(0, elapsed - lineStart) / fadeDuration;
        lineT = Math.min(lineT, 1.0);
        textMeshes[i].material.opacity = easeOutCubic(lineT);
        if (lineT < 1.0) allDone = false;
      }
      if (allDone) done = true;
    }
  };
}
```

### 6C. Slide Up From Below With Opacity Fade

Each line slides up from a lower position while fading in. Similar to 6B but with position animation.

```javascript
// ─── SLIDE UP TEXT REVEAL ───────────────────────────────────────────────
// Lines slide up from below their target position while fading in.
// Budget: 1 draw call per line

function createSlideUpLines(options) {
  var TText = troika_three_text.Text;
  var lines = options.lines || ['Title', 'Description text here'];
  var fontSize = options.fontSize || 0.016;
  var lineHeight = options.lineHeight || 0.025;
  var color = options.color || 0xffffff;
  var staggerDelay = options.staggerDelay || 0.12;
  var animDuration = options.animDuration || 0.35;
  var slideDistance = options.slideDistance || 0.015; // meters

  var group = new THREE.Group();
  var textEntries = [];

  for (var i = 0; i < lines.length; i++) {
    var t = new TText();
    t.text = lines[i];
    t.fontSize = i === 0 ? fontSize * 1.4 : fontSize; // bigger first line (title)
    t.color = color;
    t.anchorX = 'left';
    t.anchorY = 'top';
    t.maxWidth = options.maxWidth || 0.35;
    var targetY = -i * lineHeight;
    t.position.y = targetY - slideDistance;
    t.material.transparent = true;
    t.material.opacity = 0;
    t.sync();
    group.add(t);
    textEntries.push({ mesh: t, targetY: targetY });
  }

  var elapsed = 0;
  var done = false;

  return {
    group: group,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var allDone = true;
      for (var i = 0; i < textEntries.length; i++) {
        var entry = textEntries[i];
        var lineStart = i * staggerDelay;
        var t = Math.max(0, elapsed - lineStart) / animDuration;
        t = Math.min(t, 1.0);
        var ease = easeOutCubic(t);
        entry.mesh.material.opacity = ease;
        entry.mesh.position.y = entry.targetY - slideDistance * (1.0 - ease);
        if (t < 1.0) allDone = false;
      }
      if (allDone) done = true;
    }
  };
}
```

### 6D. Glow/Highlight on Currently-Read Line

One line at a time pulses brighter while others are dimmed. Use for sequential highlight.

```javascript
// ─── LINE HIGHLIGHT / READING FOCUS ─────────────────────────────────────
// Highlights one line at a time. Call setActiveLine(index) to change focus.
// Budget: 0 extra draw calls (modifies troika text colors)

function createLineHighlighter(textMeshes, dimColor, brightColor) {
  dimColor = dimColor || 0x888888;
  brightColor = brightColor || 0xffffff;
  var activeLine = -1;
  var dimCol = new THREE.Color(dimColor);
  var brightCol = new THREE.Color(brightColor);
  var currentColors = [];

  for (var i = 0; i < textMeshes.length; i++) {
    currentColors.push(new THREE.Color(dimColor));
    textMeshes[i].color = dimColor;
    textMeshes[i].sync();
  }

  return {
    setActiveLine: function(index) {
      activeLine = index;
    },
    tick: function(dt) {
      var speed = 8; // color transition speed
      for (var i = 0; i < textMeshes.length; i++) {
        var target = (i === activeLine) ? brightCol : dimCol;
        currentColors[i].lerp(target, Math.min(dt * speed, 1));
        textMeshes[i].color = currentColors[i].getHex();
        // Note: troika text color change does NOT require re-sync
      }
    }
  };
}
```

### 6E. Number Counter Animation (For Stats)

Animates a number counting up from 0 to a target value. Uses a single troika Text.

```javascript
// ─── NUMBER COUNTER ANIMATION ───────────────────────────────────────────
// Counts from startVal to endVal over duration.
// Budget: 1 draw call (troika Text)

function createNumberCounter(options) {
  var TText = troika_three_text.Text;
  var startVal = options.startVal || 0;
  var endVal = options.endVal || 100;
  var duration = options.duration || 1.0;
  var prefix = options.prefix || '';
  var suffix = options.suffix || '';
  var decimals = options.decimals || 0;
  var fontSize = options.fontSize || 0.02;
  var color = options.color || 0x00ddff;

  var textMesh = new TText();
  textMesh.text = prefix + startVal.toFixed(decimals) + suffix;
  textMesh.fontSize = fontSize;
  textMesh.color = color;
  textMesh.anchorX = options.anchorX || 'center';
  textMesh.anchorY = options.anchorY || 'middle';
  textMesh.sync();

  var elapsed = 0;
  var done = false;
  var lastDisplayed = '';

  return {
    mesh: textMesh,
    done: function() { return done; },
    tick: function(dt) {
      if (done) return;
      elapsed += dt;
      var t = Math.min(elapsed / duration, 1.0);
      var ease = easeOutCubic(t);
      var val = startVal + (endVal - startVal) * ease;
      var display = prefix + val.toFixed(decimals) + suffix;
      // Only sync if text actually changed (avoid excessive syncs)
      if (display !== lastDisplayed) {
        textMesh.text = display;
        textMesh.sync();
        lastDisplayed = display;
      }
      if (t >= 1.0) done = true;
    }
  };
}
```

---

## 7. Ambient Card Effects (Subtle Idle Animations)

### 7A. Gentle Floating/Bobbing

The card slowly bobs up and down. Pure transform, 0 draw calls.

```javascript
// ─── GENTLE FLOATING BOB ────────────────────────────────────────────────
function floatingBob(cardGroup, amplitude, frequency) {
  amplitude = amplitude || 0.005; // meters
  frequency = frequency || 0.8;   // Hz
  var baseY = cardGroup.position.y;
  var time = 0;

  return {
    tick: function(dt) {
      time += dt;
      cardGroup.position.y = baseY + Math.sin(time * frequency * Math.PI * 2) * amplitude;
    },
    // Call if card repositions
    updateBaseY: function(y) { baseY = y; }
  };
}
```

### 7B. Slow Rotation Oscillation

Card gently rocks side to side on Y axis. 0 draw calls.

```javascript
// ─── SLOW ROTATION OSCILLATION ──────────────────────────────────────────
function rotationOscillation(cardGroup, maxAngle, frequency) {
  maxAngle = maxAngle || 0.015; // radians (~1 degree)
  frequency = frequency || 0.4;
  var time = 0;

  return {
    tick: function(dt) {
      time += dt;
      cardGroup.rotation.y = Math.sin(time * frequency * Math.PI * 2) * maxAngle;
    }
  };
}
```

### 7C. Breathing Glow (Subtle Pulse)

The edge glow or card material brightness subtly pulses. Works with any ShaderMaterial that has a uTime uniform. 0 extra draw calls.

```javascript
// ─── BREATHING GLOW ─────────────────────────────────────────────────────
// Modulates a "glow intensity" uniform on any ShaderMaterial.
// If using the matte glow panel (3G), this is already built in via uTime.
// For custom materials, add a uGlow uniform and multiply your edge color by it.

// Generic approach: modulate opacity of the edge mesh
function breathingGlow(edgeMaterial, minOpacity, maxOpacity, frequency) {
  minOpacity = minOpacity || 0.4;
  maxOpacity = maxOpacity || 0.9;
  frequency = frequency || 1.5;
  var time = 0;

  return {
    tick: function(dt) {
      time += dt;
      var t = Math.sin(time * frequency * Math.PI * 2) * 0.5 + 0.5;
      edgeMaterial.opacity = minOpacity + (maxOpacity - minOpacity) * t;
    }
  };
}
```

### 7D. Particle Dust Drifting Around Card

Tiny particles slowly drift past the card for an ambient space feel. 1 draw call (Points).

```javascript
// ─── AMBIENT PARTICLE DUST ──────────────────────────────────────────────
// Tiny particles drift slowly around the card area.
// Budget: 1 draw call (Points), 50 particles
// sizeAttenuation: false for Quest safety

function createAmbientDust(width, height, count, color) {
  width = width || 0.5;
  height = height || 0.4;
  count = count || 50;
  color = color || 0x445566;

  var positions = new Float32Array(count * 3);
  var speeds = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * width * 1.5;
    positions[i * 3 + 1] = (Math.random() - 0.5) * height * 1.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    speeds[i] = 0.005 + Math.random() * 0.01;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  var mat = new THREE.PointsMaterial({
    color: color,
    size: 1.5,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });

  var points = new THREE.Points(geo, mat);

  return {
    points: points,
    tick: function(dt) {
      var pos = geo.attributes.position.array;
      var halfW = width * 0.75;
      var halfH = height * 0.75;
      for (var i = 0; i < count; i++) {
        // Slow upward drift
        pos[i * 3 + 1] += speeds[i] * dt;
        // Slight horizontal wobble
        pos[i * 3] += Math.sin(pos[i * 3 + 1] * 20 + i) * 0.0001;
        // Wrap around
        if (pos[i * 3 + 1] > halfH) {
          pos[i * 3 + 1] = -halfH;
          pos[i * 3] = (Math.random() - 0.5) * width * 1.5;
        }
      }
      geo.attributes.position.needsUpdate = true;
    }
  };
}
```

### 7E. Light Reflection Sweep Across Surface

A bright highlight sweeps diagonally across the card surface periodically. 0 extra draw calls if integrated into card shader, +1 if overlay.

```javascript
// ─── LIGHT SWEEP ACROSS CARD ────────────────────────────────────────────
// A diagonal light band sweeps across the card every few seconds.
// Budget: 0 extra draw calls (integrate into card shader)
// Add these uniforms + code to your card's ShaderMaterial:

// GLSL to add to your card fragment shader:
/*
  // Add uniform: uSweepTime (driven by JS, goes 0..1 then pauses)
  uniform float uSweepTime;

  // In main():
  // Diagonal sweep line
  float sweepPos = uSweepTime * 3.0 - 1.0; // -1 to 2 range
  float sweep = smoothstep(sweepPos - 0.15, sweepPos, vUv.x + vUv.y * 0.5)
              - smoothstep(sweepPos, sweepPos + 0.15, vUv.x + vUv.y * 0.5);
  col += vec3(0.08, 0.1, 0.15) * sweep;
*/

// JS driver:
function createLightSweep(cardMaterial, interval) {
  interval = interval || 4.0; // seconds between sweeps
  var time = 0;
  var sweeping = false;
  var sweepElapsed = 0;
  var sweepDuration = 0.8;

  // If cardMaterial is a ShaderMaterial, add the uniform
  if (cardMaterial.uniforms) {
    cardMaterial.uniforms.uSweepTime = { value: -1.0 };
  }

  return {
    tick: function(dt) {
      time += dt;
      if (!sweeping) {
        if (time >= interval) {
          sweeping = true;
          sweepElapsed = 0;
          time = 0;
        }
        if (cardMaterial.uniforms) {
          cardMaterial.uniforms.uSweepTime.value = -1.0;
        }
      } else {
        sweepElapsed += dt;
        var t = sweepElapsed / sweepDuration;
        if (cardMaterial.uniforms) {
          cardMaterial.uniforms.uSweepTime.value = t;
        }
        if (t >= 1.0) {
          sweeping = false;
        }
      }
    }
  };
}

// OPTION B: Standalone overlay plane (1 draw call)
function createLightSweepOverlay(width, height, interval) {
  width = width || 0.4;
  height = height || 0.3;
  interval = interval || 4.0;
  var geo = new THREE.PlaneGeometry(width, height);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uSweep: { value: -1.0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSweep;
      varying vec2 vUv;
      void main() {
        if (uSweep < 0.0) discard;
        float sweepPos = uSweep * 3.0 - 1.0;
        float diag = vUv.x + vUv.y * 0.5;
        float band = smoothstep(sweepPos - 0.12, sweepPos, diag)
                   - smoothstep(sweepPos, sweepPos + 0.12, diag);
        if (band < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, band * 0.12);
      }
    `
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0.003;

  var time = 0;
  var sweeping = false;
  var sweepElapsed = 0;
  var sweepDuration = 0.8;

  return {
    mesh: mesh,
    tick: function(dt) {
      time += dt;
      if (!sweeping) {
        if (time >= interval) {
          sweeping = true;
          sweepElapsed = 0;
          time = 0;
        }
        mat.uniforms.uSweep.value = -1.0;
      } else {
        sweepElapsed += dt;
        mat.uniforms.uSweep.value = sweepElapsed / sweepDuration;
        if (sweepElapsed >= sweepDuration) sweeping = false;
      }
    }
  };
}
```

### 7F. Subtle Parallax on Card Layers Based on Head Position

In VR, the card can have layered elements (background, mid, foreground) that shift slightly based on the camera/head position, creating depth. 0 extra draw calls (just position offsets).

```javascript
// ─── PARALLAX CARD LAYERS ───────────────────────────────────────────────
// Different Z-depth layers shift slightly based on camera position.
// Budget: 0 extra draw calls
//
// Set up your card with layers at different Z offsets:
//   background: z = 0
//   text:       z = 0.002
//   border:     z = 0.004
// Then use this to add subtle lateral offset based on head direction.

function createParallaxLayers(cardGroup, layers, strength) {
  // layers: array of { mesh: THREE.Object3D, depth: number (0-1) }
  // depth 0 = background (no movement), 1 = foreground (max movement)
  strength = strength || 0.008; // max offset in meters
  var cardWorldPos = new THREE.Vector3();
  var cameraWorldPos = new THREE.Vector3();
  var offset = new THREE.Vector3();

  return {
    tick: function(dt, camera) {
      cardGroup.getWorldPosition(cardWorldPos);
      camera.getWorldPosition(cameraWorldPos);

      // Direction from card to camera, projected onto card plane
      offset.copy(cameraWorldPos).sub(cardWorldPos);
      // We only care about x and y offset relative to the card
      // Transform to card's local space
      var localOffset = cardGroup.worldToLocal(cameraWorldPos.clone());

      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var shift = layer.depth * strength;
        // Offset is opposite to viewing angle (parallax effect)
        layer.mesh.position.x = -localOffset.x * shift;
        layer.mesh.position.y = -localOffset.y * shift;
      }
    }
  };
}

// Usage example:
/*
var parallax = createParallaxLayers(cardGroup, [
  { mesh: backgroundPlane, depth: 0 },
  { mesh: titleText,       depth: 0.3 },
  { mesh: bodyText,        depth: 0.5 },
  { mesh: borderMesh,      depth: 0.8 },
  { mesh: buttonGroup,     depth: 1.0 }
], 0.006);

// In animate loop:
parallax.tick(dt, camera);
*/
```

---

## Complete Integration Example

Putting it all together: a full info card with holographic flicker entrance, frosted glass material, animated shimmer border, slide-up text, hover-glow buttons, and ambient floating.

```javascript
// ─── FULL INFO CARD SYSTEM ──────────────────────────────────────────────
// Total budget: ~8-10 draw calls per card
//   Card background: 1
//   Border: 1
//   Title text: 1
//   Body text: 1-3 (per line)
//   Buttons: 1-2
//   Ambient dust: 1
//   Scan line overlay: 1

function createInfoCardSystem(options) {
  var width = options.width || 0.4;
  var height = options.height || 0.3;
  var title = options.title || 'Topic Title';
  var description = options.description || 'Description text goes here.';
  var buttons = options.buttons || ['Open', 'Close'];

  var TText = troika_three_text.Text;
  var cardGroup = new THREE.Group();

  // 1. Card background (frosted glass)
  var bgGeo = new THREE.PlaneGeometry(width, height);
  var bgMat = createFrostedGlassMaterial();
  var bgMesh = new THREE.Mesh(bgGeo, bgMat);
  cardGroup.add(bgMesh);

  // 2. Shimmer border
  var border = createShimmerBorder(width, height, 0.004, 0x00ddff, 0.25);
  cardGroup.add(border.mesh);

  // 3. Scan line overlay
  var scanOverlay = createScanLineOverlay(width, height);
  cardGroup.add(scanOverlay.mesh);

  // 4. Title text (troika)
  var titleMesh = new TText();
  titleMesh.text = title;
  titleMesh.fontSize = 0.024;
  titleMesh.color = 0xffffff;
  titleMesh.anchorX = 'left';
  titleMesh.anchorY = 'top';
  titleMesh.maxWidth = width - 0.04;
  titleMesh.position.set(-width / 2 + 0.02, height / 2 - 0.02, 0.003);
  titleMesh.material.transparent = true;
  titleMesh.material.opacity = 0;
  titleMesh.sync();
  cardGroup.add(titleMesh);

  // 5. Description text (troika)
  var descMesh = new TText();
  descMesh.text = description;
  descMesh.fontSize = 0.015;
  descMesh.color = 0xcccccc;
  descMesh.anchorX = 'left';
  descMesh.anchorY = 'top';
  descMesh.maxWidth = width - 0.04;
  descMesh.position.set(-width / 2 + 0.02, height / 2 - 0.06, 0.003);
  descMesh.material.transparent = true;
  descMesh.material.opacity = 0;
  descMesh.sync();
  cardGroup.add(descMesh);

  // 6. Buttons
  var buttonMeshes = [];
  var buttonAnims = [];
  var buttonWidth = 0.1;
  var buttonHeight = 0.035;
  var buttonStartX = -width / 2 + 0.02;
  var buttonY = -height / 2 + 0.04;

  buttons.forEach(function(label, i) {
    var btnGeo = new THREE.PlaneGeometry(buttonWidth, buttonHeight);
    var btnAnim = createHoverGlowButtonMaterial(0x1a2a4a, 0x00ddff);
    var btnMesh = new THREE.Mesh(btnGeo, btnAnim.material);
    btnMesh.position.set(buttonStartX + i * (buttonWidth + 0.015) + buttonWidth / 2,
                         buttonY, 0.003);
    cardGroup.add(btnMesh);

    var btnLabel = new TText();
    btnLabel.text = label;
    btnLabel.fontSize = 0.014;
    btnLabel.color = 0xffffff;
    btnLabel.anchorX = 'center';
    btnLabel.anchorY = 'middle';
    btnLabel.position.set(btnMesh.position.x, buttonY, 0.005);
    btnLabel.sync();
    cardGroup.add(btnLabel);

    buttonMeshes.push(btnMesh);
    buttonAnims.push({
      hover: btnAnim,
      scale: buttonScaleBounce(btnMesh),
      flash: colorFlashOnClick(btnAnim.material, 0x00ffff)
    });
  });

  // 7. Ambient effects
  var dust = createAmbientDust(width, height, 40, 0x445566);
  cardGroup.add(dust.points);

  var bob = floatingBob(cardGroup, 0.003, 0.6);

  // 8. Entrance animation
  var entranceAnim = scaleBounceEntrance(cardGroup, 0.4);

  // Text fade-in (delayed after entrance)
  var textFadeDelay = 0.3;
  var textFadeElapsed = 0;
  var textFadeDone = false;

  // State
  var isVisible = true;
  var exitAnim = null;

  return {
    group: cardGroup,
    buttonMeshes: buttonMeshes,

    // Call every frame with deltaTime
    tick: function(dt) {
      if (!isVisible) return;

      // Entrance
      entranceAnim.tick(dt);

      // Text fade-in after entrance completes
      if (entranceAnim.done() && !textFadeDone) {
        textFadeElapsed += dt;
        if (textFadeElapsed > textFadeDelay) {
          var tt = Math.min((textFadeElapsed - textFadeDelay) / 0.4, 1.0);
          titleMesh.material.opacity = easeOutCubic(tt);
          var descT = Math.min((textFadeElapsed - textFadeDelay - 0.1) / 0.4, 1.0);
          descMesh.material.opacity = easeOutCubic(Math.max(0, descT));
          if (tt >= 1.0 && descT >= 1.0) textFadeDone = true;
        }
      }

      // Continuous effects
      bgMat.uniforms.uTime.value += dt;
      border.tick(dt);
      scanOverlay.tick(dt);
      dust.tick(dt);
      bob.tick(dt);

      // Buttons
      for (var i = 0; i < buttonAnims.length; i++) {
        buttonAnims[i].hover.tick(dt);
        buttonAnims[i].scale.tick(dt);
        buttonAnims[i].flash.tick(dt);
      }

      // Exit animation
      if (exitAnim) exitAnim.tick(dt);
    },

    // Set button hover state (call from raycaster logic)
    setButtonHover: function(index, hovered) {
      if (buttonAnims[index]) {
        buttonAnims[index].hover.setHovered(hovered);
      }
    },

    // Trigger button press
    pressButton: function(index) {
      if (buttonAnims[index]) {
        buttonAnims[index].scale.press();
        buttonAnims[index].flash.trigger();
      }
    },

    releaseButton: function(index) {
      if (buttonAnims[index]) {
        buttonAnims[index].scale.release();
      }
    },

    // Dismiss the card
    dismiss: function() {
      exitAnim = shrinkToPointExit(cardGroup, 0.3);
    },

    // Position in front of camera
    positionInFront: function(camera, distance) {
      positionCardInFrontOfCamera(cardGroup, camera, distance || 0.5);
      bob.updateBaseY(cardGroup.position.y);
    }
  };
}

// ─── USAGE IN YOUR ANIMATE LOOP ─────────────────────────────────────────
/*
// Setup:
var infoCard = createInfoCardSystem({
  title: 'Machine Learning',
  description: 'A branch of artificial intelligence focused on building systems that learn from data.',
  buttons: ['Explore', 'Related']
});
scene.add(infoCard.group);  // or galaxyGroup.add(...)
infoCard.positionInFront(camera, 0.5);

// In animate():
var dt = clock.getDelta();
infoCard.tick(dt);

// On planet select:
infoCard.positionInFront(camera);

// On button hover (from raycaster):
infoCard.setButtonHover(0, true);

// On button press:
infoCard.pressButton(0);
hapticVisualFeedback(renderer.xr.getSession(), controller);

// On dismiss:
infoCard.dismiss();
*/
```

---

## Draw Call Budget Summary

| Component | Draw Calls | Notes |
|---|---|---|
| Card background | 1 | ShaderMaterial |
| Border effect | 1 | ShaderMaterial |
| Scan overlay | 1 | Optional, can integrate into bg shader |
| Title text (troika) | 1 | SDF text |
| Body text (troika) | 1 | SDF text |
| Each button | 1 | ShaderMaterial |
| Button label (troika) | 1 | Per button |
| Ambient dust | 1 | Points |
| Entrance particles | 1 | Points, temporary |
| Exit shatter | 1 | InstancedMesh, temporary |
| **Typical total** | **~10-12** | Well within Quest 200 limit |

## Performance Notes for Quest 3

1. **Avoid simultaneous particle effects.** Entrance particles and ambient dust should not overlap (disable dust until entrance completes).
2. **Stagger troika sync() calls** 50ms apart to avoid frame spikes.
3. **Re-use materials** across multiple buttons (clone only when needed for different colors).
4. **Pool card objects.** Create the card once, update text content via `textMesh.text = newText; textMesh.sync()` instead of creating new cards.
5. **Hide cards when not visible.** Set `cardGroup.visible = false` when the card is off-screen.
6. **Max 1-2 active cards at a time.** Each card costs 10-12 draw calls.
7. **ShaderMaterial branching:** Quest GPUs handle `if/discard` fine but avoid complex loop-heavy shaders in fragment. Keep loop counts under 8.
8. **No MRT/FBO chaining** for card effects. Every effect must be a single-pass forward render.
