// ─── PROCEDURAL PLANET TEXTURES ─────────────────────────────────────────────
import * as THREE from 'three';

// Simple seeded pseudo-random
export function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

// Smooth noise via bilinear lerp on random grid
export function buildNoise(rng, gw, gh) {
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return (u, v) => {
    const x = ((u % 1 + 1) % 1) * (gw - 1);
    const y = ((v % 1 + 1) % 1) * (gh - 1);
    const x0 = Math.floor(x) % gw, y0 = Math.floor(y) % gh;
    const x1 = (x0 + 1) % gw,      y1 = (y0 + 1) % gh;
    const fx = x - Math.floor(x),   fy = y - Math.floor(y);
    const s = t => t * t * (3 - 2 * t);
    return grid[y0*gw+x0]*(1-s(fx))*(1-s(fy)) + grid[y0*gw+x1]*s(fx)*(1-s(fy))
         + grid[y1*gw+x0]*(1-s(fx))*s(fy)     + grid[y1*gw+x1]*s(fx)*s(fy);
  };
}

export function fbm(noise, u, v, oct, lac, gain) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < oct; i++) {
    val += noise(u * freq, v * freq) * amp;
    freq *= lac; amp *= gain;
  }
  return val;
}

// Domain -> planet archetype
export const PLANET_TYPES = {
  "Formal Sciences":           "ice",
  "Physical Sciences":         "gas_blue",
  "Earth & Space":             "rocky_orange",
  "Life Sciences":             "jungle",
  "Chemistry":                 "acid",
  "Medicine & Health":         "terracotta",
  "Social Sciences":           "desert",
  "Humanities":                "ancient",
  "Arts & Design":             "violet_cloud",
  "Engineering & Tech":        "metallic",
  "Interdisciplinary":         "ocean",
  "Esoteric & Occult":         "dark_nebula",
  "Contemplative Traditions":  "amber_gas",
  "Indigenous & Traditional":  "verdant",
  "Consciousness & Fringe":    "plasma",
};

export const PLANET_PALETTES = {
  ice:           [[120,145,170],[80,120,155],[55,90,140],[150,175,200],[180,200,220],[40,65,110]],
  gas_blue:      [[8,25,70],[18,50,110],[45,85,140],[80,120,170],[30,40,90],[10,35,85]],
  rocky_orange:  [[60,28,8],[100,50,18],[140,75,30],[85,40,12],[45,20,5],[120,65,25]],
  jungle:        [[10,40,14],[22,65,28],[40,90,40],[15,52,20],[50,80,35],[8,30,10]],
  acid:          [[20,60,10],[45,100,18],[75,140,35],[30,80,15],[55,110,25],[90,155,45]],
  terracotta:    [[90,35,22],[130,55,35],[105,42,28],[70,28,15],[155,75,50],[50,20,10]],
  desert:        [[120,90,40],[150,120,60],[100,75,30],[85,60,25],[170,140,80],[65,45,18]],
  ancient:       [[75,55,35],[110,80,55],[90,65,42],[55,38,22],[130,100,70],[40,28,16]],
  violet_cloud:  [[40,8,60],[70,25,100],[95,40,130],[50,12,75],[120,55,160],[25,5,40]],
  metallic:      [[40,50,65],[70,82,95],[100,112,128],[30,38,52],[130,140,155],[22,28,40]],
  ocean:         [[5,18,55],[10,40,90],[25,65,120],[5,28,70],[45,90,145],[8,15,42]],
  dark_nebula:   [[30,5,42],[55,10,65],[80,22,95],[40,6,52],[110,40,130],[18,2,28]],
  amber_gas:     [[110,55,8],[150,85,25],[125,65,12],[90,42,5],[170,110,40],[70,32,4]],
  verdant:       [[15,55,25],[28,85,40],[48,110,55],[20,65,30],[60,130,65],[10,40,18]],
  plasma:        [[120,10,55],[160,30,80],[140,20,65],[100,5,42],[180,55,110],[80,4,35]],
};

