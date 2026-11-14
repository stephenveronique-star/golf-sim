// Worst case: after Ready, the picture turns to pure noise (everything "moves").
// Before the fix this could hang the detector; now it must answer fast.
import { makeScene, renderShot, makeRng } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const sc = makeScene({ seed: 61 });
const { frames, truth } = renderShot(sc, { speed: 54, launch: 16, direction: 0, hand: 1 }, { fps: 60, dist: 3.0, tImpact: 9, duration: 1.2 });
const eng = new ShotEngine({ hfovDeg: 67 }); const ev = []; eng.onEvent = (e) => ev.push(e);
for (const f of frames) { eng.pushFrame(f.g, sc.w, sc.h, f.t); if (f.t > 0.3 && f.t < 0.32) eng.setBall(truth.ball.x, truth.ball.y); }
const rng = makeRng(5); let worst = 0, t = 1.2;
for (let k = 0; k < 40; k++, t += 1 / 60) {
  const g = new Uint8Array(sc.w * sc.h); for (let i = 0; i < g.length; i++) g[i] = (rng() * 255) | 0;
  const t0 = performance.now(); eng.pushFrame(g, sc.w, sc.h, t); worst = Math.max(worst, performance.now() - t0);
}
console.log(ev.map((e) => e.type).join(' '), '· slowest frame', worst.toFixed(0), 'ms');
