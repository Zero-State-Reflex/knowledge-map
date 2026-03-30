# VR Gaming Mechanics for Knowledge Map Quest 3
## Complete Code Examples for Three.js WebXR

All code below is written to match the existing km-quest architecture:
- `galaxyGroup` scaled at 0.002, controllers at scene level
- Angle-based selection (not raycasting) for tiny scaled meshes
- Quest 3 GPU budget: <200 draw calls, <100k tris, no EffectComposer
- `renderer.setAnimationLoop(animate)` as sole driver
- THREE r152 global build

---

## 1. Tractor Beam / Gravity Pull

Hold trigger to lock onto a planet and pull it toward you along a glowing beam.

```javascript
// ─── Tractor Beam System ────────────────────────────────────────────────────
const _tractorState = {
  active: false,
  targetNode: null,
  beamMesh: null,
  pullSpeed: 0.02,
  maxDist: 5.0,   // meters in world space
  minDist: 0.3,
};

// Beam geometry: cylinder stretched between controller and target
const _beamGeo = new THREE.CylinderGeometry(0.003, 0.008, 1, 6, 1, true);
_beamGeo.translate(0, 0.5, 0); // pivot at base
_beamGeo.rotateX(Math.PI / 2); // point along -Z

const _beamMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime:  { value: 0 },
    uColor: { value: new THREE.Color(0xe8d89a) },
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
    void main() {
      // Pulsing energy beam — bright at edges, traveling waves
      float pulse = sin(vUv.y * 20.0 - uTime * 8.0) * 0.5 + 0.5;
      float edge = pow(abs(vUv.x - 0.5) * 2.0, 0.5);
      float alpha = (0.3 + 0.4 * pulse) * (0.5 + 0.5 * edge);
      // Fade at tip
      alpha *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
});

const _beamMesh = new THREE.Mesh(_beamGeo, _beamMat);
_beamMesh.visible = false;
_beamMesh.frustumCulled = false;
// Add to scene (not controller) so we can position in world space
scene.add(_beamMesh);

// Particles along beam (reuse a small Points object)
const _beamParticleCount = 20;
const _beamPartGeo = new THREE.BufferGeometry();
const _beamPartPositions = new Float32Array(_beamParticleCount * 3);
_beamPartGeo.setAttribute('position', new THREE.BufferAttribute(_beamPartPositions, 3));
const _beamPartMat = new THREE.PointsMaterial({
  color: 0xe8d89a,
  size: 3,
  sizeAttenuation: false, // screen-space size — safe on Quest
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});
const _beamParticles = new THREE.Points(_beamPartGeo, _beamPartMat);
_beamParticles.visible = false;
_beamParticles.frustumCulled = false;
scene.add(_beamParticles);

const _tractorOrigin = new THREE.Vector3();
const _tractorTarget = new THREE.Vector3();
const _tractorDir = new THREE.Vector3();

function startTractorBeam(controller) {
  // Use angle-based selection (same pattern as xrSelectNode)
  _xrTempMatrix.identity().extractRotation(controller.matrixWorld);
  _xrRayOrigin.setFromMatrixPosition(controller.matrixWorld);
  _xrRayDir.set(0, 0, -1).applyMatrix4(_xrTempMatrix);

  let bestNode = null;
  let bestAngle = 0.12; // 7-degree cone
  for (const n of nodes) {
    if (!n.mesh) continue;
    n.mesh.getWorldPosition(_xrNodeWorld);
    const toNode = _xrNodeWorld.clone().sub(_xrRayOrigin).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, toNode.dot(_xrRayDir))));
    if (angle < bestAngle) {
      bestAngle = angle;
      bestNode = n;
    }
  }

  if (bestNode) {
    _tractorState.active = true;
    _tractorState.targetNode = bestNode;
    _tractorState.controller = controller;
    _beamMesh.visible = true;
    _beamParticles.visible = true;

    // Haptic feedback — grab confirmation
    triggerHaptic(controller, 0.6, 100);
  }
}

function stopTractorBeam() {
  _tractorState.active = false;
  _tractorState.targetNode = null;
  _beamMesh.visible = false;
  _beamParticles.visible = false;
}

function updateTractorBeam(time) {
  if (!_tractorState.active || !_tractorState.targetNode) return;

  const controller = _tractorState.controller;
  const node = _tractorState.targetNode;

  // Controller world position
  _tractorOrigin.setFromMatrixPosition(controller.matrixWorld);

  // Node world position
  node.mesh.getWorldPosition(_tractorTarget);

  // Direction and distance
  _tractorDir.copy(_tractorTarget).sub(_tractorOrigin);
  const dist = _tractorDir.length();
  _tractorDir.normalize();

  // Pull the node toward controller (in galaxy-space coordinates)
  if (dist > _tractorState.minDist && _galaxyGroup) {
    // Convert pull direction to galaxy-group local space
    const invScale = 1.0 / XR_SCALE;
    const pullDelta = _tractorDir.clone().multiplyScalar(-_tractorState.pullSpeed);
    // Transform world-space delta into galaxy-group local space
    const invMatrix = new THREE.Matrix4().copy(_galaxyGroup.matrixWorld).invert();
    const pullLocal = pullDelta.clone().applyMatrix4(invMatrix).sub(
      new THREE.Vector3().applyMatrix4(invMatrix)
    );
    node.x += pullLocal.x;
    node.y += pullLocal.y;
    node.z += pullLocal.z;
  }

  // Update beam mesh — stretch between origin and target
  _beamMesh.position.copy(_tractorOrigin);
  _beamMesh.lookAt(_tractorTarget);
  _beamMesh.scale.set(1, 1, dist);

  // Update beam shader time
  _beamMat.uniforms.uTime.value = time;

  // Update beam particles — scatter along beam line
  const positions = _beamPartGeo.attributes.position.array;
  for (let i = 0; i < _beamParticleCount; i++) {
    const t = (i / _beamParticleCount + time * 2.0) % 1.0;
    const jitter = 0.01;
    positions[i * 3]     = _tractorOrigin.x + _tractorDir.x * dist * t + (Math.random() - 0.5) * jitter;
    positions[i * 3 + 1] = _tractorOrigin.y + _tractorDir.y * dist * t + (Math.random() - 0.5) * jitter;
    positions[i * 3 + 2] = _tractorOrigin.z + _tractorDir.z * dist * t + (Math.random() - 0.5) * jitter;
  }
  _beamPartGeo.attributes.position.needsUpdate = true;

  // Continuous light haptic while pulling
  if (Math.floor(time * 10) % 3 === 0) {
    triggerHaptic(controller, 0.15, 30);
  }
}

// Hook into existing controller events:
// On selectstart (trigger down) → startTractorBeam
// On selectend (trigger up) → stopTractorBeam
// In animate() when _inXR: updateTractorBeam(performance.now() * 0.001)
```

**Integration point in animate():**
```javascript
if (_inXR) {
  updateXRControls();
  updateTractorBeam(performance.now() * 0.001);
  // ... rest of XR updates
}
```

---

## 2. Minimap / Radar Display

A small 3D minimap attached to the left controller wrist showing planet positions and a "you are here" indicator.

