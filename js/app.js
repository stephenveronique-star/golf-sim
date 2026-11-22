import { simulate, CLUBS, clubById, estimateSpin, smashFactor, MPH, YARD, BALL } from './physics.js';
import { RangeView } from './range.js';
import { SwingCapture } from './posecap.js';
import { analyseSwing, analyseSwingDTL, angleAt, clubGroup } from './swing.js';
import { COURSES, buildCourse, playShot, playPutt, pinOf, aimPoint, scoreName } from './round.js';
import { loadThree, Course3D } from './course3d.js';
import { parseCommand } from './voice.js';
import { initSound, sfx, ambience, music } from './sound.js';
import { saveSwing, listSwings, getSwing, deleteSwing } from './swingstore.js';

const VERSION = '3.3.0';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ------------------------------------------------------------ storage
const store = {
  get(k, d) { try { const v = localStorage.getItem('golfsim.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('golfsim.' + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};
const DEFAULTS = {
  dist: 'm', speed: 'mph', altitude: 1750, tempC: 22, firmness: '1', voice: 'on',
  hfov: 67, procW: '960', threshold: 14, speedCal: 0, aim: 0, camId: '', club: '7I', autoFind: 'on', debug: 'off', tips: 'on', heightCm: '', hand: 'auto', lens: 'main', view: 'face', face: 'back', camH: 1, voiceCmd: 'off', myDist: {}, sfx: 'on', music: 'on', voiceName: '', haptics: 'on', players: 1, names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'], autoReplay: 'on', goal: '', ballDist: '', teeSpot: null,
};
const S = { ...DEFAULTS, ...store.get('settings', {}) };
const saveSettings = () => store.set('settings', S);
let shots = store.get('shots', []);
let session = store.get('session', Date.now());
store.set('session', session);
// ------------------------------------------------------------ problem log
let LOG = store.get('log', []);
let logDirty = false;
function log(msg) {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8);
  LOG.push(`${ts} ${msg}`);
  if (LOG.length > 250) LOG = LOG.slice(-250);
  if (!logDirty) { logDirty = true; setTimeout(() => { logDirty = false; store.set('log', LOG); }, 1000); }
}
window.addEventListener('error', (e) => log(`ERROR ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log(`ERROR (promise) ${e.reason && (e.reason.message || e.reason)}`));
log(`app opened · ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 120)}`);

const saveShots = () => { if (shots.length > 3000) shots = shots.slice(-3000); store.set('shots', shots); };

// ------------------------------------------------------------ formatting
const fmtDist = (m, dp = 0) => (S.dist === 'yd' ? m / YARD : m).toFixed(dp);
const dUnit = () => (S.dist === 'yd' ? 'yd' : 'm');
const fmtSpeed = (ms) => {
  if (S.speed === 'kmh') return `${(ms * 3.6).toFixed(0)}<em>km/h</em>`;
  if (S.speed === 'ms') return `${ms.toFixed(1)}<em>m/s</em>`;
  return `${(ms / MPH).toFixed(1)}<em>mph</em>`;
};
const fmtSide = (m) => {
  const v = Math.abs(+fmtDist(m, 1));
  if (v < 0.5) return 'Online';
  return `${v.toFixed(v < 10 ? 1 : 0)}<em>${dUnit()} ${m > 0 ? 'R' : 'L'}</em>`;
};
const fmtDir = (deg) => (Math.abs(deg) < 0.3 ? 'Straight' : `${Math.abs(deg).toFixed(1)}°<em>${deg > 0 ? 'R' : 'L'}</em>`);

// ------------------------------------------------------------ UI basics
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(kind, text) {
  const p = $('#status'); p.className = 'pill ' + kind; p.querySelector('span').textContent = text;
}
function openSheet(id) { $(id).classList.add('show'); }
function closeSheets() { $$('.overlay').forEach((o) => o.classList.remove('show')); }
$$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o || e.target.hasAttribute('data-close')) o.classList.remove('show'); }));

// audio cue + voice
let audioCtx = null;
let audioUnlocked = false, speechOk = null, voicePick = null;
const NOVELTY = /eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|good news/i;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    // the robot and joke voices are never a good default
    const en = vs.filter((v) => /^en/i.test(v.lang)), plain = en.filter((v) => !NOVELTY.test(v.name));
    const want = typeof S !== 'undefined' && S.voiceName ? en.find((v) => v.name === S.voiceName) : null;
    voicePick = want || plain.find((v) => /daniel|karen|samantha|moira|tessa|serena|kate/i.test(v.name)) || plain.find((v) => /en-ZA|en-GB/i.test(v.lang)) || plain[0] || en[0] || null;
  } catch { /* none */ }
}
try { if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } } catch { /* none */ }

// Must be called from a tap: iPhone only allows sound after the user has touched the page.
function unlockAudio(first) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    // a silent buffer played inside the tap fully wakes iPhone audio
    const b = audioCtx.createBuffer(1, 1, 22050), src = audioCtx.createBufferSource();
    src.buffer = b; src.connect(audioCtx.destination); src.start(0);
    initSound(audioCtx);
  } catch { /* none */ }
  if (!audioUnlocked && first) { audioUnlocked = true; say(first, true); }
}
function beep(freq = 880, dur = 0.12, vol = 0.25) {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(vol, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch { /* ignore */ }
}
function say(text, force) {
  if ((!force && S.voice !== 'on') || !('speechSynthesis' in window)) { if (!('speechSynthesis' in window)) log('no speech available in this browser'); return; }
  const go = () => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.volume = 1; u.lang = voicePick ? voicePick.lang : 'en-GB';
      if (voicePick) u.voice = voicePick;
      u.onstart = () => { if (speechOk !== true) { speechOk = true; log(`speech working (${voicePick ? voicePick.name : 'default voice'})`); } };
      u.onend = () => { if (!text.startsWith('OK,')) setTimeout(() => listenFor(7000), 300); }; // after the app speaks, listen for a club name
      u.onerror = (e) => { speechOk = false; log(`speech error: ${e.error || 'unknown'} saying "${text}"`); };
      speechSynthesis.speak(u);
      // iPhone sometimes leaves speech paused in the background
      if (speechSynthesis.paused) speechSynthesis.resume();
    } catch (e) { log(`speech failed: ${e.message}`); }
  };
  // Cancelling and speaking at the same moment makes iPhone drop the words: leave a gap.
  try { if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(go, 120); } else go(); } catch { go(); }
}
// ---- voice commands (an experiment): say a club name, or "next hole"
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let srNow = null, srTimer = 0, srErr = '';
function listenFor(ms) {
  if (S.voiceCmd !== 'on' || !SR || srNow || document.hidden) return;
  let rec; try { rec = new SR(); } catch (e) { log(`voice: could not start (${e.message})`); return; }
  rec.lang = 'en-US'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 3;
  let done = false;
  rec.onresult = (e) => {
    if (done) return;
    const heard = []; for (const r of e.results) for (const a of r) heard.push(a.transcript);
    const cmd = heard.map(parseCommand).find(Boolean); if (!cmd) return;
    done = true; try { rec.abort(); } catch { /* ignore */ }
    log(`voice: heard "${heard[heard.length - 1]}" → ${cmd.club || cmd.cmd}`); voiceDo(cmd);
  };
  rec.onerror = (e) => { if (e.error !== srErr && e.error !== 'no-speech' && e.error !== 'aborted') { srErr = e.error; log(`voice: error ${e.error}`); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Voice commands were blocked. Allow the microphone and Siri & Dictation for Safari, then switch Voice commands on again.', 8000); } };
  rec.onend = () => { clearTimeout(srTimer); if (srNow === rec) srNow = null; document.body.dataset.listening = 'off'; };
  try { rec.start(); srNow = rec; document.body.dataset.listening = 'on'; srTimer = setTimeout(() => { try { rec.abort(); } catch { /* ignore */ } }, ms); } catch (e) { log(`voice: start refused (${e.message})`); }
}
function voiceDo(cmd) {
  if (cmd.club) {
    S.club = cmd.club; saveSettings(); renderClubs(); if (round) renderRound();
    const n = clubById(cmd.club).name; beep(1320, 0.08); toast(`🎙 ${n}`, 2500); setTimeout(() => say(`OK, ${n}`), 250);
  } else if (cmd.cmd === 'next' && round && round.done) { beep(1320, 0.08); roundNext(); }
}
function testSound() {
  unlockAudio();
  beep(880, 0.12); setTimeout(() => beep(1320, 0.14), 150);
  setTimeout(() => say('Sound check. One, two, three.', true), 400);
  log(`test sound pressed · speech ${'speechSynthesis' in window ? 'available' : 'missing'} · audio ${audioCtx ? audioCtx.state : 'none'}`);
  setTimeout(() => toast('Heard the beep but no voice? Your iPhone is on silent (🔕 next to the clock). iPhones mute speech in silent mode — turn silent mode off with the switch/Action button on the side or in Control Centre.', 9000), 2600);
}

// ------------------------------------------------------------ range + numbers
const range = new RangeView($('#range'));
range.unit = S.dist;

function sessionShots() { return shots.filter((s) => s.session === session); }

function refreshRange() {
  range.unit = S.dist;
  range.setShots(sessionShots().filter((s) => !s.miss).slice(-40).map((s) => ({ land: s.land, end: s.end })));
}

function showNumbers(s) {
  const c = clubById(s.club);
  $('#vCarry').innerHTML = `${fmtDist(s.carry)}<small>${dUnit()}</small>`;
  $('#vSub').textContent = `${c.name}${s.demo ? ' · demo shot' : ''} · lands at ${s.landAngle.toFixed(0)}° · ${s.flightTime.toFixed(1)} s in the air`;
  $('#vTotal').innerHTML = `${fmtDist(s.total)}<em>${dUnit()}</em>`;
  $('#vSpeed').innerHTML = fmtSpeed(s.speed);
  $('#vLaunch').innerHTML = `${s.launch.toFixed(1)}°`;
  $('#vDir').innerHTML = fmtDir(s.dir);
  $('#vOff').innerHTML = fmtSide(s.offline);
  $('#vApex').innerHTML = `${fmtDist(s.apex, 0)}<em>${dUnit()}</em>`;
  $('#vClub').innerHTML = fmtSpeed(s.clubSpeed);
  $('#vSpin').innerHTML = `${Math.round(s.spin / 50) * 50}<em>rpm</em>`;
}

let tab = 'session';
function renderList() {
  const L = $('#list');
  if (tab === 'session') {
    const list = sessionShots().slice().reverse();
    if (!list.length) { L.innerHTML = '<div class="empty">No shots yet this session.</div>'; return; }
    let h = `<div class="row head"><div>Club</div><div>Carry</div><div>Total</div><div>Side</div><div></div></div>`;
    for (const s of list) {
      if (s.miss) { h += `<div class="row miss"><div class="club">${s.club}</div><div style="grid-column: span 3">${s.swingOnly && s.swing && s.swing.ok ? `swing only · score ${s.swing.score.toFixed(1)}` : s.swingOnly && s.swing ? 'swing only' : 'not read'}</div><div class="x" data-del="${s.id}">✕</div></div>`; continue; }
      const side = Math.abs(+fmtDist(s.offline, 0)) < 1 ? '—' : `${Math.abs(+fmtDist(s.offline, 0))}${s.offline > 0 ? 'R' : 'L'}`;
      h += `<div class="row"><div class="club">${s.club}${s.demo ? '*' : ''}</div><div>${fmtDist(s.carry)}</div><div>${fmtDist(s.total)}</div><div>${side}</div><div class="x" data-del="${s.id}">✕</div></div>`;
    }
    if (list.some((s) => s.demo)) h += '<div class="empty">* demo shot</div>';
    L.innerHTML = h;
  } else if (tab === 'swing') {
    const list = shots.filter((s) => s.swing).slice(-20).reverse();
    if (!list.length) { L.innerHTML = '<div class="empty">After each shot the app checks your stance, ball position, sway and weight shift. Your results build up here. Put your height in Settings for accurate measurements.</div>'; return; }
    const cols = 'grid-template-columns:44px 1fr 1fr 1fr 1fr';
    let h = `<div class="row head" style="${cols}"><div>Club</div><div>Score</div><div>Tempo</div><div>Head</div><div>Hips</div></div>`;
    for (const s of list) {
      const w = s.swing;
      if (!w.ok) { h += `<div class="row miss" style="${cols}"><div class="club">${s.club}</div><div style="grid-column: span 4">${w.note || 'not seen'}</div></div>`; continue; }
      const m = w.m;
      const sg = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}`);
      const sc = w.score != null ? `<b style="color:${scoreColour(w.score)}">${w.score.toFixed(1)}</b>` : '—';
      const tp = w.tempo ? `${w.tempo.toFixed(1)}:1` : '—';
      h += w.view === 'dtl'
        ? `<div class="row" data-sw="${s.id}" style="${cols};cursor:pointer"><div class="club">${s.club} ▶︎</div><div>${sc}</div><div>${tp}</div><div>${sg(m.headDropCm)}</div><div>${sg(m.earlyExtCm)}</div></div>`
        : `<div class="row" data-sw="${s.id}" style="${cols};cursor:pointer"><div class="club">${s.club} ▶︎</div><div>${sc}</div><div>${tp}</div><div>${sg(m.headTopCm)}</div><div>${sg(m.hipImpCm)}</div></div>`;
      if (w.tips && w.tips.length) h += `<div class="row" style="grid-template-columns:1fr;color:var(--accent2);font-size:12px;border:0;padding-top:0">↳ ${w.tips.map((t) => t.short).join(' · ')}</div>`;
    }
    h += '<div class="empty">Score out of 10. Tempo = backswing time ÷ downswing time (good ≈ 3:1). Facing you: Head = cm it moved on the backswing (− = away from target), Hips = cm they moved towards the target by impact. From behind: Head = cm it dropped by impact, Hips = cm they moved toward the ball (early extension). Tap a row to watch it.</div>';
    L.innerHTML = h;
  } else {
    const by = {};
    for (const s of shots) { if (s.demo || s.miss) continue; (by[s.club] ||= []).push(s); }
    const ids = CLUBS.map((c) => c.id).filter((id) => by[id]);
    if (!ids.length) { L.innerHTML = '<div class="empty">Your average distance for each club builds up here as you hit real shots (demo shots are left out).</div>'; return; }
    let h = `<div class="row head" style="grid-template-columns:44px 1fr 1fr 1fr"><div>Club</div><div>Carry</div><div>Total</div><div>Shots</div></div>`;
    for (const id of ids) {
      const a = by[id];
      // trimmed mean: drop the top and bottom 10% once there are enough shots
      const trim = (arr) => { const v = arr.slice().sort((p, q) => p - q); const k = v.length >= 10 ? Math.floor(v.length * 0.1) : 0; const u = v.slice(k, v.length - k); return u.reduce((p, q) => p + q, 0) / u.length; };
      h += `<div class="row" style="grid-template-columns:44px 1fr 1fr 1fr"><div class="club">${id}</div><div>${fmtDist(trim(a.map((s) => s.carry)))}</div><div>${fmtDist(trim(a.map((s) => s.total)))}</div><div>${a.length}</div></div>`;
    }
    L.innerHTML = h;
  }
}
$('#list').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-sw]'); if (sw) { openSwings(+sw.dataset.sw); return; }
  const id = e.target.getAttribute('data-del');
  if (!id) return;
  shots = shots.filter((s) => String(s.id) !== id); saveShots(); renderList(); refreshRange();
});
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab; $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderList();
}));
$$('.view-toggle button').forEach((b) => b.addEventListener('click', () => {
  $$('.view-toggle button').forEach((x) => x.classList.toggle('on', x === b)); range.setMode(b.dataset.view);
}));
$('#clearBtn').addEventListener('click', () => {
  session = Date.now(); store.set('session', session); refreshRange(); renderList();
  ['#vTotal', '#vSpeed', '#vLaunch', '#vDir', '#vOff', '#vApex', '#vClub', '#vSpin'].forEach((s) => { $(s).textContent = '—'; });
  $('#vCarry').innerHTML = `—<small>${dUnit()}</small>`; $('#vSub').textContent = 'New session started';
  range.current = null; range.draw();
});

// ------------------------------------------------------------ club picker
function renderClubs() {
  $('#clubBtn').textContent = clubById(S.club).name;
  $('#clubGrid').innerHTML = CLUBS.map((c) => `<button data-club="${c.id}" class="${c.id === S.club ? 'on' : ''}">${c.id}<small>${c.name}</small><em>${fmtDist(clubAvg(c.id))} ${dUnit()}</em></button>`).join('');
  $('#clubDist').innerHTML = CLUBS.map((c) => { const mine = S.myDist && S.myDist[c.id] > 0, n = shots.filter((s) => s.club === c.id && !s.miss && !s.demo).length;
    return `<div class="cdist" data-cd="${c.id}"><b>${c.name}</b><button class="btn" data-step="-1" aria-label="Shorter">−</button><span class="v">${fmtDist(clubAvg(c.id))} ${dUnit()}</span><button class="btn" data-step="1" aria-label="Longer">+</button><span class="src">${mine ? 'set by you' : n >= 3 ? 'from your shots' : 'typical golfer'}</span><button class="btn ghost" data-step="0" aria-label="Back to automatic" ${mine ? '' : 'style="visibility:hidden"'}>↺</button></div>`; }).join('');
  const bag = $('#rhBag'); if (bag) { bag.innerHTML = CLUBS.map((c) => `<option value="${c.id}">${c.name} · ${fmtDist(clubAvg(c.id))} ${dUnit()}</option>`).join(''); bag.value = S.club; }
}
// change how far a club goes (in steps of 5), or put it back to automatic
$('#clubDist').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]'), row = e.target.closest('[data-cd]'); if (!b || !row) return;
  const id = row.dataset.cd, step = +b.dataset.step, unit = S.dist === 'yd' ? YARD : 1;
  S.myDist = { ...(S.myDist || {}) };
  if (!step) delete S.myDist[id];
  else { const cur = clubAvg(id) / unit, next = Math.max(10, Math.min(400, (step > 0 ? Math.floor(cur / 5) * 5 + 5 : Math.ceil(cur / 5) * 5 - 5))); S.myDist[id] = next * unit; }
  saveSettings(); renderClubs(); if (round) renderRound();
});
$('#clubBtn').addEventListener('click', () => { renderClubs(); openSheet('#clubSheet'); });
$('#clubGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-club]'); if (!b) return;
  S.club = b.dataset.club; saveSettings(); renderClubs(); closeSheets();
});

// ------------------------------------------------------------ shot processing
function recordShot(launch, opts = {}) {
  const speed = launch.speed * (1 + (+S.speedCal || 0) / 100);
  const dir = launch.direction + (+S.aim || 0);
  const spin = estimateSpin(S.club, speed);
  const sim = simulate({ speed, launch: launch.launch, direction: dir, spin, spinAxis: 0, altitude: +S.altitude, tempC: +S.tempC, firmness: +S.firmness });
  const s = {
    id: Date.now() + Math.floor(Math.random() * 1000), ts: Date.now(), session, club: S.club, demo: !!opts.demo,
    speed, launch: launch.launch, dir, spin, clubSpeed: speed / smashFactor(S.club),
    carry: sim.carry, total: sim.total, apex: sim.apex, offline: sim.offline, landAngle: sim.landAngle, flightTime: sim.flightTime,
    land: sim.land, end: sim.end, pts: launch.points ?? null,
  };
  shots.push(s); saveShots();
  showNumbers(s); renderList(); refreshRange();
  range.play(sim, { label: `${fmtDist(s.carry)} ${dUnit()} carry` });
  say(`${fmtDist(s.carry)} ${S.dist === 'yd' ? 'yards' : 'metres'}`);
  if (!opts.demo) roundShot({ total: s.total, offline: s.offline });
  return s;
}

// a swing with no ball numbers (filmed from behind, or ball not seen)
function swingOnlyRecord() {
  const s = { id: Date.now(), ts: Date.now(), session, club: S.club, swingOnly: true, miss: true };
  shots.push(s); saveShots(); renderList();
  $('#vCarry').innerHTML = `—<small>${dUnit()}</small>`; $('#vSub').textContent = 'Swing recorded — checking it…';
  return s;
}

function demoShot() {
  const c = clubById(S.club);
  const g = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return u - 3; };
  const speed = c.ball * MPH * (0.85 + 0.04 * g());
  recordShot({ speed, launch: Math.max(2, c.launch + 1.5 + 1.8 * g()), direction: 3 * g(), points: 0 }, { demo: true });
}


// ------------------------------------------------------------ camera
// Frames are analysed in a worker. Best path: MediaStreamTrackProcessor
// (every camera frame, with its capture timestamp). Fallback: grab frames
// from the <video> element on the main thread.
const video = $('#video');
let stream = null;
let running = false;
let lastCapture = null;
let firstArm = true;
let mode = null; // 'main-processor' | 'video'
let mainReader = null;
const eng = { state: 'idle', fps: 0, procMs: 0, w: 0, h: 0, ball: null, frames: 0 };

let worker = null, lastWorkerMsg = performance.now(), workerRestarts = 0;
function makeWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => log(`ERROR worker crashed: ${e.message || 'unknown'}`);
  lastWorkerMsg = performance.now();
}
let setBallSeq = 0;
const pending = new Map();
// In dim light the ball looks smaller than it is, so its size can't be trusted for distance.
function isDim() { return (eng.fps || 60) < 50; }
function usedBallDist() { return +S.ballDist > 0.5 ? +S.ballDist : isDim() ? (S.lens === 'wide' ? 2 : 3) : 0; }
function sendConfig() { worker.postMessage({ cmd: 'config', opts: { hfovDeg: +S.hfov, threshold: +S.threshold, procW: +S.procW, autoFind: S.autoFind !== 'off', ballDist: usedBallDist(), teeSpot: S.teeSpot || null, view: S.view, camH: +S.camH || 1 } }); }
function onWorkerMessage(e) {
  const m = e.data;
  lastWorkerMsg = performance.now();
  if (m.type === 'status') { Object.assign(eng, m); updateReady(); }
  else if (m.type === 'event') onEngineEvent(m.ev);
  else if (m.type === 'setBall') { const r = pending.get(m.id); pending.delete(m.id); if (r) r(m.ball); }
  else if (m.type === 'buf') freeBufs.push(m.buf);
  else if (m.type === 'error') { console.error('worker:', m.message); log(`ERROR worker: ${m.message}`); }
  else if (m.type === 'debug') { const r = pendingDebug.get(m.id); pendingDebug.delete(m.id); if (r) r(m); }
  else if (m.type === 'snaps') { const r = pendingSnaps.get(m.id); pendingSnaps.delete(m.id); if (r) r(m.frames); }
}
const pendingSnaps = new Map(); let snapSeq = 0;
function workerSnaps(t0, t1) {
  const id = ++snapSeq;
  return new Promise((res) => { pendingSnaps.set(id, res); worker.postMessage({ cmd: 'snaps', id, t0, t1 }); setTimeout(() => { if (pendingSnaps.has(id)) { pendingSnaps.delete(id); res([]); } }, 3000); });
}
makeWorker();
sendConfig();
// If the shot detector stops answering while camera pictures are flowing,
// replace it with a fresh one (it finds the ball again at the tee spot).
setInterval(() => {
  if (!running || document.hidden) return;
  // while the swing check runs, the page is busy and the detector is told to wait — not stuck
  if (swingChecking || swingCap.busy) { lastWorkerMsg = Math.max(lastWorkerMsg, performance.now() - 1000); return; }
  const picsFlowing = performance.now() - lastFreshPic < 1000 || mode === 'main-processor';
  if (picsFlowing && performance.now() - lastWorkerMsg > 3000) {
    workerRestarts++;
    log(`shot detector stopped answering for ${Math.round((performance.now() - lastWorkerMsg) / 1000)} s — restarting it (#${workerRestarts})`);
    try { worker.terminate(); } catch { /* ignore */ }
    makeWorker(); sendConfig();
    eng.state = 'idle'; eng.ball = null; updateReady();
    if (mode === 'main-processor' && stream) startMainProcessor(stream.getVideoTracks()[0].clone());
    toast('Restarted the shot detector — finding the ball again', 3000);
  }
}, 1000);
const pendingDebug = new Map();
let debugSeq = 0;
function workerDebug() {
  const id = ++debugSeq;
  return new Promise((res) => { pendingDebug.set(id, res); worker.postMessage({ cmd: 'debug', id }); setTimeout(() => { if (pendingDebug.has(id)) { pendingDebug.delete(id); res(null); } }, 1500); });
}
function setBall(x, y) {
  const id = ++setBallSeq;
  return new Promise((res) => { pending.set(id, res); worker.postMessage({ cmd: 'setBall', x, y, id }); });
}

