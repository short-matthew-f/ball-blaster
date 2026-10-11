// Draws the run view (table, entities, HUD) from RunState. Read-only with respect to sim state.
import type { RunState, Target } from '../core/types';
import { BOSS_ZONE, TABLE, VIEW_H, VIEW_W } from '../core/types';
import { BLAST_HERO_R, ENRAGE_BASE, ENRAGE_PER_WAVE, TARGET_DEFS, WAVES_PER_STAGE, stageById } from '../core/tuning';
import { PALETTE } from './palette';
import { drawSprite, spriteSize, WHITE } from './sprite-cache';
import { drawText } from './text';
import { drawBar } from '../ui/widgets';

const P = PALETTE;

function hash(x: number, y: number): number {
  let h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) % 100;
}

let tableBg: HTMLCanvasElement | null = null;
let menuBg: HTMLCanvasElement | null = null;

function mk(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  return c;
}

function paintFelt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vignette: boolean): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = hash(x + i, y + j);
      // calm woven nap: sparse ordered dark dots, rare light flecks
      let c = P.G;
      if ((i + j * 3) % 8 === 0 && n < 70) c = P.g;
      else if (n === 0) c = P.h;
      if (vignette) {
        const ex = Math.min(i, w - 1 - i), ey = Math.min(j, h - 1 - j);
        const e = Math.min(ex, ey);
        if (e < 5 && (i + j) % 2 === 0 && e < 3) c = P.g;
        else if (e < 8 && (i + j) % 4 === 0 && c === P.G) c = P.g;
      }
      g.fillStyle = c;
      g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** Static run background: HUD band, felt, wood rails, meter band. */
function getTableBg(): HTMLCanvasElement {
  if (tableBg) return tableBg;
  const c = mk();
  const g = c.getContext('2d')!;
  g.fillStyle = P['0'];
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  // HUD + meter bands
  g.fillStyle = P['1'];
  g.fillRect(0, 0, VIEW_W, 28);
  g.fillRect(0, 292, VIEW_W, VIEW_H - 292);
  g.fillStyle = P['2'];
  g.fillRect(0, 27, VIEW_W, 1);
  g.fillRect(0, 292, VIEW_W, 1);
  // rails: outer w, W body, v highlight, dark inner lip
  const rx = TABLE.x - 6, ry = TABLE.y - 6, rw = TABLE.w + 12, rh = TABLE.h + 12;
  g.fillStyle = P.w;
  g.fillRect(rx, ry, rw, rh);
  g.fillStyle = P.W;
  g.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
  g.fillStyle = P.v;
  g.fillRect(rx + 1, ry + 1, rw - 2, 1);
  g.fillRect(rx + 1, ry + 1, 1, rh - 2);
  g.fillStyle = P.w;
  g.fillRect(rx + 4, ry + 4, rw - 8, rh - 8);
  // felt
  paintFelt(g, TABLE.x, TABLE.y, TABLE.w, TABLE.h, true);
  // rail studs (diamonds)
  g.fillStyle = P.Y;
  for (let i = 1; i < 5; i++) {
    g.fillRect(rx + 2, ry + Math.round((rh * i) / 5), 1, 1);
    g.fillRect(rx + rw - 3, ry + Math.round((rh * i) / 5), 1, 1);
  }
  tableBg = c;
  return c;
}

/** Full-screen dark dithered background for menu screens. */
export function getMenuBg(): HTMLCanvasElement {
  if (menuBg) return menuBg;
  const c = mk();
  const g = c.getContext('2d')!;
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      // Bayer-dithered glow fading down from the top, over a sparse diagonal dot grid
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
      const glow = Math.max(0, 1 - y / (VIEW_H * 0.55)) * 0.6;
      const dot = (x + y) % 6 === 0 && y % 3 === 0;
      g.fillStyle = glow > bayer || dot ? P['1'] : P['0'];
      g.fillRect(x, y, 1, 1);
    }
  }
  menuBg = c;
  return c;
}

let feltFull: HTMLCanvasElement | null = null;
/** Full-screen felt (title screen). */
export function getFeltBg(): HTMLCanvasElement {
  if (feltFull) return feltFull;
  const c = mk();
  const g = c.getContext('2d')!;
  paintFelt(g, 0, 0, VIEW_W, VIEW_H, true);
  feltFull = c;
  return c;
}

