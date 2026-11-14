// Shot detection and ball tracking from a single side-on camera.
// DOM-free so it can be tested in Node with synthetic frames.
//
// Frames are grayscale Uint8Array (w*h). Coordinates: x right, y down (pixels).
// The camera looks square-on at the golfer; the ball flies across the frame.

import { BALL } from './physics.js';

const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- helpers
function median(arr) {
  const a = Array.from(arr).sort((p, q) => p - q);
  return a.length ? a[a.length >> 1] : 0;
}

// Weighted second moments -> centroid, major/minor "diameters" (4*sqrt(lambda)),
// and the major-axis angle.
function moments(sw, sx, sy, sxx, syy, sxy) {
  const cx = sx / sw, cy = sy / sw;
  const vxx = sxx / sw - cx * cx, vyy = syy / sw - cy * cy, vxy = sxy / sw - cx * cy;
  const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
  return { cx, cy, major: 4 * Math.sqrt(l1), minor: 4 * Math.sqrt(l2), angle: ang };
}

/**
 * Find the ball near (x, y). Returns {x, y, d, contrast} or null.
 * Works for a ball that is brighter than its surroundings (white ball).
 */
export function locateBall(g, w, h, x, y, searchR = 40) {
  x = Math.round(x); y = Math.round(y);
  const x0 = Math.max(1, x - searchR), x1 = Math.min(w - 2, x + searchR);
  const y0 = Math.max(1, y - searchR), y1 = Math.min(h - 2, y + searchR);
  // background: median of the search window
  const vals = [];
  for (let yy = y0; yy <= y1; yy += 2) for (let xx = x0; xx <= x1; xx += 2) vals.push(g[yy * w + xx]);
  const bg = median(vals);
  // brightest smoothed pixel, favouring pixels close to the tap
  let best = -1e9, bx = x, by = y;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const i = yy * w + xx;
      const s = (g[i] * 4 + g[i - 1] + g[i + 1] + g[i - w] + g[i + w]) / 8;
      const dist = Math.hypot(xx - x, yy - y) / searchR;
      const sc = s - bg - 25 * dist * dist;
      if (sc > best) { best = sc; bx = xx; by = yy; }
    }
  }
  const peak = g[by * w + bx];
  const contrast = peak - bg;
  if (contrast < 25) return null;
  // flood fill at half contrast
  const thr = bg + contrast * 0.5;
  const seen = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1));
  const ww = x1 - x0 + 1;
  const stack = [[bx, by]];
  let area = 0;
  let minx = bx, maxx = bx, miny = by, maxy = by;
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    const k = (py - y0) * ww + (px - x0);
    if (seen[k] || g[py * w + px] < thr) continue;
    seen[k] = 1; area++;
    if (px < minx) minx = px; if (px > maxx) maxx = px;
    if (py < miny) miny = py; if (py > maxy) maxy = py;
    if (area > 4000) return null;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  if (area < 4) return null;
  // contrast-weighted moments over the blob plus a small margin
  const m = 2;
  let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let yy = Math.max(0, miny - m); yy <= Math.min(h - 1, maxy + m); yy++) {
    for (let xx = Math.max(0, minx - m); xx <= Math.min(w - 1, maxx + m); xx++) {
      const v = g[yy * w + xx] - bg;
      if (v < contrast * 0.15) continue;
      sw += v; sx += v * xx; sy += v * yy; sxx += v * xx * xx; syy += v * yy * yy; sxy += v * xx * yy;
    }
  }
  const mo = moments(sw, sx, sy, sxx, syy, sxy);
  // A ball on a tee merges with the tee below it: use the horizontal size.
  const d = Math.min(mo.minor, 2 * Math.sqrt(area / Math.PI) * 1.15);
  return { x: mo.cx, y: mo.cy, d: Math.max(3, d), contrast, bg };
}

// ------------------------------------------------ automatic ball finding
/**
 * Find small, bright, round blobs that could be a golf ball, anywhere in the
 * lower part of the frame. Returns [{x, y, d, contrast, score}] best first.
 */