function droppedFrames(ev) {
  if (!ev.frames || ev.frames.length < 3) return 0;
  const ts = ev.frames.map((f) => f.t), d = ts.slice(1).map((t, i) => t - ts[i]).sort((p, q) => p - q)[Math.floor(ts.length / 2)];
  let n = 0; for (let i = 1; i < ts.length; i++) n += Math.max(0, Math.round((ts[i] - ts[i - 1]) / d) - 1);
  return n;
}
function onEngineEvent(ev) {
  try { window.__golf?.onEvent?.(ev); } catch { /* test hook */ }
  if ((ev.type === 'shot' || ev.type === 'missed') && section !== 'drive') showSection('drive');
  if (ev.type === 'armed') {
    eng.state = 'armed'; eng.ball = ev.ball;
    log(`READY (${ev.how}) ball at ${ev.ball.x.toFixed(0)},${ev.ball.y.toFixed(0)} · ${ev.ball.d.toFixed(1)} px`);
    checkFraming(ev.ball);
    // remember the phone's position once your hand is off it
    tiltDeg = 0; tiltSince = 0; tiltHeld = false; gRef = gNow ? { ...gNow } : null;
    setTimeout(() => { if (gNow && eng.state === 'armed') { gRef = { ...gNow }; tiltDeg = 0; tiltSince = 0; tiltHeld = false; updateReady(); checkLevel(); } }, 1500);
    setStatus('ready', 'Ready — hit away');
    $('#setupMsg').textContent = ev.how === 'tap' ? 'Ready — hit away' : 'Found the ball — ready, hit away';
    updateReady();
    beep(880, 0.1); setTimeout(() => beep(1320, 0.12), 130);
    setTimeout(() => say('Ready'), 350);
    if (firstArm && $('#setup').classList.contains('show')) { firstArm = false; setTimeout(() => closeSetup(), 1800); }
    // the automatic replay steps out of the way when the next ball is ready
    if (P.auto && $('#swingsSheet').classList.contains('show')) closeAutoReplay();
  } else if (ev.type === 'missed' && S.view === 'dtl') {
    // filmed from behind and the ball wasn't followed: just the swing
    toast(ev.brief ? 'The ball was only seen for a moment, too briefly to measure. More room between the ball and the net, and bright light, give the camera more to see. Your swing is still checked.' : 'Ball was struck but not seen in flight. Your swing is still checked.', 6000);
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    if ($('#setup').classList.contains('show')) closeSetup();
    log(`SWING (behind view) ${ev.type}${ev.reason ? ' ' + ev.reason : ''} · moving bits per frame [${(ev.moving || []).join(',')}]`);
    const rec = swingOnlyRecord();
    if (S.tips === 'on' && ev.tNow != null) runSwingCheck(ev, rec); else toast('Turn Swing tips on in Settings to check your swing from behind', 4000);
  } else if (ev.type === 'shot' && ev.launch.speed > clubById(S.club).ball * MPH * 1.3) {
    // far faster than this club can hit: a false reading, not a shot
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    const L = ev.launch, lim = clubById(S.club).ball * MPH * 1.3;
    log(`SHOT REJECTED ${L.speed.toFixed(1)} m/s is faster than a ${clubById(S.club).name} can hit (limit ${lim.toFixed(0)} m/s) · launch ${L.launch.toFixed(1)}° · seen in ${L.points} frames · ball ${ev.tee.d.toFixed(1)} px · moving bits per frame [${(ev.moving || []).join(',')}]`);
    if ($('#setup').classList.contains('show')) closeSetup();
    const miss = { id: Date.now(), ts: Date.now(), session, club: S.club, miss: true, swingOnly: true };
    shots.push(miss); saveShots(); renderList();
    toast(`That reading didn’t make sense for a ${clubById(S.club).name} (${(L.speed / MPH).toFixed(0)} mph), so it wasn’t counted.${ev.tee.d < 7 ? ' The ball is very small in the picture — move the phone closer (about 3 m).' : ''} Your swing is still checked.`, 7000);
    beep(300, 0.25);
    if (S.tips === 'on' && ev.tNow != null) runSwingCheck(ev, miss);
  } else if (ev.type === 'shot') {
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    const L = ev.launch;
    log(`SHOT${L.view === 'dtl' ? ` (from behind, phone tipped down ${L.tipDeg.toFixed(1)}°)` : ''} speed ${L.speed.toFixed(1)} m/s · launch ${L.launch.toFixed(1)}° · dir ${L.direction.toFixed(1)}° · seen in ${L.points} frames · ${ev.fps.toFixed(0)} fps · ${droppedFrames(ev)} dropped frames · moving bits per frame [${(ev.moving || []).join(',')}]`);
    if ($('#setup').classList.contains('show')) closeSetup(); // show the result
    if (ev.launch.speed >= 3) { const rec = recordShot(ev.launch); if (S.tips === 'on' && ev.tNow != null) runSwingCheck(ev, rec); }
  } else if (ev.type === 'moved') {
    eng.state = 'waiting'; phoneMovedFromPicture();
    log(`PHONE MOVED — not a shot · moving bits per frame [${(ev.moving || []).join(',')}] · finding the ball again`);
    movedTimes = movedTimes.filter((t) => performance.now() - t < 120000); movedTimes.push(performance.now());
    if (movedTimes.length >= 3) { toast('The phone keeps moving — it looks hand-held. The app compares pictures to find the ball, so even a small wobble looks like movement. Put the phone on a stand, or prop it against something solid.', 9000); movedTimes = []; }
    else toast('The phone moved, so that wasn’t counted as a shot. Finding the ball again — keep the phone still.', 5000);
  } else if (ev.type === 'nudged') {
    eng.ball = ev.ball;
    const now = performance.now();
    if (!window.__lastNudgeLog || now - window.__lastNudgeLog > 3000) { window.__lastNudgeLog = now; log(`phone nudged — following the ball to ${ev.ball.x.toFixed(0)},${ev.ball.y.toFixed(0)}`); }
  } else if (ev.type === 'missed') {
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    say('Missed that one');
    if ($('#setup').classList.contains('show')) closeSetup();
    log(`MISSED ball left the tee but wasn't found in flight · ${droppedFrames(ev)} dropped frames · moving bits per frame [${(ev.moving || []).join(',')}]`);
    const miss = { id: Date.now(), ts: Date.now(), session, club: S.club, miss: true, swingOnly: true };
    shots.push(miss); saveShots(); renderList();
    toast('Ball was struck but not seen in flight. Your swing is still checked. Tap “Replay last” to see what the camera saw.', 5000);
    if (S.tips === 'on' && ev.tNow != null && ev.tOnset != null) runSwingCheck(ev, miss);
    beep(300, 0.25);
  }
}

function camConstraints(fps, devId) {
  const v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps } };
  const id = devId || S.camId;
  if (S.face === 'front' && !devId) v.facingMode = { ideal: 'user' }; else if (id) v.deviceId = { exact: id }; else v.facingMode = { ideal: 'environment' };
  return { audio: false, video: v };
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toast('The camera only works when the app is opened from its https link in Safari.', 6000);
    return false;
  }
  stopCamera();
  try {
    try { stream = await navigator.mediaDevices.getUserMedia(camConstraints(120)); }
    catch (e) { if (e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia(camConstraints(60)); else throw e; }
  } catch (e) {
    const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
    const msg = framed
      ? 'This preview can’t use the camera. Open the app from its own link in Safari to use the camera.'
      : e.name === 'NotAllowedError'
      ? 'Camera permission was refused. On iPhone: Settings › Apps › Safari › Camera › Allow, then reload.'
      : `Couldn't start the camera (${e.name || e.message}).`;
    toast(msg, 7000); $('#startNote').textContent = msg;
    setStatus('off', 'Camera off');
    return false;
  }
  // iPhone's default "Back Triple/Dual Camera" swaps lenses by itself, which
  // changes the field of view mid-session. Use the main "Back Camera" instead.
  if (S.face !== 'front' && !S.camId && /triple|dual/i.test(stream.getVideoTracks()[0].label || '')) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const main = devs.find((d) => /^back camera$/i.test(d.label.trim()));
      if (main) {
        const old = stream.getVideoTracks()[0].label;
        stream.getTracks().forEach((t) => t.stop());
        try { stream = await navigator.mediaDevices.getUserMedia(camConstraints(120, main.deviceId)); }
        catch { stream = await navigator.mediaDevices.getUserMedia(camConstraints(60, main.deviceId)); }
        log(`switched from ${old} to ${main.label} (fixed lens)`);
      }
    } catch (e) { log(`couldn't switch to main camera: ${e.name || e.message}`); try { stream = await navigator.mediaDevices.getUserMedia(camConstraints(60)); } catch { /* keep going */ } }
  }
  // Wide lens (for a phone only about 2 m away): the 0.5x Ultra Wide camera,
  // analysed at full width so the ball stays big enough to follow.
  if (S.face === 'front') { S.hfov = 70; S.procW = '960'; sendConfig(); }
  else if (S.lens === 'wide' && !S.camId) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const wide = devs.find((d) => /ultra\s*wide/i.test(d.label) && !/front/i.test(d.label));
      if (wide) {
        stream.getTracks().forEach((t) => t.stop());
        try { stream = await navigator.mediaDevices.getUserMedia(camConstraints(120, wide.deviceId)); }
        catch { stream = await navigator.mediaDevices.getUserMedia(camConstraints(60, wide.deviceId)); }
        S.hfov = 106; S.procW = '1280'; log(`wide lens on: ${wide.label}`);
      } else {
        log(`wide lens asked for but not found (cameras: ${devs.map((d) => d.label).join(', ') || 'none named'})`);
        toast('This phone didn’t offer a wide lens to the app — using the normal camera at 3 m.', 6000);
        S.lens = 'main'; S.hfov = 67; S.procW = '960';
      }
    } catch (e) { log(`couldn't switch to the wide lens: ${e.name || e.message}`); S.lens = 'main'; S.hfov = 67; S.procW = '960'; }
    saveSettings(); sendConfig(); renderLensChip();
  }
  try {
    await stream.getVideoTracks()[0].applyConstraints({ frameRate: { min: 55, ideal: 60 } });
    log('asked the camera to hold 60 pictures a second: accepted');
  } catch (e) { log(`asked the camera to hold 60 pictures a second: refused (${e.name || e.message})`); }
  const track = stream.getVideoTracks()[0];
  try { const st = track.getSettings(); log(`camera started ${st.width}×${st.height} @ ${st.frameRate} fps (${track.label || 'camera'})`); } catch { /* ignore */ }
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const maxFps = caps.frameRate?.max || 60;
    const want = maxFps >= 119 ? 120 : Math.min(60, maxFps);
    await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: want, min: Math.min(30, want) } });
  } catch { /* keep what we have */ }
  $('#pip').hidden = false;
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay */ }
  try {
    const vt = stream.getVideoTracks()[0];
    vt.onmute = () => log('camera track MUTED by the iPhone');
    vt.onunmute = () => log('camera track live again');
    vt.onended = () => { log('camera track ENDED'); if (running) setTimeout(() => startCamera(), 300); };
  } catch { /* ignore */ }
  running = true;
  worker.postMessage({ cmd: 'reset' });
  eng.state = 'idle'; eng.ball = null; eng.frames = 0;
  updateReady();
  sendConfig();
  // pick the capture path
  // Chrome: read every camera frame directly. iPhone Safari: read frames from
  // the video element, which is exactly the picture shown on screen.
  if (typeof MediaStreamTrackProcessor !== 'undefined' && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    startMainProcessor(track.clone());
  } else {
    startVideoPath();
  }
  startWatchdog();
  log(`capture path: ${mode}`);
  if (S.tips === 'on') swingCap.load().catch(() => { /* logged */ });
  $('#pip').hidden = false;
  setStatus('busy', 'Looking for the ball');
  populateCameras();
  requestWakeLock();
  requestAnimationFrame(drawLoop);
  return true;
}

// Chrome: processor on the window, VideoFrames transferred to the worker.
async function startMainProcessor(track) {
  mode = 'main-processor';
  try {
    const proc = new MediaStreamTrackProcessor({ track });
    mainReader = proc.readable.getReader();
    for (;;) {
      const { value, done } = await mainReader.read();
      if (done || !running) { value && value.close(); break; }
      worker.postMessage({ cmd: 'frame', frame: value }, [value]);
    }
  } catch (e) { console.warn('processor failed', e); if (running) startVideoPath(); }
}

// Fallback: read frames from the <video> element.
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });
const freeBufs = [];
let tsMode = null, lastTs = -1;
let lastCb = 0, backupOn = false, lastSig = -1, staleCount = 0, lastFreshPic = 0, freezeCount = 0, lastRestart = 0;
// If the camera picture stops changing, the iPhone has paused it (it can do
// this when sound starts, or when the screen layout changes). Nudge it, then
// restart the camera if needed.
let freezeTimer = null;
function startFreezeWatch() {
  clearInterval(freezeTimer);
  lastFreshPic = performance.now();
  let nudged = false;
  freezeTimer = setInterval(async () => {
    if (!running || document.hidden || mode !== 'video' || swingCap.busy) { lastFreshPic = Math.max(lastFreshPic, performance.now() - 300); return; }
    const age = performance.now() - lastFreshPic;
    if (age < 600) { nudged = false; return; }
    if (!nudged) {
      nudged = true; freezeCount++;
      log(`camera picture FROZEN (${Math.round(age)} ms, video ${video.paused ? 'paused' : 'playing'}, track ${stream?.getVideoTracks()[0]?.muted ? 'muted' : 'live'}) — restarting the picture`);
      try { await video.play(); } catch { /* ignore */ }
      return;
    }
    if (age > 2000 && performance.now() - lastRestart > 8000) {
      lastRestart = performance.now();
      log('camera picture still frozen — restarting the camera');
      toast('The camera picture froze — restarting it…', 3000);
      await startCamera();
    }
  }, 250);
}

function startVideoPath() {
  startFreezeWatch();
  mode = 'video'; tsMode = null; lastTs = -1; lastCb = performance.now();
  // Main route: one callback per new camera frame.
  if (video.requestVideoFrameCallback) {
    const step = (now, meta) => {
      if (!running || mode !== 'video') return;
      lastCb = performance.now();
      if (backupOn) { backupOn = false; log('frame callbacks are back'); }
      try { grabFrame(now, meta); } catch (e) { console.error(e); }
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  }
  // Backup route: iPhone sometimes stops those callbacks when the video isn't
  // on show. Then read the picture on every screen refresh instead, skipping
  // repeats of the same camera frame.
  const backup = () => {
    if (!running || mode !== 'video') return;
    if (!video.requestVideoFrameCallback || performance.now() - lastCb > 120) {
      if (!backupOn && video.requestVideoFrameCallback) { backupOn = true; log('frame callbacks stopped — using backup frame reader'); }
      try { grabFrame(performance.now(), null); } catch (e) { console.error(e); }
    }
    requestAnimationFrame(backup);
  };
  requestAnimationFrame(backup);
}
function grabFrame(now, meta) {
  let t;
  if (meta) {
    // captureTime shares the performance.now() clock, so it mixes safely with the backup reader
    if (tsMode == null) tsMode = meta.captureTime ? 'capture' : 'now';
    t = tsMode === 'capture' && meta.captureTime ? meta.captureTime / 1000 : now / 1000;
  } else t = now / 1000;
  if (t === lastTs || !video.videoWidth) return;
  lastTs = t;
  const t0 = performance.now();
  const vw = video.videoWidth, vh = video.videoHeight;
  const W = Math.min(+S.procW, vw), H = Math.round((vh * W) / vw);
  if (grab.width !== W || grab.height !== H) { grab.width = W; grab.height = H; freeBufs.length = 0; }
  gctx.drawImage(video, 0, 0, W, H);
  const d = gctx.getImageData(0, 0, W, H).data;
  // Fingerprint the picture. A real camera picture always changes a little
  // (sensor noise); an identical one means the picture has frozen.
  let sig = 0; for (let i = 0; i < d.length; i += 4 * 211) sig = (sig * 31 + d[i] + d[i + 1]) | 0;
  if (sig === lastSig) { staleCount++; return; }
  lastSig = sig; lastFreshPic = performance.now();
  let buf = freeBufs.pop();
  if (!buf || buf.byteLength !== W * H) buf = new ArrayBuffer(W * H);
  const g = new Uint8Array(buf);
  // red + green only: a yellow ball then stands out from the turf as strongly as a white one
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = ((d[i] * 3 + d[i + 1] * 2) * 51) >> 8;
  worker.postMessage({ cmd: 'gray', buf, w: W, h: H, t, prepMs: performance.now() - t0 }, [buf]);
}

function stopCamera() {
  running = false;
  try { mainReader && mainReader.cancel(); } catch { /* ignore */ }
  mainReader = null;
  worker.postMessage({ cmd: 'stop' });
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

// If no frames reach the analyser, switch to the video-element path.
let watchdog = null;
function startWatchdog() {
  clearInterval(watchdog);
  let last = -1, still = 0, switched = false;
  watchdog = setInterval(() => {
    if (!running) { clearInterval(watchdog); return; }
    if (document.hidden) { still = 0; return; }
    if (eng.frames === last) still++; else { still = 0; last = eng.frames; }
    if (still >= 3 && video.videoWidth) {
      if (!switched && mode !== 'video') { switched = true; console.warn('no frames from', mode, '- switching to video'); log(`no frames from ${mode} — switched to video path`); startVideoPath(); still = 0; }
      else if (still === 6) log('STILL no frames reaching the tracker'), toast('The camera picture isn’t reaching the ball tracker. Close the app fully and open it again.', 6000);
    }
  }, 700);
}

async function populateCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#camSelect');
    sel.innerHTML = '<option value="">Back camera (default)</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join('');
    sel.value = S.camId || '';
  } catch { /* ignore */ }
}

// preview drawing (independent of analysis)
let lastPip = 0, lastChips = 0;
function drawLoop(now) {
  if (!running) return;
  if ($('#setup').classList.contains('show')) { if (now - lastPip > 100) { lastPip = now; drawSetup(); } }
  else if (now - lastPip > 100) { lastPip = now; drawPip(); }
  if (now - lastChips > 400) { lastChips = now; updateChips(); }
  requestAnimationFrame(drawLoop);
}

const pipC = $('#pipCanvas');
function drawPip() {
  const r = pipC.getBoundingClientRect();
  if (!r.width || !video.videoWidth) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (pipC.width !== Math.round(r.width * dpr)) { pipC.width = Math.round(r.width * dpr); pipC.height = Math.round(r.height * dpr); }
  const ctx = pipC.getContext('2d');
  ctx.clearRect(0, 0, pipC.width, pipC.height); // the live video shows underneath
  if (eng.ball && eng.w) {
    const k = pipC.width / eng.w;
    ctx.strokeStyle = eng.state === 'armed' ? '#3fe6ff' : '#ffd34d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(eng.ball.x * k, eng.ball.y * k, Math.max(5, eng.ball.d * k), 0, Math.PI * 2); ctx.stroke();
  }
  $('#pipTag').textContent = eng.state === 'armed' ? 'Ready' : eng.state === 'waiting' ? 'Tee up' : 'Tap to set up';
}
$('#pip').addEventListener('click', () => openSetup());

