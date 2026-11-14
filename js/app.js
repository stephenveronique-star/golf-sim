import { simulate, CLUBS, clubById, estimateSpin, smashFactor, MPH, YARD, BALL } from './physics.js';
import { RangeView } from './range.js';

const VERSION = '1.2.3';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ------------------------------------------------------------ storage
const store = {
  get(k, d) { try { const v = localStorage.getItem('golfsim.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('golfsim.' + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};
const DEFAULTS = {
  dist: 'm', speed: 'mph', altitude: 1750, tempC: 22, firmness: '1', voice: 'on',
  hfov: 67, procW: '960', threshold: 14, speedCal: 0, aim: 0, camId: '', club: '7I', autoFind: 'on', debug: 'off',
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
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* none */ }
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(''); speechSynthesis.speak(u); } } catch { /* none */ }
}
function beep(freq = 880, dur = 0.12, vol = 0.15) {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(vol, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch { /* ignore */ }
}
function say(text) {
  if (S.voice !== 'on' || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch { /* ignore */ }
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
      if (s.miss) { h += `<div class="row miss"><div class="club">${s.club}</div><div style="grid-column: span 3">not read</div><div class="x" data-del="${s.id}">✕</div></div>`; continue; }
      const side = Math.abs(+fmtDist(s.offline, 0)) < 1 ? '—' : `${Math.abs(+fmtDist(s.offline, 0))}${s.offline > 0 ? 'R' : 'L'}`;
      h += `<div class="row"><div class="club">${s.club}${s.demo ? '*' : ''}</div><div>${fmtDist(s.carry)}</div><div>${fmtDist(s.total)}</div><div>${side}</div><div class="x" data-del="${s.id}">✕</div></div>`;
    }
    if (list.some((s) => s.demo)) h += '<div class="empty">* demo shot</div>';
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
  $('#clubGrid').innerHTML = CLUBS.map((c) => `<button data-club="${c.id}" class="${c.id === S.club ? 'on' : ''}">${c.id}<small>${c.name}</small></button>`).join('');
}
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

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let setBallSeq = 0;
const pending = new Map();
function sendConfig() { worker.postMessage({ cmd: 'config', opts: { hfovDeg: +S.hfov, threshold: +S.threshold, procW: +S.procW, autoFind: S.autoFind !== 'off' } }); }
sendConfig();

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'status') { Object.assign(eng, m); updateReady(); }
  else if (m.type === 'event') onEngineEvent(m.ev);
  else if (m.type === 'setBall') { const r = pending.get(m.id); pending.delete(m.id); if (r) r(m.ball); }
  else if (m.type === 'buf') freeBufs.push(m.buf);
  else if (m.type === 'error') { console.error('worker:', m.message); log(`ERROR worker: ${m.message}`); }
  else if (m.type === 'debug') { const r = pendingDebug.get(m.id); pendingDebug.delete(m.id); if (r) r(m); }
};
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
  if (ev.type === 'armed') {
    eng.state = 'armed'; eng.ball = ev.ball;
    log(`READY (${ev.how}) ball at ${ev.ball.x.toFixed(0)},${ev.ball.y.toFixed(0)} · ${ev.ball.d.toFixed(1)} px`);
    setStatus('ready', 'Ready — hit away');
    $('#setupMsg').textContent = ev.how === 'tap' ? 'Ready — hit away' : 'Found the ball — ready, hit away';
    updateReady();
    beep(880, 0.1); setTimeout(() => beep(1320, 0.12), 130);
    setTimeout(() => say('Ready'), 350);
    if (firstArm && $('#setup').classList.contains('show')) { firstArm = false; setTimeout(() => closeSetup(), 1800); }
  } else if (ev.type === 'shot') {
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    const L = ev.launch;
    log(`SHOT speed ${L.speed.toFixed(1)} m/s · launch ${L.launch.toFixed(1)}° · dir ${L.direction.toFixed(1)}° · seen in ${L.points} frames · ${ev.fps.toFixed(0)} fps · ${droppedFrames(ev)} dropped frames · moving bits per frame [${(ev.moving || []).join(',')}]`);
    if ($('#setup').classList.contains('show')) closeSetup(); // show the result
    if (ev.launch.speed >= 3) recordShot(ev.launch);
  } else if (ev.type === 'missed') {
    lastCapture = ev; eng.state = 'waiting'; updateReady();
    setStatus('busy', 'Tee up next ball');
    say('Missed that one');
    if ($('#setup').classList.contains('show')) closeSetup();
    log(`MISSED ball left the tee but wasn't found in flight · ${droppedFrames(ev)} dropped frames · moving bits per frame [${(ev.moving || []).join(',')}]`);
    shots.push({ id: Date.now(), ts: Date.now(), session, club: S.club, miss: true }); saveShots(); renderList();
    toast('Ball was struck but not seen in flight. Tap “Replay last” to see what the camera saw.', 5000);
    beep(300, 0.25);
  }
}