export function findBallCandidates(g, w, h, o = {}) {
  const dMin = o.dMin ?? 5, dMax = o.dMax ?? 26;
  const T = o.contrast ?? 35;
  const R = Math.max(8, Math.round(dMax * 1.2));
  const W1 = w + 1;
  const ii = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const gi = y * w, ib = (y + 1) * W1, ia = y * W1;
    for (let x = 0; x < w; x++) { row += g[gi + x]; ii[ib + x + 1] = ii[ia + x + 1] + row; }
  }
  const y0 = Math.round(h * (o.top ?? 0.2));
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < h; y++) {
    const ya = Math.max(0, y - R), yb = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x];
      if (v < 90) continue;
      const xa = Math.max(0, x - R), xb = Math.min(w, x + R + 1);
      const sum = ii[yb * W1 + xb] - ii[ya * W1 + xb] - ii[yb * W1 + xa] + ii[ya * W1 + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      if (v - mean > T) mask[y * w + x] = 1;
    }
  }
  const out = [];
  const stack = [];
  const aMin = Math.max(3, 0.35 * Math.PI * dMin * dMin / 4), aMax = 1.8 * Math.PI * dMax * dMax / 4 + 40;
  for (let s = y0 * w; s < mask.length; s++) {
    if (mask[s] !== 1) continue;
    let area = 0, minx = w, maxx = 0, miny = h, maxy = 0, sx = 0, sy = 0;
    stack.length = 0; stack.push(s); mask[s] = 2;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      area++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (area > aMax * 3) continue;
      if (x > 0 && mask[i - 1] === 1) { mask[i - 1] = 2; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] === 1) { mask[i + 1] = 2; stack.push(i + 1); }
      if (y > 0 && mask[i - w] === 1) { mask[i - w] = 2; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] === 1) { mask[i + w] = 2; stack.push(i + w); }
    }
    let bw = maxx - minx + 1, bh = maxy - miny + 1;
    let cx = sx / area, cy = sy / area;
    // ball sitting on a white tee: blob is taller than wide; use the top part
    if (bh > bw * 1.3 && bh < bw * 4) { cx = minx + bw / 2; cy = miny + bw / 2; bh = bw; area = Math.min(area, bw * bw); }
    if (area < aMin || area > aMax) continue;
    if (bw < dMin * 0.6 || bw > dMax * 1.4 || bh < dMin * 0.6 || bh > dMax * 1.4) continue;
    if (Math.min(bw, bh) / Math.max(bw, bh) < 0.6) continue;
    const fill = area / (bw * bh);
    if (fill < 0.45) continue;
    const b = locateBall(g, w, h, cx, cy, Math.max(6, Math.round(Math.max(bw, bh))));
    if (!b || b.d < dMin || b.d > dMax || b.contrast < T) continue;
    if (Math.hypot(b.x - cx, b.y - cy) > Math.max(bw, bh)) continue;
    out.push({ x: b.x, y: b.y, d: b.d, contrast: b.contrast, score: b.contrast * fill });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8);
}

function extractPatch(g, w, h, cx, cy, hp) {
  const n = 2 * hp + 1;
  const p = new Float32Array(n * n);
  let k = 0, mean = 0;
  for (let yy = -hp; yy <= hp; yy++) for (let xx = -hp; xx <= hp; xx++) {
    const X = Math.min(w - 1, Math.max(0, Math.round(cx) + xx));
    const Y = Math.min(h - 1, Math.max(0, Math.round(cy) + yy));
    p[k] = g[Y * w + X]; mean += p[k++];
  }
  mean /= n * n;
  let ss = 0;
  for (let i = 0; i < p.length; i++) { p[i] -= mean; ss += p[i] * p[i]; }
  const norm = Math.sqrt(ss) || 1;
  for (let i = 0; i < p.length; i++) p[i] /= norm;
  return p;
}

// Normalised cross-correlation of a stored patch at (cx, cy) in frame g.
function nccAt(g, w, h, cx, cy, hp, P) {
  const n = 2 * hp + 1;
  cx = Math.round(cx); cy = Math.round(cy);
  if (cx - hp < 0 || cy - hp < 0 || cx + hp >= w || cy + hp >= h) return -1;
  let sum = 0, sum2 = 0, dot = 0, k = 0;
  for (let yy = -hp; yy <= hp; yy++) {
    let i = (cy + yy) * w + cx - hp;
    for (let xx = 0; xx < n; xx++, i++, k++) {
      const v = g[i];
      sum += v; sum2 += v * v; dot += v * P[k];
    }
  }
  const N = n * n;
  const varr = sum2 - (sum * sum) / N;
  if (varr < 1e-6) return 0;
  // P has zero mean, so dot with (v - mean) == dot with v
  return dot / Math.sqrt(varr);
}

