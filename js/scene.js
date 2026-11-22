// ─────────────────────────────────────────────────────────────
//  Intro scene: a digital neural network that reassembles into a
//  3D infographic human (particles + plexus + HUD + callouts).
// ─────────────────────────────────────────────────────────────
import * as THREE from '../assets/three.module.min.js';

THREE.ColorManagement.enabled = false;

const FOV = 35;
const CAM_Z = 6.8;
const T_MORPH = 2.3;     // network → human starts
const D_MORPH = 2.8;     // morph duration
const T_FORMED = 4.9;    // plexus/HUD fade in
const T_READY = 5.45;    // hero text reveal
const T_END = 6.2;

// ── Body model: smooth union of ellipsoids / tapered capsules ──
// t: E ellipsoid [cx,cy,cz,rx,ry,rz] · S sphere [cx,cy,cz,r] · C capsule [ax,ay,az,bx,by,bz,r1,r2]
// s: mirrored on x · k: blend radius · w: sampling weight
const BODY = [
  { t: 'E', s: 0, k: 0.05, w: 1.3, c: [0, 1.5, 0, 0.152, 0.2, 0.178] },            // cranium
  { t: 'E', s: 0, k: 0.045, w: 1.3, c: [0, 1.405, 0.035, 0.108, 0.105, 0.118] },   // jaw
  { t: 'E', s: 0, k: 0.02, w: 1.6, c: [0, 1.47, 0.168, 0.022, 0.048, 0.03] },      // nose
  { t: 'E', s: 1, k: 0.02, w: 1.3, c: [0.152, 1.48, 0, 0.018, 0.048, 0.032] },     // ears
  { t: 'C', s: 0, k: 0.04, w: 1, c: [0, 1.21, -0.01, 0, 1.4, 0, 0.068, 0.062] },   // neck
  { t: 'C', s: 1, k: 0.08, w: 1, c: [0.02, 1.17, -0.02, 0.31, 1.115, -0.02, 0.085, 0.072] }, // trapezius
  { t: 'E', s: 0, k: 0.1, w: 1, c: [0, 0.93, 0, 0.33, 0.29, 0.185] },              // chest
  { t: 'E', s: 0, k: 0.1, w: 1, c: [0, 0.57, 0, 0.258, 0.3, 0.165] },              // abdomen
  { t: 'E', s: 0, k: 0.08, w: 1, c: [0, 0.23, 0, 0.295, 0.21, 0.175] },            // pelvis
  { t: 'S', s: 1, k: 0.06, w: 1, c: [0.355, 1.075, -0.015, 0.1] },                 // deltoids
  { t: 'C', s: 1, k: 0.04, w: 1, c: [0.375, 1.04, -0.015, 0.49, 0.56, 0, 0.078, 0.058] },    // upper arms
  { t: 'C', s: 1, k: 0.035, w: 1, c: [0.49, 0.56, 0, 0.565, 0.1, 0.05, 0.058, 0.042] },      // forearms
  { t: 'C', s: 1, k: 0.03, w: 1.3, c: [0.57, 0.055, 0.055, 0.595, -0.135, 0.065, 0.046, 0.033] }, // hands
  { t: 'C', s: 1, k: 0.06, w: 1, c: [0.15, 0.14, 0, 0.165, -0.74, 0.01, 0.135, 0.082] },     // thighs
  { t: 'C', s: 1, k: 0.04, w: 1, c: [0.165, -0.74, 0.01, 0.175, -1.58, -0.03, 0.078, 0.048] }, // shins
  { t: 'C', s: 1, k: 0.035, w: 1.2, c: [0.175, -1.655, -0.04, 0.19, -1.7, 0.17, 0.05, 0.042] }, // feet
];

