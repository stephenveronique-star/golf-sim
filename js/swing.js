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

  return finish({ o, usable, addr, wA, torso, top, imp, fin, tips, good, m, view: 'face', extra: { ok: true, club: o.club, group: g.name, s, scaleFrom, cmPerPx } });
}

// ---------------------------------------------------------------- shared
const DRILLS = {
  'stance-narrow': 'Drill: lay a club across your toes. For mid-irons the insides of your heels sit about shoulder-width apart; go a little wider with woods.',
  'stance-wide': 'Drill: lay a club across your toes. For mid-irons the insides of your heels sit about shoulder-width apart; narrower for wedges.',
  'ball-back': 'Drill: put a club on the ground pointing at the ball from between your feet; move the ball a ball-width forward at a time until it sits right for the club.',
  'ball-forward': 'Drill: put a club on the ground pointing at the ball from between your feet; move the ball back until mid-irons sit just ahead of centre.',
  'head-sway': 'Drill: set up with your head against a wall or an alignment stick held by a friend; make slow backswings without your head pushing off it.',
  'hip-sway': 'Drill: stand an alignment stick (or umbrella) just outside your trail hip; turn back without touching it.',
  'hang-back': 'Drill: hit half shots with your trail foot pulled back onto its toe — you can only stay balanced if your weight moves forward.',
  'head-forward': 'Drill: put a head-cover a little in front of the ball; keep your head behind it until after the ball has gone.',
  'finish-back': 'Drill: hold every finish for three seconds, belt buckle to the target, trail foot up on its toe.',
  'tilt-forward': 'Drill: at address, slide your trail hand down your trail thigh a few centimetres — your spine tilts slightly away from the target.',
  'tilt-back': 'Drill: at address, feel your sternum over the ball for irons; only a small tilt away from the target.',
  'hands-back': 'Drill: at address, line the grip up with your lead thigh for irons so the shaft leans slightly forward.',
  'tempo-quick': 'Drill: count “one-two-three” on the way back and “four” on the way down — a smoother, longer backswing.',
  'tempo-slow': 'Drill: make practice swings with a faster, more committed downswing — “one-two” back, “three” through.',
  'early-ext': 'Drill: set up with your backside touching a chair or wall; keep it touching through impact as you turn.',
  'posture-loss': 'Drill: keep your chest over the ball through impact — feel like you stay bent over until the ball has gone.',
  'head-rise': 'Drill: keep your eyes on the back of the ball until it has gone; feel your chest stay down through the hit.',
  'head-dip': 'Drill: feel tall through the ball — make practice swings with your head brushing the underside of an imaginary shelf.',
  'reach': 'Drill: let your arms hang straight down from your shoulders at address, then grip — move closer to the ball until they do.',
  'crowd': 'Drill: let your arms hang straight down from your shoulders at address, then grip — step back a little if your hands are tucked into your body.',
  'spine-upright': 'Drill: bend from the hips with a club across your hip creases until your arms hang freely — more forward bend.',
  'spine-bent': 'Drill: bend from the hips less — keep your chest up so your arms hang under your shoulders.',
  'knees-straight': 'Drill: soften your knees a little at address, as if about to sit on a high stool.',
  'knees-bent': 'Drill: straighten your knees a little at address — athletic, not squatting.',
};

/**
 * Shared final step: extra swing positions, tempo, drills and score.
 */
