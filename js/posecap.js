// Swing capture: keeps ~10 small colour pictures a second from the camera,
// and after a shot runs body tracking (MediaPipe Pose, on the phone) over the
// swing so swing.js can measure it. Body tracking only runs after the shot,
// so it never slows down the ball tracking during the swing.


export class SwingCapture {
  constructor(video, log) {
    this.video = video;
    this.log = log || (() => {});
    this.pose = null;
    this.loading = null;
    this.busy = false;
  }

  // Turn grey frames from the shot detector into small canvases
  static toPics(frames) {
    return frames.map((f) => {
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
      const ctx = c.getContext('2d'); const img = ctx.createImageData(f.w, f.h);
      const g = new Uint8Array(f.buf);
      for (let i = 0, j = 0; j < g.length; i += 4, j++) { const v = g[j]; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return { t: f.t, bmp: c };
    });
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
    // copy into a work canvas first: body tracking may use up the picture it is given
    if (!this.work) { this.work = document.createElement('canvas'); this.wctx = this.work.getContext('2d'); }
    const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
    const W = Math.min(480, iw), H = Math.round((ih / iw) * W);
    if (this.work.width !== W || this.work.height !== H) { this.work.width = W; this.work.height = H; }
    this.wctx.drawImage(img, 0, 0, W, H);
    img = this.work;
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
  async analyse(pics, w, h) {
    await this.load();
    this.busy = true;
    try {
      this.pose.reset();
      // the first picture after a reset is often off: run it once to warm up
      if (pics.length) await this.landmarks(pics[0].bmp);
      const frames = [];
      const t0 = performance.now();
      // Look at every other picture across the whole swing first, then fill
      // in the gaps if there's time — a slow phone still covers address to finish.
      const order = [];
      for (let i = 0; i < pics.length; i += 2) order.push(i);
      for (let i = 1; i < pics.length; i += 2) order.push(i);
      for (const i of order) {
        if (performance.now() - t0 > 6000) break;
        const p = pics[i];
        const lm = await this.landmarks(p.bmp);
        frames.push({ t: p.t, lm: lm ? lm.map((q) => ({ x: q.x * w, y: q.y * h, v: q.visibility ?? 1 })) : null });
      }
      frames.sort((a, b) => a.t - b.t);
      this.log(`body tracking ran on ${pics.length} pictures in ${Math.round(performance.now() - t0)} ms · body found in ${frames.filter((f) => f.lm).length}`);
      return { frames, pics };
    } finally { this.busy = false; }
  }

  // one quick look at the current picture (for the setup screen check)
  async check(w, h) {
    if (!this.pose || this.busy || !this.video.videoWidth) return null;
    this.busy = true;
    try {
      const lm = await this.landmarks(this.video);
      return lm ? lm.map((q) => ({ x: q.x * w, y: q.y * h, v: q.visibility ?? 1 })) : [];
    } finally { this.busy = false; }
  }
}
