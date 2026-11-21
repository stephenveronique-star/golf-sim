// Playing a round: invented courses, where the ball ends up after each shot, and scoring.
// Hole coordinates are metres: x runs from the tee towards the green, z is sideways (+ = right of play).

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Build a hole from a short description. */
export function genHole({ len, par, shape = 'straight', water = 'none' }) {
  const sgn = shape === 'left' ? -1 : shape === 'right' ? 1 : 0;
  let path;
  if (!sgn || par === 3) path = [{ x: 0, z: 0 }, { x: len, z: 0 }];
  else {
    const a = (33 * Math.PI) / 180, l1 = len * 0.58, l2 = len - l1;
    path = [{ x: 0, z: 0 }, { x: l1, z: 0 }, { x: l1 + l2 * Math.cos(a), z: sgn * l2 * Math.sin(a) }];
  }
  const pin = path[path.length - 1], prev = path[path.length - 2];
  const ux = (pin.x - prev.x) / dist(pin, prev), uz = (pin.z - prev.z) / dist(pin, prev);
  const at = (back, side) => ({ x: pin.x - ux * back - uz * side, z: pin.z - uz * back + ux * side });
  const haz = [{ type: 'bunker', ...at(4, 17), r: 6 }, { type: 'bunker', ...at(-6, -15), r: 5 }];
  if (par > 3) haz.push({ type: 'bunker', x: Math.min(205, len * 0.56), z: (sgn || 1) * -22, r: 8 });
  if (water === 'front') haz.push({ type: 'water', ...at(34, 0), r: 13 });
  if (water === 'side') haz.push({ type: 'water', ...at(18, -32), r: 17 });
  return { len, par, shape, water, path, fw: par === 3 ? 20 : 34, greenR: 11, haz };
}

// short way to write holes: 'par length [l|r] [front|side]'
const H = (...a) => a.map((t) => { const [par, len, ...r] = t.split(' '); return { par: +par, len: +len, shape: r.includes('l') ? 'left' : r.includes('r') ? 'right' : 'straight', water: r.includes('front') ? 'front' : r.includes('side') ? 'side' : 'none' }; });
export const COURSES = [
  { id: 'highveld18', name: 'Highveld Park · 18 holes', theme: 'park', holes: H('4 365', '5 495 r', '3 160', '4 340 l', '4 405', '3 145 front', '5 480 l side', '4 320', '4 390 r',
    '4 375', '3 175', '5 510 r', '4 350 l front', '4 410', '3 130 side', '4 335 r', '5 470', '4 400 l front') },
  { id: 'dune18', name: 'Dune Point Links · 18 holes', theme: 'links', holes: H('4 350', '4 395 l', '3 150', '5 505', '4 330 r', '3 185', '4 420', '5 460 l', '4 360',
    '3 135', '4 385 r', '4 410', '5 520 l', '3 165', '4 345', '4 300 r', '3 195', '5 485') },
  { id: 'redrock9', name: 'Red Rock Canyon · 9 holes', theme: 'desert', holes: H('4 380', '3 165', '5 500 l', '4 345 r', '4 415', '3 140 front', '5 475 r', '4 360 l', '4 395') },
  { id: 'pinewood9', name: 'Pinewood Forest · 9 holes', theme: 'forest', holes: H('4 330', '4 370 r', '3 140', '5 465 l', '4 355', '3 170 side', '4 390 l', '5 490 r front', '4 345') },
  { id: 'neon9', name: 'Neon Links · 9 holes', holes: [
    { len: 345, par: 4 }, { len: 150, par: 3 }, { len: 470, par: 5, shape: 'right' }, { len: 370, par: 4, shape: 'left', water: 'side' },
    { len: 135, par: 3, water: 'front' }, { len: 390, par: 4 }, { len: 505, par: 5, shape: 'left' }, { len: 175, par: 3 }, { len: 400, par: 4, shape: 'right', water: 'front' }] },
  { id: 'quick3', name: 'Quick Three · 3 holes', holes: [{ len: 320, par: 4 }, { len: 140, par: 3 }, { len: 455, par: 5, shape: 'right' }] },
  { id: 'short6', name: 'Short Circuit · 6 par 3s', holes: [{ len: 95, par: 3 }, { len: 125, par: 3, water: 'front' }, { len: 150, par: 3 }, { len: 110, par: 3, water: 'side' }, { len: 170, par: 3 }, { len: 140, par: 3 }] },
];
export const buildCourse = (c) => ({ ...c, holes: c.holes.map(genHole) });

