import { CASH_GROWTH, SPIT_LIFE_CAP } from '../core/tuning';
import type { Currency, NodeKind, RunStats, Trunk, UpgradeNode } from '../core/types';

export const ROOT_ID = 'hero';
const CX = 320;
const CY = 320;
const STEP = 40;
const px = (g: number) => CX + g * STEP;
const py = (g: number) => CY + g * STEP;

const geo = (base: number, mult: number) => (l: number) => Math.round(base * Math.pow(mult, l));

/** Ids whose effect applies after all flat nodes (percent multipliers). */
export const MULT_IDS = new Set<string>();
/** Ids that only apply while save.current belongs to the given world. */
export const WORLD_ONLY = new Map<string, number>();
/** Capstone id -> sibling ids that must be maxed. */
export const CAPSTONE_NEEDS = new Map<string, string[]>();

interface Def {
  id: string;
  name: string;
  desc: string;
  kind: NodeKind;
  trunk: Trunk;
  g: [number, number];
  links?: string[];
  max: number;
  cost: (l: number) => number;
  icon: string;
  apply: (s: RunStats, l: number) => void;
  currency?: Currency;
  ring?: number;
  graft?: number;
  loop?: number;
}

const mk = (d: Def): UpgradeNode => ({
  id: d.id,
  name: d.name,
  desc: d.desc,
  currency: d.currency ?? 'cash',
  kind: d.kind,
  maxLevel: d.max,
  cost: d.cost,
  x: px(d.g[0]),
  y: py(d.g[1]),
  links: d.links ?? [],
  ring: d.ring ?? Math.max(1, Math.abs(d.g[0]), Math.abs(d.g[1])),
  trunk: d.trunk,
  graft: d.graft,
  loop: d.loop,
  icon: d.icon,
  apply: d.apply,
});

type Core = Omit<Def, 'id' | 'g' | 'links'>;
const em = (c: Omit<Core, 'currency' | 'kind'> & { kind?: NodeKind }): Core => ({ ...c, kind: c.kind ?? 'keystone', currency: 'emerald' });

