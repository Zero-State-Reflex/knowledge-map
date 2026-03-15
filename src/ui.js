// ─── UI MODULE (ENTRY POINT) ─────────────────────────────────────────────────
// Panels, labels, legend, title sprite, hover, click handlers, audio controls,
// wiki images, the main animate loop.

import * as THREE from 'three';
import { DOMAINS, NODE_DESCRIPTIONS } from './data.js';
import { startAudio, audioCtx } from './audio.js';
import { renderer, scene, camera } from './scene.js';
import {
  nodes, nodeMap, links, nodeMeshes,
  edgeMat, edgeGeo, edgePosArr,
  neighborMap, updatePulses, simTick, updateScene,
  hoverForces, setFocusedNodeGetter,
  focusEdgeLinks, focusEdgeGeo, focusEdgePosArr,
  deferTextureGeneration,
} from './graph.js';
import {
  focusedNode, focusNode, unfocusNode,
  camTheta, camPhi, camRadius, lookTarget,
  setCamTheta, setCamPhi, setCamRadius,
  isDragging, setIsDragging,
  prevX, prevY, setPrevX, setPrevY,
  mouseDownX, mouseDownY, setMouseDownX, setMouseDownY,
  lastInteraction, setLastInteraction,
  RESUME_DELAY,
  setCamFromSpherical,
  camAnim, setCamAnim, animateCamTo,
  focusCamAnim, setFocusCamAnim, startFocusCamAnim,
  raycaster, mouse2d,
  hoveredNode, setHoveredNode,
  toScreen, getNodeScreenPos,
  moonMeshes, moonData, updateMoons,
  clearFocusLabel, updateFocusLabelPos,
  tickDim, resetDim, clearMoons,
  dimToNeighbors,
  getNeighborNames,
  setShowInfoFn,
  _v3a, _v3b,
} from './focus.js';

// ─── Wire up the focusedNode getter for the simulation ──────────────────────
setFocusedNodeGetter(() => focusedNode);

// ─── LEGEND ─────────────────────────────────────────────────────────────────
const legendEl = document.getElementById('legend');
Object.entries(DOMAINS).forEach(([name, d]) => {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `<div class="legend-dot" style="background:${d.color}"></div><span>${name}</span>`;
  item.addEventListener('click', () => {
    // Focus the largest node in this domain
    const domainNodes = nodes.filter(n => n.domain === name).sort((a, b) => b.size - a.size);
    if (domainNodes.length) focusNode(domainNodes[0]);
  });
  legendEl.appendChild(item);
});

// ─── HOVER ──────────────────────────────────────────────────────────────────
const hoverLabelEl = document.getElementById('hover-label');
const _closest = new THREE.Vector3();

function doHover(e) {
  mouse2d.x = (e.clientX / window.innerWidth)  * 2 - 1;
  mouse2d.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse2d, camera);
  const ray = raycaster.ray;

  // Raycast for exact hits
  const hits = raycaster.intersectObjects(nodeMeshes);
  const newHover = hits.length ? hits[0].object.userData.node : null;

  if (hoveredNode !== newHover) {
    if (hoveredNode && hoveredNode !== focusedNode) {
      hoveredNode.mesh.material.emissiveIntensity = 0.015;
    }
    setHoveredNode(newHover);
    if (newHover) {
      newHover.mesh.material.emissiveIntensity = 0.1;
      const sp = toScreen(new THREE.Vector3(newHover.x, newHover.y, newHover.z));
      hoverLabelEl.style.left  = sp.x + 'px';
      hoverLabelEl.style.top   = (sp.y - 34) + 'px';
      hoverLabelEl.textContent = newHover.id;
      hoverLabelEl.style.opacity = '1';
    } else {
      hoverLabelEl.style.opacity = '0';
    }
  } else if (hoveredNode) {
    // Keep label position updated
    const sp = toScreen(new THREE.Vector3(hoveredNode.x, hoveredNode.y, hoveredNode.z));
    hoverLabelEl.style.left = sp.x + 'px';
    hoverLabelEl.style.top  = (sp.y - 34) + 'px';
  }

  // Hover attraction: attract nearby nodes toward mouse ray (skip focused node)
  const attractedThisFrame = new Set();
  for (const n of nodes) {
    if (focusedNode && n.id === focusedNode.id) continue;
    const nPos = _v3a.set(n.x, n.y, n.z);
    ray.closestPointToPoint(nPos, _closest);
    const dist = nPos.distanceTo(_closest);
    const maxR = 130;
    if (dist < maxR) {
      const strength = Math.pow(1 - dist / maxR, 2) * 2.2;
      const dir = _v3b.copy(_closest).sub(nPos);
      const len = dir.length();
      if (len > 0.01) {
        dir.divideScalar(len);
        hoverForces.set(n.id, { x: dir.x * strength, y: dir.y * strength, z: dir.z * strength });
        attractedThisFrame.add(n.id);
        n._wasAttracted = true;
        delete n._hoverReleaseTime;
      }
    }
  }
  // Stamp release time on nodes that just left the attraction zone
  for (const n of nodes) {
    if (n._wasAttracted && !attractedThisFrame.has(n.id)) {
      n._hoverReleaseTime = performance.now();
      delete n._wasAttracted;
    }
  }
}

