// ─── FOCUS MODULE ────────────────────────────────────────────────────────────
// focusNode, moon system, camera animation, dimming, focus edges.

import { DOMAINS } from './data.js';
import { scene, camera } from './scene.js';
import {
  nodes, nodeMap, links, nodeMeshes, neighborMap,
  edgeMat, buildFocusEdges, clearFocusEdges,
  focusEdgeLinks, focusEdgeHaloMat, focusEdgeCoreMat,
} from './graph.js';
import { playChime } from './audio.js';

// ─── SHARED STATE ───────────────────────────────────────────────────────────
export let focusedNode = null;

// Camera orbit state — exported so ui.js can read/write
export let camTheta = 0.5;
export let camPhi = 1.25;
export let camRadius = 1600;
export const lookTarget = new THREE.Vector3();

export function setCamTheta(v) { camTheta = v; }
export function setCamPhi(v) { camPhi = v; }
export function setCamRadius(v) { camRadius = v; }

export let isDragging = false;
export let prevX = 0, prevY = 0, mouseDownX = 0, mouseDownY = 0;
export let autoRotate = true;
export let lastInteraction = 0;
export const RESUME_DELAY = 2800;

export function setIsDragging(v) { isDragging = v; }
export function setPrevX(v) { prevX = v; }
export function setPrevY(v) { prevY = v; }
export function setMouseDownX(v) { mouseDownX = v; }
export function setMouseDownY(v) { mouseDownY = v; }
export function setLastInteraction(v) { lastInteraction = v; }

export function setCamFromSpherical() {
  camera.position.set(
    camRadius * Math.sin(camPhi) * Math.sin(camTheta),
    camRadius * Math.cos(camPhi),
    camRadius * Math.sin(camPhi) * Math.cos(camTheta)
  );
  camera.lookAt(lookTarget);
}
setCamFromSpherical();

// Camera animation — general purpose (used for unfocus)
export let camAnim = null;
export function setCamAnim(v) { camAnim = v; }
const _v3a = new THREE.Vector3(), _v3b = new THREE.Vector3();
export { _v3a, _v3b };

export function animateCamTo(endPos, endLook, frames) {
  camAnim = {
    startPos: camera.position.clone(),
    endPos: endPos.clone(),
    startLook: lookTarget.clone(),
    endLook: endLook.clone(),
    t: 0, frames
  };
  focusCamAnim = null; // cancel focus anim if active
}

// Two-phase focus camera: zoom in -> decelerate -> pull back 25% -> hold
export let focusCamAnim = null;
export function setFocusCamAnim(v) { focusCamAnim = v; }

export function startFocusCamAnim(nodePos) {
  camAnim = null;
  const dir      = camera.position.clone().sub(nodePos).normalize();
  const closePos = nodePos.clone().add(dir.clone().multiplyScalar(180));  // close stop
  const holdPos  = nodePos.clone().add(dir.clone().multiplyScalar(230));  // hold = 25% back
  focusCamAnim = {
    startPos:  camera.position.clone(),
    startLook: lookTarget.clone(),
    nodePos:   nodePos.clone(),
    closePos, holdPos,
    phase: 'zoomIn',  // zoomIn -> pullBack -> done
    t: 0,
    zoomFrames: 75,   // frames to zoom in
    pullFrames:  55,  // frames to pull back
  };
}

// ─── SCREEN PROJECTION ──────────────────────────────────────────────────────
export function toScreen(worldPos) {
  const v = worldPos.clone().project(camera);
  return {
    x: (v.x + 1) / 2 * window.innerWidth,
    y: -(v.y - 1) / 2 * window.innerHeight
  };
}

// ─── HOVER ──────────────────────────────────────────────────────────────────
export const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 10 };
export const mouse2d = new THREE.Vector2();
export let hoveredNode = null;
export function setHoveredNode(v) { hoveredNode = v; }

