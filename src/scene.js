// ─── THREE.JS SCENE SETUP ───────────────────────────────────────────────────
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─── RENDERER, SCENE, CAMERA ────────────────────────────────────────────────
const canvas = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x020408, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 12000);

// ─── STAR FIELD ──────────────────────────────────────────────────────────────
(function buildStars() {
  const STAR_COUNT = 10000;
  const RADIUS     = 9000; // far shell, always behind everything

  const positions = new Float32Array(STAR_COUNT * 3);
  const colors    = new Float32Array(STAR_COUNT * 3);
  const sizes     = new Float32Array(STAR_COUNT);

  // Star color temperatures: blue-white, white, warm yellow, faint orange
  const starTints = [
    [0.72, 0.82, 1.00],  // blue-white
    [0.95, 0.97, 1.00],  // white
    [1.00, 0.98, 0.88],  // warm white
    [1.00, 0.92, 0.70],  // yellow
    [1.00, 0.85, 0.60],  // orange
  ];

  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform random on sphere surface
    const u     = Math.random();
    const v     = Math.random();
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    positions[i*3]   = RADIUS * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = RADIUS * Math.sin(phi) * Math.sin(theta);
    positions[i*3+2] = RADIUS * Math.cos(phi);

    // Random tint, slightly dimmed
    const tint  = starTints[Math.floor(Math.random() * starTints.length)];
    const bright = 0.45 + Math.random() * 0.55;
    colors[i*3]   = tint[0] * bright;
    colors[i*3+1] = tint[1] * bright;
    colors[i*3+2] = tint[2] * bright;

    // Most stars tiny, a few larger, rare bright ones
    const r = Math.random();
    sizes[i] = r < 0.92
      ? 0.6 + Math.random() * 1.2
      : r < 0.98
        ? 1.8 + Math.random() * 2.0
        : 3.0 + Math.random() * 2.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,  1));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    sizeAttenuation: false,  // screen-space sizing so they stay crisp dots
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    size: 1.4,
  });

  scene.add(new THREE.Points(geo, mat));

  // Subtle twinkle — slowly modulate overall opacity with a soft sine
  let twinkleT = 0;
  const twinkleTick = () => {
    twinkleT += 0.004;
    mat.opacity = 0.72 + Math.sin(twinkleT) * 0.16;
  };
  // Register twinkle in animation loop via a global hook
  window._starTwinkle = twinkleTick;
})();

