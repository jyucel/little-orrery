// Little Orrery: board renderer and pointer input.
//
// Draws the board on a <canvas> with spring-animated rotations, hopping swaps
// and particle effects, and turns taps/drags/wheel input into move ids. It
// never changes game state itself; it reports actions through
// `onAction(ids, meta)` and the controller applies them.

import { ringOffsets } from './engine.js';
import { ORB_R, boardBounds, rotatedQuarter, slotAngle } from './layout.js';

export const COLORS = [
  { name: 'Coral', hex: '#ff6b6b', light: '#ffb3a8', dark: '#c4384a' },
  { name: 'Amber', hex: '#ffbe45', light: '#ffe6a3', dark: '#c98612' },
  { name: 'Mint', hex: '#3fdc9a', light: '#a8f5d0', dark: '#15996a' },
  { name: 'Sky', hex: '#4cc3ff', light: '#b3e8ff', dark: '#1a7fc4' },
  { name: 'Violet', hex: '#a98bff', light: '#d9ccff', dark: '#6a4fd1' },
  { name: 'Rose', hex: '#ff7ac8', light: '#ffc2e6', dark: '#c43f8f' },
];

const BRASS = '#e3c48b';
const BRASS_DIM = 'rgba(227,196,139,0.35)';
const TAU = Math.PI * 2;
const SPRING_K = 260;
const SPRING_D = 25;
const SWAP_DUR = 0.3;
const TAP_SLOP = 9; // px of movement before a press becomes a drag

