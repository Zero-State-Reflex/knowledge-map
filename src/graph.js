// ─── GRAPH MODULE ────────────────────────────────────────────────────────────
// Force simulation, node building with meshes, edge lines, pulse system.

import { DOMAINS, NODES_RAW, EDGES_DEF, DOMAIN_CENTERS } from './data.js';
import { makePlanetTexture } from './planets.js';
import { scene } from './scene.js';

// ─── BUILD GRAPH ────────────────────────────────────────────────────────────
export const nodeMap = new Map();
NODES_RAW.forEach(([name, domain, size]) => {
  const phi = Math.acos(1 - 2 * (nodeMap.size + 0.5) / NODES_RAW.length);
  const theta = Math.PI * (1 + Math.sqrt(5)) * nodeMap.size;
  const r = 480;
  nodeMap.set(name, {
    id: name, domain, size,
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
    vx:0, vy:0, vz:0,
    mesh: null,
  });
});
export const nodes = Array.from(nodeMap.values());

export const links = [];
EDGES_DEF.forEach(([a, b]) => {
  if (nodeMap.has(a) && nodeMap.has(b) && a !== b)
    links.push({ source: nodeMap.get(a), target: nodeMap.get(b) });
});

// ─── NODE MESHES ────────────────────────────────────────────────────────────
const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
const atmGeo    = new THREE.SphereGeometry(1, 24, 16); // atmosphere shell
export const nodeMeshes = [];