const setupC = $('#setupCanvas');
let fit = { x: 0, y: 0, w: 1, h: 1, dpr: 1 };
function drawSetup() {
  const r = setupC.getBoundingClientRect();
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  if (setupC.width !== Math.round(r.width * dpr) || setupC.height !== Math.round(r.height * dpr)) { setupC.width = Math.round(r.width * dpr); setupC.height = Math.round(r.height * dpr); }
  const ctx = setupC.getContext('2d');
  const cw = setupC.width, ch = setupC.height;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const sc = Math.min(cw / vw, ch / vh);
  fit = { x: (cw - vw * sc) / 2, y: (ch - vh * sc) / 2, w: vw * sc, h: vh * sc, dpr };
  // Draw the camera picture ourselves (some iPhone browsers won't show the video element),
  // but only ~10 times a second and at modest resolution so the tracker never misses frames.
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
  if (video.videoWidth) ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  for (const f of [0.25, 0.75]) { ctx.beginPath(); ctx.moveTo(fit.x + fit.w * f, fit.y); ctx.lineTo(fit.x + fit.w * f, fit.y + fit.h); ctx.stroke(); }
  if (eng.ball && eng.w) {
    const k = fit.w / eng.w;
    const bx = fit.x + eng.ball.x * k, by = fit.y + eng.ball.y * k;
    ctx.strokeStyle = eng.state === 'armed' ? '#3fe6ff' : '#ffd34d'; ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.arc(bx, by, Math.max(10 * dpr, eng.ball.d * k * 1.2), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(63,230,255,0.5)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(fit.x, by); ctx.lineTo(fit.x + fit.w, by); ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.debug === 'on' && dbg && eng.w) {
    const k = fit.w / eng.w;
    ctx.strokeStyle = '#6fc3ff'; ctx.lineWidth = 2 * dpr; ctx.fillStyle = '#6fc3ff'; ctx.font = `${11 * dpr}px system-ui`;
    for (const c of dbg.cands || []) {
      const x = fit.x + c.x * k, y = fit.y + c.y * k;
      ctx.beginPath(); ctx.arc(x, y, Math.max(8 * dpr, c.d * k), 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(`${c.d.toFixed(0)}px`, x + Math.max(8 * dpr, c.d * k) + 3, y + 4);
    }
  }
  // where to put the ball: a band about a third of the way in, on the side away from the net,
  // so the player still fits and the ball's flight has most of the picture
  if (S.view === 'dtl' && video.videoWidth >= video.videoHeight) { // behind the ball: ball low in the middle, target straight above it
    const mx = fit.x + fit.w / 2, bw = 0.14 * fit.w, by = fit.y + 0.6 * fit.h, bh = 0.28 * fit.h;
    ctx.setLineDash([4 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(57,255,156,0.75)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(mx, fit.y); ctx.lineTo(mx, fit.y + fit.h); ctx.stroke();
    ctx.fillStyle = 'rgba(255,122,26,0.10)'; ctx.fillRect(mx - bw / 2, by, bw, bh); ctx.strokeStyle = 'rgba(255,122,26,0.7)'; ctx.strokeRect(mx - bw / 2, by, bw, bh); ctx.setLineDash([]);
    ctx.fillStyle = '#ff7a1a'; ctx.font = `600 ${12 * dpr}px 'Rajdhani', sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('BALL HERE', mx, by + bh + 14 * dpr); ctx.fillStyle = '#39ff9c'; ctx.fillText('target on this line ↑', mx, fit.y + 16 * dpr); ctx.textAlign = 'left';
  }
  if (S.view !== 'dtl' && video.videoWidth >= video.videoHeight) {
    const ts = targetSide(), x0 = ts > 0 ? 0.27 : 0.61, bx = fit.x + x0 * fit.w, bw = 0.12 * fit.w;
    ctx.fillStyle = 'rgba(255,122,26,0.10)'; ctx.fillRect(bx, fit.y, bw, fit.h);
    ctx.setLineDash([4 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(255,122,26,0.7)'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(bx, fit.y, bw, fit.h); ctx.setLineDash([]);
    ctx.fillStyle = '#ff7a1a'; ctx.font = `600 ${12 * dpr}px 'Rajdhani', sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('BALL HERE', bx + bw / 2, fit.y + fit.h * 0.5);
    ctx.fillText(ts > 0 ? 'net this way →' : '← net this way', fit.x + (ts > 0 ? 0.8 : 0.2) * fit.w, fit.y + fit.h * 0.5); ctx.textAlign = 'left';
  }
  if (S.teeSpot && eng.w && video.videoWidth >= video.videoHeight) {
    const k = fit.w / eng.w;
    ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(63,230,255,0.6)'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(fit.x + S.teeSpot.x * fit.w, fit.y + S.teeSpot.y * fit.h, eng.w * 0.08 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (tapMark && eng.w) {
    const age = performance.now() - tapMark.t;
    if (age > 1500) tapMark = null;
    else {
      const k = fit.w / eng.w;
      ctx.globalAlpha = 1 - age / 1500;
      ctx.strokeStyle = tapMark.ok ? '#3fe6ff' : '#ff6b5b'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(fit.x + tapMark.x * k, fit.y + tapMark.y * k, 26 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
setupC.addEventListener('click', async (e) => {
  if (!running) return;
  if (!eng.w) { toast('Camera is still starting — try again in a second'); log('tap ignored: no frames yet'); return; }
  const r = setupC.getBoundingClientRect();
  const x = (e.clientX - r.left) * fit.dpr, y = (e.clientY - r.top) * fit.dpr;
  const px = ((x - fit.x) / fit.w) * eng.w, py = ((y - fit.y) / fit.h) * eng.h;
  if (px < 0 || py < 0 || px > eng.w || py > eng.h) return;
  const b = await setBall(px, py);
  log(`tap at ${px.toFixed(0)},${py.toFixed(0)} → ${b ? 'ball found' : 'NO ball found'}`);
  if (!b) { toast('Couldn’t find a ball there — tap right on the ball. It needs to look brighter than the ground around it.'); flashTap(px, py, false); return; }
  if (b.d < 3 || b.d > eng.w * 0.022) {
    // far too small or too big to be a golf ball at a sensible distance: don't save it
    log(`tap found something ${b.d.toFixed(1)} px wide — not saved as the ball`);
    toast(b.d < 3 ? 'That looks too small to be the ball — the phone is too far away, or you tapped something else. Move the phone to about 3 m and tap the ball again.' : 'That looks too big to be the ball — you may have tapped a shoe or the club, or the phone is too close. Stand about 3 m away and tap the ball again.', 7000);
    flashTap(px, py, false); worker.postMessage({ cmd: 'reset' }); eng.state = 'idle'; eng.ball = null; updateReady(); return;
  }
  flashTap(px, py, true);
  // remember the tee spot: from now on the app only looks for a ball here
  S.teeSpot = { x: b.x / eng.w, y: b.y / eng.h }; saveSettings(); sendConfig(); renderTeeChip();
  log(`tee spot saved at ${(S.teeSpot.x * 100).toFixed(0)}%, ${(S.teeSpot.y * 100).toFixed(0)}% of the picture`);
  updateChips();
});

let tapMark = null;
let dbg = null, dbgBusy = false;
setInterval(async () => {
  if (S.debug !== 'on' || !running || dbgBusy || !$('#setup').classList.contains('show')) return;
  dbgBusy = true; dbg = await workerDebug(); dbgBusy = false;
}, 400);
function flashTap(x, y, ok) { tapMark = { x, y, ok, t: performance.now() }; }

let lastReadySt = null;
let wasPortrait = null;
function updateReady() {
  const portrait = running && video.videoHeight > video.videoWidth;
  if (portrait !== wasPortrait && running && video.videoWidth) { log(portrait ? 'phone is upright (portrait) — waiting for landscape' : 'phone is sideways (landscape)'); wasPortrait = portrait; }
  const tilted = running && !portrait && gRef && tiltHeld;
  const moved = running && !portrait && performance.now() < phoneMovedUntil;
  const st = !running ? 'off' : portrait ? 'turn' : tilted ? 'tilt' : moved ? 'moved' : eng.state === 'armed' ? 'ready' : eng.state === 'waiting' ? 'tee' : 'look';
  document.body.dataset.ready = st;
  const el = $('#readyLight');
  el.querySelector('b').textContent = st === 'ready' ? 'READY' : st === 'tee' ? 'TEE UP' : st === 'look' ? 'PUT A BALL DOWN' : st === 'turn' ? 'TURN PHONE SIDEWAYS' : st === 'tilt' ? 'PHONE TILTED' : st === 'moved' ? 'PHONE MOVED' : '';
  el.querySelector('span').textContent = st === 'tilt' ? `Tilted ${tiltDeg.toFixed(0)}° — put it back or keep it still` : st === 'moved' ? 'Keep it still — finding the ball again' : st === 'ready' ? 'Hit away' : st === 'tee' ? 'Same spot as before' : st === 'look' ? 'I’ll find it — or tap it on the camera screen' : st === 'turn' ? 'Already sideways? Rotation lock is on — swipe down from the top-right corner and tap the 🔒 button to turn it off' : '';
  if ($('#setup').classList.contains('show') && st !== lastReadySt) {
    $('#setupMsg').textContent = st === 'tilt' ? `Phone tilted ${tiltDeg.toFixed(0)}° — put it back where it was, or keep it still` : st === 'moved' ? 'The phone moved — keep it still (use a stand)' : st === 'ready' ? 'Ready — hit away' : st === 'tee' ? 'Tee up the next ball in the same spot' : st === 'turn' ? 'Turn the phone sideways. Already sideways? Turn off rotation lock: swipe down from the top-right corner, tap the 🔒 button' : 'Put a ball down and step back — I’ll find it (or tap it)';
  }
  lastReadySt = st;
}

// The two set-up mistakes that spoil readings: the ball tiny in the picture
// (phone too far away) and the ball near the edge (the swing goes out of view).
let lastFramingWarn = 0, framingIssue = '';
// other iPhone browsers hold the camera to 30 pictures a second and keep their own separate settings
const NOT_SAFARI = /EdgiOS/.test(navigator.userAgent) ? 'Edge' : /CriOS/.test(navigator.userAgent) ? 'Chrome' : /FxiOS/.test(navigator.userAgent) ? 'Firefox' : '';
let movedTimes = [];
const saidFraming = new Set();
function ballDistance(b) {
  if (usedBallDist()) return usedBallDist();
  const f = (eng.w / 2) / Math.tan((+S.hfov * Math.PI) / 360);
  return (f * BALL.diameter) / b.d;
}
// which way the ball flies across the picture: +1 = to the right
function targetSide() { return S.hand === 'right' ? 1 : S.hand === 'left' ? -1 : (lastTargetSign || 1); }
function checkFraming(b) {
  if (!eng.w || !b) return;
  sendConfig(); // the distance used for speed depends on the light
  const issues = [];
  const dist = ballDistance(b), xf = b.x / eng.w;
  const wide = S.lens === 'wide', want = wide ? 2 : 3;
  if (!isDim() && !(+S.ballDist > 0.5) && b.d < (wide ? 6 : 7)) issues.push({ key: 'small', say: `The ball is too small in the picture. Move the phone closer, about ${want} metres from the ball.`, text: `Ball only ${b.d.toFixed(0)} px — the phone looks about ${dist.toFixed(0)} m away. Move it to about ${want} m from the ball.` });
  if (!isDim() && !(+S.ballDist > 0.5) && b.d >= 7 && dist < (wide ? 1.5 : 2.3)) issues.push({ key: 'close', say: wide ? 'The phone is too close. Move it back to about 2 metres.' : 'The phone is too close for the normal lens. Move it back to 3 metres, or tap Camera and switch to the wide lens.', text: wide ? `The phone is only about ${dist.toFixed(1)} m from the ball — move it back to about 2 m.` : `The phone is only about ${dist.toFixed(1)} m from the ball — your whole body won’t fit. Move it back to about 3 m, or tap Camera › 🔭 to use the wide lens at 2 m.` });
  if (isDim()) issues.push({ key: 'slow', say: 'It is too dark. The camera has slowed down, so shots will be missed. Use it in daylight or under bright lights.', text: `Too dark: the camera has slowed to ${Math.round(eng.fps)} pictures a second (it needs 60), so fast shots are missed or misread. Use it in daylight or under bright lights.${NOT_SAFARI ? ' Also open the app in Safari, not ' + NOT_SAFARI + '.' : ''}${+S.ballDist > 0.5 ? '' : ` Speed is being worked out as if the phone is ${S.lens === 'wide' ? 2 : 3} m from the ball.`}` });
  // room for the ball's flight: the ball should sit about a third in from the side away from the net
  const along = targetSide() > 0 ? xf : 1 - xf; // 0 = edge away from the net, 1 = edge nearest the net
  if (S.view !== 'dtl' && along > 0.45 && along <= 0.8) {
    const shift = (along - 0.33) * 2 * dist * Math.tan((+S.hfov * Math.PI) / 360);
    issues.push({ key: 'flight', say: `Move the phone about ${shift < 0.75 ? 'half a metre' : Math.round(shift) + (Math.round(shift) === 1 ? ' metre' : ' metres')} towards the net, so the camera sees more of the ball's flight.`, text: `The ball is ${Math.round(along * 100)}% of the way across the picture, so the camera only sees a short piece of its flight. Slide the phone about ${shift.toFixed(1)} m towards the net (keep it pointing straight at the player’s line) until the ball sits in the orange “BALL HERE” band on the camera screen.` });
  }
  if (S.view === 'dtl' && (xf < 0.36 || xf > 0.64)) issues.push({ key: 'centre', say: 'Move the phone so the ball is in the middle of the picture, with your target straight above it.', text: 'Phone behind the ball: the ball should be in the middle of the picture (in the orange box) with the target straight above it on the green line.' });
  if (S.view === 'dtl' && b.y / eng.h < 0.5) issues.push({ key: 'high', say: 'Tip the phone up a little, so the ball is in the lower part of the picture.', text: 'Phone behind the ball: the ball should be in the lower part of the picture, so the camera can see it fly towards the net.' });
  if (S.view !== 'dtl' && (xf < 0.2 || xf > 0.8)) issues.push({ key: 'edge', say: 'The ball is close to the edge of the picture. Move the phone so the ball is about a third of the way in.', text: `Ball is ${Math.round((xf < 0.5 ? xf : 1 - xf) * 100)}% from the edge of the picture — your swing goes out of view. Move the phone so the ball is about a third of the way in.` });
  framingIssue = issues.map((i) => i.key).join(',');
  if (!issues.length) return;
  log(`SET-UP WARNING ${issues.map((i) => i.text).join(' · ')}`);
  if (performance.now() - lastFramingWarn < 60000) return; // once a minute is enough
  lastFramingWarn = performance.now();
  toast(issues.map((i) => i.text).join('\n'), 9000);
  // say each set-up problem out loud once only; after that it's on screen
  const fresh = issues.find((i) => !saidFraming.has(i.key));
  if (fresh) { saidFraming.add(fresh.key); setTimeout(() => say(fresh.say), 1600); }
}

function updateChips() {
  const fps = eng.fps || 0;
  const cf = $('#cFps');
  cf.textContent = `Camera ${video.videoWidth}×${video.videoHeight} · ${fps.toFixed(0)} fps`;
  cf.className = 'chip ' + (fps >= 55 ? 'ok' : fps >= 40 ? 'warn' : 'bad');
  const cp = $('#cProc');
  const budget = 1000 / Math.max(30, fps);
  cp.textContent = `Processing ${(eng.procMs || 0).toFixed(1)} ms/frame`;
  cp.className = 'chip ' + (eng.procMs < budget * 0.7 ? 'ok' : eng.procMs < budget ? 'warn' : 'bad');
  const cb = $('#cBall');
  if (eng.ball && eng.w) {
    const f = (eng.w / 2) / Math.tan((+S.hfov * Math.PI) / 360);
    const measured = +S.ballDist > 0.5;
    const dist = measured ? +S.ballDist : (f * BALL.diameter) / eng.ball.d;
    const wideL = S.lens === 'wide'; const tooClose = dist < (wideL ? 1.5 : 2.2), tooFar = dist > (wideL ? 2.8 : 4.2);
    cb.textContent = `Ball ${eng.ball.d.toFixed(0)} px · ${measured ? '' : 'about '}${dist.toFixed(1)} m away${measured ? ' (measured)' : ''}${tooClose ? ' — too close, move the phone back to 2.5–3.5 m' : tooFar ? ' — too far, move closer' : ''}`;
    cb.className = 'chip ' + (tooClose || tooFar ? 'bad' : 'ok');
  } else { cb.textContent = 'Ball: tap it'; cb.className = 'chip'; }
}

// Phone position watch (motion sensor). When the ball is found we remember
// which way gravity points; if the phone then tilts away from that, we say so.
let motionOn = false, motionAsked = false, gRef = null, gNow = null, tiltDeg = 0, tiltSince = 0, tiltHeld = false;
async function startMotion(fromTap) {
  if (motionOn) return true;
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      if (!fromTap && motionAsked) return false;
      motionAsked = true;
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') { log('motion sensor refused — phone tilt warnings only from the camera picture'); return false; }
    }
  } catch { return false; }
  motionOn = true;
  let last = 0;
  window.addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    const now = performance.now(); if (now - last < 100) return; last = now;
    // smooth out hand tremor and swing vibration a little
    gNow = gNow ? { x: gNow.x * 0.6 + g.x * 0.4, y: gNow.y * 0.6 + g.y * 0.4, z: gNow.z * 0.6 + g.z * 0.4 } : { x: g.x, y: g.y, z: g.z };
    if (gRef) {
      const dot = gRef.x * gNow.x + gRef.y * gNow.y + gRef.z * gNow.z, n = Math.hypot(gRef.x, gRef.y, gRef.z) * Math.hypot(gNow.x, gNow.y, gNow.z);
      const deg = n ? (Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180) / Math.PI : 0;
      // only call it tilted once it has stayed tilted for 3 seconds (a tap or a gust is not a problem)
      tiltDeg = deg;
      if (deg >= TILT_WARN) { if (!tiltSince) tiltSince = now; } else tiltSince = 0;
      const held = !!tiltSince && now - tiltSince > 3000;
      if (held !== tiltHeld) { tiltHeld = held; if (held) onPhoneTilted(deg); updateReady(); }
    }
    const el = $('#cLevel');
    if (Math.abs(g.x) < Math.abs(g.y)) { el.textContent = 'Turn the phone to landscape'; el.className = 'chip warn'; return; }
    const roll = (Math.atan2(Math.abs(g.y), Math.abs(g.x)) * 180) / Math.PI;
    el.textContent = `Level ${roll.toFixed(1)}°${roll < 1 ? ' ✓' : ''}${gRef ? ` · moved ${tiltDeg.toFixed(1)}°` : ''}`;
    el.className = 'chip ' + (roll < 1 && tiltDeg < TILT_WARN ? 'ok' : roll < 2.5 && tiltDeg < TILT_WARN ? 'warn' : 'bad');
  });
  log('motion sensor on — will warn if the phone tilts');
  return true;
}
const TILT_WARN = 2.5; // degrees away from where it was when the ball was found
let lastMoveSay = -1e9, phoneMovedUntil = 0;
let lastTiltLog = 0, lastLevelWarn = 0;
// is the phone level (not leaning sideways)? A lean adds straight onto the launch angle.
function checkLevel() {
  if (!gNow || Math.abs(gNow.x) < Math.abs(gNow.y)) return;
  const roll = (Math.atan2(gNow.y, Math.abs(gNow.x)) * 180) / Math.PI, pitch = (Math.atan2(gNow.z, Math.abs(gNow.x)) * 180) / Math.PI;
  log(`phone level at READY: leaning sideways ${roll.toFixed(1)}° · tipped forward/back ${pitch.toFixed(1)}°`);
  if (Math.abs(roll) >= 3 && performance.now() - lastLevelWarn > 120000) {
    lastLevelWarn = performance.now();
    toast(`The phone is leaning ${Math.abs(roll).toFixed(0)}° sideways — that throws the launch angle off by the same amount. Level it on the stand (Camera screen › Level chip should say ✓).`, 9000);
    say('The phone is not level. Straighten it on the stand.');
  }
}
function onPhoneTilted(deg) {
  if (performance.now() - lastTiltLog > 10000) { lastTiltLog = performance.now(); log(`PHONE TILTED ${deg.toFixed(1)}° from where it was when the ball was found`); }
  if (performance.now() - lastMoveSay > 120000) { lastMoveSay = performance.now(); beep(300, 0.2); say('The phone has moved. Put it back, or keep it still.'); }
}
function phoneMovedFromPicture() {
  phoneMovedUntil = performance.now() + 4000; updateReady();
  setTimeout(updateReady, 4100);
  if (performance.now() - lastMoveSay > 120000) { lastMoveSay = performance.now(); beep(300, 0.2); say('The phone moved. Keep it still.'); }
}
$('#cLevel').addEventListener('click', () => startMotion(true));

function openSetup() {
  $('#setup').classList.add('show');
  lastReadySt = null; updateReady();
  $('#setupMsg').textContent = eng.state === 'armed' ? 'Ready — hit away (tap the ball again to re-mark it)' : 'Put a ball down and step back — I’ll find it (or tap it)';
  if (!running) startCamera();
}
function closeSetup() { $('#setup').classList.remove('show'); }
$('#setupDone').addEventListener('click', closeSetup);
$('#cameraBtn').addEventListener('click', () => { unlockAudio('Camera on'); startMotion(true); openSetup(); });

let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !running) return;
  requestWakeLock();
  const tr = stream?.getVideoTracks()[0];
  if (!tr || tr.readyState === 'ended') { startCamera(); toast('Camera restarted — tap the ball again'); }
});

// ------------------------------------------------------------ replay
let rIdx = 0;
function openReplay() {
  if (!lastCapture) { toast('No camera shot captured yet'); return; }
  const ev = lastCapture;
  const sl = $('#rSlider'); sl.max = ev.frames.length - 1;
  // start on the first frame with a detection
  const first = ev.track ? ev.frames.findIndex((f) => ev.track.pts.some((p) => Math.abs(p.t - f.t) < 1e-6)) : -1;
  rIdx = Math.max(0, first >= 0 ? first - 1 : 0); sl.value = rIdx;
  $('#replayInfo').textContent = ev.type === 'shot'
    ? `Ball seen in ${ev.launch.points} frames · ${ev.fps.toFixed(0)} fps · about ${ev.launch.distanceToBall.toFixed(1)} m from the phone`
    : 'The ball left the tee but wasn’t found in flight. Check it shows up clearly against the background in these frames.';
  openSheet('#replaySheet');
  drawReplay();
}
function drawReplay() {
  const ev = lastCapture; if (!ev) return;
  const c = $('#replayCanvas');
  const fr = ev.frames[rIdx];
  c.width = ev.w; c.height = ev.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(ev.w, ev.h);
  for (let i = 0, j = 0; j < fr.g.length; i += 4, j++) { const v = fr.g[j]; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const lw = Math.max(1.5, ev.w / 400);
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#3fe6ff';
  ctx.beginPath(); ctx.arc(ev.tee.x, ev.tee.y, ev.tee.d * 1.3, 0, Math.PI * 2); ctx.stroke();
  if (ev.track) {
    const pts = ev.track.pts;
    const last = pts[pts.length - 1];
    ctx.strokeStyle = 'rgba(255,211,77,0.6)';
    ctx.beginPath(); ctx.moveTo(ev.tee.x, ev.tee.y);
    const k = 1.6; ctx.lineTo(ev.tee.x + (last.x - ev.tee.x) * k, ev.tee.y + (last.y - ev.tee.y) * k); ctx.stroke();
    for (const p of pts) {
      const on = Math.abs(p.t - fr.t) < 1e-6;
      ctx.strokeStyle = on ? '#ffd34d' : 'rgba(255,211,77,0.45)'; ctx.lineWidth = on ? lw * 2 : lw;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, p.d * 1.2), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.fillStyle = '#fff'; ctx.font = `${Math.round(ev.w / 40)}px system-ui`;
  ctx.fillText(`frame ${rIdx + 1}/${ev.frames.length}  t=${((fr.t - ev.frames[0].t) * 1000).toFixed(0)} ms`, 10, ev.h - 12);
}
$('#rSlider').addEventListener('input', (e) => { rIdx = +e.target.value; drawReplay(); });
$('#rPrev').addEventListener('click', () => { rIdx = Math.max(0, rIdx - 1); $('#rSlider').value = rIdx; drawReplay(); });
$('#rNext').addEventListener('click', () => { rIdx = Math.min(lastCapture.frames.length - 1, rIdx + 1); $('#rSlider').value = rIdx; drawReplay(); });
$('#replayBtn').addEventListener('click', openReplay);

// ------------------------------------------------------------ settings
function renderSettings() {
  $$('.seg[data-set]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(S[seg.dataset.set]) === b.dataset.v)));
  $$('[data-num]').forEach((i) => { i.value = S[i.dataset.num]; });
  $$('[data-sel]').forEach((i) => { i.value = S[i.dataset.sel]; });
  try { const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); $('#voiceSel').innerHTML = vs.length ? vs.map((v) => `<option value="${v.name}" ${voicePick && v.name === voicePick.name ? 'selected' : ''}>${v.name} (${v.lang})${NOVELTY.test(v.name) ? ' · novelty' : ''}</option>`).join('') : '<option>No voices offered by this browser</option>'; } catch { /* none */ }
  $('#camSelect').value = S.camId || '';
  $('#about').textContent = `Golf Sim ${VERSION} · capture: ${mode || 'not started'} · camera ${video.videoWidth || 0}×${video.videoHeight || 0} @ ${(eng.fps || 0).toFixed(0)} fps. Shots are stored on this phone only.`;
}
$$('.seg[data-set]').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S[seg.dataset.set] = b.dataset.v; saveSettings(); renderSettings(); applyUnits(); sendConfig();
}));
$$('[data-num]').forEach((i) => i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) { S[i.dataset.num] = v; saveSettings(); sendConfig(); } }));
$$('[data-sel]').forEach((i) => i.addEventListener('change', () => { S[i.dataset.sel] = i.value; saveSettings(); sendConfig(); worker.postMessage({ cmd: 'reset' }); eng.ball = null; if (running) setStatus('busy', 'Looking for the ball'); }));
$('#camSelect').addEventListener('change', async (e) => {
  S.camId = e.target.value;
  const label = e.target.selectedOptions[0]?.textContent || '';
  if (/ultra/i.test(label)) S.hfov = 106; else if (/tele/i.test(label)) S.hfov = 34; else S.hfov = 67;
  saveSettings(); renderSettings(); sendConfig(); eng.ball = null;
  if (running) { await startCamera(); toast('Camera switched — tap the ball again'); }
});
$('#settingsBtn').addEventListener('click', () => { renderSettings(); populateCameras(); openSheet('#settingsSheet'); });
$('#helpBtn').addEventListener('click', () => openSheet('#helpSheet'));
function applyUnits() {
  range.unit = S.dist; refreshRange(); renderList();
  const last = sessionShots().filter((s) => !s.miss).pop();
  if (last) showNumbers(last); else $('#uCarry').textContent = dUnit();
}


video.addEventListener('pause', () => { if (running) { log('camera picture paused by the iPhone — resuming'); video.play().catch(() => { /* ignore */ }); } });

// ------------------------------------------------------------ swing check
const swingCap = new SwingCapture(video, log);
let lastSwing = null;
let lastTargetSign = store.get('targetSign', 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]];
const NOTES = {
  nobody: 'Couldn’t see you in the picture.',
  feet: 'Couldn’t see your feet — get your whole body in the picture.',
  head: 'Couldn’t see your head — raise the phone to hip height or move it back a little.',
  backswing: 'Couldn’t follow that swing clearly.',
  address: 'Couldn’t see your set-up clearly before the swing.',
  unclear: 'Couldn’t see your body clearly enough.',
  imported: 'Added video — for watching and comparing, not scored.',
  edge: 'Your hands went out of the picture at the top of your swing — move the phone back a little, or so the ball is about a third of the way in from the edge.',
  load: 'Swing tips need internet the first time to download (about 20 MB).',
};
const POS = [['addr', 'Address'], ['take', 'Takeaway'], ['half', 'Halfway back'], ['top', 'Top'], ['down', 'Downswing'], ['imp', 'Impact'], ['thru', 'Follow-through'], ['fin', 'Finish']];
const isDTL = () => S.view === 'dtl';

function setTips(html) { const el = $('#tips'); el.hidden = !html; el.innerHTML = html || ''; }
function scoreColour(v) { return v >= 8 ? "var(--accent)" : v >= 6 ? "var(--accent2)" : "var(--bad)"; }

// ev: the shot detector's event; rec: the shot record (or a swing-only record)
let swingChecking = false;
async function runSwingCheck(ev, rec) {
  if (swingChecking) { log('swing check skipped — still checking the last swing'); return; }
  swingChecking = true;
  try { await runSwingCheck2(ev, rec); } finally { swingChecking = false; }
}
async function runSwingCheck2(ev, rec) {
  // everything here uses the shot detector's clock
  const tImp = ev.track ? ev.track.tImp : ev.tOnset;
  const offset = performance.now() / 1000 - ev.tNow;
  setTips('<div class="h">Swing check</div><div class="note">Checking your swing…</div>');
  await sleep(Math.max(0, (tImp + offset + 1.1 - performance.now() / 1000) * 1000));
  let res, frames = [], pics = [];
  worker.postMessage({ cmd: 'hold', on: true }); // don't get ready for the next ball until this is done
  const unhold = setTimeout(() => worker.postMessage({ cmd: 'hold', on: false }), 9000);
  const dtl = isDTL();
  try {
    pics = SwingCapture.toPics(await workerSnaps(tImp - 2.3, tImp + 1.05));
    ({ frames } = await swingCap.analyse(pics, ev.w, ev.h));
    if (ev.launch && ev.launch.targetSign) lastTargetSign = ev.launch.targetSign;
    const target = (ev.launch && ev.launch.targetSign) || lastTargetSign;
    const sgn = S.hand === 'right' ? 1 : S.hand === 'left' ? -1 : (dtl ? 1 : target || 1);
    const o = { tImp, ball: ev.tee, club: rec.club, s: sgn, heightCm: +S.heightCm || 0, w: ev.w, h: ev.h };
    res = dtl ? analyseSwingDTL(frames, o) : analyseSwing(frames, o);
  } catch (e) { res = { ok: false, reason: 'load', error: String(e.message || e) }; }
  finally { clearTimeout(unhold); worker.postMessage({ cmd: 'hold', on: false }); }
  store.set('targetSign', lastTargetSign);
  res.view = dtl ? 'dtl' : 'face';
  lastSwing = res;
  // save the swing so it can be watched again (even if the body check failed)
  if (pics.length) {
    swingCap.busy = true;
    try { await storeSwing(rec, res, frames, pics, ev, tImp); lastSwingId = rec.id; log(`swing saved for replay (${pics.length} pictures)`); }
    catch (e) { log(`couldn't save swing for replay: ${e.message || e}`); }
    finally { swingCap.busy = false; }
  }
  const watch = pics.length ? '<button id="tipsMore">Watch swing ›</button>' : '';
  if (!res.ok) {
    log(`SWING not analysed: ${res.reason}${res.error ? ' ' + res.error : ''} (body seen in ${res.seen ?? 0} pictures)`);
    rec.swing = { ok: false, note: NOTES[res.reason] || 'not seen' };
    setTips(`<div class="h">Swing check ${watch}</div><div class="note">${NOTES[res.reason] || 'Couldn’t check that swing.'}</div>`);
  } else {
    const m = res.metrics;
    const r = (v) => (v == null ? null : Math.round(v));
    rec.swing = { ok: true, view: res.view, score: res.score, tempo: m.tempo ?? null, tips: res.tips.slice(0, 3).map((t) => ({ key: t.key, short: t.short })),
      m: { stanceCm: r(m.stanceCm), ballPct: m.ballPos != null ? r(m.ballPos * 100) : null, headTopCm: r(m.headTopCm), hipTopCm: r(m.hipTopCm), hipImpCm: r(m.hipImpCm), headImpCm: r(m.headImpCm),
        tilt: r(m.tilt), handsAheadCm: r(m.handsAheadCm), finishHipCm: r(m.finishHipCm), spineAngle: r(m.spineAngle), kneeFlex: r(m.kneeFlex), earlyExtCm: r(m.earlyExtCm), headDropCm: r(m.headDropCm) } };
    log(`SWING ${rec.club} (${res.view}): score ${res.score} · tempo ${m.tempo ? m.tempo.toFixed(1) : '—'} · ${Object.entries(rec.swing.m).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ')} · scale ${res.scaleFrom} · tips: ${res.tips.map((t) => t.key).join(', ') || 'none'}`);
    const top = res.tips.slice(0, 2);
    const noHeight = !(+S.heightCm);
    setTips(`<div class="h">Swing check ${watch}</div>` +
      `<div class="scoreline"><b style="color:${scoreColour(res.score)}">${res.score.toFixed(1)}</b><span>/10</span>${m.tempo ? `<em>Tempo ${m.tempo.toFixed(1)}:1</em>` : ''}</div>` +
      (top.length ? `<ul>${top.map((t) => `<li>${t.short}</li>`).join('')}</ul>` : `<div class="ok">Looks good — ${res.good.slice(0, 2).join(' · ') || 'no clear faults'}</div>`) +
      (noHeight ? '<div class="note">Add your height in Settings for accurate cm.</div>' : ''));
    if (top.length) setTimeout(() => say(`Score ${res.score.toFixed(0)}. Tip: ${top[0].short}`), 2200);
  }
  $('#tipsMore')?.addEventListener('click', () => openSwings(lastSwingId));
  saveShots(); if (tab === 'swing') renderList();
  // replay the swing straight away
  if (S.autoReplay !== 'off' && pics.length && lastSwingId === rec.id && document.visibilityState === 'visible') {
    await openSwings(rec.id, { auto: true });
    if (eng.state === 'armed') closeAutoReplay(); // next ball already teed: one loop, then out of the way
  }
}

