// ─────────────────────────────────────────────────────────────
//  Procedural human, v2: smooth lofted cross-sections.
//  Each body part is a loft (a stack of superelliptic sections along an
//  axis, Hermite-interpolated) with gentle anatomical relief added as
//  angular/axial bumps. Parts are blended with smooth unions.
//  Units: 175 cm figure = 3.5 units, floor at y = -1.75, facing +z.
//  The figure's LEFT side is +x (it faces the camera).
// ─────────────────────────────────────────────────────────────
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
export { V };
const PI = Math.PI, H2 = Math.PI / 2;
const wrap = (a) => a - 2 * PI * Math.round(a / (2 * PI));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const band = (y, y0, y1, e) => sstep(y0 - e, y0 + e, y) * (1 - sstep(y1 - e, y1 + e, y));

// ── posed skeleton: a square, confident male stance ──
// feet a little apart and turned out, weight on both legs, level hips and shoulders,
// arms hanging slightly away from the body
export const J = {
  hipR: [-0.172, 0.05, 0.0], hipL: [0.172, 0.05, 0.0],
  kneeR: [-0.192, -0.79, 0.03], kneeL: [0.192, -0.79, 0.03],
  ankleR: [-0.218, -1.59, -0.03], ankleL: [0.218, -1.59, -0.03],
  heelR: [-0.218, -1.692, -0.105], toeR: [-0.288, -1.716, 0.37],
  heelL: [0.218, -1.692, -0.105], toeL: [0.288, -1.716, 0.37],
  pelvis: [0.0, 0.1, -0.008],
  waist: [0.0, 0.42, 0.0],
  chest: [0.0, 0.83, -0.006],
  shR: [-0.39, 1.12, -0.03], shL: [0.39, 1.12, -0.03],
  neckBase: [0.0, 1.165, -0.045], neckTop: [0.0, 1.395, -0.015],
  head: [0.0, 1.5, 0.006],
  elbowR: [-0.48, 0.45, -0.065], wristR: [-0.535, -0.06, 0.0],
  elbowL: [0.48, 0.45, -0.06], wristL: [0.535, -0.06, 0.012],
};
const HEAD_ROT = { yaw: 0.03, pitch: 0.012, roll: 0.0 };

// ── Hermite tables ──
function mkTable(rows, tension = 0.8) {
  rows = [...rows].sort((a, b) => a[0] - b[0]);
  const n = rows.length, k = rows[0].length - 1;
  const T = rows.map((r) => r[0]), Vv = rows.map((r) => r.slice(1));
  const M = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    M.push(Vv[i].map((_, j) => (i === 0 || i === n - 1 ? 0 : (tension * (Vv[i1][j] - Vv[i0][j])) / (T[i1] - T[i0]))));
  }
  return { T, V: Vv, M, n, k, t0: T[0], t1: T[n - 1] };
}
function evalTable(tb, t, out) {
  const { T, V: Vv, M, n, k } = tb;
  if (t <= T[0]) { for (let j = 0; j < k; j++) out[j] = Vv[0][j]; return; }
  if (t >= T[n - 1]) { for (let j = 0; j < k; j++) out[j] = Vv[n - 1][j]; return; }
  let i = 0;
  while (t > T[i + 1]) i++;
  const h = T[i + 1] - T[i], s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const A = Vv[i], B = Vv[i + 1], MA = M[i], MB = M[i + 1];
  for (let j = 0; j < k; j++) out[j] = h00 * A[j] + h10 * h * MA[j] + h01 * B[j] + h11 * h * MB[j];
}
// superellipse radius in direction (c, s): +x half-width wp, -x wn, +z f, -z b
function seRadius(c, s, wp, wn, f, b, n) {
  const u = Math.abs(c) / (c >= 0 ? wp : wn), v = Math.abs(s) / (s >= 0 ? f : b);
  if (n === 2) return 1 / Math.sqrt(u * u + v * v);
  return 1 / Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);
}
// relief: gaussian bumps in (phi, axial) space; phi may depend on the axial coordinate
function relief(B, phi, y) {
  let r = 0;
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (b.fn) { r += b.fn(phi, y); continue; }
    let gy;
    if (b.band) { gy = band(y, b.band[0], b.band[1], b.e || 0.04); if (gy <= 0) continue; }
    else { const dy = (y - b.y) / (y < b.y ? b.syLo || b.sy : b.syHi || b.sy); if (dy * dy > 9) continue; gy = Math.exp(-dy * dy); }
    const p0 = typeof b.phi === 'function' ? b.phi(y) : b.phi;
    const dp = wrap(phi - p0) / b.sp;
    if (dp * dp > 9) continue;
    r += b.amp * gy * Math.exp(-dp * dp);
  }
  return r;
}
// radial distance to a loft surface, divided by the local slope so it behaves like a true distance
function loftDist(rho, rp, u, w, t, t0, t1, scale, radiusAt) {
  const phi = Math.atan2(w, u), c = u / rp, s = w / rp;
  const r = radiusAt(c, s, phi, t);
  if (t <= t0 || t >= t1) return rho - r;
  const e = 0.004 / scale, t2 = t + e <= t1 ? t + e : t - e;
  const gT = ((radiusAt(c, s, phi, t2) - r) / (t2 - t)) / scale;
  const dp = 0.02, rP = radiusAt(Math.cos(phi + dp), Math.sin(phi + dp), phi + dp, t);
  const gP = (rP - r) / (dp * Math.max(rp, 0.02));
  return (rho - r) / Math.sqrt(1 + gT * gT + gP * gP);
}
const mirror = (list) => list.flatMap((b) => [{ ...b, phi: b.phi }, { ...b, phi: typeof b.phi === 'function' ? (y) => PI - b.phi(y) : PI - b.phi }]);

