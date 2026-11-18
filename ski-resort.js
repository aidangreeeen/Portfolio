import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* Ski resort scroll section — Aidan Green portfolio.
   Renders the Blender ski-resort generator scene with three.js; the camera travels summit -> base as the
   section scrolls past. Expects the markup in index.html (#ski section) and ski-resort.css. */

const MODELS = 'Models/ski-resort/';
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);   // terrain.glb is meshopt-compressed
const params = new URLSearchParams(location.search);   // test hooks: ?p=0.5  ?time=night  ?clouds=80  ?trees=50

/* ---------- Camera journey: a dive from the sky down onto the slopes ----------
   Scene units: the resort spans x -1.1 (valley) to +1.1 (summit), height 0 - 0.9. */
// Dive: starts high in the sky facing the mountain head-on, then dives at it and down onto the run
// between lifts 1 and 2, the scene filling more of the frame the closer it gets. No turn.
// Each key is [camera position], [point the camera looks at].
const PATH = {
  portraitPull: 0.12,           // little pull-back on phones: near the end there's terrain right behind
  keys: [
    { cam: [-2.40, 2.10,  0.00], look: [ 0.35, 0.30,  0.00] },  // high over the valley, the whole range head-on
    { cam: [-1.85, 1.45,  0.02], look: [ 0.30, 0.30,  0.00] },  // starting the dive
    { cam: [-1.35, 0.92,  0.04], look: [ 0.25, 0.32,  0.00] },  // dropping toward the forest and the base
    { cam: [-0.95, 0.55,  0.05], look: [ 0.25, 0.36,  0.00] },  // over the treetops at the foot of the runs
    { cam: [-0.62, 0.34,  0.06], look: [ 0.30, 0.44, -0.02] },  // low between lifts 1 and 2
    { cam: [-0.42, 0.29,  0.05], look: [ 0.35, 0.50, -0.03] },  // on the run, towers and chairs close by
  ],
};
const camCurve  = new THREE.CatmullRomCurve3(PATH.keys.map(k => new THREE.Vector3(...k.cam)),  false, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(PATH.keys.map(k => new THREE.Vector3(...k.look)), false, 'centripetal');

const section = document.getElementById('ski');
const sticky  = section.querySelector('.ski-sticky');

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
// No WebGL: the section keeps showing its poster image and hides the controls.
if (!webglAvailable()) {
  sticky.classList.add('is-fallback'); sticky.classList.remove('is-loading');
  // keep the colour blends into the neighbouring sections working over the poster
  const fadeT = document.getElementById('fade-top'), fadeB = document.getElementById('fade-bottom');
  const onScroll = () => {
    const r = section.getBoundingClientRect();
    const p = THREE.MathUtils.clamp(-r.top / (r.height - innerHeight), 0, 1), sm = THREE.MathUtils.smoothstep;
    fadeT.style.opacity = (1 - sm(p, 0, 0.12)).toFixed(3); fadeB.style.opacity = sm(p, 0.88, 1).toFixed(3);
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}
else start();

function start() {
const canvas  = document.getElementById('ski-canvas');
const status  = document.getElementById('ski-status');
const fadeTop = document.getElementById('fade-top');
const fadeBottom = document.getElementById('fade-bottom');
const panel   = document.getElementById('ski-panel');
const panelToggle = document.getElementById('ski-panel-toggle');
const loaded = { terrain: false, lifts: false, trees: false };
function markLoaded(part) {
  loaded[part] = true;
  if (loaded.terrain && loaded.lifts && loaded.trees) {
    sticky.classList.remove('is-loading');           // poster fades out, live scene fades in
    perf.start = true;
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchDevice = matchMedia('(pointer: coarse)').matches;
let maxPixelRatio = touchDevice ? 1.5 : 2;            // phones: fewer pixels, same look

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);   // the sky is the CSS gradient behind the canvas

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1.8, 4.4);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 50);
const HFOV = 68;

const hemi = new THREE.HemisphereLight('#dfe8f3', '#4a5260', 1.1);
const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
scene.add(hemi, sun);

/* ---------- Time of day ---------- */
const TIMES = {
  dawn:  { skyTop: '#7484ab', horizon: '#f0cfae', sun: '#ffb27a', sunI: 1.7, sunDir: [ 2.5, 0.9, -1.8],
           hemiSky: '#d2c8d8', hemiGround: '#3c3542', hemiI: 0.85, exposure: 1.0,  cloud: '#f6d9c6', glow: 0.25 },
  day:   { skyTop: '#9fb6cc', horizon: '#e6e9e4', sun: '#fff3e0', sunI: 2.2, sunDir: [-1.5, 2.5,  2.5],
           hemiSky: '#dfe8f3', hemiGround: '#4a5260', hemiI: 1.1,  exposure: 1.0,  cloud: '#ffffff', glow: 0.0 },
  dusk:  { skyTop: '#3e4a7a', horizon: '#e79a6c', sun: '#ff8c52', sunI: 1.5, sunDir: [-2.6, 0.6,  1.6],
           hemiSky: '#9488ad', hemiGround: '#2b2430', hemiI: 0.7,  exposure: 1.0,  cloud: '#f2a98c', glow: 0.7 },
  night: { skyTop: '#070b18', horizon: '#1f2942', sun: '#9fb6ff', sunI: 0.35, sunDir: [-1.0, 2.0, 1.0],
           hemiSky: '#3a4766', hemiGround: '#07090e', hemiI: 0.35, exposure: 1.15, cloud: '#56607a', glow: 1.0 },
};
const C = (hex) => new THREE.Color(hex);
const toState = (t) => ({ skyTop: C(t.skyTop), horizon: C(t.horizon), sun: C(t.sun), sunI: t.sunI,
  sunDir: new THREE.Vector3(...t.sunDir), hemiSky: C(t.hemiSky), hemiGround: C(t.hemiGround), hemiI: t.hemiI,
  exposure: t.exposure, cloud: C(t.cloud), glow: t.glow });
const GLOW_ON_SNOW = 0.95;   // strength of the lamp light pools on the snow at full night
const tod = { cur: toState(TIMES.day), from: null, to: null, t0: 0, dur: 1400, name: 'day' };

function setTime(name, instant = false) {
  if (!TIMES[name]) return;
  tod.name = name;
  tod.from = { ...tod.cur, skyTop: tod.cur.skyTop.clone(), horizon: tod.cur.horizon.clone(), sun: tod.cur.sun.clone(),
               sunDir: tod.cur.sunDir.clone(), hemiSky: tod.cur.hemiSky.clone(), hemiGround: tod.cur.hemiGround.clone(),
               cloud: tod.cur.cloud.clone() };
  tod.to = toState(TIMES[name]);
  tod.t0 = performance.now(); tod.dur = (instant || reduceMotion) ? 0 : 1400;
  pressed('ctl-time', name);
}
function updateTime(now) {
  if (!tod.to) return;
  const k = tod.dur ? THREE.MathUtils.smoothstep(Math.min(1, (now - tod.t0) / tod.dur), 0, 1) : 1;
  const a = tod.from, b = tod.to, c = tod.cur;
  c.skyTop.copy(a.skyTop).lerp(b.skyTop, k); c.horizon.copy(a.horizon).lerp(b.horizon, k);
  c.sun.copy(a.sun).lerp(b.sun, k); c.sunDir.copy(a.sunDir).lerp(b.sunDir, k);
  c.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k); c.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, k);
  c.cloud.copy(a.cloud).lerp(b.cloud, k);
  for (const key of ['sunI', 'hemiI', 'exposure', 'glow']) c[key] = a[key] + (b[key] - a[key]) * k;
  applyTime();
  if (k >= 1) tod.to = null;
}
function applyTime() {
  const c = tod.cur;
  const root = document.documentElement;   // on :root so the hero's gradient follows the sky too
  root.style.setProperty('--sky-top', '#' + c.skyTop.getHexString());
  root.style.setProperty('--sky-horizon', '#' + c.horizon.getHexString());
  scene.fog.color.copy(c.horizon);
  sun.color.copy(c.sun); sun.intensity = c.sunI; sun.position.copy(c.sunDir);
  hemi.color.copy(c.hemiSky); hemi.groundColor.copy(c.hemiGround); hemi.intensity = c.hemiI;
  renderer.toneMappingExposure = c.exposure;
  clouds.material.forEach(m => m.color.copy(c.cloud));
  lampGlow.material.opacity = c.glow;
  lampGlow.visible = c.glow > 0.01;
  if (terrainMat) terrainMat.emissiveIntensity = c.glow * GLOW_ON_SNOW;
}

