// Gallery (v0.6 M2): every cue, ball, relic and trick is a card. Slot strip on top, scrolling card grid, tap a card for its page.
// Card page: unlock -> base I/II -> fork (M3) -> base III -> capstone (M3), drawn as a tiny tree.
import { TOKEN_OF_WORLD } from '../core/types';
import type { SaveData, TokenId } from '../core/types';
import { WORLDS, parseStageId } from '../core/worlds';
import { CARDS, buyBase, buyCard, cardBuyState, cardById, cardOwned } from '../meta/cards';
import type { CardDef, CardSlot } from '../meta/cards';
import { ROOT_ID, cueSlotOpen, equip, nodesFor, relicSlots, trickSlotOpen, unequip } from '../meta/index';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText, textWidth, wrapText } from '../render/text';
import { Buttons, drawPanel, drawTokenStrip, inRect } from './widgets';
import type { Button } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

const SLOP = 10;
const GRID_TOP = 64;
const GRID_BOT = 292;
const CARD = 36;
const PITCH = 42;
const GX0 = 12;
const SLOT_X0 = 6;
const SLOT_W = 24;
const SLOT_Y = 18;
const PANEL_Y = 262;
const GROUPS: { slot: CardSlot; title: string }[] = [
  { slot: 'cue', title: 'CUES' },
  { slot: 'ball', title: 'BALLS' },
  { slot: 'relic', title: 'RELICS' },
  { slot: 'trick', title: 'TRICKS' },
];

interface Slot { kind: CardSlot | 'counter'; index: number; open: boolean; hint: string; label: string }
interface Tile { def: CardDef; x: number; y: number }
interface Group { slot: CardSlot; title: string; y: number; tiles: Tile[] }
interface PageNode { id: string; cx: number; cy: number; size: number }

const tokenOf = (def: CardDef): TokenId => TOKEN_OF_WORLD[def.world - 1] ?? 'stripe';
const worldName = (w: number): string => (WORLDS.find((x) => x.index === w)?.name ?? `WORLD ${w}`).toUpperCase();

export class GalleryScreen implements Screen {
  private buttons = new Buttons();
  private groups: Group[] = [];
  private contentH = 0;
  private scroll = 0;
  private page: string | null = null;
  private node: string | null = null;
  private pageNodes: PageNode[] = [];
  private drag: { x0: number; y0: number; s0: number; moved: boolean; card: string | null; slot: number } | null = null;
  private toast = '';
  private toastUntil = 0;
  private now = 0;
  private slots: Slot[] = [];

  constructor(private app: App) {}

  enter(): void {
    this.drag = null;
    this.page = null;
    this.node = null;
    this.scroll = 0;
  }

  // ---------- helpers ----------

  private levelOf(id: string): number {
    return this.app.save.cards[id]?.level ?? 0;
  }

  private equipped(def: CardDef): boolean {
    const lo = this.app.save.loadout;
    if (def.slot === 'ball') return lo.ball === def.id;
    if (def.slot === 'cue') return lo.cue === def.id;
    if (def.slot === 'trick') return lo.trick === def.id;
    return (lo.relics as string[]).includes(def.id);
  }

  private slotOpen(slot: CardSlot): boolean {
    const save = this.app.save;
    if (slot === 'cue') return cueSlotOpen(save);
    if (slot === 'trick') return trickSlotOpen(save);
    return true;
  }

  private say(text: string): void {
    this.toast = text;
    this.toastUntil = this.now + 1.4;
  }

  private layout(): void {
    const groups: Group[] = [];
    let y = 0;
    for (const g of GROUPS) {
      const defs = CARDS.map((c, i) => ({ c, i })).filter((e) => e.c.slot === g.slot).sort((a, b) => a.c.world - b.c.world || a.i - b.i).map((e) => e.c);
      if (!defs.length) continue;
      const grp: Group = { slot: g.slot, title: g.title, y, tiles: [] };
      const top = y + 11;
      defs.forEach((def, i) => grp.tiles.push({ def, x: GX0 + (i % 4) * PITCH, y: top + Math.floor(i / 4) * PITCH }));
      y = top + Math.ceil(defs.length / 4) * PITCH + 2;
      groups.push(grp);
    }
    this.groups = groups;
    this.contentH = y;
    this.clampScroll();
  }