// limb loft along a straight axis a→b. rows: [t, lateral, medial, front, back, n]
function limb(a, b, side, rows, B = null, fwd = [0, 0, 1]) {
  const Y = V.norm(V.sub(b, a)), L = V.len(V.sub(b, a));
  const lat = V.norm(V.sub([side, 0, 0], V.mul(Y, side * Y[0])));
  let Z = V.sub(fwd, V.add(V.mul(Y, V.dot(fwd, Y)), V.mul(lat, V.dot(fwd, lat))));
  Z = V.norm(Z);
  const tb = mkTable(rows), row = new Float64Array(5);
  const radiusAt = (c, s, phi, t) => {
    evalTable(tb, t, row);
    let r = seRadius(c, s, row[0], row[1], row[2], row[3], row[4]);
    if (B) r += relief(B, phi, t);
    return r;
  };
  const fn = (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = (px * Y[0] + py * Y[1] + pz * Y[2]) / L;
    const tc = t < tb.t0 ? tb.t0 : t > tb.t1 ? tb.t1 : t;
    const qx = px - Y[0] * tc * L, qy = py - Y[1] * tc * L, qz = pz - Y[2] * tc * L;
    const u = qx * lat[0] + qy * lat[1] + qz * lat[2], w = qx * Z[0] + qy * Z[1] + qz * Z[2];
    const rho = Math.hypot(qx, qy, qz), rp = Math.hypot(u, w);
    if (rp < 1e-9) { evalTable(tb, tc, row); return rho - Math.min(row[0], row[1], row[2], row[3]); }
    return loftDist(rho, rp, u, w, tc, t < tb.t0 || t > tb.t1 ? tc : tb.t0, t < tb.t0 || t > tb.t1 ? tc : tb.t1, L, radiusAt);
  };
  let mr = 0;
  for (const r of rows) mr = Math.max(mr, r[1], r[2], r[3], r[4]);
  const bc = V.lerp(a, b, (tb.t0 + tb.t1) / 2), br = (L * (tb.t1 - tb.t0)) / 2 + mr + 0.04;
  return { fn, bc, br, axis: { a, b, Y, L, lat, Z } };
}

