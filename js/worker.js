// Capture worker: receives camera frames, converts them to grayscale and runs
// the ShotEngine off the main thread so no frames are missed.
import { ShotEngine, findBallCandidates } from './tracker.js';

let opts = { hfovDeg: 67, threshold: 14, procW: 960 };
const engine = new ShotEngine({ hfovDeg: opts.hfovDeg, threshold: opts.threshold });
let canvas = null, ctx = null, gray = null;
let procMs = 0, frames = 0, lastStatus = 0, lastThumb = 0, tcv = null, tctx = null;
let reader = null;

// Small grey copies of the camera picture for the swing check (~10 a second,
// last 3.8 s), made here so the page itself never has to grab extra pictures.
let snaps = [], lastSnapT = -1;
function keepSnap(g, w, h, t) {
  if (t - lastSnapT < 0.045) return; // ~20 a second
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
  // the camera's own pictures can arrive turned compared with what is on screen; opts.rot says how far to turn them back
  const rot = opts.rot || 0, side = rot === 90 || rot === 270, ow = side ? sh : sw, oh = side ? sw : sh;
  const W = Math.min(opts.procW, ow), H = Math.round((oh * W) / ow);
  if (!canvas || canvas.width !== W || canvas.height !== H) {
    canvas = new OffscreenCanvas(W, H);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    gray = new Uint8Array(W * H);
  }
  if (rot) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(W / 2, H / 2); ctx.rotate((rot * Math.PI) / 180); if (side) ctx.drawImage(src, -H / 2, -W / 2, H, W); else ctx.drawImage(src, -W / 2, -H / 2, W, H); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  else ctx.drawImage(src, 0, 0, W, H);
  if (t0 - lastThumb > 1000 && opts.thumbs) { // a tiny copy, as it arrived, so the page can check which way up it is
    lastThumb = t0; const tw = sw >= sh ? 48 : 27, th = sw >= sh ? 27 : 48;
    if (!tcv || tcv.width !== tw || tcv.height !== th) { tcv = new OffscreenCanvas(tw, th); tctx = tcv.getContext('2d', { willReadFrequently: true }); }
    tctx.drawImage(src, 0, 0, tw, th); const td = tctx.getImageData(0, 0, tw, th).data, tg = new Uint8Array(tw * th); for (let i = 0, j = 0; j < tg.length; i += 4, j++) tg[j] = (td[i] + td[i + 1] * 2 + td[i + 2]) >> 2;
    self.postMessage({ type: 'thumb', w: tw, h: th, g: tg, sw, sh });
  }
  const d = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = ((d[i] * 3 + d[i + 1] * 2) * 51) >> 8;
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

let curTrack = null, readGen = 0;
async function stopTrack() { opts.thumbs = false; readGen++; try { if (reader) await reader.cancel(); } catch { /* ignore */ } reader = null; try { curTrack && curTrack.stop(); } catch { /* ignore */ } curTrack = null; }
async function readTrack(track) {
  await stopTrack(); curTrack = track; const gen = readGen;
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    self.postMessage({ type: 'unsupported' });
    return;
  }
  try {
    const proc = new MediaStreamTrackProcessor({ track });
    reader = proc.readable.getReader();
    self.postMessage({ type: 'reading' }); opts.thumbs = true;
    for (;;) {
      const { value, done } = await reader.read();
      if (done || gen !== readGen) { value && value.close && value.close(); break; }
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
      engine.opts.view = opts.view === 'dtl' ? 'dtl' : 'face'; engine.opts.camH = +opts.camH || 1;
      break;
    case 'track': readTrack(m.track); break;
    case 'stopTrack': stopTrack(); break;
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