// ─── BLACK HOLE ───────────────────────────────────────────────────────────────
(function buildBlackHole() {
  // Position: off-center in the background star shell
  const BH_POS = new THREE.Vector3(3200, -800, -5500);

  // ── Event horizon — pure black sphere, cuts stars behind it ──────────────
  const horizonGeo = new THREE.SphereGeometry(1, 48, 36);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    depthWrite: true,
  });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.scale.setScalar(260);
  horizon.position.copy(BH_POS);
  scene.add(horizon);

  // ── Photon sphere — faint blue-white ring right at edge ───────────────────
  const photonGeo = new THREE.SphereGeometry(1, 48, 36);
  const photonMat = new THREE.MeshBasicMaterial({
    color: 0xaaccff,
    transparent: true,
    opacity: 0.06,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const photon = new THREE.Mesh(photonGeo, photonMat);
  photon.scale.setScalar(272);
  photon.position.copy(BH_POS);
  scene.add(photon);

  // ── Gravitational lensing halos — nested translucent shells ──────────────
  const haloColors  = [0x99aadd, 0x8899cc, 0x6677aa, 0x445588, 0x334477, 0x223366];
  const haloScales  = [290, 350, 430, 540, 680, 850];
  const haloOpacity = [0.05, 0.038, 0.025, 0.016, 0.009, 0.004];

  haloColors.forEach((col, i) => {
    const geo = new THREE.SphereGeometry(1, 36, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: haloOpacity[i],
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(haloScales[i]);
    mesh.position.copy(BH_POS);
    scene.add(mesh);
  });

  // ── Accretion disk — flat torus, tilted, glowing orange->white->blue ────────
  const diskLayers = [
    { inner: 270, outer: 310, color: 0xffffff, opacity: 0.18 }, // white-hot innermost
    { inner: 305, outer: 370, color: 0xffeedd, opacity: 0.24 }, // bright inner
    { inner: 365, outer: 440, color: 0xffaa44, opacity: 0.16 }, // warm orange
    { inner: 435, outer: 530, color: 0xff8833, opacity: 0.12 }, // orange mid
    { inner: 525, outer: 640, color: 0xcc5511, opacity: 0.08 }, // deep red outer
    { inner: 635, outer: 760, color: 0x993300, opacity: 0.05 }, // dark red
    { inner: 755, outer: 900, color: 0x661100, opacity: 0.025 }, // faint far edge
    { inner: 895, outer: 1050, color: 0x440800, opacity: 0.012 }, // very faint outer halo
  ];

  const diskTilt = new THREE.Euler(0.38, 0.22, 0.0); // slight tilt, not face-on

  diskLayers.forEach(layer => {
    const geo = new THREE.RingGeometry(layer.inner, layer.outer, 128, 2);
    const mat = new THREE.MeshBasicMaterial({
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(BH_POS);
    ring.rotation.copy(diskTilt);
    scene.add(ring);
  });

  // ── Disk slow rotation — store refs for animation ─────────────────────────
  const diskMeshes = [];
  diskLayers.forEach(layer => {
    // Already added above; re-create a parallel ref array via scene traversal
  });

  // ── Relativistic jets — faint beams above and below the disk ──────────────
  const jetLayers = [
    { length: 1200, radius: 18, color: 0x88aaff, opacity: 0.04 },
    { length: 800, radius: 35, color: 0x6688cc, opacity: 0.025 },
    { length: 500, radius: 55, color: 0x4466aa, opacity: 0.015 },
  ];
  const jetMeshes = [];
  jetLayers.forEach(jet => {
    const jetGeo = new THREE.CylinderGeometry(jet.radius * 0.3, jet.radius, jet.length, 12, 1, true);
    const jetMat = new THREE.MeshBasicMaterial({
      color: jet.color, transparent: true, opacity: jet.opacity,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // Top jet
    const topJet = new THREE.Mesh(jetGeo, jetMat);
    topJet.position.copy(BH_POS).add(new THREE.Vector3(0, jet.length * 0.5 + 260, 0));
    topJet.rotation.copy(diskTilt);
    scene.add(topJet);
    // Bottom jet
    const botJet = new THREE.Mesh(jetGeo, jetMat.clone());
    botJet.position.copy(BH_POS).add(new THREE.Vector3(0, -jet.length * 0.5 - 260, 0));
    botJet.rotation.copy(diskTilt);
    botJet.rotation.z += Math.PI;
    scene.add(botJet);
    jetMeshes.push(topJet, botJet);
  });

  // Animate: subtle disk shimmer via opacity oscillation + jet flicker
  let bhT = 0;
  const bhTick = () => {
    bhT += 0.0008;
    // Photon sphere pulse
    photonMat.opacity = 0.04 + Math.sin(bhT * 1.3) * 0.02;
    // Jet flicker
    jetMeshes.forEach((m, i) => {
      m.material.opacity = m.material.opacity * (0.85 + Math.sin(bhT * 2.1 + i) * 0.15);
    });
  };
  window._bhTick = bhTick;
})();

// ─── NEBULA DUST CLOUDS ──────────────────────────────────────────────────────
(function buildNebulae() {
  const nebulaColors = [
    [0x442266, 0.018], [0x224466, 0.015], [0x663322, 0.012],
    [0x336644, 0.014], [0x553344, 0.016], [0x223355, 0.013],
    [0x443322, 0.011], [0x334455, 0.010],
  ];
  const nebulaGeo = new THREE.PlaneGeometry(1, 1);
  const nebulaCount = 14;

  for (let i = 0; i < nebulaCount; i++) {
    const [color, opacity] = nebulaColors[i % nebulaColors.length];
    // Create a soft radial gradient texture
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    const c = new THREE.Color(color);
    grad.addColorStop(0, `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},1)`);
    grad.addColorStop(0.4, `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.5)`);
    grad.addColorStop(1, `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: opacity,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(nebulaGeo, mat);

    // Random position on far shell
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 4000 + Math.random() * 3000;
    mesh.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    mesh.lookAt(0, 0, 0);
    const scale = 1200 + Math.random() * 2400;
    mesh.scale.set(scale, scale * (0.6 + Math.random() * 0.8), 1);
    mesh.rotation.z = Math.random() * Math.PI;
    scene.add(mesh);
  }
})();


scene.add(new THREE.AmbientLight(0x0a1020, 1.8));
// Warm key light — like a distant star
const light1 = new THREE.PointLight(0xffd4a0, 1.4, 6000);
light1.position.set(800, 1200, 600);
scene.add(light1);
// Cool fill — opposite side for color contrast
const light2 = new THREE.PointLight(0x2244aa, 0.5, 5000);
light2.position.set(-900, -500, -500);
scene.add(light2);
// Dim rim from below — subtle depth cue
const light3 = new THREE.PointLight(0x664422, 0.3, 4000);
light3.position.set(0, -1000, 300);
scene.add(light3);

// ─── POST-PROCESSING: Bloom ─────────────────────────────────────────────────
export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35,   // strength — subtle glow
  0.6,    // radius — how far bloom spreads
  0.75    // threshold — only bright things bloom
);
composer.addPass(bloomPass);
export { bloomPass };