function bestNcc(g, w, h, cx, cy, hp, P, r, step = 1) {
  let best = -1, bx = cx, by = cy;
  for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
    const s = nccAt(g, w, h, cx + dx, cy + dy, hp, P);
    if (s > best) { best = s; bx = cx + dx; by = cy + dy; }
  }
  return { score: best, x: bx, y: by };
}

// ------------------------------------------------- fast-mover candidates
/**
 * Three-frame difference: pixels that differ from both the previous and the
 * next frame in the same direction belong to something that is only in this
 * frame (a fast ball). Returns blobs inside the flight cone from the tee.
 */
export function findMovers(prev, cur, next, w, h, tee, opts = {}) {
  const d = tee.d;
  const T = opts.threshold ?? 14;
  const yMax = Math.min(h - 1, Math.round(tee.y + d * 1.5));
  const resp = new Int16Array(w * (yMax + 1));
  const mask = new Uint8Array(w * (yMax + 1));
  for (let y = 0; y <= yMax; y++) {
    let i = y * w;
    for (let x = 0; x < w; x++, i++) {
      const c = cur[i];
      const a = c - prev[i], b = c - next[i];
      let r = 0;
      if (a > 0 && b > 0) r = Math.min(a, b);
      else if (a < 0 && b < 0) r = -Math.max(a, b);
      resp[i] = r;
      if (r >= T) mask[i] = 1;
    }
  }
  const blobs = [];
  const stack = [];
  const minArea = Math.max(2, Math.round(0.12 * Math.PI * d * d / 4));
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let area = 0, peak = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    stack.length = 0; stack.push(start); mask[start] = 2;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      area++;
      if (resp[i] > peak) peak = resp[i];
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (area > 20000) break;
      if (x > 0 && mask[i - 1] === 1) { mask[i - 1] = 2; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] === 1) { mask[i + 1] = 2; stack.push(i + 1); }
      if (y > 0 && mask[i - w] === 1) { mask[i - w] = 2; stack.push(i - w); }
      if (y < yMax && mask[i + w] === 1) { mask[i + w] = 2; stack.push(i + w); }
    }
    if (area < minArea || area > 20000) continue;
    // response-weighted moments with a margin so faint edges count
    const m = 2, cut = peak * 0.15;
    let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let y = Math.max(0, miny - m); y <= Math.min(yMax, maxy + m); y++) {
      for (let x = Math.max(0, minx - m); x <= Math.min(w - 1, maxx + m); x++) {
        const v = resp[y * w + x];
        if (v < cut) continue;
        sw += v; sx += v * x; sy += v * y; sxx += v * x * x; syy += v * y * y; sxy += v * x * y;
      }
    }
    if (!sw) continue;
    const mo = moments(sw, sx, sy, sxx, syy, sxy);
    const dx = mo.cx - tee.x, dy = tee.y - mo.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < d * 0.9) continue;
    const elev = Math.atan2(dy, Math.abs(dx)) * DEG;
    if (elev < -12 || elev > 72) continue;
    if (mo.minor < d * 0.4 || mo.minor > d * 2.2) continue;
    if (mo.major > d * 18) continue;
    // a streak must point back toward the tee
    const elong = mo.major / mo.minor;
    if (elong > 1.7) {
      const a1 = Math.atan2(mo.cy - tee.y, mo.cx - tee.x);
      let da = Math.abs(((mo.angle - a1) % Math.PI + Math.PI) % Math.PI);
      if (da > Math.PI / 2) da = Math.PI - da;
      if (da * DEG > 22) continue;
    }
    blobs.push({ x: mo.cx, y: mo.cy, d: mo.minor, len: mo.major, area, peak, dist });
  }
  blobs.totalCount = blobs.length;
  if (blobs.length > 30) { blobs.sort((a, b) => b.peak * b.area - a.peak * a.area); blobs.length = 30; }
  return blobs;
}

