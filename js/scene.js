// ─────────────────────────────────────────────────────────────
//  Hero: data through the brain ("I turn data into decisions").
//  The neural network's signals become a cloud of raw data that is drawn into a
//  holographic brain at the back, travels through it along five pathways and
//  leaves the front as five clean beams of light, each ending at a decision.
//  On phones the story runs top to bottom: the data falls into the crown and the
//  beams leave through the brainstem. The mesh (assets/brain.bin) is baked by
//  tools/brain/brain-build.mjs; the labels come from CV.callouts in data.js.
// ─────────────────────────────────────────────────────────────
import * as THREE from '../assets/three.module.min.js';

THREE.ColorManagement.enabled = false;

const FOV = 35;
const CAM_Z = 6.8;
const T_MORPH = 2.3;    // network → data cloud and brain
const D_MORPH = 2.4;
const T_FLOW = 3.3;     // the stream finds its five pathways
const T_NERVE = 3.5;    // fibre tracts light up along the flow
const D_NERVE = 2.1;
const T_RAYS = 4.0;     // beams leave the brain
const T_FORMED = 4.7;
const T_READY = 5.45;
const T_END = 6.4;
const BRAIN_URL = new URL('../assets/brain.bin', import.meta.url);
const NRAY = 5;
const LABELED = [0, 2, 4];
const BS = 0.66;        // brain scale inside the flow frame

// where the data enters and leaves, in brain-mesh units (x = back→front, y = up, z = towards the viewer)
const GEO = {
  // screens wider than tall: in at the back of the head (occipital pole), out at the forehead (frontal pole)
  land: { E: [-1.33, 0.28, 0.3], M: [1.17, 0.32, 0.28], X: [1.17, 0.32, 0.28], bend: [0, 1, 0], amp: 0.45, zb: 0.14, ax: [1, 0, 0], ax0: -1.38, axL: 2.66, crown: [-0.32, 1.07, 0.3] },
  // phones: in at the crown, through the middle of the brain to the pons, out down the brainstem
  port: { E: [-0.3, 1.09, 0.3], M: [-0.25, -0.28, 0.06], X: [-0.37, -1.03, 0], bend: [1, 0, 0], amp: 0.55, zb: 0.16, ax: [0, -1, 0], ax0: -1.13, axL: 2.2, crown: [0.92, 0.58, 0.42] },
};
const PITCH = 0.16, YAW = -0.3;

const rnd = Math.random;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bez3 = (a, b, c, d, t) => {
  const s = 1 - t, w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
  return [0, 1, 2].map((i) => a[i] * w0 + b[i] * w1 + c[i] * w2 + d[i] * w3);
};

// ── brain.bin ──
function parseBody(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x59444f42) throw new Error('bad brain.bin');
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
  const lobe = new Float32Array(nv);
  if (meta.lobeOff) { const lq = new Uint8Array(buf, meta.lobeOff, nv); for (let i = 0; i < nv; i++) lobe[i] = lq[i]; }
  return { meta, pos, nrm, ao, index, npos, nd, lobe };
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
// k-nearest links inside a small point set (neurons)
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

// ── Shaders ──
// Dark theme draws light: colour is added, and alpha rises with the brightest channel so the
// canvas always holds valid premultiplied colour (some compositors drop pixels whose alpha is 0).
const GLOW = /* glsl */ `
vec4 glow(vec3 c){ c = clamp(c, 0.0, 1.0); return vec4(c, max(c.r, max(c.g, c.b))); }
`;
// particles: network signals → raw data → five pathways through the brain → beams; some settle on the brain
const P_VERT = /* glsl */ `
uniform float uTime, uMorph, uNetFade, uSize, uLight, uFlow, uRays, uSettle, uCloud, uSplit, uJit;
uniform float uHotRaw, uHotBrain, uFocus, uHotB;
uniform vec4 uHotA;
uniform mat4 uNetM, uFlowM, uBrainM;
uniform vec3 uE, uM, uX, uCam, uAx;
uniform float uAx0, uAxL;
uniform vec3 uN[${NRAY}];
uniform vec3 uQ1[${NRAY}];
uniform vec3 uQ2[${NRAY}];
uniform vec3 uRC[${NRAY}];
uniform vec3 uC1, uC2, uC3, uRaw;
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aS;
attribute vec3 aH;
attribute vec3 aN;
attribute vec4 aI;
varying vec3 vCol;
varying float vA;
float hash(float n){ return fract(sin(n) * 43758.5453); }
vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float s = 1.0 - t; return s * s * s * a + 3.0 * s * s * t * b + 3.0 * s * t * t * c + t * t * t * d; }
void main(){
  float r1 = aI.z, r2 = aI.w;
  float ft = fract(r1 + uTime * (0.16 + r2 * 0.32));
  vec3 np = mix(aA, aB, aI.x > 0.5 ? 0.0 : ft);
  vec3 nw = (uNetM * vec4(np, 1.0)).xyz;
  vec3 cn = mix(mix(uC1, uC3, ft * 0.85), mix(uC2, uC3, 0.35), aI.x * 0.8);
  float an = uNetFade * mix(0.5, 1.0, aI.x);
  float tw = 0.5 + 0.5 * sin(uTime * (1.7 + r2 * 3.1) + r1 * 60.0);
  int k = int(aI.y + 0.5);
  vec3 tp, tc;
  float ta, ts, delay, span;
  if (k < ${NRAY}) {
    // ── the data stream ──
    vec3 nk = uN[0], q1 = uQ1[0], q2 = uQ2[0], rc = uRC[0];
    float hot = uHotA.x;
    for (int i = 1; i < ${NRAY}; i++) if (i == k) {
      nk = uN[i]; q1 = uQ1[i]; q2 = uQ2[i]; rc = uRC[i];
      hot = i == 1 ? uHotA.y : i == 2 ? uHotA.z : i == 3 ? uHotA.w : uHotB;
    }
    float u = fract(r1 * 7.31 + uTime * (0.062 + r2 * 0.03));
    const float A = 0.54, B = 0.79;
    vec3 fp;
    float edgeFade = 1.0;
    if (u < A) {
      // raw data: a wide, uneven cloud that is drawn in towards the entry point
      float q = u / A, qa = pow(max(q, 0.0), 1.6);
      float dist = 0.1 + aS.x * uCloud;
      float spread = 0.15 + aS.x * uCloud * 0.46;
      vec3 S = uE + vec3(-dist, aS.y * spread, aS.z * spread * 0.6);
      float amp = pow(max(1.0 - q, 0.0), 1.4) * (0.12 + r2 * 0.2);
      vec3 wob = vec3(sin(uTime * (0.7 + r1) + r2 * 40.0), cos(uTime * (0.6 + r2) + r1 * 33.0), sin(uTime * 0.5 + r1 * 21.0 + r2 * 9.0));
      fp = mix(S, uE, qa) + wob * amp;
      edgeFade = smoothstep(0.0, 0.08, q);
      tc = mix(uRaw, uC1, hash(r2 * 13.0) * 0.55);
      ta = (0.22 + 0.5 * tw * tw) * (1.0 - 0.35 * uLight) * (1.0 + 0.9 * uHotRaw);
      ts = (0.55 + 1.25 * hash(r1 * 17.0 + r2)) * (0.75 + 0.5 * tw) * (1.0 + 0.3 * uHotRaw);
    } else if (u < B) {
      // inside the brain: one of five pathways, taking on its beam's colour on the way
      float q = (u - A) / (B - A);
      fp = q < uSplit ? bez(uE, q1, q2, uM, q / uSplit) : mix(uM, uX, (q - uSplit) / (1.0 - uSplit));
      vec3 jit = vec3(sin(r1 * 91.0 + uTime * 1.3), cos(r2 * 77.0 + uTime * 1.1), sin((r1 + r2) * 53.0 + uTime * 0.9));
      fp += jit * uJit * sin(q * 3.14159) * (0.5 + r2);
      tc = mix(mix(uRaw, uC2, 0.55), rc, smoothstep(0.05, 0.8, q));
      ta = (0.72 + 0.3 * tw) * uFlow;
      ts = 1.1 + 0.25 * tw;
      ta *= mix(1.0, 0.3 + 1.5 * hot, uFocus);
    } else {
      // a clean beam out to its decision
      float q = (u - B) / (1.0 - B);
      fp = mix(uX, nk, q);
      edgeFade = 1.0 - smoothstep(0.86, 1.0, q);
      tc = rc;
      ta = 0.85 * uRays * (0.6 + 0.4 * tw);
      ts = 1.0;
      ta *= mix(1.0, 0.3 + 1.6 * hot, uFocus);
    }
    tp = (uFlowM * vec4(fp, 1.0)).xyz;
    ta = mix(0.85, ta, uSettle) * edgeFade;
    delay = r1 * 0.3;
    span = 0.7;
  } else {
    // ── on the brain: fine dust over the cortex, and a few neurons along the tracts ──
    float neuron = k > ${NRAY} ? 1.0 : 0.0;
    tp = (uBrainM * vec4(aH, 1.0)).xyz;
    vec3 wn = mat3(uBrainM) * aN;
    float wl = length(wn);
    float facing = wl > 0.01 ? dot(wn / wl, normalize(uCam - tp)) : 1.0;
    float fr = pow(1.0 - abs(facing), 2.0);
    float back = facing < 0.0 ? 0.18 : 1.0;
    tc = mix(mix(uC1, uC2, fr), uC3, neuron * 0.7);
    ta = mix((0.06 + 0.42 * fr + 0.3 * tw * tw * tw) * back, 0.4 + 0.4 * tw, neuron);
    ta = mix(0.85, ta, uSettle) * (1.0 + 0.9 * uHotBrain);
    ta *= 1.0 - 0.42 * uLight * uSettle * (1.0 - neuron);
    ts = mix(0.55 + fr * 0.5, 1.25, neuron) * (0.8 + 0.4 * tw);
    // the brain assembles in the direction the data will travel
    delay = clamp((dot(aH, uAx) - uAx0) / uAxL, 0.0, 1.0) * 0.62 + r1 * 0.28;
    span = 0.4;
  }
  float p = clamp((uMorph * 1.3 - delay) / span, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  vec3 sw = vec3(sin(r1 * 91.0 + r2 * 13.0), cos(r2 * 77.0 + r1 * 7.0), sin((r1 - r2) * 53.0));
  vec3 pos = mix(nw, tp, e) + sw * sin(e * 3.14159) * (0.3 + r2 * 0.4);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = mix(mix(0.95, 2.4, aI.x), ts, e);
  gl_PointSize = uSize * s * (7.0 / -mv.z);
  vCol = mix(cn, tc, e);
  vA = mix(an, ta, e);
}`;
const P_FRAG = /* glsl */ `${GLOW}
uniform float uSharp, uLight;
varying vec3 vCol;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = clamp(pow(max(1.0 - d * 2.0, 0.0), uSharp) * vA, 0.0, 1.0);
  gl_FragColor = uLight < 0.5 ? glow(vCol * a) : vec4(vCol, a);
}`;