// setup screen: is the whole body in the picture?
let bodyBusy = false;
setInterval(async () => {
  const chip = $('#cBody');
  if (S.tips !== 'on' || !running || !$('#setup').classList.contains('show')) { chip.hidden = true; return; }
  if (eng.state === 'armed' || video.videoHeight > video.videoWidth) return; // never compete with a live shot
  chip.hidden = false;
  if (!swingCap.pose) { chip.textContent = 'Body check: loading…'; chip.className = 'chip'; swingCap.load().catch(() => { chip.textContent = 'Body check: needs internet once'; }); return; }
  if (bodyBusy) return;
  bodyBusy = true;
  try {
    const lm = await swingCap.check(eng.w || 960, eng.h || 540);
    if (!lm) return;
    const vis = (i) => lm.length && lm[i].v > 0.5;
    if (!lm.length) { chip.textContent = 'Body: can’t see you — stand at the ball'; chip.className = 'chip warn'; }
    else if (!vis(0)) { chip.textContent = 'Body: can’t see your head — raise the phone'; chip.className = 'chip bad'; }
    else if (!vis(27) || !vis(28)) { chip.textContent = 'Body: can’t see your feet'; chip.className = 'chip bad'; }
    else { chip.textContent = 'Body: head to feet in view ✓'; chip.className = 'chip ok'; }
  } finally { bodyBusy = false; }
}, 2000);


// ------------------------------------------------------------ my swings (replay, compare, progress)
let lastSwingId = null;
async function storeSwing(rec, res, frames, pics, ev, tImp) {
  const W = 480, k = W / ev.w;
  const c = document.createElement('canvas'); c.width = W; c.height = Math.round(ev.h * k);
  const ctx = c.getContext('2d');
  const out = [];
  for (const p of pics) {
    ctx.drawImage(p.bmp, 0, 0, c.width, c.height);
    const jpg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.66));
    const f = frames.find((q) => q.t === p.t);
    out.push({ t: +(p.t - tImp).toFixed(3), jpg, lm: f && f.lm ? f.lm.map((q) => [Math.round(q.x * k), Math.round(q.y * k), +q.v.toFixed(2)]) : null });
  }
  const r = res && res.ok ? res : null;
  const rel = (v) => (v == null ? null : +(v - tImp).toFixed(3));
  const phases = {};
  if (r) for (const [key] of POS) phases[key] = rel(r.phases[key]);
  await saveSwing({
    id: rec.id, ts: rec.ts, session: rec.session, club: rec.club, swingOnly: !!rec.swingOnly,
    carry: rec.carry ?? null, total: rec.total ?? null, speed: rec.speed ?? null, launch: rec.launch ?? null,
    view: res.view || 'face', ok: !!r, reason: r ? null : (res && res.reason) || 'unknown',
    score: r ? r.score : null,
    tips: r ? r.tips.map((t) => ({ key: t.key, short: t.short, text: t.text, drill: t.drill })) : [], good: r ? r.good : [],
    metrics: r ? r.metrics : null, group: r ? r.group : null, scaleFrom: r ? r.scaleFrom : null, s: r ? r.s : 1,
    phases: r ? phases : null,
    addrLm: r ? r.frames.addr.lm.map((q) => [Math.round(q.x * k), Math.round(q.y * k)]) : null,
    tee: { x: ev.tee.x * k, y: ev.tee.y * k }, w: c.width, h: c.height, frames: out, best: false, drawings: [],
  });
}