/**
 * Did the whole picture shift between two frames? Compares small patches of
 * ground near the bottom of the frame, which should never move during a shot.
 * Returns {dx, dy, agree} — agree = how many patches saw the same shift.
 */
export function globalShift(gA, gB, w, h) {
  const hp = Math.max(8, Math.round(w / 80)), R = Math.max(10, Math.round(w / 40));
  const ys = [0.8, 0.9].map((f) => Math.round(h * f));
  const xs = [0.12, 0.3, 0.5, 0.7, 0.88].map((f) => Math.round(w * f));
  const shifts = [];
  for (const y of ys) for (const x of xs) {
    if (y + hp + R >= h || y - hp - R < 0) continue;
    const P = extractPatch(gA, w, h, x, y, hp);
    let sd = 0; for (let i = 0; i < P.length; i++) sd += P[i] * P[i];
    const r = bestNcc(gB, w, h, x, y, hp, P, R, 1);
    if (r.score > 0.6) shifts.push({ dx: r.x - x, dy: r.y - y });
  }
  if (!shifts.length) return { dx: 0, dy: 0, agree: 0, n: 0 };
  let best = { dx: 0, dy: 0, agree: 0 };
  for (const a of shifts) {
    const agree = shifts.filter((b) => Math.abs(b.dx - a.dx) <= 2 && Math.abs(b.dy - a.dy) <= 2).length;
    if (agree > best.agree) best = { dx: a.dx, dy: a.dy, agree };
  }
  return { ...best, n: shifts.length };
}

// ----------------------------------------------------------- track fitting
function lsLine(ts, vs) {
  const n = ts.length;
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (let i = 0; i < n; i++) { st += ts[i]; sv += vs[i]; stt += ts[i] * ts[i]; stv += ts[i] * vs[i]; }
  const den = n * stt - st * st;
  const b = den ? (n * stv - st * sv) / den : 0;
  const a = (sv - b * st) / n;
  return { a, b };
}

/**
 * Choose the set of detections that forms a straight, constant-speed track
 * starting at the tee. frames: [{t, blobs}] in time order.
 */
export function fitTrack(frames, tee, opts = {}) {
  let work = 0; const budget = opts.budget ?? 400000;
  const d = tee.d;
  const tMin = opts.tMinImpact ?? -Infinity;
  const pxToM = BALL.diameter / d;
  let best = null;
  for (let i = 0; i < frames.length; i++) {
    for (const a of frames[i].blobs) {
      for (let j = i + 1; j < Math.min(frames.length, i + 4); j++) {
        const dt = frames[j].t - frames[i].t;
        if (dt <= 0) continue;
        for (const b of frames[j].blobs) {
          if (++work > budget) return best;
          const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
          const v = Math.hypot(vx, vy);
          const vms = v * pxToM;
          if (vms < 4 || vms > 100) continue;
          if (b.dist <= a.dist) continue;
          // line through a with direction v must pass near the tee
          const ux = vx / v, uy = vy / v;
          const tx = a.x - tee.x, ty = a.y - tee.y;
          const along = tx * ux + ty * uy;
          const perp = Math.abs(tx * uy - ty * ux);
          if (along <= 0) continue;
          if (perp > Math.max(1.6 * d, 0.06 * along)) continue;
          const tImp = frames[i].t - along / v;
          if (tImp < tMin) continue;
          const frameDt = dt / (j - i);
          if (frames[i].t - tImp > 3.2 * frameDt) continue;
          // gather inliers across all frames
          const pts = [];
          for (let k = 0; k < frames.length; k++) {
            const tk = frames[k].t;
            if (tk <= tImp) continue;
            const px = tee.x + ux * v * (tk - tImp), py = tee.y + uy * v * (tk - tImp);
            const tol = Math.max(1.5 * d, 0.06 * v * frameDt);
            let bb = null, bd = tol;
            for (const c of frames[k].blobs) {
              const e = Math.hypot(c.x - px, c.y - py);
              if (e < bd) { bd = e; bb = c; }
            }
            if (bb) pts.push({ ...bb, t: tk, err: bd });
          }
          if (pts.length < 2) continue;
          const meanErr = pts.reduce((s, p) => s + p.err, 0) / pts.length;
          const score = pts.length * 10 - meanErr / d;
          if (!best || score > best.score) best = { score, pts, tImp };
        }
      }
    }
  }
  return best;
}

