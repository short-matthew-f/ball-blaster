// Loadout screen (DESIGN-v0.4-loadout "Equip flow"): pick what to bring into the next run.
// Slots across the top; tap a slot for the owned items of that kind; select an item, then EQUIP / UNEQUIP.
import type { BallType, Modifier, UpgradeNode } from '../core/types';
import { MODIFIER_NAMES, makeStage } from '../core/worlds';
import { ROOT_ID, cueSlotOpen, equip, nodeLevel, nodesFor, ownedGear, relicSlots, trickSlotOpen, unequip } from '../meta/index';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText, textWidth, wrapText } from '../render/text';
import { Buttons, drawPanel, inRect } from './widgets';
import type { Button } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

type SlotKind = 'ball' | 'cue' | 'relic' | 'trick';
interface Slot { kind: SlotKind; index: number; x: number; y: number; open: boolean; hint: string; label: string }
interface Item { id: string; name: string; desc: string; icon: string; sprite: boolean; x: number; y: number; w: number; h: number }

const SLOT_Y = 44;
const SLOT_W = 28;
const STRIP_Y = 84;
const ITEM_W = 84;
const ITEM_H = 15;
const PANEL_Y = 236;
const BALLS: { id: BallType; node: string; name: string; desc: string }[] = [
  { id: 'standard', node: ROOT_ID, name: 'STANDARD', desc: 'The plain 8-ball' },
  { id: 'heavy', node: 'ballHeavy', name: 'HEAVY', desc: 'Mass 2, +1 damage, slower' },
  { id: 'light', node: 'ballLight', name: 'LIGHT', desc: 'Fast, barely shoves' },
  { id: 'sticky', node: 'ballSticky', name: 'STICKY', desc: 'Stops on contact, +1 stagger' },
];

export class LoadoutScreen implements Screen {
  private buttons = new Buttons();
  private slots: Slot[] = [];
  private items: Item[] = [];
  private sel: { kind: SlotKind; index: number } = { kind: 'ball', index: 0 };
  private picked: string | null = null;
  private down0: { type: 'slot' | 'item'; key: string } | null = null;
  private toast = '';
  private toastUntil = 0;
  private now = 0;

  constructor(private app: App) {}

  enter(): void {
    this.down0 = null;
    this.picked = null;
    this.sel = { kind: 'ball', index: 0 };
  }

  private node(id: string): UpgradeNode | undefined {
    return nodesFor(this.app.save).find((n) => n.id === id);
  }

  private gearLevel(id: string): { lv: number; max: number } {
    const n = this.node(`${id}_lv`);
    return { lv: nodeLevel(this.app.save, `${id}_lv`), max: n?.maxLevel ?? 0 };
  }

  private equippedId(kind: SlotKind, index: number): string | null {
    const { save } = this.app;
    if (kind === 'ball') return save.ballType;
    if (kind === 'cue') return save.loadout.cue === 'standard' ? null : save.loadout.cue;
    if (kind === 'trick') return save.loadout.trick;
    return save.loadout.relics[index] ?? null;
  }

  private buildSlots(): void {
    const { save } = this.app;
    const nRelic = relicSlots(save);
    const defs: Omit<Slot, 'x' | 'y'>[] = [
      { kind: 'ball', index: 0, open: true, hint: '', label: 'BALL' },
      { kind: 'cue', index: 0, open: cueSlotOpen(save), hint: 'OWN A CUE', label: 'CUE' },
    ];
    const hints = ['OWN A RELIC', 'WORLD 2', 'WORLD 4'];
    for (let i = 0; i < 3; i++) defs.push({ kind: 'relic', index: i, open: i < nRelic, hint: hints[i], label: 'RELIC' });
    defs.push({ kind: 'trick', index: 0, open: trickSlotOpen(save), hint: 'WORLD 2', label: 'TRICK' });
    const x0 = Math.round((180 - defs.length * SLOT_W) / 2);
    this.slots = defs.map((d, i) => ({ ...d, x: x0 + i * SLOT_W, y: SLOT_Y }));
  }

