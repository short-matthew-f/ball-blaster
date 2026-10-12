// The One Tree: pan/zoom web of upgrade nodes on a virtual 640x640 canvas, bottom inspect panel, path highlight.
import type { BallType, RunStats, UpgradeNode } from '../core/types';
import { BASE_STATS } from '../core/tuning';
import { WORLDS, makeStage } from '../core/worlds';
import { ROOT_ID, gearOwned, worldCleared, buy, buyState, distanceFromOwned, nextCost, nodeLevel, nodesFor, pathToOwned } from '../meta/index';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite, spriteSize } from '../render/sprite-cache';
import { drawText, textWidth, wrapText } from '../render/text';
import { Buttons, drawPanel } from './widgets';
import type { Button } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;
const BALL_NODES: Record<string, BallType> = { ballHeavy: 'heavy', ballLight: 'light', ballSticky: 'sticky' };
function ballOf(node: UpgradeNode): BallType | null {
  if (node.id === ROOT_ID) return 'standard';
  return BALL_NODES[node.id] ?? null;
}
type BuyState = ReturnType<typeof buyState>;

const VIEW_TOP = 28;
const VIEW_BOT = 248;
const VIEW_CX = 90;
const VIEW_CY = (VIEW_TOP + VIEW_BOT) / 2;
const PANEL_Y = 250;
const PAD = 60;
const SLOP = 10;

interface Vis {
  n: UpgradeNode;
  st: BuyState;
  lvl: number;
  sil: boolean; // dim silhouette, no text
  sx: number;
  sy: number;
}

function fmtNum(v: number, pct: boolean): string {
  if (pct) return `${Math.round(v * 100)}%`;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Fill the {v} placeholder by diffing stats the node applies at the shown level. */
function describe(node: UpgradeNode, level: number): string {
  if (!node.desc.includes('{v}')) return node.desc;
  const pctDesc = node.desc.includes('{v}%');
  const lv = Math.max(1, Math.min(node.maxLevel, level + 1));
  let text = `LV ${lv}`;
  try {
    const a: RunStats = { ...BASE_STATS };
    node.apply(a, lv);
    for (const k of Object.keys(BASE_STATS) as (keyof RunStats)[]) {
      const av = a[k], bv = BASE_STATS[k];
      if (typeof av === 'number' && typeof bv === 'number' && av !== bv) {
        const delta = node.desc.includes('+{v}');
        text = fmtNum(delta ? av - bv : av, /Chance|Pct$/.test(k) || pctDesc);
        break;
      }
    }
  } catch { /* keep LV fallback */ }
  return node.desc.replace(pctDesc ? '{v}%' : '{v}', text.endsWith('%') ? text : pctDesc ? `${text}%` : text);
}

/** Concentric-layer shape fill. Layer L is inset by L; kind picks the per-row horizontal inset. */
function insetFor(kind: UpgradeNode['kind'], r: number, s: number): number {
  const h = (s - 1) / 2;
  if (kind === 'keystone') return Math.abs(r - h);
  if (kind === 'counter') return Math.max(0, (s > 15 ? 3 : 1) - Math.min(r, s - 1 - r));
  return 0;
}
function fillLayer(ctx: CanvasRenderingContext2D, kind: UpgradeNode['kind'], cx: number, cy: number, s: number, layer: number, color: string): void {
  const x0 = cx - (s - 1) / 2, y0 = cy - (s - 1) / 2;
  ctx.fillStyle = color;
  for (let r = layer; r <= s - 1 - layer; r++) {
    const ins = insetFor(kind, r, s) + layer;
    const w = s - 2 * ins;
    if (w > 0) ctx.fillRect(x0 + ins, y0 + r, w, 1);
  }
}
function drawLink(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, th: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    ctx.fillRect(Math.round(x0 + dx * t), Math.round(y0 + dy * t), th, th);
  }
}

export class TreeScreen implements Screen {
  private buttons = new Buttons();
  private sel: string | null = null;
  private camX = 320;
  private camY = 320;
  private zoom = 1;
  private drag: { x0: number; y0: number; cx0: number; cy0: number; moved: boolean; prevSel: string | null; picked: boolean } | null = null;
  private toast = '';
  private toastUntil = 0;
  private gearHintUntil = 0;
  private now = 0;
  private vis: Vis[] = [];
  private bounds = { x0: 0, y0: 0, x1: 640, y1: 640 };

  constructor(private app: App) {}