  private clampScroll(): void {
    const max = Math.max(0, this.contentH - (GRID_BOT - GRID_TOP));
    this.scroll = Math.max(0, Math.min(max, this.scroll));
  }

  private buildSlots(): void {
    const save = this.app.save;
    const nRelic = relicSlots(save);
    const hints = ['OWN A RELIC', 'WORLD 2', 'WORLD 4'];
    const defs: Slot[] = [
      { kind: 'ball', index: 0, open: true, hint: '', label: 'BALL' },
      { kind: 'cue', index: 0, open: cueSlotOpen(save), hint: 'OWN A CUE', label: 'CUE' },
    ];
    for (let i = 0; i < 3; i++) defs.push({ kind: 'relic', index: i, open: i < nRelic, hint: hints[i], label: 'RELIC' });
    defs.push({ kind: 'trick', index: 0, open: trickSlotOpen(save), hint: 'WORLD 2', label: 'TRICK' });
    defs.push({ kind: 'counter', index: 0, open: true, hint: '', label: 'CNTR' });
    this.slots = defs;
  }

  private equippedId(s: Slot): string | null {
    const lo = this.app.save.loadout;
    if (s.kind === 'ball') return lo.ball;
    if (s.kind === 'cue') return lo.cue === 'standard' ? null : lo.cue;
    if (s.kind === 'trick') return lo.trick;
    if (s.kind === 'relic') return lo.relics[s.index] ?? null;
    return null;
  }

  private ballIcon(): string {
    return nodesFor(this.app.save).find((n) => n.id === ROOT_ID)?.icon ?? 'hero';
  }

  /** Counter icon of the current stage's world when that world's portal is owned. */
  private counterIcon(): string | null {
    const save = this.app.save;
    let w = 1;
    try { w = parseStageId(save.current).world; } catch { /* ignore */ }
    if (w < 2) return null;
    const nodes = nodesFor(save);
    if (!nodes.some((n) => n.id === `portal_w${w}` && (save.levels[n.id] ?? 0) > 0)) return null;
    return nodes.find((n) => n.id === `g${w}_counter`)?.icon ?? 'slot_counter';
  }

  private ownedCount(): { n: number; m: number } {
    const save = this.app.save;
    const real = CARDS.filter((c) => !c.stub);
    return { n: real.filter((c) => cardOwned(save, c.id)).length, m: real.length };
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.now = now;
    const save = this.app.save;
    ctx.drawImage(getMenuBg(), 0, 0);
    this.layout();
    this.buildSlots();
    const btns: Button[] = [];

    const def = this.page ? cardById(this.page) : undefined;
    const hx = def ? 22 : 0; // the back button takes the header's left corner on a card page
    drawSprite(ctx, 'coin', 9 + hx, 8);
    drawText(ctx, String(Math.floor(save.cash)), 16 + hx, 5, { color: P.Y, shadow: P['0'] });
    drawTokenStrip(ctx, save, 62 + hx);

    if (def) this.drawPage(ctx, now, def, btns);
    else {
      this.drawSlots(ctx, now);
      const c = this.ownedCount();
      if (now < this.toastUntil) drawText(ctx, this.toast, 90, 54, { align: 'center', color: P.Y, shadow: P['0'] });
      else drawText(ctx, `${c.n} OF ${c.m} FOUND`, 90, 54, { align: 'center', color: P['3'] });
      this.drawGrid(ctx, now);
    }
    if (def && now < this.toastUntil) drawText(ctx, this.toast, 90, 255, { align: 'center', color: P.Y, shadow: P['0'] });

    if (def) btns.push({ id: 'back', x: 4, y: 3, w: 16, h: 13, label: '<', style: 'gray' });
    btns.push({ id: 'map', x: 4, y: 297, w: 34, h: 20, label: 'MAP', style: 'blue' });
    btns.push({ id: 'tree', x: 40, y: 297, w: 34, h: 20, label: 'TREE', style: 'blue' });
    btns.push({ id: 'start', x: 76, y: 297, w: 100, h: 20, label: 'START RUN', style: 'green' });
    this.buttons.set(btns);
    this.buttons.draw(ctx);
  }