const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class BoardView {
  constructor(canvas, { onAction, onInvalid, onDragStart } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction || (() => {});
    this.onInvalid = onInvalid || (() => {});
    this.onDragStart = onDragStart || (() => {});
    this.glyphs = true;
    this.inputEnabled = true;
    this.level = null;
    this.particles = [];
    this.hover = null;
    this.press = null;
    this.time = 0;
    this.last = 0;
    this.raf = 0;
    this.bindInput();
    if (window.ResizeObserver) {
      // keep the backing store in sync whenever the board area changes size
      new ResizeObserver(() => {
        if (this.level && this.raf) this.layout();
      }).observe(canvas);
    }
  }

  // ---- setup --------------------------------------------------------------

  setLevel(level, game) {
    this.level = level;
    this.game = game;
    this.off = ringOffsets(level);
    this.resetAnimation();
    this.layout();
  }

  resetAnimation() {
    const L = this.level;
    this.rot = L.rings.map(() => ({ off: 0, vel: 0 }));
    this.swaps = [];
    this.shakes = new Map();
    this.glow = L.rings.map((_, r) => (this.game.ringSolved(r) ? 1 : 0));
    this.drag = null;
    this.press = null;
    this.hint = null;
    this.winT = null;
    this.particles = [];
  }

  layout() {
    if (!this.level) return;
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.W = W;
    this.H = H;
    this.dpr = dpr;

    // Rotate the board a quarter turn if that lets it be drawn larger.
    const fit = (geo) => {
      const b = boardBounds(geo);
      return { geo, b, s: Math.min(W / b.w, H / b.h) };
    };
    let best = fit(this.level);
    const alt = fit(rotatedQuarter(this.level));
    if (alt.s > best.s * 1.12) best = alt;
    const maxScale = Math.min(Math.min(W, H) / 4.5, 96); // keep small boards from becoming huge
    this.s = Math.min(best.s * 0.96, maxScale);
    this.geo = best.geo;
    this.ox = W / 2 - (best.b.minX + best.b.w / 2) * this.s;
    this.oy = H / 2 - (best.b.minY + best.b.h / 2) * this.s;
    this.buildSprites();
  }

  setGlyphs(on) {
    this.glyphs = on;
    if (this.level) this.buildSprites();
  }

  buildSprites() {
    const R = ORB_R * this.s;
    const size = Math.ceil(R * 2.6 * this.dpr);
    this.sprites = COLORS.map((c, i) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const cx = size / this.dpr / 2;
      // soft drop shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(cx, cx + R * 0.18, R * 1.02, R * 0.98, 0, 0, TAU);
      g.fill();
      // glossy body
      const grad = g.createRadialGradient(cx - R * 0.35, cx - R * 0.4, R * 0.1, cx, cx, R);
      grad.addColorStop(0, c.light);
      grad.addColorStop(0.45, c.hex);
      grad.addColorStop(1, c.dark);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cx, R, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = Math.max(1, R * 0.06);
      g.stroke();
      // specular highlight
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.ellipse(cx - R * 0.32, cx - R * 0.45, R * 0.36, R * 0.2, -0.6, 0, TAU);
      g.fill();
      if (this.glyphs) drawGlyph(g, i, cx, cx + R * 0.04, R * 0.38);
      return cv;
    });
  }

  // ---- coordinates --------------------------------------------------------

  px(x, y) {
    return [this.ox + x * this.s, this.oy + y * this.s];
  }

  units(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return [(clientX - rect.left - this.ox) / this.s, (clientY - rect.top - this.oy) / this.s];
  }

  slotPoint(r, k, extra = 0) {
    const ring = this.geo.rings[r];
    const a = slotAngle(ring, k) + extra;
    return [ring.x + Math.cos(a) * ring.r, ring.y + Math.sin(a) * ring.r];
  }

  bridgeEnds(i) {
    const b = this.level.bridges[i];
    return [this.slotPoint(b.a, b.sa), this.slotPoint(b.b, b.sb)];
  }

  bridgeMid(i) {
    const [p, q] = this.bridgeEnds(i);
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  }

  /** Screen (client) coordinates for pointing at the target of a move. */
  clientPointFor(moveId) {
    const rect = this.canvas.getBoundingClientRect();
    let u;
    if (moveId[0] === 'b') u = this.bridgeMid(Number(moveId.slice(1)));
    else {
      const ring = this.geo.rings[parseInt(moveId.slice(1), 10)];
      u = [ring.x + ring.r * 0.0, ring.y + ring.r * 0.0];
    }
    const [x, y] = this.px(u[0], u[1]);
    return { x: rect.left + x, y: rect.top + y };
  }

  hitTest(ux, uy) {
    if (!this.level) return null;
    let best = null;
    this.level.bridges.forEach((_, i) => {
      const [mx, my] = this.bridgeMid(i);
      const d = Math.hypot(ux - mx, uy - my);
      if (d < 0.55 && (!best || d < best.d)) best = { type: 'bridge', index: i, d };
    });
    if (best) return best;
    this.geo.rings.forEach((ring, i) => {
      const d = Math.hypot(ux - ring.x, uy - ring.y);
      if (d < ring.r + ORB_R + 0.35) {
        const score = Math.abs(d - ring.r);
        if (!best || score < best.d) best = { type: 'ring', index: i, d: score };
      }
    });
    return best;
  }

  // ---- input --------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', () => this.cancelPress());
    c.addEventListener('pointerleave', (e) => {
      if (!this.press && e.pointerType === 'mouse') this.hover = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.inputEnabled || !this.level) return;
        const hit = this.hitTest(...this.units(e.clientX, e.clientY));
        if (!hit || hit.type !== 'ring') return;
        e.preventDefault();
        if (this.wheelLock && performance.now() - this.wheelLock < 140) return;
        this.wheelLock = performance.now();
        this.tryRotate(hit.index, e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  pointerDown(e) {
    if (!this.inputEnabled || !this.level || this.press) return;
    const [ux, uy] = this.units(e.clientX, e.clientY);
    const hit = this.hitTest(ux, uy);
    if (!hit) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const press = { id: e.pointerId, hit, x0: e.clientX, y0: e.clientY, moved: false };
    if (hit.type === 'ring') {
      const ring = this.geo.rings[hit.index];
      press.lastAngle = Math.atan2(uy - ring.y, ux - ring.x);
      press.delta = 0;
    }
    this.press = press;
  }

  pointerMove(e) {
    const [ux, uy] = this.units(e.clientX, e.clientY);
    if (!this.press) {
      if (e.pointerType === 'mouse') {
        this.hover = this.inputEnabled ? this.hitTest(ux, uy) : null;
        this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
      }
      return;
    }
    if (e.pointerId !== this.press.id) return;
    const p = this.press;
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > TAP_SLOP) {
      p.moved = true;
      if (p.hit.type === 'ring') {
        const ring = this.level.rings[p.hit.index];
        if (ring.locked) {
          this.invalid(p.hit.index, 'locked');
          this.press = null;
          return;
        }
        this.drag = { ring: p.hit.index, delta: 0 };
        this.finishSwaps();
        this.onDragStart(p.hit.index);
      }
    }
    if (this.drag && p.hit.type === 'ring') {
      const ring = this.geo.rings[p.hit.index];
      const a = Math.atan2(uy - ring.y, ux - ring.x);
      // ignore jitter right at the hub
      if (Math.hypot(ux - ring.x, uy - ring.y) > 0.25) {
        p.delta += angDiff(a, p.lastAngle);
        p.lastAngle = a;
      }
      const oneway = this.level.rings[p.hit.index].oneway;
      this.drag.delta = oneway && p.delta < 0 ? p.delta * 0.18 : p.delta;
      this.applyDragVisual();
    }
  }

  applyDragVisual() {
    const { ring, delta } = this.drag;
    this.rot[ring].off = delta;
    this.rot[ring].vel = 0;
    const partner = this.partnerOf(ring);
    if (partner >= 0) {
      const ratio = this.level.rings[ring].n / this.level.rings[partner].n;
      this.rot[partner].off = -delta * ratio;
      this.rot[partner].vel = 0;
    }
  }

  pointerUp(e) {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.press = null;
    if (!p.moved) {
      if (p.hit.type === 'bridge') this.trySwap(p.hit.index);
      else this.tryRotate(p.hit.index, 1);
      return;
    }
    if (this.drag) this.finishDrag(p.delta);
  }

  cancelPress() {
    this.press = null;
    if (this.drag) {
      this.drag = null; // springs bring the rings back
    }
  }

  finishDrag(rawDelta) {
    const { ring: r } = this.drag;
    this.drag = null;
    const ring = this.level.rings[r];
    const step = TAU / ring.n;
    let k = Math.round(rawDelta / step);
    if (ring.oneway) {
      if (k < 0 || rawDelta < -step * 0.35) {
        this.invalid(r, 'oneway');
        return;
      }
      k = k % ring.n;
    } else {
      k = ((k % ring.n) + ring.n) % ring.n;
      if (k > ring.n / 2) k -= ring.n;
    }
    if (k === 0) return; // springs back
    const id = `r${r}${k > 0 ? '+' : '-'}`;
    const ids = new Array(Math.abs(k)).fill(id);
    // Visual continuity: keep the orbs where the finger left them.
    const rawK = Math.round(rawDelta / step);
    this.pendingDrag = { ring: r, residual: rawDelta - rawK * step, ratio: ring.n };
    this.onAction(ids, { drag: true });
    this.pendingDrag = null;
  }

  tryRotate(r, dir) {
    const ring = this.level.rings[r];
    if (ring.locked) return this.invalid(r, 'locked');
    if (ring.oneway && dir < 0) return this.invalid(r, 'oneway');
    this.onAction([`r${r}${dir > 0 ? '+' : '-'}`], {});
  }

  trySwap(i) {
    this.onAction([`b${i}`], {});
  }

  invalid(r, kind) {
    this.shakes.set(r, this.time);
    this.onInvalid(kind, r);
  }

  partnerOf(r) {
    for (const [a, b] of this.level.gears || []) {
      if (a === r) return b;
      if (b === r) return a;
    }
    return -1;
  }

  // ---- animation ----------------------------------------------------------

  finishSwaps() {
    this.swaps = [];
  }

  /** Animate an action that has just been applied to the game state. */
  animate(ids, { reverse = false } = {}) {
    this.finishSwaps();
    const seq = reverse ? ids.slice().reverse() : ids;
    const drag = this.pendingDrag;
    for (const id of seq) {
      const m = this.game.byId.get(id);
      if (m.type === 'rotate') {
        const dir = reverse ? -m.dir : m.dir;
        this.kick(m.ring, dir);
        const partner = this.partnerOf(m.ring);
        if (partner >= 0) this.kick(partner, -dir);
      } else {
        const b = this.level.bridges[m.bridge];
        this.swaps.push({ a: this.off[b.a] + b.sa, b: this.off[b.b] + b.sb, bridge: m.bridge, t: 0 });
      }
    }
    if (drag) {
      // The finger already moved the orbs; start the spring from there.
      const step = TAU / this.level.rings[drag.ring].n;
      this.rot[drag.ring].off = drag.residual;
      this.rot[drag.ring].vel = 0;
      const partner = this.partnerOf(drag.ring);
      if (partner >= 0) {
        const pstep = TAU / this.level.rings[partner].n;
        this.rot[partner].off = (-drag.residual / step) * pstep;
        this.rot[partner].vel = 0;
      }
    }
  }

  kick(r, dir) {
    this.rot[r].off -= dir * (TAU / this.level.rings[r].n);
  }

  showHint(moveId, persistent = false) {
    this.hint = moveId ? { id: moveId, t0: this.time, persistent } : null;
  }

  celebrate() {
    this.winT = this.time;
    this.level.rings.forEach((_, r) => this.burst(r, 26));
  }

  burst(r, count = 14) {
    const ring = this.geo.rings[r];
    const color = COLORS[this.game.cells[this.off[r]]].hex;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const [x, y] = this.px(ring.x + Math.cos(a) * ring.r, ring.y + Math.sin(a) * ring.r);
      const sp = (40 + Math.random() * 120) * (this.s / 60);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.7 + Math.random() * 0.6,
        age: 0,
        size: 1.5 + Math.random() * 2.5,
        color,
      });
    }
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      const dt = Math.min(1 / 30, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** True while any orb is still moving (used by tests and the controller). */
  get busy() {
    return (
      this.swaps.length > 0 || (this.rot || []).some((r) => Math.abs(r.off) > 0.002 || Math.abs(r.vel) > 0.01)
    );
  }

  update(dt) {
    this.time += dt;
    if (!this.level) return;
    const dragRing = this.drag ? this.drag.ring : -1;
    const dragPartner = dragRing >= 0 ? this.partnerOf(dragRing) : -1;
    this.rot.forEach((r, i) => {
      if (i === dragRing || i === dragPartner) return;
      r.vel += (-SPRING_K * r.off - SPRING_D * r.vel) * dt;
      r.off += r.vel * dt;
      if (Math.abs(r.off) < 0.0008 && Math.abs(r.vel) < 0.005) {
        r.off = 0;
        r.vel = 0;
      }
    });
    for (const s of this.swaps) s.t += dt / SWAP_DUR;
    this.swaps = this.swaps.filter((s) => s.t < 1);
    this.level.rings.forEach((_, r) => {
      const target = this.game.ringSolved(r) ? 1 : 0;
      this.glow[r] += (target - this.glow[r]) * Math.min(1, dt * 6);
    });
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      p.vx *= 0.985;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // ---- drawing --------------------------------------------------------------

  draw() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!this.level) return;
    const s = this.s;
    const L = this.level;

    const shakeX = (r) => {
      const t0 = this.shakes.get(r);
      if (t0 === undefined) return 0;
      const t = this.time - t0;
      if (t > 0.5) {
        this.shakes.delete(r);
        return 0;
      }
      return Math.sin(t * 46) * Math.exp(-t * 7) * 0.14;
    };
    const centers = this.geo.rings.map((ring, r) => [ring.x + shakeX(r), ring.y]);
    const winPulse = this.winT === null ? 0 : Math.max(0, 1 - (this.time - this.winT) / 1.2);

    // gear chains, bowed so they do not run along the bridges
    for (const [a, b] of L.gears || []) {
      const [x1, y1] = this.px(...centers[a]);
      const [x2, y2] = this.px(...centers[b]);
      const mx = (x1 + x2) / 2 - (y2 - y1) * 0.28;
      const my = (y1 + y2) / 2 + (x2 - x1) * 0.28;
      g.save();
      g.strokeStyle = 'rgba(255,214,140,0.55)';
      g.lineWidth = Math.max(2, s * 0.07);
      g.setLineDash([s * 0.12, s * 0.1]);
      g.lineDashOffset = -this.rot[a].off * s * 2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo(mx, my, x2, y2);
      g.stroke();
      g.restore();
    }

    // bridge rails
    L.bridges.forEach((_, i) => {
      const [p, q] = this.bridgeEnds(i).map(([x, y]) => this.px(x, y));
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * s * 0.1;
      const ny = (dx / len) * s * 0.1;
      const hot = this.isHot('bridge', i);
      g.strokeStyle = hot ? '#ffe2a8' : BRASS_DIM;
      g.lineWidth = Math.max(1.5, s * 0.045);
      g.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(p[0] + nx * sgn, p[1] + ny * sgn);
        g.lineTo(q[0] + nx * sgn, q[1] + ny * sgn);
        g.stroke();
      }
    });

    // rings: tracks, sockets, arms, hubs
    L.rings.forEach((ring, r) => {
      const geo = this.geo.rings[r];
      const [cx, cy] = this.px(...centers[r]);
      const R = geo.r * s;
      const glow = this.glow[r];
      const color = COLORS[this.game.cells[this.off[r]]];
      const hot = this.isHot('ring', r);
      const off = this.rot[r].off;

      // halo when solved
      if (glow > 0.01) {
        const halo = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R + s * 0.9);
        halo.addColorStop(0, 'rgba(0,0,0,0)');
        halo.addColorStop(0.55, hexA(color.hex, 0.22 * glow + 0.25 * winPulse));
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = halo;
        g.beginPath();
        g.arc(cx, cy, R + s * 0.9, 0, TAU);
        g.fill();
      }

      // track
      g.save();
      g.lineWidth = Math.max(2, s * 0.13);
      if (ring.locked) g.setLineDash([s * 0.18, s * 0.12]);
      g.strokeStyle = hot ? 'rgba(255,226,168,0.75)' : 'rgba(227,196,139,0.42)';
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();
      if (glow > 0.01) {
        // layered strokes instead of shadowBlur (cheap on software renderers)
        g.setLineDash([]);
        g.strokeStyle = hexA(color.hex, 0.18 * glow);
        g.lineWidth = Math.max(4, s * 0.34);
        g.stroke();
        g.strokeStyle = hexA(color.hex, 0.85 * glow);
        g.lineWidth = Math.max(2, s * 0.08);
        g.stroke();
      }
      g.restore();

      // one-way chevrons between slots
      if (ring.oneway) {
        g.fillStyle = 'rgba(255,226,168,0.8)';
        for (let k = 0; k < ring.n; k++) {
          const a = slotAngle(geo, k) + Math.PI / ring.n + off;
          drawChevron(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, a + Math.PI / 2, s * 0.13);
        }
      }

      // arms from hub to every slot (rotate with the ring)
      g.strokeStyle = BRASS_DIM;
      g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath();
      for (let k = 0; k < ring.n; k++) {
        const a = slotAngle(geo, k) + off;
        g.moveTo(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3);
        g.lineTo(cx + Math.cos(a) * (R - ORB_R * s), cy + Math.sin(a) * (R - ORB_R * s));
      }
      g.stroke();

      // empty sockets (visible during motion)
      g.fillStyle = 'rgba(8,10,30,0.55)';
      for (let k = 0; k < ring.n; k++) {
        const a = slotAngle(geo, k);
        g.beginPath();
        g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, ORB_R * s * 0.82, 0, TAU);
        g.fill();
      }

      drawHub(g, ring, cx, cy, s, off, this.partnerOf(r) >= 0);
    });

    // bridge buttons
    L.bridges.forEach((_, i) => {
      const [mx, my] = this.px(...this.bridgeMid(i));
      const [p, q] = this.bridgeEnds(i);
      const hot = this.isHot('bridge', i);
      const active = this.swaps.find((sw) => sw.bridge === i);
      const pulse = active ? Math.sin(active.t * Math.PI) : 0;
      const rad = s * (0.27 + 0.05 * pulse);
      g.fillStyle = hot ? '#3a3260' : '#221d45';
      g.strokeStyle = hot || active ? '#ffe2a8' : BRASS;
      g.lineWidth = Math.max(1.5, s * 0.05);
      g.beginPath();
      g.arc(mx, my, rad, 0, TAU);
      g.fill();
      g.stroke();
      drawSwapGlyph(g, mx, my, Math.atan2(q[1] - p[1], q[0] - p[0]), rad * 0.62, hot || active ? '#fff3d6' : BRASS);
    });

    // orbs
    const swapOf = new Map();
    for (const sw of this.swaps) {
      swapOf.set(sw.a, { from: sw.b, sw, sign: 1 });
      swapOf.set(sw.b, { from: sw.a, sw, sign: -1 });
    }
    const sp = this.sprites;
    const drawn = [];
    L.rings.forEach((ring, r) => {
      const off = this.rot[r].off;
      for (let k = 0; k < ring.n; k++) {
        const gIdx = this.off[r] + k;
        const color = this.game.cells[gIdx];
        let [ux, uy] = this.slotPoint(r, k, off);
        ux += centers[r][0] - this.geo.rings[r].x;
        let scale = 1 + winPulse * 0.12 * Math.sin((this.time - (this.winT || 0)) * 10 + r);
        const swp = swapOf.get(gIdx);
        let lift = 0;
        if (swp) {
          const fr = this.globalSlotPoint(swp.from);
          const e = easeInOut(Math.min(1, swp.sw.t));
          const tx = ux;
          const ty = uy;
          ux = fr[0] + (tx - fr[0]) * e;
          uy = fr[1] + (ty - fr[1]) * e;
          const dx = tx - fr[0];
          const dy = ty - fr[1];
          const len = Math.hypot(dx, dy) || 1;
          const h = Math.sin(e * Math.PI) * 0.45 * swp.sign;
          ux += (-dy / len) * h;
          uy += (dx / len) * h;
          lift = Math.sin(e * Math.PI);
          scale *= 1 + 0.18 * lift;
        }
        drawn.push({ ux, uy, color, scale, lift });
      }
    });
    drawn.sort((a, b) => a.lift - b.lift);
    for (const o of drawn) {
      const [x, y] = this.px(o.ux, o.uy);
      const img = sp[o.color];
      const w = (img.width / this.dpr) * o.scale;
      g.drawImage(img, x - w / 2, y - w / 2, w, w);
    }

    this.drawHint(g, centers);

    // particles
    if (this.particles.length) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        const a = 1 - p.age / p.life;
        g.fillStyle = hexA(p.color, a);
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.5 + a * 0.5) * (s / 60), 0, TAU);
        g.fill();
      }
      g.restore();
    }
  }

  globalSlotPoint(gIdx) {
    for (let r = this.off.length - 1; r >= 0; r--) {
      if (gIdx >= this.off[r]) return this.slotPoint(r, gIdx - this.off[r], this.rot[r].off);
    }
    return [0, 0];
  }

  isHot(type, index) {
    if (this.drag) return type === 'ring' && this.drag.ring === index;
    if (this.press && !this.press.moved) return this.press.hit.type === type && this.press.hit.index === index;
    return this.hover && this.hover.type === type && this.hover.index === index;
  }

  drawHint(g, centers) {
    if (!this.hint) return;
    const t = this.time - this.hint.t0;
    if (!this.hint.persistent && t > 3.2) {
      this.hint = null;
      return;
    }
    const s = this.s;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    const id = this.hint.id;
    g.save();
    g.strokeStyle = `rgba(255,240,200,${0.55 + 0.45 * pulse})`;
    g.lineWidth = Math.max(2, s * 0.06);
    if (id[0] === 'b') {
      const [mx, my] = this.px(...this.bridgeMid(Number(id.slice(1))));
      g.beginPath();
      g.arc(mx, my, s * (0.42 + 0.06 * pulse), 0, TAU);
      g.stroke();
    } else {
      const r = parseInt(id.slice(1), 10);
      const dir = id.endsWith('+') ? 1 : -1;
      const geo = this.geo.rings[r];
      const [cx, cy] = this.px(...centers[r]);
      const R = (geo.r + ORB_R + 0.28) * s;
      const a0 = -Math.PI / 2 - dir * 0.9;
      const sweep = dir * (1.2 + 0.25 * pulse);
      g.beginPath();
      g.arc(cx, cy, R, a0, a0 + sweep, dir < 0);
      g.stroke();
      const ae = a0 + sweep;
      g.fillStyle = g.strokeStyle;
      drawChevron(g, cx + Math.cos(ae) * R, cy + Math.sin(ae) * R, ae + (dir * Math.PI) / 2, s * 0.2);
    }
    g.restore();
  }
}