```javascript
// ─── VR Minimap / Radar ─────────────────────────────────────────────────────
const MINIMAP_SCALE = 0.00004; // galaxy coords → minimap coords
const MINIMAP_SIZE = 0.08;     // 8cm radius sphere

// Minimap container — attaches to left controller
const _minimapGroup = new THREE.Group();
_minimapGroup.position.set(0, 0.1, 0.02); // above wrist
_minimapGroup.rotation.set(-0.6, 0, 0);   // tilt toward user

// Background sphere (dark, semi-transparent)
const _minimapBg = new THREE.Mesh(
  new THREE.SphereGeometry(MINIMAP_SIZE, 12, 8),
  new THREE.MeshBasicMaterial({
    color: 0x04060f,
    transparent: true,
    opacity: 0.7,
    side: THREE.BackSide,
  })
);
_minimapGroup.add(_minimapBg);

// Border ring
const _minimapRing = new THREE.Mesh(
  new THREE.TorusGeometry(MINIMAP_SIZE, 0.002, 6, 24),
  new THREE.MeshBasicMaterial({ color: 0xe8d89a, transparent: true, opacity: 0.4 })
);
_minimapGroup.add(_minimapRing);

// "You are here" indicator — small bright sphere
const _youAreHere = new THREE.Mesh(
  new THREE.SphereGeometry(0.004, 6, 4),
  new THREE.MeshBasicMaterial({ color: 0xff4444 })
);
_minimapGroup.add(_youAreHere);

// Planet dots — use a single Points object (1 draw call)
const _minimapDotCount = 212; // max node count
const _minimapPositions = new Float32Array(_minimapDotCount * 3);
const _minimapColors = new Float32Array(_minimapDotCount * 3);
const _minimapDotGeo = new THREE.BufferGeometry();
_minimapDotGeo.setAttribute('position', new THREE.BufferAttribute(_minimapPositions, 3));
_minimapDotGeo.setAttribute('color', new THREE.BufferAttribute(_minimapColors, 3));

const _minimapDots = new THREE.Points(_minimapDotGeo, new THREE.PointsMaterial({
  size: 2,
  sizeAttenuation: false, // screen-space pixels
  vertexColors: true,
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
}));
_minimapGroup.add(_minimapDots);

// Add to left controller at init time (safe for Quest)
xrController0.add(_minimapGroup);

function updateMinimap() {
  if (!_galaxyGroup) return;

  // Update planet dot positions (relative to minimap center)
  const galaxyPos = _galaxyGroup.position;
  const galaxyScale = _galaxyGroup.scale.x;

  for (let i = 0; i < nodes.length && i < _minimapDotCount; i++) {
    const n = nodes[i];
    // Planet position in minimap space
    _minimapPositions[i * 3]     = n.x * MINIMAP_SCALE;
    _minimapPositions[i * 3 + 1] = n.y * MINIMAP_SCALE;
    _minimapPositions[i * 3 + 2] = n.z * MINIMAP_SCALE;

    // Color from domain
    const domColor = new THREE.Color(DOMAINS[n.domain]?.color || '#888888');
    _minimapColors[i * 3]     = domColor.r;
    _minimapColors[i * 3 + 1] = domColor.g;
    _minimapColors[i * 3 + 2] = domColor.b;
  }
  // Clear unused slots
  for (let i = nodes.length; i < _minimapDotCount; i++) {
    _minimapPositions[i * 3] = _minimapPositions[i * 3 + 1] = _minimapPositions[i * 3 + 2] = 999;
  }
  _minimapDotGeo.attributes.position.needsUpdate = true;
  _minimapDotGeo.attributes.color.needsUpdate = true;

  // "You are here" — inverse of galaxyGroup position tells us where user is in galaxy space
  // User is at world origin (0, 1.6, 0 roughly), galaxy is shifted by galaxyGroup.position
  // So user's position in galaxy-space is: -galaxyGroup.position / galaxyScale
  const userGalaxyX = -galaxyPos.x / galaxyScale;
  const userGalaxyY = (-galaxyPos.y + 1.5) / galaxyScale; // approximate head height
  const userGalaxyZ = -galaxyPos.z / galaxyScale;

  _youAreHere.position.set(
    userGalaxyX * MINIMAP_SCALE,
    userGalaxyY * MINIMAP_SCALE,
    userGalaxyZ * MINIMAP_SCALE
  );

  // Clamp "you are here" to minimap bounds
  const maxR = MINIMAP_SIZE * 0.9;
  if (_youAreHere.position.length() > maxR) {
    _youAreHere.position.normalize().multiplyScalar(maxR);
  }

  // Pulse the "you are here" dot
  const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.005);
  _youAreHere.material.opacity = pulse;
}

// Call in animate() during XR:
// if (_inXR) updateMinimap();
```

**Draw call cost:** 3 (background sphere + ring + points). Well within budget.

---

## 3. Speed Lines / Motion Blur (No Post-Processing)

Mesh-based speed lines using stretched cylinders along the travel direction. Zero post-processing.

