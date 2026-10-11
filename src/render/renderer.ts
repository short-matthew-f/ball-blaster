// Draws the run view (table, entities, HUD) from RunState. Read-only with respect to sim state.
import type { RunState, Target } from '../core/types';
import { BOSS_ZONE, TABLE, VIEW_H, VIEW_W } from '../core/types';
import { stageById } from '../core/tuning';
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

export function targetSprite(t: Target, stage: string): string {
  if (t.kind === 'boss') return stage === 'ice' ? 'boss_ice' : 'boss_felt';
  return `target_${t.kind}`;
}

function drawTarget(ctx: CanvasRenderingContext2D, t: Target, stage: string, now: number): void {
  const name = targetSprite(t, stage);
  const { w, h } = spriteSize(name);
  if (t.shimmer > 0) {
    // spawn telegraph: flickering ghost + sparkles
    if (Math.floor(now * 18) % 2 === 0) drawSprite(ctx, name, t.x, t.y, { alpha: 0.45 });
    ringDots(ctx, t.x, t.y, Math.max(w, h) / 2 + 2, P['5'], now * 4, 0.5);
    const k = Math.floor(now * 12) % 4;
    ctx.fillStyle = k % 2 ? P['5'] : P.Y;
    const sx = Math.round(t.x + Math.cos(now * 5 + k) * (t.r + 3));
    const sy = Math.round(t.y + Math.sin(now * 5 + k) * (t.r + 3));
    ctx.fillRect(sx - 1, sy, 3, 1);
    ctx.fillRect(sx, sy - 1, 1, 3);
    return;
  }
  drawSprite(ctx, name, t.x, t.y, t.flash > 0 ? { tint: WHITE } : {});
  if (t.kind === 'boss' && t.shielded) {
    ringDots(ctx, t.x, t.y, t.r + 3, P.c, now * 2, 0.22);
    ringDots(ctx, t.x, t.y, t.r + 4, P.B, -now * 1.5, 0.4);
  }
  if (t.kind !== 'boss' && t.maxHp > 1 && t.hp > 0) {
    const n = Math.min(8, Math.ceil(t.maxHp));
    const left = Math.min(n, Math.ceil(t.hp));
    const totalW = n * 3 - 1;
    const px = Math.round(t.x - totalW / 2);
    const py = Math.round(t.y + h / 2 + 1);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < left ? P.Y : P['1'];
      ctx.fillRect(px + i * 3, py, 2, 1);
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
export function drawWorld(ctx: CanvasRenderingContext2D, s: RunState, now: number): void {
  ctx.drawImage(getTableBg(), 0, 0);
  if (s.bossPending && !s.bossSpawned) drawBossZone(ctx, now);
  for (const o of s.obstacles) {
    if (o.dead) continue;
    drawSprite(ctx, o.kind, o.x, o.y, o.flash > 0 ? { tint: WHITE } : {});
  }
  for (const t of s.targets) if (!t.dead) drawTarget(ctx, t, s.stage, now);
  const main = s.stats.ballType === 'standard' ? 'ball_main' : `ball_${s.stats.ballType}`;
  for (const b of s.balls) {
    const name = b.kind === 'main' ? main : b.kind === 'split' ? 'ball_split' : 'ball_spat';
    drawSprite(ctx, name, Math.round(b.x), Math.round(b.y));
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, s: RunState, bestFill: number, now: number): void {
  const st = stageById(s.stage);
  // energy bar
  const frac = s.stats.maxEnergy > 0 ? s.energy / s.stats.maxEnergy : 0;
  const low = frac < 0.2 && Math.floor(now * 4) % 2 === 0;
  drawBar(ctx, 5, 4, 100, 9, frac, low ? P.R : P.B, low ? P.p : P.c, P['2']);
  drawText(ctx, `${Math.ceil(Math.max(0, s.energy))}/${s.stats.maxEnergy}`, 55, 6, { align: 'center', color: P['5'], shadow: P['0'] });
  drawText(ctx, `SHOT -${s.stats.releaseCost}`, 175, 6, { align: 'right', color: P['3'] });
  // cash + emeralds
  drawSprite(ctx, 'coin', 9, 21);
  drawText(ctx, String(Math.floor(s.cash)), 16, 18, { color: P.Y, shadow: P['0'] });
  drawSprite(ctx, 'emerald', 80, 21);
  drawText(ctx, String(s.emeralds), 87, 18, { color: P.E, shadow: P['0'] });
  drawText(ctx, st.name.toUpperCase(), 175, 18, { align: 'right', color: P['3'] });

  // bottom meter band (x 10..130)
  const bx = TABLE.x, bw = 120, by = 304, bh = 7;
  const boss = s.targets.find((t) => t.kind === 'boss' && !t.dead);
  if (s.bossKilled) {
    drawText(ctx, 'STAGE CLEARED', bx, 295, { color: P.Y });
    drawBar(ctx, bx, by, bw, bh, 1, P.Y, P['5'], P.y);
  } else if (s.bossSpawned && boss) {
    drawText(ctx, st.boss.name.toUpperCase(), bx, 295, { color: P.p });
    drawBar(ctx, bx, by, bw, bh, boss.hp / boss.maxHp, P.R, P.p, P['2']);
  } else if (s.bossPending || s.bossSpawned) {
    drawText(ctx, 'BOSS INCOMING', bx, 295, { color: Math.floor(now * 4) % 2 ? P.R : P.p });
    drawBar(ctx, bx, by, bw, bh, 1, P.M, P['5'], P.m);
  } else {
    drawText(ctx, `BOSS ${s.meterKills}/${st.meterKills}`, bx, 295, { color: P.M });
    drawBar(ctx, bx, by, bw, bh, s.meterKills / st.meterKills, P.m, P.M, P['2'], bestFill);
  }
}
