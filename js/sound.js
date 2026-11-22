// Game sounds and a background tune, all made on the spot with Web Audio (no sound files to download).
let ctx = null, noise = null, master = null, musicGain = null, musicTimer = 0, ambTimer = 0, step = 0, nextT = 0;
export function initSound(audioCtx) {
  if (!audioCtx || ctx === audioCtx) return;
  ctx = audioCtx;
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(ctx.destination);
}
const ok = () => ctx && ctx.state === 'running';
function burst(t, dur, freq, q, gain, type = 'bandpass', out = master) {
  const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02); return f;
}
function tone(t, dur, f0, f1, gain, type = 'sine', out = master) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
}
export const sfx = {
  hit(power = 1) { if (!ok()) return; const t = ctx.currentTime; burst(t, 0.07, 3200, 0.8, 0.5 * power); tone(t, 0.1, 220, 70, 0.6 * power); },
  putt() { if (!ok()) return; const t = ctx.currentTime; tone(t, 0.05, 900, 500, 0.25); burst(t, 0.03, 2500, 1, 0.15); },
  thud() { if (!ok()) return; const t = ctx.currentTime; burst(t, 0.12, 300, 0.7, 0.4, 'lowpass'); tone(t, 0.1, 120, 50, 0.3); },
  sand() { if (!ok()) return; burst(ctx.currentTime, 0.28, 1800, 0.5, 0.3); },
  splash() { if (!ok()) return; const t = ctx.currentTime; const f = burst(t, 0.7, 900, 0.6, 0.55); f.frequency.exponentialRampToValueAtTime(3500, t + 0.5); tone(t, 0.25, 180, 60, 0.4); },
  cup() { if (!ok()) return; const t = ctx.currentTime; for (const [d, f] of [[0, 1100], [0.07, 800], [0.13, 950], [0.2, 700]]) tone(t + d, 0.05, f, f * 0.8, 0.22, 'triangle'); },
  clap(size = 1) { // many small claps make applause; size 2 adds a cheer
    if (!ok()) return; const t = ctx.currentTime, len = 1.4 + size * 1.1, n = Math.round(90 * len * size);
    for (let i = 0; i < n; i++) { const u = Math.random(), at = t + u * len, env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6; burst(at, 0.018, 900 + Math.random() * 2200, 1.2, 0.07 * env * (0.6 + Math.random() * 0.6)); }
    if (size >= 2) for (let i = 0; i < 5; i++) tone(t + 0.05 + i * 0.03, 0.9, 300 + i * 70, 520 + i * 90, 0.035, 'sawtooth');
  },
  groan() { if (!ok()) return; const t = ctx.currentTime; for (const f of [190, 240, 150]) tone(t + Math.random() * 0.05, 0.75, f, f * 0.72, 0.05, 'sawtooth'); },
  snap() { if (!ok()) return; const t = ctx.currentTime; tone(t, 0.45, 85, 45, 0.5, 'sawtooth'); burst(t + 0.42, 0.06, 1500, 1, 0.6); tone(t + 0.42, 0.08, 400, 120, 0.4, 'square'); },
  hooves() { if (!ok()) return; const t = ctx.currentTime; for (let i = 0; i < 8; i++) burst(t + i * 0.09, 0.04, 260, 1, 0.16 * (1 - i / 9), 'lowpass'); },
  turn() { if (!ok()) return; const t = ctx.currentTime; tone(t, 0.09, 660, 660, 0.18, 'triangle'); tone(t + 0.1, 0.14, 880, 880, 0.18, 'triangle'); },
};
// birdsong now and then
export function ambience(on) {
  clearTimeout(ambTimer); if (!on) return;
  const chirp = () => {
    if (ok()) { const t = ctx.currentTime, base = 2200 + Math.random() * 1800, n = 2 + ((Math.random() * 4) | 0); for (let i = 0; i < n; i++) tone(t + i * 0.11, 0.07, base * (1 + 0.15 * (i % 2)), base * 1.35, 0.035); }
    ambTimer = setTimeout(chirp, 1800 + Math.random() * 5200);
  };
  ambTimer = setTimeout(chirp, 1500);
}
// a gentle looping tune: four chords, a soft pad and a plucked pattern
const CH = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]], PAT = [0, 1, 2, 1, 0, 2, 1, 2];
function schedule() {
  if (!ok()) return;
  const beat = 60 / 92 / 2;
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
  while (nextT < ctx.currentTime + 0.4) {
    const ch = CH[Math.floor(step / 8) % 4], k = step % 8;
    if (k === 0) { for (const f of ch) tone(nextT, beat * 8.2, f / 2, f / 2, 0.05, 'sine', musicGain); tone(nextT, beat * 3, ch[0] / 4, ch[0] / 4, 0.12, 'triangle', musicGain); }
    tone(nextT, beat * 1.6, ch[PAT[k]] * (k > 5 ? 2 : 1), ch[PAT[k]] * (k > 5 ? 2 : 1), 0.07, 'triangle', musicGain);
    if (k % 4 === 2) burst(nextT, 0.03, 6000, 1, 0.03, 'highpass', musicGain);
    nextT += beat; step++;
  }
}
export function music(on) {
  clearInterval(musicTimer); if (!ctx) return;
  musicGain.gain.cancelScheduledValues(ctx.currentTime); musicGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, ctx.currentTime + 0.6);
  if (on) { nextT = 0; musicTimer = setInterval(schedule, 120); schedule(); }
}