```javascript
// ─── Speed Lines System ─────────────────────────────────────────────────────
const SPEED_LINE_COUNT = 24;
const SPEED_LINE_THRESHOLD = 0.005; // minimum movement per frame to trigger

const _speedLineGroup = new THREE.Group();
scene.add(_speedLineGroup);

// Pre-create speed line meshes (all share one geometry + material = instanced draw)
const _speedLineGeo = new THREE.CylinderGeometry(0.001, 0.0005, 1, 3, 1);
_speedLineGeo.translate(0, 0.5, 0); // pivot at base

const _speedLineMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uOpacity: { value: 0 },
  },
  vertexShader: `
    varying float vY;
    void main() {
      vY = uv.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uOpacity;
    varying float vY;
    void main() {
      // Fade from bright at base to transparent at tip
      float alpha = uOpacity * (1.0 - vY) * smoothstep(0.0, 0.1, vY);
      gl_FragColor = vec4(0.9, 0.85, 0.6, alpha);
    }
  `,
});

const _speedLines = [];
for (let i = 0; i < SPEED_LINE_COUNT; i++) {
  const mesh = new THREE.Mesh(_speedLineGeo, _speedLineMat.clone());
  mesh.visible = false;
  mesh.frustumCulled = false;
  _speedLineGroup.add(mesh);
  _speedLines.push({
    mesh,
    offset: new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.5
    ),
    length: 0.3 + Math.random() * 0.7,
    life: 0,
  });
}

const _prevCamPos = new THREE.Vector3();
const _camVelocity = new THREE.Vector3();
const _moveDir = new THREE.Vector3();

let _speedLinesInitialized = false;

function updateSpeedLines() {
  if (!_galaxyGroup) return;

  // Track galaxy group movement (since user is stationary, galaxy moves)
  const currentPos = _galaxyGroup.position;

  if (!_speedLinesInitialized) {
    _prevCamPos.copy(currentPos);
    _speedLinesInitialized = true;
    return;
  }

  _camVelocity.subVectors(currentPos, _prevCamPos);
  const speed = _camVelocity.length();
  _prevCamPos.copy(currentPos);

  // Movement direction (inverted — galaxy moves opposite to perceived travel)
  _moveDir.copy(_camVelocity).normalize().negate();

  const active = speed > SPEED_LINE_THRESHOLD;
  const targetOpacity = active ? Math.min(speed * 20, 0.8) : 0;

  for (let i = 0; i < SPEED_LINE_COUNT; i++) {
    const line = _speedLines[i];

    if (active) {
      line.life += 0.05;
      line.mesh.visible = true;

      // Position lines around the user in a cylinder along movement direction
      const camera = renderer.xr.getCamera();
      const headPos = new THREE.Vector3();
      headPos.setFromMatrixPosition(camera.matrixWorld);

      // Offset perpendicular to movement direction
      const right = new THREE.Vector3(1, 0, 0);
      const up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(_moveDir.dot(up)) > 0.9) right.set(0, 0, 1);
      right.crossVectors(_moveDir, up).normalize();
      up.crossVectors(right, _moveDir).normalize();

      const angle = (i / SPEED_LINE_COUNT) * Math.PI * 2 + line.life * 0.5;
      const radius = 0.5 + line.offset.x * 0.3;

      line.mesh.position.set(
        headPos.x + right.x * Math.cos(angle) * radius + up.x * Math.sin(angle) * radius + _moveDir.x * (line.offset.z - 1),
        headPos.y + right.y * Math.cos(angle) * radius + up.y * Math.sin(angle) * radius + _moveDir.y * (line.offset.z - 1),
        headPos.z + right.z * Math.cos(angle) * radius + up.z * Math.sin(angle) * radius + _moveDir.z * (line.offset.z - 1),
      );

      // Orient along movement direction
      line.mesh.lookAt(
        line.mesh.position.x + _moveDir.x,
        line.mesh.position.y + _moveDir.y,
        line.mesh.position.z + _moveDir.z
      );

      // Stretch based on speed
      const stretch = line.length * Math.min(speed * 30, 3.0);
      line.mesh.scale.set(1, 1, stretch);

      // Update opacity
      line.mesh.material.uniforms.uOpacity.value +=
        (targetOpacity - line.mesh.material.uniforms.uOpacity.value) * 0.1;

    } else {
      // Fade out
      line.mesh.material.uniforms.uOpacity.value *= 0.9;
      if (line.mesh.material.uniforms.uOpacity.value < 0.01) {
        line.mesh.visible = false;
      }
    }
  }
}

// In animate() when _inXR: updateSpeedLines();
```

**Draw call cost:** Up to 24 (could reduce to 1 with InstancedMesh). Only visible during fast movement.

**InstancedMesh optimization (1 draw call):**
```javascript
// Replace individual meshes with InstancedMesh for 1 draw call
const _speedLineMesh = new THREE.InstancedMesh(_speedLineGeo, _speedLineMat, SPEED_LINE_COUNT);
_speedLineMesh.frustumCulled = false;
_speedLineMesh.visible = false;
scene.add(_speedLineMesh);

const _speedLineDummy = new THREE.Object3D();

function updateSpeedLinesInstanced() {
  // ... same velocity calculation ...
  for (let i = 0; i < SPEED_LINE_COUNT; i++) {
    _speedLineDummy.position.set(/*...*/);
    _speedLineDummy.lookAt(/*...*/);
    _speedLineDummy.scale.set(1, 1, stretch);
    _speedLineDummy.updateMatrix();
    _speedLineMesh.setMatrixAt(i, _speedLineDummy.matrix);
  }
  _speedLineMesh.instanceMatrix.needsUpdate = true;
}
```

---

## 4. Object Highlighting / Selection Feedback (No Post-Processing)

Fresnel-based glow shell rendered on a slightly larger duplicate mesh, backside only.

```javascript
// ─── Fresnel Selection Highlight ────────────────────────────────────────────
// This matches the existing "Fresnel atmosphere meshes (backside shader)" pattern in CLAUDE.md

const _highlightMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.BackSide,
  uniforms: {
    uColor:     { value: new THREE.Color(0xe8d89a) },
    uIntensity: { value: 0.0 },  // animate 0→1 on hover
    uTime:      { value: 0 },
    uPower:     { value: 3.0 },   // fresnel exponent (higher = tighter rim)
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uPower;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec2 vUv;
    void main() {
      // Fresnel: bright at edges (where normal perpendicular to view)
      float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
      fresnel = pow(fresnel, uPower);

      // Animated pulse
      float pulse = 0.8 + 0.2 * sin(uTime * 3.0);

      // Scanline effect (optional — subtle horizontal bands)
      float scanline = 0.9 + 0.1 * sin(vUv.y * 40.0 + uTime * 2.0);

      float alpha = fresnel * uIntensity * pulse * scanline;
      gl_FragColor = vec4(uColor, alpha * 0.8);
    }
  `,
});

// Shared highlight geometry (slightly larger than planet sphere)
const _highlightGeo = new THREE.SphereGeometry(1.15, 16, 12); // scale per-planet

let _highlightMesh = null;
let _highlightTarget = null;
let _highlightIntensity = 0;

function createHighlightMesh() {
  _highlightMesh = new THREE.Mesh(_highlightGeo, _highlightMat);
  _highlightMesh.visible = false;
  _highlightMesh.frustumCulled = false;
  // Add inside galaxyGroup so it scales with planets
  return _highlightMesh;
}

// Call once during setup, add to galaxyGroup (or scene before session moves everything)
const highlightMesh = createHighlightMesh();
scene.add(highlightMesh); // will get moved into galaxyGroup at sessionstart

function updateHighlight(time, hoveredNode) {
  if (!_highlightMesh) return;

  _highlightMat.uniforms.uTime.value = time;

  if (hoveredNode && hoveredNode.mesh) {
    _highlightTarget = hoveredNode;
    _highlightMesh.visible = true;

    // Match planet position and scale
    _highlightMesh.position.copy(hoveredNode.mesh.position);
    const planetRadius = hoveredNode.size || 10;
    const scale = planetRadius * 1.3; // slightly larger than planet
    _highlightMesh.scale.setScalar(scale);

    // Animate intensity in
    _highlightIntensity = Math.min(1, _highlightIntensity + 0.08);
  } else {
    // Animate intensity out
    _highlightIntensity = Math.max(0, _highlightIntensity - 0.05);
    if (_highlightIntensity <= 0) {
      _highlightMesh.visible = false;
      _highlightTarget = null;
    }
  }

  _highlightMat.uniforms.uIntensity.value = _highlightIntensity;
}

// ─── Alternate: Scaled Duplicate Outline (even simpler) ─────────────────────
// For a solid outline instead of fresnel glow:
function createOutlineMesh(originalMesh, color, thickness) {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: color || 0xe8d89a,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.5,
  });
  const outline = new THREE.Mesh(originalMesh.geometry, outlineMat);
  outline.scale.multiplyScalar(1.0 + thickness);
  originalMesh.add(outline); // child of original, auto-follows
  return outline;
}
```

**Draw call cost:** 1 per highlighted object. Only active during hover.

---

## 5. Haptic Feedback Patterns

Controller vibration via the WebXR Gamepad API on Quest 3.

```javascript
// ─── Haptic Feedback System ─────────────────────────────────────────────────

/**
 * Trigger a haptic pulse on a controller.
 * @param {THREE.XRController|object} controller - The XR controller or inputSource
 * @param {number} intensity - 0.0 to 1.0
 * @param {number} duration - milliseconds
 */
function triggerHaptic(controller, intensity, duration) {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;

    // Match controller to input source by checking if this is the right one
    // Method 1: Use hapticActuators (older API, still works on Quest)
    if (source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
      source.gamepad.hapticActuators[0].pulse(intensity, duration);
    }

    // Method 2: Use vibrationActuator (newer Gamepad API)
    if (source.gamepad.vibrationActuator) {
      source.gamepad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: duration,
        weakMagnitude: intensity * 0.5,
        strongMagnitude: intensity,
      });
    }
  }
}