export function ringDots(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, phase: number, step = 0.35): void {
  ctx.fillStyle = color;
  for (let a = phase % step; a < Math.PI * 2; a += step) {
    ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
  }
}

/** Enemy sprite by kind (v2 names equal kinds); the boss is picked by stage. */
export function enemySprite(t: Target, stage: string): string {
  if (t.kind === 'boss') return stage === 'ice' ? 'boss_rime_golem' : 'boss_old_eight';
  return t.kind === 'cadre' ? 'grunt' : t.kind;
}

export interface WorldView {
  /** Seconds of hero hit-flash remaining. */
  heroFlash?: number;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const L2 = vx * vx + vy * vy;
  const k = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
  return Math.hypot(px - (ax + vx * k), py - (ay + vy * k));
}

/** Reach readability: red = hero in reach with a clear line, amber = in reach but covered, grey = out of reach. */
export type Reach = 'red' | 'amber' | 'grey';
export function reachState(s: RunState, e: Target): Reach {
  const h = s.balls.find((b) => b.kind === 'main');
  if (!h) return 'grey';
  const def = TARGET_DEFS[e.kind];
  const gap = Math.hypot(h.x - e.x, h.y - e.y) - e.r - h.r;
  const slam = e.kind === 'boss' && !!e.charged;
  if (!slam && gap > def.reach) return 'grey';
  for (const o of s.targets) {
    if (o === e || o.dead) continue;
    if (segDist(o.x, o.y, e.x, e.y, h.x, h.y) < e.r + o.r - 1) return 'amber';
  }
  for (const o of s.obstacles) {
    if (o.dead || o.kind === 'shrine') continue;
    if (segDist(o.x, o.y, e.x, e.y, h.x, h.y) < e.r + o.r - 1) return 'amber';
  }
  return 'red';
}

/** Enrage state for the next (or current) enemy phase: level >= 1 = raging; `inTurns` = phases until it starts. */
export function rageInfo(s: RunState): { level: number; inTurns: number } {
  const turn = s.waveTurn + 1;
  const start = ENRAGE_BASE + ENRAGE_PER_WAVE * s.wave;
  return { level: Math.max(0, turn - start + 1), inTurns: start - turn };
}

function trail(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, r: number, color: string): void {
  const sp = Math.hypot(vx, vy);
  const ux = vx / sp, uy = vy / sp;
  for (let k = 0; k < 3; k++) {
    const d = r + 3 + k * 5;
    ctx.globalAlpha = 0.65 - k * 0.2;
    ctx.fillStyle = color;
    const sz = 3 - (k > 1 ? 1 : 0);
    ctx.fillRect(Math.round(x - ux * d) - 1, Math.round(y - uy * d) - 1, sz, sz);
  }
  ctx.globalAlpha = 1;
}

const FAST_TRAIL = 90;

