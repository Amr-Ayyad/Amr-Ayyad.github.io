// ─────────────────────────────────────────────────────────────
//  Intro scene: a digital neural network whose signals fly together
//  into a holographic human: a sculpted body traced by light contours,
//  a nervous system that lights up from the brain, a beating heart,
//  a data platform, and DOM callouts.
//  The body mesh is baked offline (tools/body) into assets/body.bin.
// ─────────────────────────────────────────────────────────────
import * as THREE from '../assets/three.module.min.js';

THREE.ColorManagement.enabled = false;

const FOV = 35;
const CAM_Z = 6.8;
const T_MORPH = 2.3;     // network → human starts
const D_MORPH = 2.8;     // morph duration
const T_FORMED = 4.9;    // HUD / platform fade in
const T_READY = 5.45;    // hero text reveal
const T_END = 6.2;
const T_NERVE = 4.35;    // nervous system starts growing from the brain
const D_NERVE = 2.2;
const BODY_URL = new URL('../assets/body.bin', import.meta.url);

const rnd = Math.random;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ── body.bin ──
function parseBody(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x59444f42) throw new Error('bad body.bin');
  const jl = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jl)));
  const pad4 = (n) => (n + 3) & ~3;
  let o = 12 + pad4(jl);
  const { nv, ni, nSeg } = meta;
  const q = new Int16Array(buf, o, nv * 3); o += pad4(nv * 6);
  const nq = new Int8Array(buf, o, nv * 3); o += pad4(nv * 3);
  const aoq = new Uint8Array(buf, o, nv); o += pad4(nv);
  const index = meta.i16 ? new Uint16Array(buf, o, ni) : new Uint32Array(buf, o, ni); o += pad4(ni * (meta.i16 ? 2 : 4));
  const nq3 = new Int16Array(buf, o, nSeg * 6); o += pad4(nSeg * 12);
  const ndq = new Uint16Array(buf, o, nSeg * 2);
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), ao = new Float32Array(nv);
  for (let i = 0; i < nv * 3; i++) { pos[i] = q[i] * meta.posScale; nrm[i] = nq[i] / 127; }
  for (let i = 0; i < nv; i++) ao[i] = aoq[i] / 255;
  const npos = new Float32Array(nSeg * 6), nd = new Float32Array(nSeg * 2);
  for (let i = 0; i < nSeg * 6; i++) npos[i] = nq3[i] * meta.posScale;
  for (let i = 0; i < nSeg * 2; i++) nd[i] = (ndq[i] / 65535) * meta.maxD;
  return { meta, pos, nrm, ao, index, npos, nd };
}
// area-weighted points on the mesh surface (with interpolated normals)
function sampleSurface(B, n) {
  const { pos, nrm, index } = B, nt = index.length / 3, cdf = new Float32Array(nt);
  let acc = 0;
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    acc += Math.sqrt(cx * cx + cy * cy + cz * cz);
    cdf[t] = acc;
  }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rnd() * acc;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; }
    const a = index[lo * 3] * 3, b = index[lo * 3 + 1] * 3, c = index[lo * 3 + 2] * 3;
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    for (let k = 0; k < 3; k++) {
      P[i * 3 + k] = pos[a + k] * w + pos[b + k] * u + pos[c + k] * v;
      N[i * 3 + k] = nrm[a + k] * w + nrm[b + k] * u + nrm[c + k] * v;
    }
  }
  return { P, N };
}
function randDir() {
  let x, y, z, l;
  do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l);
  return [x / l, y / l, z / l];
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
// k-nearest links inside a small point set (the brain)
function knnLinks(P, n, k) {
  const segs = [], seen = new Set();
  for (let i = 0; i < n; i++) {
    const d = [];
    for (let j = 0; j < n; j++) if (j !== i) d.push([(P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2, j]);
    d.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < k; m++) {
      const j = d[m][1], key = Math.min(i, j) * 4096 + Math.max(i, j);
      if (seen.has(key)) continue;
      seen.add(key); segs.push(i, j);
    }
  }
  return segs;
}
function ringPositions(r, seg, dashed = false) {
  const a = [];
  for (let i = 0; i < seg; i++) {
    if (dashed && i % 2) continue;
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    a.push(Math.cos(t0) * r, 0, Math.sin(t0) * r, Math.cos(t1) * r, 0, Math.sin(t1) * r);
  }
  return a;
}

