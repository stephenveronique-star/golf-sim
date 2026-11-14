// Driving-range view: perspective "down the line" and top-down map.
// World: x downrange (m), y up, z right of target line.

const YD = 0.9144;
const COLORS = {
  skyTop: '#7fb2d9', skyBot: '#d7e8f2',
  rough: '#3f7a35', fairway: '#58a046', fairwayDark: '#4f9640',
  line: 'rgba(255,255,255,0.55)', text: '#ffffff',
  tracer: '#ffd34d', ball: '#ffffff', old: 'rgba(255,255,255,0.75)',
};

export class RangeView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'dtl'; // 'dtl' | 'top'
    this.unit = 'm';   // 'm' | 'yd'
    this.shots = [];   // previous shots: {land:{x,z}, end:{x,z}, color}
    this.current = null; // {points, t0, sim, color}
    this.raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.c.getBoundingClientRect();
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height);
    this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  maxRange() {
    let m = this.unit === 'yd' ? 250 * 0.9144 : 230;
    for (const s of this.shots) m = Math.max(m, s.end.x * 1.12);
    if (this.current) m = Math.max(m, this.current.sim.end.x * 1.12);
    return Math.min(420, m);
  }

  // perspective camera behind the tee
  proj(x, y, z) {
    const camBack = 30, camH = 12, pitch = 0.1244;
    const X = z, Y = y - camH, Z = x + camBack;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Yc = Y * cp + Z * sp, Zc = -Y * sp + Z * cp;
    if (Zc < 0.5) return null;
    const f = this.H * 1.6;
    return { x: this.W / 2 + (f * X) / Zc, y: this.H * 0.5 - (f * Yc) / Zc, s: f / Zc };
  }

  projTop(x, y, z) {
    const R = this.maxRange();
    const pad = 28;
    const sc = Math.min((this.H - pad * 2) / R, (this.W - pad) / 80);
    return { x: this.W / 2 + z * sc, y: this.H - pad - x * sc, s: sc };
  }

  projSide(x, y) {
    const R = this.maxRange();
    const padL = 16, padR = 24, padB = 30, padT = 60;
    const sx = (this.W - padL - padR) / R;
    const maxY = Math.max(40, this.maxApex() * 1.15);
    const sy = Math.min(sx * 3, (this.H - padB - padT) / maxY);
    return { x: padL + x * sx, y: this.H - padB - y * sy, s: sx };
  }
  maxApex() {
    let m = 0;
    if (this.current) for (const p of this.current.sim.points) m = Math.max(m, p.y);
    return m;
  }

  P(x, y, z) {
    if (this.mode === 'top') return this.projTop(x, y, z);
    if (this.mode === 'side') return this.projSide(x, y);
    return this.proj(x, y, z);
  }

  draw(now = performance.now()) {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    if (this.mode === 'top') this.drawTopGround();
    else if (this.mode === 'side') this.drawSideGround();
    else this.drawGround();
    // previous shots
    for (const s of this.shots) {
      const p = this.P(s.end.x, 0, s.end.z);
      const q = this.P(s.land.x, 0, s.land.z);
      if (!p || !q) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = s.color || COLORS.old;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2.5, Math.min(6, (this.mode === 'top' ? 4 : p.s * 0.6))), 0, Math.PI * 2); ctx.fill();
    }
    // current tracer
    const cur = this.current;
    let animating = false;
    if (cur) {
      const el = (now - cur.t0) / 1000 * (cur.speed || 1.6);
      const pts = cur.sim.points;
      const tEnd = pts[pts.length - 1].t;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // shadow on the ground
      if (this.mode === 'dtl') {
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (const p of pts) { if (p.t > el) break; const q = this.P(p.x, 0, p.z); if (!q) continue; if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y); }
        ctx.stroke();
      }
      ctx.strokeStyle = cur.color || COLORS.tracer; ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,200,40,0.8)'; ctx.shadowBlur = 8;
      ctx.beginPath();
      let last = null, started = false;
      for (const p of pts) {
        if (p.t > el) break;
        const q = this.P(p.x, p.y, p.z); if (!q) continue;
        if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
        last = { p, q };
      }
      ctx.stroke(); ctx.shadowBlur = 0;
      if (el < tEnd) animating = true;
      if (last) {
        ctx.fillStyle = COLORS.ball;
        ctx.beginPath(); ctx.arc(last.q.x, last.q.y, Math.max(3, Math.min(7, this.mode === 'top' ? 4 : last.q.s * 0.25)), 0, Math.PI * 2); ctx.fill();
      }
      // roll after landing
      if (el >= tEnd) {
        const rollT = Math.min(1, (el - tEnd) / 1.2);
        const a = this.P(cur.sim.land.x, 0, cur.sim.land.z);
        const bx = cur.sim.land.x + (cur.sim.end.x - cur.sim.land.x) * rollT;
        const bz = cur.sim.land.z + (cur.sim.end.z - cur.sim.land.z) * rollT;
        const b = this.P(bx, 0, bz);
        if (a && b) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.fillStyle = COLORS.ball; ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
        }
        if (rollT < 1) animating = true;
        else if (!cur.labelled) cur.labelled = true;
        if (rollT >= 1 && b) this.label(b, cur.label);
      }
    }
    if (animating) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame((t) => this.draw(t));
    }
  }

  label(p, text) {
    if (!text) return;
    const { ctx } = this;
    ctx.font = '600 14px -apple-system, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 14;
    const x = Math.min(this.W - w - 4, Math.max(4, p.x - w / 2)), y = p.y - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, x, y, w, 24, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, x + 7, y + 12.5);
  }

  drawGround() {
    const { ctx, W, H } = this;
    const hz = this.proj(5000, 0, 0).y;
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, COLORS.skyTop); g.addColorStop(1, COLORS.skyBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz + 1);
    // distant trees
    ctx.fillStyle = '#2f5d2c';
    ctx.beginPath(); ctx.moveTo(0, hz);
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, hz - 6 - 5 * Math.abs(Math.sin(x * 0.07)) - 3 * Math.sin(x * 0.23));
    ctx.lineTo(W, hz); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.rough; ctx.fillRect(0, hz, W, H - hz);
    const R = 450;
    // mown stripes on the fairway
    const fw = 22;
    const step = this.unit === 'yd' ? 9.144 : 10;
    for (let x = 0; x < R; x += step) {
      const a = this.proj(x, 0, -fw), b = this.proj(x, 0, fw), c = this.proj(x + step, 0, fw), d = this.proj(x + step, 0, -fw);
      if (!a || !b || !c || !d) continue;
      ctx.fillStyle = (Math.round(x / step) % 2) ? COLORS.fairway : COLORS.fairwayDark;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    }
    // tee box
    const t1 = this.proj(-2, 0, -2.5), t2 = this.proj(-2, 0, 2.5), t3 = this.proj(3, 0, 2.5), t4 = this.proj(3, 0, -2.5);
    if (t1 && t2 && t3 && t4) { ctx.fillStyle = '#6cb556'; ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(t3.x, t3.y); ctx.lineTo(t4.x, t4.y); ctx.closePath(); ctx.fill(); }
    this.drawMarkers(false);
  }

  drawTopGround() {
    const { ctx, W, H } = this;
    ctx.fillStyle = COLORS.rough; ctx.fillRect(0, 0, W, H);
    const R = this.maxRange();
    const a = this.projTop(0, 0, -22), b = this.projTop(R * 1.2, 0, 22);
    ctx.fillStyle = COLORS.fairway; ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
    this.drawMarkers(true);
  }

  drawSideGround() {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.skyTop); g.addColorStop(1, COLORS.skyBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const base = this.projSide(0, 0).y;
    ctx.fillStyle = COLORS.fairway; ctx.fillRect(0, base, W, H - base);
    const yd = this.unit === 'yd', k = yd ? YD : 1;
    const R = this.maxRange();
    const every = R < 160 ? 25 : 50;
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = every; d * k <= R; d += every) {
      const p = this.projSide(d * k, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, base); ctx.lineTo(p.x, 50); ctx.stroke();
      ctx.fillStyle = COLORS.text; ctx.fillText(`${d}${yd ? 'y' : 'm'}`, p.x, base + 6);
    }
    // height guides
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const hEvery = this.maxApex() > 45 ? 20 : 10;
    for (let h = hEvery; ; h += hEvery) {
      const p = this.projSide(0, h * k);
      if (p.y < 55) break;
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
      ctx.fillText(`${h}${yd ? 'y' : 'm'} high`, 6, p.y - 1);
    }
  }

  drawMarkers(top) {
    const { ctx } = this;
    const yd = this.unit === 'yd';
    const k = yd ? 0.9144 : 1;
    const R = top ? this.maxRange() : (this.unit === 'yd' ? 300 * 0.9144 : 300);
    const every = top && R < 160 ? 25 : 50;
    this._lastLblY = null;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let d = every; d * k <= R; d += every) {
      const x = d * k;
      const a = this.P(x, 0, -40), b = this.P(x, 0, 40);
      if (!a || !b) continue;
      ctx.strokeStyle = COLORS.line; ctx.lineWidth = top ? 1 : Math.max(0.5, a.s * 0.04);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const fp = this.P(x, 0, 0);
      if (!top) {
        // flag
        const tp = this.P(x, 2.4, 0);
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.fillStyle = d % 100 === 0 ? '#e2412f' : '#f2c230';
        const fl = Math.max(4, tp.s * 0.9);
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(tp.x + fl, tp.y + fl * 0.3); ctx.lineTo(tp.x, tp.y + fl * 0.6); ctx.closePath(); ctx.fill();
      }
      const lp = top ? this.P(x, 0, -20) : this.P(x, 0, -24);
      if (!top) { if (this._lastLblY != null && this._lastLblY - lp.y < 13) continue; this._lastLblY = lp.y; }
      ctx.fillStyle = COLORS.text;
      ctx.font = `600 ${top ? 11 : Math.max(9, Math.min(14, lp.s * 0.9))}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(`${d}${yd ? 'y' : 'm'}`, lp.x, lp.y - 2);
    }
    // target line
    const s = this.P(0, 0, 0), e = this.P(R, 0, 0);
    if (s && e) {
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  setShots(list) { this.shots = list; this.draw(); }
  play(sim, opts = {}) {
    this.current = { sim, t0: performance.now(), color: opts.color, label: opts.label, speed: opts.speed ?? 1.6 };
    this.draw();
  }
  setMode(m) { this.mode = m; this.draw(performance.now() + 1e7); }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