function camConstraints(fps, devId) {
  const v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps } };
  const id = devId || S.camId;
  if (id) v.deviceId = { exact: id }; else v.facingMode = { ideal: 'environment' };
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
  if (!S.camId && /triple|dual/i.test(stream.getVideoTracks()[0].label || '')) {
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
  const track = stream.getVideoTracks()[0];
  try { const st = track.getSettings(); log(`camera started ${st.width}×${st.height} @ ${st.frameRate} fps (${track.label || 'camera'})`); } catch { /* ignore */ }
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const maxFps = caps.frameRate?.max || 60;
    const want = maxFps >= 119 ? 120 : Math.min(60, maxFps);
    await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: want, min: Math.min(30, want) } });
  } catch { /* keep what we have */ }
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay */ }
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
function startVideoPath() {
  mode = 'video'; tsMode = null; lastTs = -1;
  const step = (now, meta) => {
    if (!running || mode !== 'video') return;
    try { grabFrame(now, meta); } catch (e) { console.error(e); }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step); else requestAnimationFrame((n) => step(n, null));
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step); else requestAnimationFrame((n) => step(n, null));
}
function grabFrame(now, meta) {
  let t;
  if (meta) {
    if (tsMode == null) tsMode = meta.captureTime ? 'capture' : (meta.mediaTime > 0 ? 'media' : 'now');
    t = tsMode === 'capture' ? meta.captureTime / 1000 : tsMode === 'media' ? meta.mediaTime : now / 1000;
  } else t = now / 1000;
  if (t === lastTs || !video.videoWidth) return;
  lastTs = t;
  const t0 = performance.now();
  const vw = video.videoWidth, vh = video.videoHeight;
  const W = Math.min(+S.procW, vw), H = Math.round((vh * W) / vw);
  if (grab.width !== W || grab.height !== H) { grab.width = W; grab.height = H; freeBufs.length = 0; }
  gctx.drawImage(video, 0, 0, W, H);
  const d = gctx.getImageData(0, 0, W, H).data;
  let buf = freeBufs.pop();
  if (!buf || buf.byteLength !== W * H) buf = new ArrayBuffer(W * H);
  const g = new Uint8Array(buf);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = ((d[i] * 2 + d[i + 1] + d[i + 2] * 2) * 51) >> 8;
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
  ctx.drawImage(video, 0, 0, pipC.width, pipC.height);
  if (eng.ball && eng.w) {
    const k = pipC.width / eng.w;
    ctx.strokeStyle = eng.state === 'armed' ? '#7ee36b' : '#ffd34d'; ctx.lineWidth = 2;
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
    ctx.strokeStyle = eng.state === 'armed' ? '#7ee36b' : '#ffd34d'; ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.arc(bx, by, Math.max(10 * dpr, eng.ball.d * k * 1.2), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(126,227,107,0.5)'; ctx.lineWidth = 1 * dpr;
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
  if (tapMark && eng.w) {
    const age = performance.now() - tapMark.t;
    if (age > 1500) tapMark = null;
    else {
      const k = fit.w / eng.w;
      ctx.globalAlpha = 1 - age / 1500;
      ctx.strokeStyle = tapMark.ok ? '#7ee36b' : '#ff6b5b'; ctx.lineWidth = 2 * dpr;
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
  flashTap(px, py, true);
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
  const st = !running ? 'off' : portrait ? 'turn' : eng.state === 'armed' ? 'ready' : eng.state === 'waiting' ? 'tee' : 'look';
  document.body.dataset.ready = st;
  const el = $('#readyLight');
  el.querySelector('b').textContent = st === 'ready' ? 'READY' : st === 'tee' ? 'TEE UP' : st === 'look' ? 'PUT A BALL DOWN' : st === 'turn' ? 'TURN PHONE SIDEWAYS' : '';
  el.querySelector('span').textContent = st === 'ready' ? 'Hit away' : st === 'tee' ? 'Same spot as before' : st === 'look' ? 'I’ll find it — or tap it on the camera screen' : st === 'turn' ? 'The camera only works in landscape' : '';
  if ($('#setup').classList.contains('show') && st !== lastReadySt) {
    $('#setupMsg').textContent = st === 'ready' ? 'Ready — hit away' : st === 'tee' ? 'Tee up the next ball in the same spot' : st === 'turn' ? 'Turn the phone sideways (landscape) — the camera only works that way' : 'Put a ball down and step back — I’ll find it (or tap it)';
  }
  lastReadySt = st;
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
    const dist = (f * BALL.diameter) / eng.ball.d;
    cb.textContent = `Ball ${eng.ball.d.toFixed(0)} px · about ${dist.toFixed(1)} m away`;
    cb.className = 'chip ' + (eng.ball.d >= 7 && eng.ball.d <= 24 ? 'ok' : 'warn');
  } else { cb.textContent = 'Ball: tap it'; cb.className = 'chip'; }
}

// Level (device tilt) — magnitude only
let motionOn = false;
$('#cLevel').addEventListener('click', async () => {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') { toast('Motion access refused'); return; }
    }
  } catch { /* desktop */ }
  if (motionOn) return; motionOn = true;
  let last = 0;
  window.addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    const now = performance.now(); if (now - last < 200) return; last = now;
    const el = $('#cLevel');
    if (Math.abs(g.x) < Math.abs(g.y)) { el.textContent = 'Turn the phone to landscape'; el.className = 'chip warn'; return; }
    const roll = (Math.atan2(Math.abs(g.y), Math.abs(g.x)) * 180) / Math.PI;
    el.textContent = `Tilt ${roll.toFixed(1)}° ${roll < 1 ? '✓ level' : ''}`;
    el.className = 'chip ' + (roll < 1 ? 'ok' : roll < 2.5 ? 'warn' : 'bad');
  });
});