// ─── INFO PANEL ─────────────────────────────────────────────────────────────
const nodeInfoEl   = document.getElementById('node-info');
const nodeInfoName = document.getElementById('node-info-name');
const nodeInfoDom  = document.getElementById('node-info-domain');
const nodeInfoDesc = document.getElementById('node-info-desc');
const nodeInfoRelated = document.getElementById('node-info-related');
const nodeInfoWiki    = document.getElementById('node-info-wiki');
const leaderLine = document.getElementById('leader-line');
const leaderDot  = document.getElementById('leader-dot');

function positionPanel(screenX, screenY) {
  const panel = nodeInfoEl;
  const W = window.innerWidth, H = window.innerHeight;
  const pw = 576, ph = panel.offsetHeight || 320;
  const margin = 28;

  const goRight = screenX < W / 2;
  const goDown  = screenY < H / 2;

  const panelX = goRight ? margin : W - pw - margin;
  const panelY = goDown  ? margin + 60 : H - ph - margin;

  const clampedX = Math.max(margin, Math.min(W - pw - margin, panelX));
  const clampedY = Math.max(margin, Math.min(H - ph - margin, panelY));

  panel.style.left = clampedX + 'px';
  panel.style.top  = clampedY + 'px';

  const anchorX = goRight ? clampedX + pw : clampedX;
  const anchorY = Math.max(clampedY + 20, Math.min(clampedY + ph - 20, screenY));

  leaderLine.setAttribute('x1', screenX);
  leaderLine.setAttribute('y1', screenY);
  leaderLine.setAttribute('x2', anchorX);
  leaderLine.setAttribute('y2', anchorY);
  leaderDot.setAttribute('cx', screenX);
  leaderDot.setAttribute('cy', screenY);
}

// Wikipedia image cache
const wikiImageCache = new Map();

async function fetchWikiImage(title) {
  if (wikiImageCache.has(title)) return wikiImageCache.get(title);
  const cleanTitle = title.replace(/\s*\((?:Med|Interdis\.)\)\s*$/, '').trim();
  const slug = encodeURIComponent(cleanTitle.replace(/ /g, '_'));
  const api = 'https://en.wikipedia.org/w/api.php';
  try {
    const r1 = await fetch(`${api}?action=query&titles=${slug}&prop=pageimages&piprop=thumbnail&pithumbsize=500&format=json&origin=*`);
    const d1 = await r1.json();
    const p1 = Object.values(d1?.query?.pages || {})[0];
    if (p1?.thumbnail?.source) {
      wikiImageCache.set(title, p1.thumbnail.source);
      return p1.thumbnail.source;
    }
    const r2 = await fetch(`${api}?action=query&titles=${slug}&prop=images&imlimit=15&format=json&origin=*`);
    const d2 = await r2.json();
    const p2 = Object.values(d2?.query?.pages || {})[0];
    const imgs = (p2?.images || [])
      .map(im => im.title)
      .filter(t => /\.(jpg|jpeg|png|gif)$/i.test(t))
      .filter(t => !/icon|logo|symbol|flag|edit|lock|question|disambig|commons|stub|wiki/i.test(t));
    if (imgs.length === 0) { wikiImageCache.set(title, ''); return ''; }
    const fileSlug = encodeURIComponent(imgs[0]);
    const r3 = await fetch(`${api}?action=query&titles=${fileSlug}&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`);
    const d3 = await r3.json();
    const p3 = Object.values(d3?.query?.pages || {})[0];
    const thumb = p3?.imageinfo?.[0]?.thumburl || '';
    wikiImageCache.set(title, thumb);
    return thumb;
  } catch(e) { wikiImageCache.set(title, ''); return ''; }
}

