// Render-side effects: particles, floating numbers, banners, lightning, rings, screen shake, hit-stop.
// Consumes FxEvents from the sim; never touches sim state.
import type { FxEvent, TargetKind, Vec } from '../core/types';
import { TABLE } from '../core/types';
import { PALETTE } from './palette';
import { drawText, textWidth } from './text';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Floater { x: number; y: number; text: string; color: string; life: number; max: number }
interface Banner { text: string; color: string; life: number; max: number; scale: number; keep?: boolean }
interface Bolt { pts: Vec[]; life: number }
interface Tracer { x0: number; y0: number; x1: number; y1: number; life: number }
interface Ring { x: number; y: number; r: number; life: number; max: number; color?: string; color2?: string; inward?: boolean }

const P = PALETTE;
/** First Overtime wave number (stage waves + boss wave + 1). */
const BANNER_CAP = 3;
const KIND_COLORS: Record<TargetKind, string[]> = {
  frost: [P.c, P['5'], P.B],
  cadre: [P.B, P.c, P.b],
  grunt: [P.R, P.p, P.r],
  skirmisher: [P.B, P.c, P.b],
  bouncer: [P.E, P.e, P.h],
  bomber: [P.o, P.Y, P.R],
  broodmother: [P.M, P.m, P.p],
  grub: [P.p, P.R],
  thornback: [P['3'], P.E, P['2']],
  brute: [P['3'], P['4'], P['2']],
  cleric: [P.M, P.m, P.B],
  hive: [P.o, P.y, P.Y],
  boss: [P['0'], P['3'], P['5'], P.Y],
};

