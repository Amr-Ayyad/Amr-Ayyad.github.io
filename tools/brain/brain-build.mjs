// Builds the hologram brain for the hero (assets/brain.bin, the binary format js/scene.js reads):
// SDF (hemispheres, lobes, sulci, folded cortex, cerebellum, brainstem) → surface nets →
// meshoptimizer → AO → fibre tracts (brainstem fountain, corpus callosum, association arcs).
//   npm i meshoptimizer@0.22.0 && node brain-build.mjs ../../assets/brain.bin [h=0.0075] [tris=60000]
//   (about 25 s; the shipped asset was built with h=0.0075 and 60000 triangles)
// Units: x = front (+) / back (-), y = up, z = right (+) / left (-).
import { writeFileSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const OUT = process.argv[2] || 'brain.bin';
const H = +(process.argv[3] || 0.0075);
const TARGET_TRIS = +(process.argv[4] || 60000);
const t0 = Date.now();

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function ell(x, y, z, c, r) {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}
function seg(x, y, z, a, b, r) {
  const pa = [x - a[0], y - a[1], z - a[2]], ba = V.sub(b, a);
  const h = clamp((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2), 0, 1);
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - (Array.isArray(r) ? r[0] + (r[1] - r[0]) * h : r);
}
// ── 3D gradient noise ──
const perm = new Uint8Array(512);
{ let s = 1234567; const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function noise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const g = (h, a, b, c) => { const q = G3[h % 12]; return q[0] * a + q[1] * b + q[2] * c; };
  const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi, B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(g(perm[AA], x, y, z), g(perm[BA], x - 1, y, z), u), l(g(perm[AB], x, y - 1, z), g(perm[BB], x - 1, y - 1, z), u), v),
    l(l(g(perm[AA + 1], x, y, z - 1), g(perm[BA + 1], x - 1, y, z - 1), u), l(g(perm[AB + 1], x, y - 1, z - 1), g(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}

// ── the brain ──
// centred ellipsoid helpers
function ellp(px, py, pz, rx, ry, rz) {
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k0 = Math.hypot(qx, qy, qz), k1 = Math.hypot(qx / rx, qy / ry, qz / rz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
// ellipsoid whose long axis is tilted in the x/y plane by angle a (radians, + = front up)
function ellR(x, y, z, c, r, a) {
  const dx = x - c[0], dy = y - c[1], ca = Math.cos(a), sa = Math.sin(a);
  return ellp(dx * ca + dy * sa, -dx * sa + dy * ca, z - c[2], r[0], r[1], r[2]);
}
const segXY = (x, y, a, b) => {
  const px = x - a[0], py = y - a[1], bx = b[0] - a[0], by = b[1] - a[1];
  const h = clamp((px * bx + py * by) / (bx * bx + by * by), 0, 1);
  return Math.hypot(px - bx * h, py - by * h);
};
// carve a groove of half-width w and depth dp wherever g (distance to the groove's centre line) < w
const groove = (d, g, w, dp, k = 0.018) => smax(d, Math.min(w - g, d + dp), k);

const SYL_A = [0.62, -0.02], SYL_B = [-0.3, 0.27];
function upper(x, y, zz) {
  let d = ell(x, y, zz, [-0.08, 0.38, 0.3], [1.1, 0.64, 0.54]);
  d = smin(d, ell(x, y, zz, [0.54, 0.27, 0.27], [0.58, 0.58, 0.48]), 0.25);  // frontal (narrower)
  d = smin(d, ell(x, y, zz, [-0.5, 0.4, 0.4], [0.64, 0.62, 0.55]), 0.25);   // parietal (widest)
  d = smin(d, ell(x, y, zz, [-0.96, 0.22, 0.3], [0.32, 0.42, 0.38]), 0.2);   // occipital
  // flat base: orbital surface in front, tentorial surface at the back
  const fl = -0.05 + 0.13 * sstep(0.72, 1.2, x) + 0.08 * (1 - sstep(-1.32, -0.95, x));
  d = smax(d, fl - y, 0.1);
  return d;
}
function temporal(x, y, zz) {
  return ellR(x, y, zz, [-0.06, -0.15, 0.52], [0.72, 0.33, 0.35], -0.12);
}
function hemisphere(x, y, z) {
  const zz = Math.abs(z);
  let d = upper(x, y, zz);
  const kT = 0.035 + 0.26 * (1 - sstep(-0.7, 0.0, x));
  d = smin(d, temporal(x, y, zz), kT);
  // lateral (sylvian) fissure
  const lat = sstep(0.28, 0.5, zz);
  if (lat > 0) d = groove(d, segXY(x, y, SYL_A, SYL_B), 0.028 * lat, 0.12 * lat);
  // central sulcus: a gently wavy band running from the crown down to the fissure
  if (y > 0.2 && zz > 0.03) {
    const cs = x * 0.962 + y * 0.274 - 0.274 + 0.012 * zz + 0.05 * noise(y * 4.2 + 4.2, zz * 4.2, x * 2 + (z > 0 ? 0 : 9));
    const fade = sstep(0.2, 0.34, y - (SYL_A[1] + (SYL_B[1] - SYL_A[1]) * clamp((x - SYL_A[0]) / (SYL_B[0] - SYL_A[0]), 0, 1)));
    if (fade > 0) d = groove(d, Math.abs(cs), 0.017 * fade, 0.06 * fade);
  }
  // medial surface (longitudinal fissure), with rounded lips
  d = smax(d, 0.014 - zz, 0.05);
  return d;
}
// approximate distance to the nearest sulcus: zero set of a domain-warped noise field
function sulcusDist(x, y, z) {
  const Fw = 1.6, Wp = 0.17, F = 3.9;
  const wx = x + Wp * noise(x * Fw + 11.3, y * Fw + 2.1, z * Fw + 5.7);
  const wy = y + Wp * noise(x * Fw + 3.4, y * Fw + 17.9, z * Fw + 1.2);
  const wz = z + Wp * noise(x * Fw + 7.7, y * Fw + 4.4, z * Fw + 13.1);
  const n = noise(wx * F, wy * F, wz * F), e = 0.004;
  const gx = noise((wx + e) * F, wy * F, wz * F) - n, gy = noise(wx * F, (wy + e) * F, wz * F) - n, gz = noise(wx * F, wy * F, (wz + e) * F) - n;
  const gl = Math.hypot(gx, gy, gz) / e;
  return Math.abs(n) / Math.max(gl, 0.6);
}
function cerebellum(x, y, z) {
  const cx = -0.66, cy = -0.4;
  let d = 1e9;
  for (const s of [-1, 1]) d = smin(d, ell(x, y, z, [cx, cy, 0.3 * s], [0.38, 0.25, 0.4]), 0.15);
  d = smin(d, ell(x, y, z, [cx - 0.05, cy + 0.01, 0], [0.36, 0.24, 0.16]), 0.1);       // vermis
  // folia: thin lamellae fanning back from the peduncles (front of the cerebellum)
  const th = Math.atan2(y - cy, -(x + 0.3));
  const f = Math.sin(th * 52 + 0.5 * noise(x * 3, y * 3, z * 3));
  d += 0.012 * sstep(0.4, 1.0, f);
  // horizontal fissure
  d = groove(d, Math.abs(th + 0.06) * Math.hypot(x + 0.3, y - cy), 0.012, 0.045);
  return d;
}
function stem(x, y, z) {
  let d = seg(x, y, z, [-0.14, -0.04, 0], [-0.22, -0.45, 0], [0.15, 0.15]);
  d = smin(d, seg(x, y, z, [-0.22, -0.45, 0], [-0.36, -0.96, 0], [0.14, 0.1]), 0.06);
  d = smin(d, ell(x, y, z, [-0.12, -0.4, 0], [0.17, 0.17, 0.24]), 0.08); // pons bulges forward
  return d;
}
const FOLD_W = 0.088, FOLD_D = 0.046;
function cerebrum(x, y, z) {
  let c = hemisphere(x, y, z);
  if (c > -0.085 && c < 0.085) {
    const fade = sstep(-0.66, -0.5, y) * (1 - 0.7 * sstep(0.03, 0.0, Math.abs(z)));
    if (fade > 0) { const g = 1 - Math.min(sulcusDist(x, y, z) / FOLD_W, 1); c += FOLD_D * g * g * fade; }
  }
  return c;
}
function sdf(x, y, z) {
  let d = smin(cerebrum(x, y, z), cerebellum(x, y, z), 0.03);
  d = smin(d, stem(x, y, z), 0.07);
  return d;
}

// ── sample grid (narrow band) ──
const X0 = -1.4, X1 = 1.3, Y0 = -1.1, Y1 = 1.14, Z0 = -1.1, Z1 = 1.1;
const nx = Math.ceil((X1 - X0) / H) + 1, ny = Math.ceil((Y1 - Y0) / H) + 1, nz = Math.ceil((Z1 - Z0) / H) + 1;
const HC = 0.03, cx = Math.ceil((X1 - X0) / HC) + 1, cy = Math.ceil((Y1 - Y0) / HC) + 1, cz = Math.ceil((Z1 - Z0) / HC) + 1;
const coarse = new Float32Array(cx * cy * cz);
for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) coarse[i + cx * (j + cy * k)] = sdf(X0 + i * HC, Y0 + j * HC, Z0 + k * HC);
const field = new Float32Array(nx * ny * nz);
let exact = 0;
for (let k = 0; k < nz; k++) {
  const z = Z0 + k * H, ck = Math.min(cz - 1, Math.round((z - Z0) / HC));
  for (let j = 0; j < ny; j++) {
    const y = Y0 + j * H, cj = Math.min(cy - 1, Math.round((y - Y0) / HC));
    for (let i = 0; i < nx; i++) {
      const x = X0 + i * H, ci = Math.min(cx - 1, Math.round((x - X0) / HC));
      const c = coarse[ci + cx * (cj + cy * ck)];
      if (Math.abs(c) > HC * 2.6) { field[i + nx * (j + ny * k)] = c; continue; }
      field[i + nx * (j + ny * k)] = sdf(x, y, z);
      exact++;
    }
  }
}
console.log('grid', nx, ny, nz, 'exact evals', exact, ((Date.now() - t0) / 1000).toFixed(1) + 's');

// ── surface nets ──
const idx = (i, j, k) => i + nx * (j + ny * k);
const cellVert = new Int32Array(nx * ny * nz).fill(-1);
const verts = [];
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const cv = new Float32Array(8);
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  let mask = 0;
  for (let c = 0; c < 8; c++) { const o = CORNERS[c]; const v = field[idx(i + o[0], j + o[1], k + o[2])]; cv[c] = v; if (v < 0) mask |= 1 << c; }
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const va = cv[a], vb = cv[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb), A = CORNERS[a], B = CORNERS[b];
    sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
  }
  cellVert[idx(i, j, k)] = verts.length / 3;
  verts.push(X0 + (i + sx / n) * H, Y0 + (j + sy / n) * H, Z0 + (k + sz / n) * H);
}
const tris = [];
const quad = (a, b, c, d, flip) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d);
};
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const v0 = field[idx(i, j, k)] < 0;
  if (i < nx - 1 && v0 !== (field[idx(i + 1, j, k)] < 0))
    quad(cellVert[idx(i, j - 1, k - 1)], cellVert[idx(i, j, k - 1)], cellVert[idx(i, j, k)], cellVert[idx(i, j - 1, k)], !v0);
  if (j < ny - 1 && v0 !== (field[idx(i, j + 1, k)] < 0))
    quad(cellVert[idx(i - 1, j, k - 1)], cellVert[idx(i - 1, j, k)], cellVert[idx(i, j, k)], cellVert[idx(i, j, k - 1)], !v0);
  if (k < nz - 1 && v0 !== (field[idx(i, j, k + 1)] < 0))
    quad(cellVert[idx(i - 1, j - 1, k)], cellVert[idx(i, j - 1, k)], cellVert[idx(i, j, k)], cellVert[idx(i - 1, j, k)], !v0);
}
console.log('raw mesh', verts.length / 3, 'verts', tris.length / 3, 'tris', ((Date.now() - t0) / 1000).toFixed(1) + 's');