  private buildItems(): void {
    const { save } = this.app;
    const owned = ownedGear(save);
    const raw: Omit<Item, 'x' | 'y' | 'w' | 'h'>[] = [];
    const kind = this.sel.kind;
    if (kind === 'ball') {
      for (const b of BALLS) {
        if (b.node !== ROOT_ID && nodeLevel(save, b.node) < 1) continue;
        raw.push({ id: b.id, name: b.name, desc: b.desc, icon: this.node(b.node)?.icon ?? 'icon_ball', sprite: false });
      }
    } else if (kind === 'cue') {
      raw.push({ id: 'standard', name: 'STANDARD', desc: 'No cue effect', icon: 'icon_aim', sprite: true });
      for (const id of owned.cues) raw.push({ id, name: this.nm(id), desc: this.node(id)?.desc ?? '', icon: `gear_${id}`, sprite: true });
    } else if (kind === 'relic') {
      for (const id of owned.relics) raw.push({ id, name: this.nm(id), desc: this.node(id)?.desc ?? '', icon: `gear_${id}`, sprite: true });
    } else {
      for (const id of owned.tricks) raw.push({ id, name: this.nm(id), desc: this.node(id)?.desc ?? '', icon: `gear_${id}`, sprite: true });
    }
    this.items = raw.map((r, i) => ({ ...r, x: 3 + (i % 2) * (ITEM_W + 4), y: STRIP_Y + 10 + Math.floor(i / 2) * (ITEM_H + 2), w: ITEM_W, h: ITEM_H }));
  }

  private nm(id: string): string {
    return (this.node(id)?.name ?? id).toUpperCase().replace(/ CUE$/, '');
  }

  private slotAt(x: number, y: number): Slot | undefined {
    return this.slots.find((s) => inRect(x, y, s.x, s.y - 2, SLOT_W, 32));
  }
  private itemAt(x: number, y: number): Item | undefined {
    return this.items.find((i) => inRect(x, y, i.x, i.y, i.w, i.h));
  }