function finish({ o, usable, addr, wA, torso, top, imp, fin, tips, good, m, view, extra }) {
  const T = (f) => f.t;
  const wr = (f) => mid(f.lm[LM.lWr], f.lm[LM.rWr]);
  const hipY = (f) => (f.lm[LM.lHip].y + f.lm[LM.rHip].y) / 2;
  // takeaway: first frame after address where the hands have clearly moved
  const take = usable.find((f) => T(f) > addr.t && T(f) < T(top) && dist(wr(f), wA) > torso * 0.15) || null;
  const between = (a, b) => usable.filter((f) => T(f) > a && T(f) < b);
  const nearestHipHeight = (list) => list.length ? list.reduce((b, f) => (Math.abs(wr(f).y - hipY(f)) < Math.abs(wr(b).y - hipY(b)) ? f : b), list[0]) : null;
  const half = take ? nearestHipHeight(between(T(take), T(top))) : null;
  const down = nearestHipHeight(between(T(top), o.tImp - 0.02));
  const thru = usable.filter((f) => T(f) > o.tImp + 0.08 && T(f) < o.tImp + 0.45).reduce((b, f) => (!b || Math.abs(T(f) - (o.tImp + 0.2)) < Math.abs(T(b) - (o.tImp + 0.2)) ? f : b), null);
  // tempo: backswing time vs downswing time (good players ~3:1)
  // only when the pictures are close enough together to time it (a slow
  // phone may only have looked at every few pictures)
  const gaps = usable.slice(1).map((f, i) => T(f) - T(usable[i])).sort((a, b) => a - b);
  const dense = gaps.length && gaps[gaps.length >> 1] <= 0.11;
  if (take && dense) {
    const back = T(top) - T(take), dn = o.tImp - T(top);
    if (back > 0.25 && dn > 0.1) { m.backswingS = back; m.downswingS = dn; m.tempo = back / dn; }
  }
  if (m.tempo != null) {
    if (m.tempo < 2.2) tips.push({ sev: (2.2 - m.tempo) / 0.4 + 0.5, key: 'tempo-quick', text: `Your tempo is ${m.tempo.toFixed(1)}:1 — the backswing is rushed compared with the downswing (good players are around 3:1).`, short: 'Smoother, longer backswing' });
    else if (m.tempo > 4.2) tips.push({ sev: (m.tempo - 4.2) / 0.5 + 0.5, key: 'tempo-slow', text: `Your tempo is ${m.tempo.toFixed(1)}:1 — the downswing is slow compared with the backswing (good players are around 3:1).`, short: 'Commit to the downswing' });
    else good.push(`Tempo ${m.tempo.toFixed(1)}:1`);
  }
  for (const t of tips) t.drill = DRILLS[t.key] || '';
  tips.sort((a, b) => b.sev - a.sev);
  const shown = tips.filter((t) => t.sev >= 0.75);
  const minor = tips.filter((t) => t.sev < 0.75);
  // score out of 10: start at 10, take off for each fault by how clear it is
  let score = 10;
  for (const t of shown) score -= Math.min(2, 0.8 + t.sev * 0.4);
  score -= 0.3 * minor.length;
  score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  const P = (f) => (f ? T(f) : null);
  return {
    ...extra, view, score,
    phases: { addr: addr.t, take: P(take), half: P(half), top: T(top), down: P(down), imp: P(imp), thru: P(thru), fin: P(fin) },
    frames: { addr, take, half, top, down, imp, thru, fin },
    metrics: m, tips: shown, minor, good, used: usable.length,
  };
}

// ------------------------------------------------------- down the line
/**
 * Phone behind the golfer, looking down the target line. o.s = +1 when the
 * golfer faces to the right of the screen (right-hander), -1 left-hander.
 */