// hologram brain (shared vertex stage keeps the depth pre-pass bit-identical)
const BR_VERT = /* glsl */ `
uniform float uInflate, uAx0;
uniform vec3 uAx, uTA, uTB;
attribute float aAO;
attribute float aLobe;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
varying float vD;
varying vec3 vTint;
void main(){
  vec4 mv = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vP = position;
  vAO = aAO;
  vD = dot(position, uAx) - uAx0;
  // lobes: 0 frontal, 1 parietal, 2 occipital, 3 temporal, 4 cerebellum, 5 brainstem
  float L = aLobe;
  vTint = mix(uTA, uTB, L < 0.5 ? 0.0 : L < 1.5 ? 0.62 : L < 2.5 ? 0.32 : L < 3.5 ? 1.0 : L < 4.5 ? 0.82 : 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const BR_DEPTH = /* glsl */ `
uniform float uReveal;
varying float vD;
void main(){
  if (vD > uReveal) discard;
  gl_FragColor = vec4(0.0);
}`;
const BR_FRAG = /* glsl */ `${GLOW}
uniform float uTime, uReveal, uFx, uScan, uLight, uAlpha, uDensity, uHot, uAxL, uZap, uZapT;
uniform vec3 uFill, uLine, uRim, uEdge, uZapP;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
varying float vD;
varying vec3 vTint;
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + 1.0), f.x), f.y), f.z);
}
// electricity: bolts of light that branch out from where the pointer touches the cortex, each
// stroke lasting a split second before a new pattern fires. Bolts differ: some reach far across
// the brain, some stay short; some are thick, some hair-thin; each tapers as it runs out.
vec2 zapArcs(vec3 p){
  vec3 r = p - uZapP;
  float zd = length(r);
  if (zd > 1.9) return vec2(0.0);
  vec3 dir = r / max(zd, 1e-4);
  float st = floor(uTime * 16.0);
  vec3 o = vec3(st * 1.73, st * 2.31, st * 0.97);
  float flick = 0.75 + 0.25 * hash3(vec3(st, 3.0, 9.0));
  // noise mostly over the direction: its isolines run outwards like bolts and wiggle on the way
  vec3 q = dir * 2.6 + r * 2.2 + o;
  float n = vnoise(q) * 0.7 + vnoise(q * 2.9 + 5.3) * 0.3;
  float fw = fwidth(n);
  float ok = clamp((0.35 - fw) * 4.0, 0.0, 1.0);
  float d = abs(n - 0.5);
  // per bolt (over the direction, re-rolled every stroke): its length, thickness and strength
  float lv = vnoise(dir * 2.2 + o * 0.7 + 2.0);
  float len = 0.28 + 1.45 * lv * lv;
  float wk = 0.45 + 1.5 * vnoise(dir * 3.7 + o * 0.5 + 8.0);
  float bk = 0.55 + 0.45 * vnoise(dir * 4.9 + o * 0.9 + 4.0);
  float taper = clamp(1.0 - zd / len, 0.0, 1.0);
  float core = (1.0 - smoothstep(0.0, (fw * 1.1 + 0.0025) * wk * (0.5 + 0.5 * taper), d)) * ok;
  float halo = exp(-d / ((fw * 3.0 + 0.018) * wk)) * ok;
  float reach = smoothstep(0.0, 0.35, taper);
  // finer, shorter side branches off the main bolts
  vec3 q2 = dir * 5.5 + r * 4.0 + o * 1.37 + 11.0;
  float n2 = vnoise(q2);
  float fw2 = fwidth(n2);
  float d2 = abs(n2 - 0.5);
  float core2 = (1.0 - smoothstep(0.0, fw2 * 0.9 + 0.0018, d2)) * clamp((0.35 - fw2) * 4.0, 0.0, 1.0);
  float reach2 = smoothstep(0.0, 0.4, clamp(1.0 - zd / (len * 0.6), 0.0, 1.0));
  float spot = exp(-zd * zd * 160.0);
  float wave = exp(-pow((zd - uZapT * 1.8) * 8.0, 2.0)) * exp(-uZapT * 1.3);
  float c = (core * reach * bk + core2 * reach2 * 0.45 * bk) * flick + spot * 0.35;
  float g = halo * reach * bk * 0.36 * flick + exp(-zd * zd * 14.0) * 0.14 + wave * 0.22;
  return uZap * vec2(c, g);
}
float contour(float c){
  float fw = fwidth(c);
  float d = abs(fract(c - 0.5) - 0.5);
  return (1.0 - smoothstep(fw * 0.05, fw * 0.95, d)) * clamp((0.5 - fw) * 3.0, 0.0, 1.0);
}
void main(){
  if (vD > uReveal) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float ao = mix(0.42, 1.0, vAO);
  float c = vP.y * uDensity;
  float ln = contour(c);
  float mj = contour(c / 6.0);
  // a soft band of light that runs through the brain the way the data flows
  float sb = exp(-pow((vD - uScan) * 9.0, 2.0)) * uFx;
  float edge = exp(-pow((uReveal - vD) * 42.0, 2.0)) * step(uReveal, uAxL + 0.04);
  vec3 line = mix(uLine, vTint, 0.42);
  vec3 fill = mix(uFill, vTint, 0.3);
  float hot = uHot;
  vec2 zz = uZap > 0.001 ? zapArcs(vP) : vec2(0.0);
  float zap = zz.x + zz.y;
  float key = 0.75 + 0.25 * clamp(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0, 1.0);
  if (uLight < 0.5) {
    vec3 col = fill * (0.06 + 0.3 * fres) * ao * key
      + line * ln * (0.07 + 0.2 * fres + 0.06 * key) * ao
      + line * mj * 0.12 * ao
      + uRim * fres * 0.9
      + uLine * sb * (0.05 + 0.5 * ln) + uEdge * sb * ln * 0.2
      + (uLine * 0.8 + uEdge * 0.5) * edge
      + (line * 0.6 + uEdge * 0.22) * hot * (0.14 + 0.85 * ln + 0.75 * fres) * ao
      + vec3(0.72, 0.95, 1.0) * zz.x * 0.85 + (uLine * 0.85 + uEdge * 0.2) * zz.y;
    gl_FragColor = glow(col * uAlpha);
  } else {
    // on a light page the glass needs firmer lines and a deeper body to hold its shape
    float a = (0.17 + 0.3 * fres) * ao * key + ln * (0.6 + 0.3 * fres) * ao + mj * 0.36 + fres * 0.46 + sb * (0.08 + 0.4 * ln) + edge * 0.7
      + hot * (0.08 + 0.32 * ln + 0.22 * fres) * ao + zz.x * 1.2 + zz.y * 0.55;
    vec3 lc = mix(mix(mix(line, uRim, fres), vTint, 0.25 + hot * 0.4), uEdge, clamp(zap * 1.4, 0.0, 1.0));
    gl_FragColor = vec4(lc, clamp(a, 0.0, 0.95) * uAlpha);
  }
}`;
const HALO_FRAG = /* glsl */ `${GLOW}
uniform float uReveal, uLight, uAlpha;
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vV;
varying float vD;
void main(){
  if (vD > uReveal) discard;
  float g = pow(abs(dot(normalize(vN), normalize(vV))), 2.6);
  if (uLight < 0.5) gl_FragColor = glow(uRim * g * 0.42 * uAlpha);
  else gl_FragColor = vec4(uRim, g * 0.3 * uAlpha);
}`;
// fibre tracts: they light up along the flow and impulses travel the same way as the data
const N_VERT = /* glsl */ `
uniform vec3 uAx;
uniform float uAx0;
attribute float aD;
varying float vD;
varying float vF;
varying vec3 vQ;
void main(){
  vD = dot(position, uAx) - uAx0;
  vF = aD;
  vQ = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const N_FRAG = /* glsl */ `${GLOW}
uniform float uTime, uGrow, uAlpha, uLight, uTipEnd, uZap;
uniform vec3 uCol, uPulse, uZapP;
varying float vD;
varying float vF;
varying vec3 vQ;
void main(){
  if (vD > uGrow) discard;
  float tip = exp(-pow((uGrow - vD) * 5.0, 2.0)) * step(uGrow, uTipEnd);
  // impulses run along each fibre, drifting overall the way the data flows
  float ph = fract(vD * 0.32 + vF * 0.45 - uTime * 0.45);
  float pulse = smoothstep(0.8, 0.97, ph) * (1.0 - smoothstep(0.97, 1.0, ph));
  // shocked: every fibre fires fast impulses and flickers
  float zs = floor(uTime * 15.0);
  float zf = fract(sin(dot(vec2(zs, floor(vF * 9.0)), vec2(12.9898, 78.233))) * 43758.5453);
  // shocked: quick impulses race along every fibre, and the fibres near the touch fire hardest
  float zn = exp(-dot(vQ - uZapP, vQ - uZapP) * 1.6);
  float zph = fract(vD * 2.3 + vF * 3.1 - uTime * 4.8);
  float zp = smoothstep(0.86, 0.98, zph) * (1.0 - smoothstep(0.98, 1.0, zph)) * uZap * (0.55 + 0.45 * zf) * (0.75 + 0.9 * zn);
  pulse = max(pulse, zp) + uZap * zn * zf * 0.35;
  float k = clamp(pulse * 1.1 + tip, 0.0, 1.0);
  if (uLight < 0.5) gl_FragColor = glow(mix(uCol, uPulse, k) * (0.36 + pulse * 1.2 + tip * 1.4 + uZap * 0.12) * uAlpha);
  else gl_FragColor = vec4(mix(uCol, uPulse, k), clamp(0.45 + pulse * 0.55 + tip + uZap * 0.1, 0.0, 1.0) * uAlpha);
}`;
// beams and pathways: thin lines and soft light ribbons that grow along their length
const HOT = /* glsl */ `
uniform vec4 uHotA;
uniform float uHotB, uFocus;
float hotOf(float k){ return k < 0.5 ? uHotA.x : k < 1.5 ? uHotA.y : k < 2.5 ? uHotA.z : k < 3.5 ? uHotA.w : uHotB; }
`;
const L_VERT = /* glsl */ `${HOT}
attribute float aT;
attribute float aK;
attribute vec3 aC;
varying float vT;
varying vec3 vC;
varying float vF;
void main(){
  vT = aT; vC = aC;
  vF = mix(1.0, 0.3 + 1.6 * hotOf(aK), uFocus);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const L_FRAG = /* glsl */ `${GLOW}
uniform float uGrow, uA, uLight, uA0, uA1;
varying float vT;
varying vec3 vC;
varying float vF;
void main(){
  if (vT > uGrow) discard;
  float a = uA * mix(uA0, uA1, vT) * (1.0 - smoothstep(uGrow - 0.06, uGrow, vT)) * vF;
  gl_FragColor = uLight < 0.5 ? glow(vC * a) : vec4(vC, min(a, 1.0));
}`;
const RB_VERT = /* glsl */ `${HOT}
attribute float aT;
attribute float aW;
attribute float aK;
attribute vec3 aC;
varying float vT;
varying float vW;
varying vec3 vC;
varying float vF;
void main(){
  vT = aT; vW = aW; vC = aC;
  vF = mix(1.0, 0.3 + 1.6 * hotOf(aK), uFocus);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RB_FRAG = /* glsl */ `${GLOW}
uniform float uGrow, uA, uLight, uA0, uA1;
varying float vT;
varying float vW;
varying vec3 vC;
varying float vF;
void main(){
  if (vT > uGrow) discard;
  float a = uA * exp(-vW * vW * 5.0) * mix(uA0, uA1, vT) * (1.0 - smoothstep(uGrow - 0.08, uGrow, vT)) * vF;
  gl_FragColor = uLight < 0.5 ? glow(vC * a) : vec4(vC, min(a * 0.9, 1.0));
}`;
const S_VERT = /* glsl */ `
uniform float uSize;
attribute float aS;
attribute vec3 aC;
varying vec3 vC;
void main(){ vC = aC; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * aS; }`;
const S_FRAG = /* glsl */ `${GLOW}
uniform float uA, uLight;
varying vec3 vC;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 7.0) * 0.8 + (1.0 - smoothstep(0.0, 0.16, d)) * 0.6) * uA;
  gl_FragColor = uLight < 0.5 ? glow(vC * a) : vec4(vC, a * 0.8);
}`;

const PALETTE = {
  dark: {
    c1: '#7dd3fc', c2: '#d9fbff', c3: '#22d3ee', net: '#38bdf8', raw: '#9fb7c4', core: '#e6fdff',
    rays: ['#a5f3fc', '#67e8f9', '#22d3ee', '#38bdf8', '#0ea5e9'],
    fill: '#0ea5e9', line: '#5ee3f7', rim: '#a5f3fc', edge: '#e6fdff', halo: '#38d6f0',
    nerve: '#1fb8e0', pulse: '#e9feff', tA: '#2dd4bf', tB: '#38bdf8',
    sharp: 1.55, size: 2.5, netOp: 0.13,
  },
  light: {
    c1: '#0369a1', c2: '#0e7490', c3: '#0891b2', net: '#0284c7', raw: '#64748b', core: '#0e7490',
    rays: ['#0e7490', '#0891b2', '#0284c7', '#0369a1', '#075985'],
    fill: '#0891b2', line: '#08597a', rim: '#064a73', edge: '#0284c7', halo: '#0891b2',
    nerve: '#035a8f', pulse: '#0891b2', tA: '#0a6863', tB: '#04468a',
    sharp: 0.85, size: 2.7, netOp: 0.17,
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
  const N = small || weak ? 4000 : 6400;
  const NCORT = Math.round(N * 0.16), NNEU = Math.round(N * 0.03), NFLOW = N - NCORT - NNEU;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAM_Z);

  // ── particles ──
  const net = genNetwork();
  const aA = new Float32Array(N * 3), aB = new Float32Array(N * 3), aI = new Float32Array(N * 4), aS = new Float32Array(N * 3);
  const aH = new Float32Array(N * 3), aN = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const isNode = rnd() < 0.24;
    if (isNode) {
      const nd = net.nodes[(rnd() * net.nodes.length) | 0], d = randDir(), rr = Math.cbrt(rnd()) * 0.07;
      aA[i * 3] = aB[i * 3] = nd[0] + d[0] * rr;
      aA[i * 3 + 1] = aB[i * 3 + 1] = nd[1] + d[1] * rr;
      aA[i * 3 + 2] = aB[i * 3 + 2] = nd[2] + d[2] * rr;
    } else {
      const e = net.edges[(rnd() * net.edges.length) | 0];
      aA.set(net.nodes[e[0]], i * 3); aB.set(net.nodes[e[1]], i * 3);
    }
    aI[i * 4] = isNode ? 1 : 0;
    // roles: 0–4 the stream along beam k (the labelled beams carry more), 5 cortex dust, 6 neurons
    let role;
    if (i < NFLOW) { const r = rnd(); role = r < 0.26 ? 0 : r < 0.35 ? 1 : r < 0.61 ? 2 : r < 0.7 ? 3 : 4; } else role = i < NFLOW + NCORT ? 5 : 6;
    aI[i * 4 + 1] = role;
    aI[i * 4 + 2] = rnd();
    aI[i * 4 + 3] = rnd();
    aS[i * 3] = Math.pow(rnd(), 0.85); aS[i * 3 + 1] = rnd() * 2 - 1; aS[i * 3 + 2] = rnd() * 2 - 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(aA, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(aB, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 3));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 3));
  geo.setAttribute('aN', new THREE.BufferAttribute(aN, 3));
  geo.setAttribute('aI', new THREE.BufferAttribute(aI, 4));
  const vec = () => new THREE.Vector3();
  const uniforms = {
    uTime: { value: 0 }, uMorph: { value: 0 }, uNetFade: { value: 0 }, uSize: { value: 2.5 }, uLight: { value: 0 },
    uFlow: { value: 0 }, uRays: { value: 0 }, uSettle: { value: 0 }, uSharp: { value: 1.55 }, uCloud: { value: 1 },
    uSplit: { value: 1 }, uJit: { value: 0.03 },
    uHotRaw: { value: 0 }, uHotBrain: { value: 0 }, uFocus: { value: 0 }, uHotA: { value: new THREE.Vector4() }, uHotB: { value: 0 },
    uNetM: { value: new THREE.Matrix4() }, uFlowM: { value: new THREE.Matrix4() }, uBrainM: { value: new THREE.Matrix4() },
    uE: { value: vec() }, uM: { value: vec() }, uX: { value: vec() }, uCam: { value: vec() },
    uAx: { value: vec() }, uAx0: { value: 0 }, uAxL: { value: 1 },
    uN: { value: Array.from({ length: NRAY }, vec) },
    uQ1: { value: Array.from({ length: NRAY }, vec) },
    uQ2: { value: Array.from({ length: NRAY }, vec) },
    uRC: { value: Array.from({ length: NRAY }, () => new THREE.Color()) },
    uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uRaw: { value: new THREE.Color() },
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

  // ── the flow frame (data runs along +x) and the brain inside it ──
  const flow = new THREE.Group();
  scene.add(flow);
  const brainG = new THREE.Group();
  flow.add(brainG);
  const hotU = { uHotA: uniforms.uHotA, uHotB: uniforms.uHotB, uFocus: uniforms.uFocus };
  const bodyU = {
    uTime: { value: 0 }, uReveal: { value: -9 }, uFx: { value: 0 }, uScan: { value: -9 }, uLight: { value: 0 },
    uAlpha: { value: 1 }, uDensity: { value: 28 }, uInflate: { value: 0 }, uHot: { value: 0 },
    uZap: { value: 0 }, uZapT: { value: 9 }, uZapP: { value: new THREE.Vector3(0, 9, 0) },
    uAx: uniforms.uAx, uAx0: uniforms.uAx0, uAxL: uniforms.uAxL,
    uFill: { value: new THREE.Color() }, uLine: { value: new THREE.Color() }, uRim: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
    uTA: { value: new THREE.Color() }, uTB: { value: new THREE.Color() },
  };
  const depthMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: BR_VERT, fragmentShader: BR_DEPTH, colorWrite: false });
  const holoMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: BR_VERT, fragmentShader: BR_FRAG, transparent: true, depthWrite: false });
  const haloU = { uInflate: { value: 0.034 }, uReveal: bodyU.uReveal, uLight: bodyU.uLight, uAlpha: { value: 0 }, uRim: { value: new THREE.Color() }, uAx: uniforms.uAx, uAx0: uniforms.uAx0, uTA: bodyU.uTA, uTB: bodyU.uTB };
  const haloMat = new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: BR_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide });
  for (const m of [depthMat, holoMat, haloMat]) m.extensions = { derivatives: true };
  const nerveU = { uTime: { value: 0 }, uGrow: { value: -1 }, uAlpha: { value: 0 }, uLight: { value: 0 }, uZap: bodyU.uZap, uZapP: bodyU.uZapP, uTipEnd: { value: 2.6 }, uCol: { value: new THREE.Color() }, uPulse: { value: new THREE.Color() }, uAx: uniforms.uAx, uAx0: uniforms.uAx0 };
  const nerveMat = new THREE.ShaderMaterial({ uniforms: nerveU, vertexShader: N_VERT, fragmentShader: N_FRAG, transparent: true, depthWrite: false, depthTest: false });
  const linkMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  let body = null, bodyFailed = false, hitMesh = null;

  function buildBody(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(B.nrm, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(B.ao, 1));
    g.setAttribute('aLobe', new THREE.BufferAttribute(B.lobe, 1));
    g.setIndex(new THREE.BufferAttribute(B.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.6);
    const pre = new THREE.Mesh(g, depthMat); pre.renderOrder = 0;
    hitMesh = pre;
    const halo = new THREE.Mesh(g, haloMat); halo.renderOrder = 1;
    const holo = new THREE.Mesh(g, holoMat); holo.renderOrder = 2;
    brainG.add(pre, halo, holo);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(B.npos, 3));
    ng.setAttribute('aD', new THREE.BufferAttribute(B.nd, 1));
    const nerves = new THREE.LineSegments(ng, nerveMat);
    nerves.renderOrder = 3;
    nerves.frustumCulled = false;
    brainG.add(nerves);
    // cortex dust and neurons strung along the tracts
    const S = sampleSurface(B, NCORT);
    aH.set(S.P, NFLOW * 3); aN.set(S.N, NFLOW * 3);
    const ns = B.npos.length / 6, bp = new Float32Array(NNEU * 3);
    for (let j = 0; j < NNEU; j++) {
      const si = (rnd() * ns) | 0, t = rnd();
      for (let k = 0; k < 3; k++) bp[j * 3 + k] = B.npos[si * 6 + k] * (1 - t) + B.npos[si * 6 + 3 + k] * t + (rnd() - 0.5) * 0.05;
    }
    aH.set(bp, (NFLOW + NCORT) * 3);
    geo.attributes.aH.needsUpdate = true;
    geo.attributes.aN.needsUpdate = true;
    const links = knnLinks(bp, NNEU, 2), lp = new Float32Array(links.length * 3);
    links.forEach((idx, j) => { lp[j * 3] = bp[idx * 3]; lp[j * 3 + 1] = bp[idx * 3 + 1]; lp[j * 3 + 2] = bp[idx * 3 + 2]; });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const bl = new THREE.LineSegments(lg, linkMat);
    bl.renderOrder = 4;
    brainG.add(bl);
    body = B;
  }
  fetch(BRAIN_URL)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => buildBody(parseBody(buf)))
    .catch(() => { bodyFailed = true; });

  // ── pathways and beams ──
  // flow-frame geometry, rebuilt on layout: E entry, M where the pathways meet, X exit, Q1/Q2 pathway controls, nodes = beam ends
  let E = [0, 0, 0], M = [0, 0, 0], X = [0, 0, 0], split = 1;
  const Q1 = [], Q2 = [], nodes = [];
  let crownF = [0, 0, 0];
  const RA = 30, RS = 24, RQ = 20;
  const mkGeo = (n, attrs) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    for (const [name, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * size), size));
    return g;
  };
  const lineU = (a0, a1) => ({ uGrow: { value: 0 }, uA: { value: 0 }, uLight: { value: 0 }, uA0: { value: a0 }, uA1: { value: a1 }, ...hotU });
  const mkMat = (u, vs, fs) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, depthTest: false });
  // thin lines: the pathways inside the brain and the beams
  const arcLineGeo = mkGeo(NRAY * RA * 2, [['aT', 1], ['aK', 1], ['aC', 3]]);
  const arcLineU = lineU(0.42, 0.62);
  const arcLines = new THREE.LineSegments(arcLineGeo, mkMat(arcLineU, L_VERT, L_FRAG));
  const rayGeo = mkGeo(NRAY * RS * 2, [['aT', 1], ['aK', 1], ['aC', 3]]);
  const rayU = lineU(0.85, 0.28);
  const rays = new THREE.LineSegments(rayGeo, mkMat(rayU, L_VERT, L_FRAG));
  // soft ribbons under them
  const arcRibGeo = mkGeo(NRAY * RA * 6, [['aT', 1], ['aW', 1], ['aK', 1], ['aC', 3]]);
  const arcRibU = lineU(0.28, 0.38);
  const arcRibs = new THREE.Mesh(arcRibGeo, mkMat(arcRibU, RB_VERT, RB_FRAG));
  const rayRibGeo = mkGeo(NRAY * RQ * 6, [['aT', 1], ['aW', 1], ['aK', 1], ['aC', 3]]);
  const rayRibU = lineU(0.34, 0.06);
  const rayRibs = new THREE.Mesh(rayRibGeo, mkMat(rayRibU, RB_VERT, RB_FRAG));
  for (const [o, r] of [[arcRibs, 3], [rayRibs, 3], [arcLines, 4], [rays, 4]]) { o.renderOrder = r; o.frustumCulled = false; flow.add(o); }
  // glows: entry, exit and each decision
  const NG = 2 + NRAY;
  const glowGeo = mkGeo(NG, [['aS', 1], ['aC', 3]]);
  const sU = { uSize: { value: 40 }, uA: { value: 0 }, uLight: { value: 0 } };
  const glowMat = mkMat(sU, S_VERT, S_FRAG);
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.renderOrder = 7;
  glows.frustumCulled = false;
  flow.add(glows);
  const lineMats = [arcLines.material, rays.material, arcRibs.material, rayRibs.material];

  // the pathway points, as the particles follow them
  const pathAt = (k, q) => (q <= split || split > 0.9999 ? bez3(E, Q1[k], Q2[k], M, Math.min(1, q / split)) : lerp3(M, X, (q - split) / (1 - split)));
  function setNodes(fan, len) {
    nodes.length = 0;
    for (let k = 0; k < NRAY; k++) {
      const a = -0.06 + fan * (1 - k / ((NRAY - 1) / 2));
      nodes.push([X[0] + Math.cos(a) * len, X[1] + Math.sin(a) * len, X[2]]);
    }
  }
  // flow-frame copies of the brain-frame points
  const qPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(PITCH, YAW, 0, 'XYZ'));
  const qUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const tv = new THREE.Vector3();
  const toFlow = (p) => tv.set(p[0], p[1], p[2]).applyMatrix4(brainG.matrix).toArray();
  function poseBrain() {
    const G = portrait ? GEO.port : GEO.land;
    brainG.position.set(0, 0, 0);
    brainG.scale.setScalar(BS);
    if (portrait) brainG.quaternion.copy(qUp).multiply(qPose); else brainG.quaternion.copy(qPose);
    brainG.updateMatrix();
    E = toFlow(G.E); M = toFlow(G.M); X = toFlow(G.X); crownF = toFlow(G.crown);
    // five pathways fanned across the brain: each bulges to its beam's side and a little towards the viewer
    const d = [G.M[0] - G.E[0], G.M[1] - G.E[1], G.M[2] - G.E[2]];
    for (let k = 0; k < NRAY; k++) {
      const h = ((NRAY - 1) / 2 - k) / ((NRAY - 1) / 2) * G.amp * (4 / 3);
      const off = [G.bend[0] * h, G.bend[1] * h, G.zb * (4 / 3)];
      Q1[k] = toFlow([G.E[0] + d[0] / 3 + off[0], G.E[1] + d[1] / 3 + off[1], G.E[2] + d[2] / 3 + off[2]]);
      Q2[k] = toFlow([G.E[0] + (2 * d[0]) / 3 + off[0], G.E[1] + (2 * d[1]) / 3 + off[1], G.E[2] + (2 * d[2]) / 3 + off[2]]);
    }
    // the share of the inside journey spent on the curved part (the rest runs down the brainstem)
    let lc = 0, prev = E;
    for (let i = 1; i <= 24; i++) { const p = bez3(E, Q1[2], Q2[2], M, i / 24); lc += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]); prev = p; }
    const ls = Math.hypot(X[0] - M[0], X[1] - M[1], X[2] - M[2]);
    split = ls < 1e-4 ? 1 : lc / (lc + ls);
    uniforms.uAx.value.set(...G.ax); uniforms.uAx0.value = G.ax0; uniforms.uAxL.value = G.axL;
    nerveU.uTipEnd.value = G.axL + 0.05;
  }

  function buildFlow() {
    for (let k = 0; k < NRAY; k++) {
      uniforms.uQ1.value[k].set(...Q1[k]); uniforms.uQ2.value[k].set(...Q2[k]); uniforms.uN.value[k].set(...nodes[k]);
    }
    uniforms.uE.value.set(...E); uniforms.uM.value.set(...M); uniforms.uX.value.set(...X); uniforms.uSplit.value = split;
    const cIn = new THREE.Color(pal.core);
    // thin lines
    const fillLines = (g, segs, ptAt, colAt, dimOf) => {
      const p = g.attributes.position.array, t = g.attributes.aT.array, kk = g.attributes.aK.array, c = g.attributes.aC.array;
      let o = 0;
      for (let k = 0; k < NRAY; k++) for (let s = 0; s < segs; s++) for (const q of [s / segs, (s + 1) / segs]) {
        p.set(ptAt(k, q), o * 3); t[o] = q; kk[o] = k;
        const col = colAt(k, q), dim = dimOf(k);
        c[o * 3] = col.r * dim; c[o * 3 + 1] = col.g * dim; c[o * 3 + 2] = col.b * dim;
        o++;
      }
      for (const n of ['position', 'aT', 'aK', 'aC']) g.attributes[n].needsUpdate = true;
    };
    const tc = new THREE.Color();
    const arcCol = (k, q) => tc.copy(cIn).lerp(uniforms.uRC.value[k], ease(clamp01((q - 0.05) / 0.75)));
    const dimL = (k) => (LABELED.includes(k) ? 1 : 0.5);
    fillLines(arcLineGeo, RA, pathAt, arcCol, dimL);
    fillLines(rayGeo, RS, (k, q) => lerp3(X, nodes[k], q), (k) => uniforms.uRC.value[k], dimL);
    // ribbons (flat, in the flow plane)
    const fillRibs = (g, segs, ptAt, colAt, w0, w1, dimOf) => {
      const p = g.attributes.position.array, t = g.attributes.aT.array, w = g.attributes.aW.array, kk = g.attributes.aK.array, c = g.attributes.aC.array;
      let v = 0;
      for (let k = 0; k < NRAY; k++) for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs, a = ptAt(k, t0), b = ptAt(k, t1);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        const P = (pt, q, sg) => { const ww = w0 + (w1 - w0) * q; return [pt[0] + nx * ww * sg, pt[1] + ny * ww * sg, pt[2]]; };
        for (const [pt, q, sg] of [[a, t0, -1], [b, t1, -1], [b, t1, 1], [a, t0, -1], [b, t1, 1], [a, t0, 1]]) {
          p.set(P(pt, q, sg), v * 3); t[v] = q; w[v] = sg; kk[v] = k;
          const col = colAt(k, q), dim = dimOf(k);
          c[v * 3] = col.r * dim; c[v * 3 + 1] = col.g * dim; c[v * 3 + 2] = col.b * dim;
          v++;
        }
      }
      for (const n of ['position', 'aT', 'aW', 'aK', 'aC']) g.attributes[n].needsUpdate = true;
    };
    fillRibs(arcRibGeo, RA, pathAt, arcCol, 0.045, 0.04, (k) => (LABELED.includes(k) ? 1 : 0.55));
    fillRibs(rayRibGeo, RQ, (k, q) => lerp3(X, nodes[k], q), (k) => uniforms.uRC.value[k], 0.03, 0.1, (k) => (LABELED.includes(k) ? 1 : 0.5));
    // glows
    const gp = glowGeo.attributes.position.array, gs = glowGeo.attributes.aS.array, gc = glowGeo.attributes.aC.array;
    gp.set(E, 0); gp.set(X, 3); gs[0] = 0.8; gs[1] = 1.1;
    gc.set([cIn.r, cIn.g, cIn.b], 0); gc.set([cIn.r, cIn.g, cIn.b], 3);
    for (let k = 0; k < NRAY; k++) {
      const col = uniforms.uRC.value[k];
      gp.set(nodes[k], (2 + k) * 3); gs[2 + k] = LABELED.includes(k) ? 0.9 : 0.35; gc.set([col.r, col.g, col.b], (2 + k) * 3);
    }
    for (const n of ['position', 'aS', 'aC']) glowGeo.attributes[n].needsUpdate = true;
  }

  // ── theme ──
  let light = false, pal = PALETTE.dark;
  function setTheme(th) {
    light = th === 'light';
    const P = (pal = light ? PALETTE.light : PALETTE.dark);
    uniforms.uC1.value.set(P.c1); uniforms.uC2.value.set(P.c2); uniforms.uC3.value.set(P.c3); uniforms.uRaw.value.set(P.raw);
    P.rays.forEach((c, k) => uniforms.uRC.value[k].set(c));
    uniforms.uLight.value = light ? 1 : 0;
    uniforms.uSharp.value = P.sharp;
    bodyU.uLight.value = light ? 1 : 0;
    bodyU.uFill.value.set(P.fill); bodyU.uLine.value.set(P.line); bodyU.uRim.value.set(P.rim); bodyU.uEdge.value.set(P.edge);
    bodyU.uTA.value.set(P.tA); bodyU.uTB.value.set(P.tB);
    haloU.uRim.value.set(P.halo);
    nerveU.uLight.value = light ? 1 : 0;
    nerveU.uCol.value.set(P.nerve); nerveU.uPulse.value.set(P.pulse);
    for (const m of lineMats) m.uniforms.uLight.value = light ? 1 : 0;
    sU.uLight.value = light ? 1 : 0;
    // light: ink over the page. dark: light is added and alpha grows with it (see GLOW)
    const lightUp = (m, scaleByAlpha) => {
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation; m.blendEquationAlpha = THREE.AddEquation;
      m.blendSrc = scaleByAlpha ? THREE.SrcAlphaFactor : THREE.OneFactor; m.blendDst = THREE.OneFactor;
      m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    };
    for (const m of [netMat, linkMat]) { if (light) m.blending = THREE.NormalBlending; else lightUp(m, true); m.needsUpdate = true; }
    for (const m of [pMat, holoMat, haloMat, nerveMat, glowMat, ...lineMats]) { if (light) m.blending = THREE.NormalBlending; else lightUp(m, false); m.premultipliedAlpha = false; m.needsUpdate = true; }
    netMat.color.set(P.net); linkMat.color.set(P.line);
    if (nodes.length) buildFlow();
  }

  // ── callouts (DOM) ──
  // raw data at the cloud, the brain, and three of the five decisions
  const CALLS = [
    { k: 'raw', dir: 'raw' },
    { k: 'brain', dir: 'brain' },
    { k: 'o1', node: 0, dir: 'out' },
    { k: 'o2', node: 2, dir: 'out' },
    { k: 'o3', node: 4, dir: 'out' },
  ];
  const hot = { raw: 0, brain: 0, o1: 0, o2: 0, o3: 0 }, hotK = { raw: 0, brain: 0, o1: 0, o2: 0, o3: 0 };
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
    // each label links to its section; hovering or focusing it lights what it names
    const el = document.createElement('a');
    el.className = 'co';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    const on = () => { g.classList.add('hot'); hot[c.k] = 1; };
    const off = () => { g.classList.remove('hot'); hot[c.k] = 0; };
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    el.addEventListener('focus', on);
    el.addEventListener('blur', off);
    calloutsEl.appendChild(el);
    return { ...c, at: [0, 0, 0], path, ring, pt, g, el, w: 0, h: 0, shown: false, flashT: null, bx: 0, by: 0, placed: false };
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
  let W = 1, H = 1, portrait = false, side = lang === 'ar' ? -1 : 1, dpr = 1, ppw = 100;
  const tgt = { x: 0, y: 0, s: 1, rot: 0 }, cur = { x: 0, y: 0, s: 1, rot: 0 };
  let netScale = 1, netRz = 0, first = true, textTop = 0, cloudLen = 1;
  // how far the hero text really reaches (its box is wider than the words in it)
  const trng = document.createRange();
  function textInner() {
    const ht = document.getElementById('heroText');
    if (!ht) return null;
    let l = Infinity, r = -Infinity;
    const take = (b) => { if (b.width > 0 && b.height > 0) { l = Math.min(l, b.left); r = Math.max(r, b.right); } };
    for (const ch of ht.children) {
      if (getComputedStyle(ch).display === 'none') continue;
      if (ch.children.length && ch.id === 'heroCta') { for (const k of ch.children) take(k.getBoundingClientRect()); continue; }
      trng.selectNodeContents(ch); take(trng.getBoundingClientRect());
    }
    return Number.isFinite(l) ? { l, r } : null;
  }
  const labelW = (list) => Math.max(0, ...list.map((c) => c.w));
  function layout() {
    const vh = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    ppw = H / vh;
    const vw = vh * camera.aspect;
    portrait = W / H < 1.15 || W < 760;
    poseBrain();
    const outs = calls.filter((c) => c.dir === 'out');
    if (!portrait) {
      // EN, left to right: hero text | raw data | brain | beams | labels (AR mirrors it)
      setNodes(0.44, 0.98);
      const tb = textInner();
      const inner = (tb ? Math.max(W * 0.3, side > 0 ? tb.r : W - tb.l) : W * 0.46) + 30;
      const lw = Math.max(150, labelW(outs));
      const reach = Math.max(...nodes.map((n) => n[0])) - X[0];
      const CLOUD_MIN = 0.85;
      const span = X[0] - E[0] + reach + CLOUD_MIN;
      const right = 26 + lw + 34; // from the farthest beam end to the screen edge
      const sW = (W - inner - right) / (span * ppw);
      // vertical: the brain label above the crown, the lowest beam label below
      const top = crownF[1], bot = Math.min(nodes[NRAY - 1][1], -1.04 * BS);
      const sH = (H - 2 * 92 - 70) / ((top - bot) * ppw);
      const s = Math.max(0.36, Math.min(1.3, sW, sH));
      const sp = s * ppw;
      const ox = W - right - (X[0] + reach) * sp;
      cloudLen = Math.max(CLOUD_MIN * 0.8, (ox + E[0] * sp - inner) / sp);
      tgt.s = s; tgt.rot = 0;
      tgt.x = (side * (ox - W / 2)) / ppw;
      // centre the whole figure (label above included) a little below the middle
      tgt.y = (-((top + bot) / 2) * s) - 18 / ppw;
      netScale = Math.min(1, vw / 6.6); netRz = 0;
      calloutsEl.style.removeProperty('--co-max');
      calloutsEl.classList.remove('compact');
    } else {
      // phones, top to bottom: raw data | brain | beams | labels | hero text
      setNodes(0.95, 1.0);
      const reserve = getReserve ? getReserve() : H * 0.42;
      const top = 70, bottom = H - reserve - 8;
      const fig = Math.max(200, bottom - top);
      calloutsEl.style.setProperty('--co-max', Math.max(90, Math.min(150, Math.floor(W * 0.36))) + 'px');
      calloutsEl.classList.toggle('compact', W < 430);
      const labH = Math.max(34, ...outs.map((c) => c.h)) + 12;
      const reachV = Math.max(...nodes.map((n) => n[0])) - X[0];
      const CLOUD_MIN = 0.5;
      const sV = (fig - labH) / ((CLOUD_MIN + (X[0] - E[0]) + reachV) * ppw);
      // across: the brain (front to back) and the outer beams with their labels
      const halfBrain = 1.3 * BS, spread = Math.max(...nodes.map((n) => Math.abs(n[1] - X[1])));
      const lw = Math.max(90, labelW(outs));
      const sB = (W - 36) / (2 * halfBrain * ppw), sF = (W - 20 - lw) / (2 * spread * ppw);
      const s = Math.max(0.26, Math.min(W >= 700 ? 1.05 : 0.9, sV, sB, sF));
      const sp = s * ppw;
      // the labels sit just above the hero text, the figure stacks up from there
      const yX = bottom - labH - reachV * sp;
      const oy = yX - X[0] * sp;
      cloudLen = Math.max(CLOUD_MIN * 0.8, (oy + E[0] * sp - top) / sp);
      // centre the brain across the screen (flow y runs sideways)
      const midY = (toFlowMid() + X[1]) / 2;
      const ox = W / 2 - side * midY * sp;
      tgt.s = s; tgt.rot = -Math.PI / 2;
      tgt.x = (ox - W / 2) / ppw; tgt.y = (H / 2 - oy) / ppw;
      textTop = bottom + 4;
      netScale = Math.min(0.56, (vw * 0.9) / 3.1); netRz = Math.PI / 2;
    }
    uniforms.uCloud.value = Math.max(0.2, cloudLen - 0.1);
    uniforms.uJit.value = 0.032;
    buildFlow();
    // contour spacing follows the on-screen size (about 8–9 device pixels apart)
    const pxPerUnit = ppw * tgt.s * BS * dpr;
    bodyU.uDensity.value = Math.max(12, Math.min(40, pxPerUnit / 10.5));
    if (first) Object.assign(cur, tgt);
  }
  // middle of the brain across the screen on phones (flow y of the brain's front/back midpoint)
  function toFlowMid() {
    const a = toFlow([-1.3, 0.3, 0]), b = toFlow([1.14, 0.3, 0]);
    return (a[1] + b[1]) / 2;
  }
  function resize(force) {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    if (force !== true && w === W && h === H) return;
    W = w; H = h;
    dpr = Math.min(devicePixelRatio || 1, small ? 2 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uniforms.uSize.value = pal.size * dpr;
    layout(); measure(); layout();
  }
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 80); });

  // ── input ──
  let mx = 0, my = 0, smx = 0, smy = 0;
  const tilt = reduced ? 0.4 : 1; // how far the figure turns towards the pointer
  addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1; zapAsk = e; }, { passive: true });
  // a touch (or click) on the brain gives it a jolt
  addEventListener('pointerdown', (e) => { zapAsk = e; zapTap = true; }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { zapAsk = null; zapOn = false; });
  // ── electricity: the pointer on the brain ──
  let zapAsk = null, zapTap = false, zapOn = false, zapKick = 0, zapLevel = 0, zapT0 = -9;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), zp = new THREE.Vector3();
  function zapUpdate(dt) {
    if (zapAsk && hitMesh && T >= T_FORMED && scrollK < 0.3) {
      const e = zapAsk; zapAsk = null;
      // over a label or a button the brain stays calm
      const over = e.target && e.target.closest && e.target.closest('a, button');
      ndc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = over ? null : ray.intersectObject(hitMesh, false)[0];
      const was = zapOn;
      zapOn = !!hit && e.pointerType === 'mouse';
      if (hit) {
        zp.copy(hit.point); hitMesh.worldToLocal(zp);
        bodyU.uZapP.value.lerp(zp, was ? 0.35 : 1);
        if (!was || zapTap) zapT0 = time;
        if (zapTap) zapKick = 1;
      }
      zapTap = false;
    } else if (zapAsk) { zapAsk = null; zapOn = false; zapTap = false; }
    zapKick = Math.max(0, zapKick - dt / 1.8);
    const want = Math.max(zapOn ? 1 : 0, zapKick);
    // the shock arrives at once and fades out more gently
    zapLevel += (want - zapLevel) * Math.min(1, dt * (want > zapLevel ? 14 : 2.4));
    bodyU.uZap.value = zapLevel < 0.003 ? 0 : zapLevel;
    bodyU.uZapT.value = time - zapT0;
    if (zapOn && time - zapT0 > 1.6) zapT0 = time; // keep the waves coming while the pointer rests there
  }

  // ── timeline ──
  let T = reduced ? T_END : 0, speed = 1, time = 0, last = performance.now(), scrollK = 0, sk = 0, canvasOp = -1, frameNo = 0, freezeT = null;
  const fired = {};
  const fire = (name) => { if (!fired[name]) { fired[name] = true; onPhase && onPhase(name); } };
  const v3 = new THREE.Vector3();
  const toScreen = (p) => { v3.set(p[0], p[1], p[2]).applyMatrix4(flow.matrixWorld).project(camera); return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H]; };

  function updateCallouts(dt) {
    // on phones the labels sit right above the hero text: they ride up with the page as it scrolls,
    // so the text never slides under them, and fade out quickly
    const fadeK = portrait ? 0.2 : 0.35;
    const vis = scrollK < fadeK;
    calloutsEl.style.opacity = vis ? String(1 - scrollK / fadeK) : '0';
    calloutsEl.style.transform = portrait && vis && scrollY > 0 ? `translate3d(0, ${-Math.round(scrollY)}px, 0)` : '';
    // fading labels stop taking clicks and focus before they disappear
    calloutsEl.classList.toggle('off', scrollK > fadeK * 0.6);
    if (!vis || !body) return;
    const [xX, xY] = toScreen(X);
    const live = [];
    const gap = portrait ? 10 : 14;
    calls.forEach((c, i) => {
      const want = T >= T_READY - 0.25 + i * 0.14 && !!c.el.innerHTML;
      if (want !== c.shown) {
        c.shown = want; c.el.classList.toggle('show', want); c.g.classList.toggle('show', want);
        c.el.tabIndex = want ? 0 : -1; c.el.setAttribute('aria-hidden', want ? 'false' : 'true');
        if (want) c.flashT = time; else c.placed = false;
      }
      if (!want) return;
      let at;
      if (c.dir === 'out') at = nodes[c.node];
      else if (c.dir === 'brain') at = crownF;
      else {
        // the raw-data label hangs off the outer edge of the cloud
        const f = 0.62, d = 0.1 + f * (cloudLen - 0.1), sp = 0.15 + f * (cloudLen - 0.1) * 0.46;
        at = [E[0] - d, E[1] - (portrait ? 1 : 0.9) * sp * 0.95, E[2]];
      }
      const [sx, sy] = toScreen(at);
      let bx, by, ex, ey;
      if (c.dir === 'out') {
        let dx = sx - xX, dy = sy - xY; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        if (!portrait) {
          ex = sx + dx * 14; ey = sy + dy * 14;
          bx = dx > 0 ? ex + 10 : ex - 10 - c.w; by = ey - c.h / 2;
        } else {
          ex = sx + dx * 10; ey = sy + dy * 10;
          bx = ex - c.w / 2; by = ey + 8;
        }
      } else if (c.dir === 'brain') {
        if (!portrait) { ex = sx; ey = sy - 26; bx = sx - c.w / 2; by = ey - c.h; }
        else if (W < 600) {
          // narrow phones have no room beside the brain: the label sits in the top corner across from
          // the raw-data label, and its leader rises from the brain to it
          by = 70; bx = side > 0 ? W - 10 - c.w : 10;
          ex = Math.max(bx + 14, Math.min(bx + c.w - 14, sx)); ey = by + c.h + 12;
        } else {
          // tablets: the label mirrors the raw-data label across the incoming stream, so both sit above
          // the brain on either side of the data (beside the brain it would cover the mesh)
          const raw = live.find((b) => b.c.dir === 'raw'), ax = toScreen(E)[0];
          const gapX = raw ? Math.max(40, side > 0 ? ax - (raw.bx + raw.c.w) : raw.bx - ax) : 60;
          by = raw ? raw.by : 70; bx = side > 0 ? ax + gapX : ax - gapX - c.w;
          ex = Math.max(bx + 14, Math.min(bx + c.w - 14, sx)); ey = by + c.h + 12;
        }
      } else {
        if (!portrait) { ex = sx; ey = sy + 26; bx = sx - c.w / 2; by = ey; }
        else { ex = sx - 14 * side; ey = sy; bx = side > 0 ? ex - 8 - c.w : ex + 8; by = sy - c.h / 2; }
      }
      live.push({ c, sx, sy, ex, ey, bx, by });
    });
    // keep labels on screen, clear of the text and of each other
    const minY = 66, maxY = portrait ? textTop : H - 12;
    const fit = (b) => { b.bx = Math.max(10, Math.min(W - 10 - b.c.w, b.bx)); b.by = Math.max(minY, Math.min(maxY - b.c.h, b.by)); };
    for (const b of live) fit(b);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const A = live[i], B = live[j];
        const ox = Math.min(A.bx + A.c.w, B.bx + B.c.w) - Math.max(A.bx, B.bx) + 10;
        const oy = Math.min(A.by + A.c.h, B.by + B.c.h) - Math.max(A.by, B.by) + 8;
        if (ox <= 0 || oy <= 0) continue;
        if (oy <= ox) { const s = A.by + A.c.h / 2 < B.by + B.c.h / 2 ? -1 : 1; A.by += (s * oy) / 2; B.by -= (s * oy) / 2; }
        else { const s = A.bx + A.c.w / 2 < B.bx + B.c.w / 2 ? -1 : 1; A.bx += (s * ox) / 2; B.bx -= (s * ox) / 2; }
      }
      for (const b of live) fit(b);
    }
    const f = Math.min(1, dt * 9);
    for (const b of live) {
      const { c, sx, sy } = b;
      if (!c.placed) { c.bx = b.bx; c.by = b.by; c.placed = true; } else { c.bx += (b.bx - c.bx) * f; c.by += (b.by - c.by) * f; }
      // the leader runs from the anchor to the nearest point of its label
      const lx = Math.max(c.bx, Math.min(c.bx + c.w, b.ex)), ly = Math.max(c.by, Math.min(c.by + c.h, b.ey));
      c.path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} L${b.ex.toFixed(1)} ${b.ey.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}`);
      c.ring.setAttribute('cx', sx.toFixed(1)); c.ring.setAttribute('cy', sy.toFixed(1));
      c.pt.setAttribute('cx', sx.toFixed(1)); c.pt.setAttribute('cy', sy.toFixed(1));
      c.el.style.transform = `translate3d(${c.bx.toFixed(1)}px, ${c.by.toFixed(1)}px, 0)`;
    }
  }

  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // animation steps stay small, but the story clock follows real time even on slow machines
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(rawDt, 0.05);
    last = now;
    frameNo++;
    if (scrollK >= 0.999 && frameNo % 2) return; // half rate when it's only a backdrop
    time += dt;
    first = false;
    // the story plays a little brisker than its own timings (about 4.6 s from the network to the labels)
    if (freezeT === null) T += Math.min(rawDt, 0.25) * speed * (T < T_END ? 1.4 : 1); else T = freezeT;
    // the move from the front of the page to the backdrop eases after the scroll instead of tracking each
    // scroll event, and the canvas fades with it
    sk = reduced ? scrollK : sk + (scrollK - sk) * (1 - Math.exp(-Math.min(rawDt, 0.25) * 7));
    if (Math.abs(sk - scrollK) < 0.0005) sk = scrollK;
    const op = Math.round((1 - (light ? 0.5 : 0.84) * ease(sk)) * 1000) / 1000;
    if (op !== canvasOp) { canvasOp = op; canvas.style.opacity = String(op); }
    // hold before the morph until the brain has arrived (slow networks); with reduced motion
    // the clock stays at the end, so the finished picture appears as soon as the brain loads
    if (!body && !bodyFailed && T > T_MORPH - 0.05 && freezeT === null && !reduced) T = T_MORPH - 0.05;
    if (bodyFailed && !fired.ready) { fire('morph'); fire('formed'); fire('ready'); }
    if (speed > 1 && T >= T_END) speed = 1;
    if (T >= T_MORPH) fire('morph');
    if (T >= T_FORMED) fire('formed');
    if (T >= T_READY) fire('ready');

    const netFade = easeOut(clamp01(T / 0.9));
    const morph = body ? ease(clamp01((T - T_MORPH) / D_MORPH)) : 0;
    const flowIn = body ? easeOut(clamp01((T - T_FLOW) / 1.2)) : 0;
    const rIn = body ? easeOut(clamp01((T - T_RAYS) / 1.0)) : 0;
    const fx = body ? easeOut(clamp01((T - T_FORMED) / 1.0)) : 0;
    uniforms.uTime.value = time; bodyU.uTime.value = time; nerveU.uTime.value = time;
    uniforms.uMorph.value = morph;
    uniforms.uNetFade.value = netFade;
    uniforms.uFlow.value = flowIn;
    uniforms.uRays.value = rIn;
    uniforms.uSettle.value = easeOut(clamp01((T - T_FLOW + 0.4) / 1.6));

    // hover: a label lights what it names
    const kf = Math.min(1, dt * 7);
    for (const k in hotK) hotK[k] += (hot[k] - hotK[k]) * kf;
    uniforms.uHotRaw.value = hotK.raw;
    zapUpdate(Math.min(rawDt, 0.25));
    uniforms.uHotBrain.value = Math.max(hotK.brain, zapLevel * 0.3);
    bodyU.uHot.value = Math.max(hotK.brain, zapLevel * 0.15, ...calls.filter((c) => c.k === 'brain').map((c) => (c.flashT !== null ? Math.exp(-Math.pow((time - c.flashT - 0.3) / 0.42, 2)) * 0.7 : 0)));
    uniforms.uHotA.value.set(hotK.o1, 0, hotK.o2, 0); uniforms.uHotB.value = hotK.o3;
    uniforms.uFocus.value = Math.max(hotK.o1, hotK.o2, hotK.o3);

    // layout easing and pose
    const k = 1 - Math.pow(0.0015, dt);
    cur.x += (tgt.x - cur.x) * k; cur.y += (tgt.y - cur.y) * k; cur.s += (tgt.s - cur.s) * k; cur.rot += (tgt.rot - cur.rot) * k;
    // the figure follows the pointer smoothly (about a third of a second), in real time even at low fps
    const follow = 1 - Math.exp(-Math.min(rawDt, 0.25) * 3.2);
    smx += (mx - smx) * follow; smy += (my - smy) * follow;
    const idle = reduced ? 0 : Math.sin(time * 0.23) * 0.06;
    // going into the backdrop the brain rises a little and steps back
    const back = ease(sk), fs = cur.s * (1 - 0.1 * back);
    flow.position.set(cur.x, cur.y + back * 0.9 * cur.s, 0);
    if (portrait) flow.scale.set(fs, fs * side, fs); else flow.scale.set(fs * side, fs, fs);
    // the intro plays face-on and calm; the brain starts following the pointer only once it has formed
    const tk = tilt * ease(clamp01((T - T_FORMED + 0.5) / 1.4));
    flow.rotation.set(smy * 0.5 * tk, smx * 1.08 * tk + idle, cur.rot);
    flow.updateMatrixWorld();
    uniforms.uFlowM.value.copy(flow.matrixWorld);
    uniforms.uBrainM.value.copy(brainG.matrixWorld);

    // the brain prints itself along the flow, just behind the arriving particles
    const L = uniforms.uAxL.value;
    const reveal = -0.06 + (L + 0.14) * clamp01((morph - 0.35) / 0.55);
    bodyU.uReveal.value = morph > 0 ? reveal : -9;
    haloU.uAlpha.value = clamp01((morph - 0.45) * 2) * (0.55 + 0.45 * fx + zapLevel * 0.25);
    // a band of light rides the print front, then keeps running through the brain with the data
    const sweep = ((time * 0.32) % 1.4) * (L + 0.5) - 0.25;
    bodyU.uScan.value = morph < 1 ? reveal : reveal + (sweep - reveal) * fx;
    bodyU.uFx.value = Math.max(fx * 0.8, morph > 0 && morph < 1 ? 0.6 : 0);
    const grow = clamp01((T - T_NERVE) / D_NERVE);
    nerveU.uGrow.value = body ? (grow <= 0 ? -1 : easeOut(grow) * (L + 0.2)) : -1;
    nerveU.uAlpha.value = body ? clamp01(grow * 3) * 0.85 : 0;
    linkMat.opacity = (light ? 0.3 : 0.28) * clamp01((morph - 0.75) * 4) * (0.7 + 0.3 * Math.sin(time * 2.3));

    // pathways inside, then the beams
    arcLineU.uGrow.value = flowIn * 1.02; arcLineU.uA.value = flowIn > 0 ? 0.55 : 0;
    arcRibU.uGrow.value = flowIn * 1.02; arcRibU.uA.value = flowIn * (0.9 + 0.1 * Math.sin(time * 1.7));
    rayU.uGrow.value = rIn * 1.02; rayU.uA.value = rIn > 0 ? 1 : 0;
    rayRibU.uGrow.value = rIn * 1.02; rayRibU.uA.value = rIn * (0.9 + 0.1 * Math.sin(time * 1.7));
    sU.uA.value = Math.max(clamp01((T - T_FLOW) / 0.6) * 0.75, rIn) * (0.85 + 0.15 * Math.sin(time * 2.4));
    sU.uSize.value = 34 * dpr * cur.s;

    netGroup.scale.setScalar(netScale);
    netGroup.rotation.set(0.12 + smy * 0.05, portrait ? time * 0.35 : 0.45 + Math.sin(time * 0.4) * 0.32 + smx * 0.2, netRz);
    netGroup.updateMatrixWorld();
    uniforms.uNetM.value.copy(netGroup.matrixWorld);
    netMat.opacity = pal.netOp * netFade * (1 - clamp01(morph * 1.6));

    camera.position.x = smx * 1.35 * tk;
    camera.position.y = -smy * 0.72 * tk;
    camera.lookAt(0, 0, 0);
    uniforms.uCam.value.copy(camera.position);
    renderer.render(scene, camera);
    updateCallouts(dt);
  }

  setTheme(theme);
  setLabels(labels);
  resize();
  raf = requestAnimationFrame(frame);
  if (reduced) { fire('morph'); fire('formed'); fire('ready'); }

  return {
    skip() { if (T < T_END) speed = 6; },
    // straight to the final picture (the page opened somewhere below the hero)
    finish() { if (T < T_END && freezeT === null) T = T_END; },
    setTheme(th) { setTheme(th); uniforms.uSize.value = pal.size * dpr; },
    setLang(l, map) { side = l === 'ar' ? -1 : 1; layout(); setLabels(map); layout(); },
    setScroll(k) { scrollK = k; },
    relayout() { layout(); measure(); layout(); },
    get done() { return T >= T_READY; },
    freeze(t) { freezeT = t; },
  };
}