const fmtWhen = (ts) => { const d = new Date(ts); const today = new Date().toDateString() === d.toDateString(); return (today ? 'Today ' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') + d.toTimeString().slice(0, 5); };
const swingTitle = (r) => r.name ? `🎞 ${r.name}` : `${clubById(r.club).name}${r.swingOnly ? ' · swing only' : r.carry != null ? ` · ${fmtDist(r.carry)} ${dUnit()}` : ''}`;

// ---- training goals
const GOALS = {
  score: { name: 'Higher swing score', unit: '/10', band: [8, 10], get: (r) => r.score, both: true },
  tempo: { name: 'Tempo of 3:1', unit: ':1', band: [2.6, 3.4], get: (r) => r.metrics && r.metrics.tempo, both: true, dp: 1 },
  hipTop: { name: 'Less hip slide on the backswing', unit: ' cm', band: [-8, 4], get: (r) => r.metrics && r.metrics.hipTopCm, view: 'face' },
  headTop: { name: 'Steadier head on the backswing', unit: ' cm', band: [-6, 6], get: (r) => r.metrics && r.metrics.headTopCm, view: 'face' },
  hipImp: { name: 'Weight forward at impact', unit: ' cm', band: [3, 15], get: (r) => r.metrics && r.metrics.hipImpCm, view: 'face' },
  finish: { name: 'Finish on the front foot', unit: ' cm', band: [-12, 15], get: (r) => r.metrics && r.metrics.finishHipCm, view: 'face' },
  ballPos: { name: 'Consistent ball position', unit: '%', band: [45, 65], get: (r) => r.metrics && r.metrics.ballPos != null ? r.metrics.ballPos * 100 : null, view: 'face' },
  earlyExt: { name: 'No early extension', unit: ' cm', band: [-3, 5], get: (r) => r.metrics && r.metrics.earlyExtCm, view: 'dtl' },
  spine: { name: 'Posture at address', unit: '°', band: [30, 45], get: (r) => r.metrics && r.metrics.spineAngle, view: 'dtl' },
  headLevel: { name: 'Level head through impact', unit: ' cm', band: [-5, 6], get: (r) => r.metrics && r.metrics.headDropCm, view: 'dtl' },
};

// the automatic replay closes when the next ball is ready, but always plays
// at least one full slow-motion loop first
function closeAutoReplay() {
  const wait = Math.max(0, 7000 - (performance.now() - P.openedAt));
  clearTimeout(P.closeTimer);
  P.closeTimer = setTimeout(() => {
    if (!P.auto || !$('#swingsSheet').classList.contains('show')) return;
    stopPlayer(); P.auto = false; $('#swingsSheet').classList.remove('show');
  }, wait);
}
async function openSwings(id, opts = {}) {
  openSheet('#swingsSheet');
  stopPlayer();
  P.auto = !!opts.auto; P.openedAt = performance.now(); clearTimeout(P.closeTimer);
  if (id) return openPlayer(id);
  $('#swPlayer').hidden = true; $('#swSeq').hidden = true; $('#swImport').hidden = true; $('#swAddRow').hidden = false; $('#swList').hidden = false; $('#swHead').textContent = 'My swings';
  let list = [];
  try { list = await listSwings(); } catch (e) { $('#swList').innerHTML = `<div class="empty">Couldn’t open saved swings (${e.message || e}).</div>`; return; }
  if (!list.length) { $('#swList').innerHTML = '<div class="empty">No swings saved yet. Every shot the app reads is saved here with a slow-motion replay and your swing check (keep “Swing tips” on in Settings).</div>'; return; }
  const ok = list.filter((r) => r.ok && r.metrics).slice(0, 10);
  let sum = '';
  if (ok.length) {
    const avg = (f) => { const v = ok.map(f).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const R = (v, u = '', dp = 0) => (v == null ? '—' : `${v.toFixed(dp)}${u}`);
    const counts = {};
    for (const r of ok) for (const t of r.tips) counts[t.short] = (counts[t.short] || 0) + 1;
    const common = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2);
    sum = `<div class="summary"><b>Your last ${ok.length} checked swing${ok.length > 1 ? 's' : ''}</b><br>
      Score ${R(avg((r) => r.score), '/10', 1)} · tempo ${R(avg((r) => r.metrics.tempo), ':1', 1)} · ${ok[0].view === 'dtl' ? `posture ${R(avg((r) => r.metrics.spineAngle), '°')} · hips toward ball ${R(avg((r) => r.metrics.earlyExtCm), ' cm')}` : `head on backswing ${R(avg((r) => r.metrics.headTopCm), ' cm')} · hips at impact ${R(avg((r) => r.metrics.hipImpCm), ' cm')}`}<br>
      ${common.length ? `Most common: ${common.map(([t, n]) => `<span style="color:var(--accent2)">${t}</span> (${n}×)`).join(', ')}` : '<span style="color:var(--accent)">No repeated faults</span>'}</div>`;
  }
  $('#swList').innerHTML = sum + list.map((r) => `<div class="row-sw" data-sw="${r.id}"><div><b>${r.best ? '⭐ ' : ''}${swingTitle(r)}</b> <span class="sub">· ${fmtWhen(r.ts)}${r.view === 'dtl' ? ' · behind' : ''}</span>
    <div class="${r.ok ? 'tip' : 'sub'}">${r.ok ? `<span style="color:${scoreColour(r.score)};font-weight:800">${(r.score ?? 0).toFixed(1)}</span> · ${r.tips.length ? r.tips.slice(0, 2).map((t) => t.short).join(' · ') : '✓ Looks good'}` : 'Swing not checked — ' + (NOTES[r.reason] || 'body not seen')}</div></div><div class="go">▶︎</div></div>`).join('');
}

function renderGoal(list) {
  const g = GOALS[S.goal] || null;
  const opts = Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${S.goal === k ? 'selected' : ''}>${v.name}${v.view === 'dtl' ? ' (behind view)' : v.view === 'face' ? '' : ''}</option>`).join('');
  if (!g) return `<div class="summary goal"><b>🎯 Training goal</b> — pick one thing to work on and the app charts your progress on every swing.<br><select id="goalSel"><option value="">Choose a goal…</option>${opts}</select></div>`;
  const pts = list.filter((r) => r.ok && (g.both || r.view === g.view)).map((r) => ({ r, v: g.get(r) })).filter((p) => p.v != null && isFinite(p.v)).reverse();
  const inRange = pts.filter((p) => p.v >= g.band[0] && p.v <= g.band[1]).length;
  const sessions = new Set(pts.map((p) => p.r.session)).size;
  const last5 = pts.slice(-5), prev5 = pts.slice(-10, -5);
  const pct = (a) => (a.length ? Math.round((a.filter((p) => p.v >= g.band[0] && p.v <= g.band[1]).length / a.length) * 100) : null);
  const trend = pct(last5) != null && pct(prev5) != null ? (pct(last5) > pct(prev5) ? '📈 improving' : pct(last5) < pct(prev5) ? '📉 slipping' : '➡︎ steady') : '';
  return `<div class="summary goal"><b>🎯 ${g.name}</b> <span class="sub">target ${g.band[0]}–${g.band[1]}${g.unit}</span><br>
    <canvas id="goalChart" height="140"></canvas>
    ${pts.length ? `<div class="goalstats"><span><b>${pts.length}</b> swings</span><span><b>${sessions}</b> session${sessions === 1 ? '' : 's'}</span><span><b>${Math.round((inRange / pts.length) * 100)}%</b> on target</span><span>${trend}</span></div>` : '<div class="sub">No swings with this measurement yet.</div>'}
    <select id="goalSel">${opts}<option value="">No goal</option></select></div>`;
}
function drawGoalChart(list) {
  const c = $('#goalChart'); const g = GOALS[S.goal];
  if (!c || !g) return;
  const pts = list.filter((r) => r.ok && (g.both || r.view === g.view)).map((r) => g.get(r)).filter((v) => v != null && isFinite(v)).reverse().slice(-30);
  drawSeries(c, pts, g.band, g.unit, g.dp || 0);
}
// a line of values with a green target band; dots green when on target
function drawSeries(c, pts, band, unit = '', dp = 0) {
  const W = c.clientWidth || 600, H = c.clientHeight || 140, dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = (band[1] - band[0]) * 0.25 || 2;
  const lo = Math.min(band[0], ...pts) - pad, hi = Math.max(band[1], ...pts) + pad;
  const Y = (v) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 24), X = (i) => 30 + (i / Math.max(1, pts.length - 1)) * (W - 44);
  ctx.fillStyle = 'rgba(63,230,255,0.18)'; ctx.fillRect(30, Y(band[1]), W - 44, Y(band[0]) - Y(band[1]));
  ctx.fillStyle = '#9db8a6'; ctx.font = '11px system-ui';
  ctx.fillText(String(band[1]), 2, Y(band[1]) + 4); ctx.fillText(String(band[0]), 2, Y(band[0]) + 4);
  if (!pts.length) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  pts.forEach((v, i) => { const ok = v >= band[0] && v <= band[1]; ctx.fillStyle = ok ? '#3fe6ff' : '#ff7a1a'; ctx.beginPath(); ctx.arc(X(i), Y(v), 3.5, 0, Math.PI * 2); ctx.fill(); });
  const lastV = pts[pts.length - 1];
  ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui'; ctx.fillText(lastV.toFixed(dp) + unit, Math.min(W - 50, X(pts.length - 1) - 10), Y(lastV) - 8);
}
$('#swList').addEventListener('click', (e) => { const row = e.target.closest('[data-sw]'); if (row) openPlayer(+row.dataset.sw); });
$('#swingsBtn').addEventListener('click', () => openSwings());
$('#swBack').addEventListener('click', () => openSwings());
$('#seqBack').addEventListener('click', () => { $('#swSeq').hidden = true; $('#swPlayer').hidden = false; });

// ---- player state
const P = { rec: null, bmps: [], cmp: null, cbmps: [], t: 0, playing: true, speed: 0.5, skel: true, angles: true, raf: 0, last: 0, hold: 0, auto: false, tool: null, pts: [], openedAt: 0, closeTimer: 0 };
function stopPlayer() {
  cancelAnimationFrame(P.raf); P.raf = 0;
  for (const b of [...P.bmps, ...P.cbmps]) { try { b && b.close(); } catch { /* ignore */ } }
  P.bmps = []; P.cbmps = []; P.rec = null; P.cmp = null; P.ideal = null; P.tool = null; P.pts = [];
}
async function loadBitmaps(r) { return Promise.all(r.frames.map((f) => createImageBitmap(f.jpg).catch(() => null))); }

async function openPlayer(id) {
  const auto = P.auto;
  stopPlayer(); P.auto = auto;
  $('#swList').hidden = true; $('#swSeq').hidden = true; $('#swImport').hidden = true; $('#swAddRow').hidden = true; $('#swPlayer').hidden = false;
  const r = await getSwing(id);
  if (!r) { $('#swTitle').textContent = 'That swing is no longer saved.'; return; }
  P.rec = r; P.t = r.frames[0].t; P.playing = true; P.last = performance.now(); P.hold = 0;
  P.bmps = await loadBitmaps(r);
  $('#swHead').textContent = swingTitle(r);
  updatePlayerText();
  const ph = r.phases || {};
  $('#swPhases').innerHTML = POS.filter(([k]) => ph[k] != null || k === 'imp').map(([k, n]) => `<button class="btn" data-t="${ph[k] != null ? ph[k] : 0}">${n}</button>`).join('');
  $('#swPlay').textContent = '❚❚ Pause';
  $('#swBest').textContent = r.best ? '⭐ Best swing' : '☆ Mark as best';
  setTool(null);
  sizePlayerCanvas();
  P.raf = requestAnimationFrame(playerLoop);
}
function updatePlayerText() {
  const r = P.rec;
  $('#swTitle').innerHTML = `${fmtWhen(r.ts)}${r.speed != null ? ` · ball speed ${(r.speed / MPH).toFixed(0)} mph · launch ${r.launch.toFixed(0)}°` : ''}${r.view === 'dtl' ? ' · filmed from behind' : ''}` +
    (r.ok ? ` · <b style="color:${scoreColour(r.score)}">Score ${r.score.toFixed(1)}/10</b>${r.metrics.tempo ? ` · tempo ${r.metrics.tempo.toFixed(1)}:1` : ''}` : ` · swing not checked: ${NOTES[r.reason] || 'body not seen'}`) +
    (P.cmp ? `<br><span style="color:#ff7a1a">Right: ${swingTitle(P.cmp)} · ${fmtWhen(P.cmp.ts)}${P.cmp.ok ? ` · score ${P.cmp.score.toFixed(1)}` : ''}</span>` : '');
  $('#swTips2').innerHTML = r.ok ? ((r.tips.length ? r.tips.map((t) => `<div class="tip">${t.text}${IDEAL[t.key] && r.view !== 'dtl' ? ` <button class="btn showme${P.ideal === t.key ? ' on' : ''}" data-ideal="${t.key}">${P.ideal === t.key ? '✕ Hide model' : '👤 Show me'}</button>` : ''}${t.drill ? `<div class="drill">🏌️ ${t.drill}</div>` : ''}</div>`).join('') : '<div class="tip good">No clear faults on this swing.</div>') + (r.good || []).map((g) => `<div class="tip good">✓ ${g}</div>`).join('')) : '';
  $('#swMetrics2').textContent = metricsText(r);
}
function metricsText(r) {
  const m = r.metrics, R = (v, dp = 0) => (v == null ? '—' : v.toFixed(dp));
  if (!m) return 'No measurements — the body wasn’t seen clearly in this swing.';
  const common = [
    `Swing score                  ${R(r.score, 1)} / 10`,
    `Tempo (back : down)          ${m.tempo ? `${R(m.tempo, 1)} : 1  (${R(m.backswingS, 2)} s back, ${R(m.downswingS, 2)} s down; good players ≈ 3 : 1)` : '—'}`,
  ];
  const lines = r.view === 'dtl' ? [
    `Forward bend at address      ${R(m.spineAngle)}°  (good: 30–45°)`,
    `Knee flex at address         ${R(m.kneeFlex)}°  (good: 15–25°)`,
    `Hands vs shoulders           ${R(m.armHangCm)} cm  (+ = out beyond the shoulders)`,
    `Hips toward the ball         ${R(m.earlyExtCm)} cm by impact  (more than 6 = early extension)`,
    `Standing up by impact        ${R(m.postureLoss)}°`,
    `Head height change           ${R(m.headDropCm)} cm by impact  (+ = dropped)`,
  ] : [
    `Stance (centre of ankles)    ${R(m.stanceCm)} cm  (${R(m.stanceRatio, 2)} × shoulder width)`,
    `Ball position                ${R(m.ballPos * 100)}%  (0% back foot, 100% front foot)`,
    `Spine tilt at address        ${R(m.tilt)}°  (+ = away from target)`,
    `Hands vs ball at address     ${R(m.handsAheadCm)} cm  (+ = ahead)`,
    `Head move on backswing       ${R(m.headTopCm)} cm  (− = away from target)`,
    `Hip move on backswing        ${R(m.hipTopCm)} cm`,
    `Hips at impact               ${R(m.hipImpCm)} cm  (+ = towards target)`,
    `Head at impact               ${R(m.headImpCm)} cm`,
    `Hips at finish vs front foot ${R(m.finishHipCm)} cm`,
  ];
  return [...common, ...lines, `Scale from ${r.scaleFrom === 'ball' ? 'the ball — add your height in Settings for better accuracy' : 'your height'}`].join('\n');
}
function sizePlayerCanvas() {
  const r = P.rec; if (!r) return;
  const c = $('#swCanvas');
  const two = P.cmp || P.ideal;
  c.width = r.w + (two ? 6 + (P.cmp ? Math.round((P.cmp.w * r.h) / P.cmp.h) : r.w) : 0); c.height = r.h;
}

function frameIdx(rec, t) { const fr = rec.frames; let i = 0; while (i + 1 < fr.length && fr[i + 1].t <= t + 1e-6) i++; return i; }
function lmAt(rec, t) { const f = rec.frames[frameIdx(rec, t)]; return f && f.lm ? f.lm : null; }

// ---- drawing one swing into the canvas at (x0, 0)
function drawSwingPanel(ctx, rec, bmps, t, x0, opts = {}) {
  const i = frameIdx(rec, t), f = rec.frames[i], b = bmps[i];
  ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, rec.w, rec.h); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(x0, 0, rec.w, rec.h);
  if (b) ctx.drawImage(b, x0, 0, rec.w, rec.h);
  if (rec.addrLm && rec.view !== 'dtl') {
    const A = rec.addrLm; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,211,77,0.85)'; ctx.beginPath(); ctx.moveTo(x0 + A[0][0], 0); ctx.lineTo(x0 + A[0][0], rec.h); ctx.stroke();
    const hx = (A[23][0] + A[24][0]) / 2; ctx.strokeStyle = 'rgba(63,230,255,0.75)'; ctx.beginPath(); ctx.moveTo(x0 + hx, 0); ctx.lineTo(x0 + hx, rec.h); ctx.stroke(); ctx.setLineDash([]);
  }
  if (rec.addrLm && rec.view === 'dtl') { // behind view: backside line and head height at address
    const A = rec.addrLm, s = rec.s || 1;
    const back = Math.min(A[23][0], A[24][0]) * (s > 0 ? 1 : 0) + Math.max(A[23][0], A[24][0]) * (s > 0 ? 0 : 1);
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(63,230,255,0.75)'; ctx.beginPath(); ctx.moveTo(x0 + back - s * 8, 0); ctx.lineTo(x0 + back - s * 8, rec.h); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,211,77,0.85)'; ctx.beginPath(); ctx.moveTo(x0, A[0][1]); ctx.lineTo(x0 + rec.w, A[0][1]); ctx.stroke(); ctx.setLineDash([]);
  }
  const L = f.lm;
  if (P.skel && L) {
    ctx.strokeStyle = opts.colour || '#3fe6ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [a, bb] of BONES) { const p = L[a], q = L[bb]; if (!p || !q || p[2] < 0.3 || q[2] < 0.3) continue; ctx.beginPath(); ctx.moveTo(x0 + p[0], p[1]); ctx.lineTo(x0 + q[0], q[1]); ctx.stroke(); }
    const n = L[0]; if (n && n[2] > 0.3) { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(x0 + n[0], n[1], 5, 0, Math.PI * 2); ctx.fill(); }
  }
  if (P.angles && L) drawAngles(ctx, rec, L, x0);
  // label
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x0, 0, 190, 22);
  const ph = rec.phases || {};
  const near = opts.name ? null : POS.find(([k]) => ph[k] != null && Math.abs(ph[k] - f.t) < 0.03) || (Math.abs(f.t) < 0.03 ? ['imp', 'Impact'] : null);
  ctx.fillStyle = '#fff'; ctx.font = '600 13px system-ui';
  ctx.fillText(`${f.t >= 0 ? '+' : ''}${f.t.toFixed(2)} s${near ? ' · ' + near[1] : ''}`, x0 + 6, 15);
  ctx.restore();
}

// joint angles drawn on the body
function drawAngles(ctx, rec, L, x0) {
  const pt = (i) => ({ x: x0 + L[i][0], y: L[i][1], v: L[i][2] });
  const arc = (a, b, c, label, colour) => {
    if (a.v < 0.4 || b.v < 0.4 || c.v < 0.4) return;
    const a1 = Math.atan2(a.y - b.y, a.x - b.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ctx.strokeStyle = colour; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 14, a1, a1 + d, d < 0); ctx.stroke();
    const mid = a1 + d / 2;
    const tx = b.x + Math.cos(mid) * 26, ty = b.y + Math.sin(mid) * 26;
    ctx.font = '700 12px system-ui'; const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(tx - w / 2, ty - 9, w, 17);
    ctx.fillStyle = colour; ctx.fillText(label, tx - w / 2 + 4, ty + 4);
  };
  const ang = (a, b, c) => Math.round(angleAt(a, b, c));
  // knees (hip-knee-ankle) and lead elbow
  for (const [h, k, a] of [[23, 25, 27], [24, 26, 28]]) { const A = pt(h), K = pt(k), An = pt(a); arc(A, K, An, `${ang(A, K, An)}°`, '#ffb44d'); }
  const s = rec.s || 1;
  const leadArm = rec.view === 'dtl' ? [11, 13, 15] : (s > 0 ? [11, 13, 15] : [12, 14, 16]);
  { const a = pt(leadArm[0]), b = pt(leadArm[1]), c = pt(leadArm[2]); arc(a, b, c, `${ang(a, b, c)}°`, '#ffffff'); }
  // spine line: mid-hips to mid-shoulders, angle from vertical
  const hm = { x: (pt(23).x + pt(24).x) / 2, y: (pt(23).y + pt(24).y) / 2 }, sm = { x: (pt(11).x + pt(12).x) / 2, y: (pt(11).y + pt(12).y) / 2 };
  if (pt(23).v > 0.4 && pt(11).v > 0.4) {
    const deg = Math.round((Math.atan2(Math.abs(sm.x - hm.x), hm.y - sm.y) * 180) / Math.PI);
    ctx.strokeStyle = '#ff7ad9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hm.x, hm.y); ctx.lineTo(sm.x, sm.y); ctx.stroke();
    ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(hm.x, hm.y); ctx.lineTo(hm.x, hm.y - 70); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '700 12px system-ui'; const lbl = `spine ${deg}°`, w = ctx.measureText(lbl).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(hm.x + 8, hm.y - 46, w, 17); ctx.fillStyle = '#ff7ad9'; ctx.fillText(lbl, hm.x + 12, hm.y - 33);
  }
}

function drawPlayer() {
  const r = P.rec; if (!r) return;
  const c = $('#swCanvas'), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  drawSwingPanel(ctx, r, P.bmps, P.t, 0);
  if (P.cmp) { // the other swing, scaled to the same height (it may be an upright video)
    const k = r.h / P.cmp.h; ctx.save(); ctx.translate(r.w + 6, 0); ctx.scale(k, k);
    drawSwingPanel(ctx, P.cmp, P.cbmps, Math.max(P.cmp.frames[0].t, Math.min(P.cmp.frames[P.cmp.frames.length - 1].t, P.t)), 0, { colour: '#ff7a1a' }); ctx.restore();
  }
  if (P.ideal && !P.cmp) drawIdealPanel(ctx, r, r.w + 6);
  // user drawings (stored in the left panel's pixels)
  drawUserMarks(ctx);
  const span = r.frames[r.frames.length - 1].t - r.frames[0].t || 1;
  $('#swSlider').value = Math.round(((P.t - r.frames[0].t) / span) * 1000);
}
function drawUserMarks(ctx) {
  const marks = [...(P.rec.drawings || []), ...(P.pts.length ? [{ type: P.tool, pts: P.pts, live: true }] : [])];
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const m of marks) {
    ctx.strokeStyle = m.live ? 'rgba(255,255,0,0.8)' : '#ffff00'; ctx.fillStyle = '#ffff00';
    const p = m.pts;
    for (const q of p) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); }
    if (p.length >= 2) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (const q of p.slice(1)) ctx.lineTo(q.x, q.y); ctx.stroke(); }
    if (m.type === 'line' && p.length === 2) {
      const deg = Math.round((Math.atan2(-(p[1].y - p[0].y), p[1].x - p[0].x) * 180) / Math.PI);
      label(ctx, `${Math.abs(deg) > 90 ? 180 - Math.abs(deg) : Math.abs(deg)}°`, (p[0].x + p[1].x) / 2 + 8, (p[0].y + p[1].y) / 2);
    }
    if (m.type === 'angle' && p.length === 3) label(ctx, `${Math.round(angleAt(p[0], p[1], p[2]))}°`, p[1].x + 10, p[1].y - 10);
  }
}
function label(ctx, txt, x, y) { ctx.font = '700 14px system-ui'; const w = ctx.measureText(txt).width + 10; ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x, y - 13, w, 19); ctx.fillStyle = '#ffff00'; ctx.fillText(txt, x + 5, y + 2); }

function playerLoop(now) {
  const r = P.rec; if (!r) return;
  const dt = Math.min(0.1, (now - P.last) / 1000); P.last = now;
  if (P.playing) {
    if (P.hold > 0) P.hold -= dt;
    else {
      P.t += dt * P.speed;
      const end = r.frames[r.frames.length - 1].t;
      if (P.t > end) { if (P.onEnd) { const f = P.onEnd; P.onEnd = null; P.t = end; pausePlayer(); f(); } else { P.t = r.frames[0].t; P.hold = 0.8; } }
    }
  }
  drawPlayer();
  P.raf = requestAnimationFrame(playerLoop);
}
const pausePlayer = () => { P.playing = false; $('#swPlay').textContent = '▶︎ Play'; };
$('#swPlay').addEventListener('click', () => { P.playing = !P.playing; $('#swPlay').textContent = P.playing ? '❚❚ Pause' : '▶︎ Play'; });
const stepFrame = (d) => { if (!P.rec) return; pausePlayer(); const i = Math.max(0, Math.min(P.rec.frames.length - 1, frameIdx(P.rec, P.t) + d)); P.t = P.rec.frames[i].t; };
$('#swPrev').addEventListener('click', () => stepFrame(-1));
$('#swNext').addEventListener('click', () => stepFrame(1));
$('#swSpeed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; P.speed = +b.dataset.v; $$('#swSpeed button').forEach((x) => x.classList.toggle('on', x === b)); });
$('#swSkel').addEventListener('click', () => { P.skel = !P.skel; $('#swSkel').classList.toggle('on', P.skel); });
$('#swAngles').addEventListener('click', () => { P.angles = !P.angles; $('#swAngles').classList.toggle('on', P.angles); });
$('#swSlider').addEventListener('input', (e) => { if (!P.rec) return; pausePlayer(); const r = P.rec, span = r.frames[r.frames.length - 1].t - r.frames[0].t; P.t = r.frames[0].t + (+e.target.value / 1000) * span; });
$('#swPhases').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; pausePlayer(); P.t = +b.dataset.t; });
$('#swDelete').addEventListener('click', async () => { if (!P.rec) return; const id = P.rec.id; await deleteSwing(id); log('swing deleted'); openSwings(); });
// once you touch the replay it stays open until you close it
$('#swPlayer').addEventListener('pointerdown', () => { P.auto = false; });
$('#swingsSheet').addEventListener('click', (e) => { if (e.target.id === 'swingsSheet' || e.target.hasAttribute('data-close')) stopPlayer(); });


// ---- "Show me": a model figure next to the player, standing the way the tip asks for.
// It is built from the player's own body in that picture, with only the faulty part moved.
const IDEAL = {
  'stance-wide': { ph: 'addr', what: 'Feet closer together' }, 'stance-narrow': { ph: 'addr', what: 'Feet wider apart' },
  'ball-back': { ph: 'addr', what: 'Ball further forward' }, 'ball-forward': { ph: 'addr', what: 'Ball further back' },
  'head-sway': { ph: 'top', what: 'Head stays over the ball' }, 'hip-sway': { ph: 'top', what: 'Hips stay centred — turn, don’t slide' },
  'hang-back': { ph: 'imp', what: 'Hips forward at impact' }, 'head-forward': { ph: 'imp', what: 'Head stays behind the ball' },
  'finish-back': { ph: 'fin', what: 'Weight on the front foot' },
};
function idealFigure(rec, key, L0) {
  const A = rec.addrLm, m = rec.metrics, s = rec.s || 1, g = clubGroup(rec.club);
  if (!A || !m || !L0) return null;
  const L = L0.map((p) => (p ? [p[0], p[1], p[2] ?? 1] : p));
  const moved = new Set(); let ball = null, note = '';
  const stancePx = Math.abs(A[27][0] - A[28][0]) || 1, pxPerCm = m.stanceCm ? stancePx / m.stanceCm : 1;
  const shift = (ids, dx, mark = true) => { for (const i of ids) if (L[i]) { L[i][0] += dx; if (mark && Math.abs(dx) > 2) moved.add(i); } };
  const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ARMS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const midx = (a, b) => (L[a][0] + L[b][0]) / 2, cm = (px) => Math.round(Math.abs(px) / pxPerCm);
  if (key === 'stance-wide' || key === 'stance-narrow') {
    const want = ((g.stance[0] + g.stance[1]) / 2) * (stancePx / Math.max(0.1, m.stanceRatio)), d = (want - stancePx) / 2;
    const lead = (L[27][0] - L[28][0]) * s > 0 ? 27 : 28, trail = lead === 27 ? 28 : 27;
    for (const [an, dir] of [[lead, s], [trail, -s]]) { shift([an, an + 2, an + 4], dir * d); shift([an - 2], dir * d * 0.5, false); }
    note = `feet ${cm(want - stancePx)} cm ${want < stancePx ? 'closer' : 'wider'}`;
  } else if (key === 'ball-back' || key === 'ball-forward') {
    const lead = (A[27][0] - A[28][0]) * s > 0 ? A[27] : A[28], trail = lead === A[27] ? A[28] : A[27];
    const want = (g.ballPos[0] + g.ballPos[1]) / 2;
    ball = { x: trail[0] + (lead[0] - trail[0]) * want, y: rec.tee.y };
    note = `ball ${cm(ball.x - rec.tee.x)} cm ${key === 'ball-back' ? 'forward' : 'back'}`;
  } else if (key === 'head-sway' || key === 'head-forward') {
    const d = A[0][0] - L[0][0]; shift(HEAD, d); shift([11, 12], d * 0.6, false); shift(ARMS, d * 0.6, false); note = `head ${cm(d)} cm back over the ball`;
  } else if (key === 'hip-sway') {
    const d = (A[23][0] + A[24][0]) / 2 - midx(23, 24); shift([23, 24], d); shift([25, 26], d * 0.5, false); note = `hips ${cm(d)} cm back to centre`;
  } else if (key === 'hang-back') {
    const d = (A[23][0] + A[24][0]) / 2 + s * 8 * pxPerCm - midx(23, 24); shift([23, 24], d); shift([25, 26], d * 0.5, false); shift([11, 12], d * 0.3, false); note = `hips ${cm(d)} cm towards the target`;
  } else if (key === 'finish-back') {
    const front = (L[27][0] - L[28][0]) * s > 0 ? L[27][0] : L[28][0], d = front - s * 4 * pxPerCm - midx(23, 24);
    shift([23, 24], d); shift([11, 12], d * 0.9, false); shift(HEAD, d * 0.9, false); shift(ARMS, d * 0.9, false); note = `weight ${cm(d)} cm onto the front foot`;
  } else return null;
  return { L, moved, ball, note };
}
function drawIdealPanel(ctx, rec, x0) {
  const key = P.ideal, def = IDEAL[key]; if (!def) return;
  const you = lmAt(rec, P.t), fig = idealFigure(rec, key, you);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, rec.w, rec.h); ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, rec.h); bg.addColorStop(0, '#02121b'); bg.addColorStop(1, '#000307');
  ctx.fillStyle = bg; ctx.fillRect(x0, 0, rec.w, rec.h);
  ctx.strokeStyle = 'rgba(63,230,255,0.10)'; ctx.lineWidth = 1;
  for (let x = 0; x < rec.w; x += 24) { ctx.beginPath(); ctx.moveTo(x0 + x, 0); ctx.lineTo(x0 + x, rec.h); ctx.stroke(); }
  for (let y = 0; y < rec.h; y += 24) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + rec.w, y); ctx.stroke(); }
  ctx.font = "700 13px 'Rajdhani', sans-serif"; ctx.textAlign = 'left';
  if (!fig) { ctx.fillStyle = '#7fa8b6'; ctx.fillText('Body not seen clearly in this picture', x0 + 10, 40); ctx.restore(); return; }
  const tw = Math.hypot((fig.L[11][0] + fig.L[12][0]) / 2 - (fig.L[23][0] + fig.L[24][0]) / 2, (fig.L[11][1] + fig.L[12][1]) / 2 - (fig.L[23][1] + fig.L[24][1]) / 2) || 60;
  const limb = (L, a, b, w, col) => { const p = L[a], q = L[b]; if (!p || !q) return; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0 + p[0], p[1]); ctx.lineTo(x0 + q[0], q[1]); ctx.stroke(); };
  // you, faint
  if (you) for (const [a, b] of BONES) limb(you, a, b, 2, 'rgba(127,168,182,0.45)');
  // the model: rounded limbs, the moved parts in orange
  const col = (a, b) => (fig.moved.has(a) || fig.moved.has(b) ? '#ff7a1a' : '#e8fbff');
  ctx.shadowColor = 'rgba(63,230,255,0.7)'; ctx.shadowBlur = 10;
  const torso = [[11, 12], [23, 24], [11, 23], [12, 24]];
  ctx.fillStyle = fig.moved.has(23) || fig.moved.has(11) ? 'rgba(255,122,26,0.35)' : 'rgba(232,251,255,0.28)';
  ctx.beginPath(); ctx.moveTo(x0 + fig.L[11][0], fig.L[11][1]); ctx.lineTo(x0 + fig.L[12][0], fig.L[12][1]); ctx.lineTo(x0 + fig.L[24][0], fig.L[24][1]); ctx.lineTo(x0 + fig.L[23][0], fig.L[23][1]); ctx.closePath(); ctx.fill();
  for (const [a, b] of torso) limb(fig.L, a, b, tw * 0.10, col(a, b));
  for (const [a, b] of [[11, 13], [13, 15], [12, 14], [14, 16]]) limb(fig.L, a, b, tw * 0.13, col(a, b));
  for (const [a, b] of [[23, 25], [25, 27], [24, 26], [26, 28]]) limb(fig.L, a, b, tw * 0.17, col(a, b));
  for (const [a, b] of [[27, 31], [28, 32]]) limb(fig.L, a, b, tw * 0.12, col(a, b));
  const hd = fig.L[0], hr = tw * 0.2; ctx.fillStyle = fig.moved.has(0) ? '#ff7a1a' : '#e8fbff'; ctx.beginPath(); ctx.arc(x0 + hd[0], hd[1] - hr * 0.2, hr, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // ball: where it is, and where it should be
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + rec.tee.x, rec.tee.y, 4, 0, Math.PI * 2); ctx.fill();
  if (fig.ball) { ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x0 + fig.ball.x, fig.ball.y, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + rec.tee.x, rec.tee.y - 12); ctx.lineTo(x0 + fig.ball.x, fig.ball.y - 12); ctx.stroke(); }
  // arrow from where you are to where the model is, for the first moved part
  const k = [0, 23, 27, 28].find((i) => fig.moved.has(i));
  if (k != null && you && you[k]) { const a = you[k], b = fig.L[k], dir = Math.sign(b[0] - a[0]) || 1, y = a[1] - (k === 0 ? tw * 0.45 : 0);
    ctx.strokeStyle = '#ff7a1a'; ctx.fillStyle = '#ff7a1a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x0 + a[0], y); ctx.lineTo(x0 + b[0], y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + b[0] + dir * 7, y); ctx.lineTo(x0 + b[0] - dir * 3, y - 6); ctx.lineTo(x0 + b[0] - dir * 3, y + 6); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x0, 0, rec.w, 22); ctx.fillStyle = '#ff7a1a'; ctx.fillText(`MODEL · ${def.what}${fig.note ? ' — ' + fig.note : ''}`, x0 + 6, 15);
  ctx.fillStyle = 'rgba(127,168,182,0.9)'; ctx.fillText('grey = you · white = model · orange = what to change', x0 + 6, rec.h - 8);
  ctx.restore();
}
$('#swTips2').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ideal]'); if (!b || !P.rec) return;
  const key = b.dataset.ideal;
  if (P.ideal === key) { P.ideal = null; }
  else {
    P.ideal = key;
    if (P.cmp) { for (const x of P.cbmps) { try { x && x.close(); } catch { /* */ } } P.cmp = null; P.cbmps = []; $('#swCompare').textContent = '⚖︎ Compare'; }
    const t = P.rec.phases && P.rec.phases[IDEAL[key].ph]; pausePlayer(); P.t = t != null ? t : 0;
    $('#swCanvas').scrollIntoView({ block: 'nearest' });
  }
  sizePlayerCanvas(); updatePlayerText();
});

// ---- export the replay as a video file (slow motion, with the outline and angles as shown)
$('#swVideo').addEventListener('click', async () => {
  const r = P.rec, c = $('#swCanvas'); if (!r || P.onEnd) return;
  const mime = window.MediaRecorder && ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!c.captureStream || !mime) { toast('This browser can’t make a video file. Use the iPhone’s screen recording instead: swipe down from the top-right corner, tap the ⏺ button, then play the swing.', 9000); return; }
  setTool(null);
  const stream = c.captureStream(30), chunks = [];
  let mr;
  try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 }); } catch (e) { toast('Couldn’t start the video recorder: ' + (e.message || e)); return; }
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { mr.onstop = res; });
  $('#swVideo').textContent = '⏺ Making video…';
  P.t = r.frames[0].t; P.hold = 0.4; P.playing = true; $('#swPlay').textContent = '❚❚ Pause';
  mr.start(250);
  await new Promise((res) => { P.onEnd = res; });
  await sleep(500); // hold the last picture for a moment
  mr.stop(); await done; stream.getTracks().forEach((t) => t.stop());
  $('#swVideo').textContent = '🎬 Video';
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (blob.size < 2000) { log(`video export failed: ${blob.size} bytes (${mime})`); toast('The video came out empty. Use the iPhone’s screen recording instead (Control Centre › ⏺).', 8000); return; }
  log(`video export: ${(blob.size / 1e6).toFixed(1)} MB ${mime}`);
  P.seqFile = new File([blob], `swing-${clubById(r.club).id}-${new Date(r.ts).toISOString().slice(0, 10)}.${ext}`, { type: blob.type });
  $('#seqImg').hidden = true; const v = $('#seqVid'); v.hidden = false; v.src = URL.createObjectURL(blob);
  $('#seqNote').textContent = 'Your swing in slow motion. Tap Share / Save to send it to your coach (WhatsApp, Messages, email) or save it to Photos.';
  $('#swPlayer').hidden = true; $('#swSeq').hidden = false;
});

// ---- add a video of another player (filmed now, or picked from Photos) to watch and compare
$('#swAdd').addEventListener('click', () => { $('#swFile').value = ''; $('#swFile').click(); });
$('#swFile').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const v = $('#impVid'); v.src = URL.createObjectURL(f); v.load();
  $('#impName').value = ''; $('#impMsg').textContent = '';
  $('#swList').hidden = true; $('#swPlayer').hidden = true; $('#swSeq').hidden = true; $('#swImport').hidden = false; $('#swHead').textContent = 'Add a video';
  log(`video picked to add: ${(f.size / 1e6).toFixed(1)} MB ${f.type}`);
});
$('#impCancel').addEventListener('click', () => { $('#impVid').pause(); $('#swImport').hidden = true; openSwings(); });
$('#impSave').addEventListener('click', async () => {
  const v = $('#impVid'), msg = $('#impMsg');
  if (!v.videoWidth) { msg.textContent = 'The video hasn’t loaded yet — wait a moment and try again.'; return; }
  v.pause();
  const tImp = v.currentTime, name = ($('#impName').value || 'Other player').trim().slice(0, 30);
  const W = v.videoWidth >= v.videoHeight ? 480 : 300, H = Math.round((v.videoHeight * W) / v.videoWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  const seek = (t) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 1500); });
  const t0 = Math.max(0, tImp - 2.3), t1 = Math.min(v.duration || tImp, tImp + 1.05), pics = [], out = [];
  $('#impSave').disabled = true;
  try {
    for (let t = t0; t <= t1; t += 0.05) {
      msg.textContent = `Reading the video… ${Math.round(((t - t0) / (t1 - t0 || 1)) * 100)}%`;
      await seek(t); ctx.drawImage(v, 0, 0, W, H);
      pics.push({ t, bmp: await createImageBitmap(c) });
      out.push({ t: +(t - tImp).toFixed(3), jpg: await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7)), lm: null });
    }
    if (out.length < 5) { msg.textContent = 'Couldn’t read that video. Try a different one.'; return; }
    msg.textContent = 'Finding the body outline…';
    try {
      swingChecking = true;
      const { frames } = await swingCap.analyse(pics, W, H);
      for (const f of frames) { const o = out[pics.findIndex((p) => p.t === f.t)]; if (o && f.lm) o.lm = f.lm.map((q) => [Math.round(q.x), Math.round(q.y), +q.v.toFixed(2)]); }
    } catch (err) { log(`added video: no body outline (${err.message || err})`); } finally { swingChecking = false; }
    for (const p of pics) { try { p.bmp.close(); } catch { /* */ } }
    const id = Date.now();
    await saveSwing({ id, ts: id, session, club: S.club, name, imported: true, swingOnly: true, carry: null, total: null, speed: null, launch: null,
      view: 'face', ok: false, reason: 'imported', score: null, tips: [], good: [], metrics: null, phases: null, addrLm: null, s: 1,
      tee: { x: -99, y: -99 }, w: W, h: H, frames: out, best: false, drawings: [] });
    log(`added video saved as "${name}" (${out.length} pictures, ${W}×${H}, outline in ${out.filter((o) => o.lm).length})`);
    $('#swImport').hidden = true; openSwings(id);
    toast('Saved. Open one of your own swings and tap ⚖︎ Compare to put it side by side.', 6000);
  } catch (err) { log(`ERROR adding video: ${err.message || err}`); msg.textContent = 'Something went wrong reading that video: ' + (err.message || err); }
  finally { $('#impSave').disabled = false; }
});

// ---- best swing
$('#swBest').addEventListener('click', async () => {
  if (!P.rec) return;
  P.rec.best = !P.rec.best;
  await saveSwing(P.rec);
  $('#swBest').textContent = P.rec.best ? '⭐ Best swing' : '☆ Mark as best';
  toast(P.rec.best ? 'Marked as a best swing — use Compare to put any swing next to it' : 'No longer marked as best');
});

// ---- drawing tools
function setTool(t) {
  P.tool = t; P.pts = [];
  $('#swLine').classList.toggle('on', t === 'line'); $('#swAngle').classList.toggle('on', t === 'angle');
  $('#swCanvas').style.cursor = t ? 'crosshair' : 'default';
  if (t) { pausePlayer(); toast(t === 'line' ? 'Tap two points to draw a line (it shows its angle)' : 'Tap three points: end, corner, end — it shows the angle', 3500); }
}
$('#swLine').addEventListener('click', () => setTool(P.tool === 'line' ? null : 'line'));
$('#swAngle').addEventListener('click', () => setTool(P.tool === 'angle' ? null : 'angle'));
$('#swClear').addEventListener('click', async () => { if (!P.rec) return; P.rec.drawings = []; P.pts = []; await saveSwing(P.rec); });
$('#swCanvas').addEventListener('click', async (e) => {
  if (!P.tool || !P.rec) return;
  const c = $('#swCanvas'), r = c.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * c.width, y = ((e.clientY - r.top) / r.height) * c.height;
  P.pts.push({ x, y });
  const need = P.tool === 'line' ? 2 : 3;
  if (P.pts.length >= need) {
    P.rec.drawings = [...(P.rec.drawings || []), { type: P.tool, pts: P.pts }];
    P.pts = [];
    try { await saveSwing(P.rec); } catch { /* keep in memory */ }
  }
});

// ---- compare two swings side by side (lined up at impact)
$('#swCompare').addEventListener('click', async () => {
  if (!P.rec) return;
  if (P.cmp) { for (const b of P.cbmps) { try { b && b.close(); } catch { /* */ } } P.cmp = null; P.cbmps = []; sizePlayerCanvas(); updatePlayerText(); $('#swCompare').textContent = '⚖︎ Compare'; return; }
  const list = (await listSwings()).filter((r) => r.id !== P.rec.id && r.nFrames);
  if (!list.length) { toast('Hit another shot first — then you can compare two swings'); return; }
  const sorted = [...list.filter((r) => r.best), ...list.filter((r) => !r.best)];
  $('#cmpList').innerHTML = sorted.slice(0, 25).map((r) => `<div class="row-sw" data-cmp="${r.id}"><div><b>${r.best ? '⭐ ' : ''}${swingTitle(r)}</b> <span class="sub">· ${fmtWhen(r.ts)}</span><div class="tip">${r.ok ? `Score ${(r.score ?? 0).toFixed(1)}` : 'not checked'}</div></div><div class="go">⚖︎</div></div>`).join('');
  $('#cmpPick').hidden = false;
});
$('#cmpList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-cmp]'); if (!row) return;
  $('#cmpPick').hidden = true;
  const other = await getSwing(+row.dataset.cmp); if (!other) return;
  P.cmp = other; P.ideal = null; P.cbmps = await loadBitmaps(other);
  sizePlayerCanvas(); updatePlayerText(); $('#swCompare').textContent = '✕ End compare';
  P.t = Math.max(P.rec.frames[0].t, other.frames[0].t); P.playing = true; $('#swPlay').textContent = '❚❚ Pause';
});
$('#cmpCancel').addEventListener('click', () => { $('#cmpPick').hidden = true; });

// ---- swing sequence (8 positions), shareable picture
$('#swSeqBtn').addEventListener('click', async () => {
  const r = P.rec; if (!r) return;
  pausePlayer();
  const ph = r.phases || {};
  const keys = POS.filter(([k]) => ph[k] != null || k === 'imp').map(([k, n]) => [n, ph[k] != null ? ph[k] : 0]);
  const cols = 4, rows = Math.ceil(keys.length / cols), tw = r.w, th = r.h;
  const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * th + 40;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#0d1a12'; ctx.fillRect(0, 0, c.width, c.height);
  keys.forEach(([name, t], i) => {
    const x0 = (i % cols) * tw, y0 = Math.floor(i / cols) * th;
    ctx.save(); ctx.translate(0, y0); drawSwingPanel(ctx, r, P.bmps, t, x0, { name }); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x0, y0 + th - 26, tw, 26);
    ctx.fillStyle = '#fff'; ctx.font = '700 16px system-ui'; ctx.fillText(name, x0 + 8, y0 + th - 8);
  });
  ctx.fillStyle = '#fff'; ctx.font = '600 18px system-ui';
  ctx.fillText(`Golf Sim · ${swingTitle(r)} · ${fmtWhen(r.ts)}${r.ok ? ` · score ${r.score.toFixed(1)}/10${r.metrics.tempo ? ` · tempo ${r.metrics.tempo.toFixed(1)}:1` : ''}` : ''}`, 10, rows * th + 27);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  P.seqFile = new File([blob], `swing-sequence-${r.id}.jpg`, { type: 'image/jpeg' });
  $('#seqVid').hidden = true; $('#seqImg').hidden = false; $('#seqNote').textContent = 'Your swing in 8 positions. Share it to WhatsApp or your coach, or press and hold the picture to save it to Photos.';
  $('#seqImg').src = URL.createObjectURL(blob);
  $('#swPlayer').hidden = true; $('#swSeq').hidden = false;
});
$('#seqShare').addEventListener('click', async () => {
  if (!P.seqFile) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [P.seqFile] })) { await navigator.share({ files: [P.seqFile], title: 'My swing' }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(P.seqFile); a.download = P.seqFile.name; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { if (e.name !== 'AbortError') toast('Press and hold the picture and choose Save to Photos'); }
});

// ------------------------------------------------------------ help me fix it
const MONO = '13px ui-monospace, Menlo, monospace';
function grayToCanvas(fr, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < fr.length; i += 4, j++) { const v = fr[j]; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}
function canvasBlob(c) { return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.85)); }

function reportText(d) {
  const L = [];
  const st = d || eng;
  L.push(`GOLF SIM REPORT · ${new Date().toLocaleString()}`);
  L.push(`version ${VERSION} · capture ${mode || 'not started'} · camera ${running ? 'on' : 'off'}`);
  L.push(`video ${video.videoWidth}×${video.videoHeight} · analysed ${st.w || 0}×${st.h || 0} · ${(st.fps || 0).toFixed(1)} fps · ${(st.procMs || 0).toFixed(1)} ms/frame · frames ${st.frames || 0}`);
  L.push(`picture freezes ${freezeCount} · repeated frames skipped ${staleCount} · detector restarts ${workerRestarts}`);
  L.push(`state ${st.state || 'idle'} · ball ${st.ball ? `${st.ball.x.toFixed(0)},${st.ball.y.toFixed(0)} ${st.ball.d.toFixed(1)}px` : 'none'} · possible balls seen ${d && d.cands ? d.cands.length : '?'}`);
  L.push(`settings: club ${S.club} · ${S.dist}/${S.speed} · alt ${S.altitude} m · ${S.tempC}°C · fov ${S.hfov}° · width ${S.procW} · sensitivity ${S.threshold} · auto-find ${S.autoFind} · speed adj ${S.speedCal}% · aim ${S.aim}°`);
  L.push(`screen ${innerWidth}×${innerHeight} · ${screen.orientation ? screen.orientation.type : ''} · ${navigator.userAgent}`);
  const ss = sessionShots().slice(-8);
  if (ss.length) {
    L.push('last shots:');
    for (const s of ss) L.push(s.miss ? `  ${s.club} not read` : `  ${s.club}${s.demo ? ' (demo)' : ''} ${(s.speed).toFixed(1)} m/s ${s.launch.toFixed(1)}° dir ${s.dir.toFixed(1)}° → carry ${s.carry.toFixed(0)} m`);
  }
  if (lastSwing) L.push(lastSwing.ok ? `last swing: tips ${lastSwing.tips.map((t) => t.key).join(', ') || 'none'} · body seen in ${lastSwing.used} pictures · scale ${lastSwing.scaleFrom}` : `last swing: not analysed (${lastSwing.reason})`);
  L.push(`motion sensor ${motionOn ? `on · tilt from ready position ${tiltDeg.toFixed(1)}°` : 'off (tilt warnings from the camera only)'}`);
  L.push(`swing tips ${S.tips} · height ${S.heightCm || 'not set'} · hand ${S.hand} · phone ${S.view === 'dtl' ? `behind the ball, ${S.camH} m high` : 'at the side'} · ${S.face} camera · lens ${S.lens}`);
  if (eng.ball && eng.w) L.push(`ball ${eng.ball.d.toFixed(1)} px ≈ ${ballDistance(eng.ball).toFixed(1)} m away · ${Math.round((eng.ball.x / eng.w) * 100)}% across the picture${framingIssue ? ' · SET-UP PROBLEM: ' + framingIssue : ''}`);
  L.push('log (newest last):');
  for (const l of LOG.slice(-60)) L.push('  ' + l);
  return L.join('\n');
}

async function snapshotNow(d) {
  if (!running || !video.videoWidth) return null;
  const W = 1280, H = Math.round((video.videoHeight / video.videoWidth) * W);
  const c = document.createElement('canvas'); c.width = W; c.height = H + 120;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(video, 0, 0, W, H);
  const aw = (d && d.w) || eng.w;
  if (aw) {
    const k = W / aw;
    if (d && d.cands) { ctx.strokeStyle = '#6fc3ff'; ctx.lineWidth = 3; ctx.fillStyle = '#6fc3ff'; ctx.font = '16px system-ui'; for (const cd of d.cands) { ctx.beginPath(); ctx.arc(cd.x * k, cd.y * k, Math.max(10, cd.d * k), 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${cd.d.toFixed(0)}px c${cd.contrast.toFixed(0)}`, cd.x * k + 14, cd.y * k - 10); } }
    const b = (d && d.ball) || eng.ball;
    if (b) { ctx.strokeStyle = '#3fe6ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(b.x * k, b.y * k, Math.max(14, b.d * k * 1.4), 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = '#fff'; ctx.font = MONO.replace('13px', '18px');
  const lines = reportText(d).split('\n').slice(1, 5);
  lines.forEach((l, i) => ctx.fillText(l.slice(0, 120), 12, H + 28 + i * 24));
  return c;
}

