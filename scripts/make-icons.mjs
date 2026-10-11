// Generates PWA icons (pixel-art, hand-written rows) using only Node built-ins.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAL = {
  g: [0x0f, 0x3d, 0x2e], G: [0x1a, 0x5e, 0x43], h: [0x2b, 0x8a, 0x5e],
  '0': [0x0d, 0x0b, 0x14], '2': [0x4b, 0x3f, 0x63],
  s: [0x8f, 0x9b, 0xb3], S: [0xc9, 0xd3, 0xe6], '5': [0xff, 0xff, 0xff],
  r: [0x7a, 0x1f, 0x2b], R: [0xc4, 0x3a, 0x3a], p: [0xf0, 0x6a, 0x5a],
  Y: [0xf2, 0xc4, 0x4b],
};
const N = 16;
const grid = [];
for (let y = 0; y < N; y++) {
  let row = '';
  for (let x = 0; x < N; x++) row += (x * 7 + y * 5) % 11 === 0 ? 'h' : (x + y) % 9 === 0 ? 'g' : 'G';
  grid.push(row.split(''));
}
function stamp(rows, ox, oy) {
  rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== '.') grid[oy + j][ox + i] = c; }));
}
// red target (upper right)
stamp([
  '..000..',
  '.0ppR0.',
  '0pRRRr0',
  '0R5RRr0',
  '0RRRRr0',
  '.0rRr0.',
  '..000..',
], 7, 1);
// silver ball (lower left)
stamp([
  '..000..',
  '.0SSs0.',
  '0S5Ss20',
  '0SSss20',
  '0Sss220',
  '.0s220.',
  '..000..',
], 3, 8);
// aim dots
[[8, 10], [10, 9], [12, 8]].forEach(([x, y]) => { grid[y][x] = 'Y'; });

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const k = size / N;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = PAL[grid[Math.floor(y / k)][Math.floor(x / k)]];
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });
// Art is full-bleed felt with content inside the central safe zone, so the same image serves both purposes.
for (const s of [192, 512]) {
  writeFileSync(join(out, `icon-${s}.png`), png(s));
  writeFileSync(join(out, `icon-maskable-${s}.png`), png(s));
}
console.log('icons written to', out);
