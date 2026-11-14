// Swing capture: keeps ~10 small colour pictures a second from the camera,
// and after a shot runs body tracking (MediaPipe Pose, on the phone) over the
// swing so swing.js can measure it. Body tracking only runs after the shot,
// so it never slows down the ball tracking during the swing.

const SNAP_W = 480;          // picture width kept for body tracking
const SNAP_EVERY = 0.1;      // seconds between pictures
const KEEP = 3.8;            // seconds of pictures kept

export class SwingCapture {
  constructor(video, log) {
    this.video = video;
    this.log = log || (() => {});
    this.snaps = [];          // {t, bmp}
    this.lastSnap = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pose = null;
    this.loading = null;
    this.busy = false;
  }

  // call often (e.g. every animation frame); t in seconds on the performance clock
  async tick(t) {
    if (this.busy || t - this.lastSnap < SNAP_EVERY) return;
    const v = this.video;
    if (!v.videoWidth || v.videoHeight > v.videoWidth) return;
    this.lastSnap = t;
    const h = Math.round((v.videoHeight / v.videoWidth) * SNAP_W);
    if (this.canvas.width !== SNAP_W || this.canvas.height !== h) { this.canvas.width = SNAP_W; this.canvas.height = h; }
    this.ctx.drawImage(v, 0, 0, SNAP_W, h);
    try {
      const bmp = await createImageBitmap(this.canvas);
      this.snaps.push({ t, bmp });
    } catch { return; }
    while (this.snaps.length && t - this.snaps[0].t > KEEP) { const o = this.snaps.shift(); try { o.bmp.close(); } catch { /* ignore */ } }
  }

  // Load the body tracker the first time it's needed (about 15 MB, cached after)
  load() {
    if (this.pose) return Promise.resolve(this.pose);
    if (this.loading) return this.loading;
    const base = new URL('../vendor/pose/', import.meta.url).href;
    this.loading = new Promise((resolve, reject) => {
      const go = async () => {
        try {
          const P = new window.Pose({ locateFile: (f) => base + f });
          P.setOptions({ modelComplexity: 1, smoothLandmarks: false, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
          await P.initialize();
          this.pose = P;
          this.log('body tracking loaded');
          resolve(P);
        } catch (e) { this.loading = null; this.log(`body tracking failed to load: ${e.message || e}`); reject(e); }
      };
      if (window.Pose) return go();
      const sc = document.createElement('script');
      sc.src = base + 'pose.js';
      sc.onload = go;
      sc.onerror = () => { this.loading = null; this.log('body tracking script failed to download'); reject(new Error('download failed')); };
      document.head.appendChild(sc);
    });
    return this.loading;
  }

  async landmarks(img) {
    const P = this.pose;
    return await new Promise((resolve) => {
      let done = false;
      P.onResults((r) => { if (!done) { done = true; resolve(r.poseLandmarks || null); } });
      P.send({ image: img }).catch(() => { if (!done) { done = true; resolve(null); } });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });
  }

  /**
   * Run body tracking over the swing around tImp (performance-clock seconds).
   * w, h: size of the ball tracker's frame, so landmarks share its pixels.
   * Returns {frames:[{t, lm}], pics:[{t,bmp}]} — pics are the pictures used.
   */
  async analyse(tImp, w, h) {
    await this.load();
    this.busy = true; // stop taking new pictures while we work
    try {
      const pics = this.snaps.filter((p) => p.t >= tImp - 2.3 && p.t <= tImp + 1.05);
      this.pose.reset();
      // the first picture after a reset is often off: run it once to warm up
      if (pics.length) await this.landmarks(pics[0].bmp);
      const frames = [];
      const t0 = performance.now();
      // If the phone is slow at this, look at every other picture instead
      // (and never take more than ~6 seconds in total).
      let step = 1, spent = 0, n = 0;
      for (let i = 0; i < pics.length; i += step) {
        const p = pics[i];
        const ts = performance.now();
        const lm = await this.landmarks(p.bmp);
        spent += performance.now() - ts; n++;
        frames.push({ t: p.t, lm: lm ? lm.map((q) => ({ x: q.x * w, y: q.y * h, v: q.visibility ?? 1 })) : null });
        if (n === 4 && spent / n > 140) step = 2;
        if (performance.now() - t0 > 6000) break;
      }
      this.log(`body tracking ran on ${pics.length} pictures in ${Math.round(performance.now() - t0)} ms · body found in ${frames.filter((f) => f.lm).length}`);
      return { frames, pics };
    } finally { this.busy = false; }
  }

  // one quick look at the current picture (for the setup screen check)
  async check(w, h) {
    if (!this.pose || this.busy || !this.snaps.length) return null;
    this.busy = true;
    try {
      const p = this.snaps[this.snaps.length - 1];
      const lm = await this.landmarks(p.bmp);
      return lm ? lm.map((q) => ({ x: q.x * w, y: q.y * h, v: q.visibility ?? 1 })) : [];
    } finally { this.busy = false; }
  }
}
