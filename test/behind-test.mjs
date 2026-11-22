// Phone behind the ball, looking down the target line: made-up footage with known numbers.
import { makeRng, gauss } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const D = 0.04267, DEG = Math.PI / 180;
function scene(o) {
  const w = 960, h = 540, f = (w / 2) / Math.tan((o.hfov * Math.PI) / 360), rng = makeRng(o.seed);
  const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bg[y * w + x] = (y > h * 0.45 ? 80 + 8 * Math.sin(x * 0.07 + y * 0.13) : 45 + 12 * Math.sin(x * 0.02) * Math.cos(y * 0.03)) + 6 * (rng() - 0.5);
  return { w, h, f, rng, bg, cx: w / 2, cy: h / 2 };
}
function disk(img, sc, x, y, r, val) {
  for (let yy = Math.max(0, Math.floor(y - r - 1)); yy <= Math.min(sc.h - 1, Math.ceil(y + r + 1)); yy++) for (let xx = Math.max(0, Math.floor(x - r - 1)); xx <= Math.min(sc.w - 1, Math.ceil(x + r + 1)); xx++) {
    const cov = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(xx - x, yy - y))); if (cov > 0) img[yy * sc.w + xx] += (val - img[yy * sc.w + xx]) * cov;
  }
}
export function render(shot, o) {
  const sc = scene({ hfov: o.hfov ?? 67, seed: o.seed ?? 5 }), fps = o.fps ?? 60, expo = o.exposure ?? 1 / 1500;
  const B = o.back ?? 3, hc = o.camH ?? 1, tip = (o.tip ?? 12) * DEG, yaw = (o.yaw ?? 0) * DEG, net = o.net ?? 3.5;
  // world: x forward (to the target), y up, z right. Camera at (-B, hc, 0), tipped down, maybe turned a little.
  const proj = (x, y, z) => {
    let X = z, Y = y - hc, Z = x + B; // camera axes before turning: right, up, forward
    const X1 = X * Math.cos(yaw) - Z * Math.sin(yaw), Z1 = Z * Math.cos(yaw) + X * Math.sin(yaw);
    const Y2 = Y * Math.cos(tip) + Z1 * Math.sin(tip), Z2 = Z1 * Math.cos(tip) - Y * Math.sin(tip);
    return { x: sc.cx + (sc.f * X1) / Z2, y: sc.cy - (sc.f * Y2) / Z2, s: sc.f / Z2 };
  };
  const la = shot.launch * DEG, di = shot.direction * DEG, v = { x: shot.speed * Math.cos(la) * Math.cos(di), y: shot.speed * Math.sin(la), z: shot.speed * Math.cos(la) * Math.sin(di) };
  const tImp = (o.hide ? 2.9 : 1.8) + (o.phase ?? 0.37) / fps, frames = [];
  const ball = (t) => { if (t < tImp || t >= (o.reteeAt ?? 1e9)) return { x: 0, y: D / 2, z: 0 }; const s = t - tImp, x = v.x * s; return x > net ? null : { x, y: D / 2 + v.y * s - 4.905 * s * s, z: v.z * s }; };
  const club = (t) => { const a = ((t - tImp) * shot.speed) / 1.4 / 1.1; return Math.abs(a) > 2.2 ? null : { x: 1.1 * Math.sin(a), y: 0.03 + 1.1 * (1 - Math.cos(a)), z: -0.1 - 0.5 * (1 - Math.cos(a)) }; };
  for (let k = 0; k / fps < (o.duration ?? (o.hide ? 3.7 : 2.6)); k++) {
    const t = k / fps, img = new Float32Array(sc.bg), S = 8, acc = new Float32Array(img.length);
    // golfer: a dark block to the left of the ball that sways through the swing
    const sway = Math.abs(t - tImp) < 0.4 ? 0.1 * Math.sin((t - tImp) * 8) : 0, gp = proj(0.05 + sway, 0.9, -0.85), gw = 0.45 * gp.s, gh = 1.6 * gp.s;
    for (let y = Math.max(0, Math.round(gp.y - gh / 2)); y < Math.min(sc.h, gp.y + gh / 2); y++) for (let x = Math.max(0, Math.round(gp.x - gw / 2)); x < Math.min(sc.w, gp.x + gw / 2); x++) img[y * sc.w + x] = 38 + 8 * Math.sin(y * 0.1);
    const moving = Math.abs(t - tImp) < 0.45 || (o.hide && t > tImp - 1.4);
    for (let j = 0; j < S; j++) {
      if (!moving) { const layer = img, b = ball(t); if (b) { const p = proj(b.x, b.y, b.z); disk(layer, sc, p.x, p.y, (D / 2) * p.s, 235); } acc.set(layer); break; }
      const ts = t + (j / (S - 1) - 0.5) * expo, layer = new Float32Array(img), c = club(ts), b = ball(ts);
      if (c) { const p = proj(c.x, c.y, c.z); disk(layer, sc, p.x, p.y, 0.05 * p.s, 28); }
      if (o.hide) { // the golfer walks across the ball, then the club head sits in front of it until the strike
        const tw = ts - (tImp - 1.3); if (tw > 0 && tw < 0.5) { const p = proj(-0.2, 0.25, -0.8 + tw * 3.2); for (let yy = Math.max(0, Math.round(p.y - 0.5 * p.s)); yy < Math.min(sc.h, p.y + 0.3 * p.s); yy++) for (let xx = Math.max(0, Math.round(p.x - 0.12 * p.s)); xx < Math.min(sc.w, p.x + 0.12 * p.s); xx++) layer[yy * sc.w + xx] = 200; }
        if (ts > tImp - 0.7 && ts < tImp - 0.02) { const p = proj(-0.07, 0.03, 0); disk(layer, sc, p.x, p.y, 0.05 * p.s, 30); } }
      if (b) { const p = proj(b.x, b.y, b.z); disk(layer, sc, p.x, p.y, (D / 2) * p.s, 235); }
      for (let i = 0; i < acc.length; i++) acc[i] += layer[i] / S;
    }
    const g = new Uint8Array(acc.length); for (let i = 0; i < acc.length; i++) g[i] = Math.max(0, Math.min(255, Math.round(acc[i] + (o.noise ?? 3) * gauss(sc.rng))));
    frames.push({ t, g });
  }
  return { sc, frames, tee: proj(0, D / 2, 0), dist: Math.hypot(B, hc - D / 2) };
}
if (process.argv[1].endsWith('behind-test.mjs')) {
  const cases = [{ speed: 30, launch: 28, direction: 0 }, { speed: 42, launch: 20, direction: 4 }, { speed: 50, launch: 16, direction: -5 }, { speed: 62, launch: 12, direction: 2 }, { speed: 70, launch: 11, direction: -3 }, { speed: 22, launch: 34, direction: 8 }];
  for (const cfg of (process.env.CFG ? [JSON.parse(process.env.CFG)] : [{ fps: 60, net: 3.5 }, { fps: 60, net: 3.5, hide: true }, { fps: 30, net: 40, hide: true }, { fps: 60, net: 5 }, { fps: 120, net: 3.5 }, { fps: 30, net: 3.5 }, { fps: 60, net: 3.5, measured: true }, { fps: 60, net: 3.5, measured: true, yaw: 3 }])) {
    let n = 0, found = 0, eS = 0, eL = 0, eD = 0; const lines = [];
    for (const [i, c] of cases.entries()) for (const phase of [0.15, 0.5, 0.85]) {
      const r = render(c, { ...cfg, phase, seed: 11 + i });
      const eng = new ShotEngine({ hfovDeg: 67, view: 'dtl', camH: 1, ballDist: cfg.measured ? r.dist : 0 }); const ev = []; eng.onEvent = (e) => ev.push(e);
      for (const f of r.frames) eng.pushFrame(f.g, r.sc.w, r.sc.h, f.t);
      n++; const s = ev.find((e) => e.type === 'shot');
      if (s) { found++; const L = s.launch; eS += Math.abs(L.speed / c.speed - 1); eL += Math.abs(L.launch - c.launch); eD += Math.abs(L.direction - c.direction); lines.push(`${c.speed}/${c.launch}/${c.direction} → ${L.speed.toFixed(1)}/${L.launch.toFixed(1)}/${L.direction.toFixed(1)} (${L.points} pts)`); }
      else lines.push(`${c.speed}/${c.launch}/${c.direction} → ${ev.map((e) => e.type + (e.reason ? ':' + e.reason : '')).join(',')}`);
      const bad = ev.filter((e) => e.type === 'moved' || e.type === 'missed' || (e.type === 'shot' && e !== s)).length; if (bad) lines.push(`   !! false events: ${ev.map((e) => e.type).join(',')}`);
    }
    console.log(`\n${JSON.stringify(cfg)}: found ${found}/${n} · average error: speed ${((eS / found) * 100).toFixed(1)}% · launch ${(eL / found).toFixed(1)}° · direction ${(eD / found).toFixed(1)}°`);
    if (process.argv.includes('-v')) console.log(lines.join('\n'));
  }
}
