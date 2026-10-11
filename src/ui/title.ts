import { PALETTE } from '../render/palette';
import { getFeltBg } from '../render/renderer';
import { drawSprite } from '../render/sprite-cache';
import { drawText } from '../render/text';
import { Buttons } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

export class TitleScreen implements Screen {
  private buttons = new Buttons();
  private bx = 40;
  private by = 200;
  private vx = 52;
  private vy = -70;
  private flash = [0, 0, 0];
  private last = 0;
  // decorative targets the ball can bump
  private decor = [
    { x: 30, y: 168, kind: 'target_basic' },
    { x: 90, y: 150, kind: 'target_armored' },
    { x: 150, y: 172, kind: 'target_volatile' },
  ];

  constructor(private app: App) {}

  enter(): void {
    this.last = 0;
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.vy += 140 * dt;
    this.bx += this.vx * dt;
    this.by += this.vy * dt;
    if (this.bx < 16) { this.bx = 16; this.vx = Math.abs(this.vx); }
    if (this.bx > 164) { this.bx = 164; this.vx = -Math.abs(this.vx); }
    if (this.by > 250) { this.by = 250; this.vy = -Math.abs(this.vy) * 0.98 - 4; }
    if (this.by > 250 - 1 && Math.abs(this.vy) < 60) this.vy = -150;
    this.decor.forEach((d, i) => {
      this.flash[i] = Math.max(0, this.flash[i] - dt);
      if (Math.hypot(this.bx - d.x, this.by - d.y) < 12) {
        this.flash[i] = 0.12;
        const dx = this.bx - d.x, dy = this.by - d.y;
        const l = Math.hypot(dx, dy) || 1;
        this.vx = (dx / l) * 70 + this.vx * 0.2;
        this.vy = Math.max(60, (dy / l) * 90);
        this.vy = dy < 0 ? -Math.abs(this.vy) : this.vy;
        this.bx = d.x + (dx / l) * 12;
        this.by = d.y + (dy / l) * 12;
      }
    });
    this.last += dt;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.drawImage(getFeltBg(), 0, 0);
    // logo
    const logo = (s: string, y: number, scale: number, c1: string, c2: string): void => {
      drawText(ctx, s, 90, y + scale * 2, { align: 'center', scale, color: P['0'] });
      drawText(ctx, s, 90, y + scale, { align: 'center', scale, color: c2 });
      drawText(ctx, s, 90, y, { align: 'center', scale, color: c1 });
    };
    logo('BALL', 24, 7, P['5'], P.s);
    logo('BLASTER', 72, 4, P.p, P.r);
    drawText(ctx, 'A BILLIARDS ROGUELITE', 90, 112, { align: 'center', color: P.Y, shadow: P['0'] });

    this.decor.forEach((d, i) => drawSprite(ctx, d.kind, d.x, d.y, this.flash[i] > 0 ? { tint: '#ffffff' } : {}));
    drawSprite(ctx, 'ball_main', Math.round(this.bx), Math.round(this.by), { scale: 2 });

    const pulse = Math.floor(now * 2) % 2;
    this.buttons.set([
      { id: 'play', x: 40, y: 262, w: 100, h: 26, label: 'PLAY', scale: 3, style: pulse ? 'green' : 'green' },
      { id: 'shop', x: 16, y: 294, w: 74, h: 16, label: 'UPGRADES', style: 'blue' },
      { id: 'settings', x: 94, y: 294, w: 70, h: 16, label: 'SETTINGS', style: 'gray' },
    ]);
    this.buttons.draw(ctx);
    drawText(ctx, 'V0.1', 4, 313, { color: P['2'] });
  }

  down(x: number, y: number): void {
    this.buttons.down(x, y);
  }
  move(): void {}
  up(x: number, y: number): void {
    const id = this.buttons.up(x, y);
    if (id) this.app.sfx.ui();
    if (id === 'play') this.app.startRun();
    else if (id === 'shop') this.app.go('shop');
    else if (id === 'settings') {
      this.app.settingsFrom = 'title';
      this.app.go('settings');
    }
  }
  cancel(): void {
    this.buttons.pressed = null;
  }
}