function makePlaceholderSVG(color, label) {
  let seed = 0;
  for (let i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) & 0xfffffff;
  const r = (n) => { seed = (seed * 16807) % 2147483647; return ((seed - 1) / 2147483646) * n; };

  const hex = color.replace('#', '');
  const cr = parseInt(hex.slice(0,2), 16);
  const cg = parseInt(hex.slice(2,4), 16);
  const cb = parseInt(hex.slice(4,6), 16);

  let shapes = '';
  shapes += `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="rgb(${Math.round(cr*0.15)},${Math.round(cg*0.15)},${Math.round(cb*0.15)})"/>
    <stop offset="100%" stop-color="rgb(${Math.round(cr*0.08)},${Math.round(cg*0.08)},${Math.round(cb*0.08)})"/>
  </linearGradient></defs>`;
  shapes += `<rect width="560" height="110" fill="url(#bg)"/>`;

  for (let x = 20; x < 560; x += 30 + r(20)) {
    for (let y = 15; y < 110; y += 25 + r(15)) {
      const opacity = 0.03 + r(0.06);
      shapes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${1 + r(1.5)}" fill="rgba(${cr},${cg},${cb},${opacity.toFixed(3)})"/>`;
    }
  }

  for (let i = 0; i < 4; i++) {
    const cx = 60 + r(440), cy = 15 + r(80), radius = 15 + r(40);
    shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="none" stroke="rgba(${cr},${cg},${cb},${(0.06 + r(0.08)).toFixed(3)})" stroke-width="${0.5 + r(1)}"/>`;
  }

  for (let i = 0; i < 3; i++) {
    const x1 = r(560), y1 = r(110), x2 = r(560), y2 = r(110);
    shapes += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(${cr},${cg},${cb},${(0.04 + r(0.06)).toFixed(3)})" stroke-width="0.5"/>`;
  }

  shapes += `<ellipse cx="280" cy="55" rx="${80 + r(60)}" ry="${30 + r(20)}" fill="rgba(${cr},${cg},${cb},0.04)"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="110" viewBox="0 0 560 110">${shapes}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

function showInfo(n, screenX, screenY) {
  nodeInfoName.textContent = n.id;
  nodeInfoDom.textContent  = n.domain;
  nodeInfoDom.style.color  = DOMAINS[n.domain]?.color || '#aaa';
  nodeInfoDesc.textContent = NODE_DESCRIPTIONS[n.id] || '';

  // Wikipedia image
  const imgWrap = document.getElementById('node-info-img-wrap');
  const imgEl   = document.getElementById('node-info-img');
  imgWrap.classList.remove('visible');
  imgEl.classList.remove('loaded');
  imgEl.src = '';

  const domainColor = DOMAINS[n.domain]?.color || '#c8b89a';
  fetchWikiImage(n.id).then(url => {
    if (focusedNode !== n) return;
    if (url) {
      imgEl.src = url;
      imgEl.alt = n.id;
      imgWrap.classList.add('visible');
      imgEl.onload = () => imgEl.classList.add('loaded');
      imgEl.onerror = () => {
        imgEl.src = makePlaceholderSVG(domainColor, n.id);
        imgWrap.classList.add('visible');
        imgEl.onload = () => imgEl.classList.add('loaded');
      };
    } else {
      imgEl.src = makePlaceholderSVG(domainColor, n.id);
      imgEl.alt = n.id;
      imgWrap.classList.add('visible');
      imgEl.onload = () => imgEl.classList.add('loaded');
    }
  });

  const wikiSlug = encodeURIComponent(n.id.replace(/ /g, '_'));
  nodeInfoWiki.href = `https://en.wikipedia.org/wiki/${wikiSlug}`;
  nodeInfoWiki.textContent = `\u2197 Wikipedia: ${n.id}`;

  nodeInfoRelated.innerHTML = '';
  const neighbors = getNeighborNames(n).slice(0, 12);
  neighbors.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'related-chip';
    chip.textContent = name;
    const col = DOMAINS[nodeMap.get(name)?.domain]?.color || '#aaa';
    chip.style.borderColor = col + '55';
    chip.addEventListener('click', e => {
      e.stopPropagation();
      focusNode(nodeMap.get(name));
    });
    nodeInfoRelated.appendChild(chip);
  });

  nodeInfoEl.classList.add('visible');
  leaderLine.style.display = 'block';
  leaderDot.style.display  = 'block';

  requestAnimationFrame(() => positionPanel(screenX, screenY));
}

