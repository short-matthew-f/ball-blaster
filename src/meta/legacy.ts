/** v2 (pre-tree) upgrade costs, kept only to refund owned nodes on migration. [max level, cost(level), currency] */
const geo = (base: number, mult: number) => (l: number) => Math.round(base * Math.pow(mult, l));
const lin = (base: number, step: number) => (l: number) => base + step * l;
const flat = (c: number) => () => c;

const V2: Record<string, [number, (l: number) => number, 'cash' | 'emerald']> = {
  damage: [12, geo(5, 1.8), 'cash'],
  speed: [5, geo(60, 1.8), 'cash'],
  lightning: [6, geo(150, 1.7), 'cash'],
  split: [3, geo(200, 2), 'cash'],
  spitter: [5, geo(250, 1.8), 'cash'],
  maxHp: [10, geo(6, 1.5), 'cash'],
  armor: [3, geo(40, 1.8), 'cash'],
  secondWind: [4, geo(25, 1.6), 'cash'],
  waveRest: [4, geo(30, 1.6), 'cash'],
  bossHeal: [3, (l) => [30, 60, 120][l] ?? 120, 'cash'],
  thickSkin: [2, geo(50, 1.8), 'cash'],
  aim: [3, (l) => [25, 80, 200][l] ?? 200, 'cash'],
  heavyHits: [1, flat(120), 'cash'],
  mass: [4, geo(60, 1.7), 'cash'],
  reflex: [1, flat(200), 'cash'],
  cashBonus: [8, geo(50, 1.7), 'cash'],
  comboChain: [5, geo(40, 1.7), 'cash'],
  comboBank: [4, geo(60, 1.7), 'cash'],
  comboCascade: [1, flat(90), 'cash'],
  comboSweep: [4, geo(100, 1.7), 'cash'],
  comboLockdown: [4, geo(120, 1.8), 'cash'],
  bumpers: [3, (l) => l + 1, 'emerald'],
  crates: [3, (l) => 2 + l, 'emerald'],
  chests: [3, (l) => 3 + l, 'emerald'],
  shrine: [4, (l) => 3 + 2 * l, 'emerald'],
  ballHeavy: [1, flat(3), 'emerald'],
  ballLight: [1, flat(3), 'emerald'],
  ballSticky: [1, flat(4), 'emerald'],
  strayEmerald: [5, (l) => 10 + 5 * l, 'emerald'],
  felt_nap: [2, lin(100, 100), 'cash'],
  felt_change: [3, lin(80, 80), 'cash'],
  felt_master: [1, flat(400), 'cash'],
  ice_grip: [2, lin(300, 300), 'cash'],
  ice_thaw: [2, lin(350, 350), 'cash'],
  ice_master: [1, flat(1500), 'cash'],
};

export const LEGACY_STAGES: Record<string, string> = { felt: 'w1s1', ice: 'w2s1' };

/** Total paid for every owned v2 node. */
export function v2Refund(levels: Record<string, number>): { cash: number; emeralds: number } {
  let cash = 0;
  let emeralds = 0;
  for (const [id, lv] of Object.entries(levels)) {
    const def = V2[id];
    if (!def || typeof lv !== 'number' || !isFinite(lv)) continue;
    const n = Math.min(Math.floor(lv), def[0]);
    let sum = 0;
    for (let l = 0; l < n; l++) sum += def[1](l);
    if (def[2] === 'cash') cash += sum;
    else emeralds += sum;
  }
  return { cash, emeralds };
}