const rnd = Math.random;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function sdE(x, y, z, c) {
  const X = x - c[0], Y = y - c[1], Z = z - c[2];
  const k0 = Math.hypot(X / c[3], Y / c[4], Z / c[5]);
  const k1 = Math.hypot(X / (c[3] * c[3]), Y / (c[4] * c[4]), Z / (c[5] * c[5]));
  return k1 === 0 ? -Math.min(c[3], c[4], c[5]) : (k0 * (k0 - 1)) / k1;
}
function sdC(x, y, z, c) {
  const bx = c[3] - c[0], by = c[4] - c[1], bz = c[5] - c[2];
  const px = x - c[0], py = y - c[1], pz = z - c[2];
  let h = (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (c[6] + (c[7] - c[6]) * h);
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function sdf(x, y, z) {
  const ax = Math.abs(x);
  let d = 0;
  for (let i = 0; i < BODY.length; i++) {
    const p = BODY[i], X = p.s ? ax : x, c = p.c;
    const v = p.t === 'E' ? sdE(X, y, z, c) : p.t === 'S' ? Math.hypot(X - c[0], y - c[1], z - c[2]) - c[3] : sdC(X, y, z, c);
    d = i === 0 ? v : smin(d, v, p.k);
  }
  return d;
}
function randDir() {
  let x, y, z, l;
  do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l);
  return [x / l, y / l, z / l];
}
function areaOf(p) {
  const c = p.c;
  let a;
  if (p.t === 'S') a = 4 * Math.PI * c[3] * c[3];
  else if (p.t === 'E') {
    const q = 1.6075, A = Math.pow(c[3], q), B = Math.pow(c[4], q), C = Math.pow(c[5], q);
    a = 4 * Math.PI * Math.pow((A * B + A * C + B * C) / 3, 1 / q);
  } else {
    const L = Math.hypot(c[3] - c[0], c[4] - c[1], c[5] - c[2]);
    a = Math.PI * (c[6] + c[7]) * L + 2 * Math.PI * (c[6] * c[6] + c[7] * c[7]);
  }
  return a * (p.s ? 2 : 1) * p.w;
}
function samplePrim(p) {
  const c = p.c;
  let x, y, z;
  if (p.t === 'S') { const d = randDir(); x = c[0] + d[0] * c[3]; y = c[1] + d[1] * c[3]; z = c[2] + d[2] * c[3]; }
  else if (p.t === 'E') { const d = randDir(); x = c[0] + d[0] * c[3]; y = c[1] + d[1] * c[4]; z = c[2] + d[2] * c[5]; }
  else {
    const [ax, ay, az, bx, by, bz, r1, r2] = c;
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    const lat = Math.PI * (r1 + r2) * L, caps = 2 * Math.PI * (r1 * r1 + r2 * r2);
    if (rnd() < lat / (lat + caps)) {
      const rm = Math.max(r1, r2);
      let t;
      do { t = rnd(); } while (rnd() * rm > r1 + (r2 - r1) * t);
      const r = r1 + (r2 - r1) * t;
      const kx = (bx - ax) / L, ky = (by - ay) / L, kz = (bz - az) / L;
      let ux, uy, uz;
      if (Math.abs(ky) < 0.9) { ux = kz; uy = 0; uz = -kx; } else { ux = 0; uy = -kz; uz = ky; }
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const vx = ky * uz - kz * uy, vy = kz * ux - kx * uz, vz = kx * uy - ky * ux;
      const th = rnd() * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      x = ax + (bx - ax) * t + (ux * cs + vx * sn) * r;
      y = ay + (by - ay) * t + (uy * cs + vy * sn) * r;
      z = az + (bz - az) * t + (uz * cs + vz * sn) * r;
    } else {
      const end = rnd() < (r2 * r2) / (r1 * r1 + r2 * r2);
      const d = randDir(), r = end ? r2 : r1;
      x = (end ? bx : ax) + d[0] * r; y = (end ? by : ay) + d[1] * r; z = (end ? bz : az) + d[2] * r;
    }
  }
  if (p.s && rnd() < 0.5) x = -x;
  return [x, y, z];
}
function projectToSurface(x, y, z) {
  for (let it = 0; it < 5; it++) {
    const d = sdf(x, y, z);
    if (Math.abs(d) < 0.0012) return [x, y, z, d];
    const e = 0.0025;
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    x -= (d * gx) / gl; y -= (d * gy) / gl; z -= (d * gz) / gl;
  }
  return [x, y, z, sdf(x, y, z)];
}
function genBody(nSurf, nBrain) {
  const areas = BODY.map(areaOf);
  const total = areas.reduce((a, b) => a + b, 0);
  const cdf = [];
  let acc = 0;
  for (const a of areas) { acc += a / total; cdf.push(acc); }
  const out = new Float32Array((nSurf + nBrain) * 3);
  let n = 0, guard = 0;
  while (n < nSurf && guard < nSurf * 40) {
    guard++;
    const r = rnd();
    let i = 0;
    while (i < cdf.length - 1 && r > cdf[i]) i++;
    const p = samplePrim(BODY[i]);
    if (sdf(p[0], p[1], p[2]) < -0.02) continue; // buried inside another part
    const q = projectToSurface(p[0], p[1], p[2]);
    if (Math.abs(q[3]) > 0.005) continue;
    out[n * 3] = q[0]; out[n * 3 + 1] = q[1]; out[n * 3 + 2] = q[2];
    n++;
  }
  for (; n < nSurf; n++) { const j = (rnd() * Math.max(1, n)) | 0; out[n * 3] = out[j * 3]; out[n * 3 + 1] = out[j * 3 + 1]; out[n * 3 + 2] = out[j * 3 + 2]; }
  // a glowing "brain" cluster inside the head
  for (let j = 0; j < nBrain; j++) {
    let x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
    const o = (nSurf + j) * 3;
    out[o] = x * 0.1; out[o + 1] = 1.55 + y * 0.1; out[o + 2] = -0.015 + z * 0.115;
  }
  return out;
}
function plexus(pos, count, maxD, k) {
  const inv = 1 / maxD, map = new Map(), cellOf = new Int32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.floor(pos[i * 3] * inv), b = Math.floor(pos[i * 3 + 1] * inv), c = Math.floor(pos[i * 3 + 2] * inv);
    cellOf[i * 3] = a; cellOf[i * 3 + 1] = b; cellOf[i * 3 + 2] = c;
    const key = a + ',' + b + ',' + c;
    let arr = map.get(key);
    if (!arr) map.set(key, (arr = []));
    arr.push(i);
  }
  const seen = new Set(), segs = [], m2 = maxD * maxD;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cand = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = map.get(cellOf[i * 3] + dx + ',' + (cellOf[i * 3 + 1] + dy) + ',' + (cellOf[i * 3 + 2] + dz));
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const d2 = (pos[j * 3] - x) ** 2 + (pos[j * 3 + 1] - y) ** 2 + (pos[j * 3 + 2] - z) ** 2;
        if (d2 < m2 && d2 > 1e-6) cand.push(d2, j);
      }
    }
    const order = [];
    for (let m = 0; m < cand.length; m += 2) order.push([cand[m], cand[m + 1]]);
    order.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < Math.min(k, order.length); m++) {
      const j = order[m][1], a = Math.min(i, j), b = Math.max(i, j), key = a * 100003 + b;
      if (seen.has(key)) continue;
      seen.add(key);
      segs.push(a, b);
    }
  }
  return segs;
}
function genNetwork() {
  const layers = [4, 7, 9, 9, 7, 4], L = layers.length, nodes = [], starts = [];
  let off = 0;
  layers.forEach((cnt, li) => {
    starts.push(off); off += cnt;
    const x = -2.7 + li * (5.4 / (L - 1)), R = 0.3 + cnt * 0.135;
    for (let k = 0; k < cnt; k++) {
      const r = R * Math.sqrt((k + 0.5) / cnt), a = k * 2.399963 + li * 0.7;
      nodes.push([x, r * Math.cos(a), r * Math.sin(a)]);
    }
  });
  const edges = [];
  for (let li = 0; li < L - 1; li++)
    for (let a = 0; a < layers[li]; a++)
      for (let b = 0; b < layers[li + 1]; b++) edges.push([starts[li] + a, starts[li + 1] + b]);
  return { nodes, edges };
}
function ringPositions(r, seg, sx = 1, sz = 1, dashed = false) {
  const a = [];
  for (let i = 0; i < seg; i++) {
    if (dashed && i % 2) continue;
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    a.push(Math.cos(t0) * r * sx, 0, Math.sin(t0) * r * sz, Math.cos(t1) * r * sx, 0, Math.sin(t1) * r * sz);
  }
  return a;
}