/**
 * Trigger haptic on a specific hand.
 * @param {'left'|'right'} hand
 * @param {number} intensity
 * @param {number} duration
 */
function triggerHapticHand(hand, intensity, duration) {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad || source.handedness !== hand) continue;
    if (source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
      source.gamepad.hapticActuators[0].pulse(intensity, duration);
    }
  }
}

// ─── Haptic Patterns ────────────────────────────────────────────────────────

const HapticPatterns = {
  // Light tap on hover — barely perceptible
  hover: (hand) => {
    triggerHapticHand(hand, 0.1, 30);
  },

  // Firm click on select
  select: (hand) => {
    triggerHapticHand(hand, 0.8, 80);
  },

  // Double pulse on zoom-to-planet
  zoomTo: (hand) => {
    triggerHapticHand(hand, 0.5, 60);
    setTimeout(() => triggerHapticHand(hand, 0.7, 100), 120);
  },

  // Gentle rumble while holding tractor beam
  tractorHold: (hand) => {
    triggerHapticHand(hand, 0.15, 50);
  },

  // Sharp snap on teleport arrival
  teleportLand: (hand) => {
    triggerHapticHand(hand, 1.0, 150);
  },

  // Rising pulse sequence — entering a domain cluster
  enterDomain: async (hand) => {
    for (let i = 0; i < 4; i++) {
      triggerHapticHand(hand, 0.2 + i * 0.2, 40);
      await new Promise(r => setTimeout(r, 80));
    }
  },

  // Heartbeat — near the black hole
  blackHoleProximity: async (hand) => {
    triggerHapticHand(hand, 0.6, 100);
    await new Promise(r => setTimeout(r, 150));
    triggerHapticHand(hand, 0.3, 60);
    await new Promise(r => setTimeout(r, 400));
  },

  // Error / boundary — hit edge of map
  boundary: (hand) => {
    triggerHapticHand(hand, 0.4, 200);
  },

  // Slow-mo engage — squeeze grip for bullet time
  slowMoEngage: async (hand) => {
    for (let i = 3; i >= 0; i--) {
      triggerHapticHand(hand, 0.3 + i * 0.15, 60 + i * 20);
      await new Promise(r => setTimeout(r, 100 + i * 30));
    }
  },
};

// ─── Integration Examples ───────────────────────────────────────────────────

// In xrSelectNode(), after finding bestNode:
// HapticPatterns.select('right');

// In the angle-based hover detection (every N frames):
// if (hoveredNode !== prevHoveredNode) HapticPatterns.hover('right');

// In tractor beam update loop:
// HapticPatterns.tractorHold('right');

// In teleport landing:
// HapticPatterns.teleportLand('left');
```

**Quest 3 specifics:**
- `hapticActuators[0].pulse(intensity, duration)` is the reliable path
- `vibrationActuator.playEffect('dual-rumble', ...)` works on Quest 3 browser
- Max intensity is 1.0, max useful duration ~500ms
- Don't spam — space pulses at least 30ms apart or they stack

---

## 6. Spatial Audio Positioning

Sound sources attached to planets using Three.js PositionalAudio and Web Audio API PannerNode.

```javascript
// ─── Spatial Audio System ───────────────────────────────────────────────────
// Builds on the existing audioCtx in the project

// Create AudioListener and attach to camera
const _audioListener = new THREE.AudioListener();
camera.add(_audioListener);

// Domain ambient tones — each domain has a unique frequency/character
const DOMAIN_TONES = {
  "Formal Sciences":          { freq: 110,  type: 'sine',     detune: 0   },
  "Physical Sciences":        { freq: 82.4, type: 'sawtooth', detune: -5  },
  "Earth & Space":            { freq: 73.4, type: 'sine',     detune: 3   },
  "Life Sciences":            { freq: 98,   type: 'triangle', detune: 0   },
  "Chemistry":                { freq: 130.8,type: 'sine',     detune: 7   },
  "Medicine & Health":        { freq: 92.5, type: 'triangle', detune: -3  },
  "Social Sciences":          { freq: 123.5,type: 'sine',     detune: 5   },
  "Humanities":               { freq: 87.3, type: 'sine',     detune: 0   },
  "Arts & Design":            { freq: 146.8,type: 'triangle', detune: -7  },
  "Engineering & Tech":       { freq: 77.8, type: 'sawtooth', detune: 0   },
  "Interdisciplinary":        { freq: 103.8,type: 'sine',     detune: 4   },
  "Esoteric & Occult":        { freq: 65.4, type: 'sine',     detune: -12 },
  "Contemplative Traditions": { freq: 69.3, type: 'sine',     detune: 0   },
  "Indigenous & Traditional": { freq: 82.4, type: 'triangle', detune: 8   },
  "Consciousness & Fringe":   { freq: 55,   type: 'sine',     detune: -5  },
};

// Spatial audio for the top N largest planets (budget: ~15 audio sources)
const MAX_SPATIAL_SOURCES = 15;
const _spatialSources = [];

function initSpatialAudio() {
  // Sort nodes by size descending, take top N
  const topNodes = [...nodes].sort((a, b) => b.size - a.size).slice(0, MAX_SPATIAL_SOURCES);

  for (const node of topNodes) {
    const tone = DOMAIN_TONES[node.domain] || DOMAIN_TONES["Interdisciplinary"];

    // Create PositionalAudio (wraps PannerNode)
    const sound = new THREE.PositionalAudio(_audioListener);

    // Create oscillator as source
    const ctx = _audioListener.context;
    const osc = ctx.createOscillator();
    osc.type = tone.type;
    osc.frequency.value = tone.freq;
    osc.detune.value = tone.detune + (Math.random() - 0.5) * 10;

    // Low-pass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300; // keep it sub-bass to mid-low
    filter.Q.value = 1.0;

    // Gain (very quiet — ambient, not prominent)
    const gain = ctx.createGain();
    gain.gain.value = 0.03; // subtle

    // Connect: osc → filter → gain → positionalAudio.gain (then to panner internally)
    osc.connect(filter);
    filter.connect(gain);

    // Set the audio node on the PositionalAudio
    sound.setNodeSource(gain);

    // Configure spatial properties
    sound.setRefDistance(0.5);      // distance at full volume (meters)
    sound.setRolloffFactor(2.0);   // how fast it fades
    sound.setDistanceModel('exponential');
    sound.setMaxDistance(5.0);     // beyond this, silent
    sound.panner.panningModel = 'HRTF'; // head-related transfer function

    // Attach to the planet mesh
    if (node.mesh) {
      node.mesh.add(sound);
    }

    osc.start();

    _spatialSources.push({ node, sound, osc, gain, filter });
  }
}

// Call after nodes and meshes are created, and on first user gesture:
// initSpatialAudio();

// ─── Alternative: Raw Web Audio API (if THREE.PositionalAudio not available) ──
function createSpatialToneRaw(audioCtx, position, frequency, type) {
  const osc = audioCtx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.value = frequency;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 250;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.02;

  const panner = audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'exponential';
  panner.refDistance = 1;
  panner.maxDistance = 10;
  panner.rolloffFactor = 2;
  panner.positionX.value = position.x;
  panner.positionY.value = position.y;
  panner.positionZ.value = position.z;

  osc.connect(filter).connect(gain).connect(panner).connect(audioCtx.destination);
  osc.start();

  return { osc, panner, gain };
}