function drawEnemyBody(ctx: CanvasRenderingContext2D, t: Target, stage: string, now: number, flash: boolean): void {
  const name = enemySprite(t, stage);
  const { w, h } = spriteSize(name);
  if (t.shimmer > 0) {
    // spawn telegraph: flickering ghost + sparkles; reduced flashing: steady ghost, shimmer rate <= 4 Hz
    if (!flash || Math.floor(now * 18) % 2 === 0) drawSprite(ctx, name, t.x, t.y, { alpha: 0.45 });
    ringDots(ctx, t.x, t.y, Math.max(w, h) / 2 + 2, P['5'], now * 4, 0.5);
    const k = Math.floor(now * (flash ? 12 : 4)) % 4;
    ctx.fillStyle = k % 2 ? P['5'] : P.Y;
    const sx = Math.round(t.x + Math.cos(now * 5 + k) * (t.r + 3));
    const sy = Math.round(t.y + Math.sin(now * 5 + k) * (t.r + 3));
    ctx.fillRect(sx - 1, sy, 3, 1);
    ctx.fillRect(sx, sy - 1, 1, 3);
    return;
  }
  const speed = Math.hypot(t.vx, t.vy);
  if (!t.resting && speed > FAST_TRAIL) trail(ctx, t.x, t.y, t.vx, t.vy, t.r, P['4']);
  // Fallback body disc at the true physics radius if a sprite is missing or too small.
  if (Math.max(w, h) < t.r * 2 - 2) {
    ctx.fillStyle = P['1'];
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const frozen = !!t.frozen && t.frozen > 0;
  drawSprite(ctx, name, t.x, t.y, t.flash > 0 ? { tint: WHITE } : {});
  if (frozen && !(t.flash > 0)) drawSprite(ctx, name, t.x, t.y, { tint: P.c, alpha: 0.5 });
  if (frozen) ringDots(ctx, t.x, t.y, t.r + 3, P['5'], 0, 0.45);
  if (t.shield && t.shield > 0) ringDots(ctx, t.x, t.y, t.r + 3, P.B, now * 1.6, 0.4);
  if (t.kind === 'boss' && t.shielded) {
    ringDots(ctx, t.x, t.y, t.r + 3, P.c, now * 2, 0.22);
    ringDots(ctx, t.x, t.y, t.r + 4, P.B, -now * 1.5, 0.4);
  }
}

const REACH_COLOR: Record<Reach, string> = { red: P.R, amber: P.o, grey: P['3'] };
const REACH_NUM: Record<Reach, string> = { red: P.p, amber: P.Y, grey: P['3'] };

/** Overlay layer for one enemy: crown, intent glyph + number, stagger stars, damage pips. */
function drawEnemyOverlay(ctx: CanvasRenderingContext2D, s: RunState, t: Target, now: number, flash: boolean): void {
  if (t.shimmer > 0) return;
  const def = TARGET_DEFS[t.kind];
  const staggered = t.stagger >= def.staggerAt;
  const frozen = !!t.frozen && t.frozen > 0;
  const elite = !!t.elite;
  if (elite) drawSprite(ctx, 'elite_crown', t.x, t.y - t.r + 1);

  // intent: hidden once acted this phase (it rerolls) and while frozen
  const acted = s.phase === 'enemy' && s.acted.includes(t.id);
  if (!acted && !frozen) {
    const it = t.intent;
    let reach: Reach = 'grey';
    let neutral = false;
    if (it.t === 'attack') reach = reachState(s, t);
    else if (it.t === 'shoot') reach = 'red';
    else if (it.t === 'detonate') {
      const h = s.balls.find((b) => b.kind === 'main');
      reach = h && Math.hypot(h.x - t.x, h.y - t.y) <= BLAST_HERO_R + h.r ? 'red' : 'grey';
    } else neutral = true;
    const col = neutral ? P['3'] : REACH_COLOR[reach];
    const ncol = neutral ? P['4'] : REACH_NUM[reach];
    const dim = staggered || (!neutral && reach === 'grey');
    let num = '';
    if ((it.t === 'attack' || it.t === 'shoot') && it.n !== undefined) {
      const rage = rageInfo(s).level;
      num = String(Math.max(1, it.n + rage - (s.stats.armor ?? 0)));
    }
    const nw = num ? num.length * 4 : 0;
    const total = 11 + (nw ? nw + 1 : 0);
    const gx0 = Math.round(t.x - total / 2);
    const gy = Math.max(33, Math.round(t.y - t.r - 7 - (elite ? 3 : 0)));
    ctx.globalAlpha = dim ? 0.6 : 1;
    ctx.fillStyle = col;
    ctx.fillRect(gx0, gy - 5, 11, 11);
    ctx.fillStyle = P['0'];
    ctx.fillRect(gx0 + 1, gy - 4, 9, 9);
    drawSprite(ctx, `intent_${it.t}`, gx0 + 5.5, gy + 0.5);
    if (num) drawText(ctx, num, gx0 + 13, gy - 2, { color: ncol, shadow: P['0'] });
    ctx.globalAlpha = 1;
  }

  if (staggered && !frozen) {
    for (let k = 0; k < 3; k++) {
      const a = (flash ? now * 4 : 0) + k * 2.09;
      const sx = Math.round(t.x + Math.cos(a) * (t.r * 0.55));
      const sy = Math.round(t.y - t.r + 1 + Math.sin(a) * 3);
      ctx.fillStyle = P['0'];
      ctx.fillRect(sx - 2, sy, 5, 1);
      ctx.fillRect(sx, sy - 2, 1, 5);
      ctx.fillStyle = P.Y;
      ctx.fillRect(sx - 1, sy, 3, 1);
      ctx.fillRect(sx, sy - 1, 1, 3);
    }
  }

  // damage pips below, only once damaged (the boss uses the bottom bar)
  if (t.kind !== 'boss' && t.maxHp > 1 && t.hp > 0 && t.hp < t.maxHp) {
    const n = Math.min(8, Math.ceil(t.maxHp));
    const left = Math.max(1, Math.min(n, Math.ceil((t.hp / t.maxHp) * n)));
    const totalW = n * 4 - 1;
    const px = Math.round(t.x - totalW / 2);
    const py = Math.round(t.y + t.r + 2);
    ctx.fillStyle = P['0'];
    ctx.fillRect(px - 1, py - 1, totalW + 2, 4);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < left ? P.Y : P['2'];
      ctx.fillRect(px + i * 4, py, 3, 2);
    }
  }
}

