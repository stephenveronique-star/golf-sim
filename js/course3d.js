// 3D view of a golf hole, seen from behind the ball. Built with three.js (loaded only when a round starts).
// World: x runs from tee to green, z is sideways (+ = right of play), y is up. All in metres.
import { nearest, pinOf } from './round.js';

let T = null;
export async function loadThree() { if (!T) T = await import('./vendor/three.min.js'); return T; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => t * t * (3 - 2 * t);
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// each kind of course has its own colours and amount of trees
const THEMES = {
  park: { deep: '#234f20', rough: ['#27561f', '#2b5d22', '#2f6525'], cut: '#3d802e', land: 0x2f6a2b, trees: 380, pine: 0.34, thin: 0.55, hills: [0x9db7cf, 0x7f9f9c] },
  links: { deep: '#8b8546', rough: ['#8f8a49', '#8d904a', '#869647'], cut: '#5c9a3b', land: 0x8b8546, trees: 26, pine: 0.15, thin: 0.9, hills: [0x4f8fc4, 0x3f7fb5] },
  desert: { deep: '#b88758', rough: ['#bb8c5c', '#bd9160', '#a99a5c'], cut: '#5a9a3a', land: 0xb88758, trees: 60, pine: 0.1, thin: 0.8, hills: [0xd0a98c, 0xb56f4d] },
  forest: { deep: '#1a401e', rough: ['#1e4720', '#235023', '#295a26'], cut: '#38782d', land: 0x1f4a20, trees: 560, pine: 0.8, thin: 0.3, hills: [0x8fb0c4, 0x5f8a78] },
};
const SUN = { x: -0.45, y: 0.62, z: -0.64 }; // direction towards the sun

// ---- the golfer: a simple jointed figure. Local frame: +x = towards the target, +z = the way the golfer faces (towards the ball).
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
// swing key moments: t, hands, club head (relative to hands), shoulder turn (degrees), hip slide
const KEYS = [
  { t: 0.0, h: [0.02, 0.86, 0.40], c: [-0.02, -0.84, 0.44], turn: 0, hip: 0 },
  { t: 0.22, h: [-0.42, 1.0, 0.36], c: [-0.85, 0.05, 0.3], turn: -35, hip: -0.02 },
  { t: 0.45, h: [-0.34, 1.72, 0.02], c: [0.78, 0.38, -0.3], turn: -85, hip: -0.04 },
  { t: 0.56, h: [-0.3, 1.2, 0.3], c: [-0.5, 0.75, 0.1], turn: -30, hip: 0.03 },
  { t: 0.62, h: [0.06, 0.86, 0.40], c: [-0.06, -0.84, 0.44], turn: 15, hip: 0.06 },
  { t: 0.72, h: [0.5, 1.05, 0.34], c: [0.85, 0.25, 0.2], turn: 55, hip: 0.08 },
  { t: 1.0, h: [0.26, 1.7, -0.06], c: [-0.6, -0.25, -0.62], turn: 100, hip: 0.1 },
];
function swingAt(t) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = ease(clamp((t - a.t) / (b.t - a.t), 0, 1));
  const c = lerp3(a.c, b.c, k), L = Math.hypot(...c) || 1;
  return { h: lerp3(a.h, b.h, k), c: c.map((v) => (v / L) * 0.95), turn: a.turn + (b.turn - a.turn) * k, hip: a.hip + (b.hip - a.hip) * k };
}
function buildGolfer() {
  const g = new T.Group(), mat = (c) => new T.MeshLambertMaterial({ color: c });
  const shirt = mat(0xff6a1f), trouser = mat(0x1b2740), skin = mat(0xd9a57e), white = mat(0xf5f5f5), steel = mat(0xcfd6dc), dark = mat(0x16181c);
  const cyl = new T.CylinderGeometry(1, 1, 1, 10), sph = new T.SphereGeometry(1, 14, 10), parts = {};
  const limb = (name, m, r) => { const o = new T.Mesh(cyl, m); o.userData.r = r; g.add(o); parts[name] = o; };
  const ball = (name, m, r) => { const o = new T.Mesh(sph, m); o.scale.setScalar(r); g.add(o); parts[name] = o; };
  limb('legL', trouser, 0.075); limb('legR', trouser, 0.075); limb('torso', shirt, 0.165); limb('armL', shirt, 0.045); limb('armR', shirt, 0.045); limb('foreL', skin, 0.038); limb('foreR', skin, 0.038); limb('club', steel, 0.011); limb('neck', skin, 0.05);
  ball('hips', trouser, 0.17); ball('head', skin, 0.105); ball('cap', white, 0.11); ball('shL', shirt, 0.075); ball('shR', shirt, 0.075); ball('hands', white, 0.055); ball('footL', dark, 0.07); ball('footR', dark, 0.07); ball('clubhead', dark, 0.05);
  parts.footL.scale.set(0.07, 0.05, 0.13); parts.footR.scale.set(0.07, 0.05, 0.13); parts.clubhead.scale.set(0.035, 0.03, 0.06); parts.cap.scale.set(0.112, 0.07, 0.125);
  g.userData.parts = parts; return g;
}
const UP = { x: 0, y: 1, z: 0 };
function setLimb(o, a, b) {
  const d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length() || 0.001;
  o.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); o.scale.set(o.userData.r, L, o.userData.r);
  o.quaternion.setFromUnitVectors(new T.Vector3(UP.x, UP.y, UP.z), d.divideScalar(L));
}
export function poseGolfer(g, t) {
  const P = g.userData.parts, s = swingAt(t), hx = s.hip;
  const hip = [hx, 0.95, 0], neck = [hx * 0.6, 1.4, 0.25], a = (s.turn * Math.PI) / 180, sx = 0.21 * Math.cos(a), sz = -0.21 * Math.sin(a);
  const shL = [neck[0] + sx, neck[1] - 0.03, neck[2] + sz], shR = [neck[0] - sx, neck[1] - 0.03, neck[2] - sz], head = [neck[0], 1.58, 0.33];
  setLimb(P.legL, [hx + 0.1, 0.93, 0], [0.22, 0.05, 0]); setLimb(P.legR, [hx - 0.1, 0.93, 0], [-0.22, 0.05, 0]);
  P.footL.position.set(0.22, 0.04, 0.05); P.footR.position.set(-0.22, 0.04, 0.05); P.hips.position.set(...hip); P.hips.scale.set(0.19, 0.14, 0.15);
  setLimb(P.torso, hip, neck); P.torso.scale.x = 0.2; setLimb(P.neck, neck, head);
  P.head.position.set(...head); P.cap.position.set(head[0], head[1] + 0.06, head[2] + 0.02); P.shL.position.set(...shL); P.shR.position.set(...shR);
  const elbow = (sh, bend) => { const m = lerp3(sh, s.h, 0.5); return [m[0] - bend * 0.12, m[1] - 0.06, m[2] - 0.04 + Math.abs(bend) * 0.05]; };
  const eL = elbow(shL, t > 0.75 ? 1 : 0.15), eR = elbow(shR, t > 0.2 && t < 0.6 ? -1 : -0.15);
  setLimb(P.armL, shL, eL); setLimb(P.foreL, eL, s.h); setLimb(P.armR, shR, eR); setLimb(P.foreR, eR, s.h);
  P.hands.position.set(...s.h);
  const ch = [s.h[0] + s.c[0], Math.max(0.03, s.h[1] + s.c[1]), s.h[2] + s.c[2]]; setLimb(P.club, s.h, ch); P.clubhead.position.set(...ch);
}

