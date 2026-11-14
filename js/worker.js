// Capture worker: receives camera frames, converts them to grayscale and runs
// the ShotEngine off the main thread so no frames are missed.
import { ShotEngine, findBallCandidates } from './tracker.js';

let opts = { hfovDeg: 67, threshold: 14, procW: 960 };
const engine = new ShotEngine({ hfovDeg: opts.hfovDeg, threshold: opts.threshold });
let canvas = null, ctx = null, gray = null;
let procMs = 0, frames = 0, lastStatus = 0;
let reader = null;

// Small grey copies of the camera picture for the swing check (~10 a second,
// last 3.8 s), made here so the page itself never has to grab extra pictures.
let snaps = [], lastSnapT = -1;
function keepSnap(g, w, h, t) {
  if (t - lastSnapT < 0.095) return;
  lastSnapT = t;
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    const r0 = 2 * y * w, r1 = r0 + w, o = y * w2;
    for (let x = 0; x < w2; x++) { const i = 2 * x; out[o + x] = (g[r0 + i] + g[r0 + i + 1] + g[r1 + i] + g[r1 + i + 1]) >> 2; }
  }
  snaps.push({ t, w: w2, h: h2, g: out });
  while (snaps.length && t - snaps[0].t > 3.8) snaps.shift();
}

engine.onEvent = (ev) => {
  const out = { ...ev };
  const transfer = [];
  if (out.frames) {
    out.frames = out.frames.map((f) => { transfer.push(f.g.buffer); return f; });
  }
  if (out.track) out.track = { pts: out.track.pts.map((p) => ({ x: p.x, y: p.y, d: p.d, t: p.t })), tImp: out.track.tImp };
  self.postMessage({ type: 'event', ev: out }, transfer);
  status(true);
};

function status(force) {
  const now = performance.now();
  if (!force && now - lastStatus < 250) return;
  lastStatus = now;
  const b = engine.ball;
  self.postMessage({ type: 'status', state: engine.state, fps: engine.fps, procMs, w: engine.w, h: engine.h, frames,
    ball: b ? { x: b.x, y: b.y, d: b.d } : null });
}

function processSource(src, sw, sh, t) {
  const t0 = performance.now();
  const W = Math.min(opts.procW, sw), H = Math.round((sh * W) / sw);
  if (!canvas || canvas.width !== W || canvas.height !== H) {
    canvas = new OffscreenCanvas(W, H);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    gray = new Uint8Array(W * H);
  }
  ctx.drawImage(src, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = ((d[i] * 2 + d[i + 1] + d[i + 2] * 2) * 51) >> 8;
  engine.pushFrame(gray, W, H, t);
  keepSnap(gray, W, H, t);
  procMs = procMs * 0.9 + (performance.now() - t0) * 0.1;
  frames++;
  status(false);
}

function onVideoFrame(frame) {
  try {
    processSource(frame, frame.displayWidth, frame.displayHeight, frame.timestamp / 1e6);
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  } finally {
    frame.close();
  }
}

async function readTrack(track) {
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    self.postMessage({ type: 'unsupported' });
    return;
  }
  try {
    const proc = new MediaStreamTrackProcessor({ track });
    reader = proc.readable.getReader();
    self.postMessage({ type: 'reading' });
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onVideoFrame(value);
    }
  } catch (e) {
    self.postMessage({ type: 'unsupported', message: String(e && e.message || e) });
  }
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.cmd) {
    case 'config':
      opts = { ...opts, ...m.opts };
      engine.opts.hfovDeg = opts.hfovDeg; engine.opts.threshold = opts.threshold;
      if (opts.autoFind != null) engine.opts.autoFind = opts.autoFind;
      engine.opts.ballDist = +opts.ballDist || 0;
      engine.opts.teeSpot = opts.teeSpot || null;
      break;
    case 'track': readTrack(m.track); break;
    case 'frame': onVideoFrame(m.frame); break;
    case 'gray': {
      const g = new Uint8Array(m.buf);
      const t0 = performance.now();
      engine.pushFrame(g, m.w, m.h, m.t);
      keepSnap(g, m.w, m.h, m.t);
      procMs = procMs * 0.9 + (performance.now() - t0 + (m.prepMs || 0)) * 0.1;
      frames++;
      self.postMessage({ type: 'buf', buf: m.buf }, [m.buf]);
      status(false);
      break;
    }
    case 'setBall': {
      const b = engine.setBall(m.x, m.y);
      self.postMessage({ type: 'setBall', id: m.id, ball: b ? { x: b.x, y: b.y, d: b.d } : null });
      status(true);
      break;
    }
    case 'reset': engine.reset(); status(true); break;
    case 'hold': engine.hold = !!m.on; break;
    case 'snaps': {
      const pick = snaps.filter((p) => p.t >= m.t0 && p.t <= m.t1);
      snaps = snaps.filter((p) => !pick.includes(p));
      self.postMessage({ type: 'snaps', id: m.id, frames: pick.map((p) => ({ t: p.t, w: p.w, h: p.h, buf: p.g.buffer })) }, pick.map((p) => p.g.buffer));
      break;
    }
    case 'debug': {
      const fr = engine.latest();
      let cands = [];
      if (fr) {
        const dMax = Math.max(12, Math.round(engine.w * 0.03));
        cands = findBallCandidates(fr.g, engine.w, engine.h, { dMin: Math.max(4, engine.w * 0.005), dMax, contrast: engine.opts.autoContrast ?? 35 })
          .map((c) => ({ x: c.x, y: c.y, d: c.d, contrast: c.contrast }));
      }
      const b = engine.ball;
      self.postMessage({ type: 'debug', id: m.id, cands, state: engine.state, fps: engine.fps, procMs, w: engine.w, h: engine.h, frames,
        ball: b ? { x: b.x, y: b.y, d: b.d, contrast: b.contrast } : null, bufLen: engine.buf.length });
      break;
    }
    case 'stop': try { reader && reader.cancel(); } catch { /* ignore */ } reader = null; engine.reset(); break;
  }
};