// Update panner positions each frame (if planets move):
function updateSpatialAudioPositions() {
  for (const src of _spatialSources) {
    if (src.node.mesh && src.sound.panner) {
      const wp = new THREE.Vector3();
      src.node.mesh.getWorldPosition(wp);
      src.sound.panner.positionX.value = wp.x;
      src.sound.panner.positionY.value = wp.y;
      src.sound.panner.positionZ.value = wp.z;
    }
  }
}

// ─── Proximity Volume Boost ─────────────────────────────────────────────────
// When user is near a planet, boost its volume for a "discovery" feeling
function updateSpatialProximity() {
  if (!_galaxyGroup) return;
  const headPos = new THREE.Vector3();
  const camera = renderer.xr.getCamera();
  headPos.setFromMatrixPosition(camera.matrixWorld);

  for (const src of _spatialSources) {
    if (!src.node.mesh) continue;
    const wp = new THREE.Vector3();
    src.node.mesh.getWorldPosition(wp);
    const dist = headPos.distanceTo(wp);

    // Boost volume when very close (< 0.3m)
    const proximity = Math.max(0, 1 - dist / 0.3);
    const targetGain = 0.03 + proximity * 0.15;
    src.gain.gain.linearRampToValueAtTime(targetGain, _audioListener.context.currentTime + 0.1);
  }
}
```

**Audio budget:** 15 oscillators + panners is fine for Quest 3 browser. HRTF panning model gives best spatial immersion.

---

## 7. Teleport Locomotion

Parabolic arc from controller, land on target position, smooth transition.

```javascript
// ─── Teleport Locomotion System ─────────────────────────────────────────────
// Uses thumbstick forward press to show arc, release to teleport

const _teleport = {
  active: false,
  arcPoints: [],
  landingValid: false,
  landingPos: new THREE.Vector3(),
  transitioning: false,
  transitionStart: null,
  transitionFrom: new THREE.Vector3(),
  transitionTo: new THREE.Vector3(),
  transitionDuration: 300, // ms
};

// Arc visualization — TubeGeometry updated each frame (or simpler: Line)
const ARC_SEGMENTS = 30;
const _arcPositions = new Float32Array(ARC_SEGMENTS * 3);
const _arcGeo = new THREE.BufferGeometry();
_arcGeo.setAttribute('position', new THREE.BufferAttribute(_arcPositions, 3));
const _arcLine = new THREE.Line(_arcGeo, new THREE.LineBasicMaterial({
  color: 0xe8d89a,
  transparent: true,
  opacity: 0.6,
}));
_arcLine.visible = false;
_arcLine.frustumCulled = false;
scene.add(_arcLine);

// Landing indicator — ring on the ground
const _landingRing = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.2, 24),
  new THREE.MeshBasicMaterial({
    color: 0xe8d89a,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
);
_landingRing.rotation.x = -Math.PI / 2; // flat on ground
_landingRing.visible = false;
scene.add(_landingRing);

// Inner ring (pulsing)
const _landingDot = new THREE.Mesh(
  new THREE.RingGeometry(0, 0.08, 16),
  new THREE.MeshBasicMaterial({
    color: 0xe8d89a,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  })
);
_landingDot.rotation.x = -Math.PI / 2;
_landingRing.add(_landingDot);

/**
 * Calculate parabolic arc from controller.
 * Uses simple projectile physics: p(t) = origin + dir*v*t + 0.5*gravity*t^2
 */
function calculateTeleportArc(controller) {
  const origin = new THREE.Vector3();
  origin.setFromMatrixPosition(controller.matrixWorld);

  const dir = new THREE.Vector3(0, 0, -1);
  const rotMatrix = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
  dir.applyMatrix4(rotMatrix);

  const velocity = 4.0; // initial speed
  const gravity = new THREE.Vector3(0, -9.8, 0);
  const dt = 0.05; // time step

  const positions = _arcGeo.attributes.position.array;
  let hitGround = false;

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t = i * dt;
    const px = origin.x + dir.x * velocity * t + 0.5 * gravity.x * t * t;
    const py = origin.y + dir.y * velocity * t + 0.5 * gravity.y * t * t;
    const pz = origin.z + dir.z * velocity * t + 0.5 * gravity.z * t * t;

    positions[i * 3]     = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    // Check if hit ground plane (y = 0)
    if (py <= 0 && !hitGround) {
      positions[i * 3 + 1] = 0;
      _teleport.landingPos.set(px, 0, pz);
      _teleport.landingValid = true;
      hitGround = true;

      // Fill remaining positions with landing point
      for (let j = i + 1; j < ARC_SEGMENTS; j++) {
        positions[j * 3]     = px;
        positions[j * 3 + 1] = 0;
        positions[j * 3 + 2] = pz;
      }
      break;
    }
  }

  if (!hitGround) {
    _teleport.landingValid = false;
  }

  _arcGeo.attributes.position.needsUpdate = true;
  _arcGeo.computeBoundingSphere();

  // Update landing ring
  if (_teleport.landingValid) {
    _landingRing.visible = true;
    _landingRing.position.copy(_teleport.landingPos);
    _landingRing.position.y = 0.01; // slightly above ground

    // Pulse animation
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.005);
    _landingRing.material.opacity = 0.5 * pulse;
    _landingDot.material.opacity = 0.3 * pulse;
  } else {
    _landingRing.visible = false;
  }
}

/**
 * Execute teleport — smooth transition by moving galaxyGroup
 * (User stays still, galaxy repositions — matching existing locomotion pattern)
 */
function executeTeleport() {
  if (!_teleport.landingValid || !_galaxyGroup) return;

  // In this system, "teleporting" means the user wants to move to _teleport.landingPos
  // But the user is physically stationary — we move galaxyGroup to simulate movement
  // Delta = current position - landing position
  const delta = new THREE.Vector3();
  delta.subVectors(_galaxyGroup.position, _teleport.landingPos);
  // Actually we offset galaxyGroup by the inverse of where user wants to go
  const targetGalaxyPos = _galaxyGroup.position.clone().sub(_teleport.landingPos);
  targetGalaxyPos.y = _galaxyGroup.position.y; // keep vertical position

  // Use existing _vrZoomAnim pattern for smooth transition
  _vrZoomAnim = {
    startPos: _galaxyGroup.position.clone(),
    endPos: targetGalaxyPos,
    t: 0,
    frames: 20, // fast — ~0.3s at 72fps
  };

  // Haptic feedback on landing
  HapticPatterns.teleportLand('left');

  // Hide arc and landing indicator
  _arcLine.visible = false;
  _landingRing.visible = false;
  _teleport.active = false;
}

// ─── Thumbstick Integration ─────────────────────────────────────────────────
// In updateXRControls(), detect left thumbstick forward:

function updateTeleportControls() {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const src of session.inputSources) {
    if (!src.gamepad || src.handedness !== 'left') continue;

    const axes = src.gamepad.axes;
    const thumbY = axes[3]; // vertical axis (forward = -1)

    if (thumbY < -0.7) {
      // Thumbstick pushed forward — show arc
      _teleport.active = true;
      _arcLine.visible = true;
      calculateTeleportArc(xrController0);
    } else if (_teleport.active && thumbY > -0.3) {
      // Thumbstick released — execute teleport
      executeTeleport();
    }
  }
}