/** Pulsing purple/red shimmer outline showing where the boss will land. */
function drawBossZone(ctx: CanvasRenderingContext2D, now: number): void {
  const { x, y, w, h } = BOSS_ZONE;
  const pulse = 0.5 + 0.5 * Math.sin(now * 6);
  ctx.globalAlpha = 0.06 + 0.1 * pulse;
  ctx.fillStyle = P.M;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.55 + 0.45 * pulse;
  const ph = Math.floor(now * 12);
  const px = (i: number, j: number, n: number): void => {
    ctx.fillStyle = (n + ph) % 6 < 3 ? P.M : P.R;
    ctx.fillRect(i, j, 1, 1);
  };
  let n = 0;
  for (let i = 0; i < w; i++) { px(x + i, y, n); px(x + w - 1 - i, y + h - 1, n); n++; }
  for (let j = 0; j < h; j++) { px(x + w - 1, y + j, n); px(x, y + h - 1 - j, n); n++; }
  ctx.globalAlpha = 1;
}

/** Table contents. Call inside the shake translate. */
export function drawWorld(ctx: CanvasRenderingContext2D, s: RunState, now: number, flash = true, view: WorldView = {}): void {
  ctx.drawImage(getTableBg(), 0, 0);
  if (s.bossPending && !s.bossSpawned) drawBossZone(ctx, now);
  for (const o of s.obstacles) {
    if (o.dead) continue;
    drawSprite(ctx, o.kind, o.x, o.y, o.flash > 0 ? { tint: WHITE } : {});
  }
  for (const t of s.targets) if (!t.dead) drawEnemyBody(ctx, t, s.stage, now, flash);
  for (const b of s.balls) {
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.kind === 'main') {
      const sp = Math.hypot(b.vx, b.vy);
      if (s.phase === 'enemy' && !b.resting && sp > 120) trail(ctx, b.x, b.y, b.vx, b.vy, b.r, P.p);
      drawSprite(ctx, 'hero', x, y);
      if ((view.heroFlash ?? 0) > 0) drawSprite(ctx, 'hero', x, y, { tint: P.R, alpha: 0.7 });
    } else drawSprite(ctx, b.kind === 'split' ? 'ball_split' : 'ball_spat', x, y);
  }
  for (const t of s.targets) if (!t.dead) drawEnemyOverlay(ctx, s, t, now, flash);
}

export interface HudOpts {
  flash?: boolean;
}

