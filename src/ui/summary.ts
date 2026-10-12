import { MODIFIER_NAMES, makeStage } from '../core/worlds';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText } from '../render/text';
import { Buttons, anyAffordable, drawBuyDot, drawPanel } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

/** Best-wave marker slot 1..4 (0/none = no marker). */
function prevBestMark(b: number): number {
  return b >= 1 ? Math.min(4, Math.round(b)) : 0;
}

export class SummaryScreen implements Screen {
  private buttons = new Buttons();
  private t = 0;

  constructor(private app: App) {}

  enter(): void {
    this.t = 0;
  }
  update(dt: number): void {
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.drawImage(getMenuBg(), 0, 0);
    const sum = this.app.summary;
    if (!sum) return;
    const r = sum.result;
    const st = makeStage(r.stage);
    drawText(ctx, r.bossKilled ? 'BOSS DOWN!' : 'RUN OVER', 90, 14, { align: 'center', scale: 3, color: r.bossKilled ? P.Y : P.p, shadow: P['0'], shadowOff: 2 });
    drawText(ctx, st.name.toUpperCase(), 90, st.modifiers.length ? 38 : 42, { align: 'center', color: P['3'] });
    if (st.modifiers.length) drawText(ctx, st.modifiers.map((m) => MODIFIER_NAMES[m]).join(' \u00b7 '), 90, 46, { align: 'center', color: P.o });

    const em = r.emeralds + sum.bossEmeralds;
    drawPanel(ctx, 14, 54, 152, 124);
    const rows: [string, string, string][] = [
      ['KILLS', String(r.kills), P['4']],
      ['CASH EARNED', String(Math.floor(r.cash)), P.Y],
      ['BEST CHAIN', String(r.bestCombo), P.M],
      ['SHOTS', String(r.shots), P['4']],
      ['BOSS', r.bossKilled ? 'KILLED' : 'NO', r.bossKilled ? P.Y : P['3']],
    ];
    if (r.bossKilled || r.overtimeWaves > 0) rows.push(['OVERTIME WAVES', String(r.overtimeWaves), P.o]);
    rows.forEach(([k, v, c], i) => {
      drawText(ctx, k, 22, 61 + i * 11, { color: P['3'] });
      drawText(ctx, v, 158, 61 + i * 11, { color: c, align: 'right', shadow: P['0'] });
    });
    let y = 61 + rows.length * 11;
    drawText(ctx, 'EMERALDS', 22, y, { color: P['3'] });
    drawSprite(ctx, 'emerald', 130, y + 3);
    drawText(ctx, `+${em}`, 158, y, { color: P.E, align: 'right', shadow: P['0'] });
    y += 11;
    if (sum.bossEmeralds > 0) {
      drawText(ctx, `(BOSS +${sum.bossEmeralds})`, 158, y - 1, { color: P.e, align: 'right' });
      y += 7;
    }

    // waves cleared vs best: pip track with the previous-best marker
    y += 3;
    drawText(ctx, `WAVES CLEARED ${r.wavesCleared}/4`, 22, y, { color: P['3'] });
    const shown = Math.min(r.wavesCleared, Math.floor(this.t * 6));
    const pipY = y + 14;
    for (let i = 0; i < 4; i++) {
      const cx = 30 + i * 18;
      const done = i < shown;
      drawSprite(ctx, i === 3 ? 'pip_boss' : done ? 'pip_done' : 'pip_todo', cx, pipY, { alpha: i === 3 && !done ? 0.5 : 1 });
      if (prevBestMark(sum.prevBest) === i + 1) {
        ctx.fillStyle = P['5'];
        ctx.fillRect(cx, pipY + 6, 1, 1);
        ctx.fillRect(cx - 1, pipY + 7, 3, 1);
        ctx.fillRect(cx - 2, pipY + 8, 5, 1);
      }
    }
    drawText(ctx, `BEST ${Math.max(sum.prevBest, 0)}`, 158, pipY - 2, { color: P['3'], align: 'right' });
    if (r.wave > sum.prevBest) drawText(ctx, 'NEW BEST', 158, pipY + 6, { color: P.Y, align: 'right' });

    if (sum.unlocked) {
      const blink = Math.floor(now * 3) % 2 === 0;
      drawPanel(ctx, 14, 184, 152, 40, P.g, P.h);
      drawText(ctx, 'NEW STAGE!', 90, 192, { align: 'center', scale: 2, color: blink ? P.Y : P['5'], shadow: P['0'] });
      drawText(ctx, makeStage(sum.unlocked).name.toUpperCase(), 90, 212, { align: 'center', color: P.E });
    }

    const lo = this.app.save.loadout;
    const gear: string[] = [...(lo.cue !== 'standard' ? [lo.cue] : []), ...lo.relics, ...(lo.trick ? [lo.trick] : [])];
    if (gear.length) {
      const x0 = 90 - ((gear.length - 1) * 13) / 2;
      gear.forEach((g, i) => drawSprite(ctx, `gear_${g}`, x0 + i * 13, 231));
    }
    drawSprite(ctx, 'coin', 70, 243);
    drawText(ctx, `${Math.floor(this.app.save.cash)}`, 78, 240, { color: P.Y, shadow: P['0'] });
    drawSprite(ctx, 'emerald', 114, 243);
    drawText(ctx, `${this.app.save.emeralds}`, 122, 240, { color: P.E, shadow: P['0'] });

    this.buttons.set([
      { id: 'upgrade', x: 30, y: 252, w: 120, h: 22, label: 'UPGRADE', scale: 2, style: 'blue' },
      { id: 'again', x: 30, y: 280, w: 120, h: 22, label: 'RUN AGAIN', scale: 2, style: 'green' },
    ]);
    this.buttons.draw(ctx);
    if (anyAffordable(this.app)) drawBuyDot(ctx, this.buttons.list[0]);
  }

  down(x: number, y: number): void {
    this.buttons.down(x, y);
  }
  move(): void {}
  up(x: number, y: number): void {
    const id = this.buttons.up(x, y);
    if (id) this.app.sfx.ui();
    if (id === 'upgrade') this.app.go('shop');
    else if (id === 'again') this.app.startRun();
  }
  cancel(): void {
    this.buttons.pressed = null;
  }
}