// Register showInfo with focus module
setShowInfoFn(showInfo);

function hideInfo() {
  nodeInfoEl.classList.remove('visible');
  leaderLine.style.display = 'none';
  leaderDot.style.display  = 'none';
}

// Hide leader initially
leaderLine.style.display = 'none';
leaderDot.style.display  = 'none';

// ─── CANVAS EVENT HANDLERS ──────────────────────────────────────────────────
const canvas = document.getElementById('c');

canvas.addEventListener('pointerdown', e => {
  if (e.target !== canvas) return;
  setIsDragging(true);
  setLastInteraction(performance.now());
  setPrevX(e.clientX); setMouseDownX(e.clientX);
  setPrevY(e.clientY); setMouseDownY(e.clientY);
  canvas.setPointerCapture(e.pointerId);
  if (camAnim) setCamAnim(null);
});
canvas.addEventListener('pointerup', e => {
  setIsDragging(false);
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (isDragging) {
    const dx = e.clientX - prevX, dy = e.clientY - prevY;
    setCamTheta(camTheta - dx * 0.006);
    setCamPhi(Math.max(0.08, Math.min(Math.PI - 0.08, camPhi - dy * 0.006)));
    setPrevX(e.clientX); setPrevY(e.clientY);
    setCamFromSpherical();
  }
  doHover(e);
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  setCamRadius(Math.max(180, Math.min(5000, camRadius * (1 + e.deltaY * 0.0018))));
  setCamFromSpherical();
}, { passive: false });

// ─── CLICK / FOCUS ──────────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  const dx = e.clientX - mouseDownX, dy = e.clientY - mouseDownY;
  if (Math.sqrt(dx*dx + dy*dy) > 6) return;

  mouse2d.x = (e.clientX / window.innerWidth)  * 2 - 1;
  mouse2d.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse2d, camera);

  // Check moons first
  if (moonMeshes.length) {
    const moonHits = raycaster.intersectObjects(moonMeshes);
    if (moonHits.length > 0) {
      const moonNode = moonHits[0].object.userData.moonNode;
      if (moonNode) { focusNode(moonNode); return; }
    }
  }

  const hits = raycaster.intersectObjects(nodeMeshes);

  if (hits.length > 0) {
    const n = hits[0].object.userData.node;
    if (focusedNode === n) {
      unfocusNode();
      hideInfo();
      const endPos = new THREE.Vector3(
        camRadius * Math.sin(camPhi) * Math.sin(camTheta),
        camRadius * Math.cos(camPhi),
        camRadius * Math.sin(camPhi) * Math.cos(camTheta)
      );
      animateCamTo(endPos, new THREE.Vector3(0,0,0), 70);
    } else {
      focusNode(n);
    }
  } else if (focusedNode) {
    unfocusNode();
    hideInfo();
    const endPos = new THREE.Vector3(
      camRadius * Math.sin(camPhi) * Math.sin(camTheta),
      camRadius * Math.cos(camPhi),
      camRadius * Math.sin(camPhi) * Math.cos(camTheta)
    );
    animateCamTo(endPos, new THREE.Vector3(0,0,0), 70);
  }
});

// Boot audio on first user interaction
document.addEventListener('pointerdown', () => startAudio(), { once: true });