// In animate() when _inXR:
// updateTeleportControls();
```

**Draw call cost:** 2 (arc line + landing ring). Only visible when aiming.

---

## 8. Time Manipulation / Slow Motion (Bullet Time)

Squeeze grip to slow everything down. Visual desaturation + time scale.

```javascript
// ─── Bullet Time / Slow Motion System ───────────────────────────────────────

const _bulletTime = {
  active: false,
  timeScale: 1.0,        // 1.0 = normal, 0.2 = slow-mo
  targetScale: 1.0,
  desaturation: 0.0,     // 0 = full color, 1 = grayscale
  squeezeHeld: false,
};

// Desaturation shader — apply to planet materials via onBeforeCompile or as overlay
// Simplest approach: modify the scene fog color and material emissive during bullet time

// For more visual impact, add a fullscreen quad inside the VR view:
const _bulletTimeOverlay = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uDesaturation: { value: 0 },
    },
    vertexShader: `
      void main() {
        gl_Position = vec4(position.xy, 0.9999, 1.0); // fullscreen quad in clip space
      }
    `,
    fragmentShader: `
      uniform float uDesaturation;
      void main() {
        // Blue-tinted overlay for bullet time feel
        vec3 tint = vec3(0.1, 0.12, 0.2);
        float alpha = uDesaturation * 0.25; // subtle
        gl_FragColor = vec4(tint, alpha);
      }
    `,
  })
);
_bulletTimeOverlay.frustumCulled = false;
_bulletTimeOverlay.renderOrder = 9999;
// Don't add to scene yet — only when in XR

// Alternative approach: modify material uniforms directly
// If planets use ShaderMaterial, add a uDesaturation uniform:
/*
  Fragment shader addition:
    uniform float uDesaturation;
    // After computing finalColor:
    float gray = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
    finalColor.rgb = mix(finalColor.rgb, vec3(gray), uDesaturation);
*/

function updateBulletTime() {
  const session = renderer.xr.getSession();
  if (!session) return;

  // Detect squeeze on either controller
  let squeezing = false;
  for (const src of session.inputSources) {
    if (!src.gamepad) continue;
    const grip = src.gamepad.buttons[1]; // grip/squeeze button
    if (grip && grip.pressed) squeezing = true;
  }

  if (squeezing && !_bulletTime.squeezeHeld) {
    _bulletTime.squeezeHeld = true;
    _bulletTime.active = !_bulletTime.active;
    _bulletTime.targetScale = _bulletTime.active ? 0.2 : 1.0;

    if (_bulletTime.active) {
      HapticPatterns.slowMoEngage('right');
    }
  }
  if (!squeezing) _bulletTime.squeezeHeld = false;

  // Smooth transition
  _bulletTime.timeScale += (_bulletTime.targetScale - _bulletTime.timeScale) * 0.05;
  _bulletTime.desaturation += ((_bulletTime.active ? 0.6 : 0) - _bulletTime.desaturation) * 0.05;

  // Apply overlay
  if (_bulletTimeOverlay.parent) {
    _bulletTimeOverlay.material.uniforms.uDesaturation.value = _bulletTime.desaturation;
  }
}

// ─── Usage in animate() ─────────────────────────────────────────────────────
// Multiply all animation deltas by _bulletTime.timeScale:

function getTimeScale() {
  return _bulletTime.timeScale;
}

// Example integration in animate():
/*
  if (_inXR) {
    updateBulletTime();
    const ts = getTimeScale();

    // Slow down zoom animations
    if (_vrZoomAnim && _galaxyGroup) {
      _vrZoomAnim.t += ts;  // instead of _vrZoomAnim.t++
      // ... rest of zoom logic
    }

    // Slow down dust particles
    if (window._dustMat) {
      window._dustMat.uniforms.uTime.value += 0.001 * ts; // instead of raw time
    }

    // Speed lines respond to time scale too
    // (they naturally slow because galaxy movement slows)
  }
*/
```

**Note:** The bullet-time overlay approach (fullscreen quad in clip space) avoids post-processing entirely. For stronger desaturation, you'd modify each planet's material with a `uDesaturation` uniform.

---

## 9. Data Visualization Overlays

Connection count rings around planets. Domain clustering boundaries.

```javascript
// ─── Connection Count Rings ─────────────────────────────────────────────────
// Each planet gets rings proportional to its connection count.
// Use a single InstancedMesh for all rings (1 draw call total).

const MAX_RINGS = 100; // top 100 most-connected nodes
const _ringGeo = new THREE.TorusGeometry(1, 0.02, 4, 32); // unit torus, scaled per node
const _ringMat = new THREE.MeshBasicMaterial({
  color: 0xe8d89a,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
});

const _connectionRings = new THREE.InstancedMesh(_ringGeo, _ringMat, MAX_RINGS);
_connectionRings.frustumCulled = false;
scene.add(_connectionRings); // moves into galaxyGroup at sessionstart

const _ringDummy = new THREE.Object3D();

