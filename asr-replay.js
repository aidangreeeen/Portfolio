/* ============================================================
   ASR drone - search replay over the ski resort (three.js r170, ES module)
   Plays back recorded PX4 + Gazebo simulation flights: grid search, beacon
   pickup, pinpointing, then hovering over the victim.

   Scene: the same models as the homepage ski section (Models/ski-resort/).
   Flights: Models/asr-replay/flights.json, in metres relative to the takeoff
   pad (n = north/uphill, e = east, up). Scene units: 1 unit = 400 m, with
   scene x = valley->summit (north), y = up, z = east.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const root = document.getElementById('asr-replay');
if (root) init(root);

async function init(root) {
  const SKI = root.dataset.models || 'Models/ski-resort/';
  const DATA = root.dataset.src || 'Models/asr-replay/';
  const canvas = root.querySelector('canvas');
  const statusEl = root.querySelector('.ar-status');
  const $ = (s) => root.querySelector(s);

  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('webgl');
  } catch { statusEl.textContent = '3D replay needs WebGL'; return; }

  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let data;
  try { data = await fetch(DATA + 'flights.json').then((r) => r.json()); }
  catch (e) { statusEl.textContent = 'Replay data unavailable'; console.error(e); return; }
  const S = data.frame.scale, HOME = data.frame.home_scene_m;
  // flight metres (relative to the pad) -> scene units
  const toScene = (n, e, up, out = new THREE.Vector3()) => out.set((n + HOME.n) / S, (up + HOME.up) / S, (e + HOME.e) / S);

  /* ---------------- renderer / scene (matches the homepage "day" look) ---------------- */
  const touch = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);           // sky = CSS gradient behind the canvas
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#e6e9e4', 1.8, 4.4);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.002, 50);
  scene.add(new THREE.HemisphereLight('#dfe8f3', '#4a5260', 1.1));
  const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
  sun.position.set(-1.5, 2.5, 2.5);
  scene.add(sun);

  /* ---------------- resort: terrain, surroundings, lifts, trees ---------------- */
  let terrainRoot = null;
  const loadTerrain = gltfLoader.loadAsync(SKI + 'terrain.glb').then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (m.name === 'TerrainBase') m.visible = false;
      o.material.roughness = 0.85; o.material.metalness = 0;
      if (o.material.map) o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (o.material.name === 'TerrainBaked') {
        o.material.normalScale.set(1.8, 1.8);
        o.material.roughness = 0.72;
        o.material.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
            '#include <map_fragment>\n diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.055, 0.058, 0.068));');
        };
      }
    });
    terrainRoot = gltf.scene;
    scene.add(gltf.scene);
    scene.add(buildSurroundings(makeEdgeSampler(gltf.scene)));
  });

  const loadLifts = Promise.all([gltfLoader.loadAsync(SKI + 'lifts.glb'), fetch(SKI + 'lifts.json').then((r) => r.json())])
    .then(([gltf, L]) => {
      const m = new THREE.Matrix4(), local = new THREE.Matrix4();
      gltf.scene.updateMatrixWorld(true);
      for (const [name, part] of Object.entries(L.parts)) {
        const node = gltf.scene.getObjectByName(name);
        if (!node) continue;
        node.traverse((src) => {
          if (!src.isMesh) return;
          const inst = new THREE.InstancedMesh(src.geometry, src.material, part.matrices.length);
          local.copy(src.matrixWorld);
          part.matrices.forEach((arr, i) => inst.setMatrixAt(i, m.fromArray(arr).multiply(local)));
          inst.computeBoundingSphere();
          scene.add(inst);
        });
      }
      for (let i = 1; i <= L.maxLifts; i++) { const c = gltf.scene.getObjectByName(`cables_${i}`); if (c) scene.add(c); }
    });

  const loadTrees = Promise.all([gltfLoader.loadAsync(SKI + 'trees.glb'), fetch(SKI + 'trees-index.json').then((r) => r.json()),
    fetch(SKI + 'trees.bin').then((r) => r.arrayBuffer())]).then(([gltf, index, buf]) => {
    const view = new DataView(buf);
    const lo = index.bounds.min, hi = index.bounds.max, smax = index.scaleMax;
    const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const yawQ = new THREE.Quaternion(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), sc = new THREE.Vector3(), m = new THREE.Matrix4();
    for (const [type, info] of Object.entries(index.types)) {
      let mesh0 = null; gltf.scene.getObjectByName(type).traverse((o) => { if (o.isMesh && !mesh0) mesh0 = o; });
      const mat = mesh0.material;
      mat.alphaTest = 0.5; mat.transparent = false; mat.depthWrite = true; mat.side = THREE.DoubleSide;
      if (type === 'pine') mat.color.setScalar(1.58);
      const inst = new THREE.InstancedMesh(mesh0.geometry, mat, info.count);
      let n = 0;
      for (let i = 0; i < info.count; i++) {
        const o = (info.start + i) * index.bytesPerTree;
        if (view.getUint8(o + 14) <= 4) continue;            // cleared for the lift corridors
        const u = (k) => view.getUint16(o + k * 2, true) / 65535;
        p.set(lo[0] + u(0) * (hi[0] - lo[0]), lo[1] + u(1) * (hi[1] - lo[1]), lo[2] + u(2) * (hi[2] - lo[2]));
        yawQ.setFromAxisAngle(Y, u(3) * Math.PI * 2);
        q.multiplyQuaternions(yawQ, upright);
        sc.set(u(4) * smax, u(5) * smax, u(6) * smax);
        inst.setMatrixAt(n++, m.compose(p, q, sc));
      }
      inst.count = n;
      inst.computeBoundingSphere();
      scene.add(inst);
    }
  });

  try { await Promise.all([loadTerrain, loadLifts, loadTrees]); }
  catch (e) { statusEl.textContent = 'Couldn’t load the resort'; console.error(e); return; }

  /* ---------------- ground lookups (raycast the terrain) ---------------- */
  const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), tmp = new THREE.Vector3();
  terrainRoot.updateMatrixWorld(true);
  const groundY = (x, z) => {
    ray.set(tmp.set(x, 5, z), DOWN);
    const hit = ray.intersectObject(terrainRoot, true)[0];
    return hit ? hit.point.y : 0;
  };

  /* ---------------- overlays ---------------- */
  const ACCENT = new THREE.Color('#CE8946'), INK = new THREE.Color('#1A1A0F');
  const overlay = new THREE.Group();
  scene.add(overlay);

  // search box outline + lanes, draped on the snow
  {
    const b = data.search, mat = new THREE.LineDashedMaterial({ color: '#1A1A0F', dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.45, fog: false });
    const drape = (pts) => {
      const v = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [n0, e0] = pts[i], [n1, e1] = pts[i + 1], steps = Math.ceil(Math.hypot(n1 - n0, e1 - e0) / 4);
        for (let k = 0; k <= steps; k++) {
          const n = n0 + (n1 - n0) * k / steps, e = e0 + (e1 - e0) * k / steps;
          const pt = toScene(n, e, 0); pt.y = groundY(pt.x, pt.z) + 0.003; v.push(pt);
        }
      }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), mat);
      l.computeLineDistances(); return l;
    };
    overlay.add(drape([[b.n_min, b.e_min], [b.n_max, b.e_min], [b.n_max, b.e_max], [b.n_min, b.e_max], [b.n_min, b.e_min]]));
  }

  // takeoff pad
  {
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.012, 32), new THREE.MeshBasicMaterial({ color: '#1A1A0F', side: THREE.DoubleSide, fog: false }));
    const p0 = toScene(0, 0, 0); pad.position.set(p0.x, groundY(p0.x, p0.z) + 0.002, p0.z); pad.rotation.x = -Math.PI / 2;
    overlay.add(pad);
  }

  // drone (shown ~8x real size so it reads against a 1.4 km resort)
  const drone = new THREE.Group();
  {
    const U = 1 / S * 6;
    const dark = new THREE.MeshStandardMaterial({ color: '#1A1A0F', roughness: 0.5, metalness: 0.3 });
    drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5 * U, 0.18 * U, 0.5 * U), dark));
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5 * U, 0.06 * U, 0.08 * U), dark); arm.rotation.y = a; drone.add(arm);
    }
    for (const [x, z] of [[0.53, 0.53], [0.53, -0.53], [-0.53, 0.53], [-0.53, -0.53]]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.33 * U, 0.33 * U, 0.02 * U, 20),
        new THREE.MeshBasicMaterial({ color: '#FFFFE3', transparent: true, opacity: 0.45 }));
      r.position.set(x * U, 0.12 * U, z * U); drone.add(r);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12 * U, 12, 8), new THREE.MeshBasicMaterial({ color: '#CE8946' }));
    light.position.y = -0.14 * U; drone.add(light);
  }
  // a copper dot that stays the same size on screen, so the drone can be spotted from the wide shot
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(206,137,70,0.28)'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#CE8946'; g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#FFFFE3'; g.lineWidth = 4; g.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true, fog: false }));
    dot.scale.setScalar(0.035); dot.renderOrder = 10;
    drone.add(dot);
  }
  scene.add(drone);
  const aglGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const aglLine = new THREE.Line(aglGeo, new THREE.LineDashedMaterial({ color: '#CE8946', dashSize: 0.003, gapSize: 0.002, fog: false }));
  aglLine.frustumCulled = false;
  scene.add(aglLine);
  const pulses = [0, 1, 2].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: '#CE8946', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    r.rotation.x = -Math.PI / 2; scene.add(r); return r;
  });
  const marker = new THREE.Group();
  {
    const U = 1 / S;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * U, 0.25 * U, 14 * U, 8), new THREE.MeshStandardMaterial({ color: '#1A1A0F' }));
    pole.position.y = 7 * U;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(6 * U, 3.5 * U, 0.2 * U), new THREE.MeshBasicMaterial({ color: '#CE8946' }));
    flag.position.set(0, 12 * U, 3 * U); flag.rotation.y = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(4 * U, 5.5 * U, 40), new THREE.MeshBasicMaterial({ color: '#CE8946', side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.4 * U;
    marker.add(pole, flag, ring);
    marker.visible = false;
  }
  scene.add(marker);

  // flight path (rebuilt per flight)
  let path = null;

  /* ---------------- flights ---------------- */
  let F = null, N = 0, T_END = 1;
  const flightBtns = $('.ar-flights');
  data.flights.forEach((f, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}`; b.title = f.label; b.dataset.i = i;
    b.addEventListener('click', () => loadFlight(i, true));
    flightBtns.appendChild(b);
  });
  function loadFlight(i, play) {
    F = data.flights[i]; N = F.t.length; T_END = F.t[N - 1];
    flightBtns.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
    $('.ar-where').textContent = F.label;
    if (path) { scene.remove(path); path.geometry.dispose(); }
    const pts = new Float32Array(N * 3), cols = new Float32Array(N * 3), v = new THREE.Vector3(), c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      toScene(F.n[k], F.e[k], F.up[k], v).toArray(pts, k * 3);
      c.copy(INK); if (F.s[k] > 0) c.lerp(ACCENT, 0.4 + 0.6 * F.s[k] / 100);
      c.toArray(cols, k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    path = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, fog: false }));
    path.frustumCulled = false;
    scene.add(path);
    const mp = toScene(F.estimate.n, F.estimate.e, 0);
    marker.position.set(mp.x, groundY(mp.x, mp.z), mp.z);
    $('.ar-err').textContent = F.error_m < 0.1 ? 'under 0.1 m' : `${F.error_m.toFixed(1)} m`;
    $('.ar-clear').textContent = `${F.clearance_m.toFixed(1)} m`;
    $('.ar-dur').textContent = fmt(F.t_found ?? T_END);
    t = 0; scrub.max = T_END; setPlaying(play);
    startIntro();
  }

  /* ---------------- camera ---------------- */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 0.03; controls.maxDistance = 2.5;
  let follow = false;
  const camOff = new THREE.Vector3(-0.16, 0.09, 0.07);    // behind (downhill of) the drone, a little to the side
  // Opening shot: the whole search area from down the valley. After INTRO_S seconds of playback the
  // camera eases in behind the drone (unless the visitor has taken the camera).
  const INTRO_S = 4.5;
  const overviewTarget = new THREE.Vector3(), overviewPos = new THREE.Vector3();
  {
    const b = data.search;
    // aim between the takeoff pad and the middle of the search area, so both are in frame
    toScene(b.n_min * 0.5 + (b.n_max - b.n_min) * 0.3, (b.e_min + b.e_max) / 2, 0, overviewTarget);
    overviewTarget.y = groundY(overviewTarget.x, overviewTarget.z);
    overviewPos.copy(overviewTarget).add(new THREE.Vector3(-0.6, 0.33, 0.2));
  }
  let intro = 0, introActive = false;
  function startIntro() {
    follow = false; intro = 0; introActive = true;
    camera.position.copy(overviewPos); controls.target.copy(overviewTarget);
    $('.ar-cam').textContent = 'Follow drone';
  }
  controls.addEventListener('start', () => { introActive = false; if (follow) setFollow(false); });
  function setFollow(on) {
    follow = on; introActive = false;
    $('.ar-cam').textContent = on ? 'Free camera' : 'Follow drone';
  }
  $('.ar-cam').addEventListener('click', () => setFollow(!follow));

  /* ---------------- playback ---------------- */
  let t = 0, playing = false, speed = 8, lastNow = null, inView = false, started = false;
  const scrub = $('.ar-scrub'), playBtn = $('.ar-play');
  function setPlaying(p) { playing = p; playBtn.textContent = p ? 'Pause' : (t >= T_END ? 'Replay' : 'Play'); playBtn.setAttribute('aria-pressed', String(p)); }
  playBtn.addEventListener('click', () => { if (t >= T_END) t = 0; setPlaying(!playing); });
  scrub.addEventListener('input', () => { t = +scrub.value; });
  root.querySelectorAll('.ar-speed button').forEach((b) => b.addEventListener('click', () => {
    speed = +b.dataset.v;
    root.querySelectorAll('.ar-speed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function sampleAt(time) {
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F.t[mid] <= time) lo = mid; else hi = mid; }
    const k = F.t[hi] > F.t[lo] ? THREE.MathUtils.clamp((time - F.t[lo]) / (F.t[hi] - F.t[lo]), 0, 1) : 0;
    const L = (a) => a[lo] + (a[hi] - a[lo]) * k;
    return { i: lo, n: L(F.n), e: L(F.e), up: L(F.up), s: F.s[lo], agl: F.agl[lo] };
  }
  function phaseAt(time) {
    if (F.t_detect == null || time < F.t_detect) return ['Grid search', 'Lanes 40 m apart, 12 m above the snow, trees and lifts avoided'];
    if (F.t_found == null || time < F.t_found) return ['Beacon detected', 'Fitting the burial spot to every reading'];
    return ['Victim located', 'Hovering over the burial spot for rescuers'];
  }

  const hud = { phase: $('.ar-phase'), time: $('.ar-time'), agl: $('.ar-agl'), alt: $('.ar-alt'), sig: $('.ar-sig'), sigBar: $('.ar-sigbar i'), result: $('.ar-result') };
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), heading = new THREE.Vector3(1, 0, 0);
  function update(dt) {
    if (playing) { t = Math.min(T_END, t + dt * speed); if (t >= T_END) setPlaying(false); }
    scrub.value = t;
    const s = sampleAt(t);
    toScene(s.n, s.e, s.up, pos);
    drone.position.copy(pos);
    const a = sampleAt(Math.min(T_END, t + 1.5));
    toScene(a.n, a.e, a.up, ahead).sub(pos); ahead.y = 0;
    if (ahead.lengthSq() > 1e-8) heading.copy(ahead).normalize();
    drone.rotation.y = Math.atan2(-heading.z, heading.x);
    drone.rotation.z = -0.15 * Math.min(1, ahead.length() * S / 6);
    path.geometry.setDrawRange(0, s.i + 1);
    const gy = groundY(pos.x, pos.z);
    const ap = aglGeo.attributes.position;
    ap.setXYZ(0, pos.x, pos.y - 0.6 / S, pos.z); ap.setXYZ(1, pos.x, gy, pos.z); ap.needsUpdate = true;
    aglLine.computeLineDistances();

    const now = performance.now() / 1000;
    const located = F.t_found != null && t >= F.t_found;
    pulses.forEach((r, k) => {
      if (s.s > 0 && !located) {
        const ph = (now * 0.9 + k / 3) % 1;
        r.position.set(pos.x, gy + 0.6 / S, pos.z);
        r.scale.setScalar((4 + ph * (10 + 0.3 * s.s)) / S);
        r.material.opacity = (1 - ph) * (0.25 + 0.6 * s.s / 100);
      } else r.material.opacity = 0;
    });
    marker.visible = located;
    if (located) marker.children[1].rotation.x = Math.sin(now * 2.2) * 0.15;

    const [ph, sub] = phaseAt(t);
    hud.phase.textContent = ph; hud.phase.dataset.sub = sub;
    hud.time.textContent = fmt(t);
    hud.agl.textContent = s.agl == null ? '-' : `${s.agl.toFixed(1)} m`;
    hud.alt.textContent = `${s.up.toFixed(0)} m`;
    hud.sig.textContent = s.s > 0 ? s.s.toFixed(0) : '-';
    hud.sigBar.style.width = `${s.s}%`;
    hud.result.hidden = !located;

    if (introActive && playing) {
      intro += dt;
      if (intro > INTRO_S) { introActive = false; follow = true; $('.ar-cam').textContent = 'Free camera'; }
    }
    if (follow) {
      // gentle at first (coming in from the wide shot), then a normal chase
      const k = intro < INTRO_S + 3 ? 0.9 : 2.0;
      camera.position.lerp(tmp.copy(pos).add(camOff), Math.min(1, dt * k));
      controls.target.lerp(pos, Math.min(1, dt * k * 1.6));
      intro += dt;
    }
    controls.update();
  }

  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  loadFlight(0, false);
  new IntersectionObserver(([en]) => {
    inView = en.isIntersecting;
    if (inView && !started) { started = true; setPlaying(true); }
  }, { threshold: 0.35 }).observe(root);

  statusEl.remove();
  root.classList.add('ready');
  update(0);
  renderer.setAnimationLoop((nowMs) => {
    if (!inView) { lastNow = null; return; }
    const dt = lastNow == null ? 0 : Math.min(0.1, (nowMs - lastNow) / 1000);
    lastNow = nowMs;
    update(dt);
    renderer.render(scene, camera);
  });
}

/* ---------- surroundings: procedural mountains around the resort (same as the homepage) ---------- */
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
      if (v.x > RESORT.x - tol) sides.xp[bz] = Math.max(sides.xp[bz], v.y);
      if (v.x < -RESORT.x + tol) sides.xn[bz] = Math.max(sides.xn[bz], v.y);
      if (v.z > RESORT.z - tol) sides.zp[bx] = Math.max(sides.zp[bx], v.y);
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
    const jitter = (vnoise(p.getX(i) * 4, p.getZ(i) * 4) - 0.5) * 0.12;
    const k = THREE.MathUtils.smoothstep(n.getY(i) + jitter, 0.62, 0.9);
    c.copy(rock).lerp(snow, k).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
}
