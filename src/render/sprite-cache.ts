// Pre-renders sprites once to offscreen canvases; tinted/silhouette variants cached per color.
import { SPRITES as SPRITES_V1 } from './sprites';
import { SPRITES_V2 } from './sprites-v2';
import { PALETTE } from './palette';

interface Entry {
  w: number;
  h: number;
  norm: HTMLCanvasElement;
  tinted: Map<string, HTMLCanvasElement>;
}

/** v2 art wins on key collision. */
const SPRITES: Record<string, { w: number; h: number; rows: string[] }> = { ...SPRITES_V1, ...SPRITES_V2 };

const cache = new Map<string, Entry>();
export const WHITE = '#ffffff';

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function build(name: string): Entry {
  const spr = SPRITES[name];
  if (!spr) {
    // Fallback: palette circle so a missing sprite never crashes.
    const n = 9;
    const c = mk(n, n);
    const g = c.getContext('2d')!;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - 4, y - 4);
        if (d <= 4.3) {
          g.fillStyle = d > 3.3 ? PALETTE['0'] : PALETTE.s;
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    return { w: n, h: n, norm: c, tinted: new Map() };
  }
  const c = mk(spr.w, spr.h);
  const g = c.getContext('2d')!;
  spr.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = PALETTE[row[x]];
      if (row[x] === '.' || !col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return { w: spr.w, h: spr.h, norm: c, tinted: new Map() };
}

function entry(name: string): Entry {
  let e = cache.get(name);
  if (!e) {
    e = build(name);
    cache.set(name, e);
  }
  return e;
}

export function hasSprite(name: string): boolean {
  return !!SPRITES[name];
}

export function spriteSize(name: string): { w: number; h: number } {
  const e = entry(name);
  return { w: e.w, h: e.h };
}

export function getSprite(name: string): HTMLCanvasElement {
  return entry(name).norm;
}

/** Same shape filled with a single color (WHITE = hit-flash silhouette). */
export function getTinted(name: string, color: string): HTMLCanvasElement {
  const e = entry(name);
  let t = e.tinted.get(color);
  if (!t) {
    t = mk(e.w, e.h);
    const g = t.getContext('2d')!;
    g.drawImage(e.norm, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, e.w, e.h);
    e.tinted.set(color, t);
  }
  return t;
}

export interface SpriteOpts {
  scale?: number;
  /** Non-uniform squash/stretch (multiplies scale). */
  sx?: number;
  sy?: number;
  tint?: string;
  alpha?: number;
}

/** Draw centered on (cx, cy), snapped to integer pixels. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, o: SpriteOpts = {}): void {
  const e = entry(name);
  const s = o.scale ?? 1;
  const sw = Math.round(e.w * s * (o.sx ?? 1));
  const sh = Math.round(e.h * s * (o.sy ?? 1));
  const img = o.tint ? getTinted(name, o.tint) : e.norm;
  const x0 = Math.round(cx - sw / 2);
  const y0 = Math.round(cy - sh / 2);
  const prev = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = prev * o.alpha;
  ctx.drawImage(img, x0, y0, sw, sh);
  ctx.globalAlpha = prev;
}