  private drawStageLine(ctx: CanvasRenderingContext2D): void {
    let name = '';
    let mods: Modifier[] = [];
    try {
      const st = makeStage(this.app.save.current);
      name = st.name.toUpperCase();
      mods = st.modifiers;
    } catch { /* ignore */ }
    drawText(ctx, name, 90, 19, { align: 'center', color: P.Y, shadow: P['0'] });
    if (!mods.length) {
      drawText(ctx, 'NO MODIFIERS', 90, 29, { align: 'center', color: P['2'] });
      return;
    }
    const widths = mods.map((m) => 9 + textWidth(MODIFIER_NAMES[m]));
    const total = widths.reduce((a, b) => a + b, 0) + (mods.length - 1) * 6;
    let x = Math.round(90 - total / 2);
    mods.forEach((m, i) => {
      drawSprite(ctx, `mod_${m}`, x + 3.5, 32);
      drawText(ctx, MODIFIER_NAMES[m], x + 9, 29, { color: P.o, shadow: P['0'] });
      x += widths[i] + 6;
    });
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.now = now;
    const app = this.app;
    const save = app.save;
    ctx.drawImage(getMenuBg(), 0, 0);
    this.buildSlots();
    this.buildItems();
    const btns: Button[] = [];

    // header
    drawSprite(ctx, 'coin', 9, 8);
    drawText(ctx, String(Math.floor(save.cash)), 16, 5, { color: P.Y, shadow: P['0'] });
    drawSprite(ctx, 'emerald', 62, 8);
    drawText(ctx, String(save.emeralds), 69, 5, { color: P.E, shadow: P['0'] });
    drawText(ctx, 'LOADOUT', 175, 5, { align: 'right', color: P['5'], shadow: P['0'] });
    this.drawStageLine(ctx);

    // slots
    for (const s of this.slots) {
      const cx = s.x + SLOT_W / 2;
      const sel = this.sel.kind === s.kind && this.sel.index === s.index;
      if (sel) {
        ctx.fillStyle = Math.floor(now * 3) % 2 === 0 ? P.Y : P.y;
        ctx.fillRect(cx - 10, s.y + 1, 20, 20);
        ctx.fillStyle = P['0'];
        ctx.fillRect(cx - 9, s.y + 2, 18, 18);
      }
      const eq = s.open ? this.equippedId(s.kind, s.index) : null;
      drawSprite(ctx, s.open ? 'slot_empty' : 'slot_locked', cx, s.y + 11);
      if (eq) this.drawIcon(ctx, s.kind === 'ball' ? this.ballIcon(eq) : `gear_${eq}`, s.kind !== 'ball', cx, s.y + 11);
      drawText(ctx, s.label, cx, s.y + 23, { align: 'center', color: sel ? P['5'] : s.open ? P['4'] : P['2'] });
      const nm = eq ? this.nm(eq) : s.open ? 'EMPTY' : 'LOCKED';
      drawText(ctx, nm.length > 6 ? nm.slice(0, 6) : nm, cx, s.y + 30, { align: 'center', color: eq ? P.E : P['3'] });
    }

    // strip
    const cur = this.slots.find((s) => s.kind === this.sel.kind && s.index === this.sel.index);
    const title = this.sel.kind === 'relic' ? `RELIC ${this.sel.index + 1}` : this.sel.kind.toUpperCase();
    drawText(ctx, title, 5, STRIP_Y, { color: P.Y, shadow: P['0'] });
    if (cur && !cur.open) {
      drawSprite(ctx, 'slot_locked', 90, STRIP_Y + 30);
      drawText(ctx, 'LOCKED', 90, STRIP_Y + 44, { align: 'center', scale: 2, color: P['3'], shadow: P['0'] });
      drawText(ctx, cur.hint, 90, STRIP_Y + 62, { align: 'center', color: P.p, shadow: P['0'] });
    } else if (!this.items.length) {
      drawText(ctx, 'NOTHING OWNED YET', 90, STRIP_Y + 32, { align: 'center', color: P['3'] });
      drawText(ctx, 'BUY GEAR ON THE TREE', 90, STRIP_Y + 42, { align: 'center', color: P['2'] });
    }
    for (const it of this.items) {
      const eqHere = this.isEquipped(it.id);
      const on = this.picked === it.id;
      ctx.fillStyle = on ? P.Y : eqHere ? P.E : P['2'];
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = P['0'];
      ctx.fillRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2);
      ctx.fillStyle = eqHere ? P.g : P['1'];
      ctx.fillRect(it.x + 2, it.y + 2, it.w - 4, it.h - 4);
      this.drawIcon(ctx, it.icon, it.sprite, it.x + 9, it.y + it.h / 2);
      drawText(ctx, it.name, it.x + 16, it.y + 5, { color: eqHere ? P.E : P['5'], shadow: P['0'] });
      if (eqHere) drawText(ctx, 'E', it.x + it.w - 6, it.y + 5, { color: P.Y });
    }

    // detail panel
    drawPanel(ctx, 2, PANEL_Y, 176, 56);
    const pk = this.items.find((i) => i.id === this.picked);
    if (pk) {
      const eqHere = this.isEquipped(pk.id);
      this.drawIcon(ctx, pk.icon, pk.sprite, 12, PANEL_Y + 11);
      const sc = textWidth(pk.name, 2) <= 100 ? 2 : 1;
      drawText(ctx, pk.name, 22, PANEL_Y + 6, { color: P.Y, shadow: P['0'], scale: sc });
      const g = pk.sprite && pk.id !== 'standard' ? this.gearLevel(pk.id) : null;
      if (g && g.max > 0) drawText(ctx, g.lv >= g.max ? `LV${g.max + 1} MAX` : `LV${g.lv + 1}`, 173, PANEL_Y + 6, { align: 'right', color: P['4'] });
      wrapText(pk.desc, 27).slice(0, 2).forEach((l, i) => drawText(ctx, l, 7, PANEL_Y + 20 + i * 7, { color: P['4'] }));
      const isBall = this.sel.kind === 'ball';
      const label = isBall ? (eqHere ? 'EQUIPPED' : 'EQUIP') : eqHere ? 'UNEQUIP' : 'EQUIP';
      btns.push({ id: 'equip', x: 100, y: PANEL_Y + 34, w: 74, h: 16, label, scale: label === 'EQUIP' ? 2 : 1, style: eqHere ? 'red' : 'gold', disabled: isBall && eqHere });
    } else {
      drawText(ctx, this.items.length ? 'TAP AN ITEM TO INSPECT IT' : 'EMPTY SLOT', 90, PANEL_Y + 25, { align: 'center', color: P['3'] });
    }