function shotSheet() {
  const ev = lastCapture;
  if (!ev || !ev.frames || !ev.frames.length) return null;
  const fr = ev.frames;
  let start = 0;
  if (ev.track && ev.track.pts.length) {
    const i = fr.findIndex((f) => Math.abs(f.t - ev.track.pts[0].t) < 1e-6);
    start = Math.max(0, i - 3);
  } else start = Math.max(0, Math.floor(fr.length / 2) - 6);
  const pick = fr.slice(start, start + 12);
  const cols = 4, rows = Math.ceil(pick.length / cols);
  const tw = 480, th = Math.round((ev.h / ev.w) * tw);
  const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * th + 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  const k = tw / ev.w;
  pick.forEach((f, i) => {
    const x0 = (i % cols) * tw, y0 = Math.floor(i / cols) * th;
    ctx.drawImage(grayToCanvas(f.g, ev.w, ev.h), x0, y0, tw, th);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, tw, th); ctx.clip();
    ctx.strokeStyle = '#3fe6ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x0 + ev.tee.x * k, y0 + ev.tee.y * k, Math.max(6, ev.tee.d * k * 1.4), 0, Math.PI * 2); ctx.stroke();
    if (ev.track) for (const p of ev.track.pts) if (Math.abs(p.t - f.t) < 1e-6) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x0 + p.x * k, y0 + p.y * k, Math.max(7, p.d * k * 1.5), 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x0, y0, 150, 22);
    ctx.fillStyle = '#fff'; ctx.font = MONO; ctx.fillText(`#${start + i + 1} +${((f.t - fr[0].t) * 1000).toFixed(0)}ms`, x0 + 6, y0 + 16);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, tw - 1, th - 1);
  });
  ctx.fillStyle = '#fff'; ctx.font = MONO.replace('13px', '18px');
  const txt = ev.type === 'shot'
    ? `SHOT ${ev.launch.speed.toFixed(1)} m/s · ${ev.launch.launch.toFixed(1)}° · dir ${ev.launch.direction.toFixed(1)}° · seen in ${ev.launch.points} frames · ${(ev.fps || 0).toFixed(0)} fps`
    : 'MISSED — ball left the tee but was not found in flight';
  ctx.fillText(`${txt} · v${VERSION}`, 10, rows * th + 27);
  return c;
}

let diagFiles = [];
async function openDiag() {
  openSheet('#diagSheet');
  $('#dText').textContent = 'Gathering…';
  const d = running ? await workerDebug() : null;
  const txt = reportText(d);
  $('#dText').textContent = txt;
  diagFiles = [new File([txt], `golf-sim-report-${Date.now()}.txt`, { type: 'text/plain' })];
  const now = await snapshotNow(d);
  if (now) { const b = await canvasBlob(now); $('#dImgNow').src = URL.createObjectURL(b); $('#dImgNow').hidden = false; diagFiles.push(new File([b], 'golf-sim-camera.jpg', { type: 'image/jpeg' })); }
  else { $('#dImgNow').hidden = true; }
  const sh = shotSheet();
  if (sh) { const b = await canvasBlob(sh); $('#dImgShot').src = URL.createObjectURL(b); $('#dImgShot').hidden = false; diagFiles.push(new File([b], 'golf-sim-last-shot.jpg', { type: 'image/jpeg' })); $('#dShotNote').textContent = 'Green = where the ball sat. Yellow = ball found in flight.'; }
  else { $('#dImgShot').hidden = true; $('#dShotNote').textContent = 'No camera shot yet — hit one first and this fills in.'; }
  if (!running) $('#dImgNow').hidden = true;
  log('opened Help me fix it');
}
$('#diagBtn').addEventListener('click', openDiag);
$('#cDiag').addEventListener('click', () => { closeSetup(); openDiag(); });
$('#rDiag').addEventListener('click', () => { closeSheets(); openDiag(); });
$('#dCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#dText').textContent); toast('Report copied — paste it into Claude'); }
  catch { toast('Couldn’t copy — take a screenshot of this screen instead'); }
});
$('#dShareAll').addEventListener('click', async () => {
  if (!diagFiles.length) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: diagFiles })) { await navigator.share({ files: diagFiles, title: 'Golf Sim report' }); return; }
    if (navigator.share) { await navigator.share({ title: 'Golf Sim report', text: $('#dText').textContent }); return; }
    toast('Sharing isn’t available here — press and hold each picture to save it, and use Copy for the text');
  } catch (e) { if (e.name !== 'AbortError') toast('Share didn’t work — press and hold the pictures to save them'); }
});
$('#dClearLog').addEventListener('click', () => { LOG = []; store.set('log', LOG); log('log cleared'); $('#dText').textContent = reportText(null); });
function renderDebugChip() { const c = $('#cDebug'); c.textContent = `Show what it sees: ${S.debug === 'on' ? 'on' : 'off'}`; c.classList.toggle('on', S.debug === 'on'); }
$('#cDebug').addEventListener('click', () => { S.debug = S.debug === 'on' ? 'off' : 'on'; saveSettings(); renderDebugChip(); dbg = null; });
renderDebugChip();
function renderTeeChip() { const c = $('#cTee'); c.textContent = S.teeSpot ? '📍 Tee spot saved — tap to clear' : '📍 Tee spot: tap your ball to save it'; c.classList.toggle('on', !!S.teeSpot); }
function renderLensChip() { const c = $('#cLens'); c.textContent = S.lens === 'wide' ? '🔭 Wide lens — phone 2 m away (tap for normal)' : '🔭 Normal lens — phone 3 m away (tap for wide, 2 m)'; c.className = 'chip' + (S.lens === 'wide' ? ' on' : ''); }
$('#cLens').addEventListener('click', async () => {
  S.lens = S.lens === 'wide' ? 'main' : 'wide'; S.camId = '';
  if (S.lens === 'main') { S.hfov = 67; S.procW = '960'; }
  S.teeSpot = null; saidFraming.clear();
  saveSettings(); sendConfig(); renderLensChip(); renderTeeChip(); eng.ball = null;
  log(`lens set to ${S.lens}`);
  if (running) { await startCamera(); toast(S.lens === 'wide' ? 'Wide lens on — stand the phone about 2 m from the ball, then tap the ball' : 'Normal lens — stand the phone about 3 m from the ball, then tap the ball', 6000); }
});
renderLensChip();
// where the phone stands, and which camera — chosen once on the set-up screen, then hands-free
function renderViewChips() {
  const v = $('#cView'), f = $('#cFace');
  v.textContent = S.view === 'dtl' ? '📍 Phone BEHIND the ball (tap for at the side)' : '📍 Phone at the SIDE (tap for behind the ball)'; v.className = 'chip' + (S.view === 'dtl' ? ' on' : '');
  f.textContent = S.face === 'front' ? '🤳 Front camera — you can see the screen (tap for back)' : '📷 Back camera (tap for front, to see the screen)'; f.className = 'chip' + (S.face === 'front' ? ' on' : '');
}
$('#cView').addEventListener('click', () => {
  S.view = S.view === 'dtl' ? 'face' : 'dtl'; S.teeSpot = null; saidFraming.clear();
  saveSettings(); sendConfig(); renderViewChips(); renderTeeChip(); renderSettings(); worker.postMessage({ cmd: 'reset' }); eng.ball = null; log(`phone position set to ${S.view === 'dtl' ? 'behind the ball' : 'at the side'}`);
  toast(S.view === 'dtl' ? 'Phone BEHIND the ball: stand it 3 m straight behind the ball, about 1 m high, pointing at your target. Put the ball in the orange box with the target on the green line. Direction is measured properly this way.' : 'Phone at the SIDE: stand it 3 m to the side of the ball, facing you.', 11000);
});
$('#cFace').addEventListener('click', async () => {
  S.face = S.face === 'front' ? 'back' : 'front'; S.camId = ''; S.teeSpot = null;
  if (S.face === 'back') { S.hfov = S.lens === 'wide' ? 106 : 67; S.procW = S.lens === 'wide' ? '1280' : '960'; }
  saveSettings(); sendConfig(); renderViewChips(); renderTeeChip(); eng.ball = null; log(`camera set to ${S.face}`);
  if (running) { await startCamera(); toast(S.face === 'front' ? 'Front camera on. You can now see the screen from where you stand. It is usually slower and less sharp than the back camera, so check the “Camera” number at the top says 60.' : 'Back camera on.', 9000); }
});
renderViewChips();
$('#cTee').addEventListener('click', () => { if (!S.teeSpot) { toast('Tap your ball on the picture to save your tee spot'); return; } S.teeSpot = null; saveSettings(); sendConfig(); renderTeeChip(); worker.postMessage({ cmd: 'reset' }); eng.ball = null; log('tee spot cleared'); toast('Tee spot cleared — put the ball down and tap it to save a new one'); });
renderTeeChip();

document.addEventListener('touchend', () => unlockAudio(), { passive: true });
document.addEventListener('click', () => unlockAudio());

// ------------------------------------------------------------ sections: My Drive / My Info / My Game
let section = 'drive';
function showSection(sec) {
  section = sec;
  document.body.dataset.sec = sec;
  $$('#sections button').forEach((b) => b.classList.toggle('on', b.dataset.sec === sec));
  try { renderScore(); } catch { /* not ready during start-up */ }
  $('#pageInfo').hidden = sec !== 'info';
  $('#pageGame').hidden = sec !== 'game';
  if (sec === 'info') renderInfo();
  if (sec === 'game') renderGame();
  if (sec === 'drive' && !running && !round) { renderHome(); $('#start').classList.remove('hide'); } // nothing to show here yet: go home
}
$$('#sections button').forEach((b) => b.addEventListener('click', () => showSection(b.dataset.sec)));

const realShots = () => shots.filter((s) => !s.miss && !s.demo);
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
// trimmed mean: drop the top and bottom 10% once there are enough shots
const trimmed = (arr) => { const v = arr.slice().sort((p, q) => p - q); const k = v.length >= 10 ? Math.floor(v.length * 0.1) : 0; return avg(v.slice(k, v.length - k)); };

// ---- My Info: results at the desk
let openSession = null;
function renderInfo() {
  const real = realShots();
  const sessions = [...new Set(shots.map((s) => s.session))].sort((a, b) => b - a);
  const checked = shots.filter((s) => s.swing && s.swing.ok);
  const last10 = checked.slice(-10).map((s) => s.swing.score).filter((v) => v != null);
  let h = `<div class="stats">
    <div><b>${real.length}</b><span>shots</span></div>
    <div><b>${sessions.length}</b><span>session${sessions.length === 1 ? '' : 's'}</span></div>
    <div><b>${checked.length}</b><span>swings checked</span></div>
    <div><b>${last10.length ? avg(last10).toFixed(1) : '—'}</b><span>swing score (last 10)</span></div>
  </div>`;

  // distances per club
  h += '<h3>My distances</h3>';
  const by = {};
  for (const s of real) (by[s.club] ||= []).push(s);
  const ids = CLUBS.map((c) => c.id).filter((id) => by[id]);
  if (!ids.length) h += '<div class="empty">Your average distance for each club builds up here as you hit shots.</div>';
  else {
    const cols = 'grid-template-columns:52px 1fr 1fr 1fr 1fr 1fr';
    h += `<div class="row head" style="${cols}"><div>Club</div><div>Carry</div><div>Total</div><div>Longest</div><div>Spread</div><div>Shots</div></div>`;
    for (const id of ids) {
      const a = by[id], carries = a.map((s) => s.carry);
      const sd = a.length > 2 ? Math.sqrt(avg(carries.map((c) => (c - avg(carries)) ** 2))) : null;
      h += `<div class="row" style="${cols}"><div class="club">${id}</div><div><b>${fmtDist(trimmed(carries))}</b></div><div>${fmtDist(trimmed(a.map((s) => s.total)))}</div><div>${fmtDist(Math.max(...carries))}</div><div>${sd != null ? '±' + fmtDist(sd) : '—'}</div><div>${a.length}</div></div>`;
    }
    h += `<div class="empty">Carry and total are averages in ${S.dist === 'yd' ? 'yards' : 'metres'} (the odd mishit is left out once you have 10 shots). Spread = how far your carries usually vary — smaller is more consistent.</div>`;
  }

  // sessions
  h += '<h3>Sessions</h3>';
  if (!sessions.length) h += '<div class="empty">No sessions yet — go to My Drive and hit some balls.</div>';
  for (const sid of sessions) {
    const list = shots.filter((s) => s.session === sid);
    const r = list.filter((s) => !s.miss && !s.demo);
    const clubs = [...new Set(r.map((s) => s.club))];
    const sw = list.filter((s) => s.swing && s.swing.ok);
    const ts = list.length ? list[0].ts : sid;
    const open = openSession === sid;
    h += `<div class="sess${open ? ' open' : ''}" data-sess="${sid}"><div class="sess-h"><div><b>${fmtDay(ts)}</b> <span class="sub">${new Date(ts).toTimeString().slice(0, 5)}${sid === session ? ' · current' : ''}</span>
      <div class="sub">${r.length} shot${r.length === 1 ? '' : 's'}${clubs.length ? ' · ' + clubs.join(', ') : ''}${sw.length ? ` · swing score ${avg(sw.map((s) => s.swing.score).filter((v) => v != null)).toFixed(1)}` : ''}</div></div><div class="go">${open ? '▾' : '▸'}</div></div>`;
    if (open) {
      const cols = 'grid-template-columns:44px 1fr 1fr 1fr 1fr 1fr';
      h += `<div class="row head" style="${cols}"><div>Club</div><div>Carry</div><div>Total</div><div>Side</div><div>Speed ${S.speed === "kmh" ? "km/h" : S.speed === "ms" ? "m/s" : "mph"}</div><div>Swing</div></div>`;
      for (const s of list.slice().reverse()) {
        const swc = s.swing && s.swing.ok && s.swing.score != null ? `<span style="color:${scoreColour(s.swing.score)}">${s.swing.score.toFixed(1)} ▶︎</span>` : '';
        if (s.miss) { h += `<div class="row miss" style="${cols}" ${s.swing ? `data-sw="${s.id}"` : ''}><div class="club">${s.club}</div><div style="grid-column: span 4">${s.swingOnly ? 'swing only' : 'not read'}</div><div>${swc}</div></div>`; continue; }
        const side = Math.abs(+fmtDist(s.offline, 0)) < 1 ? '—' : `${Math.abs(+fmtDist(s.offline, 0))}${s.offline > 0 ? 'R' : 'L'}`;
        h += `<div class="row" style="${cols}" ${s.swing ? `data-sw="${s.id}"` : ''}><div class="club">${s.club}${s.demo ? '*' : ''}</div><div>${fmtDist(s.carry)}</div><div>${fmtDist(s.total)}</div><div>${side}</div><div>${spdNum(s.speed)}</div><div>${swc}</div></div>`;
      }
    }
    h += '</div>';
  }

  // swings
  h += `<h3>My swings</h3><div class="sub" style="margin-bottom:8px">Your last 25 swings are kept on this phone with slow-motion replay, angles, drawing, sequence and compare.</div>
    <button class="btn primary" id="infoSwings">🎥 Watch my swings</button>
    <h3>Keep a copy</h3><button class="btn" id="infoExport">⬇︎ Export all shots (spreadsheet)</button>
    <div class="sub" style="margin-top:6px">Makes a CSV file you can open in Excel or Numbers, or save to Files.</div>`;
  $('#pageInfo .inner').innerHTML = h;
}
$('#pageInfo').addEventListener('click', (e) => {
  if (e.target.id === 'infoSwings') { openSwings(); return; }
  if (e.target.id === 'infoExport') { exportShots(); return; }
  const sw = e.target.closest('[data-sw]'); if (sw) { openSwings(+sw.dataset.sw); return; }
  const ss = e.target.closest('.sess-h'); if (ss) { const id = +ss.parentElement.dataset.sess; openSession = openSession === id ? null : id; renderInfo(); }
});
function spdNum(v) { if (v == null) return '—'; return S.speed === 'kmh' ? (v * 3.6).toFixed(0) : S.speed === 'ms' ? v.toFixed(1) : (v / MPH).toFixed(0); }

async function exportShots() {
  const head = ['date', 'time', 'club', 'carry_m', 'total_m', 'offline_m', 'ball_speed_mph', 'launch_deg', 'direction_deg', 'apex_m', 'spin_rpm_est', 'swing_score', 'tempo', 'swing_tips', 'note'];
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = shots.map((s) => { const d = new Date(s.ts); const w = s.swing && s.swing.ok ? s.swing : null; return [
    d.toISOString().slice(0, 10), d.toTimeString().slice(0, 5), s.club,
    s.miss ? '' : s.carry.toFixed(1), s.miss ? '' : s.total.toFixed(1), s.miss ? '' : s.offline.toFixed(1), s.miss ? '' : (s.speed / MPH).toFixed(1),
    s.miss ? '' : s.launch.toFixed(1), s.miss ? '' : s.dir.toFixed(1), s.miss ? '' : s.apex.toFixed(1), s.miss ? '' : Math.round(s.spin),
    w && w.score != null ? w.score : '', w && w.tempo ? w.tempo.toFixed(1) : '', w ? (w.tips || []).map((t) => t.short).join('; ') : '',
    s.demo ? 'demo' : s.swingOnly ? 'swing only' : s.miss ? 'not read' : ''].map(q).join(','); });
  const file = new File([[head.join(','), ...rows].join('\n')], `golf-shots-${new Date().toISOString().slice(0, 10)}.csv`, { type: 'text/csv' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My golf shots' }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
}

// ---- My Game: what to work on, progress, (later) rounds
async function renderGame() {
  const el = $('#pageGame .inner');
  let list = [];
  try { list = await listSwings(); } catch { /* no saved swings */ }
  const ok = list.filter((r) => r.ok); // newest first
  let h = '';
  if (!ok.length) {
    h += '<div class="empty">Your coaching builds up here: the faults that keep coming up with a drill for each, your swing score and tempo over time, and a training goal. Hit a few shots in My Drive with Swing tips on (Settings › My swing).</div>';
  } else {
    const recent = ok.slice(0, 10), prev = ok.slice(10, 20);
    const sc = (a) => avg(a.map((r) => r.score).filter((v) => v != null));
    const tp = avg(recent.map((r) => r.metrics && r.metrics.tempo).filter((v) => v));
    const now = sc(recent), before = prev.length >= 3 ? sc(prev) : null;
    const trend = before == null ? '' : now > before + 0.3 ? `📈 up from ${before.toFixed(1)}` : now < before - 0.3 ? `📉 down from ${before.toFixed(1)}` : '➡︎ steady';
    h += `<div class="stats">
      <div><b style="color:${scoreColour(now)}">${now.toFixed(1)}</b><span>swing score (last ${recent.length}) ${trend}</span></div>
      <div><b>${tp ? tp.toFixed(1) + ':1' : '—'}</b><span>tempo (good ≈ 3:1)</span></div>
      <div><b>${ok.length}</b><span>swings checked</span></div>
    </div>`;
    h += '<h3>Swing score, every swing</h3><canvas class="chart" id="scoreChart"></canvas>';

    // what to work on: faults that keep coming up, newest wording and the drill
    const faults = {};
    for (const r of ok.slice(0, 20)) for (const t of r.tips) { const f = (faults[t.key] ||= { n: 0, t }); f.n++; }
    const top = Object.values(faults).sort((a, b) => b.n - a.n).slice(0, 3);
    const n = Math.min(20, ok.length);
    h += '<h3>What to work on</h3>';
    if (!top.length) h += '<div class="tip good">No faults keep coming up in your last swings — keep it going.</div>';
    top.forEach(({ n: k, t }, i) => {
      h += `<div class="work"><div class="work-h"><span class="num">${i + 1}</span><b>${t.short}</b><span class="sub">in ${k} of your last ${n} swings</span></div>
        <div>${t.text}</div>${t.drill ? `<div class="drill">🏌️ ${t.drill}</div>` : ''}</div>`;
    });
    // what's going well
    const goods = {};
    for (const r of ok.slice(0, 10)) for (const g of r.good || []) { const k = g.replace(/\s*\(.*\)$/, '').replace(/[\d.]+:1/, ''); goods[k] = (goods[k] || 0) + 1; }
    const well = Object.entries(goods).sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, c]) => c >= Math.max(2, recent.length / 2));
    if (well.length) h += `<h3>Going well</h3>${well.map(([g]) => `<div class="tip good">✓ ${g}</div>`).join('')}`;
  }
  // training goal
  h += '<h3>Training goal</h3>' + renderGoal(list);
  h = roundCardHtml() + h;
  h += `<h3>Handicap and real courses <span class="soon">coming later</span></h3>
    <div class="later">Your handicap and the real courses you’ve played will live here.</div>`;
  el.innerHTML = h;
  const scoreVals = ok.map((r) => r.score).filter((v) => v != null).reverse().slice(-30);
  if ($('#scoreChart')) drawSeries($('#scoreChart'), scoreVals, [8, 10], '', 1);
  drawGoalChart(list);
}
$('#pageGame').addEventListener('change', (e) => { if (e.target.id === 'goalSel') { S.goal = e.target.value; saveSettings(); renderGame(); } });