// ── Shaders ──
const VERT = /* glsl */ `
uniform float uTime, uMorph, uNetFade, uSize, uScan, uLight, uBodyFx;
uniform mat4 uNetM, uHumM;
uniform vec3 uC1, uC2, uC3;
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aH;
attribute vec4 aI;
varying vec3 vCol;
varying float vA;
void main(){
  float r1 = aI.z, r2 = aI.w;
  float ft = fract(r1 + uTime * (0.16 + r2 * 0.32));
  vec3 np = mix(aA, aB, aI.x > 0.5 ? 0.0 : ft);
  vec3 nw = (uNetM * vec4(np, 1.0)).xyz;
  vec3 hw = (uHumM * vec4(aH, 1.0)).xyz;
  float hy = clamp((aH.y + 1.75) / 3.5, 0.0, 1.0);
  float p = clamp((uMorph * 1.3 - (hy * 0.62 + r1 * 0.28)) / 0.4, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  vec3 sw = vec3(sin(r1 * 91.0 + r2 * 13.0), cos(r2 * 77.0 + r1 * 7.0), sin((r1 - r2) * 53.0));
  vec3 pos = mix(nw, hw, e) + sw * sin(e * 3.14159) * (0.3 + r2 * 0.45);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float sc = exp(-pow((aH.y - uScan) * 11.0, 2.0)) * e * 0.75;
  float band = smoothstep(0.88, 1.0, sin(aH.y * 26.0 - uTime * 1.3) * 0.5 + 0.5) * uBodyFx;
  float s = mix(mix(0.9, 2.3, aI.x), mix(1.0, 1.15, aI.y), e);
  s *= (0.82 + 0.36 * sin(uTime * 1.7 + r1 * 60.0)) * (1.0 + sc * 1.1);
  gl_PointSize = uSize * s * (7.0 / -mv.z);
  vec3 cn = mix(mix(uC1, uC3, ft * 0.85), mix(uC2, uC3, 0.35), aI.x * 0.8);
  float acc = max(aI.y, step(0.94, r2));
  vec3 ch = mix(mix(uC1, uC2, r1 * 0.75), uC3, acc);
  vec3 hi = mix(vec3(1.0), uC3, uLight);
  vCol = mix(cn, ch, e) + (band * 0.3 + sc * 0.55) * hi * (1.0 - uLight * 0.6);
  float an = uNetFade * mix(0.5, 1.0, aI.x);
  float ah = 0.58 + 0.25 * r2 + band * 0.45 + sc * 0.6 - aI.y * 0.12;
  vA = mix(an, ah, e);
}`;
const FRAG = /* glsl */ `
uniform float uSharp, uAlpha;
varying vec3 vCol;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, uSharp);
  gl_FragColor = vec4(vCol, clamp(a * vA * uAlpha, 0.0, 1.0));
}`;