const TRICK_NAMES: Record<string, string> = { recall: 'RECALL', timeStop: 'TIME STOP', rackEm: "RACK 'EM", shockwave: 'SHOCKWAVE' };
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class Fx {
  particles: Particle[] = [];
  floaters: Floater[] = [];
  banners: Banner[] = [];
  bolts: Bolt[] = [];
  rings: Ring[] = [];
  tracers: Tracer[] = [];
  shake = 0;
  /** Seconds of hero hit-flash remaining. */
  heroFlash = 0;
  /** Seconds of red enrage vignette remaining. */
  vignette = 0;
  /** Render frames of sim freeze remaining. */
  hitStop = 0;
  shakeEnabled = true;
  /** false = reduced flashing: alpha-fade banners, solid bolts. */
  flashEnabled = true;
  /** Ball position (set by the run screen) for the shoot puff. */
  ballPos: Vec | null = null;
  /** Boss display name for the arrival banner (set by the run screen). */
  bossName = '';
  /** Regular waves before the boss (stage.waves.length); Overtime starts two waves later. */
  waves = 3;
  private clock = 0;
  /** Where the ball was just before a trick fired (set by the run screen) for the Recall trail. */
  trickFrom: Vec | null = null;

  clear(): void {
    this.particles.length = 0;
    this.floaters.length = 0;
    this.banners.length = 0;
    this.bolts.length = 0;
    this.rings.length = 0;
    this.tracers.length = 0;
    this.heroFlash = 0;
    this.vignette = 0;
    this.shake = 0;
    this.hitStop = 0;
  }

  private burst(x: number, y: number, colors: string[], n: number, speed: number, life = 0.5, g = 120, size = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(speed * 0.4, speed);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rnd(life * 0.6, life), max: life, color: colors[i % colors.length], size, g,
      });
    }
  }

  /** Wave number whose banner waits for the arriving enemies to turn solid (0 = none). */
  pendingWave = 0;

  /** Show the pending "WAVE n" banner (call once arrivals are solid). */
  releaseWave(): void {
    if (this.pendingWave > 0) this.banner(`WAVE ${this.pendingWave}`, P.Y, 3, 1.1);
    this.pendingWave = 0;
  }

  /** Newly staggered enemy: small star burst. */
  /** Per-shot hit count, shown on settle regardless of the Chain unlock so multi-hit shots always read. */
  hits(x: number, y: number, n: number): void {
    this.floater(x, y - 14, `${n} HITS`, n >= 3 ? P.Y : P['4']);
  }

  stagger(x: number, y: number): void {
    this.burst(x, y, [P.Y, P['5']], 6, 35, 0.4, 0, 2);
  }

  private floater(x: number, y: number, text: string, color: string): void {
    const w = textWidth(text);
    const cx = Math.max(TABLE.x + w / 2, Math.min(TABLE.x + TABLE.w - w / 2, x));
    this.floaters.push({ x: cx, y: y - 6, text, color, life: 0.9, max: 0.9 });
  }

  /** Banners stack up to BANNER_CAP; the oldest non-`keep` one makes room (WAVE CLEAR is never dropped). */
  private banner(text: string, color: string, scale: number, life: number, keep = false): void {
    if (textWidth(text, scale) > 168) scale = Math.max(1, scale - 1);
    this.banners.push({ text, color, life, max: life, scale, keep });
    while (this.banners.length > BANNER_CAP) {
      const i = this.banners.findIndex((b) => !b.keep);
      this.banners.splice(i >= 0 ? i : 0, 1);
    }
  }

  /** Banner + effect for a trick use. The ball is already at its destination; trickFrom is where it was. */
  trick(id: string): void {
    const name = TRICK_NAMES[id] ?? id.toUpperCase();
    const b = this.ballPos;
    this.banner(id === 'timeStop' ? 'TIME STOP' : name, P.c, 2, 1.1);
    if (!b) return;
    if (id === 'recall') {
      const f = this.trickFrom;
      if (f) {
        const n = Math.max(6, Math.round(Math.hypot(b.x - f.x, b.y - f.y) / 5));
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          this.particles.push({ x: f.x + (b.x - f.x) * k, y: f.y + (b.y - f.y) * k, vx: rnd(-6, 6), vy: rnd(-6, 6), life: 0.25 + 0.3 * k, max: 0.55, color: i % 2 ? P.c : P['5'], size: 1, g: 0 });
        }
        this.burst(f.x, f.y, [P.c, P['5']], 8, 50, 0.3, 0);
      }
      this.rings.push({ x: b.x, y: b.y, r: 14, life: 0.3, max: 0.3, color: P.c, color2: P['5'] });
    } else if (id === 'rackEm') {
      this.rings.push({ x: TABLE.x + TABLE.w / 2, y: TABLE.y + TABLE.h / 2 - 20, r: 90, life: 0.5, max: 0.5, color: P.M, color2: P.c, inward: true });
    } else if (id === 'shockwave') {
      this.rings.push({ x: b.x, y: b.y, r: 60, life: 0.4, max: 0.4, color: P.c, color2: P['5'] });
      this.addShake(1);
    } else if (id === 'timeStop') {
      this.rings.push({ x: b.x, y: b.y, r: 50, life: 0.5, max: 0.5, color: P.B, color2: P['5'] });
    }
    this.trickFrom = null;
  }

  /** The skipped enemy phase just passed. */
  timeStopSpent(): void {
    this.banner('TIME STOPPED', P.c, 2, 1.0);
  }

  private addShake(v: number): void {
    this.shake = Math.max(this.shake, v);
  }

  private stop(frames: number): void {
    this.hitStop = Math.max(this.hitStop, frames);
  }

  consume(events: FxEvent[]): void {
    let combos = 0; // combo floaters this batch stack upward above the hero
    for (const e of events) {
      switch (e.t) {
        case 'boardClear':
          this.banner('WAVE CLEAR', P.Y, 3, 1.3, true);
          this.rings.push({ x: e.x, y: e.y, r: 40, life: 0.5, max: 0.5 });
          this.rings.push({ x: e.x, y: e.y, r: 70, life: 0.7, max: 0.7 });
          this.burst(e.x, e.y, [P.Y, P['5'], P.E, P.c], 24, 90, 0.7, 20, 2);
          break;
        case 'waveStart':
          this.pendingWave = e.overtime ? 0 : e.wave;
          if (e.overtime) {
            if (e.wave === this.waves + 2) this.banner('OVERTIME!', P.o, 3, 1.5);
            else this.banner(`OVERTIME +${e.wave - (this.waves + 2) + 1}`, P.o, 2, 1.0);
          }
          break;
        case 'heroHit': {
          this.heroFlash = this.flashEnabled ? 0.3 : 0.15;
          this.floater(e.x, e.y - 12, `-${fmt(e.dmg)}`, P.R);
          this.burst(e.x, e.y, [P.R, P.p, P['5']], e.how === 'blast' ? 10 : 6, 60, 0.35, 80, 2);
          this.addShake(e.how === 'charge' ? 1.6 : 1);
          if (e.how === 'charge') this.stop(4);
          break;
        }
        case 'heroHeal':
          if (e.amount > 0) this.floater(e.x, e.y - 12, `+${fmt(e.amount)}`, P.E);
          break;
        case 'blocked':
          this.burst(e.x, e.y, [P['5'], P.Y, P.S], 6, 55, 0.22, 0);
          break;
        case 'tracer':
          this.tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0.15 });
          break;
        case 'stagger':
          this.stagger(e.x, e.y - 8);
          break;
        case 'enrage':
          this.vignette = this.flashEnabled ? 0.7 : 0.9;
          this.banner(`RAGE +${e.level}`, P.R, 2, 0.9);
          break;
        case 'jam':
          this.burst(e.x, e.y, [P['4'], P['3']], 5, 30, 0.3, 0);
          break;
        case 'runOver':
          this.banner('YOU FELL', P.R, 3, 0.8);
          break;
        case 'kill':
          this.burst(e.x, e.y, KIND_COLORS[e.targetKind] ?? [P.R], e.targetKind === 'boss' ? 30 : 10, 70, 0.55, 140, 2);
          if (e.cash > 0) this.floater(e.x, e.y, `+${fmt(e.cash)}`, P.Y);
          this.stop(4);
          this.addShake(e.targetKind === 'boss' ? 2 : 0.8);
          break;
        case 'hit':
          if (e.dmg <= 0) this.burst(e.x, e.y, [P['5'], P.S], 3, 45, 0.15, 0); // deflect spark, no number
          else this.burst(e.x, e.y, [P['5'], KIND_COLORS[e.targetKind]?.[0] ?? P.R], 2, 30, 0.2, 0);
          break;
        case 'telegraph':
          this.burst(e.x, e.y, e.kind === 'freeze' ? [P.c, P['5']] : e.kind === 'spawn' ? [P.o, P.Y] : [P.M, P.B], 3, 22, 0.25, 0);
          break;
        case 'shieldUp':
          this.burst(e.x, e.y, [P.B, P['5'], P.c], 8, 40, 0.5, -15);
          break;
        case 'shieldBreak':
          this.burst(e.x, e.y, [P.B, P['5'], P.b, P.c], 12, 80, 0.4, 120);
          break;
        case 'freeze':
          this.burst(e.x, e.y, [P.c, P['5'], P.B], 10, 55, 0.5, 20);
          break;
        case 'thaw':
          this.burst(e.x, e.y, [P.c, P.b], 5, 18, 0.5, 160);
          break;
        case 'shatter':
          this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35, color: P.c, color2: P['5'] });
          this.burst(e.x, e.y, [P.c, P['5'], P.B, P.b], 18, 110, 0.5, 90, 2);
          this.addShake(this.shakeEnabled ? 1.5 : 0);
          this.stop(3);
          break;
        case 'wall':
          this.burst(e.x, e.y, [P.S, P['4']], 3, 30, 0.25, 0);
          break;
        case 'bumper':
          this.burst(e.x, e.y, [P.Y, P.o, P['5']], 6, 55, 0.3, 0);
          this.addShake(0.4);
          break;
        case 'explode':
          this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35 });
          this.burst(e.x, e.y, [P.o, P.Y, P.R, P['5']], 16, 90, 0.5, 40, 2);
          this.addShake(2);
          break;
        case 'lightning': {
          const pts: Vec[] = [];
          for (let i = 0; i < e.points.length; i++) {
            const a = e.points[i];
            pts.push({ x: a.x, y: a.y });
            const b = e.points[i + 1];
            if (b) {
              const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 8));
              for (let k = 1; k < n; k++) {
                pts.push({ x: a.x + ((b.x - a.x) * k) / n + rnd(-2, 2), y: a.y + ((b.y - a.y) * k) / n + rnd(-2, 2) });
              }
            }
          }
          this.bolts.push({ pts, life: 0.15 });
          break;
        }
        case 'split':
        case 'spit':
          this.burst(e.x, e.y, [P.c, P.B, P['5']], 4, 40, 0.25, 0);
          break;
        case 'combo': {
          const text = e.mult === 1 ? e.name.toUpperCase() : `${e.name.toUpperCase()} x${Math.round(e.mult * 100) / 100}`;
          // Banners are for WAVE / SWEEP / BOSS / OVERTIME / RAGE / YOU FELL; other combos float at the hero.
          if (e.name === 'SWEEP') this.banner(text, P.Y, 2, 1.1);
          else this.floater(e.x, e.y - 26 - 8 * combos++, text, P.Y);
          break;
        }
        case 'bossArrive':
          this.pendingWave = 0;
          this.banner('BOSS!', P.R, 4, 1.6);
          if (this.bossName) this.banner(this.bossName.toUpperCase(), P.p, 2, 1.6);
          this.stop(6);
          this.addShake(3.2); // ~0.4 s at 8/s decay, capped to 2px offset
          break;
        case 'bossPhase':
          this.stop(8);
          this.addShake(2);
          this.banner('ENRAGED!', P.o, 2, 1.0);
          break;
        case 'bossDead':
          this.stop(8);
          this.addShake(2);
          this.burst(e.x, e.y, [P.Y, P['5'], P.o, P.R, P.E], 40, 110, 0.9, 100, 2);
          this.banner('BOSS DOWN!', P.Y, 3, 1.8);
          break;
        case 'emerald':
          this.floater(e.x, e.y, `+${fmt(e.amount)}`, P.E);
          break;
        case 'chest':
          this.floater(e.x, e.y, `+${fmt(e.cash)}`, P.Y);
          this.burst(e.x, e.y, [P.Y, P['5']], 8, 60, 0.5, 100);
          break;
        case 'shrine':
          this.burst(e.x, e.y, [P.M, P.c, P['5']], 10, 50, 0.6, -20);
          break;
        case 'shoot':
          if (this.ballPos) this.burst(this.ballPos.x, this.ballPos.y, [P['5'], P['4']], 4, 28, 0.25, 0);
          break;
        case 'poisonTick':
          this.floater(e.x, e.y - 6, `-${fmt(e.dmg)}`, P.E);
          this.burst(e.x, e.y, [P.E, P.e, P.h], 7, 22, 0.55, -40, 2);
          break;
        case 'status':
          break;
        case 'mirror': {
          const h = this.ballPos;
          if (h) {
            this.tracers.push({ x0: h.x, y0: h.y, x1: e.x, y1: e.y, life: 0.2 });
            this.rings.push({ x: h.x, y: h.y, r: 12, life: 0.2, max: 0.2, color: P.c, color2: P['5'] });
            this.burst(h.x, h.y, [P.c, P['5'], P.B], 6, 40, 0.25, 0, 1);
          }
          this.burst(e.x, e.y, [P.c, P['5']], 4, 30, 0.2, 0);
          break;
        }
        case 'blast':
          this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35, color: P.o, color2: P.Y });
          this.burst(e.x, e.y, [P.o, P.Y, P.R, P['5']], 12, 80, 0.45, 40, 2);
          this.addShake(1.4);
          break;
        case 'shard':
          this.burst(e.x, e.y, [P['5'], P.c, P.Y], 3, 50, 0.2, 0);
          break;
        case 'trick':
          this.trick(e.id);
          break;
        case 'shimmer':
        case 'ballClack':
        case 'launch':
          break;
      }
    }
  }

  update(dt: number): void {
    this.clock += dt;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 14 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const b of this.banners) b.life -= dt;
    this.banners = this.banners.filter((b) => b.life > 0);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.heroFlash = Math.max(0, this.heroFlash - dt);
    this.vignette = Math.max(0, this.vignette - dt);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    this.shake = Math.max(0, this.shake - 8 * dt);
  }

  /** Pixel offset for this frame, magnitude <= 2. */
  shakeOffset(): Vec {
    if (!this.shakeEnabled || this.shake <= 0.05) return { x: 0, y: 0 };
    const m = Math.min(2, this.shake);
    return { x: Math.round(rnd(-m, m)), y: Math.round(rnd(-m, m)) };
  }

  /** World-layer effects (under HUD text). */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const rad = r.inward ? r.r * (1 - 0.7 * k) : r.r * (0.3 + 0.7 * k);
      ctx.fillStyle = k < 0.5 ? (r.color2 ?? P.Y) : (r.color ?? P.o);
      const steps = Math.max(24, Math.round(rad * 3));
      ctx.globalAlpha = 1 - k * 0.7;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.4));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const t of this.tracers) {
      const k = 1 - t.life / 0.15;
      ctx.globalAlpha = 1 - k * 0.5;
      ctx.fillStyle = P.Y;
      pxLine(ctx, { x: t.x0, y: t.y0 }, { x: t.x1, y: t.y1 });
      ctx.fillStyle = P['5'];
      const hx = Math.round(t.x0 + (t.x1 - t.x0) * Math.min(1, k * 1.6));
      const hy = Math.round(t.y0 + (t.y1 - t.y0) * Math.min(1, k * 1.6));
      ctx.fillRect(hx - 1, hy - 1, 3, 3);
      ctx.globalAlpha = 1;
    }
    for (const b of this.bolts) {
      const flick = !this.flashEnabled || Math.floor(this.clock * 40) % 2 === 0;
      ctx.fillStyle = flick ? P.Y : P['5'];
      for (let i = 0; i < b.pts.length - 1; i++) pxLine(ctx, b.pts[i], b.pts[i + 1]);
    }
  }

  /** Text layers drawn above everything. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.vignette > 0) {
      const k = this.vignette / (this.flashEnabled ? 0.7 : 0.9);
      ctx.fillStyle = P.R;
      const pulse = this.flashEnabled ? 0.5 + 0.5 * Math.sin(this.vignette * 20) : 1;
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = Math.max(0, k * (0.4 - i * 0.09) * (0.6 + 0.4 * pulse));
        const o = i * 3;
        ctx.fillRect(0, o, 180, 3);
        ctx.fillRect(0, 320 - o - 3, 180, 3);
        ctx.fillRect(o, 0, 3, 320);
        ctx.fillRect(180 - o - 3, 0, 3, 320);
      }
      ctx.globalAlpha = 1;
    }
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.life / (f.max * 0.4));
      drawText(ctx, f.text, f.x, f.y, { color: f.color, shadow: P['0'], align: 'center' });
    }
    ctx.globalAlpha = 1;
    this.banners.forEach((b, i) => {
      const age = b.max - b.life;
      if (b.life < 0.25) {
        if (this.flashEnabled) {
          if (Math.floor(this.clock * 30) % 2 === 0) return;
        } else ctx.globalAlpha = Math.max(0, b.life / 0.25);
      }
      const pop = age < 0.1 ? 1 : 0;
      const y = 118 + i * 22 - pop * 2;
      drawText(ctx, b.text, TABLE.x + TABLE.w / 2, y, { color: b.color, scale: b.scale, align: 'center', shadow: P['0'], shadowOff: b.scale >= 3 ? 2 : 1 });
      ctx.globalAlpha = 1;
    });
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pxLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  let x0 = Math.round(a.x), y0 = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 600; n++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
