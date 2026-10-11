import { stageById } from '../core/tuning';
import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText } from '../render/text';
import { Buttons, drawBar, drawPanel } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

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
    const st = stageById(r.stage);
    drawText(ctx, r.bossKilled ? 'BOSS DOWN!' : 'RUN OVER', 90, 14, { align: 'center', scale: 3, color: r.bossKilled ? P.Y : P.p, shadow: P['0'], shadowOff: 2 });
    drawText(ctx, st.name.toUpperCase(), 90, 42, { align: 'center', color: P['3'] });

    drawPanel(ctx, 14, 54, 152, 110);
    const rows: [string, string, string][] = [
      ['KILLS', String(r.kills), P['4']],
      ['CASH EARNED', String(Math.floor(r.cash)), P.Y],
      ['BEST COMBO', String(r.bestCombo), P.M],
      ['SHOTS', String(r.shots), P['4']],
    ];
    rows.forEach(([k, v, c], i) => {
      drawText(ctx, k, 22, 62 + i * 12, { color: P['3'] });
      drawText(ctx, v, 158, 62 + i * 12, { color: c, align: 'right', shadow: P['0'] });
    });
    const em = r.emeralds + sum.bossEmeralds;
    drawText(ctx, 'EMERALDS', 22, 110, { color: P['3'] });
    drawSprite(ctx, 'emerald', 130, 113);
    drawText(ctx, `+${em}`, 158, 110, { color: P.E, align: 'right', shadow: P['0'] });
    if (sum.bossEmeralds > 0) drawText(ctx, `(BOSS +${sum.bossEmeralds})`, 158, 120, { color: P.e, align: 'right' });

    // meter fill vs ghost
    drawText(ctx, 'BOSS METER', 22, 134, { color: P['3'] });
    const fill = Math.min(r.meterFill, this.t * 1.2);
    drawBar(ctx, 22, 145, 136, 8, fill, P.m, P.M, P['2'], sum.prevBest);
    drawText(ctx, `${Math.round(r.meterFill * 100)}%`, 158, 134, { color: P.M, align: 'right' });
    if (r.meterFill > sum.prevBest + 0.001) drawText(ctx, 'NEW BEST', 22, 156, { color: P.Y });

    if (sum.unlocked) {
      const blink = Math.floor(now * 3) % 2 === 0;
      drawPanel(ctx, 14, 176, 152, 40, P.g, P.h);
      drawText(ctx, 'NEW STAGE!', 90, 184, { align: 'center', scale: 2, color: blink ? P.Y : P['5'], shadow: P['0'] });
      drawText(ctx, sum.unlocked === 'ice' ? 'ICE CAVERN' : sum.unlocked.toUpperCase(), 90, 204, { align: 'center', color: P.E });
    }

    drawSprite(ctx, 'coin', 70, 236);
    drawText(ctx, `${Math.floor(this.app.save.cash)}`, 78, 233, { color: P.Y, shadow: P['0'] });
    drawSprite(ctx, 'emerald', 114, 236);
    drawText(ctx, `${this.app.save.emeralds}`, 122, 233, { color: P.E, shadow: P['0'] });

    this.buttons.set([
      { id: 'upgrade', x: 30, y: 252, w: 120, h: 22, label: 'UPGRADE', scale: 2, style: 'blue' },
      { id: 'again', x: 30, y: 280, w: 120, h: 22, label: 'RUN AGAIN', scale: 2, style: 'green' },
    ]);
    this.buttons.draw(ctx);
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