// ── Shaders ──
// Dark theme draws light: colour is added, and alpha rises with the brightest channel so the
// canvas always holds valid premultiplied colour. Pixels whose alpha stays 0 are dropped by
// some graphics cards and compositors, which made the whole figure vanish on those screens.
const GLOW = /* glsl */ `
vec4 glow(vec3 c){ c = clamp(c, 0.0, 1.0); return vec4(c, max(c.r, max(c.g, c.b))); }
`;
// particles: network signals → points on the body surface
const P_VERT = /* glsl */ `
uniform float uTime, uMorph, uNetFade, uSize, uScan, uLight, uBodyFx;
uniform mat4 uNetM, uHumM;
uniform vec3 uC1, uC2, uC3, uCam;
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aH;
attribute vec3 aN;
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
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // facing ratio on the body (brain points have no normal)
  vec3 wn = mat3(uHumM) * aN;
  float wl = length(wn);
  float facing = wl > 0.01 ? dot(wn / wl, normalize(uCam - hw)) : 1.0;
  float fr = pow(1.0 - abs(facing), 2.0);
  float back = facing < 0.0 ? 0.18 : 1.0;
  float tw = 0.5 + 0.5 * sin(uTime * (1.3 + r2 * 2.6) + r1 * 60.0);
  float sc = exp(-pow((aH.y - uScan) * 10.0, 2.0)) * e;
  float s = mix(mix(0.95, 2.4, aI.x), mix(0.55 + fr * 0.5, 1.25, aI.y), e);
  s *= (0.8 + 0.4 * tw) * (1.0 + sc * 0.9);
  gl_PointSize = uSize * s * (7.0 / -mv.z);
  vec3 cn = mix(mix(uC1, uC3, ft * 0.85), mix(uC2, uC3, 0.35), aI.x * 0.8);
  vec3 ch = mix(mix(uC1, uC2, fr), uC3, aI.y * 0.7);
  vCol = mix(cn, ch, e) + sc * mix(vec3(0.9), uC3, uLight) * 0.6;
  float an = uNetFade * mix(0.5, 1.0, aI.x);
  float ah = (0.06 + 0.42 * fr + 0.3 * tw * tw * tw + sc * mix(0.55, 0.3, uLight)) * back;
  ah = mix(ah, 0.4 + 0.4 * tw, aI.y);
  // while flying in, particles are bright; once the hologram is built they settle into a fine dust
  ah = mix(0.85, ah, uBodyFx);
  // on a light page the dust is ink, so keep it quieter once the body is built
  ah *= 1.0 - 0.42 * uLight * uBodyFx * (1.0 - aI.y);
  vA = mix(an, ah, e);
}`;
const P_FRAG = /* glsl */ `${GLOW}
uniform float uSharp, uAlpha, uLight;
varying vec3 vCol;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = clamp(pow(1.0 - d * 2.0, uSharp) * vA * uAlpha, 0.0, 1.0);
  // dark: light is added onto the page (premultiplied, alpha 0); light: ink over it
  gl_FragColor = uLight < 0.5 ? glow(vCol * a) : vec4(vCol, a);
}`;

// hologram body (shared vertex stage keeps the depth pre-pass bit-identical)
const B_VERT = /* glsl */ `
uniform float uInflate;
attribute float aAO;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
void main(){
  vec4 mv = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vP = position;
  vAO = aAO;
  gl_Position = projectionMatrix * mv;
}`;
const B_DEPTH = /* glsl */ `
uniform float uReveal;
varying vec3 vP;
void main(){
  if (vP.y > uReveal) discard;
  gl_FragColor = vec4(0.0);
}`;
const B_FRAG = /* glsl */ `${GLOW}
uniform float uTime, uReveal, uFx, uScan, uLight, uAlpha, uDensity;
uniform vec3 uFill, uLine, uRim, uEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
float contour(float c){
  float fw = fwidth(c);
  float d = abs(fract(c - 0.5) - 0.5);
  return (1.0 - smoothstep(fw * 0.05, fw * 0.95, d)) * clamp((0.5 - fw) * 3.0, 0.0, 1.0);
}
void main(){
  float y = vP.y;
  if (y > uReveal) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float ao = mix(0.42, 1.0, vAO);
  float c = y * uDensity;
  float ln = contour(c);
  float mj = contour(c / 6.0);
  float sb = exp(-pow((y - uScan) * 6.5, 2.0)) * uFx;
  float edge = exp(-pow((uReveal - y) * 42.0, 2.0)) * step(uReveal, 1.82);
  float key = 0.75 + 0.25 * clamp(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0, 1.0);
  if (uLight < 0.5) {
    vec3 col = uFill * (0.06 + 0.3 * fres) * ao * key
      + uLine * ln * (0.1 + 0.28 * fres + 0.08 * key) * ao
      + uLine * mj * 0.12 * ao
      + uRim * fres * 0.9
      + uLine * sb * (0.06 + 0.6 * ln) + uEdge * sb * ln * 0.25
      + (uLine * 0.8 + uEdge * 0.5) * edge;
    gl_FragColor = glow(col * uAlpha);
  } else {
    float a = (0.05 + 0.16 * fres) * ao * key + ln * (0.14 + 0.22 * fres) * ao + mj * 0.1 + fres * 0.2 + sb * (0.04 + 0.3 * ln) + edge * 0.7;
    gl_FragColor = vec4(mix(uLine, uRim, fres), clamp(a, 0.0, 0.92) * uAlpha);
  }
}`;
const H_FRAG = /* glsl */ `${GLOW}
uniform float uReveal, uLight, uAlpha;
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  if (vP.y > uReveal) discard;
  float g = pow(abs(dot(normalize(vN), normalize(vV))), 2.6);
  if (uLight < 0.5) gl_FragColor = glow(uRim * g * 0.42 * uAlpha);
  else gl_FragColor = vec4(uRim, g * 0.16 * uAlpha);
}`;
// nervous system: grows from the brain, impulses travel outward
const N_VERT = /* glsl */ `
attribute float aD;
varying float vD;
void main(){
  vD = aD;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const N_FRAG = /* glsl */ `${GLOW}