// ---------------------------------------------------------------- core table
// Grid coordinates are in 40 px steps from the root (x right, y down). [id, grid, links, def]
const CORE_ROWS: Array<[string, [number, number], string[], Core]> = [
  // ring 1
  ['damage', [0, -1], [ROOT_ID], { name: 'DAMAGE', desc: 'Hits deal {v} damage', kind: 'stat', trunk: 'power', max: 5, cost: geo(5, 1.8), icon: 'icon_damage',
    apply: (s, l) => { s.damage += l; } }],
  ['maxHp', [0, 1], [ROOT_ID], { name: 'MAX HP', desc: '+5 max HP', kind: 'stat', trunk: 'vitality', max: 5, cost: geo(6, 1.5), icon: 'icon_hp',
    apply: (s, l) => { s.maxHp += 5 * l; } }],
  ['aim', [-1, 0], [ROOT_ID], { name: 'AIM LINE', desc: 'Preview {v} bounces', kind: 'stat', trunk: 'tactics', max: 3, cost: (l) => [25, 80, 200][l] ?? 200, icon: 'icon_aim',
    apply: (s, l) => { s.aimPreview = l; } }],
  // ---- POWER (north)
  ['lightning', [0, -2], ['damage'], { name: 'LIGHTNING', desc: 'Arcs between targets', kind: 'stat', trunk: 'power', max: 5, cost: geo(150, 1.7), icon: 'icon_lightning',
    apply: (s, l) => {
      s.lightningChance = 0.15 + 0.07 * l;
      s.lightningArcs = 1 + Math.floor(l / 2);
      s.lightningRange = 40;
      s.lightningDamage = 1 + Math.floor(l / 3);
    } }],
  ['speed', [-1, -2], ['lightning', 'heavyHits'], { name: 'VELOCITY', desc: 'Fast hits +{v} dmg', kind: 'stat', trunk: 'power', max: 5, cost: geo(60, 1.8), icon: 'icon_speed',
    apply: (s, l) => { s.speedDamage = l; } }],
  ['split', [1, -2], ['lightning'], { name: 'SPLIT', desc: '{v} balls on 1st hit', kind: 'stat', trunk: 'power', max: 3, cost: geo(200, 2), icon: 'icon_split',
    apply: (s, l) => { s.splitCount = l + 1; } }],
  ['spitter', [1, -3], ['split'], { name: 'SPITTER', desc: 'Spits mini balls', kind: 'stat', trunk: 'power', max: 5, cost: geo(250, 1.8), icon: 'icon_spit',
    apply: (s, l) => {
      s.spitInterval = 0.6 - 0.08 * (l - 1);
      s.spitLife = Math.min(SPIT_LIFE_CAP, 1.2 + 0.3 * l);
      s.spitDamage = 1;
    } }],
  // ---- VITALITY (south)
  ['secondWind', [0, 2], ['maxHp'], { name: 'SECOND WIND', desc: 'Kills heal {v}', kind: 'stat', trunk: 'vitality', max: 4, cost: geo(25, 1.6), icon: 'icon_heal',
    apply: (s, l) => { s.healOnKill = 2 + (l - 1); } }],
  ['armor', [-1, 2], ['secondWind', 'cashBonus'], { name: 'ARMOR', desc: 'Hits hurt {v} less', kind: 'stat', trunk: 'vitality', max: 3, cost: geo(40, 1.8), icon: 'icon_armor',
    apply: (s, l) => { s.armor += l; } }],
  ['waveRest', [1, 2], ['secondWind', 'comboSweep'], { name: 'WAVE REST', desc: 'Wave clear heals {v}', kind: 'stat', trunk: 'vitality', max: 4, cost: geo(30, 1.6), icon: 'icon_wave',
    apply: (s, l) => { s.waveHeal = 6 + 3 * (l - 1); } }],
  ['bossHeal', [0, 3], ['secondWind'], { name: 'BOSS HEAL', desc: 'Boss heals {v}%', kind: 'stat', trunk: 'vitality', max: 3, cost: (l) => [30, 60, 120][l] ?? 120, icon: 'icon_boss',
    apply: (s, l) => { s.bossHeal = 0.25 * l; } }],
  ['thickSkin', [-1, 3], ['armor'], { name: 'THICK SKIN', desc: 'Ranged hits -{v}', kind: 'stat', trunk: 'vitality', max: 2, cost: geo(50, 1.8), icon: 'icon_armor',
    apply: (s, l) => { s.rangedResist += l; } }],
  // ---- TACTICS (west)
  ['mass', [-2, 0], ['aim'], { name: 'MASS', desc: '+{v}% hero mass', kind: 'stat', trunk: 'tactics', max: 4, cost: geo(60, 1.7), icon: 'icon_mass',
    apply: (s, l) => { s.massMult += 0.25 * l; } }],
  ['heavyHits', [-2, -1], ['aim'], { name: 'HEAVY HITS', desc: 'Hard hits stagger', kind: 'unlock', trunk: 'tactics', max: 1, cost: () => 120, icon: 'icon_stagger',
    apply: (s) => { s.heavyHits = 1; } }],
  ['reflex', [-3, -1], ['heavyHits'], { name: 'REFLEX', desc: 'Skip 1st enemy turn', kind: 'unlock', trunk: 'tactics', max: 1, cost: () => 200, icon: 'icon_reflex',
    apply: (s) => { s.reflex = 1; } }],
  ['cashBonus', [-2, 1], ['mass'], { name: 'CASH BONUS', desc: '+10% cash per level', kind: 'stat', trunk: 'tactics', max: 5, cost: geo(50, 1.7), icon: 'icon_cash',
    apply: (s, l) => { s.cashMult += 0.1 * l; } }],
  // ---- COMBO (east)
  ['comboChain', [1, 0], ['damage', 'maxHp'], { name: 'CHAIN', desc: '3+ hits: +{v}% cash', kind: 'stat', trunk: 'combo', ring: 2, max: 5, cost: geo(40, 1.7), icon: 'icon_combo',
    apply: (s, l) => { s.comboChain = 0.25 * l; } }],
  ['comboBank', [2, -1], ['comboChain', 'split'], { name: 'BANK', desc: 'Bank kill bonus', kind: 'stat', trunk: 'combo', max: 4, cost: geo(60, 1.7), icon: 'icon_bank',
    apply: (s, l) => { s.comboBank = 0.5 * l; } }],
  ['comboCascade', [2, 0], ['comboChain'], { name: 'CASCADE', desc: 'Bump-kill bonus', kind: 'unlock', trunk: 'combo', max: 1, cost: () => 90, icon: 'icon_bumper',
    apply: (s) => { s.comboCascade = 1; } }],
  ['comboSweep', [2, 1], ['comboChain'], { name: 'SWEEP', desc: 'Clear bonus +{v}', kind: 'stat', trunk: 'combo', max: 4, cost: geo(100, 1.7), icon: 'icon_wave',
    apply: (s, l) => { s.comboSweep = 25 * l; } }],
  ['comboLockdown', [3, 0], ['comboCascade'], { name: 'LOCKDOWN', desc: 'Stagger all: +{v} HP', kind: 'stat', trunk: 'combo', max: 4, cost: geo(120, 1.8), icon: 'icon_stagger',
    apply: (s, l) => { s.comboLockdown = 2 * l; } }],
  // ---- EMERALD KEYSTONES (diagonals)
  ['bumpers', [2, -2], ['comboBank', 'split'], em({ name: 'BUMPERS', desc: '{v} bumpers on table', trunk: 'combo', max: 3, cost: (l) => l + 1, icon: 'icon_bumper',
    apply: (s, l) => { s.bumpers = l; } })],
  ['crates', [2, 2], ['comboSweep', 'waveRest'], em({ name: 'CRATES', desc: '{v} cash crates', trunk: 'combo', max: 3, cost: (l) => 2 + l, icon: 'icon_crate',
    apply: (s, l) => { s.crates = l; s.crateCash = 8 + 4 * l; } })],
  ['chests', [3, 3], ['crates'], em({ name: 'CHESTS', desc: 'Richer chests', trunk: 'combo', max: 3, cost: (l) => 3 + l, icon: 'icon_chest',
    apply: (s, l) => { s.chests = Math.min(l, 2); s.chestCash = 25 + 15 * l; } })],
  ['shrine', [-2, 2], ['armor', 'cashBonus'], em({ name: 'SHRINE', desc: 'Shrine heals {v}', trunk: 'vitality', max: 4, cost: (l) => 3 + 2 * l, icon: 'icon_shrine',
    apply: (s, l) => { s.shrineChance = 0.3 + 0.15 * (l - 1); s.shrineHeal = 8 + 2 * l; } })],
  ['strayEmerald', [-3, 3], ['shrine'], em({ name: 'STRAY GEMS', desc: 'Kills may drop gems', trunk: 'vitality', kind: 'stat', max: 5, cost: (l) => 10 + 5 * l, icon: 'icon_emerald',
    apply: (s, l) => { s.strayEmeraldChance = 0.01 * l; } })],
  ['ballHeavy', [-2, -2], ['speed', 'heavyHits'], em({ name: 'HEAVY BALL', desc: 'Unlock heavy ball', trunk: 'tactics', max: 1, cost: () => 3, icon: 'icon_ball', apply: () => {} })],
  ['ballLight', [-3, -3], ['ballHeavy'], em({ name: 'LIGHT BALL', desc: 'Unlock light ball', trunk: 'tactics', max: 1, cost: () => 3, icon: 'icon_ball', apply: () => {} })],
  ['ballSticky', [-2, -3], ['ballHeavy'], em({ name: 'STICKY BALL', desc: 'Unlock sticky ball', trunk: 'tactics', max: 1, cost: () => 4, icon: 'icon_ball', apply: () => {} })],
];

