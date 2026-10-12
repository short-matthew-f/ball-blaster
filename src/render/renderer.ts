// Draws the run view (table, entities, HUD) from RunState. Read-only with respect to sim state.
import type { RunState, Target } from '../core/types';
import { TABLE, VIEW_H, VIEW_W } from '../core/types';
import { BLAST_HERO_R, TARGET_DEFS, WAVES_PER_STAGE, stageById, TOOTH_HIT } from '../core/tuning';
import { beltPreview, rageLevel, rageStart } from '../sim/index';
import type { Hazard } from '../core/types';
import { PALETTE } from './palette';
import { drawSprite, getSprite, spriteSize, WHITE } from './sprite-cache';
import { drawText, textWidth } from './text';
import { drawBar } from '../ui/widgets';
import { MODIFIER_NAMES, WORLDS, makeStage, parseStageId } from '../core/worlds';
import { intentVisible } from '../sim/index';

const P = PALETTE;

function hash(x: number, y: number): number {
  let h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) % 100;
}

const tableBgs = new Map<string, HTMLCanvasElement>();

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

/** Felt tint char for a stage's world ('' = stock green). */
function feltTint(stage: string): string {
  try {
    const t = WORLDS[parseStageId(stage).world - 1]?.tint;
    return t && t !== 'G' && t !== 'h' && t !== 'g' ? t : '';
  } catch {
    return '';
  }
}
let menuBg: HTMLCanvasElement | null = null;

function mk(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  return c;
}