/* ---------- Surroundings: procedural mountains around the resort ---------- */
const RESORT = { x: 1.135, z: 1.8, floor: -0.047 };
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridged(x, z) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { sum += amp * (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)) ** 2; f *= 2.03; amp *= 0.5; }
  return sum;
}
// Heights along the resort's four edges, so the surroundings start exactly where the resort ends.
function makeEdgeSampler(root) {
  const BINS = 256, sides = { xp: null, xn: null, zp: null, zn: null };
  for (const k in sides) sides[k] = new Float32Array(BINS).fill(-Infinity);
  const v = new THREE.Vector3(), tol = 0.02;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const bz = Math.round(((v.z / RESORT.z) * 0.5 + 0.5) * (BINS - 1));
      const bx = Math.round(((v.x / RESORT.x) * 0.5 + 0.5) * (BINS - 1));
      if (v.x >  RESORT.x - tol) sides.xp[bz] = Math.max(sides.xp[bz], v.y);
      if (v.x < -RESORT.x + tol) sides.xn[bz] = Math.max(sides.xn[bz], v.y);
      if (v.z >  RESORT.z - tol) sides.zp[bx] = Math.max(sides.zp[bx], v.y);
      if (v.z < -RESORT.z + tol) sides.zn[bx] = Math.max(sides.zn[bx], v.y);
    }
  });
  for (const k in sides) {
    const a = sides[k]; let last = RESORT.floor;
    for (let i = 0; i < BINS; i++) { if (a[i] === -Infinity) a[i] = last; else last = a[i]; }
  }
  const look = (arr, t) => arr[Math.round(THREE.MathUtils.clamp(t * 0.5 + 0.5, 0, 1) * (BINS - 1))];
  return (x, z) => {
    const cx = THREE.MathUtils.clamp(x, -RESORT.x, RESORT.x), cz = THREE.MathUtils.clamp(z, -RESORT.z, RESORT.z);
    const dx = Math.abs(x) - RESORT.x, dz = Math.abs(z) - RESORT.z;
    if (dx >= dz) return look(x > 0 ? sides.xp : sides.xn, cz / RESORT.z);
    return look(z > 0 ? sides.zp : sides.zn, cx / RESORT.x);
  };
}
function surroundHeight(x, z, edgeH) {
  const dx = Math.max(0, Math.abs(x) - RESORT.x), dz = Math.max(0, Math.abs(z) - RESORT.z);
  if (dx === 0 && dz === 0) return RESORT.floor - 0.03;
  const s = THREE.MathUtils.smoothstep, d = Math.hypot(dx, dz);
  let mask;
  if (x > RESORT.x) mask = s(dx, 0.0, 0.5);
  else if (x < -RESORT.x) mask = s(dx, 1.2, 2.6) * 0.9 + s(dz, 0.0, 0.6) * 0.1;
  else mask = s(dz, 0.0, 0.6);
  const far = 1 + Math.min(d, 4) * 0.3;
  const mountains = RESORT.floor + mask * (0.12 + ridged(x * 1.1 + 7, z * 1.1 - 3) * 0.55) * far;
  const t = s(d, 0.0, 0.45);
  return Math.max(edgeH(x, z) * (1 - t) + mountains * t, RESORT.floor);
}
function buildSurroundings(edgeH) {
  const size = 11, seg = 280;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, surroundHeight(p.getX(i), p.getZ(i), edgeH));
  geo.computeVertexNormals();
  const n = geo.attributes.normal, colors = new Float32Array(p.count * 3);
  const rock = new THREE.Color(0.035, 0.038, 0.045), snow = new THREE.Color(0.80, 0.83, 0.88), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    // gradual snow/rock blend (a hard threshold made a triangle-by-triangle checkerboard up close)
    const jitter = (vnoise(p.getX(i) * 4, p.getZ(i) * 4) - 0.5) * 0.12;
    const k = THREE.MathUtils.smoothstep(n.getY(i) + jitter, 0.62, 0.9);
    c.copy(rock).lerp(snow, k).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
}

