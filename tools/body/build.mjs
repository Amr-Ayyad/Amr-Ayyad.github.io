// Builds assets/body.bin: hologram body mesh (surface nets on the rig SDF,
// simplified with meshoptimizer) + baked AO + nervous-system polylines.
//   npm i meshoptimizer@0.22.0 && node build.mjs <out.bin> [h]
import { writeFileSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
const { buildBody, compile, nerveTree, anchors, V } = await import(process.env.RIG || './rig.mjs');

const OUT = process.argv[2] || 'body.bin';
const H = +(process.argv[3] || 0.0075);
const TARGET_TRIS = +(process.argv[4] || 36000);

const t0 = Date.now();
const prims = buildBody();
const sdf = compile(prims);
console.log('primitives', prims.length);

// ── sample grid (narrow band) ──
const X0 = -0.66, X1 = 0.66, Y0 = -1.785, Y1 = 1.785, Z0 = -0.32, Z1 = 0.46;
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

// project onto the true surface + normals
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

// ── simplify ──
await MeshoptSimplifier.ready;
const [simp, err] = MeshoptSimplifier.simplify(new Uint32Array(tris), pos, 3, TARGET_TRIS * 3, 0.0012, []);
const [remap, nUnique] = MeshoptSimplifier.compactMesh(simp);
console.log('simplified', simp.length / 3, 'tris', nUnique, 'verts', 'err', err.toFixed(5));
// compactMesh rewrites simp in place to new indices and returns old->new remap
const outPos = new Float32Array(nUnique * 3);
for (let old = 0; old < remap.length; old++) { const nw = remap[old]; if (nw === 0xffffffff) continue; outPos[nw * 3] = pos[old * 3]; outPos[nw * 3 + 1] = pos[old * 3 + 1]; outPos[nw * 3 + 2] = pos[old * 3 + 2]; }
const nrm = new Float32Array(nUnique * 3), ao = new Float32Array(nUnique);
for (let v = 0; v < nUnique; v++) {
  const x = outPos[v * 3], y = outPos[v * 3 + 1], z = outPos[v * 3 + 2];
  const g = grad(x, y, z);
  nrm[v * 3] = g[0]; nrm[v * 3 + 1] = g[1]; nrm[v * 3 + 2] = g[2];
  let occ = 0;
  for (let s = 1; s <= 5; s++) {
    const dd = 0.014 * s;
    occ += (dd - sdf(x + g[0] * dd, y + g[1] * dd, z + g[2] * dd)) / Math.pow(2, s - 1);
  }
  ao[v] = Math.max(0, Math.min(1, 1 - occ * 6));
}

// ── nerves ──
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const tree = nerveTree();
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
const inside = (p, margin) => {
  let q = p;
  for (let it = 0; it < 4; it++) {
    const d = sdf(q[0], q[1], q[2]);
    if (d < -margin) break;
    const g = grad(q[0], q[1], q[2]);
    q = V.sub(q, V.mul(g, d + margin));
  }
  return q;
};
const samples = []; // per branch: [{p, d}]
const segs = []; // flat: x,y,z,d, x,y,z,d
for (let b = 0; b < tree.length; b++) {
  const br = tree[b];
  let base = 0;
  if (br.parent >= 0) {
    const ps = samples[br.parent], start = br.pts[0];
    let best = 0, bd = 1e9;
    for (let i = 0; i < ps.length; i++) { const dd = V.len(V.sub(ps[i].p, start)); if (dd < bd) { bd = dd; best = i; } }
    base = ps[best].d + bd;
  }
  const pts = catmull(br.pts, 0.012).map((p) => inside(p, 0.016));
  const S = [];
  let acc = base;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += V.len(V.sub(pts[i], pts[i - 1]));
    S.push({ p: pts[i], d: acc });
    if (i) segs.push(...pts[i - 1], S[i - 1].d, ...pts[i], acc);
  }
  samples.push(S);
  // organic twigs
  for (let i = 6; i < S.length - 3; i += 7 + ((rnd() * 6) | 0)) {
    if (rnd() < 0.35) continue;
    const dir = V.norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
    let prev = S[i].p, pd = S[i].d;
    const n = 3 + ((rnd() * 4) | 0);
    for (let s = 0; s < n; s++) {
      const nxt = inside(V.add(prev, V.mul(V.norm(V.add(dir, [rnd() * 0.8 - 0.4, rnd() * 0.8 - 0.4, rnd() * 0.8 - 0.4])), 0.014)), 0.012);
      const nd = pd + V.len(V.sub(nxt, prev));
      segs.push(...prev, pd, ...nxt, nd);
      prev = nxt; pd = nd;
    }
  }
}
const nSeg = segs.length / 8;
console.log('nerve segments', nSeg);

// ── write ──
const nv = nUnique, ni = simp.length;
const i16 = nv < 65536;
const meta = { v: 1, nv, ni, nSeg, i16, posScale: 1 / 16000, maxD: Math.max(...segs.filter((_, i) => i % 4 === 3)), anchors: anchors() };
const json = new TextEncoder().encode(JSON.stringify(meta));
const pad4 = (n) => (n + 3) & ~3;
const bytes = 12 + pad4(json.length) + pad4(nv * 6) + pad4(nv * 3) + pad4(nv) + pad4(ni * (i16 ? 2 : 4)) + pad4(nSeg * 2 * 6) + pad4(nSeg * 2 * 2);
const buf = new ArrayBuffer(bytes), dv = new DataView(buf);
let o = 0;
dv.setUint32(o, 0x59444f42, true); o += 4; // 'BODY'
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
writeFileSync(OUT, new Uint8Array(buf));
console.log('wrote', OUT, (bytes / 1024).toFixed(0) + 'KB', ((Date.now() - t0) / 1000).toFixed(1) + 's');