const grad = (x, y, z, e = 0.0015) => {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
};
const pos = new Float32Array(verts);
for (let v = 0; v < pos.length / 3; v++) {
  let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  for (let it = 0; it < 3; it++) {
    const d = sdf(x, y, z);
    if (Math.abs(d) < 2e-4) break;
    const g = grad(x, y, z);
    const step = Math.max(-H, Math.min(H, d));
    x -= g[0] * step; y -= g[1] * step; z -= g[2] * step;
  }
  pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
}

await MeshoptSimplifier.ready;
const [simp, err] = MeshoptSimplifier.simplify(new Uint32Array(tris), pos, 3, TARGET_TRIS * 3, 0.0012, []);
const [remap, nUnique] = MeshoptSimplifier.compactMesh(simp);
console.log('simplified', simp.length / 3, 'tris', nUnique, 'verts', 'err', err.toFixed(5));
const outPos = new Float32Array(nUnique * 3);
for (let old = 0; old < remap.length; old++) { const nw = remap[old]; if (nw === 0xffffffff) continue; outPos[nw * 3] = pos[old * 3]; outPos[nw * 3 + 1] = pos[old * 3 + 1]; outPos[nw * 3 + 2] = pos[old * 3 + 2]; }
const nrm = new Float32Array(nUnique * 3), ao = new Float32Array(nUnique);
for (let v = 0; v < nUnique; v++) {
  const x = outPos[v * 3], y = outPos[v * 3 + 1], z = outPos[v * 3 + 2];
  const g = grad(x, y, z);
  nrm[v * 3] = g[0]; nrm[v * 3 + 1] = g[1]; nrm[v * 3 + 2] = g[2];
  let occ = 0;
  for (let s = 1; s <= 5; s++) {
    const dd = 0.012 * s;
    occ += (dd - sdf(x + g[0] * dd, y + g[1] * dd, z + g[2] * dd)) / Math.pow(2, s - 1);
  }
  ao[v] = Math.max(0, Math.min(1, 1 - occ * 7));
}