const ROOT: UpgradeNode = mk({
  id: ROOT_ID, name: 'HERO', desc: 'The 8-ball', kind: 'unlock', trunk: 'power', g: [0, 0], links: [], max: 1, cost: () => 0, icon: 'icon_ball', ring: 0, apply: () => {},
});

export const CORE_NODES: UpgradeNode[] = [
  ROOT,
  ...CORE_ROWS.map(([id, g, links, c]) => mk({ ...c, id, g, links })),
];

// -------------------------------------------------------------------- grafts
interface GraftSpec {
  trunk: Trunk;
  anchor: string;
  d: [number, number];
  p: [number, number];
  counter: [string, string];
  cash: [string, string];
  cap: [string, string, (s: RunStats) => void];
}

const GRAFTS: Record<number, GraftSpec> = {
  1: { trunk: 'vitality', anchor: 'thickSkin', d: [0, 1], p: [-1, 0],
    counter: ['FELT HIDE', '+2 HP on felt'], cash: ['POCKET CHG', '+5% cash on felt'],
    cap: ['FELT MASTER', '+5 max HP always', (s) => { s.maxHp += 5; }] },
  2: { trunk: 'vitality', anchor: 'bossHeal', d: [0, 1], p: [1, 0],
    counter: ['ICE GRIP', '+2 HP on ice'], cash: ['ICE FUNDS', '+5% cash on ice'],
    cap: ['ICE MASTER', '+25% mass,+1 heal', (s) => { s.massMult += 0.25; s.waveHeal += 1; }] },
  3: { trunk: 'tactics', anchor: 'mass', d: [-1, 0], p: [0, 1],
    counter: ['GEARBOX', '+2 HP on works'], cash: ['SCRAP SALE', '+5% cash on works'],
    cap: ['TIMEKEEPER', '+1 aim, +10% mass', (s) => { s.aimPreview += 1; s.massMult += 0.1; }] },
  4: { trunk: 'combo', anchor: 'comboLockdown', d: [1, 0], p: [0, 1],
    counter: ['MUD BOOTS', '+2 HP in bog'], cash: ['BOG TRADE', '+5% cash in bog'],
    cap: ['MIRE KING', 'Kill heal+1,+10% chn', (s) => { s.healOnKill += 1; s.comboChain += 0.1; }] },
  5: { trunk: 'power', anchor: 'lightning', d: [0, -1], p: [-1, 0],
    counter: ['HEAT SHIELD', '+2 HP in pit'], cash: ['ASH MARKET', '+5% cash in pit'],
    cap: ['EMBER HEART', '+2 damage always', (s) => { s.damage += 2; }] },
  6: { trunk: 'combo', anchor: 'bumpers', d: [1, -1], p: [1, 1],
    counter: ['LUCKY SOCKS', '+2 HP at casino'], cash: ['HOUSE CUT', '+5% cash at casino'],
    cap: ['HIGH ROLLER', '+25% cash always', (s) => { s.cashMult += 0.25; }] },
};