/**
 * Convert a fitted track into launch numbers.
 * cam: {w, h, hfovDeg}. Returns speed (m/s), launch (deg), direction (deg,
 * + = right of target), sideSpeed etc.
 */
export function solveShot(track, tee, cam) {
  const { pts } = track;
  const f = (cam.w / 2) / Math.tan((cam.hfovDeg * Math.PI) / 360);
  const D = BALL.diameter;
  // camera-to-ball distance: measured by the user if given, else from the ball's size
  const Z0 = cam.ballDist > 0.5 ? cam.ballDist : (f * D) / tee.d;
  const cx = cam.w / 2, cy = cam.h / 2;
  let t0 = track.tImp;
  let ts, alpha, Zs, X, Y, freeX, freeY;
  const Xt = ((tee.x - cx) * Z0) / f, Yt = (-(tee.y - cy) * Z0) / f;
  // depth from apparent size: ratio d0/d grows as the ball moves away.
  // Iterate: impact time -> depth -> 3D fit -> refined impact time.
  for (let iter = 0; iter < 3; iter++) {
    ts = pts.map((p) => p.t - t0);
    const ratios = pts.map((p) => tee.d / Math.max(1, p.d));
    let num = 0, den = 0;
    for (let i = 0; i < ts.length; i++) { num += ts[i] * (ratios[i] - 1); den += ts[i] * ts[i]; }
    alpha = den ? num / den : 0;
    Zs = ts.map((t) => Z0 * (1 + alpha * t));
    X = pts.map((p, i) => ((p.x - cx) * Zs[i]) / f);
    Y = pts.map((p, i) => (-(p.y - cy) * Zs[i]) / f + 0.5 * 9.81 * ts[i] * ts[i]);
    freeX = lsLine(ts, X); freeY = lsLine(ts, Y);
    // time at which the fitted line passes closest to the tee
    const vx2 = freeX.b, vy2 = freeY.b, v2 = vx2 * vx2 + vy2 * vy2;
    if (!v2) break;
    const dtc = ((Xt - freeX.a) * vx2 + (Yt - freeY.a) * vy2) / v2;
    if (Math.abs(dtc) > 0.05) break;
    t0 += dtc;
  }
  const vx = freeX.b, vy = freeY.b;
  let vToward = -alpha * Z0; // + = toward the camera
  const sgn = Math.sign(vx) || 1;
  const vFwd = Math.abs(vx);
  // limit the size-based side estimate to a plausible range (+-20 deg)
  const lim = Math.tan(20 / DEG) * vFwd;
  vToward = Math.max(-lim, Math.min(lim, vToward));
  const vRight = sgn * vToward;
  const vh = Math.hypot(vFwd, vRight);
  const speed = Math.hypot(vh, vy);
  const launch = Math.atan2(vy, vh) * DEG;
  const direction = Math.atan2(vRight, vFwd) * DEG;
  // residual of the free fit in metres
  let res = 0;
  for (let i = 0; i < ts.length; i++) {
    res += (X[i] - (freeX.a + freeX.b * ts[i])) ** 2 + (Y[i] - (freeY.a + freeY.b * ts[i])) ** 2;
  }
  res = Math.sqrt(res / ts.length);
  return {
    speed, launch, direction,
    targetSign: sgn, // +1: ball flew to the right of the screen
    distanceToBall: Z0,
    points: pts.length, residual: res,
  };
}

// --------------------------------------------------------------- engine
/**
 * ShotEngine: feed it frames; it arms on the ball, notices when the ball is
 * struck, finds the ball in flight and reports the launch.
 *
 * Events (returned from pushFrame and passed to onEvent):
 *   {type:'armed', ball}
 *   {type:'shot', launch, track, frames}
 *   {type:'missed', reason}
 *   {type:'waiting'}
 */