  enter(): void {
    this.drag = null;
    this.zoom = 1;
    const nodes = nodesFor(this.app.save);
    const target = nodes.find((n) => n.id === this.sel) ?? nodes.find((n) => n.id === ROOT_ID);
    if (!nodes.some((n) => n.id === this.sel)) this.sel = null;
    this.camX = target?.x ?? 320;
    this.camY = target?.y ?? 320;
    this.clamp();
  }

  private clamp(): void {
    const z = this.zoom;
    const b = this.bounds;
    const hx = 90 / z, hy = (VIEW_BOT - VIEW_TOP) / 2 / z;
    const lo = (a: number, half: number): number => a - PAD + half;
    const hi = (c: number, half: number): number => c + PAD - half;
    const lx = lo(b.x0, hx), hxx = hi(b.x1, hx);
    const ly = lo(b.y0, hy), hyy = hi(b.y1, hy);
    this.camX = lx > hxx ? (b.x0 + b.x1) / 2 : Math.max(lx, Math.min(hxx, this.camX));
    this.camY = ly > hyy ? (b.y0 + b.y1) / 2 : Math.max(ly, Math.min(hyy, this.camY));
  }

  private toScreen(vx: number, vy: number): [number, number] {
    return [Math.round(VIEW_CX + (vx - this.camX) * this.zoom), Math.round(VIEW_CY + (vy - this.camY) * this.zoom)];
  }

