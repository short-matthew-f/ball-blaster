/** Seeded PRNG (mulberry32). The sim must use this, never Math.random. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, bInclusive: number): number {
    return a + Math.floor(this.next() * (bInclusive - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: { weight: number }[] & T[]): T {
    let total = 0;
    for (const i of items) total += i.weight;
    let r = this.next() * total;
    for (const i of items) if ((r -= i.weight) < 0) return i;
    return items[items.length - 1];
  }
}