/* ---------- Night light on the snow ----------
   A canvas painted with a warm pool under every lamp in use, applied to the terrain as emissive light
   through the terrain's second (top-down) UV set. Canvas x = world x, canvas y = world z. */
const TERRAIN_UV1 = { xMin: -1.135, xMax: 1.135, zMin: -1.8, zMax: 1.8 };
const POOL_RADIUS = 0.045;                    // scene units (lamp posts are ~0.04 tall)
const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 1024;
const glowTex = new THREE.CanvasTexture(glowCanvas);
glowTex.channel = 1; glowTex.flipY = false; glowTex.colorSpace = THREE.SRGBColorSpace;
let terrainMat = null, lampBases = null;

function paintLightPools() {
  const g = glowCanvas.getContext('2d'), W = glowCanvas.width, H = glowCanvas.height;
  g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (!lampBases || !lampOffsets) { glowTex.needsUpdate = true; return; }
  g.globalCompositeOperation = 'lighter';
  const sx = W / (TERRAIN_UV1.xMax - TERRAIN_UV1.xMin), sz = H / (TERRAIN_UV1.zMax - TERRAIN_UV1.zMin);
  const n = lampOffsets[lifts.count];
  for (let i = 0; i < n; i++) {
    const x = (lampBases[i * 3] - TERRAIN_UV1.xMin) * sx, y = (lampBases[i * 3 + 2] - TERRAIN_UV1.zMin) * sz;
    g.save(); g.translate(x, y); g.scale(POOL_RADIUS * sx, POOL_RADIUS * sz);      // round in world space
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grd.addColorStop(0, 'rgba(255,196,120,0.95)'); grd.addColorStop(0.45, 'rgba(255,170,90,0.45)'); grd.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  }
  glowTex.needsUpdate = true;
}