export class Course3D {
  constructor(canvas, tag) {
    this.cv = canvas; this.tag = tag;
    this.r = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new T.Scene();
    this.scene.fog = new T.Fog(0xcfe2f1, 220, 1500);
    this.cam = new T.PerspectiveCamera(52, 1, 0.3, 5000);
    this.scene.add(new T.HemisphereLight(0xe6f1ff, 0x55773f, 1.25));
    const sun = new T.DirectionalLight(0xfff0d2, 1.9); sun.position.set(SUN.x, SUN.y, SUN.z); this.scene.add(sun);
    this.backdrop();
    this.props();
    this.hole = null; this.group = null; this.anim = null; this.raf = 0; this.last = 0; this.on = false;
    this.camP = new T.Vector3(-8, 3, 0); this.camL = new T.Vector3(40, 1, 0);
    this.loop = this.loop.bind(this);
  }

  // ---- sky, clouds, far hills, the land beyond the hole
  backdrop() {
    const sky = new T.Mesh(new T.SphereGeometry(3500, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: new T.Vector3(SUN.x, SUN.y, SUN.z).normalize() } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 d; uniform vec3 sun;
        void main(){ float h = max(d.y, 0.0);
          vec3 c = mix(vec3(0.81,0.89,0.95), vec3(0.20,0.46,0.82), pow(h, 0.5));
          float s = max(dot(normalize(d), sun), 0.0);
          c += vec3(1.0,0.9,0.7) * (pow(s, 350.0) * 1.2 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.renderOrder = -10; this.scene.add(sky); this.sky = sky;
    // clouds
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'), rnd = rng(7);
    for (let i = 0; i < 26; i++) {
      const px = 40 + rnd() * 176, py = 50 + rnd() * 34, pr = 16 + rnd() * 30, g = x.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    }
    const ct = new T.CanvasTexture(c); ct.colorSpace = T.SRGBColorSpace;
    this.clouds = new T.Group();
    for (let i = 0; i < 16; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: ct, fog: false, depthWrite: false, transparent: true, opacity: 0.75 + rnd() * 0.2 }));
      const a = rnd() * Math.PI * 2, r = 1300 + rnd() * 1500, s = 500 + rnd() * 700;
      sp.position.set(Math.cos(a) * r, 330 + rnd() * 420, Math.sin(a) * r); sp.scale.set(s, s * 0.42, 1); this.clouds.add(sp);
    }
    this.scene.add(this.clouds);
    // two rings of hazy hills
    const ring = (rad, hMin, hVar, col, seed) => {
      const n = 120, pos = [], idx = [], rn = rng(seed), ph = [rn() * 6, rn() * 6, rn() * 6];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, h = hMin + hVar * (0.5 + 0.5 * Math.sin(a * 3 + ph[0])) * (0.6 + 0.4 * Math.sin(a * 7 + ph[1])) + hVar * 0.15 * Math.sin(a * 19 + ph[2]);
        pos.push(Math.cos(a) * rad, -8, Math.sin(a) * rad, Math.cos(a) * rad, Math.max(6, h), Math.sin(a) * rad);
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: col, fog: false, side: T.DoubleSide })); this.scene.add(m); return m;
    };
    this.hills = [ring(2600, 70, 260, 0x9db7cf, 3), ring(1750, 35, 150, 0x7f9f9c, 11)];
    const land = new T.Mesh(new T.PlaneGeometry(9000, 9000), new T.MeshLambertMaterial({ color: 0x2f6a2b }));
    land.rotation.x = -Math.PI / 2; land.position.y = -0.9; this.scene.add(land); this.land = land;
  }

  // ---- things that are the same on every hole: ball, trail, flag, landing ring
  props() {
    this.ball = new T.Mesh(new T.SphereGeometry(0.05, 20, 14), new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 }));
    this.scene.add(this.ball);
    const sh = new T.Mesh(new T.CircleGeometry(0.09, 20), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; this.scene.add(sh); this.shadow = sh;
    // trail ribbon (always faces the camera)
    this.trailN = 90; this.trailPts = [];
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(new Float32Array(this.trailN * 2 * 3), 3));
    const ti = []; for (let i = 0; i < this.trailN - 1; i++) { const k = i * 2; ti.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } tg.setIndex(ti);
    this.trail = new T.Mesh(tg, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false, fog: false }));
    this.trail.frustumCulled = false; this.trail.visible = false; this.scene.add(this.trail);
    // flag
    const f = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 2.3, 8), new T.MeshLambertMaterial({ color: 0xf4f4f4 })); pole.position.y = 1.15; f.add(pole);
    this.cloth = new T.Mesh(new T.PlaneGeometry(0.8, 0.46, 10, 1), new T.MeshLambertMaterial({ color: 0xff5a1f, side: T.DoubleSide, emissive: 0x551800 }));
    this.cloth.position.set(0.4, 2.05, 0); f.add(this.cloth); this.clothBase = this.cloth.geometry.attributes.position.array.slice();
    this.scene.add(f); this.flag = f;
    const cup = new T.Mesh(new T.CircleGeometry(0.1, 20), new T.MeshBasicMaterial({ color: 0x050505 })); cup.rotation.x = -Math.PI / 2; this.scene.add(cup); this.cup = cup;
    // landing ring: where the chosen club normally finishes
    const ring = new T.Mesh(new T.RingGeometry(0.86, 1, 48), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: T.DoubleSide, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; this.scene.add(ring); this.ring = ring;
    this.golfer = buildGolfer(); poseGolfer(this.golfer, 0); this.golfer.visible = false; this.scene.add(this.golfer);
  }

  // ---- ground height (only for looks: play is worked out on the flat)
  hAt(x, z) {
    const h = this.hole; if (!h) return 0;
    const n = nearest(h.path, { x, z }), pin = pinOf(h), dp = Math.hypot(x - pin.x, z - pin.z);
    const roll = 1.5 * Math.sin(x * 0.013 + this.ph) * Math.cos(z * 0.019 + 1.3) + 0.7 * Math.sin(x * 0.037 + z * 0.031 + this.ph * 2);
    let y = roll * (0.3 + 0.7 * smooth(h.fw / 2, 55, n.d));
    y += 5.5 * smooth(38, 95, n.d) * (0.7 + 0.3 * Math.sin(x * 0.021 + this.ph * 3)); // banks that frame the hole
    const g = 1 - smooth(h.greenR, h.greenR + 16, dp); const sl = this.slope || { a: 0, g: 0 }; y = y * (1 - g) + (0.5 - (sl.g / 100) * ((x - pin.x) * Math.cos(sl.a) + (z - pin.z) * Math.sin(sl.a))) * g; // green: smooth, slightly raised, tilted
    const t = 1 - smooth(4, 12, Math.hypot(x - h.path[0].x, z - h.path[0].z)); y = y * (1 - t) + 0.35 * t; // tee
    for (const z0 of h.haz) {
      const d = Math.hypot(x - z0.x, z - z0.z);
      if (z0.type === 'bunker') y -= 0.75 * (1 - smooth(z0.r * 0.35, z0.r, d));
      else { const k = 1 - smooth(z0.r * 0.75, z0.r + 3, d); y = y * (1 - k) + -1.4 * k; }
    }
    return y;
  }

  // ---- build one hole
  setHole(hole, seed = 1, theme = 'park', slope = { a: 0, g: 0 }) {
    this.slope = slope;
    const TH = THEMES[theme] || THEMES.park;
    this.land.material.color.set(TH.land); this.hills.forEach((m, i) => m.material.color.set(TH.hills[i]));
    if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); }
    this.hole = hole; this.ph = (seed * 1.7) % 6; this.anim = null; this.trail.visible = false;
    const G = (this.group = new T.Group()); this.scene.add(G);
    const xs = hole.path.map((p) => p.x), zs = hole.path.map((p) => p.z), M = 130;
    const x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, z0 = Math.min(...zs) - M, z1 = Math.max(...zs) + M, W = x1 - x0, D = z1 - z0;
    const rnd = rng(seed * 977 + 13), pin = pinOf(hole), tee = hole.path[0];
    // trees first (their shadows are painted onto the grass)
    const trees = [];
    for (let i = 0; i < 3200 && trees.length < TH.trees; i++) {
      const x = x0 + rnd() * W, z = z0 + rnd() * D, n = nearest(hole.path, { x, z });
      if (n.d < hole.fw / 2 + 17 || Math.hypot(x - pin.x, z - pin.z) < hole.greenR + 20 || Math.hypot(x - tee.x, z - tee.z) < 22) continue;
      if (n.d < 55 && rnd() < TH.thin) continue; // thinner near the fairway, thick beyond
      if (hole.haz.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + 7)) continue;
      trees.push({ x, z, s: 0.75 + rnd() * 0.8, pine: rnd() < TH.pine, c: rnd() });
    }
    // --- paint the grass
    const ppm = Math.min(4, 2048 / Math.max(W, D)), cv = document.createElement('canvas'); cv.width = Math.round(W * ppm); cv.height = Math.round(D * ppm);
    const c = cv.getContext('2d'), X = (x) => (x - x0) * ppm, Y = (z) => (z - z0) * ppm;
    const line = (ctx) => { ctx.beginPath(); hole.path.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)))); };
    c.fillStyle = TH.deep; c.fillRect(0, 0, cv.width, cv.height);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [w, col] of [[104, TH.rough[0]], [96, TH.rough[1]], [88, TH.rough[2]], [hole.fw + 9, TH.cut]]) { c.strokeStyle = col; c.lineWidth = w * ppm; line(c); c.stroke(); }
    for (let i = 0; i < 9000; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,30,0,0.10)' : 'rgba(190,220,120,0.07)'; const s = (0.6 + rnd() * 2.2) * ppm; c.fillRect(rnd() * cv.width, rnd() * cv.height, s, s); }
    const layer = (draw, band, a) => { // a mown area with light/dark stripes
      const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const k = o.getContext('2d'); k.lineCap = 'round'; k.lineJoin = 'round';
      draw(k); k.globalCompositeOperation = 'source-atop';
      k.save(); k.translate(cv.width / 2, cv.height / 2); k.rotate(0.6);
      const R = Math.hypot(cv.width, cv.height), b = band * ppm;
      for (let i = -R; i < R; i += b * 2) { k.fillStyle = `rgba(255,255,220,${a})`; k.fillRect(i, -R, b, R * 2); k.fillStyle = `rgba(0,25,0,${a})`; k.fillRect(-R, i, R * 2, b); }
      k.restore(); c.drawImage(o, 0, 0);
    };
    layer((k) => { k.strokeStyle = '#5db040'; k.lineWidth = hole.fw * ppm; k.beginPath(); hole.path.forEach((p, i) => (i ? k.lineTo(X(p.x), Y(p.z)) : k.moveTo(X(p.x), Y(p.z)))); k.stroke(); }, 6, 0.1);
    layer((k) => { k.fillStyle = '#5aae40'; k.fillRect(X(tee.x - 5), Y(tee.z - 4.5), 10 * ppm, 9 * ppm); }, 1.5, 0.06);
    c.fillStyle = '#58a83e'; c.beginPath(); c.arc(X(pin.x), Y(pin.z), (hole.greenR + 3.2) * ppm, 0, 7); c.fill();
    layer((k) => { k.fillStyle = '#74c85a'; k.beginPath(); k.arc(X(pin.x), Y(pin.z), hole.greenR * ppm, 0, 7); k.fill(); }, 2.2, 0.06);
    for (const q of hole.haz) {
      const cx = X(q.x), cy = Y(q.z), r = q.r * ppm;
      if (q.type === 'bunker') {
        const blob = (rr) => { c.beginPath(); c.arc(cx, cy, rr * 0.8, 0, 7); for (let i = 0; i < 5; i++) { const a = i * 1.257 + q.x; c.moveTo(cx + Math.cos(a) * rr * 0.52 + rr * 0.46, cy + Math.sin(a) * rr * 0.52); c.arc(cx + Math.cos(a) * rr * 0.52, cy + Math.sin(a) * rr * 0.52, rr * 0.46, 0, 7); } c.fill(); };
        c.fillStyle = '#2a5a24'; blob(r * 1.08);
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, '#f3e8c2'); g.addColorStop(1, '#dcc88f'); c.fillStyle = g; blob(r);
      } else {
        c.fillStyle = '#4c5a36'; c.beginPath(); c.arc(cx, cy, r + 2.2 * ppm, 0, 7); c.fill();
        c.fillStyle = '#1d4658'; c.beginPath(); c.arc(cx, cy, r + 0.6 * ppm, 0, 7); c.fill();
      }
    }
    for (const t of trees) { // soft shadows on the side away from the sun
      const hgt = (t.pine ? 11 : 8) * t.s, sx = X(t.x - (SUN.x / SUN.y) * hgt * 0.5), sy = Y(t.z - (SUN.z / SUN.y) * hgt * 0.5), rr = (t.pine ? 2.6 : 3.8) * t.s * ppm;
      const g = c.createRadialGradient(sx, sy, 0, sx, sy, rr * 1.7); g.addColorStop(0, 'rgba(0,22,4,0.42)'); g.addColorStop(1, 'rgba(0,22,4,0)'); c.fillStyle = g; c.fillRect(sx - rr * 2, sy - rr * 2, rr * 4, rr * 4);
    }
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = this.r.capabilities.getMaxAnisotropy();
    // fine grass grain so it doesn't look smooth close to the camera
    const dc = document.createElement('canvas'); dc.width = dc.height = 128; const dx = dc.getContext('2d'), id = dx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) { const v = 110 + rnd() * 145; id.data.set([v, v, v, 255], i * 4); } dx.putImageData(id, 0, 0);
    const det = new T.CanvasTexture(dc); det.wrapS = det.wrapT = T.RepeatWrapping;
    // --- ground mesh
    const step = 2.5, nx = Math.ceil(W / step), nz = Math.ceil(D / step), pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), idx = [];
    for (let j = 0, k = 0; j <= nz; j++) for (let i = 0; i <= nx; i++, k++) {
      const x = x0 + (i / nx) * W, z = z0 + (j / nz) * D, edge = Math.min(i, nx - i, j, nz - j) < 1;
      pos.set([x, edge ? -1 : this.hAt(x, z), z], k * 3); uv.set([i / nx, 1 - j / nz], k * 2);
      if (i < nx && j < nz) { const a = k, b = k + 1, d = k + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    }
    const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.BufferAttribute(pos, 3)); gg.setAttribute('uv', new T.BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals();
    const gm = new T.MeshLambertMaterial({ map: tex });
    gm.onBeforeCompile = (s) => {
      s.uniforms.uDet = { value: det };
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDet = position.xz * 0.45;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDet; varying vec2 vDet;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.78 + 0.44 * (texture2D(uDet, vDet).r * 0.6 + texture2D(uDet, vDet * 0.13).r * 0.4);');
    };
    G.add(new T.Mesh(gg, gm));
    // --- water
    for (const q of hole.haz) if (q.type === 'water') {
      const w = new T.Mesh(new T.CircleGeometry(q.r + 2.5, 40), new T.MeshPhongMaterial({ color: 0x2d7fb0, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.86 }));
      w.rotation.x = -Math.PI / 2; w.position.set(q.x, -0.55, q.z); G.add(w);
    }
    // --- trees
    const round = trees.filter((t) => !t.pine), pines = trees.filter((t) => t.pine), m4 = new T.Matrix4(), qn = new T.Quaternion(), col = new T.Color();
    const inst = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); G.add(m); return m; };
    const blobG = new T.IcosahedronGeometry(1, 2), bp = blobG.attributes.position;
    for (let i = 0; i < bp.count; i++) { const k = 1 + 0.16 * Math.sin(bp.getX(i) * 5.1 + bp.getY(i) * 3.7) + 0.1 * Math.sin(bp.getZ(i) * 7.3); bp.setXYZ(i, bp.getX(i) * k, bp.getY(i) * k, bp.getZ(i) * k); }
    blobG.computeVertexNormals();
    const leaf = new T.MeshLambertMaterial({ color: 0xffffff }), bark = new T.MeshLambertMaterial({ color: 0x5b4127 });
    const trunkG = new T.CylinderGeometry(0.22, 0.34, 1, 7); trunkG.translate(0, 0.5, 0);
    const trunks = inst(trunkG, bark, trees.length), b1 = inst(blobG, leaf, round.length), b2 = inst(blobG, leaf, round.length);
    const coneG = new T.ConeGeometry(1, 1, 9); coneG.translate(0, 0.5, 0); const cones = inst(coneG, leaf, pines.length * 3);
    let ti = 0;
    round.forEach((t, i) => {
      const y = this.hAt(t.x, t.z) - 0.2, s = t.s;
      m4.compose(new T.Vector3(t.x, y, t.z), qn, new T.Vector3(s, 4.2 * s, s)); trunks.setMatrixAt(ti++, m4);
      m4.compose(new T.Vector3(t.x, y + 5.4 * s, t.z), qn.setFromAxisAngle(new T.Vector3(0, 1, 0), t.c * 6), new T.Vector3(3.5 * s, 3.1 * s, 3.5 * s)); b1.setMatrixAt(i, m4);
      m4.compose(new T.Vector3(t.x + (t.c - 0.5) * 2 * s, y + 7.6 * s, t.z + (0.5 - t.c) * 1.6 * s), qn, new T.Vector3(2.4 * s, 2.2 * s, 2.4 * s)); b2.setMatrixAt(i, m4);
      col.setHSL(0.27 + t.c * 0.07, 0.5 + t.c * 0.2, 0.2 + t.c * 0.1); b1.setColorAt(i, col); col.offsetHSL(0, 0, 0.035); b2.setColorAt(i, col);
      qn.identity();
    });
    pines.forEach((t, i) => {
      const y = this.hAt(t.x, t.z) - 0.2, s = t.s;
      m4.compose(new T.Vector3(t.x, y, t.z), qn, new T.Vector3(0.8 * s, 3 * s, 0.8 * s)); trunks.setMatrixAt(ti++, m4);
      for (let k = 0; k < 3; k++) {
        m4.compose(new T.Vector3(t.x, y + (2 + k * 2.7) * s, t.z), qn, new T.Vector3((2.7 - k * 0.7) * s, (4.6 - k * 0.5) * s, (2.7 - k * 0.7) * s)); cones.setMatrixAt(i * 3 + k, m4);
        col.setHSL(0.36 + t.c * 0.04, 0.45, 0.14 + t.c * 0.06 + k * 0.012); cones.setColorAt(i * 3 + k, col);
      }
    });
    for (const m of [trunks, b1, b2, cones]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; }
    // --- tee markers
    for (const s of [-1, 1]) { const mk = new T.Mesh(new T.SphereGeometry(0.09, 12, 8), new T.MeshLambertMaterial({ color: 0x1d6dff })); mk.position.set(tee.x + 0.6, this.hAt(tee.x, tee.z + s * 2.6) + 0.08, tee.z + s * 2.6); G.add(mk); }
    // arrows on the green that point downhill (shown while putting)
    this.marks = new T.Group(); this.marks.visible = false; G.add(this.marks);
    if (slope.g >= 0.4) {
      const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.Float32BufferAttribute([0.45, 0, 0, -0.25, 0, 0.22, -0.25, 0, -0.22], 3));
      const tm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: T.DoubleSide, depthWrite: false });
      for (let gx = -hole.greenR; gx <= hole.greenR; gx += 2.6) for (let gz = -hole.greenR; gz <= hole.greenR; gz += 2.6) {
        if (Math.hypot(gx, gz) > hole.greenR - 0.8 || Math.hypot(gx, gz) < 0.6) continue;
        const m = new T.Mesh(tg, tm); m.position.set(pin.x + gx, this.hAt(pin.x + gx, pin.z + gz) + 0.04, pin.z + gz); m.rotation.y = -slope.a; m.scale.setScalar(0.5 + slope.g * 0.3); this.marks.add(m);
      }
    }
    // flag and cup
    const py = this.hAt(pin.x, pin.z); this.flag.position.set(pin.x, py, pin.z); this.cup.position.set(pin.x, py + 0.02, pin.z);
    // keep the far scenery centred on this hole
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; for (const o of [this.sky, this.clouds, this.land, ...this.hills]) { o.position.x = mx; o.position.z = mz; }
  }

  // ---- where the camera sits for a ball at p, aimed at aim
  pose(p, aim, close) {
    if (close) { const d = Math.hypot(aim.x - p.x, aim.z - p.z) || 1, ux = (aim.x - p.x) / d, uz = (aim.z - p.z) / d, by = this.hAt(p.x, p.z), b = clamp(d * 0.45 + 3.6, 4.2, 7); return { p: new T.Vector3(p.x - ux * b + uz * 0.5, by + 1.5 + b * 0.25, p.z - uz * b - ux * 0.5), l: new T.Vector3(aim.x, this.hAt(aim.x, aim.z) + 0.2, aim.z) }; }
    const d = Math.hypot(aim.x - p.x, aim.z - p.z) || 1, ux = (aim.x - p.x) / d, uz = (aim.z - p.z) / d, by = this.hAt(p.x, p.z);
    const cx = p.x - ux * 8, cz = p.z - uz * 8;
    return { p: new T.Vector3(cx, Math.max(this.hAt(cx, cz) + 1.8, by + 3.3), cz), l: new T.Vector3(p.x + ux * 45, by + 1.2, p.z + uz * 45) };
  }
  /** stand the golfer at the ball, lined up on aim (right-handed) */
  placeGolfer(p, aim, show = true) {
    const d = Math.hypot(aim.x - p.x, aim.z - p.z); this.golfer.visible = show && d > 0.01; if (!this.golfer.visible) return;
    const ux = (aim.x - p.x) / d, uz = (aim.z - p.z) / d, th = Math.atan2(-uz, ux), fx = Math.sin(th), fz = Math.cos(th);
    this.golfer.rotation.y = th; this.golfer.position.set(p.x - fx * 0.86, this.hAt(p.x, p.z), p.z - fz * 0.86); poseGolfer(this.golfer, 0);
  }
  placeBall(p, lift = 0) { const y = this.hAt(p.x, p.z); this.ball.position.set(p.x, y + 0.05 + lift, p.z); this.shadow.position.set(p.x, y + 0.03, p.z); this.bp = { x: p.x, z: p.z }; }

  /** Show the ball waiting at p. ringAt = where the chosen club normally finishes (or null). */
  setState(p, aim, ringAt, glide = true, close = false, holed = false) {
    this.holed = holed; if (this.marks) this.marks.visible = close;
    this.aim = aim; this.rest = { p, aim, close };
    if (ringAt) { this.ringOn = true; this.ring.visible = true; this.ring.position.set(ringAt.x, this.hAt(ringAt.x, ringAt.z) + 0.3, ringAt.z); this.ring.scale.setScalar(clamp(Math.hypot(ringAt.x - p.x, ringAt.z - p.z) * 0.06, 2.5, 14)); } else { this.ringOn = false; this.ring.visible = false; }
    if (this.anim && this.anim.kind !== 'glide') return; // a shot is in the air: it will settle here when it finishes
    this.placeBall(p); this.trail.visible = false; this.placeGolfer(p, aim, !this.holed);
    const to = this.pose(p, aim, close);
    if (!glide) { this.camP.copy(to.p); this.camL.copy(to.l); } else this.anim = { kind: 'glide', t: 0, dur: 1.1, p0: this.camP.clone(), l0: this.camL.clone(), to };
  }

  /** Fly a shot from → to. o: { apex, done (holed out), penalty, then() } */
  fly(from, to, o = {}) {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    this.trailPts = []; this.trail.visible = true; this.ring.visible = false;
    this.anim = { kind: 'fly', t: 0, from, to, dist, apex: o.apex || clamp(dist * 0.17, 1.5, 38), dur: clamp(1.4 + dist / 52, 1.7, 5.6), carry: o.penalty ? 1 : 0.93,
      done: !!o.done, penalty: !!o.penalty, then: o.then, cam0: this.camP.clone(), phase: -1 };
    this.placeBall(from); const d0 = { x: to.x, z: to.z }; this.placeGolfer(from, d0);
  }

  /** Roll a putt from → to. o: { done (it dropped), then() } */
  roll(from, to, o = {}) {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    this.trail.visible = false; this.anim = { kind: 'roll', t: 0, from, to, dur: clamp(0.9 + dist * 0.22, 1, 3.4), done: !!o.done, then: o.then, end: false };
  }
  stepRoll(a, dt) {
    a.t += dt;
    if (!a.end) {
      const u = Math.min(1, a.t / a.dur), s = 1 - (1 - u) * (1 - u), x = a.from.x + (a.to.x - a.from.x) * s, z = a.from.z + (a.to.z - a.from.z) * s, y = this.hAt(x, z);
      this.ball.position.set(x, y + 0.05 - (a.done && u > 0.96 ? 0.13 : 0), z); this.shadow.position.set(x, y + 0.03, z); this.bp = { x, z };
      this.camL.lerp(new T.Vector3((x + this.flag.position.x) / 2, y + 0.2, (z + this.flag.position.z) / 2), 1 - Math.pow(0.05, dt));
      if (u >= 1) { a.end = true; a.t = 0; }
    } else if (a.t > 0.7) {
      this.anim = null;
      if (a.done) this.golfer.visible = false;
      if (!a.done && this.rest) { this.placeBall(this.rest.p); this.placeGolfer(this.rest.p, this.rest.aim); this.anim = { kind: 'glide', t: 0, dur: 1, p0: this.camP.clone(), l0: this.camL.clone(), to: this.pose(this.rest.p, this.rest.aim, this.rest.close) }; }
      a.then?.();
    }
  }

  resize() {
    const r = this.cv.getBoundingClientRect(), w = Math.max(50, r.width), h = Math.max(50, r.height);
    this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.fov = w / h < 0.9 ? 62 : w / h < 1.4 ? 54 : 46; this.cam.updateProjectionMatrix(); this.W = w; this.H = h;
  }
  start() { if (this.on) return; this.on = true; this.resize(); this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
  stop() { this.on = false; cancelAnimationFrame(this.raf); if (this.tag) this.tag.hidden = true; }

  loop(now) {
    if (!this.on) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.12, (now - this.last) / 1000);
    if (!this.anim && now - this.last < 45) return; // idle: about 20 pictures a second is plenty
    this.last = now;
    if (!this.hole) return;
    const a = this.anim;
    if (a && a.kind === 'glide') {
      a.t += dt / a.dur; const k = ease(Math.min(1, a.t));
      this.camP.lerpVectors(a.p0, a.to.p, k); this.camL.lerpVectors(a.l0, a.to.l, k);
      if (a.t >= 1) this.anim = null;
    } else if (a && a.kind === 'fly') this.stepFly(a, dt); else if (a && a.kind === 'roll') this.stepRoll(a, dt);
    this.cam.position.copy(this.camP); this.cam.lookAt(this.camL);
    // flag: waves, and grows with distance so it can always be seen
    const fp = this.flag.position, fd = this.cam.position.distanceTo(fp); this.flag.scale.setScalar(clamp(fd / 34, 1, 9));
    const cp = this.cloth.geometry.attributes.position, b = this.clothBase, tt = now / 1000;
    for (let i = 0; i < cp.count; i++) { const x = b[i * 3] + 0.4; cp.setZ(i, Math.sin(x * 7 - tt * 6) * 0.07 * x * 2.4); } cp.needsUpdate = true;
    const bd = this.cam.position.distanceTo(this.ball.position); this.ball.scale.setScalar(clamp(bd / 6.5, 1, 40)); this.shadow.scale.setScalar(clamp(bd / 6.5, 1, 40));
    this.ring.material.opacity = 0.5 + 0.25 * Math.sin(tt * 3);
    if (this.trail.visible) this.drawTrail();
    this.r.render(this.scene, this.cam);
    if (this.tag) { // the distance label above the flag
      const v = new T.Vector3(fp.x, fp.y + 2.9 * this.flag.scale.x, fp.z).project(this.cam);
      const ok = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !!this.tag.textContent;
      this.tag.hidden = !ok; if (ok) this.tag.style.transform = `translate(${((v.x + 1) / 2) * this.W}px, ${((1 - v.y) / 2) * this.H}px) translate(-50%, -100%)`;
    }
  }

  stepFly(a, dt) {
    const { from, to } = a, L = { x: from.x + (to.x - from.x) * a.carry, z: from.z + (to.z - from.z) * a.carry };
    a.t += dt;
    let bx, bz, by;
    if (a.phase === -1) { // the swing, up to the moment the club meets the ball
      poseGolfer(this.golfer, Math.min(0.62, (a.t / 0.95) * 0.62));
      if (a.t >= 0.95) { a.phase = 0; a.t = 0; a.swing = 0.62; }
      return;
    }
    if (a.swing < 1) { a.swing = Math.min(1, a.swing + dt * 0.75); poseGolfer(this.golfer, a.swing); }
    if (a.phase === 0) { // in the air
      const u = Math.min(1, a.t / a.dur), s = 1 - Math.pow(1 - u, 1.45);
      bx = from.x + (L.x - from.x) * s; bz = from.z + (L.z - from.z) * s;
      const g0 = this.hAt(from.x, from.z), g1 = this.hAt(L.x, L.z);
      by = g0 + (g1 - g0) * s + a.apex * Math.sin(Math.PI * Math.pow(s, 1.18));
      by = Math.max(by, this.hAt(bx, bz));
      if (u >= 1) { a.phase = 1; a.t = 0; }
    } else if (a.phase === 1) { // roll out
      const u = Math.min(1, a.t / 0.9), s = 1 - (1 - u) * (1 - u);
      bx = L.x + (to.x - L.x) * s; bz = L.z + (to.z - L.z) * s; by = this.hAt(bx, bz);
      if (a.penalty) by -= u * 0.6;
      if (u >= 1) { a.phase = a.done ? 2 : 3; a.t = 0; }
    } else if (a.phase === 2) { // the putts, shown as one roll into the hole
      const pin = pinOf(this.hole), u = Math.min(1, a.t / 1.5), s = ease(u);
      bx = to.x + (pin.x - to.x) * s; bz = to.z + (pin.z - to.z) * s; by = this.hAt(bx, bz) - (u > 0.97 ? 0.12 : 0);
      if (u >= 1) { a.phase = 3; a.t = 0; }
    } else { // pause, then hand back
      bx = this.bp.x; bz = this.bp.z; by = this.ball.position.y - 0.05;
      if (a.t > (a.done ? 1.1 : 0.7)) {
        this.anim = null; this.trail.visible = false;
        if (this.rest) {
          let to2;
          if (a.done) { this.golfer.visible = false; const pin = pinOf(this.hole), L = Math.hypot(pin.x - a.from.x, pin.z - a.from.z) || 1, back = Math.min(16, L * 0.8); to2 = this.pose({ x: pin.x - ((pin.x - a.from.x) / L) * back, z: pin.z - ((pin.z - a.from.z) / L) * back }, pin); to2.l.set(pin.x, this.hAt(pin.x, pin.z) + 1, pin.z); }
          else { this.placeBall(this.rest.p); this.placeGolfer(this.rest.p, this.rest.aim); to2 = this.pose(this.rest.p, this.rest.aim, this.rest.close); this.ring.visible = !!this.ringOn; }
          this.anim = { kind: 'glide', t: 0, dur: 1.3, p0: this.camP.clone(), l0: this.camL.clone(), to: to2 };
        }
        a.then?.(); return;
      }
    }
    this.ball.position.set(bx, by + 0.05, bz); this.shadow.position.set(bx, this.hAt(bx, bz) + 0.03, bz); this.bp = { x: bx, z: bz };
    if (a.phase === 0) { const lp = this.trailPts[this.trailPts.length - 1]; if (!lp || lp.distanceTo(this.ball.position) > Math.max(0.4, a.dist / (this.trailN - 4))) this.trailPts.push(this.ball.position.clone()); }
    // camera: follows part of the way down the hole, always watching the ball
    const prog = clamp(Math.hypot(bx - from.x, bz - from.z) / (a.dist || 1), 0, 1), f = a.done || a.dist < 60 ? 0.35 : 0.62;
    const tx = a.cam0.x + (bx - from.x) * f * ease(prog), tz = a.cam0.z + (bz - from.z) * f * ease(prog);
    const ty = Math.max(this.hAt(tx, tz) + 2.2, a.cam0.y + a.apex * 0.3 * Math.sin(Math.PI * prog));
    const k = 1 - Math.pow(0.002, dt);
    this.camP.lerp(new T.Vector3(tx, ty, tz), k); this.camL.lerp(this.ball.position, 1 - Math.pow(0.0005, dt));
  }

  drawTrail() {
    const pts = this.trailPts.slice(-this.trailN), arr = this.trail.geometry.attributes.position.array, n = pts.length;
    const side = new T.Vector3(), dir = new T.Vector3(), toCam = new T.Vector3();
    for (let i = 0; i < this.trailN; i++) {
      const p = pts[Math.min(i, n - 1)] || this.ball.position, q = pts[Math.min(i + 1, n - 1)] || p, o = pts[Math.max(0, Math.min(i, n - 1) - 1)] || p;
      dir.subVectors(q, o); toCam.subVectors(this.cam.position, p); side.crossVectors(dir, toCam);
      const w = side.lengthSq() > 1e-9 ? toCam.length() * 0.0035 : 0; side.normalize().multiplyScalar(i >= n ? 0 : w);
      arr.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    }
    this.trail.geometry.attributes.position.needsUpdate = true; this.trail.geometry.setDrawRange(0, Math.max(0, (Math.min(n, this.trailN) - 1) * 6));
  }
}
