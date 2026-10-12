// Stage map: worlds as rows, four stage tiles each; tap an open tile to make it the current stage.
import { MODIFIER_NAMES, WORLDS, globalIndex, makeStage, parseStageId, stageId } from '../core/worlds';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText } from '../render/text';
import { Buttons, inRect } from './widgets';
import type { Button } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;
const ROW_Y = 28;
const ROW_H = 38;
const TILE_W = 36;
const TILE_H = 22;
const TILE_X = 14;
const TILE_GAP = 4;

interface Tile {
  id: string;
  world: number;
  slot: number;
  x: number;
  y: number;
}

export class MapScreen implements Screen {
  private buttons = new Buttons();
  private loop = 0;
  private down0: Tile | null = null;
  private hint = '';
  private tiles: Tile[] = [];

  constructor(private app: App) {}

  enter(): void {
    this.hint = '';
    this.down0 = null;
    try { this.loop = parseStageId(this.app.save.current).loop; } catch { this.loop = 0; }
  }

  private maxLoop(): number {
    return Math.floor(this.app.save.unlocked / 24);
  }

  private layout(): void {
    this.tiles = [];
    for (const w of WORLDS) {
      for (let s = 1; s <= 4; s++) {
        this.tiles.push({
          id: stageId(w.index, s, this.loop),
          world: w.index,
          slot: s,
          x: TILE_X + (s - 1) * (TILE_W + TILE_GAP),
          y: ROW_Y + (w.index - 1) * ROW_H + 11,
        });
      }
    }
  }

  private tileAt(x: number, y: number): Tile | null {
    for (const t of this.tiles) if (inRect(x, y, t.x - 1, t.y - 1, TILE_W + 2, TILE_H + 2)) return t;
    return null;
  }

  private worldName(i: number): string {
    return (WORLDS.find((w) => w.index === i)?.name ?? '').toUpperCase();
  }