export function makePlanetTexture(domain, nodeId) {
  const type  = PLANET_TYPES[domain] || 'ocean';
  const pal   = PLANET_PALETTES[type];
  const S     = 1024;
  const cv    = document.createElement('canvas');
  cv.width = S * 2; cv.height = S;
  const ctx   = cv.getContext('2d');
  const id    = ctx.createImageData(S * 2, S);
  const data  = id.data;

  // Seed from node name
  let seed = 0;
  for (let i = 0; i < nodeId.length; i++) seed = (seed * 31 + nodeId.charCodeAt(i)) & 0xfffffff;
  const rng  = seededRand(seed + 1);
  const rng2 = seededRand(seed + 99);
  const rng3 = seededRand(seed + 777);

  const n1 = buildNoise(rng,  64, 32);
  const n2 = buildNoise(rng2, 32, 64);
  const n3 = buildNoise(rng3, 128, 64);
  const rng4 = seededRand(seed + 2345);
  const n4 = buildNoise(rng4, 96, 48);

  // Type-specific rendering
  const isBanded = ['gas_blue','amber_gas','plasma','violet_cloud','dark_nebula'].includes(type);
  const isIcy    = type === 'ice';
  const isRocky  = ['rocky_orange','terracotta','ancient','desert','verdant'].includes(type);
  const numBands = 4 + Math.floor(rng() * 5);
  const stormU   = rng(); const stormV = 0.3 + rng() * 0.4;
  const stormR   = 0.04 + rng() * 0.06;
  const hasStorm = rng() > 0.35;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S * 2; px++) {
      const u = px / (S * 2);
      const v = py / S;

      let t;
      if (isBanded) {
        const warp = fbm(n1, u, v, 6, 2.1, 0.5) * 0.4;
        const band = (Math.sin((v + warp) * Math.PI * numBands) + 1) * 0.5;
        const detail = fbm(n2, u * 2, v * 2, 5, 2.0, 0.45) * 0.25;
        const micro = fbm(n4, u * 6, v * 6, 6, 2.3, 0.4) * 0.08;
        t = Math.max(0, Math.min(1, band + detail + micro));
      } else if (isRocky) {
        const crater = fbm(n3, u * 3, v * 3, 7, 2.2, 0.5);
        const base   = fbm(n1, u, v, 6, 2.0, 0.5);
        const fine   = fbm(n4, u * 8, v * 8, 6, 2.4, 0.45) * 0.12;
        t = Math.pow(Math.max(0, base * 0.55 + crater * 0.35 + fine), 0.8);
      } else if (isIcy) {
        const crack = Math.abs(fbm(n1, u * 2, v * 2, 7, 2.3, 0.5) - 0.5) * 2;
        const base  = fbm(n2, u, v, 5, 2.0, 0.4);
        const vein  = Math.abs(fbm(n4, u * 5, v * 5, 6, 2.5, 0.45) - 0.5) * 0.3;
        t = Math.max(0, Math.min(1, base * 0.45 + (1 - crack * 0.55) + vein));
      } else {
        t = fbm(n1, u * 1.5, v * 1.5, 7, 2.1, 0.5);
        const detail = fbm(n4, u * 4, v * 4, 5, 2.2, 0.45) * 0.15;
        t = Math.max(0, Math.min(1, t * 0.75 + fbm(n2, u, v, 5, 2.0, 0.5) * 0.2 + detail));
      }

      // Storm spot
      if (hasStorm) {
        const du = Math.min(Math.abs(u - stormU), 1 - Math.abs(u - stormU));
        const dv = v - stormV;
        const sd = Math.sqrt(du*du + dv*dv) / stormR;
        if (sd < 1) t = Math.max(0, Math.min(1, t * 0.3 + (1 - sd) * 0.7));
      }

      // Pick color from palette
      const ci = t * (pal.length - 1);
      const ci0 = Math.floor(ci), ci1 = Math.min(ci0 + 1, pal.length - 1);
      const cf = ci - ci0;
      const c0 = pal[ci0], c1 = pal[ci1];
      const r = Math.round(c0[0] + (c1[0]-c0[0]) * cf);
      const g = Math.round(c0[1] + (c1[1]-c0[1]) * cf);
      const b = Math.round(c0[2] + (c1[2]-c0[2]) * cf);

      // Limb darkening
      const lat  = (v - 0.5) * Math.PI;
      const limb = Math.pow(Math.cos(lat), 0.5);
      const lon = (u - 0.5) * Math.PI * 2;
      const lonLimb = 0.7 + 0.3 * Math.pow(Math.max(0, Math.cos(lon * 0.5)), 0.4);
      const totalLimb = limb * lonLimb;

      const i4 = (py * S * 2 + px) * 4;
      data[i4]   = Math.round(r * totalLimb);
      data[i4+1] = Math.round(g * totalLimb);
      data[i4+2] = Math.round(b * totalLimb);
      data[i4+3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