uniform float uTime, uGrow, uAlpha, uLight;
uniform vec3 uCol, uPulse;
varying float vD;
void main(){
  if (vD > uGrow) discard;
  float tip = exp(-pow((uGrow - vD) * 5.0, 2.0)) * step(uGrow, 4.9);
  float ph = fract(vD * 0.75 - uTime * 0.42);
  float pulse = smoothstep(0.8, 0.97, ph) * (1.0 - smoothstep(0.97, 1.0, ph));
  float k = clamp(pulse * 1.1 + tip, 0.0, 1.0);
  if (uLight < 0.5) gl_FragColor = glow(mix(uCol, uPulse, k) * (0.42 + pulse * 1.25 + tip * 1.4) * uAlpha);
  else gl_FragColor = vec4(mix(uCol, uPulse, k), clamp(0.32 + pulse * 0.6 + tip, 0.0, 1.0) * uAlpha);
}`;
const SPRITE_VERT = /* glsl */ `
uniform float uSize;
attribute float aS;
varying float vS;
void main(){
  vS = aS;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aS * (7.0 / -mv.z);
}`;
// heart: core glow + expanding ring on every beat
const HEART_FRAG = /* glsl */ `${GLOW}
uniform vec3 uColor, uCore;
uniform float uBeat, uPhase, uAlpha, uLight;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * (26.0 - uBeat * 12.0)) * (0.55 + 0.9 * uBeat);
  float halo = exp(-d * d * 5.0) * (0.18 + 0.35 * uBeat);
  float rr = 0.12 + uPhase * 0.85;
  float ring = exp(-pow((d - rr) * 22.0, 2.0)) * (1.0 - uPhase) * 0.9;
  vec3 c = uColor * (halo + ring) + uCore * core;
  float a = clamp(core + halo + ring, 0.0, 1.0);
  if (uLight < 0.5) gl_FragColor = glow(c * uAlpha);
  else gl_FragColor = vec4(uColor, clamp(core * 0.9 + ring * 0.7 + halo * 0.25, 0.0, 1.0) * uAlpha);
}`;
const DOT_FRAG = /* glsl */ `${GLOW}
uniform vec3 uColor;
uniform float uOpacity, uLight;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.08, d) * uOpacity;
  gl_FragColor = uLight < 0.5 ? glow(uColor * a) : vec4(uColor, a);
}`;
// drifting light motes around the figure
const DUST_VERT = /* glsl */ `
uniform float uTime, uSize;
attribute vec4 aR;
varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y + 1.85 + uTime * (0.035 + aR.x * 0.06), 3.9) - 1.85;
  p.x += sin(uTime * 0.3 + aR.y * 6.28) * 0.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aR.z) * (7.0 / -mv.z);
  float edge = smoothstep(-1.85, -1.5, p.y) * (1.0 - smoothstep(1.5, 2.0, p.y));
  vA = edge * (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + aR.w * 2.0) + aR.y * 40.0)));
}`;
const DUST_FRAG = /* glsl */ `${GLOW}
uniform vec3 uColor;
uniform float uOpacity, uLight;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 1.6) * vA * uOpacity;
  gl_FragColor = uLight < 0.5 ? glow(uColor * a) : vec4(uColor, a);
}`;
// projector light column rising from the platform
const BEAM_VERT = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main(){
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `${GLOW}
uniform vec3 uColor;
uniform float uOpacity, uLight;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = pow(1.0 - vH, 2.2) * (0.25 + 0.75 * f * f) * uOpacity;
  if (uLight < 0.5) gl_FragColor = glow(uColor * a);
  else gl_FragColor = vec4(uColor, a * 0.6);
}`;
const GLOW_FRAG = /* glsl */ `${GLOW}
uniform vec3 uColor;
uniform float uOpacity, uLight;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.4) * uOpacity;
  gl_FragColor = uLight < 0.5 ? glow(uColor * a) : vec4(uColor, a);
}`;

const PALETTE = {
  dark: {
    c1: '#7dd3fc', c2: '#d9fbff', c3: '#22d3ee', net: '#38bdf8',
    fill: '#0ea5e9', line: '#5ee3f7', rim: '#a5f3fc', edge: '#e6fdff', halo: '#38d6f0',
    nerve: '#1fb8e0', pulse: '#e9feff', heart: '#5ee3f7', heartCore: '#ffffff',
    hud: '#5ee3f7', hud2: '#7dd3fc', glow: '#0ea5e9', dust: '#a5f3fc',
    sharp: 1.55, size: 2.5, netOp: 0.13, hudOp: 0.5, glowOp: 0.26, beamOp: 0.16, dustOp: 0.55,
  },
  light: {
    c1: '#0369a1', c2: '#0e7490', c3: '#0891b2', net: '#0284c7',
    fill: '#0891b2', line: '#0e7490', rim: '#0369a1', edge: '#0284c7', halo: '#06b6d4',
    nerve: '#0284c7', pulse: '#06b6d4', heart: '#0891b2', heartCore: '#0e7490',
    hud: '#0e7490', hud2: '#0369a1', glow: '#38bdf8', dust: '#0891b2',
    sharp: 0.85, size: 2.7, netOp: 0.17, hudOp: 0.55, glowOp: 0.16, beamOp: 0.1, dustOp: 0.45,
  },
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
  const N = small || weak ? 3400 : 5600;
  const NBRAIN = Math.round(N * 0.04), NSURF = N - NBRAIN;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAM_Z);

  // ── particles (network now, body surface later) ──
  const net = genNetwork();
  const aA = new Float32Array(N * 3), aB = new Float32Array(N * 3), aI = new Float32Array(N * 4);
  const aH = new Float32Array(N * 3), aN = new Float32Array(N * 3);
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
  geo.setAttribute('position', new THREE.BufferAttribute(aH, 3));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 3));
  geo.setAttribute('aN', new THREE.BufferAttribute(aN, 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(aA, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(aB, 3));
  geo.setAttribute('aI', new THREE.BufferAttribute(aI, 4));
  const uniforms = {
    uTime: { value: 0 }, uMorph: { value: 0 }, uNetFade: { value: 0 }, uSize: { value: 2.5 }, uScan: { value: -3 },
    uLight: { value: 0 }, uBodyFx: { value: 0 }, uSharp: { value: 1.55 }, uAlpha: { value: 1 },
    uNetM: { value: new THREE.Matrix4() }, uHumM: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
    uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
  };
  const pMat = new THREE.ShaderMaterial({ uniforms, vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false, depthTest: false });
  const points = new THREE.Points(geo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  scene.add(points);

  // network lines
  const netGroup = new THREE.Group();
  const nl = [];
  for (const [a, b] of net.edges) nl.push(...net.nodes[a], ...net.nodes[b]);
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(nl, 3));
  const netMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const netLines = new THREE.LineSegments(netGeo, netMat);
  netLines.renderOrder = 5;
  netGroup.add(netLines);
  scene.add(netGroup);

  // ── the figure ──
  const humGroup = new THREE.Group();
  scene.add(humGroup);
  const bodyU = {
    uTime: { value: 0 }, uReveal: { value: -9 }, uFx: { value: 0 }, uScan: { value: -9 }, uLight: { value: 0 },
    uAlpha: { value: 1 }, uDensity: { value: 28 }, uInflate: { value: 0 },
    uFill: { value: new THREE.Color() }, uLine: { value: new THREE.Color() }, uRim: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
  };
  const depthMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: B_VERT, fragmentShader: B_DEPTH, colorWrite: false });
  const holoMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: B_VERT, fragmentShader: B_FRAG, transparent: true, depthWrite: false });
  const haloU = { uInflate: { value: 0.034 }, uReveal: bodyU.uReveal, uLight: bodyU.uLight, uAlpha: { value: 0 }, uRim: { value: new THREE.Color() } };
  const haloMat = new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: B_VERT, fragmentShader: H_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide });
  for (const m of [depthMat, holoMat, haloMat]) m.extensions = { derivatives: true };
  const nerveU = { uTime: { value: 0 }, uGrow: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 0 }, uCol: { value: new THREE.Color() }, uPulse: { value: new THREE.Color() } };
  const nerveMat = new THREE.ShaderMaterial({ uniforms: nerveU, vertexShader: N_VERT, fragmentShader: N_FRAG, transparent: true, depthWrite: false, depthTest: false });
  const brainLinkMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const heartU = { uSize: { value: 60 }, uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uBeat: { value: 0 }, uPhase: { value: 1 }, uAlpha: { value: 0 }, uLight: { value: 0 } };
  const heartMat = new THREE.ShaderMaterial({ uniforms: heartU, vertexShader: SPRITE_VERT, fragmentShader: HEART_FRAG, transparent: true, depthWrite: false, depthTest: false });
  let maxD = 4, body = null, bodyFailed = false, heartPos = [0.075, 0.86, 0.12];

  function buildBody(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(B.nrm, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(B.ao, 1));
    g.setIndex(new THREE.BufferAttribute(B.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.9);
    const pre = new THREE.Mesh(g, depthMat); pre.renderOrder = 0;
    const halo = new THREE.Mesh(g, haloMat); halo.renderOrder = 1;
    const holo = new THREE.Mesh(g, holoMat); holo.renderOrder = 2;
    humGroup.add(pre, halo, holo);
    // nerves
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(B.npos, 3));
    ng.setAttribute('aD', new THREE.BufferAttribute(B.nd, 1));
    const nerves = new THREE.LineSegments(ng, nerveMat);
    nerves.renderOrder = 3;
    nerves.frustumCulled = false;
    humGroup.add(nerves);
    maxD = B.meta.maxD;
    // particles settle on the surface; a few form the brain's own little network
    const S = sampleSurface(B, NSURF);
    aH.set(S.P); aN.set(S.N);
    const br = B.meta.anchors.brain, bp = new Float32Array(NBRAIN * 3);
    for (let j = 0; j < NBRAIN; j++) {
      let x, y, z;
      do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
      bp[j * 3] = br[0] + x * 0.105; bp[j * 3 + 1] = br[1] + y * 0.068; bp[j * 3 + 2] = br[2] + z * 0.12;
    }
    aH.set(bp, NSURF * 3);
    geo.attributes.aH.needsUpdate = true;
    geo.attributes.aN.needsUpdate = true;
    geo.attributes.position.needsUpdate = true;
    const links = knnLinks(bp, NBRAIN, 2), lp = new Float32Array(links.length * 3);
    links.forEach((idx, j) => { lp[j * 3] = bp[idx * 3]; lp[j * 3 + 1] = bp[idx * 3 + 1]; lp[j * 3 + 2] = bp[idx * 3 + 2]; });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const bl = new THREE.LineSegments(lg, brainLinkMat);
    bl.renderOrder = 4;
    humGroup.add(bl);
    // heart
    heartPos = B.meta.anchors.heart;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(heartPos, 3));
    hg.setAttribute('aS', new THREE.Float32BufferAttribute([1], 1));
    const heart = new THREE.Points(hg, heartMat);
    heart.frustumCulled = false;
    heart.renderOrder = 7;
    humGroup.add(heart);
    body = B;
  }
  fetch(BODY_URL)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => buildBody(parseBody(buf)))
    .catch(() => { bodyFailed = true; });

  // ── HUD: platform, scan ring, orbit, light column, dust ──
  const hudMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hudMat2 = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const barMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const mkLines = (arr, mat, order = 8) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const l = new THREE.LineSegments(g, mat);
    l.renderOrder = order;
    return l;
  };
  const platform = new THREE.Group();
  platform.position.y = -1.75;
  humGroup.add(platform);
  const base = new THREE.Group();
  base.add(mkLines(ringPositions(0.42, 96), hudMat));
  base.add(mkLines(ringPositions(0.62, 72, true), hudMat2));
  base.add(mkLines(ringPositions(0.88, 128), hudMat2));
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2, r0 = 0.92, r1 = i % 6 === 0 ? 1.0 : 0.95;
    ticks.push(Math.cos(t) * r0, 0, Math.sin(t) * r0, Math.cos(t) * r1, 0, Math.sin(t) * r1);
  }
  base.add(mkLines(ticks, hudMat2));
  // radial bar chart around the platform (live "data")
  const NBAR = 90, barPos = new Float32Array(NBAR * 6), barSeed = Array.from({ length: NBAR }, () => [rnd(), rnd() * 6.28]);
  const bars = mkLines(barPos, barMat);
  base.add(bars);
  platform.add(base);
  const scanRing = mkLines(ringPositions(1, 96), hudMat);
  humGroup.add(scanRing);
  const orbit = new THREE.Group();
  orbit.position.y = 0.62;
  orbit.rotation.set(0.32, 0, -0.12);
  orbit.add(mkLines(ringPositions(1.02, 128, true), hudMat2));
  humGroup.add(orbit);
  const dotMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uSize: { value: 7 }, uOpacity: { value: 0 }, uLight: bodyU.uLight },
    vertexShader: 'uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize; }',
    fragmentShader: DOT_FRAG, transparent: true, depthWrite: false,
  });
  const satGeo = new THREE.BufferGeometry();
  satGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const sats = new THREE.Points(satGeo, dotMat);
  sats.frustumCulled = false;
  sats.renderOrder = 8;
  orbit.add(sats);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uLight: bodyU.uLight },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;
  glow.renderOrder = 1;
  platform.add(glow);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uLight: bodyU.uLight },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.6, 1.5, 64, 1, true), beamMat);
  beam.position.y = 0.75;
  beam.renderOrder = 1;
  platform.add(beam);
  const ND = small ? 140 : 240, dpos = new Float32Array(ND * 3), dr = new Float32Array(ND * 4);
  for (let i = 0; i < ND; i++) {
    const a = rnd() * Math.PI * 2, r = 0.55 + Math.sqrt(rnd()) * 1.5;
    dpos[i * 3] = Math.cos(a) * r; dpos[i * 3 + 1] = rnd() * 3.9 - 1.85; dpos[i * 3 + 2] = Math.sin(a) * r * 0.7;
    dr[i * 4] = rnd(); dr[i * 4 + 1] = rnd(); dr[i * 4 + 2] = rnd(); dr[i * 4 + 3] = rnd();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('aR', new THREE.BufferAttribute(dr, 4));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uSize: { value: 2 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uLight: bodyU.uLight },
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, depthTest: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 9;
  humGroup.add(dust);

  // ── theme ──
  let light = false, pal = PALETTE.dark;
  function setTheme(th) {
    light = th === 'light';
    const P = (pal = light ? PALETTE.light : PALETTE.dark);
    uniforms.uC1.value.set(P.c1); uniforms.uC2.value.set(P.c2); uniforms.uC3.value.set(P.c3);
    uniforms.uLight.value = light ? 1 : 0;
    uniforms.uSharp.value = P.sharp;
    bodyU.uLight.value = light ? 1 : 0;
    bodyU.uFill.value.set(P.fill); bodyU.uLine.value.set(P.line); bodyU.uRim.value.set(P.rim); bodyU.uEdge.value.set(P.edge);
    haloU.uRim.value.set(P.halo);
    nerveU.uLight.value = light ? 1 : 0;
    nerveU.uCol.value.set(P.nerve); nerveU.uPulse.value.set(P.pulse);
    heartU.uLight.value = light ? 1 : 0;
    heartU.uColor.value.set(P.heart); heartU.uCore.value.set(P.heartCore);
    // light: ink over the page. dark: light is added and alpha grows with it (see GLOW)
    const lightUp = (m, scaleByAlpha) => {
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation; m.blendEquationAlpha = THREE.AddEquation;
      m.blendSrc = scaleByAlpha ? THREE.SrcAlphaFactor : THREE.OneFactor; m.blendDst = THREE.OneFactor;
      m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    };
    for (const m of [netMat, brainLinkMat, hudMat, hudMat2, barMat]) { if (light) m.blending = THREE.NormalBlending; else lightUp(m, true); m.needsUpdate = true; }
    for (const m of [pMat, holoMat, haloMat, nerveMat, heartMat, dotMat, glowMat, beamMat, dustMat]) { if (light) m.blending = THREE.NormalBlending; else lightUp(m, false); m.premultipliedAlpha = false; m.needsUpdate = true; }
    netMat.color.set(P.net); hudMat.color.set(P.hud); hudMat2.color.set(P.hud2); barMat.color.set(P.hud); brainLinkMat.color.set(P.line);
    dotMat.uniforms.uColor.value.set(P.hud); glowMat.uniforms.uColor.value.set(P.glow);
    beamMat.uniforms.uColor.value.set(P.glow); dustMat.uniforms.uColor.value.set(P.dust);
  }
  setTheme(theme);

  // ── callouts (DOM) ──
  // phones: labels clear the hands (x 0.545, fingers to about 0.6) by GAP_P pixels
  const ARM_P = 0.62, GAP_P = 10;
  const CALLS = [
    { k: 'brain', at: [0.0, 1.62, 0.0], side: 'outer', dy: -46, m: true },
    { k: 'heart', at: [0.085, 0.88, 0.25], side: 'inner', dy: -34, m: false },
    { k: 'rhand', at: [0.545, -0.2, 0.07], side: '+x', dy: 36, m: true },
    { k: 'lhand', at: [-0.545, -0.2, 0.05], side: '-x', dy: 36, m: true },
    { k: 'base', at: [0, -1.75, 0.88], side: 'inner', dy: 18, m: true },
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
    // each label is a link to its section; hovering it lights up its leader line
    const el = document.createElement('a');
    el.className = 'co';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('pointerenter', () => g.classList.add('hot'));
    el.addEventListener('pointerleave', () => g.classList.remove('hot'));
    el.addEventListener('focus', () => g.classList.add('hot'));
    el.addEventListener('blur', () => g.classList.remove('hot'));
    calloutsEl.appendChild(el);
    return { ...c, path, ring, pt, g, el, w: 0, h: 0, shown: false };
  });
  function setLabels(map) {
    for (const c of calls) {
      const L = map[c.k];
      c.el.innerHTML = L ? `<b>${L.t}<i class="co-go" aria-hidden="true"></i></b><small>${L.s}</small>` : '';
      if (L && L.to) c.el.setAttribute('href', '#' + L.to); else c.el.removeAttribute('href');
    }
    measure();
  }
  // a label that wraps is shrunk to its longest line, so the chevron sits right after the text
  const rng = document.createRange();
  function measure() {
    for (const c of calls) {
      const el = c.el;
      el.style.width = '';
      if (portrait && el.firstChild) {
        const lines = [];
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n; (n = tw.nextNode());) {
          rng.selectNodeContents(n);
          for (const q of rng.getClientRects()) {
            if (q.width < 0.5) continue;
            const mid = (q.top + q.bottom) / 2;
            const L = lines.find((l) => mid >= l.t && mid <= l.b);
            if (L) { L.l = Math.min(L.l, q.left); L.r = Math.max(L.r, q.right); } else lines.push({ t: q.top, b: q.bottom, l: q.left, r: q.right });
          }
        }
        if (lines.length > 1) {
          const cs = getComputedStyle(el);
          const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
          const need = Math.ceil(Math.max(...lines.map((l) => l.r - l.l)) + pad + 1);
          if (need < el.offsetWidth) el.style.width = need + 'px';
        }
      }
      c.w = el.offsetWidth; c.h = el.offsetHeight;
    }
  }

  // ── layout ──
  let W = 1, H = 1, portrait = false, side = lang === 'ar' ? -1 : 1, dpr = 1;
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
      for (const c of calls) c.el.style.maxWidth = '';
    } else {
      const reserve = getReserve ? getReserve() : H * 0.42;
      const top = 70, bottom = H - reserve - 22;
      const fig = Math.max(160, bottom - top);
      // tablets in portrait get a larger figure; any spare height is shared above and
      // below it, nudged up so the platform keeps clear of the text
      const s = Math.max(0.3, Math.min(W >= 700 ? 0.74 : 0.62, fig / (3.5 * ppw), (vw * 0.52) / 1.3));
      const slack = Math.max(0, fig - 3.5 * s * ppw);
      const centerPx = top + fig / 2 - Math.min(slack / 2, 0.15 * s * ppw);
      tgt.s = s; tgt.x = 0; tgt.y = (H / 2 - centerPx) / ppw + 0.02 * s; tgt.yaw = 0;
      netScale = Math.min(0.56, (vw * 0.9) / 3.1); netRz = Math.PI / 2;
      // room beside the hands (widest point, unrotated) so labels never leave the screen;
      // the brain label sits beside the head, which leaves it much more room
      const room = Math.floor(W / 2 - ARM_P * s * ppw - GAP_P - 6 - 10);
      const headRoom = Math.floor(W / 2 - 0.2 * s * ppw - GAP_P - 6 - 10);
      calloutsEl.style.setProperty('--co-max', Math.max(64, room) + 'px');
      calloutsEl.classList.toggle('compact', room < 130);
      for (const c of calls) c.el.style.maxWidth = c.side === 'outer' ? Math.max(64, headRoom) + 'px' : '';
    }
    // contour spacing follows the on-screen size (about 8–9 device pixels apart)
    const pxPerUnit = ppw * tgt.s * dpr;
    bodyU.uDensity.value = Math.max(12, Math.min(34, pxPerUnit / 8.5));
    // the heart keeps the same size relative to the body on every screen
    heartU.uSize.value = pxPerUnit * 0.375;
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
    dpr = Math.min(devicePixelRatio || 1, small ? 2 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uniforms.uSize.value = pal.size * dpr;
    dotMat.uniforms.uSize.value = 7 * dpr;
    dustMat.uniforms.uSize.value = 2.2 * dpr;
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
    // fading labels stop taking clicks and focus before they disappear
    calloutsEl.classList.toggle('off', scrollK > 0.22);
    if (!vis) return;
    humGroup.updateMatrixWorld();
    v3.set(0, 0, 0).applyMatrix4(humGroup.matrixWorld).project(camera);
    const fx = (v3.x * 0.5 + 0.5) * W;
    v4.set(portrait ? ARM_P : 0.66, 0, 0).applyMatrix4(humGroup.matrixWorld).project(camera);
    const halfW = Math.abs((v4.x * 0.5 + 0.5) * W - fx);
    const outerSide = portrait ? -1 : fx < W / 2 ? -1 : 1;
    const gap = portrait ? GAP_P : 30;
    const dyK = portrait ? 0.62 : 1;
    calls.forEach((c, i) => {
      const allowed = (!portrait || c.m) && !!body;
      const want = allowed && T >= T_READY - 0.25 + i * 0.16 && c.el.innerHTML;
      if (want !== c.shown) {
        c.shown = want; c.el.classList.toggle('show', !!want); c.g.classList.toggle('show', !!want);
        c.el.tabIndex = want ? 0 : -1; c.el.setAttribute('aria-hidden', want ? 'false' : 'true');
      }
      if (!want) return;
      v3.set(c.at[0], c.at[1], c.at[2]).applyMatrix4(humGroup.matrixWorld).project(camera);
      const sx = (v3.x * 0.5 + 0.5) * W, sy = (-v3.y * 0.5 + 0.5) * H;
      const sd = c.side === 'outer' ? outerSide : c.side === 'inner' ? -outerSide : sx >= fx ? 1 : -1;
      const lx = fx + sd * (halfW + gap);
      let ly = sy + c.dy * dyK;
      ly = Math.max(70 + c.h / 2, Math.min(H - 12 - c.h / 2, ly));
      const tx = Math.max(10, Math.min(W - 10 - c.w, sd > 0 ? lx + 6 : lx - 6 - c.w));
      // the line always ends at the label, even when the screen edge pushes the label inward
      const bx = sd > 0 ? Math.max(lx, tx - 6) : Math.min(lx, tx + c.w + 6);
      const ex = bx - sd * (portrait ? 8 : 16);
      c.path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ly.toFixed(1)} L${bx.toFixed(1)} ${ly.toFixed(1)}`);
      c.ring.setAttribute('cx', sx.toFixed(1)); c.ring.setAttribute('cy', sy.toFixed(1));
      c.pt.setAttribute('cx', sx.toFixed(1)); c.pt.setAttribute('cy', sy.toFixed(1));
      c.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${(ly - c.h / 2).toFixed(1)}px, 0)`;
    });
  }

  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // animation steps stay small, but the story clock follows real time even on slow
    // (software-rendered) machines, so the intro never drags past a few seconds
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(rawDt, 0.05);
    last = now;
    frameNo++;
    if (scrollK >= 0.999 && frameNo % 2) return; // half rate when it's only a backdrop
    time += dt;
    first = false;
    if (freezeT === null) T += Math.min(rawDt, 0.25) * speed; else T = freezeT;
    // hold before the morph until the body has arrived (slow networks)
    if (!body && !bodyFailed && T > T_MORPH - 0.05 && freezeT === null) T = T_MORPH - 0.05;
    if (bodyFailed && !fired.ready) { fire('morph'); fire('formed'); fire('ready'); }
    if (speed > 1 && T >= T_END) speed = 1;

    if (T >= T_MORPH) fire('morph');
    if (T >= T_FORMED) fire('formed');
    if (T >= T_READY) fire('ready');

    const netFade = easeOut(clamp01(T / 0.9));
    const morph = body ? ease(clamp01((T - T_MORPH) / D_MORPH)) : 0;
    const fx = body ? easeOut(clamp01((T - T_FORMED) / 1.0)) : 0;
    uniforms.uTime.value = time;
    uniforms.uMorph.value = morph;
    uniforms.uNetFade.value = netFade;
    uniforms.uBodyFx.value = fx;
    bodyU.uTime.value = time;
    nerveU.uTime.value = time;

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

    // the hologram prints itself from the floor up, just behind the arriving particles
    const reveal = -1.8 + 3.62 * clamp01((morph - 0.4) / 0.52);
    bodyU.uReveal.value = morph > 0 ? reveal : -9;
    haloU.uAlpha.value = clamp01((morph - 0.45) * 2) * (0.55 + 0.45 * fx);
    // scan band: rides the print front, then sweeps the body slowly
    const sweep = Math.sin(time * 0.5) * 1.6 + 0.02;
    const scanY = morph < 1 ? reveal : reveal + (sweep - reveal) * fx;
    bodyU.uScan.value = scanY;
    bodyU.uFx.value = Math.max(fx, morph > 0 && morph < 1 ? 0.6 : 0);
    uniforms.uScan.value = morph > 0 ? scanY : -9;
    scanRing.position.y = scanY;
    const wy = scanY > 1.28 ? 0.26 : scanY > 0.95 ? 0.58 : scanY > -0.25 ? 0.7 : scanY > -1.0 ? 0.44 : 0.36;
    const sxs = scanRing.scale.x + (wy - scanRing.scale.x) * Math.min(1, dt * 6);
    scanRing.scale.set(sxs, 1, sxs * 0.62);

    // nervous system & heart
    const grow = clamp01((T - T_NERVE) / D_NERVE);
    nerveU.uGrow.value = body ? (grow <= 0 ? -1 : easeOut(grow) * (maxD + 0.2)) : -1;
    nerveU.uAlpha.value = body ? clamp01(grow * 3) : 0;
    brainLinkMat.opacity = (light ? 0.35 : 0.32) * clamp01((morph - 0.75) * 4) * (0.7 + 0.3 * Math.sin(time * 2.3));
    const beatT = (time * 1.1) % 1, b1 = Math.exp(-Math.pow(beatT / 0.07, 2)), b2 = Math.exp(-Math.pow((beatT - 0.26) / 0.06, 2)) * 0.6;
    heartU.uBeat.value = Math.max(b1, b2);
    heartU.uPhase.value = clamp01(beatT / 0.75);
    heartU.uAlpha.value = clamp01((T - T_FORMED + 0.4) / 0.8);

    const hudIn = Math.max(fx, morph > 0 && morph < 1 ? 0.75 : 0);
    hudMat.opacity = pal.hudOp * hudIn;
    hudMat2.opacity = pal.hudOp * 0.55 * fx;
    barMat.opacity = pal.hudOp * 0.7 * fx;
    dotMat.uniforms.uOpacity.value = fx;
    glowMat.uniforms.uOpacity.value = pal.glowOp * Math.max(fx, morph * 0.6);
    beamMat.uniforms.uOpacity.value = pal.beamOp * Math.max(fx, morph * 0.5);
    dustMat.uniforms.uOpacity.value = pal.dustOp * fx;
    base.rotation.y = time * 0.15;
    // when the floor sits near the eye line (phones) tip the platform a little so it still reads as a disc
    const floorY = humGroup.position.y - 1.75 * cur.s;
    platform.rotation.x = Math.max(0, 0.2 - Math.atan2(-floorY, CAM_Z));
    orbit.rotation.y = time * 0.2;
    // keep the orbit reading as an ellipse when the figure sits above the eye line (phones)
    orbit.rotation.x = 0.32 + Math.atan2(humGroup.position.y + 0.62 * cur.s, CAM_Z);
    const sp = sats.geometry.attributes.position;
    for (let i = 0; i < 3; i++) { const a = time * (0.6 + i * 0.17) + i * 2.1; sp.setXYZ(i, Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02); }
    sp.needsUpdate = true;
    if (fx > 0) {
      for (let i = 0; i < NBAR; i++) {
        const a = (i / NBAR) * Math.PI * 2, [s0, ph] = barSeed[i];
        const h = 0.025 + (0.05 + 0.09 * s0) * (0.55 + 0.45 * Math.sin(time * (0.6 + s0) + ph)) * (i % 9 === 0 ? 1.6 : 1);
        const r0 = 1.06, r1 = r0 + h * fx, c = Math.cos(a), s = Math.sin(a);
        barPos.set([c * r0, 0, s * r0, c * r1, 0, s * r1], i * 6);
      }
      bars.geometry.attributes.position.needsUpdate = true;
    }

    camera.position.x = smx * 0.22;
    camera.position.y = -smy * 0.12;
    camera.lookAt(0, 0, 0);
    uniforms.uCam.value.copy(camera.position);

    renderer.render(scene, camera);
    updateCallouts();
  }

  setLabels(labels);
  resize();
  raf = requestAnimationFrame(frame);
  if (reduced) { fire('morph'); fire('formed'); fire('ready'); }

  return {
    skip() { if (T < T_END) speed = 6; },
    setTheme(th) { setTheme(th); uniforms.uSize.value = pal.size * dpr; },
    setLang(l, map) { side = l === 'ar' ? -1 : 1; layout(); setLabels(map); layout(); },
    setScroll(k) { scrollK = k; },
    relayout() { layout(); measure(); layout(); },
    get done() { return T >= T_READY; },
    freeze(t) { freezeT = t; },
  };
}