export function drawHud(ctx: CanvasRenderingContext2D, s: RunState, bestWave: number, now: number, opts: HudOpts = {}): void {
  const st = stageById(s.stage);
  const flash = opts.flash !== false;
  // Row 1: heart + HP bar with 2x number
  const frac = s.maxHp > 0 ? s.hp / s.maxHp : 0;
  const low = frac < 0.25 && Math.floor(now * (flash ? 4 : 2)) % 2 === 0;
  drawSprite(ctx, 'icon_hp', 10, 9);
  drawBar(ctx, 17, 3, 90, 12, frac, low ? P.p : P.R, low ? P.R : P.p, P['2']);
  drawText(ctx, `HP ${Math.ceil(Math.max(0, s.hp))}/${s.maxHp}`, 62, 4, { align: 'center', scale: 2, color: P['5'], shadow: P['0'] });
  // Row 2: cash, emeralds, overtime tag; enrage on the right
  const overtime = s.wave > WAVES_PER_STAGE + 1;
  drawSprite(ctx, 'coin', 9, 21);
  drawText(ctx, String(Math.floor(s.cash)), 16, 18, { color: P.Y, shadow: P['0'] });
  drawSprite(ctx, 'emerald', 62, 21);
  drawText(ctx, String(s.emeralds), 69, 18, { color: P.E, shadow: P['0'] });
  if (overtime) drawText(ctx, 'X2', 88, 18, { color: P.o, shadow: P['0'] });
  const rage = rageInfo(s);
  if (s.phase !== 'over') {
    const on = !flash || Math.floor(now * 3) % 2 === 0;
    if (rage.level > 0) {
      if (on) drawText(ctx, `RAGE +${rage.level}`, 175, 18, { align: 'right', color: P.p, shadow: P['0'] });
    } else if (rage.inTurns >= 1 && rage.inTurns <= 2) {
      drawText(ctx, `RAGE IN ${rage.inTurns}`, 175, 18, { align: 'right', color: P.o, shadow: P['0'] });
    }
  }

  // Bottom band: wave track / boss bar / overtime
  const bx = TABLE.x, bw = 120, ly = 294;
  const boss = s.targets.find((t) => t.kind === 'boss' && !t.dead);
  if (overtime) {
    drawText(ctx, `OVERTIME +${s.wave - (WAVES_PER_STAGE + 1)}`, bx, ly, { scale: 2, color: P.Y, shadow: P['0'] });
    drawText(ctx, '2X CASH', bx, 308, { color: P.o, shadow: P['0'] });
  } else if (s.bossKilled) {
    drawText(ctx, 'STAGE CLEARED', bx, ly, { scale: 2, color: P.Y, shadow: P['0'] });
  } else if (s.bossSpawned && boss) {
    drawText(ctx, st.boss.name.toUpperCase(), bx, ly, { scale: 2, color: P.p, shadow: P['0'] });
    drawBar(ctx, bx, 308, bw, 8, boss.hp / boss.maxHp, P.R, P.p, P['2']);
  } else if (s.bossPending) {
    const alt = Math.floor(now * (flash ? 4 : 2)) % 2;
    drawText(ctx, 'BOSS INCOMING', bx, ly, { scale: 2, color: alt ? P.R : P.p });
  } else {
    const slotsX: number[] = [];
    let x = bx;
    for (let i = 1; i <= WAVES_PER_STAGE; i++) {
      drawText(ctx, `W${i}`, x, 297, { color: i === s.wave ? P['5'] : P['3'], shadow: P['0'] });
      const cx = x + 10 + 3.5;
      slotsX.push(cx);
      drawSprite(ctx, i < s.wave ? 'pip_done' : 'pip_todo', cx, 300.5);
      if (i === s.wave) {
        ctx.fillStyle = P.Y;
        ctx.fillRect(Math.round(cx) - 5, 296, 9, 1);
        ctx.fillRect(Math.round(cx) - 5, 305, 9, 1);
        ctx.fillRect(Math.round(cx) - 5, 297, 1, 8);
        ctx.fillRect(Math.round(cx) + 3, 297, 1, 8);
      }
      x += 23;
    }
    drawText(ctx, 'BOSS', x, 297, { color: P['3'], shadow: P['0'] });
    const bcx = x + 19 + 3.5;
    slotsX.push(bcx);
    drawSprite(ctx, 'pip_boss', bcx, 300.5, { alpha: s.wave > WAVES_PER_STAGE ? 1 : 0.5 });
    // best-wave marker (the ghost line)
    if (bestWave >= 1) {
      const mcx = Math.round(slotsX[Math.min(slotsX.length, Math.round(bestWave)) - 1]);
      ctx.fillStyle = P['5'];
      ctx.fillRect(mcx, 307, 1, 1);
      ctx.fillRect(mcx - 1, 308, 3, 1);
      ctx.fillRect(mcx - 2, 309, 5, 1);
      drawText(ctx, 'BEST', mcx, 311, { align: 'center', color: P['3'], shadow: P['0'] });
    }
  }
}