function openSetup() {
  $('#setup').classList.add('show');
  lastReadySt = null; updateReady();
  $('#setupMsg').textContent = eng.state === 'armed' ? 'Ready — hit away (tap the ball again to re-mark it)' : 'Put a ball down and step back — I’ll find it (or tap it)';
  if (!running) startCamera();
}
function closeSetup() { $('#setup').classList.remove('show'); }
$('#setupDone').addEventListener('click', closeSetup);
$('#cameraBtn').addEventListener('click', () => { unlockAudio(); openSetup(); });

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
  ctx.strokeStyle = '#7ee36b';
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
  L.push(`state ${st.state || 'idle'} · ball ${st.ball ? `${st.ball.x.toFixed(0)},${st.ball.y.toFixed(0)} ${st.ball.d.toFixed(1)}px` : 'none'} · possible balls seen ${d && d.cands ? d.cands.length : '?'}`);
  L.push(`settings: club ${S.club} · ${S.dist}/${S.speed} · alt ${S.altitude} m · ${S.tempC}°C · fov ${S.hfov}° · width ${S.procW} · sensitivity ${S.threshold} · auto-find ${S.autoFind} · speed adj ${S.speedCal}% · aim ${S.aim}°`);
  L.push(`screen ${innerWidth}×${innerHeight} · ${screen.orientation ? screen.orientation.type : ''} · ${navigator.userAgent}`);
  const ss = sessionShots().slice(-8);
  if (ss.length) {
    L.push('last shots:');
    for (const s of ss) L.push(s.miss ? `  ${s.club} not read` : `  ${s.club}${s.demo ? ' (demo)' : ''} ${(s.speed).toFixed(1)} m/s ${s.launch.toFixed(1)}° dir ${s.dir.toFixed(1)}° → carry ${s.carry.toFixed(0)} m`);
  }
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
    if (b) { ctx.strokeStyle = '#7ee36b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(b.x * k, b.y * k, Math.max(14, b.d * k * 1.4), 0, Math.PI * 2); ctx.stroke(); }
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
    ctx.strokeStyle = '#7ee36b'; ctx.lineWidth = 2;
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

// ------------------------------------------------------------ start
$('#startCam').addEventListener('click', async () => {
  unlockAudio();
  $('#start').classList.add('hide');
  openSetup();
});

$('#startGuide').addEventListener('click', () => openSheet('#helpSheet'));

renderClubs();
applyUnits();
const lastShot = sessionShots().filter((s) => !s.miss).pop();
if (lastShot) showNumbers(lastShot);

// expose for automated testing
window.__golf = { eng, recordShot, simulate, get shots() { return shots; }, startCamera, setBall, S, get mode() { return mode; }, get lastCapture() { return lastCapture; }, onEvent: null };
