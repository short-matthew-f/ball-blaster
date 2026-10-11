// Bitmap text renderer (3x5 font) at integer scale.
import { FONT, GLYPH_W, GLYPH_H } from './font';

export interface TextOpts {
  color?: string;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  /** Drop shadow color (offset shadowOff px, default 1). */
  shadow?: string | null;
  shadowOff?: number;
}

export function textWidth(s: string, scale = 1): number {
  return s.length ? (s.length * (GLYPH_W + 1) - 1) * scale : 0;
}

export const TEXT_H = GLYPH_H;

function glyph(ch: string): string[] | undefined {
  return FONT[ch] ?? FONT[ch.toUpperCase()];
}

function paint(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, scale: number, color: string): void {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    if (g) {
      for (let j = 0; j < GLYPH_H; j++) {
        const row = g[j];
        let i = 0;
        while (i < GLYPH_W) {
          if (row[i] === '#') {
            let k = i;
            while (k < GLYPH_W && row[k] === '#') k++;
            ctx.fillRect(cx + i * scale, y + j * scale, (k - i) * scale, scale);
            i = k;
          } else i++;
        }
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
}

export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}): void {
  const scale = o.scale ?? 1;
  const w = textWidth(s, scale);
  let x0 = x;
  if (o.align === 'center') x0 = x - w / 2;
  else if (o.align === 'right') x0 = x - w;
  x0 = Math.round(x0);
  const y0 = Math.round(y);
  if (o.shadow) {
    const so = (o.shadowOff ?? 1) * (scale >= 3 ? 1 : 1);
    paint(ctx, s, x0 + so, y0 + so, scale, o.shadow);
  }
  paint(ctx, s, x0, y0, scale, o.color ?? '#d8d2e6');
}

/** Greedy word-wrap to maxChars per line. */
export function wrapText(s: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    if (cur && cur.length + 1 + word.length > maxChars) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) lines.push(cur);
  return lines;
}