  /** The hint for a locked stage: the boss of the stage before it. */
  private lockHint(t: Tile): string {
    const prevW = t.slot === 1 ? t.world - 1 : t.world;
    const prevS = t.slot === 1 ? 4 : t.slot - 1;
    if (prevW < 1) return `NEEDS ${this.worldName(t.world)} ${t.slot}`;
    return `BEAT ${this.worldName(prevW)} ${prevS} BOSS`;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const { save } = this.app;
    ctx.drawImage(getMenuBg(), 0, 0);
    this.layout();
    drawText(ctx, 'STAGE MAP', 90, 7, { align: 'center', scale: 2, color: P['5'], shadow: P['0'] });
    if (save.unlocked >= 24 && this.loop > 0) drawText(ctx, `LOOP ${this.loop}`, 175, 20, { align: 'right', color: P.o });
    for (const w of WORLDS) {
      const y = ROW_Y + (w.index - 1) * ROW_H;
      const tint = P[w.tint] ?? P.G;
      ctx.fillStyle = P['0'];
      ctx.fillRect(4, y + 1, 7, 33);
      ctx.fillStyle = tint;
      ctx.fillRect(5, y + 2, 5, 31);
      const reached = globalIndex(stageId(w.index, 1, this.loop)) <= save.unlocked;
      drawText(ctx, w.name.toUpperCase(), 14, y + 2, { color: reached ? P['4'] : P['2'], shadow: P['0'] });
    }
    const cur = save.current;
    for (const t of this.tiles) {
      const open = globalIndex(t.id) <= save.unlocked;
      const best = save.bestWave[t.id] ?? 0;
      const killed = best >= 4;
      const isCur = t.id === cur;
      const tint = P[WORLDS.find((w) => w.index === t.world)?.tint ?? 'G'] ?? P.G;
      ctx.fillStyle = isCur && Math.floor(now * 3) % 2 === 0 ? P['5'] : isCur ? P.Y : killed ? P.y : open ? tint : P['1'];
      ctx.fillRect(t.x, t.y, TILE_W, TILE_H);
      ctx.fillStyle = P['0'];
      ctx.fillRect(t.x + 1, t.y + 1, TILE_W - 2, TILE_H - 2);
      ctx.fillStyle = open ? P['1'] : P['0'];
      ctx.fillRect(t.x + 2, t.y + 2, TILE_W - 4, TILE_H - 4);
      const cx = t.x + TILE_W / 2;
      if (!open) {
        drawSprite(ctx, 'icon_lock', cx, t.y + TILE_H / 2, { alpha: 0.6 });
        continue;
      }
      if (killed) drawSprite(ctx, 'elite_crown', cx, t.y + 7);
      else drawText(ctx, String(t.slot), cx, t.y + 4, { align: 'center', scale: 1, color: isCur ? P.Y : P['4'] });
      const mods = (() => { try { return makeStage(t.id).modifiers; } catch { return []; } })();
      if (mods[0]) drawSprite(ctx, `mod_${mods[0]}`, t.x + 6.5, t.y + 6.5);
      if (mods[1]) drawSprite(ctx, `mod_${mods[1]}`, t.x + TILE_W - 6.5, t.y + 6.5);
      // 3 wave pips + boss pip
      for (let i = 0; i < 4; i++) {
        const px = cx - 9 + i * 5;
        ctx.fillStyle = i < 3 ? (best > i ? P.E : P['2']) : killed ? P.Y : P['2'];
        ctx.fillRect(px, t.y + TILE_H - 7, 4, 3);
      }
    }
    // info line
    let info = this.hint;
    let infoColor: string = P.p;
    if (!info) {
      const t = this.tiles.find((x) => x.id === cur);
      if (t) {
        info = `${this.worldName(t.world)} ${t.slot}`;
        infoColor = P.Y;
      }
    }
    drawText(ctx, info, 90, 262, { align: 'center', color: infoColor, shadow: P['0'] });
    const b = save.bestWave[cur] ?? 0;
    drawText(ctx, b >= 4 ? 'BOSS KILLED' : `BEST WAVE ${b}`, 90, 272, { align: 'center', color: P['3'] });
    let mods: string[] = [];
    try { mods = makeStage(cur).modifiers.map((m) => MODIFIER_NAMES[m]); } catch { /* ignore */ }
    drawText(ctx, mods.length ? mods.join(' \u00b7 ') : 'NO MODIFIERS', 90, 283, { align: 'center', color: mods.length ? P.o : P['2'] });

    const btns: Button[] = [];
    if (save.unlocked >= 24) {
      btns.push({ id: 'loopPrev', x: 4, y: 3, w: 16, h: 13, label: '<', style: 'gray', disabled: this.loop <= 0 });
      btns.push({ id: 'loopNext', x: 22, y: 3, w: 16, h: 13, label: '>', style: 'gray', disabled: this.loop >= this.maxLoop() });
    }
    btns.push({ id: 'tree', x: 4, y: 297, w: 34, h: 20, label: 'TREE', style: 'blue' });
    btns.push({ id: 'loadout', x: 40, y: 297, w: 52, h: 20, label: 'LOADOUT', style: 'gold' });
    btns.push({ id: 'start', x: 94, y: 297, w: 82, h: 20, label: 'START RUN', scale: 1, style: 'green' });
    this.buttons.set(btns);
    this.buttons.draw(ctx);
  }

  down(x: number, y: number): void {
    this.down0 = null;
    if (this.buttons.down(x, y)) return;
    this.down0 = this.tileAt(x, y);
  }
  move(x: number, y: number): void {
    if (this.down0 && !inRect(x, y, this.down0.x - 6, this.down0.y - 6, TILE_W + 12, TILE_H + 12)) this.down0 = null;
  }
  up(x: number, y: number): void {
    const app = this.app;
    const save = app.save;
    const t = this.down0;
    this.down0 = null;
    if (t && this.tileAt(x, y)?.id === t.id) {
      app.sfx.ui();
      if (globalIndex(t.id) <= save.unlocked) {
        save.current = t.id;
        this.hint = '';
        app.persist();
      } else this.hint = this.lockHint(t);
      return;
    }
    const id = this.buttons.up(x, y);
    if (!id) return;
    app.sfx.ui();
    if (id === 'tree') app.go('shop');
    else if (id === 'loadout') app.go('loadout');
    else if (id === 'start') app.startRun();
    else if (id === 'loopPrev') this.loop = Math.max(0, this.loop - 1);
    else if (id === 'loopNext') this.loop = Math.min(this.maxLoop(), this.loop + 1);
    this.hint = '';
  }
  cancel(): void {
    this.down0 = null;
    this.buttons.pressed = null;
  }
}