// ─── MAIN ANIMATE LOOP ─────────────────────────────────────────────────────
let texturesQueued = false;
function animate() {
  requestAnimationFrame(animate);

  // After first render, kick off deferred texture generation
  if (!texturesQueued) {
    texturesQueued = true;
    deferTextureGeneration();
  }

  if (window._starTwinkle) window._starTwinkle();
  if (window._bhTick) window._bhTick();
  simTick();
  tickDim();
  updateScene(focusedNode);
  updateMoons();
  updatePulses();

  // Suppress auto-rotation entirely while a node is focused
  const canAutoRotate = !focusedNode && !focusCamAnim;

  // General camera animation (unfocus)
  if (camAnim) {
    camAnim.t++;
    const t    = Math.min(camAnim.t / camAnim.frames, 1);
    const ease = t < 0.5 ? 2*t*t : -1 + (4-2*t)*t;
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, ease);
    lookTarget.lerpVectors(camAnim.startLook, camAnim.endLook, ease);
    camera.lookAt(lookTarget);
    if (camAnim.t >= camAnim.frames) {
      setCamAnim(null);
      // Sync spherical coords from final camera position after unfocus
      const p = camera.position;
      setCamRadius(p.length());
      setCamPhi(Math.acos(Math.max(-1, Math.min(1, p.y / camRadius))));
      setCamTheta(Math.atan2(p.x, p.z));
    }
  }

  // Two-phase focus camera: zoom in -> pull back 25%
  if (focusCamAnim) {
    const fc = focusCamAnim;
    fc.t++;

    // Keep nodePos locked to where the float will settle
    if (focusedNode) {
      fc.nodePos.set(focusedNode.x, focusedNode.y, focusedNode.z);
      const dir = fc.startPos.clone().sub(fc.nodePos).normalize();
      fc.closePos.copy(fc.nodePos).addScaledVector(dir, 180);
      fc.holdPos .copy(fc.nodePos).addScaledVector(dir, 230);
    }

    if (fc.phase === 'zoomIn') {
      const raw  = Math.min(fc.t / fc.zoomFrames, 1);
      const ease = 1 - Math.pow(1 - raw, 3); // cubic ease-out
      camera.position.lerpVectors(fc.startPos, fc.closePos, ease);
      lookTarget.lerp(fc.nodePos, 0.08);
      camera.lookAt(lookTarget);
      if (fc.t >= fc.zoomFrames) {
        fc.phase     = 'pullBack';
        fc.t         = 0;
        fc.pullStart = camera.position.clone();
      }

    } else if (fc.phase === 'pullBack') {
      const raw  = Math.min(fc.t / fc.pullFrames, 1);
      const ease = 0.5 - 0.5 * Math.cos(raw * Math.PI); // sine ease-in-out
      camera.position.lerpVectors(fc.pullStart, fc.holdPos, ease);
      lookTarget.lerp(fc.nodePos, 0.06);
      camera.lookAt(lookTarget);
      if (fc.t >= fc.pullFrames) {
        fc.phase = 'hold';
        // Sync spherical coords
        const p = camera.position;
        setCamRadius(p.length());
        setCamPhi(Math.acos(Math.max(-1, Math.min(1, p.y / camRadius))));
        setCamTheta(Math.atan2(p.x, p.z));
        // Lock node rest to its actual position
        if (focusedNode) {
          focusedNode._restX = focusedNode.x;
          focusedNode._restY = focusedNode.y;
          focusedNode._restZ = focusedNode.z;
          focusedNode._floatStart = undefined;
        }
      }

    } else {
      // Hold — gently track the floating node without jitter
      if (focusedNode) {
        lookTarget.lerp(new THREE.Vector3(focusedNode.x, focusedNode.y, focusedNode.z), 0.03);
        camera.lookAt(lookTarget);
      }
    }
  }

  // Auto-rotation — suppressed while focused
  if (canAutoRotate) {
    const idle = !isDragging && (performance.now() - lastInteraction > RESUME_DELAY);
    const rotBlend = idle ? Math.min(1, (performance.now() - lastInteraction - RESUME_DELAY) / 1200) : 0;
    if (rotBlend > 0) {
      setCamTheta(camTheta + 0.00045 * rotBlend);
      setCamPhi(Math.max(0.08, Math.min(Math.PI - 0.08,
        camPhi + Math.sin(performance.now() * 0.00008) * 0.00012 * rotBlend
      )));
      setCamFromSpherical();
    }
  }

  renderer.render(scene, camera);
  updateFocusLabelPos();
  // Keep leader dot locked on node surface
  if (focusedNode && nodeInfoEl.classList.contains('visible')) {
    const sp = getNodeScreenPos(focusedNode);
    leaderDot.setAttribute('cx', sp.x);
    leaderDot.setAttribute('cy', sp.y);
    leaderLine.setAttribute('x1', sp.x);
    leaderLine.setAttribute('y1', sp.y);
  }
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── AUDIO CONTROLS ──────────────────────────────────────────────────────────
const volSlider = document.getElementById('vol-slider');
const muteBtn   = document.getElementById('mute-btn');
let isMuted     = false;
let lastVolume  = parseFloat(volSlider.value);