nodes.forEach(n => {
  const hex = DOMAINS[n.domain]?.color || '#aaaaaa';
  const domColor = new THREE.Color(hex);

  // Planet surface — tuned for visible texture detail
  const tex = makePlanetTexture(n.domain, n.id);
  const mat = new THREE.MeshPhongMaterial({
    map: tex,
    emissive: domColor,
    emissiveIntensity: 0.015,
    shininess: 18,
    specular: new THREE.Color(0x111111),
    transparent: false,
    opacity: 1.0,
  });
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.scale.setScalar(n.size * 2.2);
  mesh.position.set(n.x, n.y, n.z);
  mesh.userData.node = n;
  // Slow unique rotation per planet
  mesh.userData.rotSpeed = 0.0015 + (n.id.charCodeAt(0) % 10) * 0.0003;
  scene.add(mesh);
  nodeMeshes.push(mesh);
  n.mesh = mesh;

  // Atmosphere glow shell — thin rim, BackSide so it only shows at edges
  const atmMat = new THREE.MeshBasicMaterial({
    color: domColor,
    transparent: true,
    opacity: 0.06,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atm = new THREE.Mesh(atmGeo, atmMat);
  atm.scale.setScalar(n.size * 2.2 * 1.12);
  atm.position.set(n.x, n.y, n.z);
  atm.userData.isAtm = true;
  atm.userData.node  = n;
  scene.add(atm);
  n.atm = atm;
  n.atmMat = atmMat;

  // Outer atmosphere haze — very faint, large glow halo
  const outerAtmMat = new THREE.MeshBasicMaterial({
    color: domColor,
    transparent: true,
    opacity: 0.02,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const outerAtm = new THREE.Mesh(atmGeo, outerAtmMat);
  outerAtm.scale.setScalar(n.size * 2.2 * 1.35);
  outerAtm.position.set(n.x, n.y, n.z);
  scene.add(outerAtm);
  n.outerAtm = outerAtm;

  // Planetary rings on larger nodes (size >= 18)
  if (n.size >= 18) {
    const ringInner = n.size * 2.2 * 1.35;
    const ringOuter = n.size * 2.2 * 2.0;
    const ringGeo = new THREE.RingGeometry(ringInner, ringOuter, 64, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: domColor,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(n.x, n.y, n.z);
    // Tilt rings uniquely per node
    const tiltSeed = n.id.charCodeAt(0) * 0.1;
    ring.rotation.x = Math.PI * 0.5 + Math.sin(tiltSeed) * 0.4;
    ring.rotation.y = Math.cos(tiltSeed * 1.3) * 0.3;
    scene.add(ring);
    n.ring = ring;
  }
});

// ─── EDGE LINES ─────────────────────────────────────────────────────────────
export const edgePosArr = new Float32Array(links.length * 6);
export const edgeGeo = new THREE.BufferGeometry();
const edgePosAttr = new THREE.BufferAttribute(edgePosArr, 3);
edgePosAttr.usage = THREE.DynamicDrawUsage;
edgeGeo.setAttribute('position', edgePosAttr);
export const edgeMat = new THREE.LineBasicMaterial({
  color: 0xc8bea8, transparent: true, opacity: 0.28,
});
const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
scene.add(edgeLines);

// ─── TRAVELING PULSE SYSTEM ──────────────────────────────────────────────────
const PULSE_POOL      = 32;
const PULSE_SPEED_MIN = 0.003;
const PULSE_SPEED_MAX = 0.009;
const PULSE_TAIL      = 0.09;

const PULSE_COLORS = [
  new THREE.Color(0xffe8a0),
  new THREE.Color(0xaad4ff),
  new THREE.Color(0xffc0e0),
  new THREE.Color(0xc0ffd8),
  new THREE.Color(0xffd0a0),
  new THREE.Color(0xe0c0ff),
  new THREE.Color(0xa0eeff),
];

// Neighbor lookup for chain-traveling
export const neighborMap = new Map();
nodes.forEach(n => neighborMap.set(n.id, []));
links.forEach(l => {
  neighborMap.get(l.source.id).push(l.target);
  neighborMap.get(l.target.id).push(l.source);
});

const activePulses = [];

// Each pulse gets its own 2-point LineSegments (head + tail point)
function spawnPulse(srcNode, tgtNode, col) {
  if (activePulses.length >= PULSE_POOL) return;

  const color = col
    ? col.clone()
    : PULSE_COLORS[Math.floor(Math.random() * PULSE_COLORS.length)].clone();
  const speed = PULSE_SPEED_MIN + Math.random() * (PULSE_SPEED_MAX - PULSE_SPEED_MIN);

  // Core bright segment
  const posArr = new Float32Array(6); // 2 points x 3
  const geo    = new THREE.BufferGeometry();
  const attr   = new THREE.BufferAttribute(posArr, 3);
  attr.usage   = THREE.DynamicDrawUsage;
  geo.setAttribute('position', attr);

  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.LineSegments(geo, mat);
  scene.add(line);

  // Softer wider halo segment (same geometry, different material)
  const haloMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const haloLine = new THREE.LineSegments(geo, haloMat); // shares geo
  scene.add(haloLine);

  activePulses.push({
    src: srcNode, tgt: tgtNode,
    t: 0, speed, color,
    geo, posArr, mat, haloMat, line, haloLine,
  });
}

function lerpEdge(src, tgt, t) {
  return {
    x: src.x + (tgt.x - src.x) * t,
    y: src.y + (tgt.y - src.y) * t,
    z: src.z + (tgt.z - src.z) * t,
  };
}

export function updatePulses() {
  // Randomly spawn new pulses
  if (Math.random() < 0.012 && activePulses.length < PULSE_POOL) {
    const candidates = nodes.filter(n => neighborMap.get(n.id).length > 0);
    if (candidates.length) {
      const src  = candidates[Math.floor(Math.random() * candidates.length)];
      const nbrs = neighborMap.get(src.id);
      const tgt  = nbrs[Math.floor(Math.random() * nbrs.length)];
      spawnPulse(src, tgt, null);
    }
  }

  for (let i = activePulses.length - 1; i >= 0; i--) {
    const p = activePulses[i];
    p.t += p.speed;

    const head = Math.min(p.t, 1);
    const tail = Math.max(p.t - PULSE_TAIL, 0);

    // Fade in as tail leaves 0, fade out as head approaches 1
    const fadeIn  = Math.min(p.t / (PULSE_TAIL * 0.5), 1);
    const fadeOut = Math.min((1 - head) / 0.08 + 0.001, 1);
    const env     = Math.min(fadeIn, fadeOut);

    p.mat.opacity     = env * 0.92;
    p.haloMat.opacity = env * 0.32;

    // Write head and tail positions into the line segment
    const hp = lerpEdge(p.src, p.tgt, head);
    const tp = lerpEdge(p.src, p.tgt, tail);
    p.posArr[0] = tp.x; p.posArr[1] = tp.y; p.posArr[2] = tp.z;
    p.posArr[3] = hp.x; p.posArr[4] = hp.y; p.posArr[5] = hp.z;
    p.geo.attributes.position.needsUpdate = true;

    // Pulse finished
    if (p.t >= 1 + PULSE_TAIL) {
      scene.remove(p.line);
      scene.remove(p.haloLine);
      p.mat.dispose();
      p.haloMat.dispose();
      p.geo.dispose();
      activePulses.splice(i, 1);

      // 55% chance to chain-travel
      if (Math.random() < 0.55) {
        const nbrs = neighborMap.get(p.tgt.id).filter(n => n.id !== p.src.id);
        if (nbrs.length) {
          const next = nbrs[Math.floor(Math.random() * nbrs.length)];
          spawnPulse(p.tgt, next, p.color);
        }
      }
    }
  }
}

// ─── FOCUS EDGES ────────────────────────────────────────────────────────────
export const focusEdgePosArr = new Float32Array(links.length * 6);
export const focusEdgeGeo  = new THREE.BufferGeometry();
const focusEdgeAttr = new THREE.BufferAttribute(focusEdgePosArr, 3);
focusEdgeAttr.usage = THREE.DynamicDrawUsage;
focusEdgeGeo.setAttribute('position', focusEdgeAttr);

// Halo layer — additive, soft wide glow
export const focusEdgeHaloMat = new THREE.LineBasicMaterial({
  color: 0xffe8a0, transparent: true, opacity: 0.0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const focusEdgeHalo = new THREE.LineSegments(focusEdgeGeo, focusEdgeHaloMat);
scene.add(focusEdgeHalo);

// Core layer — bright sharp line on top
export const focusEdgeCoreMat = new THREE.LineBasicMaterial({
  color: 0xfff0c0, transparent: true, opacity: 0.0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const focusEdgeCore = new THREE.LineSegments(focusEdgeGeo, focusEdgeCoreMat);
scene.add(focusEdgeCore);

export let focusEdgeLinks = []; // subset of links for focused node

export function buildFocusEdges(n) {
  focusEdgeLinks = links.filter(l => l.source.id === n.id || l.target.id === n.id);
  // Resize buffer if needed
  const needed = focusEdgeLinks.length * 6;
  if (focusEdgePosArr.length < needed) {
    const newArr = new Float32Array(needed);
    focusEdgeGeo.setAttribute('position', new THREE.BufferAttribute(newArr, 3));
    focusEdgeGeo.attributes.position.usage = THREE.DynamicDrawUsage;
  }
  focusEdgeGeo.setDrawRange(0, focusEdgeLinks.length * 2);
  const domainColor = new THREE.Color(DOMAINS[n.domain]?.color || '#ffe8a0');
  focusEdgeHaloMat.color.copy(domainColor);
  focusEdgeCoreMat.color.copy(domainColor).lerp(new THREE.Color(0xffffff), 0.4);
  // Start transparent — tickDim fades them in
  focusEdgeHaloMat.opacity = 0;
  focusEdgeCoreMat.opacity = 0;
}

export function clearFocusEdges() {
  focusEdgeLinks = [];
  focusEdgeHaloMat.opacity = 0.0;
  focusEdgeCoreMat.opacity = 0.0;
  focusEdgeGeo.setDrawRange(0, 0);
}
clearFocusEdges(); // hidden initially

// ─── FORCE SIMULATION ───────────────────────────────────────────────────────
export let alpha = 1.0;
const ALPHA_DECAY   = 0.016;
const ALPHA_MIN     = 0.004; // keep gently alive forever
const VEL_DECAY     = 0.58;
const REP_STR       = 7500;
const LINK_TARGET   = 88;
const LINK_STR      = 0.28;
const CLUSTER_STR   = 0.022;

// Hover forces queued each frame
export const hoverForces = new Map();

let settled = false;
const settlingEl = document.getElementById('settling');

// Import focusedNode getter — we'll use a callback pattern to avoid circular deps
let _getFocusedNode = () => null;
export function setFocusedNodeGetter(fn) { _getFocusedNode = fn; }

export function simTick() {
  const focusedNode = _getFocusedNode();
  const a = Math.max(alpha, ALPHA_MIN);

  // Repulsion (O(n^2))
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const q = nodes[j];
      const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      const d2 = dx*dx + dy*dy + dz*dz + 1;
      const f = REP_STR * a / d2;
      p.vx += dx*f; p.vy += dy*f; p.vz += dz*f;
      q.vx -= dx*f; q.vy -= dy*f; q.vz -= dz*f;
    }
  }

  // Link attraction
  for (const l of links) {
    const s = l.source, t = l.target;
    const dx = t.x-s.x, dy = t.y-s.y, dz = t.z-s.z;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.01;
    const f = (d - LINK_TARGET) * LINK_STR * a / d;
    s.vx += dx*f; s.vy += dy*f; s.vz += dz*f;
    t.vx -= dx*f; t.vy -= dy*f; t.vz -= dz*f;
  }

  // Domain clustering
  for (const n of nodes) {
    const c = DOMAIN_CENTERS[n.domain];
    if (!c) continue;
    n.vx += (c[0] - n.x) * CLUSTER_STR * a;
    n.vy += (c[1] - n.y) * CLUSTER_STR * a;
    n.vz += (c[2] - n.z) * CLUSTER_STR * a;
  }

  // Hover attraction forces
  for (const [id, f] of hoverForces) {
    const n = nodeMap.get(id);
    if (n) { n.vx += f.x; n.vy += f.y; n.vz += f.z; }
  }
  hoverForces.clear();

  // Focused node — smooth float from rest position.
  if (focusedNode && focusedNode._restX !== undefined) {
    const n = focusedNode;
    const t   = performance.now() * 0.001;
    const amp = n.size * 1.4;

    // Ease-in blend: 0->1 over first ~1.5s so the float starts invisibly slow
    if (n._floatStart === undefined) n._floatStart = t;
    const elapsed = t - n._floatStart;
    const blend   = Math.min(elapsed / 1.5, 1);
    const ease    = blend * blend * (3 - 2 * blend); // smoothstep

    const floatX = n._restX + Math.sin(t * 0.7)  * amp * ease;
    const floatY = n._restY + Math.sin(t * 0.53) * amp * ease * 0.8;
    const floatZ = n._restZ + Math.sin(t * 0.41) * amp * ease * 0.6;

    n.x += (floatX - n.x) * 0.06;
    n.y += (floatY - n.y) * 0.06;
    n.z += (floatZ - n.z) * 0.06;
    n.vx = 0; n.vy = 0; n.vz = 0;
  }

  // Integrate
  const now = performance.now();
  const COAST_MS  = 1400;
  const COAST_DECAY = 0.97;
  for (const n of nodes) {
    let decay = VEL_DECAY;
    if (n._hoverReleaseTime) {
      const age = now - n._hoverReleaseTime;
      if (age < COAST_MS) {
        const t = age / COAST_MS;
        decay = COAST_DECAY + (VEL_DECAY - COAST_DECAY) * (t * t);
      } else {
        delete n._hoverReleaseTime;
      }
    }
    n.vx *= decay; n.vy *= decay; n.vz *= decay;
    n.x += n.vx; n.y += n.vy; n.z += n.vz;
  }

  if (alpha > ALPHA_MIN) {
    alpha -= ALPHA_DECAY * (alpha - ALPHA_MIN);
    if (alpha <= ALPHA_MIN + 0.001 && !settled) {
      settled = true;
      settlingEl.style.opacity = '0';
      setTimeout(() => settlingEl.remove(), 1200);
    }
  }
}

export function updateScene(focusedNode) {
  for (const n of nodes) {
    n.mesh.position.set(n.x, n.y, n.z);
    n.mesh.rotation.y += n.mesh.userData.rotSpeed;
    if (n.atm) n.atm.position.set(n.x, n.y, n.z);
    if (n.outerAtm) n.outerAtm.position.set(n.x, n.y, n.z);
    if (n.ring) {
      n.ring.position.set(n.x, n.y, n.z);
      n.ring.rotation.z += 0.0003; // slow ring rotation
    }
  }
  // updateMoons is called from focus.js via ui.js
  let idx = 0;
  for (const l of links) {
    edgePosArr[idx++] = l.source.x; edgePosArr[idx++] = l.source.y; edgePosArr[idx++] = l.source.z;
    edgePosArr[idx++] = l.target.x; edgePosArr[idx++] = l.target.y; edgePosArr[idx++] = l.target.z;
  }
  edgeGeo.attributes.position.needsUpdate = true;

  // Update focused glow edges
  if (focusEdgeLinks.length > 0) {
    const pos = focusEdgeGeo.attributes.position;
    const arr = pos.array;
    let fi = 0;
    for (const l of focusEdgeLinks) {
      arr[fi++] = l.source.x; arr[fi++] = l.source.y; arr[fi++] = l.source.z;
      arr[fi++] = l.target.x; arr[fi++] = l.target.y; arr[fi++] = l.target.z;
    }
    pos.needsUpdate = true;
  }
}
