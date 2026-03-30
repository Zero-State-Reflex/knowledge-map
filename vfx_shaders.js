// ═══════════════════════════════════════════════════════════════════════════════
// VFX SHADERS — Copy-paste ready for km_vr_phase*.html
// All effects: NO EffectComposer, NO post-processing, Quest 3 safe
// THREE r152 global build — uses THREE.ShaderMaterial, THREE.Mesh, etc.
//
// INTEGRATION: Each section is a self-contained function.
// Call it from your init code, store the returned tick function,
// call tick(time) in your animate() loop.
//
// BUDGET NOTES (from CLAUDE.md):
//   - < 200 draw calls total
//   - < 100k triangles
//   - sizeAttenuation: false for Points
//   - No EffectComposer / UnrealBloomPass
//   - Skip expensive effects in VR (check isInXR())
// ═══════════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────────
// 1. PROCEDURAL SPACE SKYBOX — Drop-in replacement for star sphere
//    Returns: { mesh, tick(time) }
//    Budget: 1 draw call, ~4k tris
// ─────────────────────────────────────────────────────────────────────────────
function createSpaceSkybox(radius) {
  radius = radius || 4500; // stays inside your far plane
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                   mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p) {
        float v=0.0, a=0.5;
        mat2 rot = mat2(0.877,0.479,-0.479,0.877);
        for(int i=0;i<5;i++){v+=a*noise(p);p=rot*p*2.0;a*=0.5;}
        return v;
      }

      float stars(vec2 uv, float density) {
        vec2 cell = floor(uv*density);
        vec2 f = fract(uv*density);
        float d = 1.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 nb=vec2(float(x),float(y));
          vec2 pt=vec2(hash(cell+nb),hash(cell+nb+100.0));
          d=min(d,length(nb+pt-f));
        }
        float b = 1.0-smoothstep(0.0,0.03,d);
        float tw = sin(uTime*2.0+hash(cell)*6.28)*0.3+0.7;
        return b * step(0.93,hash(cell+42.0)) * tw;
      }

      void main() {
        vec3 dir = normalize(vDir);
        float phi = atan(dir.z, dir.x);
        float theta = acos(dir.y);
        vec2 skyUv = vec2(phi/6.2832+0.5, theta/3.1416);

        // Deep space base
        vec3 col = vec3(0.01, 0.005, 0.02);

        // Milky Way band
        vec3 milkyAxis = normalize(vec3(0.3, 1.0, 0.1));
        float band = 1.0-smoothstep(0.0, 0.35, abs(dot(dir, milkyAxis)));
        vec2 mUv = vec2(phi*3.0, theta*2.0);
        float mn = fbm(mUv*2.0+uTime*0.01);
        float dust = smoothstep(0.35,0.65,fbm(mUv*3.5+10.0));
        float milky = band*(mn*0.8+0.2)*(1.0-dust*0.6);
        col += mix(vec3(0.15,0.12,0.2), vec3(0.25,0.28,0.4), mn) * milky * 0.5;

        // Nebulae
        vec3 nd1=normalize(vec3(1,0.5,0.3));
        col += vec3(0.15,0.02,0.08)*pow(max(dot(dir,nd1),0.0),8.0)*fbm(vec2(phi,theta)*3.0)*0.6;
        vec3 nd2=normalize(vec3(-0.7,0.2,0.8));
        col += vec3(0.03,0.06,0.18)*pow(max(dot(dir,nd2),0.0),10.0)*fbm(vec2(phi,theta)*4.0+3.0)*0.5;

        // Stars (3 density layers)
        vec3 sc1=mix(vec3(1,0.9,0.7),vec3(0.7,0.8,1),hash(floor(skyUv*200.0)));
        col += sc1*stars(skyUv,200.0)*1.5;
        col += vec3(0.9,0.92,1)*stars(skyUv+0.5,400.0)*0.8;
        col += vec3(0.8,0.85,1)*stars(skyUv+1.0,800.0)*0.4;
        col += vec3(0.9,0.92,1)*stars(skyUv+2.0,1600.0)*band*1.2;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const mesh = new THREE.Mesh(geo, mat);
  return {
    mesh,
    tick: function(time) { mat.uniforms.uTime.value = time; }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. VOLUMETRIC FOG VOLUME — Localized raymarched fog cloud
//    Returns: { mesh, tick(time, cameraPosition) }
//    Budget: 1 draw call per cloud, ~1.5k tris, 16 texture samples
// ─────────────────────────────────────────────────────────────────────────────
function createFogVolume(position, radius, color, density, noiseScale) {
  const geo = new THREE.SphereGeometry(radius, 24, 12);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:      { value: 0 },
      uRadius:    { value: radius },
      uColor:     { value: new THREE.Color(color) },
      uDensity:   { value: density || 1.0 },
      uNoiseScale:{ value: noiseScale || 1.0 },
      uCamPos:    { value: new THREE.Vector3() },
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
      uniform float uTime, uRadius, uDensity, uNoiseScale;
      uniform vec3 uColor, uCamPos;
      varying vec3 vWorldPos;

      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float noise(vec3 p){
        vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float fbm(vec3 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+0.01;a*=0.5;}return v;}

      void main() {
        vec3 rayDir = normalize(vWorldPos - uCamPos);
        vec3 center = (modelMatrix * vec4(0,0,0,1)).xyz;
        vec3 oc = uCamPos - center;
        float b = dot(oc, rayDir), c = dot(oc,oc) - uRadius*uRadius;
        float disc = b*b - c;
        if(disc<0.0) discard;
        float sq=sqrt(disc), tN=max(-b-sq,0.0), tF=-b+sq;
        if(tF<0.0) discard;

        float step = (tF-tN)/16.0, totalD=0.0;
        vec3 totalC = vec3(0.0);
        for(int i=0;i<16;i++){
          float t=tN+step*(float(i)+0.5);
          vec3 sp=uCamPos+rayDir*t, lp=sp-center;
          float dist=length(lp)/uRadius;
          float falloff=1.0-smoothstep(0.0,1.0,dist); falloff*=falloff;
          float d=falloff*fbm(lp*uNoiseScale+uTime*0.15)*uDensity;
          totalD+=d*step; totalC+=uColor*d*step;
        }
        totalD=min(totalD,0.8);
        gl_FragColor=vec4(totalC,totalD);
      }
    `
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  return {
    mesh,
    tick: function(time, camPos) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uCamPos.value.copy(camPos);
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. GRAVITY LENSING — Render-to-texture distortion (no EffectComposer)
//    Returns: { setup(renderer), renderDistorted(renderer, scene, camera, bhWorldPos) }
//    Budget: 1 extra full-screen draw call + 1 render-to-texture pass
//    NOTE: You replace your normal renderer.render(scene,camera) call
//          with lensingEffect.renderDistorted(renderer, scene, camera, bhPos)
// ─────────────────────────────────────────────────────────────────────────────
function createGravityLensing(width, height, pixelRatio) {
  const rt = new THREE.WebGLRenderTarget(
    width * (pixelRatio || 1),
    height * (pixelRatio || 1)
  );
  const distortScene = new THREE.Scene();
  const distortCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const distortMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene:    { value: rt.texture },
      uBHScreen: { value: new THREE.Vector2(0.5, 0.5) },
      uStrength: { value: 0.12 },
      uRadius:   { value: 0.25 },
      uTime:     { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uBHScreen;
      uniform float uStrength, uRadius, uTime;
      varying vec2 vUv;
      void main() {
        vec2 toC = vUv - uBHScreen;
        float dist = length(toC);
        vec2 dir = normalize(toC);
        float inf = 1.0-smoothstep(0.0,uRadius,dist);
        inf *= inf;
        float bend = uStrength * inf / max(dist,0.01);
        vec2 perp = vec2(-dir.y, dir.x);
        float chrom = bend * 0.3;
        float r = texture2D(tScene, vUv+dir*bend+perp*chrom*0.5).r;
        float g = texture2D(tScene, vUv+dir*bend).g;
        float b = texture2D(tScene, vUv+dir*bend-perp*chrom*0.5).b;
        vec3 col = vec3(r,g,b);
        // Einstein ring
        float rd = abs(dist-uRadius*0.4);
        col += vec3(0.3,0.4,0.8)*exp(-rd*rd*200.0)*0.3
             *(1.0+sin(atan(toC.y,toC.x)*6.0+uTime*2.0)*0.3);
        col *= smoothstep(0.0,0.06,dist); // blackout center
        gl_FragColor = vec4(col,1.0);
      }
    `
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), distortMat);
  distortScene.add(quad);

  const _proj = new THREE.Vector3();

  return {
    rt: rt,
    material: distortMat,
    // Call this instead of renderer.render(scene, camera) when you want lensing
    renderDistorted: function(renderer, scene, camera, bhWorldPos, time) {
      // 1. Render scene to texture
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      // 2. Project BH to screen space
      _proj.copy(bhWorldPos).project(camera);
      distortMat.uniforms.uBHScreen.value.set(_proj.x*0.5+0.5, _proj.y*0.5+0.5);
      distortMat.uniforms.uTime.value = time || 0;
      // 3. Render distortion quad
      renderer.render(distortScene, distortCam);
    },
    resize: function(w, h, pr) {
      rt.setSize(w * (pr||1), h * (pr||1));
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. ENERGY BEAM — Animated beam between two points
//    Returns: { group, tick(time) }
//    Budget: 3 draw calls (beam + core + glow), ~300 tris
// ─────────────────────────────────────────────────────────────────────────────
function createEnergyBeam(startPos, endPos, color1, color2) {
  color1 = color1 || 0x4488ff;
  color2 = color2 || 0xff4488;
  const group = new THREE.Group();

  // Core beam (ShaderMaterial cylinder)
  const dist = startPos.distanceTo(endPos);
  const mid = startPos.clone().add(endPos).multiplyScalar(0.5);
  const dir = endPos.clone().sub(startPos).normalize();

  const beamGeo = new THREE.CylinderGeometry(0.015, 0.015, dist, 8, 16);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(color1) },
      uColor2: { value: new THREE.Color(color2) },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor1, uColor2; varying vec2 vUv;
      void main() {
        float edge = 1.0-smoothstep(0.3,0.5,abs(vUv.x-0.5)*2.0);
        float pulse = sin(vUv.y*20.0-uTime*8.0)*0.5+0.5;
        float pulse2 = sin(vUv.y*12.0-uTime*5.0+1.0)*0.5+0.5;
        vec3 col = mix(uColor1, uColor2, vUv.y);
        float flicker = 0.7+0.3*sin(uTime*15.0+vUv.y*5.0);
        float alpha = edge*(0.3+pulse*0.4+pulse2*0.3)*flicker;
        gl_FragColor = vec4(col*1.5, alpha);
      }
    `
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  group.add(beam);

  // Outer glow (wider, dimmer)
  const glowGeo = new THREE.CylinderGeometry(0.06, 0.06, dist, 8, 1);
  const glowMat = new THREE.MeshBasicMaterial({
    color: color1, transparent: true, opacity: 0.08,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);

  // Orient group toward target
  group.position.copy(mid);
  group.lookAt(endPos);
  group.rotateX(Math.PI / 2);

  return {
    group,
    tick: function(time) {
      beamMat.uniforms.uTime.value = time;
      glowMat.opacity = 0.06 + Math.sin(time * 3) * 0.03;
    },
    // Call this to update endpoints dynamically
    updateEndpoints: function(newStart, newEnd) {
      const d = newStart.distanceTo(newEnd);
      const m = newStart.clone().add(newEnd).multiplyScalar(0.5);
      group.position.copy(m);
      group.lookAt(newEnd);
      group.rotateX(Math.PI / 2);
      beam.scale.y = d / dist;
      glow.scale.y = d / dist;
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 4b. LIGHTNING BOLT — Regenerating jittered bolt between two points
//     Returns: { group, tick(time) }
//     Budget: 2 draw calls (bolt + glow bolt), 0 tris (line geometry)
// ─────────────────────────────────────────────────────────────────────────────
function createLightningBolt(startPos, endPos, color, displacement) {
  color = color || 0x88ccff;
  displacement = displacement || 0.8;
  const SEGS = 32;
  const group = new THREE.Group();

  function jitterPoints(start, end, segs, disp) {
    const pts = [start.clone()];
    const dir = end.clone().sub(start);
    const step = dir.clone().divideScalar(segs);
    const perp1 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
    for (let i = 1; i < segs; i++) {
      const p = start.clone().add(step.clone().multiplyScalar(i));
      const s = disp * (1 - Math.abs(i/segs - 0.5) * 2);
      p.addScaledVector(perp1, (Math.random()-0.5)*s);
      p.addScaledVector(perp2, (Math.random()-0.5)*s);
      pts.push(p);
    }
    pts.push(end.clone());
    return pts;
  }

  const boltGeo = new THREE.BufferGeometry();
  const positions = new Float32Array((SEGS+1)*3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const boltMat = new THREE.LineBasicMaterial({
    color: color, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
  const bolt = new THREE.Line(boltGeo, boltMat);
  group.add(bolt);

  // Glow line
  const glowGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array((SEGS+1)*3);
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  const glowMat = new THREE.LineBasicMaterial({
    color: color, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Line(glowGeo, glowMat));

  let lastRegen = 0;

  return {
    group,
    tick: function(time) {
      if (time - lastRegen > 0.06) {
        lastRegen = time;
        const pts = jitterPoints(startPos, endPos, SEGS, displacement);
        for (let i = 0; i <= SEGS && i < pts.length; i++) {
          positions[i*3]=pts[i].x; positions[i*3+1]=pts[i].y; positions[i*3+2]=pts[i].z;
        }
        boltGeo.attributes.position.needsUpdate = true;

        const gPts = jitterPoints(startPos, endPos, SEGS, displacement * 1.5);
        for (let i = 0; i <= SEGS && i < gPts.length; i++) {
          gPos[i*3]=gPts[i].x; gPos[i*3+1]=gPts[i].y; gPos[i*3+2]=gPts[i].z;
        }
        glowGeo.attributes.position.needsUpdate = true;
      }
      boltMat.opacity = 0.6 + Math.sin(time * 15) * 0.3;
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. HOLOGRAM MATERIAL — Apply to any mesh for holographic look
//    Returns: THREE.ShaderMaterial
//    Budget: 0 extra draw calls (replaces existing material)
// ─────────────────────────────────────────────────────────────────────────────
function createHologramMaterial(baseColor, opts) {
  opts = opts || {};
  return new THREE.ShaderMaterial({
    transparent: true,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:     { value: 0 },
      uColor:    { value: new THREE.Color(baseColor || 0x44aaff) },
      uAlpha:    { value: opts.alpha || 0.7 },
      uScanFreq: { value: opts.scanFreq || 80.0 },
      uScanSpeed:{ value: opts.scanSpeed || 3.0 },
      uFlicker:  { value: opts.flicker || 0.15 },
      uFresnel:  { value: opts.fresnel || 2.0 },
      uGlitch:   { value: opts.glitch || 0.3 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal, vWorldPos, vViewDir;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha, uScanFreq, uScanSpeed, uFlicker, uFresnel, uGlitch;
      uniform vec3 uColor;
      varying vec3 vNormal, vWorldPos, vViewDir;
      varying vec2 vUv;
      float hash(float n){return fract(sin(n)*43758.5453);}
      void main() {
        float fresnel = pow(1.0-abs(dot(vNormal,vViewDir)), uFresnel);
        float scan = sin(vWorldPos.y*uScanFreq+uTime*uScanSpeed)*0.5+0.5;
        scan = smoothstep(0.3,0.7,scan);
        float sweep = 1.0-smoothstep(0.0,0.05,abs(fract(vUv.y)-fract(uTime*0.5)));
        float flicker = 1.0-uFlicker*step(0.98,hash(floor(uTime*20.0)));
        float glitch = step(0.97,hash(floor(uTime*10.0)+floor(vWorldPos.y*8.0)))*uGlitch;
        float alpha = uAlpha*(0.5+scan*0.5)*flicker;
        alpha = max(alpha, fresnel*0.8);
        vec3 col = uColor;
        col += vec3(0.3,0.5,0.8)*fresnel*0.5;
        col += vec3(0.5,0.7,1.0)*sweep*0.5;
        col += uColor*glitch*2.0;
        col += hash(vUv.x*100.0+vUv.y*100.0+uTime*50.0)*0.1;
        gl_FragColor = vec4(col, alpha);
      }
    `
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 6. WORMHOLE / PORTAL TUNNEL
//    Returns: { group, tick(time) }
//    Budget: 2 draw calls (tunnel + particles), ~8k tris + 2k points
// ─────────────────────────────────────────────────────────────────────────────
function createWormhole(length, radius) {
  length = length || 20;
  radius = radius || 2;
  const group = new THREE.Group();

  const tunnelGeo = new THREE.CylinderGeometry(radius, radius, length, 48, 48, true);
  const tunnelMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 1.5 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSpeed;
      varying vec2 vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.01+0.1;a*=0.5;}return v;}
      void main() {
        float angle=vUv.x*6.28318, along=vUv.y;
        float swirl=angle+along*8.0+uTime*uSpeed;
        vec2 nUv=vec2(swirl*0.5, along*4.0-uTime*uSpeed*0.5);
        float n=fbm(nUv), n2=fbm(nUv*2.0+3.0);
        float radial=abs(along-0.5)*2.0;
        vec3 col=mix(vec3(0.1,0.3,0.9),vec3(0.5,0.1,0.8),n);
        col=mix(col,vec3(0.8,0.3,0.1),n2*radial);
        float lines=smoothstep(0.6,0.8,sin(swirl*6.0)*0.5+0.5);
        col+=vec3(0.4,0.6,1.0)*lines*0.3;
        col+=vec3(0.8,0.9,1.0)*pow(n,3.0)*2.0;
        float endFade=smoothstep(0.0,0.1,along)*smoothstep(1.0,0.9,along);
        float alpha=(0.4+n*0.4+lines*0.2)*endFade;
        gl_FragColor=vec4(col,alpha);
      }
    `
  });
  const tunnel = new THREE.Mesh(tunnelGeo, tunnelMat);
  tunnel.rotation.x = Math.PI / 2;
  group.add(tunnel);

  // Particles
  const N = 2000;
  const pPos = new Float32Array(N*3), pVel = new Float32Array(N), pPh = new Float32Array(N);
  for(let i=0;i<N;i++){
    const a=Math.random()*Math.PI*2, r=0.5+Math.random()*1.5;
    pPos[i*3]=Math.cos(a)*r; pPos[i*3+1]=Math.sin(a)*r; pPos[i*3+2]=(Math.random()-0.5)*length;
    pVel[i]=0.5+Math.random()*1.5; pPh[i]=Math.random()*Math.PI*2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aVel', new THREE.BufferAttribute(pVel, 1));
  pGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPh, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { uTime:{value:0}, uLen:{value:length} },
    vertexShader: /* glsl */ `
      attribute float aVel, aPhase; uniform float uTime, uLen;
      varying float vAlpha;
      void main(){
        vec3 p=position;
        float halfL=uLen*0.5;
        p.z=mod(p.z+uTime*aVel*5.0,uLen)-halfL;
        float angle=atan(p.y,p.x)+uTime*0.5+aPhase;
        float r=length(p.xy);
        p.x=cos(angle)*r; p.y=sin(angle)*r;
        vAlpha=smoothstep(-halfL,-halfL+2.0,p.z)*smoothstep(halfL,halfL-2.0,p.z);
        gl_PointSize=2.0; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }
    `,
    fragmentShader: `varying float vAlpha;void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;gl_FragColor=vec4(0.5,0.6,1.0,(1.0-d*2.0)*vAlpha*0.6);}`
  });
  group.add(new THREE.Points(pGeo, pMat));

  return {
    group,
    tick: function(time) {
      tunnelMat.uniforms.uTime.value = time;
      pMat.uniforms.uTime.value = time;
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 7. CONSTELLATION PULSE LINE — Animated line with traveling light pulse
//    Returns: { line, particleMesh, tick(time) }
//    Budget: 2 draw calls per connection (line + particle)
// ─────────────────────────────────────────────────────────────────────────────
function createConstellationLine(startPos, endPos, color, pulseSpeed) {
  color = color || 0x4488cc;
  pulseSpeed = pulseSpeed || 0.8;
  const SEGS = 64;
  const positions = new Float32Array(SEGS * 3);
  const progress = new Float32Array(SEGS);
  const phase = Math.random() * Math.PI * 2;

  for (let i = 0; i < SEGS; i++) {
    const t = i / (SEGS - 1);
    const p = startPos.clone().lerp(endPos, t);
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z;
    progress[i] = t;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(color) },
      uPulseSpeed: { value: pulseSpeed }, uPulseWidth: { value: 0.08 },
      uBaseAlpha: { value: 0.15 }, uPhase: { value: phase },
    },
    vertexShader: /* glsl */ `
      attribute float aProgress;
      uniform float uTime, uPulseSpeed, uPulseWidth, uBaseAlpha, uPhase;
      varying float vAlpha;
      void main(){
        float pulsePos=fract(uTime*uPulseSpeed+uPhase);
        float dist=min(abs(aProgress-pulsePos),1.0-abs(aProgress-pulsePos));
        vAlpha=uBaseAlpha+exp(-dist*dist/(uPulseWidth*uPulseWidth))*0.85;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor; varying float vAlpha;
      void main(){vec3 c=uColor+vec3(0.3,0.4,0.5)*(vAlpha-0.15);gl_FragColor=vec4(c,vAlpha);}
    `
  });
  const line = new THREE.Line(geo, mat);

  // Traveling particle
  const pMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 4),
    new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );

  return {
    line, particleMesh: pMesh,
    tick: function(time) {
      mat.uniforms.uTime.value = time;
      const prog = (time * pulseSpeed + phase) % 1;
      pMesh.position.lerpVectors(startPos, endPos, prog);
      pMesh.material.opacity = 0.8 + Math.sin(time * 5 + phase) * 0.2;
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 8. PLANET RING SYSTEM — Saturn-style with gaps, ringlets, sparkle
//    Returns: { mesh, tick(time) }
//    Budget: 1 draw call, ~2k tris
// ─────────────────────────────────────────────────────────────────────────────
function createPlanetRings(innerRadius, outerRadius, tiltAngle) {
  innerRadius = innerRadius || 2.0;
  outerRadius = outerRadius || 4.0;
  tiltAngle = tiltAngle !== undefined ? tiltAngle : -0.42 * Math.PI;

  const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 8);
  // Fix UVs: radial mapping
  const uvs = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uvs.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.sqrt(x*x + y*y);
    uvs.setXY(i, (r - innerRadius) / (outerRadius - innerRadius), Math.atan2(y, x) / (Math.PI*2) + 0.5);
  }

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(0.7, 0.4, 0.7).normalize() },
    },
    vertexShader: `varying vec2 vUv;varying vec3 vWorldPos,vNormal;
      void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);
      vWorldPos=(modelMatrix*vec4(position,1.0)).xyz;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uLightDir;
      varying vec2 vUv; varying vec3 vWorldPos, vNormal;
      float hash(float n){return fract(sin(n)*43758.5453);}
      void main(){
        float r=vUv.x;
        vec3 inner=vec3(0.85,0.72,0.55), outer=vec3(0.55,0.45,0.35);
        vec3 col=mix(inner,outer,r) + hash(floor(r*200.0))*0.15;
        float alpha=0.85;
        // Cassini Division
        alpha *= 1.0-(smoothstep(0.57,0.58,r)-smoothstep(0.63,0.64,r))*0.9;
        // Encke Gap
        alpha *= 1.0-(smoothstep(0.78,0.785,r)-smoothstep(0.79,0.795,r))*0.7;
        // Ringlets
        float ringlets=smoothstep(0.3,0.7,sin(r*120.0)*0.5+0.5);
        alpha *= 0.4+ringlets*0.6;
        // Edge fades
        alpha *= smoothstep(1.0,0.9,r)*smoothstep(0.0,0.05,r);
        // Lighting
        col *= 0.5+0.5*(dot(vNormal,uLightDir)*0.5+0.5);
        // Sparkle
        col += step(0.995,hash(floor(r*500.0)+floor(vUv.y*500.0)+uTime*0.5))*0.5;
        gl_FragColor=vec4(col,alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = tiltAngle;
  return {
    mesh,
    tick: function(time) {
      mat.uniforms.uTime.value = time;
      mesh.rotation.z = time * 0.02;
    }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 9. COMET TRAIL — Glowing head + fading ribbon trail (no post-processing)
//    Returns: { group, tick(dt, cameraUp) }
//    Budget: 2 draw calls (head + trail ribbon), ~200 tris
// ─────────────────────────────────────────────────────────────────────────────
function createComet(color, trailLength) {
  color = color || 0xff8844;
  trailLength = trailLength || 80;
  const group = new THREE.Group();

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  group.add(head);

  // Head glow (sprite — generated canvas texture)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const c = new THREE.Color(color);
  const grad = ctx.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.2, `rgba(${c.r*255|0},${c.g*255|0},${c.b*255|0},0.8)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,64,64);
  const spriteMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const glow = new THREE.Sprite(spriteMat);
  glow.scale.setScalar(1.5);
  head.add(glow);

  // Trail ribbon
  const trailPositions = new Float32Array(trailLength * 2 * 3);
  const trailAlphas = new Float32Array(trailLength * 2);
  const indices = [];
  for (let i = 0; i < trailLength - 1; i++) {
    const a=i*2, b=i*2+1, c_=(i+1)*2, d=(i+1)*2+1;
    indices.push(a,c_,b, b,c_,d);
  }
  for (let i = 0; i < trailLength; i++) {
    const alpha = 1.0 - i / trailLength;
    trailAlphas[i*2] = alpha; trailAlphas[i*2+1] = alpha;
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlphas, 1));
  trailGeo.setIndex(indices);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `attribute float aAlpha;varying float vAlpha;void main(){vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 uColor;varying float vAlpha;void main(){
      vec3 col=mix(uColor,vec3(0.1,0.05,0.2),1.0-vAlpha);
      col=mix(col,vec3(1.0,0.98,0.9),vAlpha*vAlpha);
      gl_FragColor=vec4(col,vAlpha*vAlpha*0.8);}
    `
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  // Trail is in world space, not parented to group
  // You must add trail to the scene separately!

  // Position state
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const history = [];
  for (let i = 0; i < trailLength; i++) history.push(new THREE.Vector3());

  function reset(bounds) {
    bounds = bounds || 20;
    const theta = Math.random()*Math.PI*2, phi = Math.random()*Math.PI-Math.PI/2;
    pos.set(Math.cos(phi)*Math.cos(theta)*bounds, Math.cos(phi)*Math.sin(theta)*bounds, Math.sin(phi)*bounds);
    vel.copy(pos).negate().normalize().multiplyScalar(5+Math.random()*5);
    vel.x+=(Math.random()-0.5)*2; vel.y+=(Math.random()-0.5)*2;
    for (let i=0;i<trailLength;i++) history[i].copy(pos);
  }
  reset();

  return {
    group, trail, // Add both group AND trail to scene
    tick: function(dt, camUp) {
      pos.addScaledVector(vel, dt);
      head.position.copy(pos);
      // Shift history
      for (let i=trailLength-1;i>0;i--) history[i].copy(history[i-1]);
      history[0].copy(pos);
      // Build ribbon
      const w = 0.15;
      for (let i=0;i<trailLength;i++){
        const p=history[i], ww=w*(1-i/trailLength);
        trailPositions[i*6]=p.x+camUp.x*ww; trailPositions[i*6+1]=p.y+camUp.y*ww; trailPositions[i*6+2]=p.z+camUp.z*ww;
        trailPositions[i*6+3]=p.x-camUp.x*ww; trailPositions[i*6+4]=p.y-camUp.y*ww; trailPositions[i*6+5]=p.z-camUp.z*ww;
      }
      trailGeo.attributes.position.needsUpdate = true;
      if (pos.length() > 30) reset();
    },
    reset: reset
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 10. AUDIO-REACTIVE DRIVER — Connects Web Audio API to visual parameters
//     Returns: { start(), getData(), tick() }
//     Budget: 0 draw calls (drives other objects' uniforms/transforms)
// ─────────────────────────────────────────────────────────────────────────────
function createAudioReactiveDriver() {
  let audioContext, analyser, dataArray;
  let started = false;

  return {
    // Call on user gesture (click/tap)
    start: function(options) {
      if (started) return;
      started = true;
      options = options || {};
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = options.fftSize || 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      if (options.audioElement) {
        // Connect existing <audio> or audio stream
        const source = audioContext.createMediaElementSource(options.audioElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
      } else {
        // Generate drone (deep synth)
        function drone(freq, gain) {
          const o = audioContext.createOscillator(), g = audioContext.createGain();
          o.type = 'sine'; o.frequency.value = freq; g.gain.value = gain;
          o.connect(g); g.connect(analyser); g.connect(audioContext.destination); o.start();
        }
        drone(55, 0.12); drone(82, 0.08); drone(110, 0.06); drone(165, 0.04);
        // LFO for pulsation
        const lfo = audioContext.createOscillator(), lfoG = audioContext.createGain();
        lfo.type='sine'; lfo.frequency.value=0.5; lfoG.gain.value=30; lfo.connect(lfoG);
        const mod=audioContext.createOscillator(), modG=audioContext.createGain();
        mod.type='sawtooth'; mod.frequency.value=40; lfoG.connect(mod.frequency);
        modG.gain.value=0.08; mod.connect(modG); modG.connect(analyser); modG.connect(audioContext.destination);
        mod.start(); lfo.start();
      }
    },

    // Returns { bass, mid, high, overall } each 0..1
    getData: function() {
      if (!analyser || !dataArray) return { bass:0, mid:0, high:0, overall:0 };
      analyser.getByteFrequencyData(dataArray);
      let bass=0, mid=0, high=0, overall=0;
      const len = dataArray.length; // typically 128
      for (let i=0; i<len; i++) {
        const v = dataArray[i];
        overall += v;
        if (i < len*0.125) bass += v;
        else if (i < len*0.5) mid += v;
        else high += v;
      }
      bass /= (len*0.125*255);
      mid /= (len*0.375*255);
      high /= (len*0.5*255);
      overall /= (len*255);
      return { bass, mid, high, overall };
    },

    // Raw frequency data array (Uint8Array)
    getRawData: function() {
      if (!analyser || !dataArray) return null;
      analyser.getByteFrequencyData(dataArray);
      return dataArray;
    },

    destroy: function() {
      if (audioContext) { audioContext.close(); audioContext = null; }
    },

    get isStarted() { return started; },
    get binCount() { return analyser ? analyser.frequencyBinCount : 0; },
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE — How to integrate into km_vr_phase*.html
// ─────────────────────────────────────────────────────────────────────────────
/*

// === In your init section (after scene setup) ===

// 1. Space skybox (replaces your star Points if desired)
const skybox = createSpaceSkybox(4500);
scene.add(skybox.mesh);

// 2. Fog volumes (add to scene wherever you want nebula clouds)
const fogCloud = createFogVolume(new THREE.Vector3(2000, 500, -1500), 800, 0x442266, 1.2, 1.0);
scene.add(fogCloud.mesh);

// 3. Gravity lensing (replaces your normal render call for BH scenes)
const lensing = createGravityLensing(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
// In animate(): lensing.renderDistorted(renderer, scene, camera, BH_POS, time);

// 4. Energy beam between two planets
const beam = createEnergyBeam(nodeA.position, nodeB.position, 0x4488ff, 0xff4488);
scene.add(beam.group);

// 4b. Lightning bolt
const bolt = createLightningBolt(nodeA.position, nodeB.position, 0x88ccff, 0.8);
scene.add(bolt.group);

// 5. Hologram material (for info cards)
const holoMat = createHologramMaterial(0x2288ff, { doubleSide: true });
infoCard.material = holoMat;

// 6. Wormhole tunnel (for BH->WH travel)
const wormhole = createWormhole(20, 2);
scene.add(wormhole.group);
wormhole.group.visible = false; // show during travel

// 7. Constellation pulse lines
const cLine = createConstellationLine(planetA.position, planetB.position, 0x4488cc);
scene.add(cLine.line);
scene.add(cLine.particleMesh);

// 8. Planet rings
const rings = createPlanetRings(2.0, 4.0, -Math.PI * 0.42);
rings.mesh.position.copy(planetNode.position);
scene.add(rings.mesh);

// 9. Comet
const comet = createComet(0xff8844, 80);
scene.add(comet.group);
scene.add(comet.trail);

// 10. Audio reactive
const audioDriver = createAudioReactiveDriver();
// On first click: audioDriver.start();
// Or with an audio element: audioDriver.start({ audioElement: myAudioEl });


// === In your animate() loop ===

function animate() {
  const time = performance.now() * 0.001;
  const dt = clock.getDelta();

  skybox.tick(time);
  fogCloud.tick(time, camera.position);
  beam.tick(time);
  bolt.tick(time);
  holoMat.uniforms.uTime.value = time;
  wormhole.tick(time);
  cLine.tick(time);
  rings.tick(time);

  // Camera up vector for comet ribbon
  const camUp = new THREE.Vector3();
  camera.matrixWorld.extractBasis(new THREE.Vector3(), camUp, new THREE.Vector3());
  comet.tick(dt, camUp);

  // Audio reactive — drive planet scales
  if (audioDriver.isStarted) {
    const audio = audioDriver.getData();
    planetMeshes.forEach(m => {
      m.scale.setScalar(1.0 + audio.bass * 0.3);
    });
    // Drive glow intensity
    glowMaterial.opacity = 0.1 + audio.overall * 0.4;
  }

  // For gravity lensing (replaces normal render):
  if (showLensing) {
    lensing.renderDistorted(renderer, scene, camera, BH_POS, time);
  } else {
    renderer.render(scene, camera);
  }
}

// === VR Budget guard ===
// In VR, skip expensive effects:
if (_inXR) {
  // Skip: fogCloud.tick, lensing, comet, bolt (save draw calls)
  // Keep: skybox, beams (low cost), rings, constellation lines
}

*/