function buildConnectionRings() {
  // Count connections per node
  const connCount = new Map();
  for (const n of nodes) connCount.set(n.name, 0);
  // Assume 'edges' array exists with {source, target} pairs
  if (typeof edges !== 'undefined') {
    for (const e of edges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
    }
  }

  // Sort by connection count, take top MAX_RINGS
  const sorted = [...nodes]
    .map(n => ({ node: n, count: connCount.get(n.name) || n.connections?.length || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_RINGS);

  for (let i = 0; i < MAX_RINGS; i++) {
    if (i < sorted.length && sorted[i].count > 0) {
      const { node, count } = sorted[i];
      const planetRadius = node.size || 10;

      // Ring radius proportional to connections (1 ring per 3 connections)
      const numRings = Math.min(Math.floor(count / 3) + 1, 4);

      for (let r = 0; r < numRings && i < MAX_RINGS; r++) {
        const ringRadius = planetRadius * (1.5 + r * 0.6);

        _ringDummy.position.set(node.x, node.y, node.z);
        // Tilt each ring differently
        _ringDummy.rotation.set(
          Math.random() * 0.5 - 0.25,
          Math.random() * Math.PI,
          Math.random() * 0.3
        );
        _ringDummy.scale.setScalar(ringRadius);
        _ringDummy.updateMatrix();
        _connectionRings.setMatrixAt(i, _ringDummy.matrix);

        if (r > 0) i++; // consume extra ring slots
      }
    } else {
      // Hide unused instances by scaling to 0
      _ringDummy.scale.setScalar(0);
      _ringDummy.updateMatrix();
      _connectionRings.setMatrixAt(i, _ringDummy.matrix);
    }
  }
  _connectionRings.instanceMatrix.needsUpdate = true;
}

// Call after layout settles: buildConnectionRings();

// ─── Domain Clustering Boundaries ───────────────────────────────────────────
// Colored transparent spheres around domain clusters

function buildDomainBoundaries() {
  const domainGroups = {};

  // Group nodes by domain
  for (const n of nodes) {
    if (!domainGroups[n.domain]) domainGroups[n.domain] = [];
    domainGroups[n.domain].push(n);
  }

  const boundaries = [];

  for (const [domain, domNodes] of Object.entries(domainGroups)) {
    if (domNodes.length < 3) continue;

    // Compute centroid
    const centroid = new THREE.Vector3();
    for (const n of domNodes) centroid.add(new THREE.Vector3(n.x, n.y, n.z));
    centroid.divideScalar(domNodes.length);

    // Compute radius (max distance from centroid + padding)
    let maxDist = 0;
    for (const n of domNodes) {
      const d = centroid.distanceTo(new THREE.Vector3(n.x, n.y, n.z));
      if (d > maxDist) maxDist = d;
    }
    maxDist *= 1.2; // padding

    // Create boundary sphere
    const color = new THREE.Color(DOMAINS[domain]?.color || '#888888');
    const boundary = new THREE.Mesh(
      new THREE.SphereGeometry(maxDist, 12, 8),
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.04, // very subtle
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    boundary.position.copy(centroid);
    scene.add(boundary); // moves into galaxyGroup

    boundaries.push(boundary);
  }

  return boundaries; // max ~15 domains = 15 draw calls
}

// ─── Connection Strength Lines ──────────────────────────────────────────────
// Varying line thickness/opacity based on connection strength
// (Already have single BufferGeometry for connections — enhance with vertex colors)

function buildConnectionStrengthViz() {
  // If using the existing connection line system, add vertex colors:
  // Thicker/brighter for strong connections, dimmer for weak
  // This is a data overlay modification to existing connection geometry

  // Pseudo-code for the existing connection BufferGeometry:
  /*
  const colors = new Float32Array(connectionPositions.length);
  for (let i = 0; i < edges.length; i++) {
    const strength = edges[i].weight || 1;
    const brightness = Math.min(strength / 5, 1);
    const idx = i * 6; // 2 vertices * 3 components
    colors[idx] = colors[idx+3] = brightness * 0.9;
    colors[idx+1] = colors[idx+4] = brightness * 0.85;
    colors[idx+2] = colors[idx+5] = brightness * 0.6;
  }
  connectionGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  connectionMat.vertexColors = true;
  */
}
```

**Draw call cost:**
- Connection rings: 1 (InstancedMesh)
- Domain boundaries: ~15
- Total: ~16 draw calls for full data viz overlay

---

## 10. Ambient Environment Effects

Breathing camera motion, depth-of-field simulation, atmospheric scattering -- all without post-processing.

```javascript
// ─── Camera Breathing / Idle Sway ───────────────────────────────────────────
// IMPORTANT: In WebXR, you CANNOT move the camera directly.
// Instead, apply subtle motion to the galaxyGroup (moves the whole world).

function applyBreathingMotion(time) {
  if (!_galaxyGroup || _vrZoomAnim) return; // don't interfere with zoom animations

  // Subtle sinusoidal breathing — very slow, very small
  const breathX = Math.sin(time * 0.4) * 0.002;
  const breathY = Math.sin(time * 0.25) * 0.003;
  const breathZ = Math.sin(time * 0.3 + 1.0) * 0.001;

  // Apply as offset (additive, don't override position)
  _galaxyGroup.position.x += breathX * 0.01;
  _galaxyGroup.position.y += breathY * 0.01;
  _galaxyGroup.position.z += breathZ * 0.01;

  // Very subtle rotation breathing
  _galaxyGroup.rotation.x += Math.sin(time * 0.2) * 0.00005;
  _galaxyGroup.rotation.z += Math.sin(time * 0.15) * 0.00003;
}

// ─── Depth-of-Field Simulation (No Post-Processing) ────────────────────────
// Use per-material transparency based on distance from focus point.
// Distant planets become slightly transparent and blurred (scale trick).

function updateDepthCue(focusPoint) {
  if (!focusPoint) return;

  const headPos = new THREE.Vector3();
  const camera = renderer.xr.getCamera();
  headPos.setFromMatrixPosition(camera.matrixWorld);

  const focusDist = headPos.distanceTo(focusPoint);

  for (const n of nodes) {
    if (!n.mesh) continue;

    const wp = new THREE.Vector3();
    n.mesh.getWorldPosition(wp);
    const dist = headPos.distanceTo(wp);

    // Depth-based fade: objects far from focus distance become transparent
    const depthDelta = Math.abs(dist - focusDist);
    const fade = 1.0 - Math.min(depthDelta / 3.0, 0.5); // max 50% fade

    if (n.mesh.material.opacity !== undefined) {
      n.mesh.material.opacity = fade;
      n.mesh.material.transparent = true;
    }
  }
}

// ─── Atmospheric Scattering / Depth Fog (Shader-Based) ──────────────────────
// Add fog-like depth cue directly in planet vertex/fragment shaders.
// This avoids scene.fog (which doesn't work well with custom shaders).

const _depthFogUniforms = {
  uFogColor:    { value: new THREE.Color(0x04060f) },
  uFogNear:     { value: 1.0 },   // meters — start fading
  uFogFar:      { value: 8.0 },   // meters — fully fogged
  uFogDensity:  { value: 0.15 },  // exponential density
};

// Inject into any ShaderMaterial's fragment shader:
const depthFogFragment = `
  // ─── Depth Fog ───
  float fogDepth = length(vViewPosition); // or gl_FragCoord.z
  float fogFactor = 1.0 - exp(-uFogDensity * fogDepth * fogDepth);
  fogFactor = clamp(fogFactor, 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
`;

// For MeshBasicMaterial / MeshStandardMaterial, use onBeforeCompile:
function addDepthFogToMaterial(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFogColor = _depthFogUniforms.uFogColor;
    shader.uniforms.uFogDensity = _depthFogUniforms.uFogDensity;

    // Add uniforms to fragment shader
    shader.fragmentShader = `
      uniform vec3 uFogColor;
      uniform float uFogDensity;
    ` + shader.fragmentShader;

    // Inject fog calculation before final output
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      // Custom depth fog
      float fogDepth = length(vViewPosition);
      float fogFactor = 1.0 - exp(-uFogDensity * fogDepth * fogDepth);
      fogFactor = clamp(fogFactor, 0.0, 0.7); // never fully fogged
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
      #include <dithering_fragment>
      `
    );
  };
  material.needsUpdate = true;
}

// ─── Atmospheric Rim Light (for large background objects) ───────────────────
// Backside fresnel that simulates atmospheric scattering around planets.
// Already in use in the project (Fresnel atmosphere meshes) — here's the full shader:

const atmosphericScatteringMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.BackSide,
  uniforms: {
    uColor:       { value: new THREE.Color(0.6, 0.7, 1.0) },  // blue-ish scatter
    uSunDir:      { value: new THREE.Vector3(1, 0.5, 0).normalize() },
    uIntensity:   { value: 0.8 },
    uAtmThickness:{ value: 3.0 },  // fresnel exponent
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(normalMatrix * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform vec3 uSunDir;
    uniform float uIntensity;
    uniform float uAtmThickness;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    void main() {
      // Fresnel rim
      float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
      rim = pow(rim, uAtmThickness);

      // Sun-side brightening (Mie-like forward scattering)
      float sunFacing = max(0.0, dot(vViewDir, uSunDir));
      float mie = pow(sunFacing, 8.0) * 0.5;

      // Rayleigh-like blue shift at edges
      vec3 scatter = uColor + vec3(0.0, 0.0, 0.2) * rim;

      float alpha = rim * uIntensity + mie * 0.3;
      gl_FragColor = vec4(scatter, clamp(alpha, 0.0, 0.8));
    }
  `,
});

// ─── Ambient Particle Drift ─────────────────────────────────────────────────
// Tiny dust motes drifting slowly — sense of scale and environment.
// Vertex-shader animated (zero CPU cost).

const AMBIENT_DUST_COUNT = 500;
const _ambientDustGeo = new THREE.BufferGeometry();
const _dustPositions = new Float32Array(AMBIENT_DUST_COUNT * 3);
const _dustSeeds = new Float32Array(AMBIENT_DUST_COUNT);

for (let i = 0; i < AMBIENT_DUST_COUNT; i++) {
  _dustPositions[i * 3]     = (Math.random() - 0.5) * 6;
  _dustPositions[i * 3 + 1] = Math.random() * 3;
  _dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 6;
  _dustSeeds[i] = Math.random();
}
_ambientDustGeo.setAttribute('position', new THREE.BufferAttribute(_dustPositions, 3));
_ambientDustGeo.setAttribute('aSeed', new THREE.BufferAttribute(_dustSeeds, 1));

const _ambientDustMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0.3 },
  },
  vertexShader: `
    attribute float aSeed;
    uniform float uTime;
    varying float vAlpha;
    void main() {
      vec3 pos = position;

      // Slow drift based on seed
      float t = uTime * 0.1 + aSeed * 100.0;
      pos.x += sin(t * 0.7 + aSeed * 6.28) * 0.3;
      pos.y += sin(t * 0.5 + aSeed * 3.14) * 0.15;
      pos.z += cos(t * 0.6 + aSeed * 4.71) * 0.2;

      // Wrap around (keep particles in view)
      pos = mod(pos + 3.0, 6.0) - 3.0;
      pos.y = mod(pos.y, 3.0);

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = 2.0; // screen-space pixels

      // Distance fade
      float dist = -mvPosition.z;
      vAlpha = smoothstep(5.0, 1.0, dist) * smoothstep(0.0, 0.5, dist);
    }
  `,
  fragmentShader: `
    uniform float uOpacity;
    varying float vAlpha;
    void main() {
      // Soft circular point
      vec2 center = gl_PointCoord - 0.5;
      float dist = length(center);
      if (dist > 0.5) discard;

      float alpha = (1.0 - dist * 2.0) * vAlpha * uOpacity;
      gl_FragColor = vec4(0.9, 0.85, 0.7, alpha);
    }
  `,
});

