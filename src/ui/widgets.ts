// Canvas UI widgets: panels, buttons with pressed states, progress bars.
import { PALETTE } from '../render/palette';
import { drawText, textWidth } from '../render/text';
import { drawSprite } from '../render/sprite-cache';

const P = PALETTE;

export type BtnStyle = 'gray' | 'green' | 'blue' | 'red' | 'gold';
const STYLES: Record<BtnStyle, [string, string, string]> = {
  gray: [P['2'], P['3'], P['1']],
  green: [P.e, P.E, P.g],
  blue: [P.b, P.B, P['1']],
  red: [P.R, P.p, P.r],
  gold: [P.y, P.Y, P.w],
};

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  icon?: string;
  style?: BtnStyle;
  scale?: number;
  disabled?: boolean;
  /** Draw a highlighted outline (toggled/selected). */
  active?: boolean;
}

export function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px < x + w && py >= y && py < y + h;
}

export function drawButton(ctx: CanvasRenderingContext2D, b: Button, pressed: boolean): void {
  const [face, hi, lo] = b.disabled ? [P['1'], P['1'], P['0']] : STYLES[b.style ?? 'gray'];
  const dy = pressed && !b.disabled ? 1 : 0;
  // outline with clipped corners
  ctx.fillStyle = b.active ? P.Y : P['0'];
  ctx.fillRect(b.x + 1, b.y, b.w - 2, b.h);
  ctx.fillRect(b.x, b.y + 1, b.w, b.h - 2);
  // shadow edge
  ctx.fillStyle = lo;
  ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
  // face
  ctx.fillStyle = face;
  ctx.fillRect(b.x + 1, b.y + 1 + dy, b.w - 2, b.h - 3 - dy + (pressed ? 0 : 0));
  if (!pressed && !b.disabled) {
    ctx.fillStyle = hi;
    ctx.fillRect(b.x + 2, b.y + 1, b.w - 4, 1);
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 + dy;
  const scale = b.scale ?? 1;
  const color = b.disabled ? P['3'] : P['5'];
  if (b.icon && !b.label) drawSprite(ctx, b.icon, cx, cy - 1);
  if (b.label) {
    const tw = textWidth(b.label, scale);
    let tx = cx;
    if (b.icon) {
      tx = cx + 6;
      drawSprite(ctx, b.icon, cx - tw / 2 - 2, cy - 1);
    }
    drawText(ctx, b.label, tx, cy - (5 * scale) / 2 - 0.5, { color, scale, align: 'center', shadow: b.disabled ? null : lo });
  }
}

export class Buttons {
  list: Button[] = [];
  pressed: string | null = null;

  set(list: Button[]): void {
    this.list = list;
  }

  private hit(x: number, y: number): Button | undefined {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (!b.disabled && inRect(x, y, b.x, b.y, b.w, b.h)) return b;
    }
    return undefined;
  }

  down(x: number, y: number): boolean {
    const b = this.hit(x, y);
    this.pressed = b ? b.id : null;
    return !!b;
  }

  /** Returns the id of the button tapped (press and release on the same button). */
  up(x: number, y: number): string | null {
    const b = this.hit(x, y);
    const id = this.pressed;
    this.pressed = null;
    return b && b.id === id ? id : null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.list) drawButton(ctx, b, b.id === this.pressed);
  }
}

export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = P['1'], border: string = P['2']): void {
  ctx.fillStyle = P['0'];
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = border;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}

/** Horizontal bar with optional ghost marker (0..1). */
export function drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, fill: string, hi: string, back: string, ghost?: number): void {
  ctx.fillStyle = P['0'];
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.max(0, Math.min(1, frac)));
  if (fw > 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = hi;
    ctx.fillRect(x, y, fw, 1);
  }
  if (ghost !== undefined && ghost > 0) {
    const gx = x + Math.min(w - 1, Math.round(w * Math.min(1, ghost)));
    ctx.fillStyle = P['5'];
    ctx.fillRect(gx, y - 2, 1, h + 4);
  }
}