  private drawSlots(ctx: CanvasRenderingContext2D, now: number): void {
    const cIcon = this.counterIcon();
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const x = SLOT_X0 + i * SLOT_W;
      const cx = x + SLOT_W / 2;
      const isCounter = s.kind === 'counter';
      const eq = !isCounter && s.open ? this.equippedId(s) : null;
      drawSprite(ctx, s.open ? 'slot_empty' : 'slot_locked', cx, SLOT_Y + 8);
      if (isCounter) drawSprite(ctx, cIcon ?? 'slot_counter', cx, SLOT_Y + 8, { alpha: cIcon ? 1 : 0.35 });
      else if (eq) {
        const d = cardById(eq);
        drawSprite(ctx, s.kind === 'ball' && !d ? this.ballIcon() : d?.icon ?? `gear_${eq}`, cx, SLOT_Y + 8);
      } else if (s.kind === 'ball') drawSprite(ctx, this.ballIcon(), cx, SLOT_Y + 8);
      drawText(ctx, s.label, cx, SLOT_Y + 18, { align: 'center', color: s.open ? P['4'] : P['2'] });
      let nm = s.open ? 'EMPTY' : 'LOCKED';
      if (isCounter) nm = 'AUTO';
      else if (eq) nm = (cardById(eq)?.name ?? eq).toUpperCase();
      else if (s.kind === 'ball') nm = 'PLAIN';
      drawText(ctx, nm.slice(0, 5), cx, SLOT_Y + 25, { align: 'center', color: eq || isCounter ? P.E : P['3'] });
      void now;
    }
  }

  /** The 36x36 card tile. */
  private drawCard(ctx: CanvasRenderingContext2D, def: CardDef, x: number, y: number, now: number): void {
    const save = this.app.save;
    const st = cardBuyState(save, def.id);
    const eq = this.equipped(def) && cardOwned(save, def.id);
    const owned = st === 'owned' || st === 'maxed' || cardOwned(save, def.id);
    const tok = tokenOf(def);
    const have = save.tokens?.[tok] ?? 0;
    let border: string = P['2'];
    if (st === 'stub') border = P['1'];
    else if (eq) border = P.Y;
    else if (owned) border = P.B;
    else if (st === 'open') border = P.Y;
    if (st === 'open') {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now * 5);
      ctx.fillStyle = P.Y;
      ctx.fillRect(x - 2, y - 2, CARD + 4, CARD + 4);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = P['0'];
    ctx.fillRect(x, y, CARD, CARD);
    ctx.fillStyle = border;
    ctx.fillRect(x + 1, y + 1, CARD - 2, CARD - 2);
    const inset = eq ? 3 : 2;
    ctx.fillStyle = P['1'];
    ctx.fillRect(x + inset, y + inset, CARD - 2 * inset, CARD - 2 * inset);
    const dim = !owned;
    drawSprite(ctx, def.icon, x + 18, y + 15, { scale: 2, alpha: dim ? 0.3 : 1 });
    if (st === 'stub') {
      drawText(ctx, 'SOON', x + 18, y + 28, { align: 'center', color: P.p });
    } else if (!owned) {
      drawSprite(ctx, `token_${tok}`, x + 10, y + 30);
      drawText(ctx, '1', x + 16, y + 28, { color: st === 'open' ? P.Y : have < 1 ? P.R : P['3'] });
    } else {
      const lv = this.levelOf(def.id);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < lv ? P.Y : P['2'];
        ctx.fillRect(x + 13 + i * 4, y + 30, 3, 3);
      }
      if (eq) {
        ctx.fillStyle = P['0'];
        ctx.fillRect(x + CARD - 9, y + 3, 7, 8);
        drawText(ctx, 'E', x + CARD - 7, y + 4, { color: P.Y });
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, GRID_TOP, 180, GRID_BOT - GRID_TOP);
    ctx.clip();
    const oy = GRID_TOP - this.scroll;
    for (const g of this.groups) {
      const hy = oy + g.y;
      if (hy > GRID_BOT || hy + 11 + Math.ceil(g.tiles.length / 4) * PITCH < GRID_TOP) continue;
      drawText(ctx, g.title, GX0, hy + 1, { color: P.Y, shadow: P['0'] });
      ctx.fillStyle = P['2'];
      ctx.fillRect(GX0 + textWidth(g.title) + 3, hy + 3, 162 - GX0 - textWidth(g.title), 1);
      for (const t of g.tiles) {
        const ty = oy + t.y;
        if (ty > GRID_BOT || ty + CARD < GRID_TOP) continue;
        this.drawCard(ctx, t.def, t.x, ty, now);
      }
    }
    ctx.restore();
    // scrollbar
    const view = GRID_BOT - GRID_TOP;
    if (this.contentH > view) {
      const th = Math.max(8, Math.round((view * view) / this.contentH));
      const ty = GRID_TOP + Math.round(((view - th) * this.scroll) / (this.contentH - view));
      ctx.fillStyle = P['2'];
      ctx.fillRect(177, GRID_TOP, 1, view);
      ctx.fillStyle = P['3'];
      ctx.fillRect(177, ty, 1, th);
    }
  }

  // ---------- card page ----------

  private drawNodeSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, border: string, fill: string): void {
    const x = Math.round(cx - size / 2), y = Math.round(cy - size / 2);
    ctx.fillStyle = P['0'];
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = border;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  }

  private drawPage(ctx: CanvasRenderingContext2D, now: number, def: CardDef, btns: Button[]): void {
    const save = this.app.save;
    const stub = !!def.stub;
    const owned = cardOwned(save, def.id);
    const lv = this.levelOf(def.id);
    const tok = tokenOf(def);
    const have = save.tokens?.[tok] ?? 0;
    const grey = stub ? 0.4 : 1;
    this.pageNodes = [];

    drawText(ctx, def.name.toUpperCase(), 90, 20, { align: 'center', scale: 2, color: P.Y, shadow: P['0'] });
    drawText(ctx, def.desc.toUpperCase(), 90, 36, { align: 'center', color: P['4'] });
    const wtxt = `WORLD ${def.world}`;
    const tw = textWidth(wtxt) + 11;
    const wx = Math.round(90 - tw / 2);
    drawText(ctx, wtxt, wx, 46, { color: P['3'] });
    drawSprite(ctx, `token_${tok}`, wx + textWidth(wtxt) + 6, 48);

    // chain geometry (centres)
    const UY = 70, I_Y = 107.5, II_Y = 139.5, FORK_Y = 173.5, III_Y = 211.5, CAP_Y = 245.5;
    const link = (x0: number, y0: number, x1: number, y1: number, a: boolean, b: boolean): void => {
      ctx.fillStyle = (a && b) ? P.Y : a ? P['3'] : P['2'];
      const x = Math.round(Math.min(x0, x1)), y = Math.round(Math.min(y0, y1));
      ctx.globalAlpha = grey;
      ctx.fillRect(x, y, Math.max(1, Math.abs(Math.round(x1) - Math.round(x0))), Math.max(1, Math.abs(Math.round(y1) - Math.round(y0))));
      ctx.globalAlpha = 1;
    };
    // vertical links (fork row is joined by a short horizontal bar)
    link(90, UY + 18, 90, I_Y - 11, owned, owned && lv >= 0);
    link(90, I_Y + 11, 90, II_Y - 11, lv >= 1, lv >= 1);
    link(90, II_Y + 11, 90, FORK_Y - 9, lv >= 2, false);
    link(70, FORK_Y, 110, FORK_Y + 1, false, false);
    link(90, FORK_Y + 9, 90, III_Y - 11, false, false);
    link(90, III_Y + 11, 90, CAP_Y - 9, lv >= 3, false);

    // unlock card
    this.drawCard(ctx, def, 72, 52, now);
    this.pageNodes.push({ id: 'unlock', cx: 90, cy: UY, size: 36 });
    if (this.node === 'unlock' && Math.floor(now * 4) % 2 === 0) {
      ctx.fillStyle = P['5'];
      ctx.fillRect(70, 50, 40, 1); ctx.fillRect(70, 89, 40, 1); ctx.fillRect(70, 50, 1, 40); ctx.fillRect(109, 50, 1, 40);
    }

    // base nodes
    const baseY = [I_Y, II_Y, III_Y];
    const roman = ['I', 'II', 'III'];
    for (let i = 0; i < 3; i++) {
      const cy = baseY[i];
      const done = owned && lv > i;
      const next = owned && lv === i;
      const gated = i === 2 && def.forks.length > 0 && save.cards[def.id]?.fork === null;
      const cost = def.base[i].cost(i as 0 | 1 | 2);
      const afford = next && !gated && save.cash >= cost;
      let border: string = P['2'];
      if (done) border = lv === 3 ? P.Y : P.B;
      else if (afford) border = P.Y;
      else if (next) border = P['3'];
      if (this.node === `b${i}` && Math.floor(now * 4) % 2 === 0) border = P['5'];
      ctx.globalAlpha = grey;
      if (afford) {
        ctx.globalAlpha = (0.35 + 0.25 * Math.sin(now * 5)) * grey;
        ctx.fillStyle = P.Y;
        ctx.fillRect(Math.round(90 - 13.5), Math.round(cy - 13.5), 27, 27);
        ctx.globalAlpha = grey;
      }
      this.drawNodeSquare(ctx, 90, cy, 23, border, P['1']);
      drawSprite(ctx, def.icon, 90, cy, { scale: 2, alpha: (done || next) ? grey : 0.3 * grey });
      drawText(ctx, roman[i], 70 - textWidth(roman[i]), cy - 2, { color: done ? P.Y : P['3'] });
      if (!done) drawText(ctx, String(cost), 90, cy + 13, { align: 'center', color: afford ? P.Y : next && save.cash < cost ? P.R : P['3'] });
      ctx.globalAlpha = 1;
      this.pageNodes.push({ id: `b${i}`, cx: 90, cy, size: 23 });
    }

    // fork row (M3): greyed
    ctx.globalAlpha = 0.45;
    for (const fx of [70, 110]) {
      this.drawNodeSquare(ctx, fx, FORK_Y, 19, P['2'], P['1']);
      drawSprite(ctx, 'node_fork', fx, FORK_Y, { scale: 2 });
    }
    ctx.globalAlpha = 1;
    drawText(ctx, 'SOON', 90, FORK_Y - 2, { align: 'center', color: P['3'] });

    // capstone row (M3): greyed
    ctx.globalAlpha = 0.45;
    this.drawNodeSquare(ctx, 90, CAP_Y, 19, P['2'], P['1']);
    drawSprite(ctx, 'node_capstone', 90, CAP_Y, { scale: 2 });
    ctx.globalAlpha = 1;
    drawText(ctx, 'SOON', 105, CAP_Y - 2, { color: P['3'] });

    this.drawPanel(ctx, def, btns, have);
  }

  private drawPanel(ctx: CanvasRenderingContext2D, def: CardDef, btns: Button[], have: number): void {
    const save = this.app.save;
    const tok = tokenOf(def);
    const owned = cardOwned(save, def.id);
    const lv = this.levelOf(def.id);
    drawPanel(ctx, 2, PANEL_Y, 176, 34);
    const ty = PANEL_Y + 5;
    if (def.stub) {
      drawText(ctx, `COMING WITH ${worldName(def.world)}`, 90, PANEL_Y + 14, { align: 'center', color: P.p });
      return;
    }
    const sel = this.node;
    if (sel === 'unlock' || sel === null) {
      drawText(ctx, def.name.toUpperCase(), 7, ty, { color: P.Y, shadow: P['0'] });
      drawText(ctx, owned ? 'OWNED' : 'LOCKED', 94, ty, { align: 'right', color: P['4'] });
      drawText(ctx, owned ? 'TAP A NODE TO UPGRADE' : 'NEEDS A BOSS TOKEN', 7, ty + 9, { color: P['4'] });
      if (!owned) {
        drawSprite(ctx, `token_${tok}`, 11, PANEL_Y + 27);
        drawText(ctx, '1', 18, PANEL_Y + 24, { color: have >= 1 ? P.Y : P.R, shadow: P['0'] });
        const st = cardBuyState(save, def.id);
        btns.push({ id: 'buyCard', x: 100, y: PANEL_Y + 8, w: 74, h: 16, label: st === 'open' ? 'BUY' : 'NEED MORE', scale: st === 'open' ? 2 : 1, style: 'gold', disabled: st !== 'open' });
      }
    } else if (/^b[0-2]$/.test(sel)) {
      const i = Number(sel[1]);
      const b = def.base[i];
      const cost = b.cost(i as 0 | 1 | 2);
      const done = owned && lv > i;
      drawText(ctx, b.name.toUpperCase(), 7, ty, { color: P.Y, shadow: P['0'] });
      drawText(ctx, done ? 'OWNED' : `LV${i}>${i + 1}`, 94, ty, { align: 'right', color: P['4'] });
      const lines = wrapText(b.desc.toUpperCase(), 21).slice(0, 2);
      lines.forEach((l, k) => drawText(ctx, l, 7, ty + 9 + k * 7, { color: P['4'] }));
      if (!done) {
        drawSprite(ctx, 'coin', 11, PANEL_Y + 28);
        drawText(ctx, String(cost), 18, PANEL_Y + 25, { color: save.cash >= cost ? P.Y : P.R, shadow: P['0'] });
      }
      const next = owned && lv === i;
      const gated = i === 2 && def.forks.length > 0 && save.cards[def.id]?.fork === null;
      const poor = save.cash < cost;
      const label = done ? 'OWNED' : !owned || !next ? 'LOCKED' : gated ? 'PICK FORK' : poor ? 'NEED MORE' : 'BUY';
      btns.push({ id: 'buyBase', x: 100, y: PANEL_Y + 3, w: 74, h: 14, label, scale: label === 'BUY' ? 2 : 1, style: 'gold', disabled: label !== 'BUY' });
    }
    if (owned) {
      const eq = this.equipped(def);
      const open = this.slotOpen(def.slot);
      const label = !open ? 'SLOT LOCKED' : eq ? 'UNEQUIP' : 'EQUIP';
      btns.push({ id: 'equip', x: 100, y: PANEL_Y + 18, w: 74, h: 14, label, scale: label === 'EQUIP' ? 2 : 1, style: eq ? 'red' : 'gold', disabled: !open });
    }
  }

  // ---------- input ----------

  private tileAt(x: number, y: number): Tile | undefined {
    if (y < GRID_TOP || y >= GRID_BOT) return undefined;
    const oy = GRID_TOP - this.scroll;
    for (const g of this.groups) for (const t of g.tiles) if (inRect(x, y, t.x, oy + t.y, CARD, CARD)) return t;
    return undefined;
  }

  private slotAt(x: number, y: number): number {
    if (y < SLOT_Y - 2 || y >= SLOT_Y + 32) return -1;
    const i = Math.floor((x - SLOT_X0) / SLOT_W);
    return i >= 0 && i < this.slots.length ? i : -1;
  }

  private pageNodeAt(x: number, y: number): PageNode | undefined {
    let best: PageNode | undefined;
    let bd = Infinity;
    for (const n of this.pageNodes) {
      const h = n.size / 2 + 2;
      if (Math.abs(x - n.cx) <= h && Math.abs(y - n.cy) <= h) {
        const d = (x - n.cx) ** 2 + (y - n.cy) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  down(x: number, y: number): void {
    this.drag = null;
    if (this.buttons.down(x, y)) return;
    const d = { x0: x, y0: y, s0: this.scroll, moved: false, card: null as string | null, slot: this.slotAt(x, y) };
    if (this.page) d.card = this.pageNodeAt(x, y)?.id ?? null;
    else d.card = this.tileAt(x, y)?.def.id ?? null;
    this.drag = d;
  }

  move(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > SLOP) d.moved = true;
    if (d.moved && !this.page && d.slot < 0) {
      this.scroll = d.s0 - (y - d.y0);
      this.clampScroll();
    }
  }

  up(x: number, y: number): void {
    const d = this.drag;
    if (d) {
      this.drag = null;
      if (d.moved) return;
      const app = this.app;
      if (this.page) {
        const n = this.pageNodeAt(x, y);
        if (n && n.id === d.card) { this.node = n.id; app.sfx.ui(); }
      } else if (d.slot >= 0 && this.slotAt(x, y) === d.slot) {
        this.tapSlot(this.slots[d.slot]);
      } else if (d.card && this.tileAt(x, y)?.def.id === d.card) {
        this.page = d.card;
        this.node = 'unlock';
        app.sfx.ui();
      }
      return;
    }
    const id = this.buttons.up(x, y);
    if (!id) return;
    const app = this.app;
    const save = app.save;
    app.sfx.ui();
    const def = this.page ? cardById(this.page) : undefined;
    if (id === 'back') { this.page = null; this.node = null; }
    else if (id === 'map') app.go('map');
    else if (id === 'tree') app.go('shop');
    else if (id === 'start') app.startRun();
    else if (def && id === 'buyCard') {
      if (buyCard(save, def.id)) this.bought(save, 'CARD FOUND!');
    } else if (def && id === 'buyBase') {
      if (buyBase(save, def.id)) this.bought(save, 'UPGRADED!');
    } else if (def && id === 'equip') this.toggleEquip(save, def);
  }

  private bought(save: SaveData, msg: string): void {
    void save;
    this.app.persist();
    this.app.sfx.buy();
    this.say(msg);
  }

  private tapSlot(s: Slot): void {
    this.app.sfx.ui();
    if (s.kind === 'counter') { this.say('COUNTER IS AUTOMATIC'); return; }
    if (!s.open) { this.say(`LOCKED: ${s.hint}`); return; }
    // jump the grid to this slot's group
    const g = this.groups.find((x) => x.slot === s.kind);
    if (g) { this.scroll = g.y; this.clampScroll(); }
  }

  private toggleEquip(save: SaveData, def: CardDef): void {
    const lo = save.loadout;
    let ok = false;
    let msg = 'EQUIPPED!';
    if (this.equipped(def)) {
      msg = 'UNEQUIPPED';
      if (def.slot === 'ball') { lo.ball = 'standard'; ok = true; }
      else if (def.slot === 'relic') ok = unequip(save, 'relic', lo.relics.indexOf(def.id as never));
      else ok = unequip(save, def.slot, undefined);
    } else if (def.slot === 'ball') {
      lo.ball = def.id as typeof lo.ball;
      ok = true;
    } else if (def.slot === 'relic') {
      ok = equip(save, 'relic', def.id, lo.relics.length < relicSlots(save) ? undefined : 0);
    } else ok = equip(save, def.slot, def.id);
    if (ok) {
      this.app.persist();
      this.say(msg);
    }
  }

  cancel(): void {
    this.drag = null;
    this.buttons.pressed = null;
  }
}
