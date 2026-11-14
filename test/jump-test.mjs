// Picture freezes for 1.5 s then jumps back (exposure changed meanwhile): the
// analysis must finish quickly (no hang), not report a shot, and re-arm.
import { makeScene, renderShot } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const sc = makeScene({ seed: 51 });
const { frames, truth } = renderShot(sc, { speed: 54, launch: 16, direction: 0, hand: 1 }, { fps: 60, dist: 3.0, tImpact: 4.0, duration: 4.6, reteeAt: 4.5 });
const eng = new ShotEngine({ hfovDeg: 67 }); const ev = []; eng.onEvent = (e) => ev.push(e);
let frozen = null, worst = 0;
for (const f of frames) {
  let g = f.g;
  if (f.t > 1.5 && f.t < 3.0) { frozen = frozen || g; g = frozen; }        // stuck picture (the app skips exact repeats, so these aren't fed)
  else if (f.t >= 3.0 && f.t < 3.4) { g = g.map((v, i) => Math.min(255, v + 35 + ((i * 7919) % 23))); } // picture comes back brighter, with texture change
  if (g === frozen && f.t > 1.52) continue;
  const t0 = performance.now(); eng.pushFrame(g, sc.w, sc.h, f.t); worst = Math.max(worst, performance.now() - t0);
  if (f.t > 0.3 && f.t < 0.32) eng.setBall(truth.ball.x, truth.ball.y);
}
console.log(ev.map((e) => e.type === 'shot' ? `shot(${e.launch.speed.toFixed(1)}@${e.launch.launch.toFixed(1)})` : e.type).filter((x, i, a) => x !== 'nudged' || a[i - 1] !== 'nudged').join(' '));
console.log('slowest frame', worst.toFixed(0), 'ms');