export function buildBody() {
  const P = [];
  const F = (o, k, tag) => P.push({ t: 'F', fn: o.fn, bc: o.bc, br: o.br, k, tag });
  const S = (c, r, k, tag = '') => P.push({ t: 'S', c, r, k, tag });
  const C = (a, b, r1, r2, k, tag = '') => P.push({ t: 'C', a, b, r1, r2, k, tag });
  const E = (c, r, B, k, tag = '') => P.push({ t: 'E', c, r, B, k, tag });

  // ── torso: horizontal sections, tilted to follow pelvis & shoulder lines ──
  const thP = Math.atan2(J.hipL[1] - J.hipR[1], J.hipL[0] - J.hipR[0]);
  const thC = Math.atan2(J.shL[1] - J.shR[1], J.shL[0] - J.shR[0]);
  //              y      cx     cz      w(+x)  w(-x)  front  back   n
  const TT = mkTable([
    [-0.15, 0.0, -0.014, 0.03, 0.03, 0.022, 0.024, 2.0],
    [-0.128, 0.0, -0.013, 0.085, 0.085, 0.052, 0.054, 2.0],
    [-0.098, 0.0, -0.012, 0.15, 0.15, 0.082, 0.092, 2.1],
    [-0.04, 0.0, -0.012, 0.262, 0.262, 0.13, 0.166, 2.4],
    [0.06, 0.0, -0.012, 0.286, 0.286, 0.15, 0.19, 2.6],
    [0.18, 0.0, -0.01, 0.283, 0.283, 0.166, 0.18, 2.6],
    [0.3, 0.0, -0.006, 0.281, 0.281, 0.18, 0.17, 2.5],
    [0.42, 0.0, -0.002, 0.284, 0.284, 0.188, 0.168, 2.45],
    [0.55, 0.0, -0.004, 0.297, 0.297, 0.197, 0.178, 2.5],
    [0.68, 0.0, -0.006, 0.318, 0.318, 0.215, 0.2, 2.6],
    [0.8, 0.0, -0.008, 0.338, 0.338, 0.236, 0.222, 2.75],
    [0.92, 0.0, -0.012, 0.345, 0.345, 0.232, 0.232, 2.9],
    [1.02, 0.0, -0.018, 0.336, 0.336, 0.198, 0.216, 3.0],
    [1.1, 0.0, -0.026, 0.308, 0.308, 0.142, 0.176, 2.8],
    [1.15, 0.0, -0.033, 0.255, 0.255, 0.104, 0.138, 2.4],
    [1.19, 0.0, -0.038, 0.205, 0.205, 0.094, 0.118, 2.2],
    [1.23, 0.0, -0.04, 0.16, 0.16, 0.092, 0.11, 2.0],
    [1.26, 0.0, -0.04, 0.142, 0.142, 0.09, 0.108, 2.0],
  ]);
  const TB = [
    ...[1, -1].map((sd) => ({ fn: (phi, y) => { // pecs: plate with a curved lower border
      const d = wrap(phi - (H2 - 0.56 * sd)) * sd; // >0 towards the armpit
      if (Math.abs(d) > 1.1) return 0;
      const yb = 0.762 + 0.1 * d * d + 0.03 * d;
      return 0.024 * sstep(yb - 0.02, yb + 0.03, y) * (1 - sstep(0.93, 1.08, y)) * Math.exp(-((d / 0.46) ** 2));
    } })),
    { phi: H2, sp: 0.12, band: [0.77, 0.98], e: 0.05, amp: -0.006 }, // sternum
    ...mirror([{ phi: H2 - 0.2, sp: 0.17, band: [0.26, 0.7], e: 0.07, amp: 0.008 }]), // rectus columns
    { phi: H2, sp: 0.1, band: [0.34, 0.7], e: 0.06, amp: -0.003 }, // linea alba
    ...[0.45, 0.545, 0.635].map((y) => ({ phi: H2, sp: 0.3, y, sy: 0.02, amp: -0.0035 })), // tendinous lines
    { phi: H2, sp: 0.075, y: 0.355, sy: 0.016, amp: -0.008 }, // navel
    ...mirror([{ phi: (y) => H2 - (0.24 + clamp((y + 0.02) / 0.27, 0, 1) * 0.72), sp: 0.13, band: [-0.02, 0.25], e: 0.05, amp: -0.005 }]), // inguinal V
    { phi: -H2, sp: 0.1, band: [0.2, 1.06], e: 0.06, amp: -0.01 }, // spine
    ...mirror([{ phi: -H2 + 0.26, sp: 0.14, band: [0.2, 0.72], e: 0.08, amp: 0.01 }]), // erectors
    ...mirror([{ phi: -H2 + 0.6, sp: 0.3, y: 0.95, sy: 0.075, amp: 0.01 }]), // scapulae
    ...mirror([{ phi: -0.42, sp: 0.32, y: 0.8, sy: 0.12, amp: 0.014 }]), // lats
    ...mirror([{ phi: -H2 + 0.55, sp: 0.42, y: 0.03, sy: 0.085, amp: 0.013 }]), // glutes
    { phi: -H2, sp: 0.075, band: [-0.09, 0.13], e: 0.05, amp: -0.018 }, // gluteal cleft
    ...mirror([{ phi: H2 - 0.75, sp: 0.38, y: 1.09, sy: 0.016, amp: 0.008 }]), // clavicles
    { phi: H2, sp: 0.1, y: 1.11, sy: 0.02, amp: -0.01 }, // suprasternal notch
  ];
  const trow = new Float64Array(7);
  const torsoR = (c, s, phi, y) => {
    evalTable(TT, y, trow);
    return seRadius(c, s, trow[2], trow[3], trow[4], trow[5], trow[6]) + relief(TB, phi, y);
  };
  const torso = (x, y, z) => {
    const th = thP + (thC - thP) * sstep(0.15, 0.85, y);
    const yy = y - x * Math.tan(th);
    const yc = clamp(yy, TT.t0, TT.t1);
    evalTable(TT, yc, trow);
    const dx = x - trow[0], dz = z - trow[1], dy = yy - yc;
    // (the section centre is taken at yc; radiusAt re-evaluates the table for the slope)
    const rp = Math.hypot(dx, dz), rho = Math.hypot(rp, dy);
    if (rp < 1e-9) return rho - Math.min(trow[2], trow[3], trow[4], trow[5]);
    const cl = yy !== yc;
    return loftDist(rho, rp, dx, dz, yc, cl ? yc : TT.t0, cl ? yc : TT.t1, 1, torsoR);
  };
  P.push({ t: 'F', fn: torso, bc: [0, 0.53, -0.01], br: 0.95, k: 0, tag: 'torso' });
  // a clean, neutral rounded crotch where the legs meet the torso
  E([0, -0.092, -0.006], [0.072, 0.066, 0.084], { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, 0.045, 'torso');

  // ── neck ──
  const neckA = [0.0, 1.12, -0.055], neckB = [0.0, 1.43, -0.016];
  F(limb(neckA, neckB, 1, [
    [0.0, 0.16, 0.16, 0.114, 0.14, 2.0],
    [0.2, 0.14, 0.14, 0.117, 0.13, 2.0],
    [0.5, 0.128, 0.128, 0.117, 0.124, 2.0],
    [0.8, 0.122, 0.122, 0.112, 0.118, 2.0],
    [1.0, 0.116, 0.116, 0.106, 0.112, 2.0],
  ], [
    ...mirror([{ phi: (t) => H2 - (0.25 + clamp(t, 0, 1) * 1.2), sp: 0.2, band: [0.08, 0.95], e: 0.08, amp: 0.011 }]), // sternocleidomastoid
    { phi: H2, sp: 0.16, y: 0.46, sy: 0.07, amp: 0.011 }, // larynx (Adam's apple)
  ]), 0.05, 'neck');

  // ── head (local frame, then posed) ──
  {
    const cy = Math.cos(HEAD_ROT.yaw), sy = Math.sin(HEAD_ROT.yaw);
    const cp = Math.cos(HEAD_ROT.pitch), sp = Math.sin(HEAD_ROT.pitch);
    const cr = Math.cos(HEAD_ROT.roll), sr = Math.sin(HEAD_ROT.roll);
    const Rz = (v) => [v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr, v[2]];
    const Rx = (v) => [v[0], v[1] * cp - v[2] * sp, v[1] * sp + v[2] * cp];
    const Ry = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    const R = (v) => Ry(Rx(Rz(v)));
    const HX = R([1, 0, 0]), HY = R([0, 1, 0]), HZ = R([0, 0, 1]), O = J.head;
    const W = (p) => V.add(O, R(p));
    //               y      cz      w      front  back   n
    const HT = mkTable([
      [0.2405, -0.03, 0.004, 0.004, 0.004, 2.0],
      [0.235, -0.03, 0.037, 0.041, 0.044, 2.0],
      [0.22, -0.029, 0.074, 0.08, 0.086, 2.0],
      [0.19, -0.028, 0.11, 0.12, 0.129, 2.05],
      [0.14, -0.026, 0.141, 0.155, 0.166, 2.15],
      [0.09, -0.025, 0.155, 0.17, 0.182, 2.25],
      [0.045, -0.024, 0.157, 0.176, 0.188, 2.3],
      [0.01, -0.022, 0.155, 0.174, 0.186, 2.3],
      [-0.03, -0.018, 0.151, 0.172, 0.176, 2.35],
      [-0.07, -0.01, 0.143, 0.166, 0.154, 2.4],
      [-0.11, 0.0, 0.136, 0.158, 0.132, 2.5],
      [-0.15, 0.016, 0.124, 0.147, 0.11, 2.55],
      [-0.18, 0.028, 0.106, 0.137, 0.094, 2.5],
      [-0.198, 0.035, 0.086, 0.12, 0.074, 2.4],
      [-0.212, 0.03, 0.068, 0.088, 0.058, 2.2],
      [-0.228, 0.018, 0.06, 0.062, 0.056, 2.0],
      [-0.3, 0.0, 0.05, 0.05, 0.05, 2.0],
    ]);
    const nose = (phi, y) => {
      if (y > 0.04 || y < -0.072) return 0;
      let a, s;
      if (y >= -0.045) {
        const u = clamp((0.035 - y) / 0.08, 0, 1);
        a = y > 0.035 ? 0.007 * (1 - (y - 0.035) / 0.005) : 0.007 + 0.037 * Math.pow(u, 1.6);
        s = 0.055 + 0.075 * u;
      } else {
        const u = (-0.045 - y) / 0.027;
        a = 0.044 * Math.max(0, 1 - u * u);
        s = 0.13 + 0.04 * u;
      }
      const dp = wrap(phi - H2) / s;
      return a * Math.exp(-dp * dp);
    };
    const HB = [
      { fn: nose },
      ...mirror([{ phi: H2 - 0.15, sp: 0.07, y: -0.058, sy: 0.012, amp: 0.011 }]), // nose wings
      ...mirror([{ phi: H2 - 0.3, sp: 0.3, y: 0.05, sy: 0.02, amp: 0.014 }]), // brow ridge
      { phi: H2, sp: 0.1, y: 0.045, sy: 0.02, amp: 0.009 }, // glabella
      ...mirror([{ phi: H2 - 0.36, sp: 0.18, y: 0.014, sy: 0.026, amp: -0.016 }]), // eye sockets
      ...mirror([{ phi: H2 - 0.37, sp: 0.11, y: 0.011, sy: 0.013, amp: 0.008 }]), // eyes / lids
      ...mirror([{ phi: H2 - 0.72, sp: 0.24, y: -0.022, sy: 0.028, amp: 0.009 }]), // cheekbones
      { phi: H2, sp: 0.17, y: -0.09, sy: 0.011, amp: 0.006 }, // upper lip
      { phi: H2, sp: 0.15, y: -0.112, sy: 0.011, amp: 0.0065 }, // lower lip
      { phi: H2, sp: 0.38, y: -0.168, sy: 0.026, amp: 0.016 }, // chin
      { phi: H2, sp: 0.22, y: -0.135, sy: 0.01, amp: -0.006 }, // mentolabial sulcus
      ...mirror([{ phi: H2 - 1.5, sp: 0.3, y: -0.13, sy: 0.035, amp: 0.013 }]), // jaw angle
      ...mirror([{ phi: H2 - 1.15, sp: 0.25, y: 0.07, sy: 0.04, amp: -0.005 }]), // temples
    ];
    const hrow = new Float64Array(5);
    const headR = (c, s, phi, y) => {
      evalTable(HT, y, hrow);
      return seRadius(c, s, hrow[1], hrow[1], hrow[2], hrow[3], hrow[4]) + relief(HB, phi, y);
    };
    const headFn = (x, y, z) => {
      const dx0 = x - O[0], dy0 = y - O[1], dz0 = z - O[2];
      const lx = dx0 * HX[0] + dy0 * HX[1] + dz0 * HX[2];
      const ly = dx0 * HY[0] + dy0 * HY[1] + dz0 * HY[2];
      const lz = dx0 * HZ[0] + dy0 * HZ[1] + dz0 * HZ[2];
      const yc = clamp(ly, HT.t0, HT.t1);
      evalTable(HT, yc, hrow);
      const dz = lz - hrow[0], dy = ly - yc;
      const rp = Math.hypot(lx, dz), rho = Math.hypot(rp, dy);
      if (rp < 1e-9) return rho - Math.min(hrow[1], hrow[2], hrow[3]);
      const cl = ly !== yc;
      return loftDist(rho, rp, lx, dz, yc, cl ? yc : HT.t0, cl ? yc : HT.t1, 1, headR);
    };
    P.push({ t: 'F', fn: headFn, bc: O, br: 0.32, k: 0.04, tag: 'head' });
    const hb = { X: HX, Y: HY, Z: HZ };
    for (const s of [-1, 1]) E(W([0.154 * s, -0.008, -0.03]), [0.018, 0.054, 0.033], hb, 0.014, 'head'); // ears
  }

  // ── arms ──
  for (const s of [-1, 1]) {
    const sh = s < 0 ? J.shR : J.shL, el = s < 0 ? J.elbowR : J.elbowL, wr = s < 0 ? J.wristR : J.wristL;
    const shJ = V.add(sh, [0, -0.03, 0]);
    const up = limb(shJ, el, s, [[0, 1, 1, 1, 1, 2]]).axis;
    // deltoid: rounded cap over the joint, tapering to its insertion
    const dc = V.add(V.add(shJ, V.mul(up.Y, 0.072)), V.add(V.mul(up.lat, 0.026), V.mul(up.Z, 0.004)));
    C(V.add(J.neckBase, [0.12 * s, 0.045, -0.04]), V.add(shJ, [-0.01 * s, 0.038, -0.014]), 0.078, 0.082, 0.065, 'torso'); // trapezius → acromion
    E(dc, [0.1, 0.15, 0.114], { X: up.lat, Y: up.Y, Z: up.Z }, 0.075, 'arm');
    F(limb(shJ, el, s, [
      [0.06, 0.088, 0.066, 0.092, 0.092, 2.0],
      [0.18, 0.112, 0.078, 0.108, 0.106, 2.1],
      [0.38, 0.1, 0.086, 0.113, 0.1, 2.1],
      [0.6, 0.088, 0.082, 0.104, 0.09, 2.1],
      [0.82, 0.076, 0.076, 0.084, 0.078, 2.1],
      [1.0, 0.068, 0.078, 0.066, 0.074, 2.1],
    ]), 0.025, 'arm');
    F(limb(el, wr, s, [
      [-0.04, 0.066, 0.072, 0.064, 0.072, 2.0],
      [0.14, 0.098, 0.09, 0.086, 0.084, 2.1],
      [0.32, 0.088, 0.082, 0.08, 0.077, 2.1],
      [0.58, 0.068, 0.064, 0.066, 0.062, 2.15],
      [0.84, 0.05, 0.048, 0.057, 0.053, 2.3],
      [1.0, 0.042, 0.042, 0.06, 0.055, 2.4],
    ]), 0.03, 'arm');
    hand(s, el, wr);
  }
  function hand(s, el, wr) {
    // palm faces the thigh (inward = -s on x), thumb towards the front (+z)
    let D = V.norm(V.sub(wr, el));
    D = V.norm(V.add(D, [0.06 * s, -0.25, 0.08]));
    const N = V.norm(V.sub([-s, 0, 0], V.mul(D, V.dot([-s, 0, 0], D))));
    const Wv = V.norm(V.cross(D, N));
    const Wf = V.dot(Wv, [0, 0, 1]) >= 0 ? Wv : V.mul(Wv, -1);
    const hb = { X: N, Y: D, Z: Wf };
    const P0 = V.add(wr, V.mul(D, 0.012));
    E(V.add(P0, V.mul(D, 0.106)), [0.033, 0.108, 0.086], hb, 0.03, 'hand'); // palm
    E(V.add(V.add(P0, V.mul(D, 0.066)), V.add(V.mul(Wf, 0.04), V.mul(N, 0.012))), [0.025, 0.05, 0.032], hb, 0.025, 'hand'); // thenar
    const fingers = [
      { w: 0.06, len: 0.168, r: 0.0208, c: 0.2 },
      { w: 0.02, len: 0.188, r: 0.0212, c: 0.26 },
      { w: -0.019, len: 0.178, r: 0.0204, c: 0.32 },
      { w: -0.057, len: 0.14, r: 0.0186, c: 0.4 },
    ];
    for (const f of fingers) {
      const base = V.add(V.add(P0, V.mul(D, 0.205)), V.mul(Wf, f.w));
      const c1 = V.norm(V.add(D, V.mul(N, Math.tan(f.c * 0.6))));
      const c2 = V.norm(V.add(D, V.mul(N, Math.tan(f.c * 1.5))));
      const m1 = V.add(base, V.mul(c1, f.len * 0.56));
      const tip = V.add(m1, V.mul(c2, f.len * 0.44));
      C(base, m1, f.r, f.r * 0.9, 0.012, 'hand');
      C(m1, tip, f.r * 0.9, f.r * 0.78, 0.01, 'hand');
    }
    const tb = V.add(V.add(V.add(P0, V.mul(D, 0.05)), V.mul(Wf, 0.054)), V.mul(N, 0.012));
    const t1 = V.add(tb, V.mul(V.norm(V.add(V.add(V.mul(D, 0.75), V.mul(Wf, 0.5)), V.mul(N, 0.3))), 0.072));
    const t2 = V.add(t1, V.mul(V.norm(V.add(V.add(V.mul(D, 0.9), V.mul(Wf, 0.1)), V.mul(N, 0.38))), 0.06));
    C(tb, t1, 0.023, 0.02, 0.016, 'hand');
    C(t1, t2, 0.02, 0.016, 0.01, 'hand');
  }

  // ── legs ──
  for (const s of [-1, 1]) {
    const hip = s < 0 ? J.hipR : J.hipL, kn = s < 0 ? J.kneeR : J.kneeL, an = s < 0 ? J.ankleR : J.ankleL;
    const heel = s < 0 ? J.heelR : J.heelL, toe = s < 0 ? J.toeR : J.toeL;
    F(limb(hip, kn, s, [
      [-0.12, 0.13, 0.1, 0.125, 0.14, 2.1],
      [0.0, 0.156, 0.135, 0.152, 0.16, 2.2],
      [0.16, 0.168, 0.15, 0.172, 0.158, 2.2],
      [0.36, 0.164, 0.138, 0.17, 0.148, 2.2],
      [0.56, 0.15, 0.122, 0.156, 0.132, 2.2],
      [0.73, 0.124, 0.114, 0.13, 0.11, 2.2],
      [0.87, 0.104, 0.114, 0.112, 0.094, 2.2],
      [1.0, 0.094, 0.098, 0.1, 0.088, 2.2],
    ], [
      { phi: H2, sp: 0.5, y: 0.42, sy: 0.22, amp: 0.007 }, // rectus femoris
      { phi: 0.45, sp: 0.4, y: 0.45, sy: 0.2, amp: 0.006 }, // vastus lateralis
      { phi: 2.55, sp: 0.38, y: 0.84, sy: 0.07, amp: 0.009 }, // vastus medialis
    ]), 0.05, 'leg');
    F(limb(kn, an, s, [
      [-0.06, 0.09, 0.094, 0.096, 0.086, 2.1],
      [0.06, 0.092, 0.098, 0.082, 0.104, 2.1],
      [0.24, 0.098, 0.108, 0.072, 0.138, 2.1],
      [0.42, 0.082, 0.088, 0.064, 0.112, 2.1],
      [0.6, 0.062, 0.065, 0.056, 0.074, 2.1],
      [0.8, 0.049, 0.049, 0.048, 0.054, 2.1],
      [0.94, 0.052, 0.054, 0.052, 0.05, 2.1],
      [1.03, 0.046, 0.046, 0.047, 0.046, 2.0],
    ], [
      { phi: H2, sp: 0.45, y: -0.015, sy: 0.05, amp: 0.012 }, // patella
      { phi: 0, sp: 0.4, y: 0.975, sy: 0.03, amp: 0.01 }, // lateral malleolus
      { phi: PI, sp: 0.4, y: 0.94, sy: 0.03, amp: 0.01 }, // medial malleolus
    ]), 0.03, 'leg');
    // foot
    const ball = V.lerp(heel, toe, 0.7);
    const fdir = V.norm(V.sub(toe, heel));
    const fx = V.norm(V.cross([0, 1, 0], fdir));
    const fb = { X: fx, Y: [0, 1, 0], Z: fdir };
    C(V.add(heel, [0, 0.012, 0]), ball, 0.056, 0.045, 0.04, 'foot');
    E(V.add(V.lerp(heel, ball, 0.48), [0, 0.038, 0]), [0.058, 0.053, 0.15], fb, 0.06, 'foot'); // instep
    E(V.add(ball, [0, 0.004, 0]), [0.067, 0.032, 0.058], fb, 0.04, 'foot'); // ball
    C(ball, V.add(toe, [0, 0.008, 0]), 0.039, 0.028, 0.03, 'foot'); // toes
    C(V.add(an, [0, -0.02, -0.03]), V.add(heel, [0, 0.012, 0.012]), 0.04, 0.048, 0.04, 'foot'); // Achilles / heel
  }
  return P;
}

// ── primitive SDFs ──
function sdEllipsoid(p, c, r, B) {
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const x = d[0] * B.X[0] + d[1] * B.X[1] + d[2] * B.X[2];
  const y = d[0] * B.Y[0] + d[1] * B.Y[1] + d[2] * B.Y[2];
  const z = d[0] * B.Z[0] + d[1] * B.Z[1] + d[2] * B.Z[2];
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}
function sdRoundCone(p, a, b, r1, r2) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const z = y - l2;
  const qx = pa[0] * l2 - ba[0] * y, qy = pa[1] * l2 - ba[1] * y, qz = pa[2] * l2 - ba[2] * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function compile(P) {
  for (const p of P) {
    if (p.t === 'F') continue;
    if (p.t === 'S') { p.bc = p.c; p.br = p.r; }
    else if (p.t === 'E') { p.bc = p.c; p.br = Math.max(...p.r); }
    else { p.bc = V.lerp(p.a, p.b, 0.5); p.br = V.len(V.sub(p.b, p.a)) / 2 + Math.max(p.r1, p.r2); }
  }
  return function sdf(x, y, z) {
    const p = [x, y, z];
    let d = 1e9;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      const lb = Math.hypot(x - q.bc[0], y - q.bc[1], z - q.bc[2]) - q.br;
      if (lb > d + q.k) continue;
      let v;
      if (q.t === 'F') v = q.fn(x, y, z);
      else if (q.t === 'S') v = Math.hypot(x - q.c[0], y - q.c[1], z - q.c[2]) - q.r;
      else if (q.t === 'E') v = sdEllipsoid(p, q.c, q.r, q.B);
      else v = sdRoundCone(p, q.a, q.b, q.r1, q.r2);
      d = d === 1e9 ? v : smin(d, v, q.k);
    }
    return d;
  };
}