function updateSliderTrack(val) {
  volSlider.style.setProperty('--pct', (val * 100).toFixed(1) + '%');
}
updateSliderTrack(lastVolume);

volSlider.addEventListener('input', () => {
  lastVolume = parseFloat(volSlider.value);
  updateSliderTrack(lastVolume);
  if (audioCtx?._masterGain) {
    audioCtx._masterGain.gain.setTargetAtTime(isMuted ? 0 : lastVolume, audioCtx.currentTime, 0.05);
  }
  if (lastVolume > 0 && isMuted) {
    isMuted = false;
    muteBtn.textContent = '\u266A';
    muteBtn.style.opacity = '1';
  }
});

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  if (audioCtx?._masterGain) {
    audioCtx._masterGain.gain.setTargetAtTime(isMuted ? 0 : lastVolume, audioCtx.currentTime, 0.08);
  }
  muteBtn.textContent = isMuted ? '\u2669' : '\u266A';
  muteBtn.style.opacity = isMuted ? '0.35' : '1';
});

// ─── TITLE SPRITE ─────────────────────────────────────────────────────────────
(function() {
  const spriteCanvas  = document.getElementById('title-sprite');
  const ctx     = spriteCanvas.getContext('2d');
  const titleEl = document.getElementById('title');

  function resize() {
    spriteCanvas.width  = window.innerWidth;
    spriteCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  let spriteT      = 0;
  let spriteActive = false;
  let spriteSpeed  = 0;
  let nextLaunch   = 0;
  const TAIL_LEN   = 0.055;

  function scheduleNext() {
    nextLaunch = performance.now() + 4000 + Math.random() * 10000;
    spriteActive = false;
  }
  scheduleNext();
  nextLaunch = performance.now() + 1800;

  function tick(now) {
    requestAnimationFrame(tick);

    const rect = titleEl.getBoundingClientRect();
    const x0   = rect.left;
    const x1   = rect.right;
    const y    = rect.top + rect.height * 0.82;
    const W    = x1 - x0;

    ctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);

    if (!spriteActive) {
      if (now >= nextLaunch) {
        spriteActive = true;
        spriteT      = 0;
        spriteSpeed  = 1 / ((6 + Math.random() * 5) * 60);
      }
      return;
    }

    spriteT += spriteSpeed;
    if (spriteT > 1 + TAIL_LEN) { scheduleNext(); return; }

    const headX = x0 + spriteT * W;
    const tailX = x0 + Math.max(0, spriteT - TAIL_LEN) * W;

    const fadeIn  = Math.min(spriteT / (TAIL_LEN * 0.6), 1);
    const fadeOut = Math.min((1 - spriteT) / 0.08 + 0.001, 1);
    const alpha   = Math.min(fadeIn, fadeOut) * 0.72;

    const grad = ctx.createLinearGradient(tailX, y, headX, y);
    grad.addColorStop(0,   `rgba(232,216,154,0)`);
    grad.addColorStop(0.6, `rgba(232,216,154,${(alpha * 0.3).toFixed(3)})`);
    grad.addColorStop(1,   `rgba(255,245,200,${alpha.toFixed(3)})`);

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = 'rgba(255,240,180,0.9)';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.moveTo(tailX, y);
    ctx.lineTo(headX, y);
    ctx.stroke();

    if (spriteT <= 1) {
      const radial = ctx.createRadialGradient(headX, y, 0, headX, y, 5);
      radial.addColorStop(0,   `rgba(255,255,220,${alpha.toFixed(3)})`);
      radial.addColorStop(0.4, `rgba(232,216,154,${(alpha * 0.5).toFixed(3)})`);
      radial.addColorStop(1,   'rgba(232,216,154,0)');
      ctx.fillStyle  = radial;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(headX, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  requestAnimationFrame(tick);
})();