  private build(): void {
    const save = this.app.save;
    const out: Vis[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const all = nodesFor(save);
    const entry = new Map<number, UpgradeNode>();
    for (const n of all) if (n.graft && !worldCleared(save, n.graft)) {
      const e = entry.get(n.graft);
      if (!e || n.ring < e.ring) entry.set(n.graft, n);
    }
    for (const n of all) {
      const st = buyState(save, n);
      let sil = false;
      if (st === 'hidden') continue;
      const lvl0 = nodeLevel(save, n.id) === 0;
      if (n.graft && !worldCleared(save, n.graft)) {
        if (entry.get(n.graft) !== n) {
          if (distanceFromOwned(save, n.id) !== 2) continue;
          sil = true;
        } else if (distanceFromOwned(save, n.id) > 2) continue;
      } else if (st === 'locked' && lvl0 && distanceFromOwned(save, n.id) >= 2) sil = true;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
      out.push({ n, st, lvl: n.id === ROOT_ID ? 1 : nodeLevel(save, n.id), sil, sx: 0, sy: 0 });
    }
    if (out.length) this.bounds = { x0, y0, x1, y1 };
    this.clamp();
    for (const v of out) [v.sx, v.sy] = this.toScreen(v.n.x, v.n.y);
    this.vis = out;
  }

  private nodeAt(x: number, y: number): Vis | undefined {
    if (y < VIEW_TOP || y >= VIEW_BOT) return undefined;
    const r = this.zoom === 1 ? 14 : 9;
    let best: Vis | undefined;
    let bd = r * r + 1;
    for (const v of this.vis) {
      if (v.sil) continue;
      const d = (v.sx - x) ** 2 + (v.sy - y) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private frameSize(kind: UpgradeNode['kind']): number {
    const base = this.zoom === 1 ? 23 : 11;
    return kind === 'capstone' ? base + (this.zoom === 1 ? 4 : 2) : base;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.now = now;
    const app = this.app;
    const save = app.save;
    ctx.drawImage(getMenuBg(), 0, 0);
    this.build();
    const byId = new Map(this.vis.map((v) => [v.n.id, v]));
    const path = new Set<string>();
    const selVis = this.sel ? byId.get(this.sel) : undefined;
    let pathList: string[] = [];
    if (selVis && selVis.lvl === 0) {
      try { pathList = pathToOwned(save, selVis.n.id); } catch { pathList = []; }
      for (const id of pathList) path.add(id);
    }
    const btns: Button[] = [];

    // header
    drawSprite(ctx, 'coin', 9, 8);
    drawText(ctx, String(Math.floor(save.cash)), 16, 5, { color: P.Y, shadow: P['0'] });
    drawSprite(ctx, 'emerald', 82, 8);
    drawText(ctx, String(save.emeralds), 89, 5, { color: P.E, shadow: P['0'] });
    btns.push({ id: 'settings', x: 144, y: 1, w: 32, h: 16, label: 'SET', style: 'gray' });
    let stageName = '';
    try { stageName = makeStage(save.current).name.toUpperCase(); } catch { /* ignore */ }
    drawText(ctx, stageName, 90, 19, { align: 'center', color: P['3'], shadow: P['0'] });

    // viewport
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, VIEW_TOP, 180, VIEW_BOT - VIEW_TOP);
    ctx.clip();
    ctx.fillStyle = P['0'];
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, VIEW_TOP, 180, VIEW_BOT - VIEW_TOP);
    ctx.globalAlpha = 1;

    // links
    const done = new Set<string>();
    for (const v of this.vis) {
      for (const lid of v.n.links) {
        const key = v.n.id < lid ? `${v.n.id}|${lid}` : `${lid}|${v.n.id}`;
        if (done.has(key)) continue;
        const o = byId.get(lid);
        if (!o) continue;
        done.add(key);
        if (v.sil && o.sil) continue;
        const a = v.lvl > 0, b = o.lvl > 0;
        const reach = (a || b) && !(v.sil || o.sil);
        const color = a && b ? P.Y : reach ? P['3'] : P['2'];
        const onPath = path.has(v.n.id) && path.has(lid) || (path.has(v.n.id) && o.lvl > 0) || (path.has(lid) && v.lvl > 0);
        if (this.zoom === 1) drawLink(ctx, v.sx, v.sy, o.sx, o.sy, color, 1);
        else drawLink(ctx, v.sx, v.sy, o.sx, o.sy, color, 1);
        if (onPath) drawLink(ctx, v.sx, v.sy, o.sx, o.sy, P.c, this.zoom === 1 ? 2 : 1);
      }
    }

    // nodes
    const stubSeen = new Set<number>();
    const pulse = 0.35 + 0.25 * Math.sin(now * 5);
    for (const v of this.vis) {
      if (v.sx < -20 || v.sx > 200 || v.sy < VIEW_TOP - 20 || v.sy > VIEW_BOT + 20) continue;
      this.drawNode(ctx, v, path.has(v.n.id), pulse, stubSeen);
    }
    ctx.restore();
    ctx.fillStyle = P['2'];
    ctx.fillRect(0, VIEW_TOP - 1, 180, 1);
    ctx.fillRect(0, VIEW_BOT, 180, 1);

    // viewport buttons
    btns.push({ id: 'zoom', x: 162, y: VIEW_TOP + 3, w: 15, h: 15, icon: 'btn_zoom', style: 'gray', active: this.zoom !== 1, hitPad: 1 });
    btns.push({ id: 'recentre', x: 162, y: VIEW_TOP + 20, w: 15, h: 15, icon: 'btn_recentre', style: 'gray', hitPad: 1 });

    // bottom panel
    drawPanel(ctx, 2, PANEL_Y, 176, 46);
    const sv = selVis ?? (this.sel ? byId.get(this.sel) : undefined);
    if (sv) {
      const node = sv.n;
      const lvl = sv.lvl;
      const st = sv.st;
      const gem = node.currency === 'emerald';
      const nameScale = textWidth(node.name, 2) <= 112 ? 2 : 1;
      drawText(ctx, node.name, 7, PANEL_Y + 5, { color: gem ? P.E : P.Y, shadow: P['0'], scale: nameScale });
      const lv = node.maxLevel <= 1 ? (lvl >= 1 ? 'OWNED' : 'ONE-SHOT') : lvl >= node.maxLevel ? `LV${lvl} MAX` : `LV${lvl}>${lvl + 1}`;
      drawText(ctx, lv, 173, PANEL_Y + 5, { align: 'right', color: P['4'] });
      const lines = wrapText(describe(node, lvl), 27).slice(0, 2);
      lines.forEach((l, i) => drawText(ctx, l, 7, PANEL_Y + 17 + i * 7, { color: P['4'] }));
      let hint = '';
      if (st === 'locked') {
        const w = node.graft ? WORLDS.find((x) => x.index === node.graft) : undefined;
        hint = w ? `REACH ${w.name.toUpperCase()}` : 'REQUIRES MORE';
      }
      const cost = nextCost(save, node);
      if (cost !== null) {
        drawSprite(ctx, gem ? 'emerald' : 'coin', 11, PANEL_Y + 37);
        drawText(ctx, String(cost), 18, PANEL_Y + 34, { color: gem ? P.E : P.Y, shadow: P['0'] });
      }
      if (hint) drawText(ctx, hint, 7, PANEL_Y + 38 + 0, { color: P.p });
      const bt = ballOf(node);
      if (node.id === ROOT_ID) {
        drawText(ctx, 'STANDARD BALL', 7, PANEL_Y + 38, { color: P['3'] });
      } else if (bt && lvl >= 1) {
        drawText(ctx, save.ballType === bt ? 'EQUIPPED' : 'IN LOADOUT', 7, PANEL_Y + 38, { color: P['4'] });
      } else if (!(node.id === ROOT_ID)) {
        const label = st === 'maxed' ? 'MAXED' : st === 'locked' ? 'LOCKED' : st === 'poor' ? 'NEED MORE' : 'BUY';
        btns.push({ id: 'buy', x: 100, y: PANEL_Y + 28, w: 74, h: 16, label, scale: st === 'ok' || st === 'maxed' ? 2 : 1, style: 'gold', disabled: st !== 'ok' });
      }
    } else {
      drawText(ctx, 'TAP A NODE TO INSPECT IT', 90, PANEL_Y + 19, { align: 'center', color: P['3'] });
    }

    btns.push({ id: 'menu', x: 4, y: 297, w: 30, h: 20, label: 'MENU', style: 'gray' });
    btns.push({ id: 'map', x: 36, y: 297, w: 28, h: 20, label: 'MAP', style: 'blue' });
    btns.push({ id: 'loadout', x: 66, y: 297, w: 52, h: 20, label: 'LOADOUT', style: 'gold' });
    btns.push({ id: 'start', x: 120, y: 297, w: 56, h: 20, label: 'START RUN', style: 'green' });
    this.buttons.set(btns);
    this.buttons.draw(ctx);
    if (now < this.gearHintUntil) {
      ctx.fillStyle = P['0'];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(10, VIEW_BOT - 38, 160, 14);
      ctx.globalAlpha = 1;
      drawText(ctx, 'EQUIP IT IN LOADOUT', 90, VIEW_BOT - 34, { align: 'center', color: Math.floor(now * 3) % 2 ? P.Y : P['5'] });
    }
    if (now < this.toastUntil) drawText(ctx, this.toast, 90, VIEW_BOT - 9, { align: 'center', color: P.Y, shadow: P['0'] });
  }

  private drawNode(ctx: CanvasRenderingContext2D, v: Vis, onPath: boolean, pulse: number, stubSeen: Set<number>): void {
    const { n, st, lvl } = v;
    const big = this.zoom === 1;
    const s = this.frameSize(n.kind);
    const cx = v.sx, cy = v.sy;
    if (v.sil) {
      fillLayer(ctx, n.kind, cx, cy, s, 0, P['0']);
      fillLayer(ctx, n.kind, cx, cy, s, 1, P['1']);
      return;
    }
    const owned = lvl > 0;
    let border = P['2'];
    if (st === 'maxed') border = P.Y;
    else if (owned) border = P.B;
    else if (st === 'ok') border = P['4'];
    else if (st === 'poor') border = P['3'];
    if (this.sel === n.id && Math.floor(this.now * 4) % 2 === 0) border = P['5'];
    if (st === 'ok') {
      ctx.globalAlpha = pulse;
      fillLayer(ctx, n.kind, cx, cy, s + 4, 0, P.Y);
      ctx.globalAlpha = 1;
    }
    if (onPath) {
      ctx.globalAlpha = 0.8;
      fillLayer(ctx, n.kind, cx, cy, s + 4, 0, P.c);
      ctx.globalAlpha = 1;
    }
    const locked = st === 'locked';
    fillLayer(ctx, n.kind, cx, cy, s, 0, P['0']);
    fillLayer(ctx, n.kind, cx, cy, s, 1, border);
    if (n.kind === 'capstone' && big) fillLayer(ctx, n.kind, cx, cy, s, 2, P.Y === border ? P.y : P['0']);
    const fillL = n.kind === 'capstone' && big ? 3 : 2;
    fillLayer(ctx, n.kind, cx, cy, s, fillL, locked ? P['0'] : n.currency === 'emerald' ? P.g : P['1']);
    const bt = ballOf(n);
    if (bt && this.app.save.ballType === bt) {
      ctx.fillStyle = P['0'];
      ctx.fillRect(cx + s / 2 - 5, cy - s / 2 - 1, 7, 8);
      drawText(ctx, 'E', cx + s / 2 - 4, cy - s / 2, { color: P.Y });
    }
    if (!big) return;
    // icon: 2x when it fits a plain square frame
    const isz = spriteSize(n.icon);
    const inner = s - 2 * fillL;
    const two = n.kind !== 'keystone' && isz.w * 2 <= inner - 2 && isz.h * 2 <= inner - 2;
    drawSprite(ctx, n.icon, cx, cy, { scale: two ? 2 : 1, alpha: locked ? 0.35 : 1 });
    if (locked) drawSprite(ctx, 'icon_lock', cx + s / 2 - 4, cy + s / 2 - 4);
    // pips
    const by = cy + Math.floor(s / 2) + 3;
    let ty = by;
    if (n.maxLevel > 1) {
      const gem = n.currency === 'emerald' ? P.E : P.Y;
      if (n.maxLevel <= 6) {
        const w = n.maxLevel * 4 - 1;
        const px = cx - Math.floor(w / 2);
        for (let i = 0; i < n.maxLevel; i++) {
          ctx.fillStyle = i < lvl ? gem : P['2'];
          ctx.fillRect(px + i * 4, by, 3, 3);
        }
      } else {
        ctx.fillStyle = P['2'];
        ctx.fillRect(cx - 10, by, 21, 3);
        ctx.fillStyle = gem;
        ctx.fillRect(cx - 10, by, Math.round((21 * lvl) / n.maxLevel), 3);
      }
      ty = by + 5;
    }
    // cost / MAX / graft stub text
    if (n.graft && locked && lvl === 0) {
      if (!stubSeen.has(n.graft)) {
        stubSeen.add(n.graft);
        const w = WORLDS.find((x) => x.index === n.graft);
        if (w) drawText(ctx, `REACH ${w.name.toUpperCase()}`, cx, ty, { align: 'center', color: P.p, shadow: P['0'] });
      }
      return;
    }
    const cost = nextCost(this.app.save, n);
    if (n.id === ROOT_ID) return;
    if (cost === null) {
      drawText(ctx, 'MAX', cx, ty, { align: 'center', color: P.Y, shadow: P['0'] });
    } else {
      const txt = String(cost);
      const w = textWidth(txt) + 7;
      const x0 = Math.round(cx - w / 2);
      drawSprite(ctx, n.currency === 'emerald' ? 'emerald' : 'coin', x0 + 2, ty + 3);
      drawText(ctx, txt, x0 + 7, ty, { color: st === 'ok' ? P.Y : P['3'], shadow: P['0'] });
    }
  }

  down(x: number, y: number): void {
    if (this.buttons.down(x, y)) {
      this.drag = null;
      return;
    }
    const d = { x0: x, y0: y, cx0: this.camX, cy0: this.camY, moved: false, prevSel: this.sel, picked: false };
    const v = this.nodeAt(x, y);
    if (v) {
      this.sel = v.n.id;
      d.picked = true;
      this.app.sfx.ui();
    }
    this.drag = d;
  }

  move(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > SLOP) {
      d.moved = true;
      if (d.picked) this.sel = d.prevSel; // a real pan began: undo the tap selection
    }
    if (d.moved) {
      this.camX = d.cx0 - (x - d.x0) / this.zoom;
      this.camY = d.cy0 - (y - d.y0) / this.zoom;
      this.clamp();
    }
  }