gltfLoader.load(MODELS + 'terrain.glb', (gltf) => {
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      for (const m of [].concat(o.material)) if (m.name === 'TerrainBase') m.visible = false;
      o.material.roughness = 0.85; o.material.metalness = 0;
      if (o.material.map) o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (o.material.name === 'TerrainBaked') {
        terrainMat = o.material;
        // rock relief: stronger bumps and a little more sheen so the crags catch the light
        terrainMat.normalScale.set(1.8, 1.8);
        terrainMat.roughness = 0.72;
        // lift the near-black rock slightly so its detail reads (snow is unaffected)
        terrainMat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
            '#include <map_fragment>\n diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.055, 0.058, 0.068));');
        };
        terrainMat.emissiveMap = glowTex; terrainMat.emissive.set('#ffffff');
        terrainMat.emissiveIntensity = tod.cur.glow * GLOW_ON_SNOW;
        terrainMat.needsUpdate = true;
      }
    }
  });
  paintLightPools();
  scene.add(gltf.scene);
  scene.add(buildSurroundings(makeEdgeSampler(gltf.scene)));
  markLoaded('terrain');
}, undefined, (err) => { console.error('terrain failed to load', err); sticky.classList.add('is-fallback'); });

/* ---------- Soft glow texture (lamps) and cloud textures, drawn on canvases ---------- */
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.12, 'rgba(255,214,150,.9)');
  grd.addColorStop(0.35, 'rgba(255,180,100,.35)'); grd.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function cloudTexture(seed) {
  const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 38; i++) {                  // a cluster of soft puffs, denser in the middle
    const x = W * (0.18 + 0.64 * rnd()), y = H * (0.42 + 0.22 * (rnd() - 0.5)) - Math.abs(x - W / 2) * -0.05;
    const r = H * (0.12 + 0.22 * rnd()) * (1 - Math.abs(x - W / 2) / W);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- Clouds: a high layer above the peaks and low mist in the valley ---------- */
const clouds = { sprites: [], material: [], amount: 0.45 };
{
  const mats = [1, 2, 3].map(sd => new THREE.SpriteMaterial({ map: cloudTexture(sd * 7919), transparent: true, depthWrite: false, fog: true }));
  clouds.material = mats;
  const MAX = 70;
  for (let i = 0; i < MAX; i++) {
    const r = (k) => hash(i * 3.17 + k, i * 1.31 - k);
    const low = i % 3 === 0;                         // a third of them are low valley mist
    const s = new THREE.Sprite(mats[i % 3].clone());
    const w = low ? 0.9 + r(1) * 0.9 : 0.7 + r(1) * 1.1;
    s.scale.set(w, w * (low ? 0.28 : 0.45), 1);
    s.position.set(low ? -2.4 + r(2) * 2.6 : -4 + r(2) * 8, low ? 0.12 + r(3) * 0.2 : 1.05 + r(3) * 0.55, -4 + r(4) * 8);
    s.userData = { speed: 0.012 + r(5) * 0.02, rank: r(6), baseOpacity: low ? 0.55 : 0.85 };
    s.renderOrder = 2;
    scene.add(s); clouds.sprites.push(s);
  }
  clouds.material = clouds.sprites.map(s => s.material);
}
function setClouds(amount) {
  clouds.amount = amount;
  for (const s of clouds.sprites) {
    const on = s.userData.rank < amount;
    s.visible = on;
    // fade each cloud in as the slider passes it, so changes are gradual
    s.material.opacity = s.userData.baseOpacity * THREE.MathUtils.clamp((amount - s.userData.rank) * 6, 0, 1);
  }
}
function driftClouds(dt) {
  if (reduceMotion) return;
  for (const s of clouds.sprites) {
    s.position.z += s.userData.speed * dt;
    if (s.position.z > 4) s.position.z -= 8;          // wrap around
  }
}

/* ---------- Lifts ---------- */
const lifts = { parts: [], cables: [], count: 4 };
const lampGlow = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ map: glowTexture(), size: 0.07, transparent: true, depthWrite: false,
                             blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
lampGlow.visible = false;
scene.add(lampGlow);
let lampOffsets = null;

function setLiftCount(n) {
  lifts.count = n;
  // hide (rather than draw zero copies of) empty parts
  for (const { mesh, offsets } of lifts.parts) { mesh.count = offsets[n]; mesh.visible = offsets[n] > 0; }
  lifts.cables.forEach((c, i) => { c.visible = i + 1 <= n; });
  if (lampOffsets) lampGlow.geometry.setDrawRange(0, lampOffsets[n]);
  paintLightPools();
  updateForest();
  pressed('ctl-lifts', String(n));
}

Promise.all([
  gltfLoader.loadAsync(MODELS + 'lifts.glb'),
  fetch(MODELS + 'lifts.json').then(r => r.json()),
]).then(([gltf, data]) => {
  const m = new THREE.Matrix4(), local = new THREE.Matrix4();
  gltf.scene.updateMatrixWorld(true);   // compressed parts carry a small transform that must be kept
  for (const [name, part] of Object.entries(data.parts)) {
    const node = gltf.scene.getObjectByName(name);
    if (!node) { console.warn('missing part', name); continue; }
    const meshes = [];
    node.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const src of meshes) {
      const inst = new THREE.InstancedMesh(src.geometry, src.material, part.matrices.length);
      local.copy(src.matrixWorld);
      part.matrices.forEach((arr, i) => inst.setMatrixAt(i, m.fromArray(arr).multiply(local)));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      scene.add(inst);
      lifts.parts.push({ mesh: inst, offsets: part.offsets });
    }
    if (name === 'lamp') {                             // a glow point at the top of every lamp post
      const box = new THREE.Box3();
      meshes.forEach(ms => { ms.geometry.computeBoundingBox(); box.union(ms.geometry.boundingBox.clone().applyMatrix4(ms.matrixWorld)); });
      const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
      const pts = new Float32Array(part.matrices.length * 3), v = new THREE.Vector3();
      part.matrices.forEach((arr, i) => v.copy(top).applyMatrix4(m.fromArray(arr)).toArray(pts, i * 3));
      lampBases = new Float32Array(part.matrices.length * 3);
      part.matrices.forEach((arr, i) => { lampBases[i * 3] = arr[12]; lampBases[i * 3 + 1] = arr[13]; lampBases[i * 3 + 2] = arr[14]; });
      lampGlow.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      lampGlow.geometry.computeBoundingSphere();      // it started empty, so refresh its bounds
      lampOffsets = part.offsets;
    }
  }
  for (let i = 1; i <= data.maxLifts; i++) {
    const c = gltf.scene.getObjectByName(`cables_${i}`);
    if (c) { scene.add(c); lifts.cables.push(c); }
  }
  setLiftCount(lifts.count);
  markLoaded('lifts');
}).catch(err => { console.error('lifts failed to load', err); markLoaded('lifts'); });