// ── fibre tracts ──
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const inside = (p, margin) => {
  let q = p;
  for (let it = 0; it < 6; it++) {
    const d = sdf(q[0], q[1], q[2]);
    if (d < -margin) break;
    const g = grad(q[0], q[1], q[2]);
    q = V.sub(q, V.mul(g, d + margin));
  }
  return q;
};
const catmull = (pts, step) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = V.len(V.sub(p2, p1)), n = Math.max(2, Math.ceil(L / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};
// a point on the cortex in a given direction, just under the surface (marching out from inside its hemisphere)
const CEN = [-0.05, 0.3, 0];
function cortexPoint(dir, depth) {
  let p = V.add([CEN[0], CEN[1], 0.3 * Math.sign(dir[2] || 1)], V.mul(dir, 0.05));
  for (let it = 0; it < 120; it++) { if (sdf(p[0], p[1], p[2]) > 0) break; p = V.add(p, V.mul(dir, 0.015)); }
  return inside(p, depth);
}
function castOut(from, dir) {
  let p = from;
  const dn = V.norm(dir);
  for (let i = 0; i < 300; i++) { if (sdf(p[0], p[1], p[2]) > 0) break; p = V.add(p, V.mul(dn, 0.006)); }
  return inside(p, 0.0);
}
const T = []; // { pts, parent }
const add = (pts, parent = -1) => { T.push({ pts, parent }); return T.length - 1; };
const ROOT = [-0.36, -0.95, 0], THAL = [-0.1, 0.05, 0];
const trunk = add([ROOT, [-0.31, -0.7, 0], [-0.24, -0.42, 0], [-0.16, -0.16, 0], THAL]);
for (const s of [-1, 1]) {
  // internal capsule: a band running front to back, through which the corona radiata fans out
  const capF = [0.24, 0.12, 0.18 * s], capB = [-0.42, 0.1, 0.26 * s], capM = V.lerp(capF, capB, 0.5);
  const capT = add([THAL, [-0.07, 0.1, 0.1 * s], capM], trunk);
  const NF = 18;
  for (let i = 0; i < NF; i++) {
    const t = i / (NF - 1);
    const a = 1.25 - t * 2.6;
    const el = 0.3 + 0.7 * rnd();
    const dir = V.norm([Math.sin(a) * 1.15, 0.45 + 0.6 * Math.cos(a * 0.85), s * (0.25 + 0.8 * el)]);
    const end = cortexPoint(dir, 0.04);
    const cp = V.lerp(capF, capB, t);
    const mid = inside(V.add(V.lerp(cp, end, 0.5), [0, 0.05, 0.05 * s]), 0.08);
    add([capM, cp, mid, end], capT);
  }
  // arcuate fasciculus: frontal ↔ temporal, curving round the end of the lateral fissure
  for (let i = 0; i < 3; i++) {
    const zz = s * (0.5 + i * 0.06);
    add([[0.5 - i * 0.04, 0.3 + i * 0.05, zz], [0.05, 0.42 + i * 0.04, zz], [-0.38, 0.36 + i * 0.03, zz], [-0.52, 0.08, zz], [-0.28, -0.2 - i * 0.03, zz], [0.25, -0.22, zz]].map((q) => inside(q, 0.07)), capT);
  }
  // superior longitudinal fasciculus: frontal ↔ occipital
  for (let i = 0; i < 3; i++) {
    const zz = s * (0.34 + i * 0.1), yy = 0.5 + i * 0.06;
    add([[0.78 - i * 0.06, yy - 0.1, zz], [0.2, yy + 0.08, zz], [-0.4, yy + 0.06, zz], [-0.98 + i * 0.06, yy - 0.22, zz]].map((q) => inside(q, 0.07)), capT);
  }
  // optic radiation: thalamus → occipital pole
  for (let i = 0; i < 4; i++) {
    const zz = s * (0.26 + i * 0.05);
    add([[-0.18, 0.04, 0.16 * s], [-0.45, 0.0 + i * 0.03, zz + 0.1 * s], [-0.8, 0.1 + i * 0.05, zz], [-1.1, 0.2 + i * 0.04, zz * 0.8]].map((q) => inside(q, 0.05)), trunk);
  }
  // cerebellar peduncles fanning into the cerebellum
  for (let i = 0; i < 6; i++) {
    const ang = -0.9 + i * 0.36;
    const e = inside([-0.66 - Math.cos(ang) * 0.3, -0.42 + Math.sin(ang) * 0.17, s * (0.22 + 0.07 * i)], 0.04);
    add([[-0.22, -0.45, 0.06 * s], [-0.42, -0.42, 0.2 * s], e], trunk);
  }
}
// corpus callosum: arches joining the hemispheres over the thalamus
for (let i = 0; i < 10; i++) {
  const u = i / 9, x = 0.52 - u * 1.12;
  const mid = [x * 0.7, 0.4 + 0.06 * Math.sin(u * Math.PI), 0];
  const st = add([THAL, V.lerp(THAL, mid, 0.5), mid], trunk);
  // the arches fan forwards at the front and backwards at the back (forceps minor / major)
  const fan = (u - 0.5) * 2, fx = x * 0.9 + Math.sign(fan) * fan * fan * 0.9;
  for (const s of [-1, 1]) {
    const end = cortexPoint(V.norm([fx, 0.75, 0.75 * s]), 0.04);
    const c1 = inside([mid[0] + (end[0] - mid[0]) * 0.25, mid[1] + 0.12, s * 0.22], 0.07);
    add([mid, c1, inside(V.add(V.lerp(mid, end, 0.65), [0, 0.06, 0]), 0.07), end], st);
  }
}
const samples = [];
const segs = [];
for (let b = 0; b < T.length; b++) {
  const br = T[b];
  let base = 0;
  if (br.parent >= 0) {
    const ps = samples[br.parent], start = br.pts[0];
    let best = 0, bd = 1e9;
    for (let i = 0; i < ps.length; i++) { const dd = V.len(V.sub(ps[i].p, start)); if (dd < bd) { bd = dd; best = i; } }
    base = ps[best].d + bd;
  }
  const pts = catmull(br.pts, 0.014);
  const S = [];
  let acc = base;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += V.len(V.sub(pts[i], pts[i - 1]));
    S.push({ p: pts[i], d: acc });
    if (i) segs.push(...pts[i - 1], S[i - 1].d, ...pts[i], acc);
  }
  samples.push(S);
  // small branching twigs at the far ends
  if (br.parent >= 0 && S.length > 8) {
    const endS = S[S.length - 1];
    for (let t = 0; t < 3; t++) {
      let prev = endS.p, pd = endS.d;
      const dir = V.norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
      for (let st = 0; st < 3; st++) {
        const nxt = inside(V.add(prev, V.mul(V.norm(V.add(dir, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5])), 0.022)), 0.02);
        const nd = pd + V.len(V.sub(nxt, prev));
        segs.push(...prev, pd, ...nxt, nd);
        prev = nxt; pd = nd;
      }
    }
  }
}
const nSeg = segs.length / 8;
console.log('tract segments', nSeg);

