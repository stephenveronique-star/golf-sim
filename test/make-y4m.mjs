// Builds a fake-camera video (Y4M) for Chrome: two shots with known launch numbers.
import { makeScene, renderShot } from './synth.mjs';
import fs from 'node:fs';
const out = process.argv[2] || '/tmp/golf.y4m';
const sc = makeScene({ seed: 11 });
const shots = [
  { speed: 54, launch: 16, direction: 0, hand: 1 },
  { speed: 70, launch: 11, direction: -3, hand: 1 },
];
const fd = fs.openSync(out, 'w');
fs.writeSync(fd, `YUV4MPEG2 W${sc.w} H${sc.h} F60:1 Ip A1:1 C420jpeg\n`);
const uv = Buffer.alloc((sc.w / 2) * (sc.h / 2) * 2, 128);
let n = 0;
for (const s of shots) {
  const { frames, truth } = renderShot(sc, s, { fps: 60, dist: 3.0, phase: 0.4, duration: 2.6, reteeAt: 1.6, tImpact: 1.0 });
  console.log('ball at', truth.ball.x.toFixed(1), truth.ball.y.toFixed(1), 'd', truth.ballD.toFixed(1), 'truth', s);
  for (const f of frames) { for (let b = 0; b < 12; b++) { const v = (n >> b) & 1 ? 255 : 0; for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 6; xx++) f.g[yy * sc.w + b * 8 + xx] = v; } fs.writeSync(fd, 'FRAME\n'); fs.writeSync(fd, Buffer.from(f.g.buffer, f.g.byteOffset, f.g.length)); fs.writeSync(fd, uv); n++; }
}
fs.closeSync(fd);
console.log('frames', n);