/* ---------- Trees: 32k photo cards, one InstancedMesh per type ----------
   trees.bin = 16 bytes per tree: uint16 x,y,z (quantised), uint16 yaw, uint16 sx,sy,sz, uint8 clearedAtLifts.
   A tree is drawn if its lift corridor is not in use and it falls under the density setting. */
const forest = { types: [], density: 1 };

function updateForest() {
  for (const t of forest.types) {
    const out = t.mesh.instanceMatrix.array;
    let n = 0;
    for (let i = 0; i < t.total; i++) {
      if (t.cleared[i] <= lifts.count || t.rank[i] >= forest.density) continue;
      out.set(t.matrices.subarray(i * 16, i * 16 + 16), n * 16); n++;
    }
    t.mesh.count = n; t.mesh.visible = n > 0;
    t.mesh.instanceMatrix.needsUpdate = true;
  }
}

Promise.all([
  gltfLoader.loadAsync(MODELS + 'trees.glb'),
  fetch(MODELS + 'trees-index.json').then(r => r.json()),
  fetch(MODELS + 'trees.bin').then(r => r.arrayBuffer()),
]).then(([gltf, index, buf]) => {
  const view = new DataView(buf);
  const lo = index.bounds.min, hi = index.bounds.max, smax = index.scaleMax;
  const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const yawQ = new THREE.Quaternion(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), sc = new THREE.Vector3(), m = new THREE.Matrix4();
  const brighten = { pine: 1.58 };   // the generator's material lifts the pine texture's brightness

  for (const [type, info] of Object.entries(index.types)) {
    const src = gltf.scene.getObjectByName(type);
    let mesh0 = null; src.traverse(o => { if (o.isMesh && !mesh0) mesh0 = o; });
    const mat = mesh0.material;
    // Exported as alpha *blend* (no depth writes) - the ground could be drawn over them. Use solid cut-outs.
    mat.alphaTest = 0.5; mat.transparent = false; mat.depthWrite = true; mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
    if (brighten[type]) mat.color.setScalar(brighten[type]);
    const matrices = new Float32Array(info.count * 16), cleared = new Uint8Array(info.count), rank = new Float32Array(info.count);
    for (let i = 0; i < info.count; i++) {
      const o = (info.start + i) * index.bytesPerTree;
      const u = (k) => view.getUint16(o + k * 2, true) / 65535;
      p.set(lo[0] + u(0) * (hi[0] - lo[0]), lo[1] + u(1) * (hi[1] - lo[1]), lo[2] + u(2) * (hi[2] - lo[2]));
      yawQ.setFromAxisAngle(Y, u(3) * Math.PI * 2);
      q.multiplyQuaternions(yawQ, upright);
      sc.set(u(4) * smax, u(5) * smax, u(6) * smax);
      m.compose(p, q, sc).toArray(matrices, i * 16);
      cleared[i] = view.getUint8(o + 14);
      rank[i] = hash(p.x * 91.7, p.z * 53.3);            // stable random order for thinning
    }
    const inst = new THREE.InstancedMesh(mesh0.geometry, mat, info.count);
    inst.instanceMatrix.array.set(matrices);
    inst.computeBoundingSphere();
    scene.add(inst);
    forest.types.push({ mesh: inst, matrices, cleared, rank, total: info.count });
  }
  updateForest();
  markLoaded('trees');
}).catch(err => { console.error('trees failed to load', err); markLoaded('trees'); });

