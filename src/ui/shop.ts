// Upgrade shop: tabs, scrollable node grid with connectors, buy panel, stage + ball selectors.
import type { BallType, RunStats, StageId, TreeId, UpgradeNode } from '../core/types';
import { BASE_STATS, STAGES } from '../core/tuning';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText, textWidth, wrapText } from '../render/text';
import { Buttons, drawBuyDot, drawPanel, inRect, syncHints } from './widgets';
import type { Button } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;
type Tab = 'power' | 'vitality' | 'tactics' | 'combo' | 'emerald' | 'stage';
const TABS: Tab[] = ['power', 'vitality', 'tactics', 'combo', 'emerald', 'stage'];
const BALLS: BallType[] = ['standard', 'heavy', 'light', 'sticky'];
const BALL_SPRITE: Record<BallType, string> = { standard: 'ball_main', heavy: 'ball_heavy', light: 'ball_light', sticky: 'ball_sticky' };

const NODE = 30;
const PITCH_X = 44;
const PITCH_Y = 40;
const TREE_BOTTOM = 232;
const PANEL_Y = 234;

function fmtNum(v: number, pct: boolean): string {
  if (pct) return `${Math.round(v * 100)}%`;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Fill the {v} placeholder by diffing stats the node applies at the shown level. */
function describe(node: UpgradeNode, level: number): string {
  if (!node.desc.includes('{v}')) return node.desc;
  const lv = Math.max(1, Math.min(node.maxLevel, level + 1));
  let text = `LV ${lv}`;
  try {
    const a: RunStats = { ...BASE_STATS };
    node.apply(a, lv);
    for (const k of Object.keys(BASE_STATS) as (keyof RunStats)[]) {
      const av = a[k], bv = BASE_STATS[k];
      if (typeof av === 'number' && typeof bv === 'number' && av !== bv) {
        const delta = node.desc.includes('+{v}');
        text = fmtNum(delta ? av - bv : av, /Chance|Pct$/.test(k) || node.desc.includes('{v}%'));
        break;
      }
    }
  } catch { /* keep LV fallback */ }
  return node.desc.replace('{v}', text);
}

export class ShopScreen implements Screen {
  private buttons = new Buttons();
  private tab: Tab = 'power';
  private sel: string | null = null;
  private scroll = 0;
  private maxScroll = 0;
  private treeTop = 51;
  private drag: { y0: number; s0: number; moved: boolean; prevSel: string | null; picked: boolean } | null = null;
  private toast = '';
  private toastUntil = 0;
  private now = 0;
  private boxes = new Map<string, { x: number; y: number }>();

  constructor(private app: App) {}

  enter(): void {
    syncHints(this.app);
    this.scroll = 0;
    this.sel = null;
    this.drag = null;
  }

  private tabOpen(t: Tab): boolean {
    return t === 'combo' || t === 'emerald' || t === 'stage' ? !!this.app.save.hints[`tab:${t}`] : true;
  }

  private tabHasBuy(t: Tab): boolean {
    const id = t === 'stage' ? `stage:${this.app.save.current}` : t;
    return this.app.meta.NODES.some((n) => n.tree === id && this.app.meta.buyState(this.app.save, n) === 'ok');
  }

  private nodeAt(x: number, y: number): UpgradeNode | undefined {
    if (y < this.treeTop || y >= TREE_BOTTOM) return undefined;
    for (const n of this.nodes()) {
      const b = this.boxes.get(n.id);
      if (b && inRect(x, y, b.x - 3, b.y - 3, NODE + 6, NODE + 6)) return n;
    }
    return undefined;
  }

  private treeId(): TreeId {
    return this.tab === 'stage' ? (`stage:${this.app.save.current}` as TreeId) : this.tab;
  }

  private nodes(): UpgradeNode[] {
    const id = this.treeId();
    return this.app.meta.NODES.filter((n) => n.tree === id);
  }

  private owned(t: BallType): boolean {
    if (t === 'standard') return true;
    return this.app.meta.buildStats({ ...this.app.save, ballType: t }).ballType === t;
  }

  private layoutBoxes(nodes: UpgradeNode[]): void {
    this.boxes.clear();
    let maxRow = 0;
    for (const n of nodes) {
      this.boxes.set(n.id, { x: 4 + n.pos.col * PITCH_X + 7, y: this.treeTop + 3 + n.pos.row * PITCH_Y - this.scroll });
      maxRow = Math.max(maxRow, n.pos.row);
    }
    const content = (maxRow + 1) * PITCH_Y + 6;
    this.maxScroll = Math.max(0, content - (TREE_BOTTOM - this.treeTop));
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll));
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.now = now;
    syncHints(this.app);
    if (!this.tabOpen(this.tab)) this.tab = 'power';
    const app = this.app;
    const save = app.save;
    const meta = app.meta;
    ctx.drawImage(getMenuBg(), 0, 0);
    this.treeTop = this.tab === 'emerald' ? 68 : 51;
    const nodes = this.nodes();
    this.layoutBoxes(nodes);
    const btns: Button[] = [];

    // header
    drawSprite(ctx, 'coin', 9, 8);
    drawText(ctx, String(Math.floor(save.cash)), 16, 5, { color: P.Y, shadow: P['0'], scale: 1 });
    drawSprite(ctx, 'emerald', 82, 8);
    drawText(ctx, String(save.emeralds), 89, 5, { color: P.E, shadow: P['0'] });
    btns.push({ id: 'settings', x: 144, y: 1, w: 32, h: 16, label: 'SET', style: 'gray' });

    // stage selector
    const stage = STAGES.find((s) => s.id === save.current) ?? STAGES[0];
    if (save.unlocked > 0) {
      btns.push({ id: 'stagePrev', x: 4, y: 17, w: 16, h: 13, label: '<', style: 'gray', disabled: stage.index <= 0 });
      btns.push({ id: 'stageNext', x: 160, y: 17, w: 16, h: 13, label: '>', style: 'gray', disabled: stage.index >= Math.min(save.unlocked, STAGES.length - 1) });
    }
    drawText(ctx, stage.name.toUpperCase(), 90, 21, { align: 'center', color: P['4'], shadow: P['0'] });

    // tabs
    let tx = 2;
    TABS.forEach((t) => {
      const open = this.tabOpen(t);
      const w = !open || t === 'emerald' ? 20 : textWidth(t.toUpperCase()) + 8;
      btns.push({ id: `tab:${t}`, x: tx, y: 32, w, h: 16, ...(!open ? { icon: 'icon_lock' } : t === 'emerald' ? { icon: 'emerald' } : { label: t.toUpperCase() }), style: 'gray', active: t === this.tab, disabled: !open, hitPad: 1 });
      tx += w + 2;
    });

    // ball selector
    if (this.tab === 'emerald') {
      drawText(ctx, 'BALL', 4, 56, { color: P['3'] });
      BALLS.forEach((b, i) => {
        const own = this.owned(b);
        btns.push({ id: `ball:${b}`, x: 28 + i * 34, y: 51, w: 30, h: 15, icon: BALL_SPRITE[b], style: 'gray', disabled: !own, active: save.ballType === b });
      });
    }

    // tree area (clipped, scrollable)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.treeTop, 180, TREE_BOTTOM - this.treeTop);
    ctx.clip();
    // connectors
    for (const n of nodes) {
      const b = this.boxes.get(n.id)!;
      for (const rid of n.requires ?? []) {
        const rb = this.boxes.get(rid);
        if (!rb) continue;
        const met = meta.nodeLevel(save, rid) >= 1;
        ctx.fillStyle = met ? P['4'] : P['2'];
        const x0 = rb.x + NODE / 2, y0 = rb.y + NODE / 2, x1 = b.x + NODE / 2, y1 = b.y + NODE / 2;
        // vertical from parent, then horizontal into child
        ctx.fillRect(x0, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1);
        ctx.fillRect(Math.min(x0, x1), y1, Math.abs(x1 - x0) + 1, 1);
      }
    }
    for (const n of nodes) this.drawNode(ctx, n, this.boxes.get(n.id)!);
    ctx.restore();
    if (this.maxScroll > 0) {
      const th = TREE_BOTTOM - this.treeTop;
      const bh = Math.max(8, Math.round((th * th) / (th + this.maxScroll)));
      const by = this.treeTop + Math.round(((th - bh) * this.scroll) / this.maxScroll);
      ctx.fillStyle = P['3'];
      ctx.fillRect(178, by, 2, bh);
    }
    if (nodes.length === 0) drawText(ctx, 'NOTHING HERE YET', 90, 120, { align: 'center', color: P['3'] });

    // bottom panel
    drawPanel(ctx, 2, PANEL_Y, 176, 62);
    const node = nodes.find((n) => n.id === this.sel);
    if (node) {
      const lvl = meta.nodeLevel(save, node.id);
      const st = meta.buyState(save, node);
      const nm = node.name;
      const lv = lvl >= node.maxLevel ? `LV${lvl} MAX` : `LV${lvl}>${lvl + 1}`;
      drawText(ctx, `${nm} ${lv}`, 7, PANEL_Y + 5, { color: node.currency === 'emerald' ? P.E : P.Y, shadow: P['0'], scale: 2 });
      wrapText(describe(node, lvl), 20).slice(0, 2).forEach((l, i) => drawText(ctx, l, 7, PANEL_Y + 17 + i * 10, { color: P['4'], scale: 2 }));
      const cost = meta.nextCost(save, node);
      if (cost !== null) {
        drawSprite(ctx, node.currency === 'emerald' ? 'emerald' : 'coin', 12, PANEL_Y + 49);
        drawText(ctx, String(cost), 20, PANEL_Y + 46, { color: node.currency === 'emerald' ? P.E : P.Y, shadow: P['0'] });
      }
      const label = st === 'maxed' ? 'MAXED' : st === 'locked' ? 'LOCKED' : st === 'poor' ? 'NEED MORE' : 'BUY';
      btns.push({ id: 'buy', x: 84, y: PANEL_Y + 37, w: 90, h: 22, label, scale: st === 'ok' || st === 'maxed' ? 2 : 1, style: 'gold', disabled: st !== 'ok' });
    } else {
      drawText(ctx, 'TAP A NODE TO INSPECT IT', 90, PANEL_Y + 26, { align: 'center', color: P['3'] });
    }

    btns.push({ id: 'menu', x: 4, y: 297, w: 50, h: 20, label: 'MENU', style: 'gray' });
    btns.push({ id: 'start', x: 58, y: 297, w: 118, h: 20, label: 'START RUN', scale: 2, style: 'green' });
    this.buttons.set(btns);
    this.buttons.draw(ctx);
    for (const b of btns) if (b.id.startsWith('tab:') && !b.disabled && this.tabHasBuy(b.id.slice(4) as Tab)) drawBuyDot(ctx, b);
    if (now < this.toastUntil) drawText(ctx, this.toast, 90, 288, { align: 'center', color: P.Y, shadow: P['0'] });
  }

  private drawNode(ctx: CanvasRenderingContext2D, n: UpgradeNode, b: { x: number; y: number }): void {
    const { meta, save } = this.app;
    const lvl = meta.nodeLevel(save, n.id);
    const st = meta.buyState(save, n);
    const selected = this.sel === n.id;
    let border = P['2'];
    if (st === 'maxed') border = P.Y;
    else if (lvl > 0) border = P.B;
    else if (st === 'ok') border = P['4'];
    else if (st === 'poor') border = P['3'];
    if (selected && Math.floor(this.now * 4) % 2 === 0) border = P['5'];
    ctx.fillStyle = P['0'];
    ctx.fillRect(b.x - 1, b.y - 1, NODE + 2, NODE + 2);
    ctx.fillStyle = border;
    ctx.fillRect(b.x, b.y, NODE, NODE);
    ctx.fillStyle = st === 'locked' ? P['0'] : n.currency === 'emerald' ? P.g : P['1'];
    ctx.fillRect(b.x + 1, b.y + 1, NODE - 2, NODE - 2);
    drawSprite(ctx, n.icon, b.x + NODE / 2, b.y + 11, { scale: 2, alpha: st === 'locked' ? 0.35 : 1 });
    if (st === 'locked') drawSprite(ctx, 'icon_lock', b.x + NODE - 7, b.y + 17);
    // cost under the card
    {
      const cost = meta.nextCost(save, n);
      const cy = b.y + NODE + 2;
      if (cost === null) {
        drawText(ctx, 'MAX', b.x + NODE / 2, cy, { align: 'center', color: P.Y });
      } else {
        const txt = String(cost);
        const w = textWidth(txt) + 7;
        const x0 = Math.round(b.x + NODE / 2 - w / 2);
        drawSprite(ctx, n.currency === 'emerald' ? 'emerald' : 'coin', x0 + 2, cy + 3);
        drawText(ctx, txt, x0 + 7, cy, { color: st === 'ok' ? P.Y : P['3'] });
      }
    }
    // level pips / bar
    const py = b.y + NODE - 6;
    if (n.maxLevel <= 6) {
      const w = n.maxLevel * 4 - 1;
      const px = Math.round(b.x + (NODE - w) / 2);
      for (let i = 0; i < n.maxLevel; i++) {
        ctx.fillStyle = i < lvl ? (n.currency === 'emerald' ? P.E : P.Y) : P['2'];
        ctx.fillRect(px + i * 4, py, 3, 3);
      }
    } else {
      ctx.fillStyle = P['2'];
      ctx.fillRect(b.x + 3, py, NODE - 6, 3);
      ctx.fillStyle = n.currency === 'emerald' ? P.E : P.Y;
      ctx.fillRect(b.x + 3, py, Math.round(((NODE - 6) * lvl) / n.maxLevel), 3);
    }
  }

  down(x: number, y: number): void {
    if (this.buttons.down(x, y)) {
      this.drag = null;
      return;
    }
    const d = { y0: y, s0: this.scroll, moved: false, prevSel: this.sel, picked: false };
    const n = this.nodeAt(x, y);
    if (n) {
      this.sel = n.id;
      d.picked = true;
      this.app.sfx.ui();
    }
    this.drag = d;
  }

  move(_x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.abs(y - d.y0) > 10 && this.maxScroll > 0) {
      d.moved = true;
      if (d.picked) this.sel = d.prevSel; // a real scroll began: undo the tap selection
    }
    if (d.moved) this.scroll = Math.max(0, Math.min(this.maxScroll, d.s0 - (y - d.y0)));
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
    if (id.startsWith('tab:')) {
      this.tab = id.slice(4) as Tab;
      this.scroll = 0;
      this.sel = null;
    } else if (id.startsWith('ball:')) {
      save.ballType = id.slice(5) as BallType;
      app.persist();
    } else if (id === 'stagePrev' || id === 'stageNext') {
      const cur = STAGES.find((s) => s.id === save.current) ?? STAGES[0];
      const next = STAGES[cur.index + (id === 'stageNext' ? 1 : -1)];
      if (next && next.index <= save.unlocked) {
        save.current = next.id as StageId;
        if (this.tab === 'stage') { this.sel = null; this.scroll = 0; }
        app.persist();
      }
    } else if (id === 'buy') {
      const node = this.nodes().find((n) => n.id === this.sel);
      if (node && app.meta.buy(save, node)) {
        app.persist();
        app.sfx.buy();
        this.toast = 'PURCHASED!';
        this.toastUntil = this.now + 1;
      }
    } else if (id === 'start') app.startRun();
    else if (id === 'menu') app.go('title');
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