const PALETTE = {
  dark: { c1: '#8fc6ff', c2: '#eef3fa', c3: '#ff5a7a', net: '#8fc6ff', plex: '#9fcfff', hud: '#ff6f8c', hud2: '#8fc6ff', glow: '#ff3d63', sharp: 1.55, size: 2.5, netOp: 0.13, plexOp: 0.15, hudOp: 0.55, glowOp: 0.22 },
  light: { c1: '#2b63c4', c2: '#2a3142', c3: '#a3173a', net: '#2b63c4', plex: '#2b63c4', hud: '#a3173a', hud2: '#2b63c4', glow: '#1d2840', sharp: 0.85, size: 2.7, netOp: 0.17, plexOp: 0.13, hudOp: 0.6, glowOp: 0.1 },
};

export function createScene({ canvas, calloutsEl, labels, theme, lang, reduced, getReserve, onPhase }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const small = Math.min(innerWidth, innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 8) <= 4;
  const N = small || weak ? 3600 : 6400;
  const NBRAIN = Math.round(N * 0.045), NSURF = N - NBRAIN;
  const NPLEX = small || weak ? 850 : 1500;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAM_Z);

  // ── data ──
  const human = genBody(NSURF, NBRAIN);
  const net = genNetwork();
  const aA = new Float32Array(N * 3), aB = new Float32Array(N * 3), aI = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const isNode = rnd() < 0.24;
    if (isNode) {
      const nd = net.nodes[(rnd() * net.nodes.length) | 0], d = randDir(), rr = Math.cbrt(rnd()) * 0.07;
      aA[i * 3] = aB[i * 3] = nd[0] + d[0] * rr;
      aA[i * 3 + 1] = aB[i * 3 + 1] = nd[1] + d[1] * rr;
      aA[i * 3 + 2] = aB[i * 3 + 2] = nd[2] + d[2] * rr;
    } else {
      const e = net.edges[(rnd() * net.edges.length) | 0], a = net.nodes[e[0]], b = net.nodes[e[1]];
      aA.set(a, i * 3); aB.set(b, i * 3);
    }
    aI[i * 4] = isNode ? 1 : 0;
    aI[i * 4 + 1] = i >= NSURF ? 1 : 0;
    aI[i * 4 + 2] = rnd();
    aI[i * 4 + 3] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(human, 3));
  geo.setAttribute('aH', new THREE.BufferAttribute(human, 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(aA, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(aB, 3));
  geo.setAttribute('aI', new THREE.BufferAttribute(aI, 4));
  const uniforms = {
    uTime: { value: 0 }, uMorph: { value: 0 }, uNetFade: { value: 0 }, uSize: { value: 2.5 }, uScan: { value: -3 },
    uLight: { value: 0 }, uBodyFx: { value: 0 }, uSharp: { value: 1.55 }, uAlpha: { value: 1 },
    uNetM: { value: new THREE.Matrix4() }, uHumM: { value: new THREE.Matrix4() },
    uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
  };
  const pMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false });
  const points = new THREE.Points(geo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  // network lines
  const netGroup = new THREE.Group();
  netGroup.rotation.order = 'YXZ';
  const nl = [];
  for (const [a, b] of net.edges) nl.push(...net.nodes[a], ...net.nodes[b]);
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(nl, 3));
  const netMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  netGroup.add(new THREE.LineSegments(netGeo, netMat));
  scene.add(netGroup);

  // human group: plexus + HUD (shares the particles' transform)
  const humGroup = new THREE.Group();
  scene.add(humGroup);
  const segIdx = plexus(human, NPLEX, small ? 0.17 : 0.135, 2);
  const pl = new Float32Array(segIdx.length * 3);
  segIdx.forEach((idx, j) => { pl[j * 3] = human[idx * 3]; pl[j * 3 + 1] = human[idx * 3 + 1]; pl[j * 3 + 2] = human[idx * 3 + 2]; });
  const plexGeo = new THREE.BufferGeometry();
  plexGeo.setAttribute('position', new THREE.BufferAttribute(pl, 3));
  const plexMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  humGroup.add(new THREE.LineSegments(plexGeo, plexMat));

  const hudMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const hudMat2 = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const mkLines = (arr, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return new THREE.LineSegments(g, mat); };
  // base: hologram projector rings + ticks
  const base = new THREE.Group();
  base.position.y = -1.75;
  base.add(mkLines(ringPositions(0.4, 96), hudMat));
  base.add(mkLines(ringPositions(0.6, 72, 1, 1, true), hudMat2));
  base.add(mkLines(ringPositions(0.86, 128), hudMat2));
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2, r0 = 0.9, r1 = i % 6 === 0 ? 1.0 : 0.94;
    ticks.push(Math.cos(t) * r0, 0, Math.sin(t) * r0, Math.cos(t) * r1, 0, Math.sin(t) * r1);
  }
  base.add(mkLines(ticks, hudMat2));
  humGroup.add(base);
  // scanning ring
  const scanRing = mkLines(ringPositions(1, 96), hudMat);
  humGroup.add(scanRing);
  // orbit ring + satellites
  const orbit = new THREE.Group();
  orbit.position.y = 0.62;
  orbit.rotation.set(0.32, 0, -0.12);
  orbit.add(mkLines(ringPositions(1.02, 128, 1, 1, true), hudMat2));
  humGroup.add(orbit);
  const dotMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uSize: { value: 7 }, uOpacity: { value: 0 } },
    vertexShader: 'uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, smoothstep(0.5, 0.1, d) * uOpacity); }',
    transparent: true, depthWrite: false, depthTest: false,
  });
  const satGeo = new THREE.BufferGeometry();
  satGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const sats = new THREE.Points(satGeo, dotMat);
  sats.frustumCulled = false;
  orbit.add(sats);
  // floor glow
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uColor, pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uOpacity); }',
    transparent: true, depthWrite: false, depthTest: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -1.76;
  humGroup.add(glow);

  // ── theme ──
  let light = false;
  function setTheme(th) {
    light = th === 'light';
    const P = light ? PALETTE.light : PALETTE.dark;
    uniforms.uC1.value.set(P.c1); uniforms.uC2.value.set(P.c2); uniforms.uC3.value.set(P.c3);
    uniforms.uLight.value = light ? 1 : 0;
    uniforms.uSharp.value = P.sharp;
    const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [pMat, netMat, plexMat, hudMat, hudMat2, dotMat, glowMat]) { m.blending = blend; m.needsUpdate = true; }
    netMat.color.set(P.net); plexMat.color.set(P.plex); hudMat.color.set(P.hud); hudMat2.color.set(P.hud2);
    dotMat.uniforms.uColor.value.set(P.hud); glowMat.uniforms.uColor.value.set(P.glow);
    pal = P;
  }
  let pal = PALETTE.dark;
  setTheme(theme);

  // ── callouts (DOM) ──
  const CALLS = [
    { k: 'brain', at: [0, 1.56, 0], side: 'outer', dy: -46, m: true },
    { k: 'heart', at: [0.1, 0.98, 0.17], side: 'inner', dy: -34, m: false },
    { k: 'rhand', at: [0.6, -0.1, 0.06], side: '+x', dy: 36, m: true },
    { k: 'lhand', at: [-0.6, -0.1, 0.06], side: '-x', dy: 36, m: true },
    { k: 'base', at: [0, -1.75, 0.86], side: 'inner', dy: 18, m: true },
  ];
  const NS = 'http://www.w3.org/2000/svg';
  calloutsEl.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'co-svg');
  calloutsEl.appendChild(svg);
  const calls = CALLS.map((c) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('pathLength', '1');
    path.setAttribute('class', 'co-line');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', '7'); ring.setAttribute('class', 'co-ring');
    const pt = document.createElementNS(NS, 'circle');
    pt.setAttribute('r', '2.6'); pt.setAttribute('class', 'co-pt');
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'co-g');
    g.append(path, ring, pt);
    svg.appendChild(g);
    const el = document.createElement('div');
    el.className = 'co';
    calloutsEl.appendChild(el);
    return { ...c, path, ring, pt, g, el, w: 0, h: 0, shown: false };
  });
  function setLabels(map) {
    for (const c of calls) {
      const L = map[c.k];
      c.el.innerHTML = L ? `<b>${L.t}</b><small>${L.s}</small>` : '';
    }
    measure();
  }
  function measure() {
    for (const c of calls) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
  }

  // ── layout ──
  let W = 1, H = 1, portrait = false, side = lang === 'ar' ? -1 : 1;
  const tgt = { x: 0, y: 0, s: 1, yaw: 0 }, cur = { x: 0, y: 0, s: 1, yaw: 0 };
  let netScale = 1, netRz = 0, first = true;
  function layout() {
    const vh = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const vw = vh * camera.aspect, ppw = H / vh;
    portrait = W / H < 1.15 || W < 760;
    if (!portrait) {
      const s = Math.min(0.94, (H - 170) / (3.5 * ppw));
      // pull the figure inward when the screen-edge labels would not fit (tablets in landscape)
      const room = W / 2 - 18 - outerLabelW() - 36 - 0.66 * s * ppw;
      const off = Math.max(W * 0.13, Math.min(W * 0.215, room));
      tgt.s = s; tgt.x = (side * off) / ppw; tgt.y = (-10 / ppw); tgt.yaw = -side * 0.2;
      netScale = Math.min(1, vw / 6.6); netRz = 0;
      calloutsEl.style.removeProperty('--co-max');
      calloutsEl.classList.remove('compact');
    } else {
      const reserve = getReserve ? getReserve() : H * 0.42;
      const top = 70, bottom = H - reserve - 22;
      const fig = Math.max(160, bottom - top);
      const s = Math.max(0.3, Math.min(0.62, fig / (3.5 * ppw), (vw * 0.52) / 1.3));
      const centerPx = top + Math.min(fig, 3.5 * s * ppw) / 2;
      tgt.s = s; tgt.x = 0; tgt.y = (H / 2 - centerPx) / ppw + 0.02 * s; tgt.yaw = 0;
      netScale = Math.min(0.56, (vw * 0.9) / 3.1); netRz = Math.PI / 2;
      // room beside the arms (widest point, unrotated) so labels never leave the screen
      const room = Math.floor(W / 2 - 0.66 * s * ppw - 12 - 6 - 10);
      calloutsEl.style.setProperty('--co-max', Math.max(64, room) + 'px');
      calloutsEl.classList.toggle('compact', room < 130);
    }
    if (first) Object.assign(cur, tgt);
  }
  // widest label that sits on the screen-edge side of the figure in landscape
  function outerLabelW() {
    let w = 0;
    for (const c of calls) {
      const outer = c.side === 'outer' || (c.side === '+x' && side > 0) || (c.side === '-x' && side < 0);
      if (outer) w = Math.max(w, c.w);
    }
    return w || 190;
  }
  function resize() {
    W = canvas.clientWidth || innerWidth;
    H = canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, small ? 2 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uniforms.uSize.value = pal.size * dpr;
    dotMat.uniforms.uSize.value = 7 * dpr;
    layout();
    measure();
    layout();
  }
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 80); };
  addEventListener('resize', onResize);

  // ── input ──
  let mx = 0, my = 0, smx = 0, smy = 0;
  addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });

  // ── timeline ──
  let T = reduced ? T_END : 0, speed = 1, time = 0, last = performance.now(), scrollK = 0, frameNo = 0, freezeT = null;
  const fired = {};
  const fire = (name) => { if (!fired[name]) { fired[name] = true; onPhase && onPhase(name); } };
  const v3 = new THREE.Vector3(), v4 = new THREE.Vector3();

  function updateCallouts() {
    const vis = scrollK < 0.35;
    calloutsEl.style.opacity = vis ? String(1 - scrollK / 0.35) : '0';
    if (!vis) return;
    humGroup.updateMatrixWorld();
    v3.set(0, 0, 0).applyMatrix4(humGroup.matrixWorld).project(camera);
    const fx = (v3.x * 0.5 + 0.5) * W;
    v4.set(0.66, 0, 0).applyMatrix4(humGroup.matrixWorld).project(camera);
    const halfW = Math.abs((v4.x * 0.5 + 0.5) * W - fx);
    const outerSide = portrait ? -1 : fx < W / 2 ? -1 : 1;
    const gap = portrait ? 12 : 30;
    const dyK = portrait ? 0.62 : 1;
    calls.forEach((c, i) => {
      const allowed = !portrait || c.m;
      const want = allowed && T >= T_READY - 0.25 + i * 0.16 && c.el.innerHTML;
      if (want !== c.shown) { c.shown = want; c.el.classList.toggle('show', !!want); c.g.classList.toggle('show', !!want); }
      if (!want) return;
      v3.set(c.at[0], c.at[1], c.at[2]).applyMatrix4(humGroup.matrixWorld).project(camera);
      const sx = (v3.x * 0.5 + 0.5) * W, sy = (-v3.y * 0.5 + 0.5) * H;
      let sd = c.side === 'outer' ? outerSide : c.side === 'inner' ? -outerSide : sx >= fx ? 1 : -1;
      const lx = fx + sd * (halfW + gap);
      let ly = sy + c.dy * dyK;
      ly = Math.max(70 + c.h / 2, Math.min(H - 12 - c.h / 2, ly));
      const ex = lx - sd * (portrait ? 8 : 16);
      c.path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ly.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}`);
      c.ring.setAttribute('cx', sx.toFixed(1)); c.ring.setAttribute('cy', sy.toFixed(1));
      c.pt.setAttribute('cx', sx.toFixed(1)); c.pt.setAttribute('cy', sy.toFixed(1));
      const tx = Math.max(10, Math.min(W - 10 - c.w, sd > 0 ? lx + 6 : lx - 6 - c.w));
      c.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${(ly - c.h / 2).toFixed(1)}px, 0)`;
    });
  }

  let raf = 0, running = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    frameNo++;
    if (scrollK >= 0.999 && frameNo % 2) return; // half rate when it's only a backdrop
    time += dt;
    first = false;
    if (freezeT === null) T += dt * speed; else T = freezeT;
    if (speed > 1 && T >= T_END) speed = 1;

    if (T >= T_MORPH) fire('morph');
    if (T >= T_FORMED) fire('formed');
    if (T >= T_READY) fire('ready');

    const netFade = easeOut(clamp01(T / 0.9));
    const morph = ease(clamp01((T - T_MORPH) / D_MORPH));
    const fx = easeOut(clamp01((T - T_FORMED) / 1.0));
    uniforms.uTime.value = time;
    uniforms.uMorph.value = morph;
    uniforms.uNetFade.value = netFade;
    uniforms.uBodyFx.value = fx;

    // pose & layout easing
    const k = 1 - Math.pow(0.0015, dt);
    cur.x += (tgt.x - cur.x) * k; cur.y += (tgt.y - cur.y) * k; cur.s += (tgt.s - cur.s) * k; cur.yaw += (tgt.yaw - cur.yaw) * k;
    smx += (mx - smx) * Math.min(1, dt * 3); smy += (my - smy) * Math.min(1, dt * 3);
    const amp = reduced ? 0.12 : 0.42;
    humGroup.position.set(cur.x, cur.y + scrollK * 0.9 * cur.s, 0);
    humGroup.scale.setScalar(cur.s);
    humGroup.rotation.y = cur.yaw + Math.sin(time * 0.32) * amp + smx * 0.28;
    humGroup.rotation.x = smy * 0.05;
    humGroup.updateMatrixWorld();
    uniforms.uHumM.value.copy(humGroup.matrixWorld);

    netGroup.scale.setScalar(netScale);
    netGroup.rotation.set(0.12 + smy * 0.05, portrait ? time * 0.35 : 0.45 + Math.sin(time * 0.4) * 0.32 + smx * 0.2, netRz);
    netGroup.updateMatrixWorld();
    uniforms.uNetM.value.copy(netGroup.matrixWorld);
    netMat.opacity = pal.netOp * netFade * (1 - clamp01(morph * 1.6));

    // scan line: follows the assembly front, then sweeps the body
    const front = -1.75 + 3.5 * clamp01((morph * 1.3 - 0.34) / 0.62);
    const sweep = Math.sin(time * 0.55) * 1.55 + 0.05;
    const scanY = morph < 1 ? front : front + (sweep - front) * fx;
    uniforms.uScan.value = morph > 0 && morph < 1 ? front : fx > 0 ? scanY : -9;
    scanRing.position.y = scanY;
    const wy = scanY > 1.28 ? 0.26 : scanY > 0.95 ? 0.56 : scanY > -0.25 ? 0.72 : 0.42;
    const sxs = scanRing.scale.x + (wy - scanRing.scale.x) * Math.min(1, dt * 6);
    scanRing.scale.set(sxs, 1, sxs * 0.62);

    plexMat.opacity = pal.plexOp * fx;
    const hudIn = Math.max(fx, morph > 0 && morph < 1 ? 0.75 : 0);
    hudMat.opacity = pal.hudOp * hudIn;
    hudMat2.opacity = pal.hudOp * 0.55 * fx;
    dotMat.uniforms.uOpacity.value = fx;
    glowMat.uniforms.uOpacity.value = pal.glowOp * Math.max(fx, morph * 0.6);
    base.rotation.y = time * 0.15;
    orbit.rotation.y = time * 0.2;
    // keep the orbit reading as an ellipse when the figure sits above the eye line (phones)
    orbit.rotation.x = 0.32 + Math.atan2(humGroup.position.y + 0.62 * cur.s, CAM_Z);
    const sp = sats.geometry.attributes.position;
    for (let i = 0; i < 3; i++) { const a = time * (0.6 + i * 0.17) + i * 2.1; sp.setXYZ(i, Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02); }
    sp.needsUpdate = true;

    camera.position.x = smx * 0.22;
    camera.position.y = -smy * 0.12;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    updateCallouts();
  }

  setLabels(labels);
  resize();
  raf = requestAnimationFrame(frame);
  if (reduced) { fire('morph'); fire('formed'); fire('ready'); }

  return {
    skip() { if (T < T_END) speed = 6; },
    setTheme(th) { setTheme(th); uniforms.uSize.value = pal.size * Math.min(devicePixelRatio || 1, small ? 2 : 1.75); },
    setLang(l, map) { side = l === 'ar' ? -1 : 1; layout(); setLabels(map); layout(); },
    setScroll(k) { scrollK = k; },
    relayout() { layout(); measure(); layout(); },
    get done() { return T >= T_READY; },
    freeze(t) { freezeT = t; },
  };
}