// ─── NEIGHBOR HELPER ────────────────────────────────────────────────────────
export function getNeighborNames(n) {
  const seen = new Set();
  links.forEach(l => {
    if (l.source.id === n.id && nodeMap.has(l.target.id)) seen.add(l.target.id);
    if (l.target.id === n.id && nodeMap.has(l.source.id)) seen.add(l.source.id);
  });
  return Array.from(seen);
}

// ─── DIMMING ────────────────────────────────────────────────────────────────
export function dimToNeighbors(n) {
  const nb = new Set([n.id]);
  links.forEach(l => {
    if (l.source.id === n.id) nb.add(l.target.id);
    if (l.target.id === n.id) nb.add(l.source.id);
  });
  nodes.forEach(m => {
    const inNb = nb.has(m.id);
    m._targetOpacity    = inNb ? 1.0 : 0.05;
    m._targetAtmOpacity = inNb ? (m.id === n.id ? 0.12 : 0.05) : 0.005;
    m.mesh.material.transparent = true;
  });
  edgeMat.opacity = 0.06;
}

export function resetDim() {
  nodes.forEach(n => {
    n._targetOpacity    = 1.0;
    n._targetAtmOpacity = 0.06;
  });
  edgeMat.opacity = 0.28;
}

// Call this every frame to lerp toward targets
export function tickDim() {
  nodes.forEach(n => {
    if (n._targetOpacity === undefined) return;
    const cur = n.mesh.material.opacity;
    const tgt = n._targetOpacity;
    if (Math.abs(cur - tgt) > 0.002) {
      const next = cur + (tgt - cur) * 0.08;
      n.mesh.material.opacity = next;
      if (tgt >= 1.0 && next > 0.98) {
        n.mesh.material.opacity = 1.0;
        n.mesh.material.transparent = false;
      }
    }
    if (n.atmMat && n._targetAtmOpacity !== undefined) {
      n.atmMat.opacity += (n._targetAtmOpacity - n.atmMat.opacity) * 0.08;
    }
  });
  // Fade focus edges in/out smoothly
  if (focusEdgeLinks.length > 0) {
    focusEdgeHaloMat.opacity += (0.55 - focusEdgeHaloMat.opacity) * 0.06;
    focusEdgeCoreMat.opacity += (0.92 - focusEdgeCoreMat.opacity) * 0.06;
  } else {
    focusEdgeHaloMat.opacity *= 0.88;
    focusEdgeCoreMat.opacity *= 0.88;
  }
}

export function getNodeScreenPos(n) {
  const pos = new THREE.Vector3(n.x, n.y, n.z);
  const toCamera = camera.position.clone().sub(pos).normalize();
  const frontPos = pos.clone().add(toCamera.multiplyScalar(n.size * 2.2 * 1.1));
  const v = frontPos.project(camera);
  return {
    x: (v.x + 1) / 2 * window.innerWidth,
    y: -(v.y - 1) / 2 * window.innerHeight
  };
}

// ─── MOON SYSTEM ─────────────────────────────────────────────────────────────
export const moonMeshes   = [];   // raycaster target list (cleared each focus)
export let   moonData     = [];   // per-moon orbit state

const moonSphereGeo = new THREE.SphereGeometry(1, 32, 24);
const moonRingGeo   = new THREE.RingGeometry(1.55, 1.85, 48);
const moonHaloGeo   = new THREE.SphereGeometry(1, 20, 14);

// focusNode reference for moon label click — set by focusNode itself
let _focusNodeFn = null;
export function setFocusNodeFn(fn) { _focusNodeFn = fn; }