// ------------------------------------------------------------ play a round
let round = store.get('round', null); // { courseId, name, i, p, strokes, scores, trail, done, msg, sim }
let customCourses = store.get('courses', []);
const allCourses = () => [...COURSES, ...customCourses];
const roundCourse = () => { const c = allCourses().find((x) => x.id === round.courseId); return c ? buildCourse(c) : null; };
const saveRound = () => store.set('round', round);
function clubAvg(id) {
  if (S.myDist && S.myDist[id] > 0) return S.myDist[id]; // the distance you set yourself wins
  const a = shots.filter((s) => s.club === id && !s.miss && !s.demo).map((s) => s.total);
  if (a.length >= 3) return trimmed(a);
  // until you have your own numbers: a typical club golfer (about 80% of tour ball speed), through the app's own flight model
  if (!(id in clubAvg.cache)) { const c = clubById(id); clubAvg.cache[id] = simulate({ speed: c.ball * MPH * 0.8, launch: c.launch + 2, direction: 0, spin: c.spin, spinAxis: 0, altitude: +S.altitude, tempC: +S.tempC, firmness: +S.firmness }).total; }
  return clubAvg.cache[id];
}
clubAvg.cache = {};
function suggestClub(d) {
  const list = CLUBS.map((c) => ({ id: c.id, name: c.name, avg: clubAvg(c.id) })).sort((a, b) => b.avg - a.avg);
  const fit = list.filter((c) => c.avg <= d * 1.06);
  const pick = fit.length ? fit[0] : list[list.length - 1];
  return { ...pick, partial: pick.avg > d * 1.12, longest: list[0].avg };
}
// ---- wind, green slope and aim for the hole being played
function holeSetup() { // called at the start of every hole
  const r = Math.random; round.wind = r() < 0.2 ? { s: 0, a: 0 } : { s: Math.round(1 + r() * 7), a: r() * Math.PI * 2 };
  round.slope = { a: r() * Math.PI * 2, g: Math.round((0.5 + r() * 2.3) * 10) / 10 }; round.aimOff = 0;
}
function curAim(h) { // where the shot is aimed, after any left/right adjustment
  const base = round.putting ? pinOf(h) : aimPoint(h, round.p, suggestClub(1e9).longest), a = ((round.aimOff || 0) * Math.PI) / 180;
  const dx = base.x - round.p.x, dz = base.z - round.p.z;
  return { x: round.p.x + dx * Math.cos(a) - dz * Math.sin(a), z: round.p.z + dz * Math.cos(a) + dx * Math.sin(a) };
}
function aimDir(h) { const a = curAim(h), L = Math.hypot(a.x - round.p.x, a.z - round.p.z) || 1; return { x: (a.x - round.p.x) / L, z: (a.z - round.p.z) / L }; }
// ---- badges
const BADGES = [
  ['first', '🏁', 'First round', 'Finish a round'], ['full18', '⛳', 'The full 18', 'Finish an 18-hole round'], ['level', '🎯', 'Level best', 'Finish a round at level par or better'],
  ['birdie', '🐦', 'Birdie', 'Make a birdie'], ['eagle', '🦅', 'Eagle', 'Make an eagle or better'], ['ace', '💎', 'Hole in one', 'Hole your tee shot'],
  ['bomb', '🚀', 'Big hitter', 'Hit a shot of 230 m or more in a round'], ['snake', '🐍', 'Long putt', 'Hole a putt from 6 m or more'],
  ['net', '🏌️', 'Range round', 'Finish a round hitting real shots at your net'], ['designer', '📐', 'Course designer', 'Design and save your own course'],
];
function award(id) {
  const got = store.get('badges', {}); if (got[id]) return;
  const b = BADGES.find((x) => x[0] === id); if (!b) return;
  got[id] = Date.now(); store.set('badges', got); log(`badge earned: ${b[2]}`);
  setTimeout(() => { toast(`${b[1]} Badge earned: ${b[2]}`, 6000); say(`Badge earned. ${b[2]}`); }, 4200);
}
function badgesHtml() {
  const got = store.get('badges', {}), n = BADGES.filter((b) => got[b[0]]).length;
  return `<h3>Badges · ${n} of ${BADGES.length}</h3><div class="badges">${BADGES.map((b) => `<div class="badge ${got[b[0]] ? 'got' : ''}"><em>${got[b[0]] ? b[1] : '🔒'}</em><b>${b[2]}</b><span>${b[3]}</span></div>`).join('')}</div>`;
}
function holeBadges(strokes, par) { if (strokes === 1) award('ace'); if (strokes <= par - 2) award('eagle'); else if (strokes === par - 1) award('birdie'); }
// ---- more than one player on one phone, taking turns
const PF = ['p', 'strokes', 'trail', 'done', 'putting', 'msg', 'last', 'aimOff', 'scores'];
const PCOL = [0xff6a1f, 0x2f8cff, 0xe83e8c, 0x35c46a], PCSS = ['#ff6a1f', '#2f8cff', '#e83e8c', '#35c46a'];
const multi = () => !!(round && round.pl && round.pl.length > 1);
const allDone = () => (!multi() ? !!round.done : round.pl.every((q, i) => (i === round.cur ? round.done : q.done)));
function stash() { if (multi()) for (const k of PF) round.pl[round.cur][k] = round[k]; }
function unstash(i) { round.cur = i; for (const k of PF) round[k] = round.pl[i][k]; }
const whoName = () => (multi() ? round.pl[round.cur].name : '');
let pendingTurn = false, turnTok = 0;
// safety net in case the animation never reports back; an older timer must never end a newer turn
function turnLater(ms) { const tok = ++turnTok; setTimeout(() => { if (tok === turnTok) advanceTurn(); }, ms); }
function advanceTurn() {
  if (!pendingTurn || !multi()) return;
  pendingTurn = false; stash();
  const c = roundCourse(), h = c.holes[round.i];
  if (round.pl.every((q) => q.done)) { round.msg = `Hole ${round.i + 1}: ${round.pl.map((q) => `${q.name} ${q.scores[round.i]}`).join(' · ')}`; saveRound(); renderRound(); if (round.mode !== 'arcade') handsFree(h); return; }
  let n = round.cur; do { n = (n + 1) % round.pl.length; } while (round.pl[n].done);
  if (n !== round.cur) {
    unstash(n); if (S.sfx !== 'off') sfx.turn(); toast(`${round.pl[n].name}’s turn`, 2500);
    if (round.mode === 'arcade') say(`${round.pl[n].name}'s turn`);
  }
  if (round.mode !== 'arcade') { const pin = pinOf(h), d = Math.hypot(round.p.x - pin.x, round.p.z - pin.z), sc = suggestClub(d); S.club = sc.id; saveSettings(); renderClubs(); say(`${round.pl[n].name}. ${fmtDist(d)} ${unitWord()} to the flag. ${sc.name}.`); }
  saveRound(); renderRound();
}
function startRound(courseId, mode = 'range', names = []) {
  const c = allCourses().find((x) => x.id === courseId); if (!c) return;
  const h = buildCourse(c).holes[0];
  round = { courseId, name: c.name, i: 0, p: { ...h.path[0] }, strokes: 0, scores: [], trail: [{ ...h.path[0] }], done: false, msg: mode === 'arcade' ? 'Tee shot. Pick a club, then tap “Play shot”.' : 'Tee shot. Hit into your net, or tap “Play shot on phone”.', sim: false, mode, putting: false };
  if (names.length > 1) { round.pl = names.map((name) => ({ name, p: { ...h.path[0] }, strokes: 0, trail: [{ ...h.path[0] }], done: false, putting: false, msg: round.msg, last: null, aimOff: 0, scores: [] })); round.cur = 0; unstash(0); }
  pendingTurn = false; holeSetup(); saveRound(); log(`round started: ${c.name} (${mode})`); teeTalk();
  $('#start').classList.add('hide'); showSection('drive'); renderRound();
}
function endRound(save) {
  stash(); pendingTurn = false;
  if (round && save && round.scores.length) {
    const c = roundCourse(), pars = c ? c.holes.slice(0, round.scores.length).map((h) => h.par) : [];
    if (c && round.scores.length >= c.holes.length) {
      award('first'); if (c.holes.length >= 18) award('full18'); if (round.mode !== 'arcade' && !round.sim) award('net');
      if (round.scores.reduce((a, b) => a + b, 0) <= pars.reduce((a, b) => a + b, 0)) award('level');
    }
    const rounds = store.get('rounds', []);
    rounds.push({ id: Date.now(), ts: Date.now(), name: round.name, scores: round.scores, pars, holes: c ? c.holes.length : round.scores.length, sim: round.sim, players: multi() ? round.pl.map((q) => ({ name: q.name, scores: q.scores })) : undefined });
    store.set('rounds', rounds.slice(-50));
    log(`round saved: ${round.name} ${round.scores.reduce((a, b) => a + b, 0)} (par ${pars.reduce((a, b) => a + b, 0)})`);
  }
  round = null; saveRound(); renderRound();
}
// a shot (real or simulated) arrives while a round is on
function roundShot(shot) {
  if (!round || round.done || round.putting || pendingTurn) return;
  const c = roundCourse(); if (!c) return;
  const h = c.holes[round.i];
  // wind: a tailwind adds distance, a headwind takes it off, a crosswind pushes the ball sideways (more on longer shots)
  const u = aimDir(h), w = round.wind || { s: 0, a: 0 }, wx = Math.cos(w.a) * w.s, wz = Math.sin(w.a) * w.s, k = Math.min(1.5, shot.total / 150);
  const total = shot.total < 30 ? shot.total : shot.total * (1 + 0.012 * (wx * u.x + wz * u.z) * k), offline = shot.offline + (shot.total < 30 ? 0 : 0.006 * (wx * -u.z + wz * u.x) * shot.total * k);
  const r = playShot(h, { p: round.p, strokes: round.strokes }, { total, offline, aim: curAim(h), fmt: fmtLie }, Math.random, round.mode === 'arcade');
  if (total >= 230) award('bomb');
  round.aimOff = 0;
  if (r.onGreen) round.putting = true;
  round.trail.push({ ...r.to, bad: !!r.penalty }); if (r.penalty) round.trail.push({ ...r.from });
  round.last = { from: r.from, to: r.to, penalty: !!r.penalty, done: !!r.done, apex: shot.apex, lie: r.lie, gator: r.gator ?? -1, under: !!r.done && r.strokes < h.par };
  round.p = r.p; round.strokes = r.strokes; round.msg = r.msg; if (shot.sim) round.sim = true;
  if (r.done) {
    round.done = true; round.scores[round.i] = r.strokes; if (!r.pickedUp) holeBadges(r.strokes, h.par);
    const nm = r.pickedUp ? '' : scoreName(r.strokes, h.par);
    round.msg = `${r.msg} ${nm ? nm + ' — ' : ''}${r.strokes} on a par ${h.par}.`;
    setTimeout(() => say(nm || 'Next hole'), shot.sim ? 300 : 3200);
  }
  if (round.mode !== 'arcade' && !shot.sim && !multi()) handsFree(h);
  if (multi()) { stash(); pendingTurn = true; turnLater(v3state === 'on' ? 16000 : 1600); }
  saveRound(); renderRound(true);
}
// At the net nobody wants to walk to the phone between shots: pick the club, read out what's next and move to the next hole by itself.
const fmtLie = (m, short) => (short ? (S.dist === 'yd' ? `${(m * 3.281).toFixed(0)} ft` : `${m.toFixed(1)} m`) : `${fmtDist(m)} ${dUnit()}`); // distances in messages, in your units
const unitWord = () => (S.dist === 'yd' ? 'yards' : 'metres');
function handsFree(h) {
  if (!allDone()) {
    if (multi()) return;
    const pin = pinOf(h), d = Math.hypot(round.p.x - pin.x, round.p.z - pin.z), sc = suggestClub(d);
    S.club = sc.id; saveSettings(); renderClubs();
    setTimeout(() => say(`${fmtDist(d)} ${unitWord()} to the flag. ${sc.name}${sc.partial ? ', easy swing' : ''}.`), 5500);
  } else {
    const i = round.i, id = round.courseId;
    setTimeout(() => { if (round && allDone() && round.i === i && round.courseId === id) roundNext(); }, 11000);
  }
}
function teeTalk() { // read out the new hole and choose the club for it
  if (!round || round.mode === 'arcade') return;
  const c = roundCourse(), h = c.holes[round.i], sc = suggestClub(h.len);
  S.club = sc.id; saveSettings(); renderClubs();
  setTimeout(() => say(`${multi() ? whoName() + ' to play. ' : ''}Hole ${round.i + 1}. Par ${h.par}. ${fmtDist(h.len)} ${unitWord()}. ${sc.name}.`), 900);
}
function roundPutt(pt) {
  if (!round || round.done || !round.putting || pendingTurn) return;
  const c = roundCourse(); if (!c) return;
  const h = c.holes[round.i], r = playPutt(h, { p: round.p, strokes: round.strokes }, { len: pt.len, deg: pt.deg + (round.aimOff || 0), fmt: fmtLie }, round.slope);
  round.aimOff = 0; if (r.holed && r.holedFrom >= 6) award('snake');
  round.trail.push({ ...r.to }); round.last = { from: r.from, to: r.to, putt: true, done: !!r.holed, under: !!r.holed && r.strokes < h.par, left: r.left };
  round.p = r.p; round.strokes = r.strokes; round.msg = r.msg; round.sim = true;
  if (r.done) {
    round.done = true; round.putting = false; round.scores[round.i] = r.strokes; if (!r.pickedUp) holeBadges(r.strokes, h.par);
    const nm = r.pickedUp ? '' : scoreName(r.strokes, h.par);
    round.msg = `${r.msg} ${nm ? nm + ', ' : ''}${r.strokes} on a par ${h.par}.`;
    setTimeout(() => say(nm || 'Next hole'), 2200);
  }
  if (multi()) { stash(); pendingTurn = true; turnLater(v3state === 'on' ? 9000 : 1600); }
  saveRound(); renderRound(true);
}
const distTxt = (d) => (round && round.putting ? (S.dist === 'yd' ? `${(d * 3.281).toFixed(0)} ft` : `${d.toFixed(1)} m`) : `${fmtDist(d)} ${dUnit()}`);
function roundNext() {
  const c = roundCourse(); if (!round || !c) return;
  stash(); pendingTurn = false;
  if (round.i + 1 >= c.holes.length && multi()) {
    const tots = round.pl.map((q) => ({ n: q.name, t: q.scores.reduce((a, b) => a + (b || 0), 0) })).sort((a, b) => a.t - b.t), tie = tots[1].t === tots[0].t;
    toast(`${tie ? 'It’s a tie!' : `🏆 ${tots[0].n} wins!`} ${tots.map((x) => `${x.n} ${x.t}`).join(' · ')}. Saved in My Game.`, 9000); say(tie ? 'It is a tie' : `${tots[0].n} wins`); if (S.sfx !== 'off') sfx.clap(2);
    endRound(true); showSection('game'); return;
  }
  if (round.i + 1 >= c.holes.length) {
    const tot = round.scores.reduce((a, b) => a + b, 0), par = c.holes.reduce((a, h) => a + h.par, 0);
    toast(`Round finished: ${tot} (${tot === par ? 'level par' : tot > par ? '+' + (tot - par) : tot - par}). Saved in My Game.`, 7000);
    endRound(true); showSection('game'); return;
  }
  round.i++; const h = c.holes[round.i];
  Object.assign(round, { p: { ...h.path[0] }, strokes: 0, trail: [{ ...h.path[0] }], done: false, putting: false, last: null, msg: 'Tee shot.' });
  if (multi()) { // everyone back to the tee; lowest score on the last hole plays first
    let first = 0; round.pl.forEach((q, i) => { Object.assign(q, { p: { ...h.path[0] }, strokes: 0, trail: [{ ...h.path[0] }], done: false, putting: false, last: null, aimOff: 0, msg: 'Tee shot.' }); if ((q.scores[round.i - 1] ?? 99) < (round.pl[first].scores[round.i - 1] ?? 99)) first = i; });
    unstash(first);
  }
  holeSetup(); teeTalk();
  saveRound(); renderRound();
}
function simShot() {
  if (!round || round.done) return;
  if (round.putting) { const pn = pinOf(roundCourse().holes[round.i]), dd = Math.hypot(round.p.x - pn.x, round.p.z - pn.z); roundPutt({ len: dd + (Math.random() < 0.6 ? 0.4 : -0.5), deg: (Math.random() - 0.5) * (dd > 3 ? 3 : 0.5) }); return; }
  const c = roundCourse(), h = c.holes[round.i], d = Math.hypot(round.p.x - pinOf(h).x, round.p.z - pinOf(h).z);
  const sc = suggestClub(d), g = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58;
  const total = Math.min(sc.avg, d) * (1 + 0.08 * g());
  roundShot({ total, offline: total * Math.tan((5 * g() * Math.PI) / 180), sim: true });
}
function renderRound(animate) {
  const on = !!round; document.body.dataset.round = on ? 'on' : 'off';
  $('#holeCanvas').hidden = !on; $('#roundHud').hidden = !on; renderScore();
  if (!on) { soundScene(); $('#v3wrap').hidden = true; document.body.dataset.v3 = 'off'; if (v3) v3.stop(); return; }
  const c = roundCourse(); if (!c) { endRound(false); return; }
  const h = c.holes[round.i], pin = pinOf(h), d = Math.hypot(round.p.x - pin.x, round.p.z - pin.z);
  const soFar = round.scores.reduce((a, b) => a + (b || 0), 0), parSoFar = c.holes.slice(0, round.scores.filter((x) => x != null).length).reduce((a, x) => a + x.par, 0);
  const rel = soFar - parSoFar;
  $('#rhTitle').textContent = `Hole ${round.i + 1}/${c.holes.length} · Par ${h.par} · ${fmtDist(h.len)} ${dUnit()}`;
  const who = multi() ? `${whoName()} · ` : '';
  $('#rhInfo').style.color = multi() ? PCSS[round.cur] : '';
  $('#rhInfo').textContent = who + (round.done ? `Round: ${soFar} (${rel === 0 ? 'level' : rel > 0 ? '+' + rel : rel})` : `${round.putting ? 'Putting · shot' : 'Shot'} ${round.strokes + 1} · ${distTxt(d)} to the flag${round.scores.length ? ` · round ${rel === 0 ? 'level' : rel > 0 ? '+' + rel : rel}` : ''}`);
  $('#rhMsg').textContent = round.msg || '';
  const sc = suggestClub(d);
  $('#rhClub').hidden = round.done || !!meter.phase || round.putting; $('#rhBag').hidden = !!round.putting; $('#rhSim').hidden = round.done || !!meter.phase || pendingTurn;
  $('#rhSim').textContent = round.putting ? '⛳ Putt' : round.mode === 'arcade' ? 'Play shot' : 'Play this shot on the phone'; $('#rhNext').hidden = !round.done || !allDone() || pendingTurn;
  $('#rhMusic').hidden = round.mode !== 'arcade'; $('#rhMusic').classList.toggle('off', S.music === 'off'); soundScene();
  $('#rhNext').textContent = round.i + 1 >= c.holes.length ? 'Finish round ›' : 'Next hole ›';
  $('#rhAimL').hidden = $('#rhAimR').hidden = round.done || !!meter.phase;
  { // wind, slope and aim line
    const u = aimDir(h), w = round.wind || { s: 0, a: 0 }, sl = round.slope || { a: 0, g: 0 }, ao = round.aimOff || 0, bits = [];
    const rel = (a) => ((a - Math.atan2(u.z, u.x)) * 180) / Math.PI;
    if (round.putting) {
      const gx = sl.g * Math.cos(sl.a), gz = sl.g * Math.sin(sl.a), along = gx * u.x + gz * u.z, cross = gx * -u.z + gz * u.x;
      const p1 = Math.abs(cross) < 0.3 ? 'straight' : `breaks ${cross > 0 ? 'right' : 'left'} (${Math.abs(cross).toFixed(1)}%)`, p2 = Math.abs(along) < 0.3 ? 'flat' : `${along > 0 ? 'downhill' : 'uphill'} (${Math.abs(along).toFixed(1)}%)`;
      bits.push(`Green: ${p1}, ${p2} <i style="transform:rotate(${rel(sl.a)}deg)">↑</i>`);
    } else if (!round.done) bits.push(w.s ? `Wind ${S.dist === 'yd' ? Math.round(w.s * 2.237) + ' mph' : Math.round(w.s * 3.6) + ' km/h'} <i style="transform:rotate(${rel(w.a)}deg)">↑</i>` : 'No wind');
    if (ao && !round.done) bits.push(`Aim ${Math.abs(ao)}° ${ao > 0 ? 'right' : 'left'}`);
    $('#rhWind').innerHTML = round.done ? '' : bits.join(' · ');
  }
  $('#rhMid').hidden = !round.putting || round.done || !!meter.phase;
  $('#rhBag').value = S.club;
  $('#rhClub').textContent = S.club === sc.id ? `${sc.name}${sc.partial ? ' — easy swing' : ''} ✓` : `Use ${sc.name}${sc.partial ? ' (easy swing)' : ''}`;
  $('#rhClub').dataset.club = sc.id;
  view3d(h, animate);
  drawHole(h, animate);
}
// ---- a small buzz in the hand. Android has a proper vibration call; iPhone Safari does not, but flipping a hidden
// switch control makes the phone tick, so that is used there.
const hapticEl = (() => { const l = document.createElement('label'); l.style.cssText = 'position:fixed;left:-200px;top:0;opacity:0;pointer-events:none'; l.setAttribute('aria-hidden', 'true'); l.innerHTML = '<input type="checkbox" switch tabindex="-1">'; document.body.appendChild(l); return l; })();
function haptic(n = 1) {
  if (S.haptics === 'off') return;
  try { if (navigator.vibrate) { navigator.vibrate(n > 2 ? [20, 50, 20, 50, 30] : n > 1 ? [18, 40, 18] : 14); return; } for (let i = 0; i < n; i++) setTimeout(() => hapticEl.click(), i * 90); } catch { /* not available */ }
}
// ---- sounds for what happens on the course
function gameSound(n, L) {
  if (n === 'hit') haptic(2); else if (n === 'holed') haptic(3); else if (n === 'putt') haptic(1); else if (n === 'land' && (L.lie === 'water' || L.gator >= 0)) haptic(2);
  if (S.sfx === 'off') return;
  if (n === 'hit') sfx.hit(); else if (n === 'putt') sfx.putt(); else if (n === 'hooves') sfx.hooves();
  else if (n === 'land') {
    if (L.gator >= 0) { sfx.thud(); setTimeout(() => sfx.snap(), 450); setTimeout(() => sfx.groan(), 1300); }
    else if (L.lie === 'water') { sfx.splash(); setTimeout(() => sfx.groan(), 500); }
    else if (L.lie === 'oob') { sfx.thud(); setTimeout(() => sfx.groan(), 300); }
    else if (L.lie === 'bunker') sfx.sand();
    else { sfx.thud(); if (L.lie === 'green') setTimeout(() => sfx.clap(1), 350); }
  } else if (n === 'holed') { sfx.cup(); setTimeout(() => sfx.clap(L.under ? 2 : 1.3), 300); }
  else if (n === 'stop' && L.left < 1) sfx.groan();
}
let sndState = '';
function soundScene() { // birdsong whenever a round is on screen, music only in arcade
  const amb = !!round && S.sfx !== 'off', mus = !!round && round.mode === 'arcade' && S.music !== 'off', st = `${amb}${mus}`;
  if (st === sndState) return; sndState = st; ambience(amb); music(mus);
}
// ---- the 3D view from behind the ball (falls back to the flat map if the phone can't do 3D)
let v3 = null, v3state = 'none', v3hole = '';
function view3d(h, animate) {
  if (v3state === 'none') {
    v3state = 'loading';
    loadThree().then(() => { v3 = new Course3D($('#hole3d'), $('#pinTag')); v3state = 'on'; log('3D course view ready'); if (round) renderRound(); })
      .catch((e) => { v3state = 'off'; log(`3D course view not available: ${e.message}`); });
    return;
  }
  if (v3state !== 'on') return;
  document.body.dataset.v3 = 'on'; $('#v3wrap').hidden = false; v3.start(); v3.resize(round.mode === 'arcade' ? $('#roundHud').offsetHeight * 1.35 : 0);
  const key = `${round.courseId}:${round.i}`, fresh = v3hole !== key;
  if (fresh) { let seed = round.i + 1; for (const ch of String(round.courseId)) seed = (seed * 31 + ch.charCodeAt(0)) % 9973; v3.setHole(h, seed, (allCourses().find((x) => x.id === round.courseId) || {}).theme, round.slope); v3hole = key; }
  const pin = pinOf(h), prev = h.path[h.path.length - 2], d = Math.hypot(round.p.x - pin.x, round.p.z - pin.z);
  $('#pinTag').textContent = round.done ? '' : distTxt(d);
  const aim = round.done ? { x: pin.x * 2 - prev.x, z: pin.z * 2 - prev.z } : curAim(h);
  let ring = null;
  if (!round.done && !round.putting) { const L = Math.hypot(aim.x - round.p.x, aim.z - round.p.z) || 1, reach = clubAvg(S.club); ring = { x: round.p.x + ((aim.x - round.p.x) / L) * reach, z: round.p.z + ((aim.z - round.p.z) / L) * reach }; }
  v3.setPlayers(multi() ? PCOL[round.cur] : PCOL[0], multi() ? round.pl.map((q, i) => ({ q, i })).filter((o) => o.i !== round.cur && !o.q.done && o.q.strokes > 0).map((o) => ({ p: o.q.p, color: PCOL[o.i] })) : []);
  v3.setState(round.p, aim, ring, !fresh, !!round.putting, !!round.done);
  if (animate && round.last) { // keep the result back until the ball has landed
    const m = $('#rhMsg'), i = $('#rhInfo'), mt = m.textContent, it = i.textContent, nx = $('#rhNext').hidden; m.textContent = 'Ball in the air…'; $('#rhNext').hidden = true;
    const go = round.last.putt ? (o) => v3.roll(round.last.from, round.last.to, o) : (o) => v3.fly(round.last.from, round.last.to, o);
    m.textContent = round.last.putt ? 'Rolling…' : m.textContent; const wait = m.textContent;
    const L = { ...round.last };
    go({ apex: L.apex, done: L.done, penalty: L.penalty, gator: L.gator, ev: (n) => gameSound(n, L), then: () => { if (round && m.textContent === wait) { m.textContent = mt; i.textContent = it; $('#rhNext').hidden = nx; } if (pendingTurn) turnLater(900); } });
  } else if (animate && round.last && S.sfx !== 'off') { round.last.putt ? sfx.putt() : sfx.hit();
  }
}
let holeAnim = 0;
function drawHole(h, animate) {
  const cv = $('#holeCanvas'), r = cv.getBoundingClientRect(), dpr = Math.min(2.5, devicePixelRatio || 1);
  const W = Math.max(50, r.width), H = Math.max(50, r.height);
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const xs = h.path.map((p) => p.x), zs = h.path.map((p) => p.z);
  const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, z0 = Math.min(...zs, 0) - 50, z1 = Math.max(...zs, 0) + 50;
  const mini = document.body.dataset.v3 === 'on', padT = mini ? 5 : 14, padB = mini ? 5 : 96, k = Math.min((W - 24) / (x1 - x0), (H - padT - padB) / (z1 - z0));
  const ox = (W - (x1 - x0) * k) / 2, oy = padT + (H - padT - padB - (z1 - z0) * k) / 2;
  const X = (p) => ox + (p.x - x0) * k, Y = (p) => oy + (p.z - z0) * k;
  ctx.fillStyle = '#000307'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(63,230,255,0.07)'; ctx.lineWidth = 1;
  for (let m = Math.ceil(x0 / 50) * 50; m <= x1; m += 50) { ctx.beginPath(); ctx.moveTo(ox + (m - x0) * k, 0); ctx.lineTo(ox + (m - x0) * k, H); ctx.stroke(); }
  for (let m = Math.ceil(z0 / 50) * 50; m <= z1; m += 50) { ctx.beginPath(); ctx.moveTo(0, oy + (m - z0) * k); ctx.lineTo(W, oy + (m - z0) * k); ctx.stroke(); }
  const pathLine = () => { ctx.beginPath(); h.path.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(63,230,255,0.35)'; ctx.lineWidth = h.fw * k + 3; ctx.shadowColor = '#3fe6ff'; ctx.shadowBlur = 12; pathLine(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = '#021a22'; ctx.lineWidth = h.fw * k; pathLine(); ctx.stroke();
  const pin = pinOf(h);
  for (const z of h.haz) {
    ctx.beginPath(); ctx.arc(X(z), Y(z), z.r * k, 0, Math.PI * 2);
    if (z.type === 'water') { ctx.fillStyle = 'rgba(40,110,255,0.45)'; ctx.strokeStyle = '#4a8cff'; } else { ctx.fillStyle = 'rgba(255,190,90,0.28)'; ctx.strokeStyle = 'rgba(255,190,90,0.9)'; }
    ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(X(pin), Y(pin), h.greenR * k, 0, Math.PI * 2); ctx.fillStyle = 'rgba(57,255,156,0.22)'; ctx.strokeStyle = '#39ff9c'; ctx.lineWidth = 1.5; ctx.shadowColor = '#39ff9c'; ctx.shadowBlur = 10; ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(pin), Y(pin)); ctx.lineTo(X(pin), Y(pin) - 16); ctx.stroke();
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(X(pin), Y(pin) - 16); ctx.lineTo(X(pin) + 9, Y(pin) - 12); ctx.lineTo(X(pin), Y(pin) - 8); ctx.closePath(); ctx.fill();
  const tee = h.path[0]; ctx.strokeStyle = 'rgba(63,230,255,0.9)'; ctx.strokeRect(X(tee) - 4, Y(tee) - 6, 8, 12);
  // shots so far (the last one draws itself in)
  const tr = round.trail, t = animate ? 0 : 1;
  const frame = (tt) => {
    if (!round || round.trail !== tr) return;
    ctx.save();
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i], last = i === tr.length - 1 || (tr[i].bad && i === tr.length - 2);
      const f = last ? tt : 1, bx = X(a) + (X(b) - X(a)) * f, by = Y(a) + (Y(b) - Y(a)) * f;
      if (tr[i - 1].bad) continue; // the walk back after a penalty isn't a shot
      ctx.strokeStyle = b.bad ? '#ff3d5a' : '#3fe6ff'; ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = b.bad ? '#ff3d5a' : '#bff6ff'; ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(round.p), Y(round.p), 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  if (!round.done) { // aim line
    const aim = curAim(h);
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,122,26,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(round.p), Y(round.p)); ctx.lineTo(X(aim), Y(aim)); ctx.stroke(); ctx.setLineDash([]);
  }
  cancelAnimationFrame(holeAnim);
  if (!animate) { frame(1); return; }
  const base = ctx.getImageData(0, 0, cv.width, cv.height), t0 = performance.now();
  const step = (now) => { const tt = Math.min(1, (now - t0) / 900); ctx.putImageData(base, 0, 0); frame(tt); if (tt < 1) holeAnim = requestAnimationFrame(step); };
  holeAnim = requestAnimationFrame(step);
}
window.addEventListener('resize', () => { if (round) renderRound(); });
window.addEventListener('orientationchange', () => setTimeout(() => { if (round) renderRound(); }, 400));
// ---- playing on the phone (no net): pick a club, then two taps — power, then aim
const meter = { phase: 0, t0: 0, power: 0, raf: 0 };
function meterPos(now) { const period = meter.phase === 1 ? 1500 : 1000, u = ((now - meter.t0) % (period * 2)) / period; return u <= 1 ? u : 2 - u; } // 0..1..0
function meterLoop(now) {
  if (!meter.phase) return;
  $('#rhMark').style.left = `${meterPos(now) * 100}%`;
  meter.raf = requestAnimationFrame(meterLoop);
}
function setZone(l, w) { const z = $('#rhMeter .zone'); l = Math.max(0, Math.min(100 - w, l)); z.style.left = `${l}%`; z.style.width = `${w}%`; }
function meterStart() {
  if (!round || round.done || pendingTurn) return;
  unlockAudio(); soundScene();
  meter.phase = 1; meter.t0 = performance.now(); meter.putt = null;
  if (round.putting) { const pin = pinOf(roundCourse().holes[round.i]), d = Math.hypot(round.p.x - pin.x, round.p.z - pin.z); meter.putt = { d, max: Math.max(d * 1.6, 2.5) }; }
  const pt = meter.putt;
  if (pt) setZone((pt.d / pt.max) * 100, Math.max(6, (1.5 / pt.max) * 100)); else setZone(78, 14);
  $('#rhMeter').hidden = false; $('#rhMeter').dataset.phase = '1'; $('#rhMeterLbl').textContent = pt ? `PUTT POWER — ${distTxt(pt.d)}: tap when the marker is in the green` : `POWER — ${clubById(S.club).name}: tap when the marker is in the green`;
  $('#rhSim').hidden = true; $('#rhClub').hidden = true;
  meter.raf = requestAnimationFrame(meterLoop);
}
function meterTap() {
  haptic(1);
  const pos = meterPos(performance.now());
  if (meter.phase === 1) {
    meter.power = pos; meter.phase = 2; meter.t0 = performance.now() - 500; $('#rhMeter').dataset.phase = '2'; $('#rhMeterLbl').textContent = 'AIM — tap when the marker is in the green';
    if (meter.putt) { const A = Math.max(0.05, Math.min(0.6, (Math.asin(Math.min(1, 0.11 / meter.putt.d)) * 180) / Math.PI / 6)); setZone(50 - A * 50, A * 100); } else setZone(45, 10);
    return;
  }
  if (meter.phase !== 2) return;
  cancelAnimationFrame(meter.raf); meter.phase = 0; $('#rhMeter').hidden = true;
  if (meter.putt) {
    const len = meter.power * meter.putt.max * (1 + (Math.random() - 0.5) * 0.03), deg = (pos - 0.5) * 2 * 6;
    log(`phone putt: ${meter.putt.d.toFixed(1)} m, hit ${len.toFixed(1)} m, ${deg.toFixed(1)}°`);
    roundPutt({ len, deg }); return;
  }
  // power: the green zone (78–92%) is a full shot; beyond it you swing too hard and spray it
  const pw = meter.power, over = Math.max(0, pw - 0.92), aim = (pos - 0.5) * 2; // aim: -1 left … +1 right
  const total = clubAvg(S.club) * Math.min(1.06, pw / 0.85) * (1 + (Math.random() - 0.5) * 0.04);
  const deg = aim * 14 + (Math.random() - 0.5) * (2 + over * 120);
  log(`phone shot: ${S.club} power ${(pw * 100).toFixed(0)}% aim ${(aim * 100).toFixed(0)} → ${total.toFixed(0)} m, ${deg.toFixed(1)}°`);
  roundShot({ total, offline: total * Math.tan((deg * Math.PI) / 180), sim: true });
}
$('#rhSim').addEventListener('click', meterStart);
$('#gHome').addEventListener('click', () => goHome());
$('#gScore').addEventListener('click', () => { renderScore(); openSheet('#scoreSheet'); });
$('#gMusic').addEventListener('click', () => $('#rhMusic').click());
$('#gEnd').addEventListener('click', () => { if (confirm('End this round?')) $('#rhEnd').click(); });
$('#rhMusic').addEventListener('click', () => { unlockAudio(); S.music = S.music === 'off' ? 'on' : 'off'; saveSettings(); sndState = ''; renderRound(); });
for (const [id, s] of [['#rhAimL', -1], ['#rhAimR', 1]]) $(id).addEventListener('click', () => { if (!round || round.done) return; haptic(1); const st = round.putting ? 0.5 : 2, lim = round.putting ? 8 : 40; round.aimOff = Math.max(-lim, Math.min(lim, (round.aimOff || 0) + s * st)); saveRound(); renderRound(); });
$('#rhTap').addEventListener('click', meterTap);
$('#rhNext').addEventListener('click', roundNext);
$('#rhEnd').addEventListener('click', () => { const played = round && round.scores.length, arcade = round && round.mode === 'arcade'; endRound(!!played); toast(played ? 'Round ended. The holes you finished are saved in My Game.' : 'Round ended.'); if (arcade || !running) goHome(); });
$('#rhBag').innerHTML = CLUBS.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
$('#rhBag').addEventListener('change', (e) => { S.club = e.target.value; saveSettings(); renderClubs(); renderRound(); });
$('#rhClub').addEventListener('click', (e) => { S.club = e.currentTarget.dataset.club; saveSettings(); renderClubs(); renderRound(); });