const _ambientDust = new THREE.Points(_ambientDustGeo, _ambientDustMat);
_ambientDust.frustumCulled = false;
scene.add(_ambientDust); // stays at scene level (world space around user)

// Update in animate():
// _ambientDustMat.uniforms.uTime.value = performance.now() * 0.001;

// In animate() when _inXR:
/*
  applyBreathingMotion(performance.now() * 0.001);
  _ambientDustMat.uniforms.uTime.value = performance.now() * 0.001;
  // Optional: updateDepthCue(focusedNode ? new THREE.Vector3(focusedNode.x * XR_SCALE, ...) : null);
*/
```

**Draw call cost:**
- Breathing motion: 0 (just modifies galaxyGroup transform)
- Depth cue: 0 (modifies existing material opacity)
- Depth fog: 0 (injected into existing shaders)
- Ambient dust: 1 (single Points draw)
- Atmospheric scatter per planet: already budgeted in CLAUDE.md

---

## Integration Summary

### In `animate()`, XR block:

```javascript
if (_inXR) {
  const time = performance.now() * 0.001;
  const ts = getTimeScale(); // bullet time

  updateXRControls();
  updateBulletTime();
  updateTractorBeam(time);
  updateMinimap();
  updateSpeedLines();
  updateHighlight(time, _vrHoveredNode);
  updateTeleportControls();
  applyBreathingMotion(time);
  updateSpatialProximity();
  _ambientDustMat.uniforms.uTime.value = time;

  // Existing dust + zoom animations (modified for time scale)
  if (window._dustMat) {
    window._dustMat.uniforms.uTime.value += 0.001 * ts;
  }
  pollRightTriggerExit();

  if (_vrZoomAnim && _galaxyGroup) {
    _vrZoomAnim.t += ts;
    const raw = Math.min(_vrZoomAnim.t / _vrZoomAnim.frames, 1);
    const ease = raw < 0.5 ? 2*raw*raw : -1+(4-2*raw)*raw;
    _galaxyGroup.position.lerpVectors(_vrZoomAnim.startPos, _vrZoomAnim.endPos, ease);
    if (raw >= 1) _vrZoomAnim = null;
  }
}
```

### Total Draw Call Budget (all mechanics active):

| Mechanic | Draw Calls |
|---|---|
| Tractor beam (mesh + particles) | 2 |
| Minimap (sphere + ring + dots) | 3 |
| Speed lines (InstancedMesh) | 1 |
| Highlight (fresnel shell) | 1 |
| Connection rings (InstancedMesh) | 1 |
| Domain boundaries | 15 |
| Teleport arc + landing | 2 |
| Ambient dust | 1 |
| Bullet time overlay | 1 |
| **Total new** | **27** |

Within the <200 budget considering existing scene uses ~80-120.

---

## Sources

- [WebXR Controllers (three.js forum)](https://discourse.threejs.org/t/webxr-controllers/15292)
- [5 Methods in WebXR Object Manipulation (Medium)](https://medium.com/@carton22liu/5-methods-in-webxr-object-manipulation-threejs-ar-vr-06977c5f374e)
- [CanvasUI for WebXR VR (three.js forum)](https://discourse.threejs.org/t/canvasui-a-three-js-ui-solution-for-webxr-vr-sessions/17006)
- [High-Speed Light Trails (Codrops)](https://tympanus.net/codrops/2019/11/13/high-speed-light-trails-in-three-js/)
- [Animated Mesh Lines (Codrops)](https://tympanus.net/codrops/2019/01/08/animated-mesh-lines/)
- [Fresnel Shader (three.js forum)](https://discourse.threejs.org/t/fresnel-shader-or-similar-effect/9997)
- [Shader Glow (Stemkoski)](https://stemkoski.github.io/Three.js/Shader-Glow.html)
- [Fresnel-Shader-Material (GitHub)](https://github.com/otanodesignco/Fresnel-Shader-Material)
- [Rim Lighting Shader (Three.js Roadmap)](https://threejsroadmap.com/blog/rim-lighting-shader)
- [VR Controller Haptics in WebXR](https://timmykokke.com/blog/2022/2022-03-14-controller-haptics-in-webxr/)
- [GamepadHapticActuator (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator)
- [three.js PositionalAudio Docs](https://threejs.org/docs/pages/PositionalAudio.html)
- [Web Audio Spatialization (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)
- [Web Audio API Positional Audio for WebXR (Medium)](https://medium.com/@kfarr/understanding-web-audio-api-positional-audio-distance-models-for-webxr-e77998afcdff)
- [VR Locomotion in Three.js (Ada Rose Cannon)](https://ada.is/blog/2020/05/18/using-vr-controllers-and-locomotion-in-threejs/)
- [TeleportVR (sbcode)](https://sbcode.net/threejs/teleportvr/)
- [WebXR Teleport (three.js official example)](https://github.com/mrdoob/three.js/blob/dev/examples/webxr_vr_teleport.html)
- [three.js Bullet Time / Clock (forum)](https://discourse.threejs.org/t/slow-down-clock-time-bullet-time/38705)
- [3D Force Graph (GitHub)](https://github.com/vasturiano/3d-force-graph)
- [Three.js Fog Hacks (Medium)](https://snayss.medium.com/three-js-fog-hacks-fc0b42f63386)
- [three-screenshake (GitHub)](https://github.com/felixmariotto/three-screenshake)
- [THRASTRO Shaders (GitHub)](https://github.com/THRASTRO/thrastro-shaders)