function paintFelt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vignette: boolean, tint = ''): void {
  const T = tint && P[tint] ? P[tint] : '';
  const cG = T ? mix(P.G, T, 0.35) : P.G, cg = T ? mix(P.g, T, 0.25) : P.g, ch = T ? mix(P.h, T, 0.45) : P.h;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = hash(x + i, y + j);
      // calm woven nap: sparse ordered dark dots, rare light flecks
      let c = cG;
      if ((i + j * 3) % 8 === 0 && n < 70) c = cg;
      else if (n === 0) c = ch;
      if (vignette) {
        const ex = Math.min(i, w - 1 - i), ey = Math.min(j, h - 1 - j);
        const e = Math.min(ex, ey);
        if (e < 5 && (i + j) % 2 === 0 && e < 3) c = cg;
        else if (e < 8 && (i + j) % 4 === 0 && c === cG) c = cg;
      }
      g.fillStyle = c;
      g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** Static run background: HUD band, felt, wood rails, meter band. */
function getTableBg(stage: string): HTMLCanvasElement {
  const tint = feltTint(stage);
  const hit = tableBgs.get(tint);
  if (hit) return hit;
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
  paintFelt(g, TABLE.x, TABLE.y, TABLE.w, TABLE.h, true, tint);
  // rail studs (diamonds)
  g.fillStyle = P.Y;
  for (let i = 1; i < 5; i++) {
    g.fillRect(rx + 2, ry + Math.round((rh * i) / 5), 1, 1);
    g.fillRect(rx + rw - 3, ry + Math.round((rh * i) / 5), 1, 1);
  }
  tableBgs.set(tint, c);
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

/** Worlds 4-6 reuse the Big Stripe sprite until their art lands: overlay the world tint. Null = no tint. */
function bossTint(stage: string): string | null {
  const w = parseStageId(stage).world;
  return w >= 4 ? WORLDS[w - 1]?.tint ?? null : null;
}

/** Banner text for a stage's active modifiers ("RANGED · DARK"); '' when none. */
export function modifierLine(stage: string): string {
  return makeStage(stage).modifiers.map((m) => MODIFIER_NAMES[m]).join(' \u00b7 ');
}

/** Draw a stage's modifier icons (up to `max`) left-to-right from (x, y) = top-left of the first icon. */
export function drawModIcons(ctx: CanvasRenderingContext2D, stage: string, x: number, y: number, max = 2, gap = 8, alpha = 1): void {
  let mods: string[] = [];
  try { mods = makeStage(stage).modifiers.slice(0, max); } catch { /* ignore */ }
  mods.forEach((m, i) => drawSprite(ctx, `mod_${m}`, x + 3.5 + i * gap, y + 3.5, { alpha }));
}

/** Board hazards under the enemies: ice = pale cyan dithered disc with a lighter rim; stub kinds = dim grey. */
function drawHazard(ctx: CanvasRenderingContext2D, h: Hazard, s: RunState, now: number, flash: boolean, beltFlash: number): void {
  if (h.kind === 'conveyor') { drawConveyor(ctx, h, s, now, flash, beltFlash); return; }
  if (h.kind !== 'ice' && h.kind !== 'mud' && h.kind !== 'lava' && h.kind !== 'slot') return; // gear lives in s.obstacles
  const ice = h.kind === 'ice';
  const fill = ice ? P.c : P['3'];
  const rim = ice ? P['5'] : P['4'];
  const R = Math.round(h.r), cx = Math.round(h.x), cy = Math.round(h.y);
  ctx.globalAlpha = ice ? 0.55 : 0.4;
  ctx.fillStyle = fill;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d2 = x * x + y * y;
      if (d2 > R * R || (x + y + 2 * R) % 2 !== 0) continue;
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  ctx.globalAlpha = ice ? 0.9 : 0.6;
  ctx.fillStyle = rim;
  for (let a = 0; a < Math.PI * 2; a += 1 / Math.max(4, R)) ctx.fillRect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 1, 1);
  ctx.globalAlpha = 1;
}

/** Conveyor: dim rect, 8x8 arrow tiles pointing along (dx,dy), frames alternate every 0.2 s, rim bright while a sweep is pending. */
function drawConveyor(ctx: CanvasRenderingContext2D, h: Hazard, s: RunState, now: number, flash: boolean, beltFlash: number): void {
  const w = h.w ?? 0, hh = h.h ?? 0;
  if (w <= 0 || hh <= 0) return;
  const dx = h.dx ?? 1, dy = h.dy ?? 0;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const L = horiz ? w : hh, W = horiz ? hh : w; // along / across the belt
  const ang = Math.atan2(dy, dx);
  const cols = Math.max(1, Math.floor(L / 8)), rows = Math.max(1, Math.floor(W / 8));
  const frame = flash ? Math.floor(now / 0.2) % 2 : 0;
  const name = frame ? 'belt_b' : 'belt';
  const holding = s.beltAt !== undefined;
  ctx.save();
  ctx.translate(Math.round(h.x), Math.round(h.y));
  ctx.rotate(ang);
  const l0 = -Math.round(L / 2), w0 = -Math.round(W / 2);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = P['1'];
  ctx.fillRect(l0, w0, Math.round(L), Math.round(W));
  ctx.globalAlpha = 0.85;
  const tl = -cols * 4, tw = -rows * 4;
  const img = getSprite(name);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) ctx.drawImage(img, tl + i * 8, tw + j * 8);
  // rim
  ctx.globalAlpha = holding ? 1 : 0.7;
  ctx.fillStyle = holding ? P.Y : P['0'];
  const rl = Math.round(L), rw = Math.round(W);
  ctx.fillRect(l0, w0, rl, 1);
  ctx.fillRect(l0, w0 + rw - 1, rl, 1);
  ctx.fillRect(l0, w0, 1, rw);
  ctx.fillRect(l0 + rl - 1, w0, 1, rw);
  if (beltFlash > 0) {
    ctx.globalAlpha = Math.min(1, beltFlash / 0.4) * 0.85;
    ctx.fillStyle = WHITE;
    ctx.fillRect(l0, w0, rl, rw);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Aim phase: dotted hero outline where the belt will carry the hero. */
export function drawBeltGhost(ctx: CanvasRenderingContext2D, s: RunState, now: number): void {
  if (s.phase !== 'aim') return;
  let p: { x: number; y: number } | null = null;
  try { p = beltPreview(s); } catch { p = null; }
  const hero = s.balls.find((b) => b.kind === 'main');
  if (!p || !hero) return;
  drawSprite(ctx, 'hero', p.x, p.y, { alpha: 0.25 });
  ringDots(ctx, p.x, p.y, hero.r + 1, P['5'], 0, 0.4);
  void now;
}

/** Enemy sprite by kind (v2 names equal kinds); the boss is picked by stage. */
export function enemySprite(t: Target, stage: string, goblinHits = 0): string {
  if (t.kind === 'goblin') return goblinHits >= TOOTH_HIT ? 'goblin_b' : 'goblin';
  if (t.kind === 'boss') {
    const w = parseStageId(stage).world;
    return w === 2 ? 'boss_rime_golem' : w === 3 ? 'boss_mainspring' : 'boss_old_eight';
  }
  return t.kind === 'cadre' ? 'grunt' : t.kind;
}

export interface WorldView {
  /** Seconds of hero hit-flash remaining. */
  heroFlash?: number;
  /** Seconds of conveyor reversal flash remaining. */
  beltFlash?: number;
  /** Eased position of a scurrying goblin (by target id); null = at its sim position. */
  goblinAt?: (id: number) => { x: number; y: number } | null;
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
  return { level: rageLevel(s), inTurns: rageStart(s) - (s.waveTurn + 1) };
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

function drawEnemyBody(ctx: CanvasRenderingContext2D, t: Target, stage: string, now: number, flash: boolean, hits = 0): void {
  const name = enemySprite(t, stage, hits);
  const { w, h } = spriteSize(name);
  if (t.shimmer > 0) {
    // arrival ghost: sprite alpha rises 0.25 -> 0.9 across the 0.5 s shimmer, over a dotted ring (steady when flash is off)
    const k = 1 - Math.min(1, t.shimmer / 0.5);
    drawSprite(ctx, name, t.x, t.y, { alpha: 0.25 + 0.65 * k, ...(t.kind === 'cadre' ? { tint: P.B } : {}) });
    ringDots(ctx, t.x, t.y, t.r + 1, P['5'], flash ? now * 4 : 0, 0.5);
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
  if (t.chill && t.chill > 0) {
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawSprite(ctx, name, t.x + ox, t.y + oy, { tint: P.c, alpha: 0.9 });
  }
  drawSprite(ctx, name, t.x, t.y, t.flash > 0 ? { tint: WHITE } : {});
  const bt = t.kind === 'boss' && !(t.flash > 0) ? bossTint(stage) : null;
  if (bt && P[bt]) drawSprite(ctx, name, t.x, t.y, { tint: P[bt], alpha: 0.4 });
  if (t.kind === 'cadre' && !(t.flash > 0)) drawSprite(ctx, name, t.x, t.y, { tint: P.B, alpha: 0.55 });
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
  if (!acted && !frozen && t.kind !== 'goblin' && !intentVisible(s, t)) {
    // Dark: intent hidden outside reach; a small grey "?" marks the enemy
    const gx = Math.round(t.x), gy = Math.max(33, Math.round(t.y - t.r - 7 - (elite ? 3 : 0)));
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = P['3'];
    ctx.fillRect(gx - 5, gy - 5, 11, 11);
    ctx.fillStyle = P['0'];
    ctx.fillRect(gx - 4, gy - 4, 9, 9);
    drawText(ctx, '?', gx, gy - 2, { align: 'center', color: P['3'] });
    ctx.globalAlpha = 1;
  } else if (!acted && !frozen) {
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
      // Mirror the sim: Shoot takes rangedResist first (min 1), then armor (min 1).
      const raw = it.t === 'shoot' ? Math.max(1, it.n + rage - (s.stats.rangedResist ?? 0)) : it.n + rage;
      num = String(Math.max(1, raw - (s.stats.armor ?? 0)));
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
    if (t.chill && t.chill > 0) drawSprite(ctx, 'status_chill', gx0 + 10, gy - 4);
  }

  if (t.kind === 'goblin') {
    // coin-sack meter: TOOTH_HIT coins, one gone per hit; the last is the tooth
    const left = Math.max(0, TOOTH_HIT - s.goblinHits);
    const py = Math.round(t.y + t.r + 3), px = Math.round(t.x) - Math.floor((TOOTH_HIT * 5 - 1) / 2);
    ctx.fillStyle = P['0'];
    ctx.fillRect(px - 1, py - 1, TOOTH_HIT * 5 + 1, 5);
    for (let i = 0; i < TOOTH_HIT; i++) {
      ctx.fillStyle = i < left ? P.Y : P['2'];
      ctx.fillRect(px + i * 5, py, 4, 3);
      if (i < left) { ctx.fillStyle = P['5']; ctx.fillRect(px + i * 5, py, 2, 1); }
    }
    return;
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

  // poison: rising green bubbles + stack digit beside the HP pips
  if (t.poison && t.poison > 0) {
    for (let k = 0; k < 3; k++) {
      const ph = (flash ? now * 0.9 : 0) + k * 0.37;
      const f = ph - Math.floor(ph);
      ctx.fillStyle = k % 2 ? P.e : P.E;
      ctx.globalAlpha = 1 - f;
      ctx.fillRect(Math.round(t.x - t.r * 0.5 + k * t.r * 0.5), Math.round(t.y + t.r * 0.4 - f * t.r * 1.2), 2, 2);
    }
    ctx.globalAlpha = 1;
    const dmgd = t.kind !== 'boss' && t.maxHp > 1 && t.hp > 0 && t.hp < t.maxHp;
    const n = Math.min(8, Math.ceil(t.maxHp));
    const pw = dmgd ? n * 4 - 1 : 0;
    const dx = Math.round(t.x + pw / 2) + 3;
    const dy = Math.round(t.y + t.r + 2);
    const w = textWidth(String(t.poison)) + 8;
    const x0 = pw ? dx : Math.round(t.x - w / 2);
    ctx.fillStyle = P['0'];
    ctx.fillRect(x0 - 1, dy - 2, w + 1, 9);
    drawSprite(ctx, 'status_poison', x0 + 3, dy + 2);
    drawText(ctx, String(t.poison), x0 + 8, dy - 1, { color: P.E });
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

/** Table contents. Call inside the shake translate. */
export function drawWorld(ctx: CanvasRenderingContext2D, s: RunState, now: number, flash = true, view: WorldView = {}): void {
  ctx.drawImage(getTableBg(s.stage), 0, 0);
  for (const h of s.hazards ?? []) drawHazard(ctx, h, s, now, flash, view.beltFlash ?? 0);
  for (const o of s.obstacles) {
    if (o.dead) continue;
    if (o.kind === 'gear') { drawSprite(ctx, flash && Math.floor(now * 4) % 2 ? 'gear_b' : 'gear', o.x, o.y); continue; }
    drawSprite(ctx, o.kind, o.x, o.y, o.flash > 0 ? { tint: WHITE } : {});
  }
  // a scurrying goblin is drawn along its slide, not at its (already moved) sim position
  const vis = (t: Target): Target => {
    const p = t.kind === 'goblin' ? view.goblinAt?.(t.id) : null;
    return p ? { ...t, x: p.x, y: p.y } : t;
  };
  for (const t of s.targets) if (!t.dead) drawEnemyBody(ctx, vis(t), s.stage, now, flash, s.goblinHits);
  for (const b of s.balls) {
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.kind === 'main') {
      const sp = Math.hypot(b.vx, b.vy);
      if (s.phase === 'enemy' && !b.resting && sp > 120) trail(ctx, b.x, b.y, b.vx, b.vy, b.r, P.p);
      drawSprite(ctx, 'hero', x, y);
      if ((view.heroFlash ?? 0) > 0) drawSprite(ctx, 'hero', x, y, { tint: P.R, alpha: 0.7 });
    } else drawSprite(ctx, b.kind === 'split' ? 'ball_split' : 'ball_spat', x, y);
  }
  for (const t of s.targets) if (!t.dead) drawEnemyOverlay(ctx, s, vis(t), now, flash);
}

export interface HudOpts {
  flash?: boolean;
  /** A trick button occupies the left of the meter band: the wave track / boss bar shift right. */
  trick?: boolean;
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
  // Row 2: cash, this stage's boss token; enrage on the right
  const nw = st.waves.length;
  drawSprite(ctx, 'coin', 9, 21);
  drawText(ctx, String(Math.floor(s.cash)), 16, 18, { color: P.Y, shadow: P['0'] });
  const tid = s.stats.tokenId ?? 'stripe';
  drawSprite(ctx, `token_${tid}`, 62, 21, { alpha: s.tokens > 0 ? 1 : 0.4 });
  drawText(ctx, String(s.tokens), 69, 18, { color: s.tokens > 0 ? P['5'] : P['3'], shadow: P['0'] });
  const rage = rageInfo(s);
  if (s.phase !== 'over' && !s.bossKilled) {
    const on = !flash || Math.floor(now * 3) % 2 === 0;
    if (rage.level > 0) {
      if (on) drawText(ctx, `RAGE +${rage.level}`, 175, 18, { align: 'right', color: P.p, shadow: P['0'] });
    } else if (rage.inTurns >= 1 && rage.inTurns <= 2) {
      drawText(ctx, `RAGE IN ${rage.inTurns}`, 175, 18, { align: 'right', color: P.o, shadow: P['0'] });
    }
  }

  // Bottom band: wave track / boss bar / loot pulls
  const bx = opts.trick ? 36 : TABLE.x, bw = opts.trick ? 96 : 120, ly = 294;
  const boss = s.targets.find((t) => t.kind === 'boss' && !t.dead);
  if (s.bossKilled) {
    const pulls = s.pulls ?? 0;
    if (pulls > 0 && s.phase !== 'over') drawText(ctx, `PULLS ${pulls}`, bx, ly, { scale: 2, color: P.Y, shadow: P['0'] });
    else drawText(ctx, 'STAGE CLEARED', bx, ly, { scale: 2, color: P.Y, shadow: P['0'] });
    drawText(ctx, `LOOT ${Math.floor(s.loot ?? 0)}`, bx, 308, { color: P.o, shadow: P['0'] });
  } else if (s.bossSpawned && boss) {
    drawText(ctx, st.boss.name.toUpperCase(), bx, ly, { scale: 2, color: P.p, shadow: P['0'] });
    drawBar(ctx, bx, 308, bw, 8, boss.hp / boss.maxHp, P.R, P.p, P['2']);
  } else {
    const slotsX: number[] = [];
    let x = bx;
    for (let i = 1; i <= nw; i++) {
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
    drawSprite(ctx, 'pip_boss', bcx, 300.5, { alpha: s.wave > nw ? 1 : 0.5 });
    // best-wave marker (the ghost line)
    if (bestWave >= 1) {
      const mcx = Math.round(slotsX[(bestWave >= WAVES_PER_STAGE + 1 ? slotsX.length : Math.min(nw, Math.max(1, Math.round(bestWave)))) - 1]);
      ctx.fillStyle = P['5'];
      ctx.fillRect(mcx, 307, 1, 1);
      ctx.fillRect(mcx - 1, 308, 3, 1);
      ctx.fillRect(mcx - 2, 309, 5, 1);
      drawText(ctx, 'BEST', mcx, 311, { align: 'center', color: P['3'], shadow: P['0'] });
    }
  }
}