// ---- course designer
function openDesigner() {
  $('#cdName').value = ''; $('#cdHoles').innerHTML = ''; for (let i = 0; i < 3; i++) addDesignHole();
  openSheet('#courseSheet');
}
function addDesignHole(v = {}) {
  const n = $('#cdHoles').children.length + 1; if (n > 18) return;
  const row = document.createElement('div'); row.className = 'cd-row';
  row.innerHTML = `<b>${n}</b>
    <select class="cdPar"><option value="3">Par 3</option><option value="4" selected>Par 4</option><option value="5">Par 5</option></select>
    <input class="cdLen" type="number" min="60" max="560" step="5" value="${v.len || 340}" aria-label="Length in metres"> m
    <select class="cdShape"><option value="straight">Straight</option><option value="left">Bends left</option><option value="right">Bends right</option></select>
    <select class="cdWater"><option value="none">No water</option><option value="front">Water in front of green</option><option value="side">Water beside green</option></select>
    <button class="btn ghost cdDel" aria-label="Remove hole">✕</button>`;
  $('#cdHoles').appendChild(row);
}
$('#cdAdd').addEventListener('click', () => addDesignHole());
$('#cdHoles').addEventListener('click', (e) => { if (e.target.classList.contains('cdDel')) { e.target.closest('.cd-row').remove(); [...$('#cdHoles').children].forEach((r, i) => { r.querySelector('b').textContent = i + 1; }); } });
$('#cdHoles').addEventListener('change', (e) => { if (e.target.classList.contains('cdPar')) { const len = e.target.closest('.cd-row').querySelector('.cdLen'); len.value = { 3: 150, 4: 350, 5: 480 }[e.target.value]; } });
$('#cdSave').addEventListener('click', () => {
  setTimeout(() => { if (customCourses.length) award('designer'); }, 200);
  const holes = [...$('#cdHoles').children].map((r) => ({ par: +r.querySelector('.cdPar').value, len: Math.max(60, Math.min(560, +r.querySelector('.cdLen').value || 300)), shape: r.querySelector('.cdShape').value, water: r.querySelector('.cdWater').value }));
  if (!holes.length) { toast('Add at least one hole'); return; }
  const name = ($('#cdName').value || 'My course').trim().slice(0, 30);
  customCourses.push({ id: 'c' + Date.now(), name: `${name} · ${holes.length} hole${holes.length > 1 ? 's' : ''}`, holes, custom: true });
  store.set('courses', customCourses); log(`course designed: ${name} (${holes.length} holes)`);
  closeSheets(); openPicker(pickMode); toast('Course saved. It is in the list now.');
});
function roundCardHtml() {
  const rounds = store.get('rounds', []).slice().reverse();
  const opts = allCourses().map((c) => `<option value="${c.id}">${c.name}${c.custom ? ' (mine)' : ''} — par ${c.holes.reduce((a, h) => a + h.par, 0)}</option>`).join('');
  let h = `<h3>Play a round</h3><div class="summary"><div class="sub" style="margin-bottom:8px">Pick a course, then choose how to play. <b>Arcade</b>: play on the phone like a game. Choose a club, tap for power and aim, and putt out yourself. <b>At my net</b>: hit real shots and the app flies each one down the hole; putting is worked out for you.</div>
    <div class="ctrl" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${round ? '<button class="btn primary" id="rcResume">Back to my round ›</button>' : ''}<button class="btn ${round ? '' : 'primary'}" id="rcPick">Choose a course ›</button></div></div>`;
  h += badgesHtml();
  h += '<h3>My rounds</h3>';
  if (!rounds.length) h += '<div class="empty">No rounds yet.</div>';
  for (const r of rounds.slice(0, 10)) {
    if (r.players) { const ts = r.players.map((q) => ({ n: q.name, t: q.scores.reduce((a, b) => a + (b || 0), 0) })).sort((a, b) => a.t - b.t); h += `<div class="sess"><div class="sess-h" style="cursor:default"><div><b>${r.name}</b> <span class="sub">${fmtDay(r.ts)} · ${r.players.length} players</span><div class="sub">${ts.map((x, i) => `${i === 0 && (ts[1].t !== x.t) ? '🏆 ' : ''}${x.n} ${x.t}`).join(' · ')}</div></div></div></div>`; continue; }
    const tot = r.scores.reduce((a, b) => a + b, 0), par = r.pars.reduce((a, b) => a + b, 0), rel = tot - par;
    h += `<div class="sess"><div class="sess-h" style="cursor:default"><div><b>${r.name}</b> <span class="sub">${fmtDay(r.ts)}${r.scores.length < r.holes ? ` · ${r.scores.length} of ${r.holes} holes` : ''}${r.sim ? ' · includes simulated shots' : ''}</span>
      <div class="sub">${r.scores.map((s, i) => `<span style="color:${s < r.pars[i] ? 'var(--cyan)' : s > r.pars[i] ? 'var(--orange)' : 'var(--text)'}">${s}</span>`).join(' ')}</div></div>
      <div class="go" style="font-family:var(--data)">${tot} <span class="sub">(${rel === 0 ? 'E' : rel > 0 ? '+' + rel : rel})</span></div></div></div>`;
  }
  return h;
}
$('#pageGame').addEventListener('click', (e) => {
  const id = e.target.id;
  if (id === 'rcPick') openPicker(round ? round.mode : 'arcade');
  else if (id === 'rcResume') { showSection('drive'); renderRound(); }
  else if (id === 'rcDesign') openDesigner();
});
renderRound();

// ---- choosing a course (one place for arcade and for rounds at the net)
let pickMode = 'arcade';
const THEME_SW = { swamp: 'linear-gradient(#7fb0d0 35%, #2d7fb0 35% 55%, #2b4a22 55%)', park: 'linear-gradient(#6fb0e8 45%, #3d8a34 45%)', links: 'linear-gradient(#6fb0e8 40%, #3f7fb5 40% 50%, #9a9450 50%)', desert: 'linear-gradient(#7fb6e6 40%, #b56f4d 40% 55%, #5a9a3a 55%)', forest: 'linear-gradient(#6fa8d8 30%, #1f4a20 30% 60%, #38782d 60%)' };
function openPicker(mode) {
  pickMode = mode === 'range' ? 'range' : 'arcade';
  $$('#pickMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === pickMode));
  $$('#pickPlayers button').forEach((b) => b.classList.toggle('on', +b.dataset.v === (+S.players || 1)));
  $('#pickNames').innerHTML = (+S.players || 1) > 1 ? S.names.slice(0, +S.players).map((n, i) => `<input data-pn="${i}" value="${String(n).replace(/"/g, '')}" maxlength="12" style="border-left-color:${PCSS[i]}" aria-label="Player ${i + 1} name">`).join('') : '';
  $('#pickNote').textContent = (pickMode === 'arcade' ? 'Play on the phone: pick a club, tap for power and aim, and putt out.' : 'Hit real shots into your net and the app plays them down the hole. It picks the club and moves on by itself, so you don’t need to touch the phone.') + (round ? ' Starting a new round ends the one in progress.' : '');
  $('#pickList').innerHTML = allCourses().map((c) => { const b = buildCourse(c); return `<div class="pick" data-course="${c.id}"><div class="sw" style="background:${THEME_SW[c.theme] || THEME_SW.park}"></div><div class="nm"><b>${c.name}${c.custom ? ' (mine)' : ''}</b><span>${b.holes.length} holes · par ${b.holes.reduce((a, h) => a + h.par, 0)} · ${fmtDist(b.holes.reduce((a, h) => a + h.len, 0))} ${dUnit()}</span></div>${c.custom ? `<button class="btn ghost del" data-del="${c.id}" aria-label="Delete this course">✕</button>` : ''}<span class="go">›</span></div>`; }).join('');
  openSheet('#pickSheet');
}
$('#pickMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openPicker(b.dataset.v); });
$('#pickList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { customCourses = customCourses.filter((x) => x.id !== del.dataset.del); store.set('courses', customCourses); openPicker(pickMode); toast('Course deleted'); return; }
  const row = e.target.closest('[data-course]'); if (!row) return;
  closeSheets(); unlockAudio('Round');
  const n = +S.players || 1; startRound(row.dataset.course, pickMode, n > 1 ? S.names.slice(0, n).map((x, i) => String(x).trim() || `Player ${i + 1}`) : []);
  if (pickMode === 'range' && !running) { startMotion(true); openSetup(); toast('Set up the camera, then hit your tee shot.', 5000); }
});
$('#pickPlayers').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.players = +b.dataset.v; saveSettings(); openPicker(pickMode); });
$('#pickNames').addEventListener('input', (e) => { const i = e.target.dataset.pn; if (i == null) return; S.names = S.names.slice(); S.names[+i] = e.target.value; saveSettings(); });
$('#pickDesign').addEventListener('click', () => { closeSheets(); openDesigner(); });

// ---- home: one way back to the front page from anywhere
function renderHome() {
  const r = $('#startResume'), c = round ? roundCourse() : null;
  r.hidden = !(round || running);
  if (round && c) r.textContent = `▶ Back to my round · hole ${round.i + 1} of ${c.holes.length}`; else if (running) r.textContent = '▶ Back to the driving range';
  $('#startCam').textContent = running ? '🏌️ Driving range' : '🏌️ Driving range · hit into my net';
}
function goHome() { closeSheets(); if ($('#setup').classList.contains('show')) closeSetup(); renderHome(); $('#start').classList.remove('hide'); }
$('#homeBtn').addEventListener('click', goHome);
$('#startResume').addEventListener('click', () => { $('#start').classList.add('hide'); showSection('drive'); if (round) renderRound(); });
$('#startNet').addEventListener('click', () => openPicker('range'));
$('#startSettings').addEventListener('click', () => { renderSettings(); openSheet('#settingsSheet'); });
// ---- scorecard beside the course in arcade (the range numbers mean nothing there)
function renderScore() {
  const arcade = !!round && round.mode === 'arcade'; document.body.dataset.play = arcade ? 'arcade' : round ? 'net' : 'none';
  const el = $('#scorePanel'); $('#gTop').hidden = !arcade || section !== 'drive'; if (!arcade) return;
  { const pl = round.scores.filter((x) => x != null), cc = roundCourse(), rel = cc ? pl.reduce((a, b) => a + b, 0) - cc.holes.slice(0, pl.length).reduce((a, h) => a + h.par, 0) : 0; $('#gScore').textContent = `📋 ${multi() ? 'Scores' : pl.length ? (rel === 0 ? 'Level' : rel > 0 ? '+' + rel : rel) : 'Score'}`; $('#gMusic').classList.toggle('off', S.music === 'off'); }
  const c = roundCourse(); if (!c) return;
  if (multi()) {
    const P = round.pl.map((q, i) => (i === round.cur ? { ...q, scores: round.scores } : q)), tot = (q) => q.scores.reduce((a, b) => a + (b || 0), 0);
    el.innerHTML = `<h4>${c.name}</h4><table><tr><th>Hole</th><th>Par</th>${P.map((q, i) => `<th><i style="background:${PCSS[i]}"></i>${q.name}</th>`).join('')}</tr>${c.holes.map((h, i) => `<tr class="${i === round.i ? 'now' : ''}"><td>${i + 1}</td><td>${h.par}</td>${P.map((q) => { const sc = q.scores[i]; return `<td class="${sc == null ? '' : sc < h.par ? 'u' : sc > h.par ? 'o' : ''}">${sc ?? ''}</td>`; }).join('')}</tr>`).join('')}<tr><th>Total</th><th></th>${P.map((q) => `<th style="color:#fff">${tot(q) || ''}</th>`).join('')}</tr></table>`;
    return;
  }
  const played = round.scores.filter((x) => x != null), tot = played.reduce((a, b) => a + b, 0), par = c.holes.slice(0, played.length).reduce((a, h) => a + h.par, 0), rel = tot - par;
  let run = 0;
  el.innerHTML = `<h4>${c.name}</h4><div class="tot">${played.length ? `${rel === 0 ? 'Level' : rel > 0 ? '+' + rel : rel} <small>${tot} shots · ${played.length} of ${c.holes.length} holes</small>` : '<small>Scorecard</small>'}</div>
    <table><tr><th>Hole</th><th>Length</th><th>Par</th><th>Score</th><th>Total</th></tr>${c.holes.map((h, i) => { const sc = round.scores[i]; if (sc != null) run += sc - h.par; return `<tr class="${i === round.i ? 'now' : ''}"><td>${i + 1}</td><td>${fmtDist(h.len)}</td><td>${h.par}</td><td class="${sc == null ? '' : sc < h.par ? 'u' : sc > h.par ? 'o' : ''}">${sc ?? (i === round.i ? '…' : '')}</td><td>${sc == null ? '' : run === 0 ? 'E' : run > 0 ? '+' + run : run}</td></tr>`; }).join('')}</table>`;
}

// ------------------------------------------------------------ start
$('#startCam').addEventListener('click', async () => {
  unlockAudio('Camera on');
  startMotion(true);
  showSection('drive');
  $('#start').classList.add('hide');
  openSetup();
});

$('#startGuide').addEventListener('click', () => openSheet('#helpSheet'));
$('#startInfo').addEventListener('click', () => { $('#start').classList.add('hide'); showSection('info'); });
$('#startArcade').addEventListener('click', () => openPicker('arcade'));
$('#startGame').addEventListener('click', () => { $('#start').classList.add('hide'); showSection('game'); });

renderClubs();
applyUnits();
$('#startNote').textContent = `Version ${VERSION} · works best in Safari on iPhone, in landscape, outdoors in daylight.`;
$('#brandVer').textContent = 'v' + VERSION;
if (NOT_SAFARI) { $('#startNote').innerHTML = `<b style="color:var(--orange)">You’re in ${NOT_SAFARI}. Please open this app in Safari</b> — it gives the camera 60 pictures a second, and your settings and saved swings are there. Version ${VERSION}.`; log(`opened in ${NOT_SAFARI}, not Safari`); }
showSection('drive');
// the range is drawn on a canvas: redraw once the Neon Grid fonts have loaded
try { document.fonts.ready.then(() => range.draw(performance.now() + 1e7)); } catch { /* old browser */ }
const lastShot = sessionShots().filter((s) => !s.miss).pop();
if (lastShot) showNumbers(lastShot);

// ---- new version check: an open Safari tab keeps running the old app, so ask the
// server which version is live and offer a one-tap update
let updateShown = false;
async function checkForUpdate() {
  if (updateShown) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const live = (await r.json()).version;
    if (!live || live === VERSION) return;
    updateShown = true;
    log(`new version ${live} is available (this is ${VERSION})`);
    const bar = document.createElement('button');
    bar.id = 'updateBar'; bar.textContent = `New version ${live} is ready — tap here to update`;
    bar.addEventListener('click', () => { location.href = location.pathname + '?v=' + encodeURIComponent(live); });
    document.body.appendChild(bar);
  } catch { /* offline: try again later */ }
}
checkForUpdate();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setInterval(() => { if (!document.hidden && eng.state !== 'armed') checkForUpdate(); }, 10 * 60 * 1000);

// expose for automated testing
window.__golf = { get v3() { return v3; }, get pending() { return pendingTurn; }, simShot, roundNext, get round() { return round; }, eng, recordShot, simulate, get shots() { return shots; }, startCamera, setBall, S, get mode() { return mode; }, get lastCapture() { return lastCapture; }, onEvent: null };
$('#testSoundBtn').addEventListener('click', testSound);
$('#cSound').addEventListener('click', testSound);
// switching voice commands on is a tap, which is when the iPhone lets us ask for the microphone
$('#voiceSeg').addEventListener('click', () => setTimeout(() => {
  if (S.voiceCmd !== 'on') return;
  if (!SR) { toast('This browser has no voice recognition. On iPhone it needs Safari.', 6000); S.voiceCmd = 'off'; saveSettings(); renderSettings(); return; }
  log('voice commands switched on'); toast('Listening now: say a club, for example “seven iron”.', 5000); listenFor(7000);
}, 50));
$('#voiceSel').addEventListener('change', (e) => { S.voiceName = e.target.value; saveSettings(); pickVoice(); unlockAudio(); say('This is how I sound. One hundred and fifty metres to the flag. Seven iron.', true); });
