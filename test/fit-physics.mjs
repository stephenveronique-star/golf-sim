// Fits the aerodynamic coefficients in js/physics.js to PGA Tour averages
// (carry, apex, landing angle), at a near-sea-level density.
import { simulate, CLUBS, MPH, YARD, airDensity } from '../js/physics.js';

const data = CLUBS.filter((c) => c.carry);
const rho = airDensity(100, 24);

function run(aero, c) {
  return simulate({ speed: c.ball * MPH, launch: c.launch, spin: c.spin, rho, aero });
}
function loss(v) {
  const aero = { cd0: v[0], cd1: v[1], clA: v[2], clB: v[3], cdV: v[4], spinTau: 25, rollK: 0.5 };
  if (v[0] < 0.1 || v[2] < 0.05 || v[3] < 0.1 || v[3] > 1.5 || v[1] < 0) return 1e9;
  let L = 0;
  for (const c of data) {
    const s = run(aero, c);
    const ec = (s.carry / YARD - c.carry) / c.carry;
    const ea = (s.apex / YARD - c.apex) / c.apex;
    const el = (s.landAngle - c.land) / c.land;
    L += ec * ec * 12 + ea * ea + el * el * 0.3;
  }
  return L;
}
// Nelder-Mead
function nm(f, x0, step = 0.05, iters = 600) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step * (Math.abs(p[i]) || 0.5); pts.push(p); }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = idx.map((i) => pts[i]); vals = idx.map((i) => vals[i]);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const xr = c.map((ci, j) => ci + (ci - pts[n][j])); const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((ci, j) => ci + 2 * (ci - pts[n][j])); const fe = f(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((ci, j) => ci + 0.5 * (pts[n][j] - ci)); const fc = f(xc);
      if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); }
    }
  }
  return { x: pts[0], f: vals[0] };
}
let best = nm(loss, [0.21, 0.28, 0.6, 0.45, 0.0]);
best = nm(loss, best.x, 0.02);
const [cd0, cd1, clA, clB, cdV] = best.x;
console.log('fit', { cd0: +cd0.toFixed(4), cd1: +cd1.toFixed(4), clA: +clA.toFixed(4), clB: +clB.toFixed(4), cdV: +cdV.toFixed(4) }, 'loss', best.f.toFixed(5));
const aero = { cd0, cd1, clA, clB, cdV, spinTau: 25, rollK: 0.5 };
console.log('club  carry(yd) tour  | apex sim tour | land sim tour');
for (const c of data) {
  const s = run(aero, c);
  console.log(c.id.padEnd(4), (s.carry / YARD).toFixed(1).padStart(7), String(c.carry).padStart(5), ' |', (s.apex / YARD).toFixed(1).padStart(5), String(c.apex).padStart(4), ' |', s.landAngle.toFixed(1).padStart(5), String(c.land).padStart(4));
}