// ── nervous system (polylines, root = brain) ──
export function nerveTree() {
  const T = [];
  const add = (pts, parent = -1, at = 0) => { T.push({ pts, parent, at }); return T.length - 1; };
  const brain = V.add(J.head, [0, 0.1, -0.035]);
  const stem = V.add(J.head, [0, -0.06, -0.07]);
  const spine = add([brain, stem, V.add(J.neckTop, [0, 0, -0.06]), V.add(J.neckBase, [0, 0, -0.07]), V.add(J.chest, [0, 0.18, -0.13]), V.add(J.chest, [0, -0.12, -0.14]), V.add(J.waist, [0, 0.05, -0.1]), V.add(J.waist, [0, -0.18, -0.1]), V.add(J.pelvis, [0, -0.04, -0.1])]);
  for (const s of [-1, 1]) {
    const sh = s < 0 ? J.shR : J.shL, el = s < 0 ? J.elbowR : J.elbowL, wr = s < 0 ? J.wristR : J.wristL;
    const hip = s < 0 ? J.hipR : J.hipL, kn = s < 0 ? J.kneeR : J.kneeL, an = s < 0 ? J.ankleR : J.ankleL;
    const heel = s < 0 ? J.heelR : J.heelL, toe = s < 0 ? J.toeR : J.toeL;
    const arm = add([V.add(J.neckBase, [0, 0, -0.07]), V.add(J.neckBase, [0.12 * s, -0.03, -0.02]), V.add(sh, [-0.04 * s, -0.07, 0.0]), V.lerp(sh, el, 0.5), V.add(el, [-0.012 * s, 0, 0.012]), V.lerp(el, wr, 0.5), V.add(wr, [0, -0.01, 0.004])], spine, 3);
    for (const fw of [0.054, 0.019, -0.018, -0.05]) {
      const D = V.norm(V.add(V.norm(V.sub(wr, el)), [0.06 * s, -0.25, 0.08]));
      const tip = V.add(V.add(wr, V.mul(D, 0.31)), [-0.02 * s, 0, fw * 0.9]);
      add([V.add(wr, [0, -0.01, 0.004]), V.add(V.add(wr, V.mul(D, 0.14)), [0, 0, fw * 0.6]), tip], arm, 6);
    }
    for (let i = 0; i < 5; i++) {
      const y = 1.0 - i * 0.12;
      const pts = [];
      for (let a = 0; a <= 6; a++) {
        const th = (a / 6) * Math.PI * 0.86;
        const rx = 0.245 - i * 0.01, rz = 0.165;
        pts.push([J.chest[0] + Math.sin(th) * rx * s, y - a * 0.012, J.chest[2] - Math.cos(th) * rz]);
      }
      pts[0] = [0.0, y, -0.14];
      add(pts, spine, i < 2 ? 4 : 5);
    }
    const leg = add([V.add(J.pelvis, [0.02 * s, -0.04, -0.1]), V.add(hip, [-0.06 * s, -0.13, -0.08]), V.add(V.lerp(hip, kn, 0.5), [0, 0, -0.04]), V.add(kn, [0, 0, -0.03]), V.lerp(kn, an, 0.5), V.add(an, [0, 0, -0.01])], spine, 8);
    add([V.add(an, [0, 0, -0.01]), V.add(V.lerp(heel, toe, 0.45), [0, 0.03, 0]), V.add(toe, [0, 0.012, -0.02])], leg, 5);
    add([V.lerp(kn, an, 0.5), V.add(V.lerp(kn, an, 0.75), [0.03 * s, 0, 0.035]), V.add(an, [0.03 * s, -0.02, 0.04])], leg, 4);
  }
  return T;
}

export function anchors() {
  return {
    brain: V.add(J.head, [0, 0.1, -0.03]),
    heart: [0.08, 0.86, 0.13],
    handR: V.add(J.wristR, [0.0, -0.12, 0.03]),
    handL: V.add(J.wristL, [0.0, -0.12, 0.04]),
    base: [0, -1.75, 0.9],
  };
}
