// Runs the ShotEngine over synthetic footage and compares with the truth.
import { makeScene, renderShot } from './synth.mjs';
import { ShotEngine } from '../js/tracker.js';

const cases = [
  { name: 'Driver', speed: 75, launch: 11, direction: 0 },
  { name: 'Driver push', speed: 70, launch: 12, direction: 6 },
  { name: '7 iron', speed: 54, launch: 16, direction: -4 },
  { name: 'P wedge', speed: 45, launch: 24, direction: 2 },
  { name: 'S wedge', speed: 35, launch: 30, direction: 0 },
  { name: 'Chip', speed: 14, launch: 35, direction: 0 },
  { name: 'Lefty 7i', speed: 52, launch: 17, direction: 3, hand: -1 },
];
const configs = [
  { label: '60fps 3.0m', fps: 60, dist: 3.0 },
  { label: '60fps 2.5m', fps: 60, dist: 2.5 },
  { label: '120fps 3.0m', fps: 120, dist: 3.0 },
  { label: '30fps 3.0m', fps: 30, dist: 3.0 },
];
const only = process.argv[2];
let fails = 0, n = 0;
for (const cfg of configs) {
  if (only && !cfg.label.includes(only)) continue;
  console.log(`\n== ${cfg.label}`);
  for (const c of cases) {
    for (const phase of [0.1, 0.55, 0.9]) {
      const sc = makeScene({ seed: 3 + Math.round(phase * 10) });
      const { frames, truth } = renderShot(sc, { hand: 1, ...c }, { fps: cfg.fps, dist: cfg.dist, phase, reteeShift: 0.02 });
      const eng = new ShotEngine({ hfovDeg: 67 });
      const events = [];
      eng.onEvent = (e) => events.push(e);
      let armed = false;
      for (const fr of frames) {
        eng.pushFrame(fr.g, sc.w, sc.h, fr.t);
        if (!armed && fr.t > 0.2) { const b = eng.setBall(truth.ball.x + 3, truth.ball.y - 2); armed = !!b; }
      }
      n++;
      const shot = events.find((e) => e.type === 'shot');
      const rearmed = events.filter((e) => e.type === 'armed').length >= 2;
      if (!shot) { fails++; console.log(`${c.name.padEnd(12)} ph${phase} MISSED (${events.map((e) => e.type).join(',')})`); continue; }
      const L = shot.launch;
      const es = (L.speed / c.speed - 1) * 100, el = L.launch - c.launch, ed = L.direction - (c.direction || 0);
      const bad = Math.abs(es) > 4 || Math.abs(el) > 1.5;
      if (bad) fails++;
      console.log(`${c.name.padEnd(12)} ph${phase} speed ${L.speed.toFixed(1)} (${es >= 0 ? '+' : ''}${es.toFixed(1)}%)  launch ${L.launch.toFixed(1)} (${el >= 0 ? '+' : ''}${el.toFixed(1)})  dir ${L.direction.toFixed(1)} (${ed >= 0 ? '+' : ''}${ed.toFixed(1)})  pts ${L.points}  dist ${L.distanceToBall.toFixed(2)}m  rearm ${rearmed ? 'y' : 'N'}${bad ? '  <-- BAD' : ''}`);
    }
  }
}
console.log(`\n${n - fails}/${n} within tolerance (speed ±4%, launch ±1.5°)`);
