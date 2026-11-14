// A bright round decoy lower in the picture than the ball: without a tee spot the
// app picks the decoy; with the tee spot saved it must pick the ball.
import { makeScene, renderShot } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const sc = makeScene({ seed: 41 });
const { frames, truth } = renderShot(sc, { speed: 54, launch: 16, direction: 0, hand: 1 }, { fps: 60, dist: 3.0, tImpact: 2.2, duration: 3.2, reteeAt: 3.0 });
const dx = 520, dy = 470, r = 6; // decoy: e.g. a white ball lying in the grass
for (const f of frames) for (let y = dy - r - 1; y <= dy + r + 1; y++) for (let x = dx - r - 1; x <= dx + r + 1; x++) { const c = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - dx, y - dy))); const i = y * sc.w + x; f.g[i] = Math.round(f.g[i] + (240 - f.g[i]) * c); }
for (const tee of [null, { x: truth.ball.x / sc.w, y: truth.ball.y / sc.h }]) {
  const eng = new ShotEngine({ hfovDeg: 67, teeSpot: tee }); const ev = []; eng.onEvent = (e) => ev.push(e);
  for (const f of frames) eng.pushFrame(f.g, sc.w, sc.h, f.t);
  const a = ev.find((e) => e.type === 'armed'), sh = ev.find((e) => e.type === 'shot');
  const onBall = a && Math.hypot(a.ball.x - truth.ball.x, a.ball.y - truth.ball.y) < 4;
  console.log(ev.map((e) => e.type + (e.reason ? ':' + e.reason : '')).join(','));
  console.log(tee ? 'tee spot saved: ' : 'no tee spot:    ', a ? `armed on ${a.ball.x.toFixed(0)},${a.ball.y.toFixed(0)} (${onBall ? 'the ball' : 'the DECOY'})` : 'not armed', sh ? `· shot ${sh.launch.speed.toFixed(1)} m/s ${sh.launch.launch.toFixed(1)}°` : '· no shot');
}