// label anchors on the right hemisphere (the page mirrors z to whichever side faces the viewer)
const anchors = {
  brain: CEN, heart: THAL,
  frontal: castOut([0.5, 0.45, 0.3], [0.55, 0.45, 0.7]),
  parietal: castOut([-0.45, 0.6, 0.35], [-0.3, 0.8, 0.5]),
  occipital: castOut([-0.9, 0.25, 0.3], [-0.9, 0.1, 0.45]),
  temporal: castOut([0.46, -0.16, 0.5], [0.3, -0.32, 1]),
  cerebellum: castOut([-0.66, -0.42, 0.3], [-0.55, -0.3, 0.8]),
  root: ROOT,
};
for (const k in anchors) anchors[k] = anchors[k].map((v) => +v.toFixed(4));

// lobe of every vertex: 0 frontal, 1 parietal, 2 occipital, 3 temporal, 4 cerebellum, 5 brainstem
const lobe = new Uint8Array(nUnique);
for (let v = 0; v < nUnique; v++) {
  const x = outPos[v * 3], y = outPos[v * 3 + 1], z = outPos[v * 3 + 2], zz = Math.abs(z);
  const dc = cerebrum(x, y, z), db = cerebellum(x, y, z), ds = stem(x, y, z);
  let L;
  if (ds < dc - 0.004 && ds < db - 0.004) L = 5;
  else if (db < dc) L = 4;
  else {
    const occX = -0.7 - ((1.0 - y) / 1.25) * 0.22;
    if (x < occX) L = 2;
    else if (temporal(x, y, zz) < upper(x, y, zz) && (zz > 0.2 || y < -0.06)) L = 3;
    else if (x * 0.962 + y * 0.274 - 0.274 > 0) L = 0;
    else L = 1;
  }
  lobe[v] = L;
}
const lc = [0, 0, 0, 0, 0, 0]; for (const L of lobe) lc[L]++;
console.log('lobes', lc.join(' '));