export const WORLD_COUNT = 6;
/** Tip node of each trunk (the graft's damage node), where loop rings attach. */
const LOOP_TIPS: Record<Trunk, { tier: string; d: [number, number] }> = {
  power: { tier: 'g5_dmg', d: [0, -1] },
  vitality: { tier: 'g2_dmg', d: [0, 1] },
  tactics: { tier: 'g3_dmg', d: [-1, 0] },
  combo: { tier: 'g4_dmg', d: [1, 0] },
};
export const TRUNKS: Trunk[] = ['power', 'vitality', 'tactics', 'combo'];

const gridOf = (id: string): [number, number] => {
  const n = CORE_NODES.find((c) => c.id === id)!;
  return [(n.x - CX) / STEP, (n.y - CY) / STEP];
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** The five nodes of a world's graft; priced for that world's stages. */
export function makeGraft(world: number): UpgradeNode[] {
  const g = GRAFTS[world];
  const f = CASH_GROWTH ** (4 * (world - 1));
  const price = (base: number, step: number) => (l: number) => Math.max(1, Math.round(base * f * Math.pow(step, l)));
  const [ax, ay] = gridOf(g.anchor);
  const at = (a: number, b: number): [number, number] => [ax + g.d[0] * a + g.p[0] * b, ay + g.d[1] * a + g.p[1] * b];
  const ring = 3 + world;
  const id = (k: string) => `g${world}_${k}`;
  const tierName = ROMAN[world + 1];
  const common = { trunk: g.trunk, ring, graft: world };
  const counter = mk({ ...common, id: id('counter'), name: g.counter[0], desc: g.counter[1], kind: 'counter', g: at(1, 0), links: [g.anchor], max: 3,
    cost: price(100, 1.5), icon: 'icon_hp', apply: (s, l) => { s.maxHp += 2 * l; } });
  const cash = mk({ ...common, id: id('cash'), name: g.cash[0], desc: g.cash[1], kind: 'stat', g: at(1, 1), links: [id('counter')], max: 5,
    cost: price(80, 1.5), icon: 'icon_cash', apply: (s, l) => { s.cashMult += 0.05 * l; } });
  const dmg = mk({ ...common, id: id('dmg'), name: `DAMAGE ${tierName}`, desc: '+12% damage', kind: 'stat', g: at(2, 0), links: [id('counter')], max: 5,
    cost: price(300, 1.5), icon: 'icon_damage', apply: (s, l) => { s.damage *= 1 + 0.12 * l; } });
  const hp = mk({ ...common, id: id('hp'), name: `MAX HP ${tierName}`, desc: '+12% max HP', kind: 'stat', g: at(2, 1), links: [id('cash')], max: 5,
    cost: price(300, 1.5), icon: 'icon_hp', apply: (s, l) => { s.maxHp *= 1 + 0.12 * l; } });
  const cap = mk({ ...common, id: id('cap'), name: g.cap[0], desc: g.cap[1], kind: 'capstone', g: at(3, 1), links: [id('dmg'), id('hp')], max: 1,
    cost: price(400, 1), icon: 'icon_lock', apply: (s) => g.cap[2](s) });
  WORLD_ONLY.set(counter.id, world);
  WORLD_ONLY.set(cash.id, world);
  MULT_IDS.add(dmg.id);
  MULT_IDS.add(hp.id);
  CAPSTONE_NEEDS.set(cap.id, [counter.id, cash.id, dmg.id, hp.id]);
  return [counter, cash, dmg, hp, cap];
}

// --------------------------------------------------------------- loop rings
const LOOP_EFFECT: Record<Trunk, [string, string, string, (s: RunStats, l: number) => void]> = {
  power: ['DMG', '+8% damage', 'icon_damage', (s, l) => { s.damage *= 1 + 0.08 * l; }],
  vitality: ['HP', '+8% max HP', 'icon_hp', (s, l) => { s.maxHp *= 1 + 0.08 * l; }],
  tactics: ['CASH', '+8% cash', 'icon_cash', (s, l) => { s.cashMult *= 1 + 0.08 * l; }],
  combo: ['COMBO', '+8% combo cash', 'icon_combo', (s, l) => {
    s.comboChain *= 1 + 0.08 * l;
    s.comboBank *= 1 + 0.08 * l;
    s.comboSweep *= 1 + 0.08 * l;
  }],
};

/** Two stat nodes per trunk per loop, chained outward from the trunk's tip. */
export function makeLoopRing(loop: number, trunk: Trunk): UpgradeNode[] {
  const tip = LOOP_TIPS[trunk];
  const [tx, ty] = gridOf_graft(tip.tier);
  const [label, desc, icon, apply] = LOOP_EFFECT[trunk];
  const f = CASH_GROWTH ** (24 + 4 * loop);
  const out: UpgradeNode[] = [];
  const idOf = (L: number, k: string) => `l${L}_${trunk}_${k}`;
  (['a', 'b'] as const).forEach((k, i) => {
    const steps = 2 * (loop - 1) + 1 + i;
    const n = mk({
      id: idOf(loop, k), name: `L${loop} ${label}`, desc, kind: 'stat', trunk, g: [tx + tip.d[0] * steps, ty + tip.d[1] * steps],
      links: [i === 0 ? (loop === 1 ? tip.tier : idOf(loop - 1, 'b')) : idOf(loop, 'a')],
      max: 5, cost: (l) => Math.max(1, Math.round(300 * f * Math.pow(1.5, l))), icon, ring: 3 + WORLD_COUNT + loop, loop, apply,
    });
    MULT_IDS.add(n.id);
    out.push(n);
  });
  return out;
}

function gridOf_graft(tierId: string): [number, number] {
  const w = Number(tierId[1]);
  const n = GRAFT_NODES.find((x) => x.id === tierId) ?? makeGraftCached(w).find((x) => x.id === tierId)!;
  return [(n.x - CX) / STEP, (n.y - CY) / STEP];
}

const graftCache = new Map<number, UpgradeNode[]>();
function makeGraftCached(w: number): UpgradeNode[] {
  let g = graftCache.get(w);
  if (!g) graftCache.set(w, (g = makeGraft(w)));
  return g;
}

export const GRAFT_NODES: UpgradeNode[] = [];
for (let w = 1; w <= WORLD_COUNT; w++) GRAFT_NODES.push(...makeGraftCached(w));

const loopCache = new Map<number, UpgradeNode[]>();
export function loopNodes(loop: number): UpgradeNode[] {
  let r = loopCache.get(loop);
  if (!r) {
    r = [];
    for (const t of TRUNKS) r.push(...makeLoopRing(loop, t));
    loopCache.set(loop, r);
  }
  return r;
}

export const FIRST_LOOP_NODES = loopNodes(1);
