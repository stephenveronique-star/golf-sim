// Synthetic side-on golf footage with known launch numbers.
// World: X right (across the frame), Y up, Z away from the camera. Camera at
// the origin looking down +Z. Ball rests at (bx, by, bz).

export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
}

export function makeScene(o = {}) {
  const w = o.w ?? 960, h = o.h ?? 540;
  const hfov = o.hfov ?? 67;
  const f = (w / 2) / Math.tan((hfov * Math.PI) / 360);
  const rng = makeRng(o.seed ?? 7);
  // static textured background (fence, grass)
  const bg = new Float32Array(w * h);
  const horizon = h * 0.62;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = y > horizon ? 85 + 10 * Math.sin(x * 0.05 + y * 0.11) : 60 + 25 * Math.sin(x * 0.013) * Math.cos(y * 0.02);
    if (y < horizon && ((x / 40) | 0) % 6 === 0) v += 30; // fence posts
    bg[y * w + x] = v + 6 * (rng() - 0.5);
  }
  return { w, h, f, bg, rng, cx: w / 2, cy: h / 2 };
}

function project(sc, X, Y, Z) {
  return { x: sc.cx + (sc.f * X) / Z, y: sc.cy - (sc.f * Y) / Z, s: sc.f / Z };
}

function drawDisk(img, sc, x, y, r, val, weight) {
  const { w, h } = sc;
  const x0 = Math.max(0, Math.floor(x - r - 1)), x1 = Math.min(w - 1, Math.ceil(x + r + 1));
  const y0 = Math.max(0, Math.floor(y - r - 1)), y1 = Math.min(h - 1, Math.ceil(y + r + 1));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dd = Math.hypot(xx - x, yy - y);
    const cov = Math.max(0, Math.min(1, r + 0.5 - dd));
    if (cov <= 0) continue;
    const i = yy * w + xx;
    img[i] += (val - img[i]) * cov * weight;
  }
}

/**
 * Render a session: idle, then a swing, ball flight, then a new ball teed.
 * shot: {speed m/s, launch deg, direction deg (+ right), hand: 1 right-handed}
 * Returns {frames:[{t, g}], truth}.
 */
export function renderShot(sc, shot, o = {}) {
  const fps = o.fps ?? 60;
  const expo = o.exposure ?? 1 / 1500;
  const noise = o.noise ?? 3;
  const D = 0.04267, R = D / 2;
  const camH = o.camHeight ?? 0.25;
  const ball0 = { X: o.ballX ?? (shot.hand === -1 ? 1.0 : -1.0), Y: -camH + 0.03, Z: o.dist ?? 3.0 };
  const hand = shot.hand ?? 1; // +1: flies to the right of the screen
  const la = (shot.launch * Math.PI) / 180, dir = ((shot.direction ?? 0) * Math.PI) / 180;
  // + direction = right of target. For a right-handed golfer facing the
  // camera, right of target = toward the camera (-Z). Lefty mirrored.
  const vF = shot.speed * Math.cos(la) * Math.cos(dir);
  const vR = shot.speed * Math.cos(la) * Math.sin(dir);
  const vel = { X: hand * vF, Y: shot.speed * Math.sin(la), Z: -hand * vR };
  const tImp = o.tImpact ?? 0.6 + (o.phase ?? 0.37) / fps;
  const total = o.duration ?? 2.2;
  const reteeAt = o.reteeAt ?? 1.4;
  const clubSpeed = shot.speed / 1.4;
  const frames = [];
  const rng = sc.rng;
  const golferX = ball0.X - hand * 0.05, golferZ = ball0.Z + 0.7;

  const ballPos = (t) => {
    if (t < tImp) return { ...ball0 };
    if (t >= reteeAt) return { ...ball0, X: ball0.X + (o.reteeShift ?? 0) };
    const s = t - tImp;
    return { X: ball0.X + vel.X * s, Y: ball0.Y + vel.Y * s - 4.9 * s * s, Z: ball0.Z + vel.Z * s };
  };
  // club head: swings on an arc through the ball at impact
  const clubPos = (t) => {
    const s = t - tImp;
    const angSpeed = clubSpeed / 1.1; // rad/s on a 1.1 m arc
    const a = s * angSpeed; // 0 at impact
    if (Math.abs(a) > 2.2) return null;
    return { X: ball0.X + hand * 1.1 * Math.sin(a), Y: ball0.Y + 1.1 * (1 - Math.cos(a)), Z: ball0.Z + 0.03 };
  };

  for (let k = 0; k * (1 / fps) < total; k++) {
    const t = k / fps + (o.t0 ?? 0);
    const img = new Float32Array(sc.bg);
    // golfer body (dark, sways during the swing)
    const sway = Math.abs(t - tImp) < 0.4 ? 0.12 * Math.sin((t - tImp) * 8) : 0;
    const gp = project(sc, golferX + sway, ball0.Y + 0.9, golferZ);
    const gw = 0.45 * gp.s, gh = 1.5 * gp.s;
    for (let y = Math.max(0, Math.round(gp.y - gh / 2)); y < Math.min(sc.h, gp.y + gh / 2); y++)
      for (let x = Math.max(0, Math.round(gp.x - gw / 2)); x < Math.min(sc.w, gp.x + gw / 2); x++) img[y * sc.w + x] = 40 + 10 * Math.sin(y * 0.1);
    // sub-frame samples over the exposure for motion blur
    const S = 10;
    const acc = new Float32Array(img.length);
    for (let j = 0; j < S; j++) {
      const ts = t + (j / (S - 1) - 0.5) * expo;
      const layer = new Float32Array(img);
      const c = clubPos(ts);
      if (c) { const p = project(sc, c.X, c.Y, c.Z); drawDisk(layer, sc, p.x, p.y, 0.05 * p.s, 30, 1); }
      const b = ballPos(ts);
      if (b.Z > 0.3) { const p = project(sc, b.X, b.Y, b.Z); drawDisk(layer, sc, p.x, p.y, R * p.s, 235, 1); }
      for (let i = 0; i < acc.length; i++) acc[i] += layer[i] / S;
    }
    const g = new Uint8Array(acc.length);
    for (let i = 0; i < acc.length; i++) g[i] = Math.max(0, Math.min(255, Math.round(acc[i] + noise * gauss(rng))));
    frames.push({ t, g });
  }
  const p0 = project(sc, ball0.X, ball0.Y, ball0.Z);
  return { frames, truth: { ...shot, tImp, ball: p0, ballD: D * p0.s } };
}