export class ShotEngine {
  constructor(opts = {}) {
    this.opts = { hfovDeg: 67, bufferSeconds: 0.7, maxFrames: 64, autoFind: true, stillTime: 1.0, ...opts };
    this.onEvent = opts.onEvent || (() => {});
    this.w = 0; this.h = 0;
    this.buf = []; // {g, t, score}
    this.pool = [];
    this.state = 'idle';
    this.ball = null;
    this.fps = 60;
    this._lastT = null;
    this._dts = [];
  }

  reset() { this.state = 'idle'; this.ball = null; this.buf = []; this._cands = []; this._autoN = 0; }

  _store(g, t) {
    const n = this.w * this.h;
    let slot = this.buf.length >= this._cap() ? this.buf.shift() : null;
    let arr = slot ? slot.g : (this.pool.pop() || new Uint8Array(n));
    if (arr.length !== n) arr = new Uint8Array(n);
    arr.set(g.length === n ? g : g.subarray(0, n));
    const rec = { g: arr, t, score: null };
    this.buf.push(rec);
    return rec;
  }
  _cap() { return Math.min(this.opts.maxFrames, Math.max(24, Math.round(this.fps * this.opts.bufferSeconds))); }

  latest() { return this.buf[this.buf.length - 1]; }

  /** Arm on a ball near (x, y) in the latest frame. */
  setBall(x, y) {
    const fr = this.latest();
    if (!fr) return null;
    const b = locateBall(fr.g, this.w, this.h, x, y, Math.round(Math.max(20, this.w * 0.04)));
    if (!b) return null;
    this._arm(b, fr.g);
    return this.ball;
  }

  _arm(b, g, how = 'tap') {
    const hp = Math.max(4, Math.round(b.d * 0.95));
    this.ball = { ...b, hp, patch: extractPatch(g, this.w, this.h, b.x, b.y, hp) };
    this.state = 'armed';
    this.onset = null;
    this.absent = 0;
    this.lastPresentT = null;
    this.lastPresentRec = null;
    this.armedT = this.latest() ? this.latest().t : 0;
    this._cands = [];
    const ev = { type: 'armed', how, ball: { x: b.x, y: b.y, d: b.d } };
    this.onEvent(ev);
    return ev;
  }

  pushFrame(g, w, h, t) {
    if (w !== this.w || h !== this.h) { this.w = w; this.h = h; this.buf = []; this.pool = []; if (this.ball) this.state = 'idle'; }
    if (this._lastT != null) {
      const dt = t - this._lastT;
      if (dt > 0 && dt < 0.2) { this._dts.push(dt); if (this._dts.length > 60) this._dts.shift(); }
      this.fps = 1 / median(this._dts.length ? this._dts : [1 / 60]);
    }
    this._lastT = t;
    const rec = this._store(g, t);
    if (this.state === 'armed') return this._armedStep(rec);
    if (this.state === 'waiting') return this._waitingStep(rec);
    // only search by itself when the phone is sideways (landscape)
    if (this.state === 'idle' && this.opts.autoFind && this.w >= this.h) {
      // If the user has shown us their tee spot, only look there.
      const ts = this.opts.teeSpot;
      const near = ts ? (k) => Math.hypot(k.x - ts.x * this.w, k.y - ts.y * this.h) < this.w * 0.08 : null;
      return this._autoStep(rec, near, 1.0);
    }
    return null;
  }

  _presence(rec) {
    const b = this.ball;
    const s = bestNcc(rec.g, this.w, this.h, b.x, b.y, b.hp, b.patch, 1).score;
    rec.score = s;
    return s;
  }

  _armedStep(rec) {
    const s = this._presence(rec);
    const idx = this.buf.length - 1;
    if (s > 0.72) {
      this.onset = null; this.absent = 0; this.lastPresentT = rec.t; this.lastPresentRec = rec;
      return null;
    }
    if (s < 0.6 && this.onset == null) {
      // Has the whole picture shifted a little (phone nudged, tripod settling)?
      // Then the ball is still there, just somewhere close by: follow it.
      const b = this.ball;
      const r = bestNcc(rec.g, this.w, this.h, b.x, b.y, b.hp, b.patch, Math.max(4, Math.round(b.d * 2)), 1);
      if (r.score > 0.75) {
        b.x = r.x; b.y = r.y; this.lastPresentT = rec.t; this.lastPresentRec = rec;
        this.onEvent({ type: 'nudged', ball: { x: b.x, y: b.y, d: b.d } });
        return null;
      }
    }
    if (s < 0.5) {
      if (this.onset == null) this.onset = rec;
      this.absent++;
    }
    const confirmN = Math.max(6, Math.round(this.fps * 0.22));
    if (this.onset && this.absent >= confirmN) {
      return this._analyse();
    }
    return null;
  }