// ---- drawing helpers --------------------------------------------------------

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function drawChevron(g, x, y, dir, size) {
  g.save();
  g.translate(x, y);
  g.rotate(dir);
  g.beginPath();
  g.moveTo(size * 0.7, 0);
  g.lineTo(-size * 0.5, -size * 0.6);
  g.lineTo(-size * 0.2, 0);
  g.lineTo(-size * 0.5, size * 0.6);
  g.closePath();
  g.fill();
  g.restore();
}

function drawSwapGlyph(g, x, y, angle, size, color) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.2, size * 0.18);
  g.lineCap = 'round';
  for (const sgn of [-1, 1]) {
    const yy = sgn * size * 0.32;
    g.beginPath();
    g.moveTo(-size * 0.6 * sgn, yy);
    g.lineTo(size * 0.45 * sgn, yy);
    g.stroke();
    g.beginPath();
    g.moveTo(size * 0.8 * sgn, yy);
    g.lineTo(size * 0.35 * sgn, yy - size * 0.3);
    g.lineTo(size * 0.35 * sgn, yy + size * 0.3);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function drawHub(g, ring, cx, cy, s, off, geared) {
  const r = s * 0.3;
  g.save();
  g.translate(cx, cy);
  if (geared) {
    g.rotate(off);
    g.fillStyle = '#d9b46e';
    g.beginPath();
    const teeth = 8;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const rr = i % 2 ? r * 0.78 : r * 1.05;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#2a2350';
    g.beginPath();
    g.arc(0, 0, r * 0.36, 0, TAU);
    g.fill();
  } else if (ring.locked) {
    g.fillStyle = '#2a2350';
    g.strokeStyle = '#9fb0d9';
    g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath();
    g.arc(0, 0, r * 1.05, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = '#c8d4f2';
    g.beginPath();
    g.roundRect(-r * 0.45, -r * 0.1, r * 0.9, r * 0.65, r * 0.1);
    g.fill();
    g.strokeStyle = '#c8d4f2';
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.beginPath();
    g.arc(0, -r * 0.12, r * 0.28, Math.PI, 0);
    g.stroke();
  } else if (ring.oneway) {
    g.fillStyle = '#2a2350';
    g.strokeStyle = BRASS;
    g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath();
    g.arc(0, 0, r * 1.05, 0, TAU);
    g.fill();
    g.stroke();
    g.strokeStyle = '#ffe2a8';
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.beginPath();
    g.arc(0, 0, r * 0.55, -Math.PI * 0.9, Math.PI * 0.35);
    g.stroke();
    g.fillStyle = '#ffe2a8';
    const ae = Math.PI * 0.35;
    drawChevron(g, Math.cos(ae) * r * 0.55, Math.sin(ae) * r * 0.55, ae + Math.PI / 2, r * 0.38);
  } else {
    g.rotate(off);
    const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#fff0c9');
    grad.addColorStop(1, '#b88d4a');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, r * 0.62, 0, TAU);
    g.fill();
    g.fillStyle = '#2a2350';
    g.beginPath();
    g.arc(0, 0, r * 0.2, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Color-blind helper glyphs: circle, triangle, square, diamond, star, cross. */
export function drawGlyph(g, i, x, y, size) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.strokeStyle = 'rgba(255,255,255,0.88)';
  g.lineWidth = size * 0.32;
  g.lineJoin = 'round';
  g.beginPath();
  switch (i) {
    case 0:
      g.arc(0, 0, size * 0.55, 0, TAU);
      g.fill();
      break;
    case 1:
      g.moveTo(0, -size * 0.75);
      g.lineTo(size * 0.7, size * 0.5);
      g.lineTo(-size * 0.7, size * 0.5);
      g.closePath();
      g.fill();
      break;
    case 2:
      g.rect(-size * 0.52, -size * 0.52, size * 1.04, size * 1.04);
      g.fill();
      break;
    case 3:
      g.moveTo(0, -size * 0.8);
      g.lineTo(size * 0.62, 0);
      g.lineTo(0, size * 0.8);
      g.lineTo(-size * 0.62, 0);
      g.closePath();
      g.fill();
      break;
    case 4:
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? size * 0.36 : size * 0.85;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    default:
      g.moveTo(-size * 0.6, 0);
      g.lineTo(size * 0.6, 0);
      g.moveTo(0, -size * 0.6);
      g.lineTo(0, size * 0.6);
      g.stroke();
  }
  g.restore();
}
