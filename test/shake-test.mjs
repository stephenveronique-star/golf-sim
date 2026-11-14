// The phone gets nudged (whole picture shifts) while armed: must NOT count as a shot,
// must keep/refind the ball, and a real shot afterwards must still be read.
import { makeScene, renderShot } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';
const sc = makeScene({ seed: 31 });
const { frames, truth } = renderShot(sc, { speed: 54, launch: 16, direction: 0, hand: 1 }, { fps: 60, dist: 3.0, tImpact: 3.0, duration: 4.0, reteeAt: 3.6 });
const shift = (g, dx, dy) => { const o = new Uint8Array(g.length); for (let y = 0; y < sc.h; y++) for (let x = 0; x < sc.w; x++) { const X = Math.min(sc.w - 1, Math.max(0, x - dx)), Y = Math.min(sc.h - 1, Math.max(0, y - dy)); o[y * sc.w + x] = g[Y * sc.w + X]; } return o; };
for (const [label, fn] of [
  ['small nudge 4px', (t) => (t > 1.6 ? [4, 2] : [0, 0])],
  ['big bump 35px, shaky 0.4 s', (t) => (t > 1.4 && t < 1.8 ? [Math.round(25 * Math.sin(t * 70)), Math.round(12 * Math.cos(t * 55))] : t >= 1.8 ? [35, 8] : [0, 0])],
  ['wobble 0.3 s then settles 9px', (t) => (t > 1.6 && t < 1.9 ? [Math.round(15 * Math.sin(t * 60)), Math.round(8 * Math.cos(t * 50))] : t >= 1.9 ? [9, 3] : [0, 0])],
]) {
  const eng = new ShotEngine({ hfovDeg: 67 }); const ev = []; eng.onEvent = (e) => ev.push(e);
  let armed = false;
  for (const f of frames) {
    const [dx, dy] = fn(f.t);
    eng.pushFrame(dx || dy ? shift(f.g, dx, dy) : f.g, sc.w, sc.h, f.t);
    if (!armed && f.t > 0.3) armed = !!eng.setBall(truth.ball.x, truth.ball.y);
  }
  const shots = ev.filter((e) => e.type === 'shot');
  console.log(label.padEnd(30), ev.map((e) => e.type === 'shot' ? `shot(${e.launch.speed.toFixed(1)}@${e.launch.launch.toFixed(1)})` : e.type).filter((x, i, a) => x !== 'nudged' || a[i - 1] !== 'nudged').join(' '), shots.length === 1 && Math.abs(shots[0].launch.speed - 54) < 2.2 ? 'OK' : 'CHECK');
}