  up(x: number, y: number): void {
    if (this.drag) {
      this.drag = null;
      return;
    }
    const id = this.buttons.up(x, y);
    if (!id) return;
    const app = this.app;
    const save = app.save;
    app.sfx.ui();
    if (id === 'zoom') {
      this.zoom = this.zoom === 1 ? 0.5 : 1;
      this.clamp();
    } else if (id === 'recentre') {
      const root = nodesFor(save).find((n) => n.id === ROOT_ID);
      this.camX = root?.x ?? 320;
      this.camY = root?.y ?? 320;
      this.clamp();
    } else if (id === 'buy') {
      const node = nodesFor(save).find((n) => n.id === this.sel);
      if (node && buy(save, node)) {
        app.persist();
        app.sfx.buy();
        this.toast = 'PURCHASED!';
        this.toastUntil = this.now + 1;
        if (node.id !== ROOT_ID && gearOwned(save, node.id) && !save.hints.gearTaught) {
          save.hints.gearTaught = true;
          app.persist();
          this.gearHintUntil = this.now + 4;
        }
      }
    } else if (id === 'start') app.startRun();
    else if (id === 'menu') app.go('title');
    else if (id === 'map') app.go('map');
    else if (id === 'loadout') app.go('loadout');
    else if (id === 'settings') {
      app.settingsFrom = 'shop';
      app.go('settings');
    }
  }

  cancel(): void {
    this.drag = null;
    this.buttons.pressed = null;
  }
}