  // Camera timestamps can jitter by a few ms. The sensor runs at a fixed
  // rate, so snap every buffered frame onto a regular grid (keeping gaps for
  // dropped frames) fitted by least squares.
  _snapTimes() {
    const B = this.buf;
    if (B.length < 4) return;
    const dts = [];
    for (let i = 1; i < B.length; i++) dts.push(B[i].t - B[i - 1].t);
    const d0 = median(dts.filter((d) => d > 0));
    if (!(d0 > 0)) return;
    const ks = [0];
    for (let i = 1; i < B.length; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((B[i].t - B[i - 1].t) / d0)));
    const fit = lsLine(ks, B.map((f) => f.t));
    if (!(fit.b > 0) || Math.abs(fit.b / d0 - 1) > 0.15) return;
    for (let i = 0; i < B.length; i++) { B[i].traw = B[i].t; B[i].t = fit.a + fit.b * ks[i]; }
    if (this.lastPresentRec && B.includes(this.lastPresentRec)) this.lastPresentT = this.lastPresentRec.t;
  }

  _analyse() {
    if (this.opts.snapTimes !== false) this._snapTimes();
    const onsetIdx = this.buf.indexOf(this.onset);
    const b = this.ball;
    const i0 = Math.max(1, onsetIdx - 3);
    const i1 = Math.min(this.buf.length - 2, onsetIdx + Math.max(8, Math.round(this.fps * 0.15)));
    const frames = [];
    for (let i = i0; i <= i1; i++) {
      const blobs = findMovers(this.buf[i - 1].g, this.buf[i].g, this.buf[i + 1].g, this.w, this.h, b, { threshold: this.opts.threshold });
      frames.push({ t: this.buf[i].t, blobs, idx: i });
    }
    // impact can't be before the last frame that clearly showed the ball
    const before = this.buf[Math.max(0, onsetIdx - 1)];
    const tMin = this.lastPresentT != null ? Math.min(this.lastPresentT, before.t) - 0.5 / this.fps : -Infinity;
    const fullCounts = frames.map((f) => f.blobs.totalCount ?? f.blobs.length).sort((p, q) => p - q);
    const wholePictureMoved = fullCounts.length && fullCounts[fullCounts.length >> 1] > (this.opts.shakeLimit ?? 120);
    const track = wholePictureMoved ? null : fitTrack(frames, b, { tMinImpact: tMin });
    // snapshot of the frames used, for replay
    const snap = this.buf.slice(Math.max(0, i0 - 1), i1 + 2).map((f) => ({ t: f.t, g: f.g.slice() }));
    this.state = 'waiting';
    this._wait = { since: null, cand: null, n: 0 };
    // Lots of movement everywhere = the phone moved, not a golf shot.
    const counts = frames.map((f) => f.blobs.totalCount ?? f.blobs.length).sort((p, q) => p - q);
    const medMoving = counts.length ? counts[counts.length >> 1] : 0;
    this._shotT = this.latest().t;
    this._cands = [];
    // Compare the ground before the ball left with later frames.
    const pre = this.buf[Math.max(0, onsetIdx - 1)].g;
    let shaken = false;
    for (const k of [Math.min(this.buf.length - 1, onsetIdx + 2), i1]) {
      const gs = globalShift(pre, this.buf[k].g, this.w, this.h);
      if (gs.agree >= 3 && Math.hypot(gs.dx, gs.dy) >= 2) { shaken = true; break; }
    }
    let ev;
    if (shaken || medMoving > (this.opts.shakeLimit ?? 120)) {
      ev = { type: 'moved', moving: frames.map((f) => f.blobs.totalCount ?? f.blobs.length), tee: { x: b.x, y: b.y, d: b.d }, w: this.w, h: this.h };
    } else if (!track) {
      ev = { type: 'missed', tNow: this.latest().t, reason: 'ball-not-found', moving: frames.map((f) => f.blobs.length), frames: snap, tee: { x: b.x, y: b.y, d: b.d }, w: this.w, h: this.h };
    } else {
      const launch = solveShot(track, b, { w: this.w, h: this.h, hfovDeg: this.opts.hfovDeg, ballDist: this.opts.ballDist });
      if (launch.launch < -3 || launch.launch > 62 || launch.speed > 95) { ev = { type: 'missed', reason: 'implausible', moving: frames.map((f) => f.blobs.length), frames: snap, tee: { x: b.x, y: b.y, d: b.d }, w: this.w, h: this.h }; this.onEvent(ev); return ev; }
      ev = { type: 'shot', tNow: this.latest().t, launch, track, moving: frames.map((f) => f.blobs.length), frames: snap, tee: { x: b.x, y: b.y, d: b.d }, w: this.w, h: this.h, fps: this.fps };
    }
    this.onEvent(ev);
    return ev;
  }

  // Look for a still, bright, round ball; arm when one stays put for stillTime.
  _autoStep(rec, filter, every) {
    this._autoN = (this._autoN || 0) + 1;
    const stride = Math.max(1, Math.round((this.fps || 60) / 10 * every));
    if (this._autoN % stride !== 0) return null;
    const dMax = Math.max(12, Math.round(this.w * 0.03));
    let c = findBallCandidates(rec.g, this.w, this.h, { dMin: Math.max(4, this.w * 0.005), dMax, contrast: this.opts.autoContrast ?? 35 });
    if (filter) c = c.filter(filter);
    const prev = this._cands || [];
    const next = [];
    for (const k of c) {
      const m = prev.find((p) => Math.hypot(p.x - k.x, p.y - k.y) < Math.max(2, k.d * 0.25) && Math.abs(p.d - k.d) < k.d * 0.35);
      next.push({ ...k, since: m ? m.since : rec.t, n: m ? m.n + 1 : 1 });
    }
    this._cands = next;
    const ready = next.filter((k) => rec.t - k.since >= this.opts.stillTime && k.n >= 4);
    if (!ready.length) return null;
    // The ball sits on the ground: of the still, round, bright things, take the
    // lowest one (a white glove or hands at address are higher up).
    ready.sort((a, b) => b.y - a.y);
    const best = ready[0];
    const b = locateBall(rec.g, this.w, this.h, best.x, best.y, Math.round(Math.max(8, best.d * 1.5)));
    if (!b) return null;
    return this._arm(b, rec.g, 'auto');
  }

  // After a shot: look for a new ball near the old tee spot; arm once it has
  // sat still for half a second.
  _waitingStep(rec) {
    if (this.hold) return null;
    const W = this._wait;
    W.n++;
    if (W.n % 3 !== 0) return null;
    const b = this.ball;
    const r = Math.round(b.d * 6);
    const coarse = bestNcc(rec.g, this.w, this.h, Math.round(b.x), Math.round(b.y), b.hp, b.patch, r, 2);
    let hit = null;
    if (coarse.score > 0.55) {
      const fine = bestNcc(rec.g, this.w, this.h, coarse.x, coarse.y, b.hp, b.patch, 2, 1);
      if (fine.score > 0.62) hit = fine;
    }
    if (!hit) {
      W.cand = null; W.since = null;
      // a ball that looks different (other brand, new tee height): find it by shape
      if (this.opts.autoFind && rec.t - this._shotT > 1.5) {
        const R2 = b.d * 6;
        return this._autoStep(rec, (k) => Math.hypot(k.x - b.x, k.y - b.y) < R2 && k.d > b.d * 0.6 && k.d < b.d * 1.6, 1 / 3);
      }
      return null;
    }
    if (W.cand && Math.hypot(hit.x - W.cand.x, hit.y - W.cand.y) <= Math.max(1.5, b.d * 0.25)) {
      if (rec.t - W.since >= 0.5) {
        const nb = locateBall(rec.g, this.w, this.h, hit.x, hit.y, Math.round(b.d * 1.5));
        if (nb && Math.abs(nb.d - b.d) < b.d * 0.4) return this._arm(nb, rec.g, 'retee');
      }
    } else {
      W.cand = hit; W.since = rec.t;
    }
    return null;
  }
}
