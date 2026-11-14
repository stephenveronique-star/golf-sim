// Face-on swing checks from body landmarks (MediaPipe Pose, 33 points).
// DOM-free so it can be tested in Node. Coordinates are pixels in the
// analysis frame (same frame as the ball tracker), y down.
//
// The phone faces the golfer. "s" is +1 when the target is to the right of
// the screen (right-handed golfer facing the phone), -1 when to the left.

export const LM = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30,
};

// Club groups with suggested ranges (face-on, rules of thumb).
// stance = ankle-centre width / shoulder-joint width
// ballPos = 0 at the trail ankle, 1 at the lead ankle
// tilt = spine tilt away from the target at address, degrees
export const GROUPS = {
  driver: { name: 'driver', stance: [1.25, 1.6], ballPos: [0.8, 1.0], tilt: [3, 15], handsAhead: [-6, 6] },
  wood:   { name: 'fairway wood', stance: [1.15, 1.5], ballPos: [0.7, 0.9], tilt: [2, 12], handsAhead: [-5, 7] },
  long:   { name: 'hybrid / long iron', stance: [1.1, 1.4], ballPos: [0.6, 0.8], tilt: [1, 10], handsAhead: [-3, 9] },
  mid:    { name: 'mid iron', stance: [1.0, 1.3], ballPos: [0.5, 0.65], tilt: [0, 9], handsAhead: [-2, 10] },
  short:  { name: 'short iron', stance: [0.9, 1.2], ballPos: [0.45, 0.6], tilt: [-1, 8], handsAhead: [-2, 10] },
  wedge:  { name: 'wedge', stance: [0.8, 1.1], ballPos: [0.4, 0.55], tilt: [-2, 7], handsAhead: [-2, 10] },
};
export function clubGroup(id) {
  if (id === 'DR') return GROUPS.driver;
  if (id === '3W' || id === '5W') return GROUPS.wood;
  if (id === 'HY' || id === '3I' || id === '4I') return GROUPS.long;
  if (id === '5I' || id === '6I' || id === '7I') return GROUPS.mid;
  if (id === '8I' || id === '9I') return GROUPS.short;
  return GROUPS.wedge;
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function avgFrames(frames) {
  // point-by-point median of several frames (robust to one bad detection)
  const med = (arr) => { const v = arr.slice().sort((p, q) => p - q); return v[v.length >> 1]; };
  return frames[0].map((_, i) => ({
    x: med(frames.map((f) => f[i].x)), y: med(frames.map((f) => f[i].y)), v: Math.min(...frames.map((f) => f[i].v)),
  }));
}

/**
 * @param frames [{t, lm:[{x,y,v}]}]  landmarks in pixels, time-ordered
 * @param o { tImp, ball:{x,y,d}, club, s (+1/-1), heightCm }
 * @returns { ok, reason?, phases, metrics, tips[], good[] }
 */
export function analyseSwing(frames, o) {
  const s = o.s >= 0 ? 1 : -1;
  const need = [LM.nose, LM.lSh, LM.rSh, LM.lWr, LM.rWr, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnk, LM.rAnk];
  let usable = frames.filter((f) => f.lm && need.every((i) => f.lm[i] && f.lm[i].v > 0.35));
  // drop frames whose proportions don't make sense (collapsed shoulders, legs)
  if (usable.length >= 4) {
    const med = (arr) => { const v = arr.slice().sort((p, q) => p - q); return v[v.length >> 1]; };
    const shW = (f) => Math.hypot(f.lm[LM.lSh].x - f.lm[LM.rSh].x, f.lm[LM.lSh].y - f.lm[LM.rSh].y);
    const legL = (f) => Math.hypot(f.lm[LM.lHip].x - f.lm[LM.lAnk].x, f.lm[LM.lHip].y - f.lm[LM.lAnk].y);
    const mS = med(usable.map(shW)), mL = med(usable.map(legL));
    usable = usable.filter((f) => shW(f) > 0.55 * mS && legL(f) > 0.7 * mL && legL(f) < 1.4 * mL);
  }
  if (usable.length < 4) {
    const any = frames.find((f) => f.lm);
    const feet = any && [LM.lAnk, LM.rAnk].every((i) => any.lm[i].v > 0.35);
    const head = any && any.lm[LM.nose].v > 0.35;
    return { ok: false, reason: !any ? 'nobody' : !feet ? 'feet' : !head ? 'head' : 'unclear', seen: frames.filter((f) => f.lm).length };
  }
  const T = (f) => f.t;
  const wr = (f) => mid(f.lm[LM.lWr], f.lm[LM.rWr]);
  const hipM = (f) => mid(f.lm[LM.lHip], f.lm[LM.rHip]);
  const shM = (f) => mid(f.lm[LM.lSh], f.lm[LM.rSh]);

  // impact: nearest usable frame to the impact time
  let imp = usable.reduce((b, f) => (Math.abs(T(f) - o.tImp) < Math.abs(T(b) - o.tImp) ? f : b), usable[0]);
  if (Math.abs(T(imp) - o.tImp) > 0.15) imp = null;
  // address: the still period at the start, before the hands begin to move
  const torso = dist(shM(usable[0]), hipM(usable[0]));
  const early = usable.filter((f) => T(f) < o.tImp - 0.6);
  if (early.length < 2) return { ok: false, reason: 'address', seen: usable.length };
  const w0 = wr(early[0]);
  let k = 0;
  while (k + 1 < usable.length && T(usable[k + 1]) < o.tImp - 0.75 && dist(wr(usable[k + 1]), w0) < torso * 0.15) k++;
  // if the first frames were already moving (waggle), fall back to the frames
  // where the hands were lowest and still
  const addrFrames = usable.slice(Math.max(0, k - 4), k + 1);
  const A = avgFrames(addrFrames.map((f) => f.lm));
  const addr = { t: T(addrFrames[addrFrames.length - 1]), lm: A };
  const wA = mid(A[LM.lWr], A[LM.rWr]);
  // top of the backswing: hands furthest up and back (away from the target)
  const back = usable.filter((f) => T(f) > addr.t && T(f) < o.tImp - 0.12);
  if (!back.length) return { ok: false, reason: 'backswing', seen: usable.length };
  const score = (f) => (wA.y - wr(f).y) + 0.6 * s * (wA.x - wr(f).x);
  const top = back.reduce((b2, f) => (score(f) > score(b2) ? f : b2), back[0]);
  if (score(top) < torso * 0.4) return { ok: false, reason: 'backswing', seen: usable.length };
  const after = usable.filter((f) => T(f) > o.tImp + 0.3);
  const fin = after.length ? after[after.length - 1] : null;

  // scale: legs (hip-knee-ankle) are ~49% of height and barely change with posture
  const leg = (f, h, k, a) => dist(f.lm[h], f.lm[k]) + dist(f.lm[k], f.lm[a]);
  const legPx = (leg(addr, LM.lHip, LM.lKnee, LM.lAnk) + leg(addr, LM.rHip, LM.rKnee, LM.rAnk)) / 2;
  let cmPerPx, scaleFrom;
  const byBall = (4.27 / o.ball.d) * 1.22; // golfer stands ~0.6 m further from the phone than the ball
  if (o.heightCm && legPx > 20) {
    cmPerPx = (0.49 * o.heightCm) / legPx; scaleFrom = 'height';
    const r = cmPerPx / byBall;
    if (r < 0.75 || r > 1.33) { cmPerPx = Math.sqrt(cmPerPx * byBall); scaleFrom = 'height+ball'; }
  } else { cmPerPx = byBall; scaleFrom = 'ball'; }
  const cm = (px) => px * cmPerPx;

  // Feet stay planted from address to impact: take the median over all those
  // frames (sorted by screen position, so left/right label swaps don't matter).
  const med = (arr) => { const v = arr.slice().sort((p, q) => p - q); return v[v.length >> 1]; };
  const planted = usable.filter((f) => T(f) <= o.tImp + 0.02);
  const sideX = (f, which) => { const xs = [f.lm[LM.lAnk].x, f.lm[LM.rAnk].x]; return which > 0 ? Math.max(...xs) : Math.min(...xs); };
  const ankY = med(planted.map((f) => (f.lm[LM.lAnk].y + f.lm[LM.rAnk].y) / 2));
  const lead = { x: med(planted.map((f) => sideX(f, s))), y: ankY };
  const trail = { x: med(planted.map((f) => sideX(f, -s))), y: ankY };
  // Shoulders look widest when square to the phone (address, impact): use a
  // high percentile over the swing, then sanity-check against height.
  const shWs = usable.map((f) => Math.abs(f.lm[LM.lSh].x - f.lm[LM.rSh].x)).sort((p, q) => p - q);
  let shoulderPx = Math.max(med(addrFrames.map((f) => Math.abs(f.lm[LM.lSh].x - f.lm[LM.rSh].x))), shWs[Math.floor(shWs.length * 0.8)]);
  if (o.heightCm) { // shoulder joints are roughly 19–29% of height apart
    const lo = (0.19 * o.heightCm) / cmPerPx, hi = (0.29 * o.heightCm) / cmPerPx;
    shoulderPx = Math.min(hi, Math.max(lo, shoulderPx));
  }
  const stancePx = Math.abs(lead.x - trail.x);
  const g = clubGroup(o.club);

  const m = {};
  m.stanceRatio = stancePx / Math.max(1, shoulderPx);
  m.stanceCm = cm(stancePx);
  m.shoulderCm = cm(shoulderPx);
  m.ballPos = (o.ball.x - trail.x) / ((lead.x - trail.x) || 1);
  const hipA = mid(A[LM.lHip], A[LM.rHip]), shA = mid(A[LM.lSh], A[LM.rSh]);
  m.tilt = (Math.atan2(s * (hipA.x - shA.x), hipA.y - shA.y) * 180) / Math.PI; // + = shoulders behind hips
  m.handsAheadCm = cm(s * (mid(A[LM.lWr], A[LM.rWr]).x - o.ball.x));
  m.headTopCm = cm(s * (top.lm[LM.nose].x - A[LM.nose].x));
  m.hipTopCm = cm(s * (hipM(top).x - hipA.x));
  if (imp) {
    m.hipImpCm = cm(s * (hipM(imp).x - hipA.x));
    m.headImpCm = cm(s * (imp.lm[LM.nose].x - A[LM.nose].x));
  }
  if (fin) m.finishHipCm = cm(s * (hipM(fin).x - lead.x));

  // ------------------------------------------------ tips (worst first)
  const tips = [], good = [];
  const add = (sev, key, text, short) => tips.push({ sev, key, text, short });
  const [sLo, sHi] = g.stance;
  const ideal = (sLo + sHi) / 2 * shoulderPx;
  if (m.stanceRatio < sLo) add((sLo - m.stanceRatio) / 0.1, 'stance-narrow', `Stance is narrow for a ${g.name}: feet about ${Math.round(m.stanceCm)} cm apart. Try about ${Math.round(cm(ideal))} cm (centre of the ankles).`, 'Widen your stance a little');
  else if (m.stanceRatio > sHi) add((m.stanceRatio - sHi) / 0.1, 'stance-wide', `Stance is wide for a ${g.name}: feet about ${Math.round(m.stanceCm)} cm apart. Try about ${Math.round(cm(ideal))} cm.`, 'Narrow your stance a little');
  else good.push(`Stance width good for a ${g.name} (${Math.round(m.stanceCm)} cm)`);

  const [bLo, bHi] = g.ballPos;
  const bpCm = (v) => Math.round(Math.abs(v) * cm(stancePx));
  if (m.ballPos < bLo) add((bLo - m.ballPos) / 0.07, 'ball-back', `Ball is back in your stance for a ${g.name}. Move it about ${bpCm(bLo - m.ballPos + 0.03)} cm towards your front foot.`, 'Ball further forward');
  else if (m.ballPos > bHi) add((m.ballPos - bHi) / 0.07, 'ball-forward', `Ball is forward in your stance for a ${g.name}. Move it about ${bpCm(m.ballPos - bHi + 0.03)} cm back towards the middle.`, 'Ball further back');
  else good.push('Ball position good');

  if (m.headTopCm < -10) add((-m.headTopCm - 10) / 4 + 1, 'head-sway', `Your head moved ${Math.round(-m.headTopCm)} cm away from the target on the backswing. Turn around a steady head instead of sliding — a big cause of fat and thin shots.`, 'Keep your head steadier on the backswing');
  else good.push(`Head steady on the backswing (${Math.round(Math.abs(m.headTopCm))} cm)`);
  if (m.hipTopCm < -11 && m.headTopCm < -3) add((-m.hipTopCm - 11) / 4 + 1, 'hip-sway', `Your hips slid ${Math.round(-m.hipTopCm)} cm away from the target on the backswing. Turn your hips — feel the trail hip go back, not sideways.`, 'Turn your hips, don’t slide them');
  if (m.hipImpCm != null) {
    if (m.hipImpCm < -6 || (m.hipImpCm < 0 && m.finishHipCm != null && m.finishHipCm < -18)) add(1.5 + -m.hipImpCm / 5, 'hang-back', `At impact your hips were ${Math.round(-m.hipImpCm)} cm behind where they started — you’re hanging back. Shift onto your front foot as you start down.`, 'Get onto your front foot');
    else if (m.hipImpCm > 4) good.push(`Weight moving forward through impact (${Math.round(m.hipImpCm)} cm)`);
  }
  if (m.headImpCm != null && m.headImpCm > 10) add((m.headImpCm - 10) / 4 + 1, 'head-forward', `Your head moved ${Math.round(m.headImpCm)} cm towards the target by impact. Keep it behind the ball through the hit.`, 'Keep your head behind the ball');
  if (m.finishHipCm != null) {
    if (m.finishHipCm < -18) add((-m.finishHipCm - 18) / 5 + 1, 'finish-back', 'You finished with your weight on your back foot. Finish tall with your belt buckle facing the target and your weight on the front foot.', 'Finish on your front foot');
    else good.push('Balanced finish');
  }
  const [tLo, tHi] = g.tilt;
  if (m.tilt < tLo - 7) add((tLo - 7 - m.tilt) / 3 + 0.5, 'tilt-forward', `At address your upper body leans towards the target (${Math.round(m.tilt)}°). Tilt your spine slightly away from the target, trail shoulder a little lower.`, 'Tilt slightly away from the target at address');
  else if (m.tilt > tHi + 8) add((m.tilt - tHi - 8) / 3 + 0.5, 'tilt-back', `At address you lean well away from the target (${Math.round(m.tilt)}°). Stand a bit more centred over the ball.`, 'Stand more centred at address');
  const [hLo, hHi] = g.handsAhead;
  if (m.handsAheadCm < hLo - 6) add((hLo - 6 - m.handsAheadCm) / 3 + 0.5, 'hands-back', `At address your hands are ${Math.round(-m.handsAheadCm)} cm behind the ball. For a ${g.name}, set your hands level with or just ahead of the ball.`, 'Hands level with or ahead of the ball');

  tips.sort((a, b) => b.sev - a.sev);
  // only clear faults become tips; borderline readings stay quiet
  const shown = tips.filter((t) => t.sev >= 0.75);
  return {
    ok: true, club: o.club, group: g.name, s, scaleFrom, cmPerPx,
    phases: { addr: addr.t, top: T(top), imp: imp ? T(imp) : null, fin: fin ? T(fin) : null },
    frames: { addr, top, imp, fin },
    metrics: m, tips: shown, minor: tips.filter((t) => t.sev < 0.75), good, used: usable.length,
  };
}