const segs = (path) => path.slice(1).map((b, i) => ({ a: path[i], b, l: dist(path[i], b) }));
export function pointAt(path, s) {
  for (const g of segs(path)) { if (s <= g.l) { const k = Math.max(0, s) / g.l; return { x: g.a.x + (g.b.x - g.a.x) * k, z: g.a.z + (g.b.z - g.a.z) * k }; } s -= g.l; }
  return { ...path[path.length - 1] };
}
/** distance along the hole of the point on the centre line nearest p, and how far p is from it */
export function nearest(path, p) {
  let best = { s: 0, d: Infinity }, acc = 0;
  for (const g of segs(path)) {
    const k = Math.max(0, Math.min(1, ((p.x - g.a.x) * (g.b.x - g.a.x) + (p.z - g.a.z) * (g.b.z - g.a.z)) / (g.l * g.l)));
    const q = { x: g.a.x + (g.b.x - g.a.x) * k, z: g.a.z + (g.b.z - g.a.z) * k }, d = dist(p, q);
    if (d < best.d) best = { s: acc + k * g.l, d };
    acc += g.l;
  }
  return best;
}
export const pinOf = (hole) => hole.path[hole.path.length - 1];
export function lieAt(hole, p) {
  if (dist(p, pinOf(hole)) <= hole.greenR) return 'green';
  for (const h of hole.haz) if (dist(p, h) <= h.r) return h.type;
  const n = nearest(hole.path, p);
  if (n.d > 55 || p.x < -25) return 'oob';
  return n.d <= hole.fw / 2 ? 'fairway' : 'rough';
}
/** where to aim: the flag if it can be reached, otherwise down the fairway */
export function aimPoint(hole, p, reach) {
  const pin = pinOf(hole);
  if (hole.path.length === 2 || dist(p, pin) <= reach * 1.05) return pin;
  return pointAt(hole.path, nearest(hole.path, p).s + reach);
}
/** putts needed from d metres (a simple model of an average golfer) */
export function puttsFrom(d, rnd = Math.random) {
  if (d < 0.4) return 0;
  if (d < 1.2) return 1;
  if (d < 3) return rnd() < 0.55 ? 1 : 2;
  if (d < 9) return rnd() < 0.12 ? 1 : 2;
  return rnd() < 0.3 ? 3 : 2;
}
/**
 * Play one shot. st = { p, strokes }; shot = { total, offline, reach } in metres.
 * Returns the new state plus what happened.
 */
export function playShot(hole, st, shot, rnd = Math.random, manualPutt = false) {
  const pin = pinOf(hole), from = st.p;
  const lie0 = st.strokes === 0 ? 'tee' : lieAt(hole, from);
  const f = lie0 === 'rough' ? 0.9 : lie0 === 'bunker' ? 0.75 : 1;
  const aim = shot.aim || aimPoint(hole, from, shot.reach || shot.total);
  const d = dist(from, aim) || 1, ux = (aim.x - from.x) / d, uz = (aim.z - from.z) / d;
  const T = shot.total * f;
  const np = { x: from.x + ux * T - uz * shot.offline, z: from.z + uz * T + ux * shot.offline };
  let strokes = st.strokes + 1;
  const lie = lieAt(hole, np), out = { from, to: np, lie, lie0, flew: T };
  if (lie === 'water' || lie === 'oob') return { ...out, p: from, strokes: strokes + 1, penalty: true, done: false, msg: lie === 'water' ? 'In the water — one penalty stroke, play again from the same spot.' : 'Out of bounds — one penalty stroke, play again from the same spot.' };
  if (lie === 'green') {
    const left = dist(np, pin);
    if (manualPutt && left >= 0.4) return { ...out, p: np, strokes, done: false, onGreen: true, left, msg: `On the green, ${left.toFixed(1)} m from the flag. Time to putt.` };
    const putts = puttsFrom(left, rnd);
    return { ...out, p: pin, strokes: strokes + putts, putts, left, done: true, msg: putts === 0 ? 'Holed it!' : `On the green, ${left.toFixed(1)} m from the flag — ${putts} putt${putts > 1 ? 's' : ''}.` };
  }
  if (strokes >= hole.par * 2) return { ...out, p: np, strokes, done: true, pickedUp: true, msg: 'Picked up at double par — on to the next hole.' };
  return { ...out, p: np, strokes, done: false, msg: `${lie === 'fairway' ? 'Fairway' : lie === 'bunker' ? 'In the bunker (next shot goes about 25% shorter)' : 'In the rough (next shot goes about 10% shorter)'} — ${Math.round(dist(np, pin))} m to the flag.` };
}
/** One putt played by hand. putt = { len (metres it would roll), deg (aim error, + = right) } */
export function playPutt(hole, st, putt, slope = { a: 0, g: 0 }) {
  const pin = pinOf(hole), from = st.p, d = dist(from, pin) || 0.01, ux = (pin.x - from.x) / d, uz = (pin.z - from.z) / d;
  const a = (putt.deg * Math.PI) / 180, dx = ux * Math.cos(a) - uz * Math.sin(a), dz = uz * Math.cos(a) + ux * Math.sin(a);
  // the green's slope: gx,gz = downhill, in percent. Downhill putts run on, uphill ones pull up, side slopes make the ball curve.
  const gx = slope.g * Math.cos(slope.a), gz = slope.g * Math.sin(slope.a), along = gx * dx + gz * dz, cross = gx * -dz + gz * dx;
  const len = putt.len * (1 + 0.06 * along), side = (s) => 0.006 * cross * s * s;
  const strokes = st.strokes + 1, missAt = d * Math.sin(a) + side(d), miss = Math.abs(missAt), online = miss <= 0.11;
  if (online && len >= d - 0.03 && len <= d + 1.5) return { from, to: pin, p: pin, strokes, done: true, holed: true, holedFrom: d, msg: 'Holed it!' };
  const np = { x: from.x + dx * len - dz * side(len), z: from.z + dz * len + dx * side(len) }, left = dist(np, pin);
  if (strokes >= hole.par * 2 + 1) return { from, to: np, p: np, strokes, done: true, pickedUp: true, msg: 'Picked up, on to the next hole.' };
  const why = len < d - 0.03 ? (online ? 'On line but short' : 'Short') : online ? 'Too hard, it ran over the hole' : `Missed ${missAt > 0 ? 'right' : 'left'}`;
  return { from, to: np, p: np, strokes, done: false, left, msg: `${why}. ${left.toFixed(1)} m left.` };
}
export function scoreName(strokes, par) {
  const d = strokes - par;
  return strokes === 1 ? 'Hole in one!' : d <= -3 ? 'Albatross!' : d === -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `${d} over`;
}
