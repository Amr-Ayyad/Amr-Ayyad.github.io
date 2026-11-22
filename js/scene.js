// ─────────────────────────────────────────────────────────────
//  The hero: a neural network whose signals fly together into a holographic
//  brain. Fibre tracts light up from the brainstem, every lobe is one skill,
//  and each label lights its lobe and links to its section.
//  The brain mesh is baked offline by tools/brain/brain-build.mjs into
//  assets/brain.bin (see the usage line at the top of that file).
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
const BODY_URL = new URL('../assets/brain.bin', import.meta.url);
const Y_BOT = -1.0, Y_TOP = 1.1;  // stem tip → crown (mesh units)
const PLAT_Y = -1.34;             // projector platform under the brain
const CEN = [-0.05, 0.32, 0];     // middle of the cerebrum
const ORB_Y = 0.12, ORB_R = 1.62;

const rnd = Math.random;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ── brain.bin (the mesh format keeps its BODY magic) ──
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
  float hy = clamp((aH.y + 1.0) / 2.1, 0.0, 1.0);
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
  float sc = exp(-pow((aH.y - uScan) * 14.0, 2.0)) * e;
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
uniform vec3 uLk0, uLk1, uTA, uTB;
attribute float aAO;
attribute float aLobe;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
varying float vHot;
varying vec3 vTint;
void main(){
  vec4 mv = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vP = position;
  vAO = aAO;
  // lobes: 0 frontal, 1 parietal, 2 occipital, 3 temporal, 4 cerebellum, 5 brainstem
  float L = aLobe;
  vHot = L < 0.5 ? uLk0.x : L < 1.5 ? uLk0.y : L < 2.5 ? uLk0.z : L < 3.5 ? uLk1.x : L < 4.5 ? uLk1.y : uLk1.z;
  vTint = mix(uTA, uTB, L < 0.5 ? 0.0 : L < 1.5 ? 0.62 : L < 2.5 ? 0.32 : L < 3.5 ? 1.0 : L < 4.5 ? 0.82 : 0.5);
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
uniform float uTime, uReveal, uFx, uScan, uLight, uAlpha, uDensity, uFocus;
uniform vec3 uFill, uLine, uRim, uEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vAO;
varying float vHot;
varying vec3 vTint;
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
  float sb = exp(-pow((y - uScan) * 9.0, 2.0)) * uFx;
  float edge = exp(-pow((uReveal - y) * 42.0, 2.0)) * step(uReveal, 1.12);
  vec3 line = mix(uLine, vTint, 0.42);
  vec3 fill = mix(uFill, vTint, 0.3);
  float hot = vHot;
  // while a label is hovered, the other lobes step back
  float dim = 1.0 - 0.5 * uFocus * (1.0 - clamp(hot, 0.0, 1.0));
  float key = 0.75 + 0.25 * clamp(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0, 1.0);
  if (uLight < 0.5) {
    vec3 col = fill * (0.06 + 0.3 * fres) * ao * key
      + line * ln * (0.07 + 0.2 * fres + 0.06 * key) * ao
      + line * mj * 0.12 * ao
      + uRim * fres * 0.9
      + uLine * sb * (0.06 + 0.6 * ln) + uEdge * sb * ln * 0.25
      + (uLine * 0.8 + uEdge * 0.5) * edge
      + (line * 0.6 + uEdge * 0.22) * hot * (0.14 + 0.85 * ln + 0.75 * fres) * ao;
    gl_FragColor = glow(col * uAlpha * dim);
  } else {
    float a = (0.05 + 0.16 * fres) * ao * key + ln * (0.14 + 0.22 * fres) * ao + mj * 0.1 + fres * 0.2 + sb * (0.04 + 0.3 * ln) + edge * 0.7
      + hot * (0.08 + 0.32 * ln + 0.22 * fres) * ao;
    gl_FragColor = vec4(mix(mix(line, uRim, fres), vTint, 0.25 + hot * 0.4), clamp(a, 0.0, 0.92) * uAlpha * mix(1.0, dim, 0.8));
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
uniform float uTime, uGrow, uAlpha, uLight, uTipEnd;
uniform vec3 uCol, uPulse;
varying float vD;
void main(){
  if (vD > uGrow) discard;
  float tip = exp(-pow((uGrow - vD) * 5.0, 2.0)) * step(uGrow, uTipEnd);
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
  p.y = mod(p.y + 1.4 + uTime * (0.03 + aR.x * 0.05), 2.85) - 1.4;
  p.x += sin(uTime * 0.3 + aR.y * 6.28) * 0.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aR.z) * (7.0 / -mv.z);
  float edge = smoothstep(-1.4, -1.1, p.y) * (1.0 - smoothstep(1.05, 1.45, p.y));
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

// convex hull (monotone chain) of 2D points
function convexHull(P) {
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// distance from an inside point along a direction to the hull's edge
function rayExit(h, ox, oy, ux, uy) {
  let best = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, s = ((a[0] - ox) * uy - (a[1] - oy) * ux) / den;
    if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
  }
  return best;
}
function inHull(h, x, y) {
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
function boxHitsHull(x, y, w, h, hull) {
  for (const q of hull) if (q[0] > x && q[0] < x + w && q[1] > y && q[1] < y + h) return true;
  return inHull(hull, x, y) || inHull(hull, x + w, y) || inHull(hull, x, y + h) || inHull(hull, x + w, y + h) || inHull(hull, x + w / 2, y + h / 2);
}

const PALETTE = {
  dark: {
    c1: '#7dd3fc', c2: '#d9fbff', c3: '#22d3ee', net: '#38bdf8',
    fill: '#0ea5e9', line: '#5ee3f7', rim: '#a5f3fc', edge: '#e6fdff', halo: '#38d6f0',
    nerve: '#1fb8e0', pulse: '#e9feff', heart: '#5ee3f7', heartCore: '#ffffff',
    hud: '#5ee3f7', hud2: '#7dd3fc', glow: '#0ea5e9', dust: '#a5f3fc',
    tA: '#2dd4bf', tB: '#38bdf8',
    sharp: 1.55, size: 2.5, netOp: 0.13, hudOp: 0.5, glowOp: 0.26, beamOp: 0.16, dustOp: 0.55,
  },
  light: {
    c1: '#0369a1', c2: '#0e7490', c3: '#0891b2', net: '#0284c7',
    fill: '#0891b2', line: '#0e7490', rim: '#0369a1', edge: '#0284c7', halo: '#06b6d4',
    nerve: '#0284c7', pulse: '#06b6d4', heart: '#0891b2', heartCore: '#0e7490',
    hud: '#0e7490', hud2: '#0369a1', glow: '#38bdf8', dust: '#0891b2',
    tA: '#0f766e', tB: '#0369a1',
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

  // ── the brain: brainG turns it to face the text, the platform below stays level ──
  const humGroup = new THREE.Group();
  scene.add(humGroup);
  const brainG = new THREE.Group();
  humGroup.add(brainG);
  // the same turn without the idle sway: labels are laid out from this, so they stay put
  // while the brain drifts (only their leader lines follow it)
  const calm = new THREE.Object3D();
  humGroup.add(calm);
  const bodyU = {
    uTime: { value: 0 }, uReveal: { value: -9 }, uFx: { value: 0 }, uScan: { value: -9 }, uLight: { value: 0 },
    uAlpha: { value: 1 }, uDensity: { value: 28 }, uInflate: { value: 0 }, uFocus: { value: 0 },
    uFill: { value: new THREE.Color() }, uLine: { value: new THREE.Color() }, uRim: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
    uLk0: { value: new THREE.Vector3() }, uLk1: { value: new THREE.Vector3() }, uTA: { value: new THREE.Color() }, uTB: { value: new THREE.Color() },
  };
  const depthMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: B_VERT, fragmentShader: B_DEPTH, colorWrite: false });
  const holoMat = new THREE.ShaderMaterial({ uniforms: bodyU, vertexShader: B_VERT, fragmentShader: B_FRAG, transparent: true, depthWrite: false });
  const haloU = { uInflate: { value: 0.034 }, uReveal: bodyU.uReveal, uLight: bodyU.uLight, uAlpha: { value: 0 }, uRim: { value: new THREE.Color() } };
  const haloMat = new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: B_VERT, fragmentShader: H_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide });
  for (const m of [depthMat, holoMat, haloMat]) m.extensions = { derivatives: true };
  const nerveU = { uTime: { value: 0 }, uGrow: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 0 }, uTipEnd: { value: 4 }, uCol: { value: new THREE.Color() }, uPulse: { value: new THREE.Color() } };
  const nerveMat = new THREE.ShaderMaterial({ uniforms: nerveU, vertexShader: N_VERT, fragmentShader: N_FRAG, transparent: true, depthWrite: false, depthTest: false });
  const brainLinkMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const heartU = { uSize: { value: 60 }, uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uBeat: { value: 0 }, uPhase: { value: 1 }, uAlpha: { value: 0 }, uLight: { value: 0 } };
  const heartMat = new THREE.ShaderMaterial({ uniforms: heartU, vertexShader: SPRITE_VERT, fragmentShader: HEART_FRAG, transparent: true, depthWrite: false, depthTest: false });
  let maxD = 4, body = null, bodyFailed = false, heartPos = [-0.1, 0.05, 0];
  const sil = [];   // surface sample: the brain's on-screen box, which the labels ring
  const prof = [];  // horizontal cross-sections by height, for the scan ring

  function buildBody(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(B.nrm, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(B.ao, 1));
    g.setAttribute('aLobe', new THREE.BufferAttribute(B.lobe, 1));
    g.setIndex(new THREE.BufferAttribute(B.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.6);
    const pre = new THREE.Mesh(g, depthMat); pre.renderOrder = 0;
    const halo = new THREE.Mesh(g, haloMat); halo.renderOrder = 1;
    const holo = new THREE.Mesh(g, holoMat); holo.renderOrder = 2;
    brainG.add(pre, halo, holo);
    // fibre tracts
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(B.npos, 3));
    ng.setAttribute('aD', new THREE.BufferAttribute(B.nd, 1));
    const nerves = new THREE.LineSegments(ng, nerveMat);
    nerves.renderOrder = 3;
    nerves.frustumCulled = false;
    brainG.add(nerves);
    maxD = B.meta.maxD;
    nerveU.uTipEnd.value = maxD + 0.05;
    // particles settle on the cortex; a few become neurons strung along the tracts (more towards their ends)
    const S = sampleSurface(B, NSURF);
    aH.set(S.P); aN.set(S.N);
    const ns = B.npos.length / 6, bp = new Float32Array(NBRAIN * 3);
    for (let j = 0; j < NBRAIN; j++) {
      let si;
      do { si = (rnd() * ns) | 0; } while (rnd() > 0.15 + B.nd[si * 2] / maxD);
      const t = rnd();
      for (let k = 0; k < 3; k++) bp[j * 3 + k] = B.npos[si * 6 + k] * (1 - t) + B.npos[si * 6 + 3 + k] * t + (rnd() - 0.5) * 0.05;
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
    brainG.add(bl);
    // a soft pulse deep in the middle (thalamus), where the tracts meet
    heartPos = B.meta.anchors.heart;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(heartPos, 3));
    hg.setAttribute('aS', new THREE.Float32BufferAttribute([1], 1));
    const heart = new THREE.Points(hg, heartMat);
    heart.frustumCulled = false;
    heart.renderOrder = 7;
    brainG.add(heart);
    // label anchors, the silhouette sample and the cross-section profile
    for (const c of calls) c.at = B.meta.anchors[c.k] || [0, 0, 0];
    const nv = B.meta.nv, P = B.pos, ext = [0, 0, 0, 0, 0, 0];
    for (let v = 0; v < nv; v++) {
      if (P[v * 3] < P[ext[0] * 3]) ext[0] = v; if (P[v * 3] > P[ext[1] * 3]) ext[1] = v;
      if (P[v * 3 + 1] < P[ext[2] * 3 + 1]) ext[2] = v; if (P[v * 3 + 1] > P[ext[3] * 3 + 1]) ext[3] = v;
      if (P[v * 3 + 2] < P[ext[4] * 3 + 2]) ext[4] = v; if (P[v * 3 + 2] > P[ext[5] * 3 + 2]) ext[5] = v;
    }
    for (const v of ext) if (P[v * 3 + 1] > -0.62) sil.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    for (let i = 0; i < 420; i++) { const v = ((rnd() * nv) | 0) * 3; if (P[v + 1] > -0.62) sil.push(P[v], P[v + 1], P[v + 2]); }
    const NB = 36, mn = new Array(NB).fill(9), mx = new Array(NB).fill(-9), zm = new Array(NB).fill(0);
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = Math.abs(P[v * 3 + 2]);
      const k = Math.min(NB - 1, Math.max(0, Math.floor(((y - Y_BOT) / (Y_TOP - Y_BOT)) * NB)));
      if (x < mn[k]) mn[k] = x; if (x > mx[k]) mx[k] = x; if (z > zm[k]) zm[k] = z;
    }
    for (let k = 0; k < NB; k++) prof.push(mn[k] < 9 ? [(mn[k] + mx[k]) / 2, (mx[k] - mn[k]) / 2, zm[k]] : [0, 0.12, 0.12]);
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
  platform.position.y = PLAT_Y;
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
  base.scale.setScalar(1.32);
  platform.add(base);
  const scanRing = mkLines(ringPositions(1, 96), hudMat);
  brainG.add(scanRing);
  const orbit = new THREE.Group();
  orbit.position.y = ORB_Y;
  orbit.rotation.set(0.32, 0, -0.12);
  orbit.add(mkLines(ringPositions(ORB_R, 160, true), hudMat2));
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
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 3.7), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;
  glow.renderOrder = 1;
  platform.add(glow);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uLight: bodyU.uLight },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.86, 1.2, 64, 1, true), beamMat);
  beam.position.y = 0.6;
  beam.renderOrder = 1;
  platform.add(beam);
  const ND = small ? 140 : 240, dpos = new Float32Array(ND * 3), dr = new Float32Array(ND * 4);
  for (let i = 0; i < ND; i++) {
    const a = rnd() * Math.PI * 2, r = 1.05 + Math.sqrt(rnd()) * 1.35;
    dpos[i * 3] = Math.cos(a) * r; dpos[i * 3 + 1] = rnd() * 2.85 - 1.4; dpos[i * 3 + 2] = Math.sin(a) * r * 0.75;
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
    bodyU.uTA.value.set(P.tA); bodyU.uTB.value.set(P.tB);
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

  // ── callouts (DOM): one per lobe, ringed round the brain ──
  const CALLS = [
    { k: 'frontal', lobe: 0 },
    { k: 'parietal', lobe: 1 },
    { k: 'occipital', lobe: 2 },
    { k: 'temporal', lobe: 3 },
    { k: 'cerebellum', lobe: 4 },
  ];
  let hoverLobe = -1;
  const lobeK = [0, 0, 0, 0, 0];
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
    // hovering or focusing a label lights its leader line and its lobe
    const on = () => { g.classList.add('hot'); hoverLobe = c.lobe; };
    const off = () => { g.classList.remove('hot'); if (hoverLobe === c.lobe) hoverLobe = -1; };
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
  let W = 1, H = 1, portrait = false, side = lang === 'ar' ? -1 : 1, dpr = 1;
  const tgt = { x: 0, y: 0, s: 1, yaw: 0 }, cur = { x: 0, y: 0, s: 1, yaw: 0 };
  let netScale = 1, netRz = 0, first = true, textEdge = 0, textTop = 0;
  const HW = 1.4; // the brain's half-width once it is turned (units)
  // EN: the brain sits right of the text and faces it; AR mirrors that
  const yawFor = (sd) => (sd > 0 ? Math.PI + 0.42 : -0.42);
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
  function layout() {
    const vh = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const vw = vh * camera.aspect, ppw = H / vh;
    portrait = W / H < 1.15 || W < 760;
    tgt.yaw = yawFor(side);
    if (!portrait) {
      // centred in the space beside the text, leaving room for a label on either side
      const tb = textInner();
      const inner = tb ? Math.max(W * 0.3, side > 0 ? tb.r : W - tb.l) + 24 : W * 0.46;
      // budget: a full label beside the brain on the screen-edge side (the back lobes),
      // about half a label past its front corners on the text side
      const lab = Math.min(210, Math.max(150, labelW()));
      const avail = W - inner - 16 - 10;
      const s = Math.max(0.42, Math.min(1.15, (H - 220) / (2.55 * ppw), (avail - lab * 1.45 - 36) / (2 * HW * ppw)));
      const bw = 2 * HW * s * ppw;
      const cxp = W - (10 + lab + 18 + Math.max(bw, avail - lab * 1.45 - 36) / 2);
      tgt.s = s; tgt.x = (side * (cxp - W / 2)) / ppw; tgt.y = 0.17 * s - 4 / ppw;
      textEdge = inner + 16;
      netScale = Math.min(1, vw / 6.6); netRz = 0;
      calloutsEl.style.removeProperty('--co-max');
      calloutsEl.classList.remove('compact');
    } else {
      const reserve = getReserve ? getReserve() : H * 0.42;
      const top = 66, bottom = H - reserve - 16;
      const fig = Math.max(150, bottom - top);
      const s = Math.max(0.26, Math.min(W >= 700 ? 1.0 : 0.8, fig / (2.62 * ppw), (vw * 0.78) / (2 * HW)));
      // the block sits nearer the text than the nav, so the brain and the name read as one
      const blockH = 2.62 * s * ppw, cyp = Math.max(top + blockH / 2, bottom - blockH / 2 - Math.min(40, (fig - blockH) * 0.3));
      tgt.s = s; tgt.x = 0; tgt.y = (H / 2 - cyp) / ppw + 0.17 * s;
      textTop = bottom + 8;
      netScale = Math.min(0.56, (vw * 0.9) / 3.1); netRz = Math.PI / 2;
      calloutsEl.style.setProperty('--co-max', Math.max(90, Math.min(160, Math.floor(W * 0.4))) + 'px');
      calloutsEl.classList.toggle('compact', W < 430);
    }
    // contour spacing follows the on-screen size (about 8–9 device pixels apart)
    const pxPerUnit = ppw * tgt.s * dpr;
    bodyU.uDensity.value = Math.max(12, Math.min(40, pxPerUnit / 10.5));
    heartU.uSize.value = pxPerUnit * 0.3;
    if (first) Object.assign(cur, tgt);
  }
  function labelW() {
    let w = 0;
    for (const c of calls) w = Math.max(w, c.w);
    return w || 180;
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

  function updateCallouts(dt) {
    const vis = scrollK < 0.35;
    calloutsEl.style.opacity = vis ? String(1 - scrollK / 0.35) : '0';
    // fading labels stop taking clicks and focus before they disappear
    calloutsEl.classList.toggle('off', scrollK > 0.22);
    if (!vis || !body) return;
    calm.rotation.set(0.2, cur.yaw, 0);
    humGroup.updateMatrixWorld();
    const M = brainG.matrixWorld, MC = calm.matrixWorld, zs = -side; // anchors sit on the hemisphere that faces the viewer
    // the brain's outline on screen (convex hull of a surface sample); each label sits just outside it,
    // on the ray from the brain's centre through its lobe
    const pts = [];
    for (let i = 0; i < sil.length; i += 3) {
      v3.set(sil[i], sil[i + 1], sil[i + 2]).applyMatrix4(MC).project(camera);
      pts.push([(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H]);
    }
    const hull = convexHull(pts);
    // rays start from the middle of the cerebrum, so lower lobes get diagonal (not straight-down) labels
    v3.set(CEN[0], CEN[1], 0).applyMatrix4(MC).project(camera);
    const cx = (v3.x * 0.5 + 0.5) * W, cy = (-v3.y * 0.5 + 0.5) * H;
    const gap = portrait ? 6 : 18;
    const live = [];
    calls.forEach((c, i) => {
      const want = T >= T_READY - 0.25 + i * 0.16 && !!c.el.innerHTML;
      if (want !== c.shown) {
        c.shown = want; c.el.classList.toggle('show', want); c.g.classList.toggle('show', want);
        c.el.tabIndex = want ? 0 : -1; c.el.setAttribute('aria-hidden', want ? 'false' : 'true');
        if (want) c.flashT = time; else c.placed = false;
      }
      if (!want) return;
      v3.set(c.at[0], c.at[1], c.at[2] * zs).applyMatrix4(MC).project(camera);
      const qx = (v3.x * 0.5 + 0.5) * W, qy = (-v3.y * 0.5 + 0.5) * H;
      v3.set(c.at[0], c.at[1], c.at[2] * zs).applyMatrix4(M).project(camera);
      const ax = (v3.x * 0.5 + 0.5) * W, ay = (-v3.y * 0.5 + 0.5) * H;
      const dx = qx - cx, dy = qy - cy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const t = rayExit(hull, cx, cy, ux, uy);
      const px = cx + ux * (t + gap), py = cy + uy * (t + gap);
      const b = { c, ax, ay, bx: px - c.w / 2 + (ux * c.w) / 2, by: py - c.h / 2 + (uy * c.h) / 2 };
      // slide outwards until the label no longer covers the brain
      for (let k = 0; k < 60 && boxHitsHull(b.bx - 4, b.by - 4, c.w + 8, c.h + 8, hull); k++) { b.bx += ux * 4; b.by += uy * 4; }
      live.push(b);
    });
    // keep labels apart, on screen, and clear of the text
    const minX = !portrait && side > 0 ? textEdge : 10, maxX = !portrait && side < 0 ? W - textEdge : W - 10;
    const minY = 66, maxY = portrait ? textTop : H - 12;
    const fit = (b) => {
      b.bx = Math.max(minX, Math.min(maxX - b.c.w, b.bx));
      b.by = Math.max(minY, Math.min(maxY - b.c.h, b.by));
    };
    for (const b of live) fit(b);
    for (let it = 0; it < 12; it++) {
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
      const { c, ax, ay } = b;
      if (!c.placed) { c.bx = b.bx; c.by = b.by; c.placed = true; } else { c.bx += (b.bx - c.bx) * f; c.by += (b.by - c.by) * f; }
      // the leader runs from the lobe to the nearest point of its label
      const ex = Math.max(c.bx, Math.min(c.bx + c.w, ax)), ey = Math.max(c.by, Math.min(c.by + c.h, ay));
      c.path.setAttribute('d', `M${ax.toFixed(1)} ${ay.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
      c.ring.setAttribute('cx', ax.toFixed(1)); c.ring.setAttribute('cy', ay.toFixed(1));
      c.pt.setAttribute('cx', ax.toFixed(1)); c.pt.setAttribute('cy', ay.toFixed(1));
      c.el.style.transform = `translate3d(${c.bx.toFixed(1)}px, ${c.by.toFixed(1)}px, 0)`;
    }
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
    const amp = reduced ? 0.06 : 0.2;
    humGroup.position.set(cur.x, cur.y + scrollK * 0.9 * cur.s, 0);
    humGroup.scale.setScalar(cur.s);
    humGroup.rotation.set(smy * 0.04, smx * 0.1, 0);
    brainG.rotation.set(0.2 + smy * 0.05, cur.yaw + Math.sin(time * 0.32) * amp + smx * 0.2, 0);
    humGroup.updateMatrixWorld();
    uniforms.uHumM.value.copy(brainG.matrixWorld);

    netGroup.scale.setScalar(netScale);
    netGroup.rotation.set(0.12 + smy * 0.05, portrait ? time * 0.35 : 0.45 + Math.sin(time * 0.4) * 0.32 + smx * 0.2, netRz);
    netGroup.updateMatrixWorld();
    uniforms.uNetM.value.copy(netGroup.matrixWorld);
    netMat.opacity = pal.netOp * netFade * (1 - clamp01(morph * 1.6));

    // the hologram prints itself from the floor up, just behind the arriving particles
    const reveal = Y_BOT - 0.06 + (Y_TOP - Y_BOT + 0.14) * clamp01((morph - 0.4) / 0.52);
    bodyU.uReveal.value = morph > 0 ? reveal : -9;
    haloU.uAlpha.value = clamp01((morph - 0.45) * 2) * (0.55 + 0.45 * fx);
    // scan band: rides the print front, then sweeps the body slowly
    const sweep = Math.sin(time * 0.5) * 0.92 + 0.1;
    const scanY = morph < 1 ? reveal : reveal + (sweep - reveal) * fx;
    bodyU.uScan.value = scanY;
    bodyU.uFx.value = Math.max(fx, morph > 0 && morph < 1 ? 0.6 : 0);
    uniforms.uScan.value = morph > 0 ? scanY : -9;
    scanRing.position.y = scanY;
    if (prof.length) {
      // the ring hugs the brain's cross-section at the scan height
      const pk = prof[Math.max(0, Math.min(prof.length - 1, Math.floor(((scanY - Y_BOT) / (Y_TOP - Y_BOT)) * prof.length)))];
      const f = Math.min(1, dt * 6);
      scanRing.position.x += (pk[0] - scanRing.position.x) * f;
      scanRing.scale.x += (pk[1] + 0.08 - scanRing.scale.x) * f;
      scanRing.scale.z += (pk[2] + 0.08 - scanRing.scale.z) * f;
    }

    // nervous system & heart
    const grow = clamp01((T - T_NERVE) / D_NERVE);
    nerveU.uGrow.value = body ? (grow <= 0 ? -1 : easeOut(grow) * (maxD + 0.2)) : -1;
    nerveU.uAlpha.value = body ? clamp01(grow * 3) : 0;
    brainLinkMat.opacity = (light ? 0.35 : 0.32) * clamp01((morph - 0.75) * 4) * (0.7 + 0.3 * Math.sin(time * 2.3));
    const beatT = (time * 0.62) % 1, b1 = Math.exp(-Math.pow(beatT / 0.09, 2)), b2 = Math.exp(-Math.pow((beatT - 0.3) / 0.08, 2)) * 0.45;
    heartU.uBeat.value = Math.max(b1, b2);
    heartU.uPhase.value = clamp01(beatT / 0.75);
    heartU.uAlpha.value = 0.75 * clamp01((T - T_FORMED + 0.4) / 0.8);
    // lobes: a hovered label lights its lobe; each lobe also flashes once as its label appears
    for (let i = 0; i < lobeK.length; i++) {
      const c = calls[i];
      const fl = c.flashT !== null ? Math.exp(-Math.pow((time - c.flashT - 0.3) / 0.42, 2)) * 0.8 : 0;
      const want = Math.max(hoverLobe === c.lobe ? 1 : 0, fl);
      lobeK[i] += (want - lobeK[i]) * Math.min(1, dt * 7);
    }
    bodyU.uFocus.value += ((hoverLobe >= 0 ? 1 : 0) - bodyU.uFocus.value) * Math.min(1, dt * 6);
    bodyU.uLk0.value.set(lobeK[0], lobeK[1], lobeK[2]);
    bodyU.uLk1.value.set(lobeK[3], lobeK[4], 0);

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
    const floorY = humGroup.position.y + PLAT_Y * cur.s;
    platform.rotation.x = Math.max(0, 0.2 - Math.atan2(-floorY, CAM_Z));
    orbit.rotation.y = time * 0.2;
    // keep the orbit reading as an ellipse when the figure sits above the eye line (phones)
    orbit.rotation.x = 0.32 + Math.atan2(humGroup.position.y + ORB_Y * cur.s, CAM_Z);
    const sp = sats.geometry.attributes.position;
    for (let i = 0; i < 3; i++) { const a = time * (0.6 + i * 0.17) + i * 2.1; sp.setXYZ(i, Math.cos(a) * ORB_R, 0, Math.sin(a) * ORB_R); }
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
    updateCallouts(dt);
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