const nv = nUnique, ni = simp.length;
const i16 = nv < 65536;
const meta = { v: 1, nv, ni, nSeg, i16, posScale: 1 / 16000, maxD: Math.max(...segs.filter((_, i) => i % 4 === 3)), anchors, lobes: ['frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'] };
const pad4 = (n) => (n + 3) & ~3;
let json = new TextEncoder().encode(JSON.stringify(meta));
const core = (jl) => 12 + pad4(jl) + pad4(nv * 6) + pad4(nv * 3) + pad4(nv) + pad4(ni * (i16 ? 2 : 4)) + pad4(nSeg * 2 * 6) + pad4(nSeg * 2 * 2);
// the lobe table follows the standard sections; its offset is stored in the header JSON
for (let it = 0; it < 3; it++) { meta.lobeOff = core(json.length); json = new TextEncoder().encode(JSON.stringify(meta)); }
const bytes = meta.lobeOff + pad4(nv);
const buf = new ArrayBuffer(bytes), dv = new DataView(buf);
let o = 0;
dv.setUint32(o, 0x59444f42, true); o += 4;
dv.setUint32(o, 1, true); o += 4;
dv.setUint32(o, json.length, true); o += 4;
new Uint8Array(buf, o, json.length).set(json); o += pad4(json.length);
const q16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 16000)));
{ const a = new Int16Array(buf, o, nv * 3); for (let i = 0; i < nv * 3; i++) a[i] = q16(outPos[i]); o += pad4(nv * 6); }
{ const a = new Int8Array(buf, o, nv * 3); for (let i = 0; i < nv * 3; i++) a[i] = Math.round(nrm[i] * 127); o += pad4(nv * 3); }
{ const a = new Uint8Array(buf, o, nv); for (let i = 0; i < nv; i++) a[i] = Math.round(ao[i] * 255); o += pad4(nv); }
{ const a = i16 ? new Uint16Array(buf, o, ni) : new Uint32Array(buf, o, ni); a.set(simp); o += pad4(ni * (i16 ? 2 : 4)); }
{ const a = new Int16Array(buf, o, nSeg * 2 * 3); for (let s = 0; s < nSeg * 2; s++) { a[s * 3] = q16(segs[s * 4]); a[s * 3 + 1] = q16(segs[s * 4 + 1]); a[s * 3 + 2] = q16(segs[s * 4 + 2]); } o += pad4(nSeg * 2 * 6); }
{ const a = new Uint16Array(buf, o, nSeg * 2); for (let s = 0; s < nSeg * 2; s++) a[s] = Math.round((segs[s * 4 + 3] / meta.maxD) * 65535); o += pad4(nSeg * 2 * 2); }
if (o !== meta.lobeOff) throw new Error('lobe offset mismatch ' + o + ' ' + meta.lobeOff);
new Uint8Array(buf, o, nv).set(lobe);
writeFileSync(OUT, new Uint8Array(buf));
console.log('wrote', OUT, (bytes / 1024).toFixed(0) + 'KB', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(anchors));