/* ---------- Controls ---------- */
panelToggle.addEventListener('click', () => {
  const open = panel.classList.toggle('open');
  panelToggle.setAttribute('aria-expanded', String(open));
});
if (params.has('nopanel')) { panel.style.display = 'none'; panelToggle.style.display = 'none'; }
function pressed(groupId, value) {
  document.querySelectorAll(`#${groupId} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
}
document.getElementById('ctl-lifts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setLiftCount(+b.dataset.v);
});
document.getElementById('ctl-time').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setTime(b.dataset.v);
});
const treesInput = document.getElementById('ctl-trees'), cloudsInput = document.getElementById('ctl-clouds');
let treesPending = false;
treesInput.addEventListener('input', () => {
  forest.density = treesInput.value / 100;
  if (!treesPending) { treesPending = true; requestAnimationFrame(() => { treesPending = false; updateForest(); }); }
});
cloudsInput.addEventListener('input', () => setClouds(cloudsInput.value / 100));

// starting values (test hooks in the URL can override)
if (params.has('trees'))  { treesInput.value = params.get('trees');  forest.density = treesInput.value / 100; }
if (params.has('clouds')) cloudsInput.value = params.get('clouds');
setClouds(cloudsInput.value / 100);
setTime(params.get('time') in TIMES ? params.get('time') : 'day', true);
updateTime(performance.now());

/* ---------- Scroll progress + colour blends into neighbouring sections ---------- */
const forced = params.has('p') ? parseFloat(params.get('p')) : null;
function scrollProgress() {
  const r = section.getBoundingClientRect();
  return THREE.MathUtils.clamp(-r.top / (r.height - window.innerHeight), 0, 1);
}
let target = forced ?? scrollProgress(), progress = target;
window.addEventListener('scroll', () => { if (forced === null) target = scrollProgress(); }, { passive: true });

function updateFades(p) {
  // opens on the sky colour the hero shades into, fades into the scene; ends by fading into the cream portfolio section
  const s = THREE.MathUtils.smoothstep;
  const top = 1 - s(p, 0.0, 0.12), bottom = s(p, 0.88, 1.0);
  fadeTop.style.opacity = top.toFixed(3);
  fadeBottom.style.opacity = bottom.toFixed(3);
  const controlsOpacity = (1 - Math.max(top, bottom) * 1.4).toFixed(3);
  const controlsOff = Math.max(top, bottom) > 0.5 ? 'none' : '';
  for (const el of [panel, panelToggle]) { el.style.opacity = controlsOpacity; el.style.pointerEvents = controlsOff; }
}

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const vf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(HFOV) / 2) / camera.aspect);
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vf), 30, 80);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const perf = { start: false, frames: 0, total: 0, level: 0 };
let visible = false;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(section);

const pos = new THREE.Vector3(), look = new THREE.Vector3();
// Mouse pan strength (scene units). Vertical is kept small: near the end of the dive the camera is close to the snow.
const PAN = { side: 0.085, up: 0.035, turn: 0.03 };
const debugCam = params.has('cam') ? [new THREE.Vector3(...params.get('cam').split(',').map(Number)), new THREE.Vector3(...params.get('look').split(',').map(Number))] : null;
const clock = new THREE.Clock();
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible && forced === null) return;
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  progress += (target - progress) * 0.08;
  mouse.sx += (mouse.x - mouse.sx) * 0.05;
  mouse.sy += (mouse.y - mouse.sy) * 0.05;
  updateTime(now ?? performance.now());
  driftClouds(dt);
  updateFades(target);                                       // colour blends follow the real scroll position

  // the camera moves between 10% and 86% of the section; the ends are reserved for the colour blends
  const p = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp((progress - 0.10) / 0.76, 0, 1), 0, 1);
  camCurve.getPointAt(p, pos);
  lookCurve.getPointAt(p, look);
  if (debugCam) { pos.copy(debugCam[0]); look.copy(debugCam[1]); }
  // tall (phone) screens: pull the camera back along its view line so the slopes still fit side to side
  // (eased in after the opening bird's-eye view, which already fits - pulling back there goes behind the summit)
  if (camera.aspect < 1) {
    const pull = (1 / camera.aspect - 1) * PATH.portraitPull * THREE.MathUtils.smoothstep(p, 0.12, 0.4);
    pos.sub(look).multiplyScalar(1 + pull).add(look);
  }
  if (!reduceMotion) {
    pos.z  += mouse.sx * PAN.side + Math.sin(t * 0.3) * 0.006;   // mouse pan + gentle breathing
    pos.y  += -mouse.sy * PAN.up + Math.cos(t * 0.25) * 0.004;
    look.z += mouse.sx * PAN.turn;                                // the view turns a little with the pan
  }
  camera.position.copy(pos);
  camera.lookAt(look);
  renderer.render(scene, camera);
  watchPerformance(dt);
}
requestAnimationFrame(frame);

/* ---------- Automatic quality drop for slow devices ----------
   After everything has loaded, average the frame time over ~90 frames. If the device can't hold
   ~28 fps, step quality down (pixel ratio, tree density, clouds) - up to two steps. */
function watchPerformance(dt) {
  if (!perf.start || perf.level >= 2 || forced !== null) return;
  perf.frames++; perf.total += dt;
  if (perf.frames < 90) return;
  const avg = perf.total / perf.frames;
  perf.frames = 0; perf.total = 0;
  if (avg < 1 / 28) { perf.start = false; return; }              // fast enough - stop watching
  perf.level++;
  if (perf.level === 1) {
    maxPixelRatio = 1;
    if (forest.density > 0.6) { forest.density = 0.6; treesInput.value = 60; updateForest(); }
  } else {
    maxPixelRatio = 0.75;
    forest.density = Math.min(forest.density, 0.35); treesInput.value = Math.round(forest.density * 100); updateForest();
    cloudsInput.value = 0; setClouds(0);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio)); resize();
  console.info('ski resort: lowered quality to level', perf.level, '(avg frame', Math.round(avg * 1000), 'ms)');
}
}   // end start()
