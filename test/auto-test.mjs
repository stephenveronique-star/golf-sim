// No tapping: the engine must find the ball by itself, read the shot, then re-arm.
import { makeScene, renderShot } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const cases = [
  { speed: 54, launch: 16, direction: 0 }, { speed: 72, launch: 11, direction: 3 }, { speed: 40, launch: 26, direction: -2 },
];
let ok = 0, n = 0;
for (const [i, c] of cases.entries()) for (const dist of [2.5, 3.0, 3.5]) {
  const sc = makeScene({ seed: 20 + i });
  const { frames, truth } = renderShot(sc, { hand: 1, ...c }, { fps: 60, dist, tImpact: 1.8, duration: 3.6, reteeAt: 2.4, reteeShift: 0.05 });
  const eng = new ShotEngine({ hfovDeg: 67 });
  const ev = []; eng.onEvent = (e) => ev.push(e);
  for (const f of frames) eng.pushFrame(f.g, sc.w, sc.h, f.t);
  n++;
  const arms = ev.filter((e) => e.type === 'armed');
  const shot = ev.find((e) => e.type === 'shot');
  const a0 = arms[0];
  const good = a0 && Math.hypot(a0.ball.x - truth.ball.x, a0.ball.y - truth.ball.y) < 3 && shot && Math.abs(shot.launch.speed / c.speed - 1) < 0.04 && arms.length >= 2;
  if (good) ok++;
  console.log(`dist ${dist} ${c.speed}m/s: armed ${arms.map((a) => a.how + '@' + a.ball.x.toFixed(0) + ',' + a.ball.y.toFixed(0)).join(' ')} (true ${truth.ball.x.toFixed(0)},${truth.ball.y.toFixed(0)} d${truth.ballD.toFixed(1)}) shot ${shot ? shot.launch.speed.toFixed(1) + ' ' + shot.launch.launch.toFixed(1) + '°' : 'NONE'} ${good ? 'OK' : 'FAIL'}`);
}
console.log(`${ok}/${n} found by itself, read, and re-armed`);