    btns.push({ id: 'tree', x: 4, y: 297, w: 34, h: 20, label: 'TREE', style: 'blue' });
    btns.push({ id: 'map', x: 40, y: 297, w: 34, h: 20, label: 'MAP', style: 'blue' });
    btns.push({ id: 'start', x: 76, y: 297, w: 100, h: 20, label: 'START RUN', style: 'green' });
    this.buttons.set(btns);
    this.buttons.draw(ctx);
    if (now < this.toastUntil) drawText(ctx, this.toast, 90, PANEL_Y - 9, { align: 'center', color: P.Y, shadow: P['0'] });
  }

  private ballIcon(id: string): string {
    const b = BALLS.find((x) => x.id === id);
    return (b && this.node(b.node)?.icon) || 'icon_ball';
  }

  private drawIcon(ctx: CanvasRenderingContext2D, icon: string, _sprite: boolean, x: number, y: number): void {
    drawSprite(ctx, icon, x, y);
  }

  private isEquipped(id: string): boolean {
    const { save } = this.app;
    const k = this.sel.kind;
    if (k === 'ball') return save.ballType === id;
    if (k === 'cue') return save.loadout.cue === id;
    if (k === 'trick') return save.loadout.trick === id;
    return save.loadout.relics.includes(id as never);
  }

  down(x: number, y: number): void {
    this.down0 = null;
    if (this.buttons.down(x, y)) return;
    const it = this.itemAt(x, y);
    if (it) { this.down0 = { type: 'item', key: it.id }; return; }
    const s = this.slotAt(x, y);
    if (s) this.down0 = { type: 'slot', key: `${s.kind}:${s.index}` };
  }
  move(): void {}

  up(x: number, y: number): void {
    const app = this.app;
    const save = app.save;
    const d = this.down0;
    this.down0 = null;
    if (d) {
      if (d.type === 'item' && this.itemAt(x, y)?.id === d.key) {
        this.picked = d.key;
        app.sfx.ui();
      } else if (d.type === 'slot') {
        const s = this.slotAt(x, y);
        if (s && `${s.kind}:${s.index}` === d.key) {
          this.sel = { kind: s.kind, index: s.index };
          this.picked = this.equippedId(s.kind, s.index) ?? null;
          app.sfx.ui();
        }
      }
      return;
    }
    const id = this.buttons.up(x, y);
    if (!id) return;
    app.sfx.ui();
    if (id === 'tree') app.go('shop');
    else if (id === 'map') app.go('map');
    else if (id === 'start') app.startRun();
    else if (id === 'equip' && this.picked) {
      const kind = this.sel.kind;
      const gid = this.picked;
      let ok = false;
      if (kind === 'ball') {
        save.ballType = gid as BallType;
        ok = true;
      } else if (this.isEquipped(gid)) {
        ok = unequip(save, kind, kind === 'relic' ? save.loadout.relics.indexOf(gid as never) : undefined);
        if (ok) this.toast = 'UNEQUIPPED';
      } else {
        ok = equip(save, kind, gid, kind === 'relic' ? Math.min(this.sel.index, save.loadout.relics.length) : undefined);
        if (ok) this.toast = 'EQUIPPED!';
        else if (kind === 'relic') {
          // already in another slot: move it here
          const at = save.loadout.relics.indexOf(gid as never);
          if (at >= 0 && unequip(save, 'relic', at)) ok = equip(save, 'relic', gid, Math.min(this.sel.index, save.loadout.relics.length));
          if (ok) this.toast = 'EQUIPPED!';
        }
      }
      if (ok) {
        if (kind === 'ball') this.toast = 'EQUIPPED!';
        app.persist();
        this.toastUntil = this.now + 1;
      }
    }
  }

  cancel(): void {
    this.down0 = null;
    this.buttons.pressed = null;
  }
}