export function buildMoons(centerNode) {
  clearMoons();
  const neighbors = getNeighborNames(centerNode).slice(0, 10);
  const count     = neighbors.length;
  if (!count) return;

  const baseOrbitR = centerNode.size * 2.2 * 1.0 + 55; // orbit radius from planet surface

  neighbors.forEach((name, i) => {
    const n = nodeMap.get(name);
    if (!n) return;

    const col    = new THREE.Color(DOMAINS[n.domain]?.color || '#aaaaaa');
    const mSize  = Math.max(2, n.size * 2.2 * 0.19); // 50% smaller

    // Orbit parameters — stagger inclinations & radii for 3D spread
    const orbitR   = baseOrbitR + (i % 3) * 22;
    const incl     = (i / count) * Math.PI * 0.9 - Math.PI * 0.45;
    const phase    = (i / count) * Math.PI * 2;
    const speed    = 0.0004 + (i * 0.000031);
    const hasRing  = Math.random() < 0.35; // ~1 in 3 moons gets a ring

    // ── Core moon sphere ─────────────────────────────────────────────────────
    const mat = new THREE.MeshPhongMaterial({
      color:    col,
      emissive: col,
      emissiveIntensity: 0.55,
      shininess: 60,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(moonSphereGeo, mat);
    mesh.scale.setScalar(mSize);
    mesh.userData.moonNode = n;
    scene.add(mesh);
    moonMeshes.push(mesh);

    // ── Glowing halo shell ───────────────────────────────────────────────────
    const haloMat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(moonHaloGeo, haloMat);
    halo.scale.setScalar(mSize * 2.0);
    scene.add(halo);

    // ── Orbital ring — only on randomly selected moons ───────────────────────
    let ring = null, ringMat = null;
    if (hasRing) {
      ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      ring = new THREE.Mesh(moonRingGeo, ringMat);
      ring.scale.setScalar(mSize);
      scene.add(ring);
    }

    // ── HTML label ───────────────────────────────────────────────────────────
    const label = document.createElement('div');
    label.className    = 'moon-label';
    label.textContent  = n.id;
    label.style.color  = DOMAINS[n.domain]?.color || '#e8d89a';
    label.dataset.moonIdx = moonData.length;
    label.addEventListener('click', e => {
      e.stopPropagation();
      if (_focusNodeFn) _focusNodeFn(n);
    });
    document.body.appendChild(label);

    moonData.push({ n, mesh, halo, ring, mat, haloMat, ringMat, label,
                    orbitR, incl, phase, speed, mSize, angle: phase, hasRing,
                    moonAlpha: 0, fadeDelay: i * 80 + 600 }); // staggered fade-in
  });
}

export function clearMoons() {
  moonData.forEach(m => {
    scene.remove(m.mesh);  m.mat.dispose();
    scene.remove(m.halo);  m.haloMat.dispose();
    if (m.ring) { scene.remove(m.ring); m.ringMat.dispose(); }
    m.label.remove();
  });
  moonData = [];
  moonMeshes.length = 0;
}

export function updateMoons() {
  if (!moonData.length) return;
  const cx = focusedNode.x, cy = focusedNode.y, cz = focusedNode.z;
  const now = performance.now();

  moonData.forEach(m => {
    // Staggered fade-in per moon
    if (m._spawnTime === undefined) m._spawnTime = now;
    const elapsed = now - m._spawnTime;
    const targetAlpha = elapsed > m.fadeDelay ? 1.0 : 0.0;
    m.moonAlpha += (targetAlpha - m.moonAlpha) * 0.055;

    m.mat.opacity = m.moonAlpha;

    m.angle += m.speed;

    const cosI = Math.cos(m.incl), sinI = Math.sin(m.incl);
    const ox = Math.cos(m.angle) * m.orbitR;
    const oy = Math.sin(m.angle) * m.orbitR * sinI;
    const oz = Math.sin(m.angle) * m.orbitR * cosI;
    const wx = cx + ox, wy = cy + oy, wz = cz + oz;

    m.mesh.position.set(wx, wy, wz);
    m.mesh.rotation.y += 0.008;
    m.halo.position.set(wx, wy, wz);

    if (m.ring) {
      m.ring.position.set(wx, wy, wz);
      m.ring.rotation.x = Math.PI / 2 + m.incl * 0.6;
      m.ring.rotation.z = m.angle * 0.3;
      m.ringMat.opacity = m.moonAlpha * 0.55;
    }

    const t = now * 0.001;
    m.haloMat.opacity = m.moonAlpha * (0.12 + Math.sin(t * 1.1 + m.phase) * 0.07);

    const sp = toScreen(new THREE.Vector3(wx, wy, wz));
    const vis = sp.x > 0 && sp.x < window.innerWidth && sp.y > 0 && sp.y < window.innerHeight;
    m.label.style.left    = sp.x + 'px';
    m.label.style.top     = (sp.y + m.mSize + 8) + 'px';
    m.label.style.opacity = vis ? (m.moonAlpha * 0.9).toFixed(3) : '0';
  });
}

// ─── FOCUS LABEL ────────────────────────────────────────────────────────────
const focusLabelEl = document.createElement('div');
focusLabelEl.id = 'focus-label';
focusLabelEl.style.cssText = `
  position: fixed;
  pointer-events: none;
  z-index: 120;
  text-align: center;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.35s ease;
  font-family: 'Cinzel', serif;
  font-size: clamp(16px, 2.2vw, 32px);
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.25;
  color: #f0e4b0;
  text-shadow:
    0 0 18px rgba(0,0,0,1),
    0 0 8px  rgba(0,0,0,1),
    0 2px 4px rgba(0,0,0,0.9);
  max-width: 220px;
  white-space: normal;
  word-break: break-word;
`;
document.body.appendChild(focusLabelEl);

function applyFocusLabel(n) {
  focusLabelEl.textContent = n.id;
  focusLabelEl.style.color = DOMAINS[n.domain]?.color || '#f0e4b0';
  focusLabelEl.style.opacity = '0'; // panel shows name — label hidden while focused
}

export function clearFocusLabel() {
  focusLabelEl.style.opacity = '0';
}

// Called every frame to keep label locked in front of the focused node
export function updateFocusLabelPos() {
  if (!focusedNode) return;
  const pos = new THREE.Vector3(focusedNode.x, focusedNode.y, focusedNode.z);
  const r = focusedNode.size * 2.2; // sphere radius in world units
  const toCamera = camera.position.clone().sub(pos).normalize();
  const frontPos = pos.clone().add(toCamera.multiplyScalar(r * 1.35));
  const v = frontPos.project(camera);
  const sx = (v.x + 1) / 2 * window.innerWidth;
  const sy = -(v.y - 1) / 2 * window.innerHeight;
  focusLabelEl.style.left = sx + 'px';
  focusLabelEl.style.top  = sy + 'px';
}

// ─── FOCUS NODE ─────────────────────────────────────────────────────────────
// showInfo callback is set from ui.js to avoid circular dependency
let _showInfoFn = null;
export function setShowInfoFn(fn) { _showInfoFn = fn; }

export function focusNode(n) {
  if (focusedNode) {
    delete focusedNode._restX;
    delete focusedNode._restY;
    delete focusedNode._restZ;
    delete focusedNode._floatStart;
    clearFocusLabel();
    clearFocusEdges();
    clearMoons();
    resetDim();
  }
  focusCamAnim = null;
  focusedNode  = n;
  n._restX = n.x; n._restY = n.y; n._restZ = n.z;
  n._floatStart = undefined;
  dimToNeighbors(n);
  buildFocusEdges(n);
  buildMoons(n);
  playChime(n.domain);
  applyFocusLabel(n);
  startFocusCamAnim(new THREE.Vector3(n.x, n.y, n.z));
  setTimeout(() => {
    if (focusedNode === n) {
      const sp = getNodeScreenPos(n);
      if (_showInfoFn) _showInfoFn(n, sp.x, sp.y);
    }
  }, 700);
}

// Register self-reference for moon label clicks
setFocusNodeFn(focusNode);

export function unfocusNode() {
  if (!focusedNode) return;
  delete focusedNode._restX; delete focusedNode._restY; delete focusedNode._restZ;
  delete focusedNode._floatStart;
  focusCamAnim = null;
  clearFocusLabel(); clearFocusEdges(); clearMoons();
  focusedNode = null;
  resetDim();
}