export function analyseSwingDTL(frames, o) {
  const s = o.s >= 0 ? 1 : -1;
  // From behind, the far arm and leg are hidden behind the body. Where one of
  // a left/right pair is hidden, use the visible one for both (hands are
  // together on the grip; hips, knees and ankles overlap side-on anyway).
  const PAIRS = [[LM.lSh, LM.rSh], [LM.lWr, LM.rWr], [LM.lHip, LM.rHip], [LM.lKnee, LM.rKnee], [LM.lAnk, LM.rAnk]];
  frames = frames.map((f) => {
    if (!f.lm) return f;
    const lm = f.lm.slice();
    for (const [l, r] of PAIRS) {
      const L = lm[l], R = lm[r];
      if (!L || !R) continue;
      if (L.v < 0.5 || R.v < 0.5) { const best = L.v >= R.v ? L : R; lm[l] = { ...best }; lm[r] = { ...best }; }
    }
    return { ...f, lm };
  });
  const need = [LM.nose, LM.lSh, LM.rSh, LM.lWr, LM.rWr, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnk, LM.rAnk];
  const usable = frames.filter((f) => f.lm && need.every((i) => f.lm[i] && f.lm[i].v > 0.3));
  if (usable.length < 4) {
    const any = frames.find((f) => f.lm);
    return { ok: false, reason: !any ? 'nobody' : 'unclear', seen: frames.filter((f) => f.lm).length };
  }
  const T = (f) => f.t;
  const wr = (f) => mid(f.lm[LM.lWr], f.lm[LM.rWr]);
  const hipM = (f) => mid(f.lm[LM.lHip], f.lm[LM.rHip]);
  const shM = (f) => mid(f.lm[LM.lSh], f.lm[LM.rSh]);
  const kneeM = (f) => mid(f.lm[LM.lKnee], f.lm[LM.rKnee]);
  const ankM = (f) => mid(f.lm[LM.lAnk], f.lm[LM.rAnk]);
  const torso = dist(shM(usable[0]), hipM(usable[0]));
  let imp = usable.reduce((b, f) => (Math.abs(T(f) - o.tImp) < Math.abs(T(b) - o.tImp) ? f : b), usable[0]);
  if (Math.abs(T(imp) - o.tImp) > 0.15) imp = null;
  const early = usable.filter((f) => T(f) < o.tImp - 0.6);
  if (early.length < 2) return { ok: false, reason: 'address', seen: usable.length };
  const w0 = wr(early[0]);
  let k = 0;
  while (k + 1 < usable.length && T(usable[k + 1]) < o.tImp - 0.75 && dist(wr(usable[k + 1]), w0) < torso * 0.15) k++;
  const addrFrames = usable.slice(Math.max(0, k - 4), k + 1);
  const A = avgFrames(addrFrames.map((f) => f.lm));
  const addr = { t: T(addrFrames[addrFrames.length - 1]), lm: A };
  const wA = mid(A[LM.lWr], A[LM.rWr]);
  const back = usable.filter((f) => T(f) > addr.t && T(f) < o.tImp - 0.12);
  if (!back.length) return { ok: false, reason: 'backswing', seen: usable.length };
  const top = back.reduce((b, f) => (wr(f).y < wr(b).y ? f : b), back[0]);
  if (wA.y - wr(top).y < torso * 0.4) return { ok: false, reason: 'backswing', seen: usable.length };
  const after = usable.filter((f) => T(f) > o.tImp + 0.3);
  const fin = after.length ? after[after.length - 1] : null;

  const leg = (L, h, kk, a) => dist(L[h], L[kk]) + dist(L[kk], L[a]);
  const legPx = (leg(A, LM.lHip, LM.lKnee, LM.lAnk) + leg(A, LM.rHip, LM.rKnee, LM.rAnk)) / 2;
  const byBall = (4.27 / o.ball.d) * 1.0;
  const cmPerPx = o.heightCm && legPx > 20 ? (0.49 * o.heightCm) / legPx : byBall;
  const cm = (px) => px * cmPerPx;
  const deg = (r) => (r * 180) / Math.PI;
  const spine = (L) => { const h = mid(L[LM.lHip], L[LM.rHip]), sh = mid(L[LM.lSh], L[LM.rSh]); return deg(Math.atan2(s * (sh.x - h.x), h.y - sh.y)); };
  const kneeFlex = (L) => { const h = mid(L[LM.lHip], L[LM.rHip]), kn = mid(L[LM.lKnee], L[LM.rKnee]), an = mid(L[LM.lAnk], L[LM.rAnk]); return 180 - angleAt(h, kn, an); };

  const m = {};
  m.spineAngle = spine(A);
  m.kneeFlex = kneeFlex(A);
  m.armHangCm = cm(s * (wA.x - mid(A[LM.lSh], A[LM.rSh]).x));
  if (imp) {
    m.earlyExtCm = cm(s * (hipM(imp).x - mid(A[LM.lHip], A[LM.rHip]).x));
    m.spineImp = spine(imp.lm);
    m.postureLoss = m.spineAngle - m.spineImp;
    m.headDropCm = cm(imp.lm[LM.nose].y - A[LM.nose].y);
  }
  m.headTopDropCm = cm(top.lm[LM.nose].y - A[LM.nose].y);

  const tips = [], good = [];
  const add = (sev, key, text, short) => tips.push({ sev, key, text, short });
  if (m.spineAngle < 25) add((25 - m.spineAngle) / 4 + 0.5, 'spine-upright', `You stand quite upright at address (bent forward ${Math.round(m.spineAngle)}°). Most good players bend about 30–45° from the hips.`, 'Bend more from the hips');
  else if (m.spineAngle > 52) add((m.spineAngle - 52) / 4 + 0.5, 'spine-bent', `You’re bent over a lot at address (${Math.round(m.spineAngle)}°). Most good players are about 30–45°.`, 'Stand a little taller');
  else good.push(`Posture at address good (${Math.round(m.spineAngle)}° forward bend)`);
  if (m.kneeFlex < 8) add((8 - m.kneeFlex) / 4 + 0.5, 'knees-straight', `Your knees are nearly straight at address (${Math.round(m.kneeFlex)}° flex). Soften them to about 15–25°.`, 'Soften your knees');
  else if (m.kneeFlex > 40) add((m.kneeFlex - 40) / 5 + 0.5, 'knees-bent', `Your knees are very bent at address (${Math.round(m.kneeFlex)}°). About 15–25° is plenty.`, 'Less knee bend');
  else good.push(`Knee flex good (${Math.round(m.kneeFlex)}°)`);
  if (m.armHangCm > 15) add((m.armHangCm - 15) / 4 + 0.75, 'reach', `Your hands are ${Math.round(m.armHangCm)} cm out beyond your shoulders — you’re reaching for the ball. Stand a little closer.`, 'Stand closer to the ball');
  else if (m.armHangCm < -6) add((-6 - m.armHangCm) / 3 + 0.75, 'crowd', `Your hands are tucked in ${Math.round(-m.armHangCm)} cm inside your shoulders — you’re crowding the ball. Stand a little further away.`, 'Stand a little further from the ball');
  else good.push('Distance from the ball good — arms hang under your shoulders');
  if (m.earlyExtCm != null) {
    if (m.earlyExtCm > 6) add((m.earlyExtCm - 6) / 3 + 1, 'early-ext', `Your hips moved ${Math.round(m.earlyExtCm)} cm towards the ball by impact (early extension) — a cause of blocks, hooks and shanks. Keep your backside back as you turn through.`, 'Keep your hips back through impact');
    else good.push('Hips stayed back through impact');
  }
  if (m.postureLoss != null && m.postureLoss > 10) add((m.postureLoss - 10) / 4 + 1, 'posture-loss', `You stood up ${Math.round(m.postureLoss)}° out of your posture by impact. Stay bent over the ball through the hit.`, 'Stay in your posture through impact');
  if (m.headDropCm != null) {
    if (m.headDropCm < -7) add((-m.headDropCm - 7) / 3 + 1, 'head-rise', `Your head rose ${Math.round(-m.headDropCm)} cm by impact — a common cause of thin and topped shots.`, 'Keep your head level through impact');
    else if (m.headDropCm > 8) add((m.headDropCm - 8) / 3 + 1, 'head-dip', `Your head dropped ${Math.round(m.headDropCm)} cm by impact — a common cause of fat shots.`, 'Stay tall through impact');
    else good.push('Head height steady through impact');
  }
  return finish({ o, usable, addr, wA, torso, top, imp, fin, tips, good, m, view: 'dtl', extra: { ok: true, club: o.club, group: 'down the line', s, scaleFrom: o.heightCm ? 'height' : 'ball', cmPerPx } });
}

// angle at b (degrees) between b->a and b->c
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
}
