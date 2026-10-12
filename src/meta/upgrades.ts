// v0.6 M2 island tree (m2-spec §1). One tree drawn as a spiral of islands: island 1 (Felt Hall) around the hero, islands 2-6
// reached through portal nodes paid in the previous world's boss tokens, loop rings hanging off island 6.
// Gear is not in the tree any more: it lives in the gallery (meta/cards.ts).
import { CASH_GROWTH, ISLAND_PRICE_MULT } from '../core/tuning';
import type { Currency, NodeKind, RunStats, TokenId, UpgradeNode } from '../core/types';
import { TOKEN_OF_WORLD } from '../core/types';
import { BALL_IDS, CARDS, CUE_IDS, RELIC_IDS, TRICK_IDS, cardToken } from './cards';

export { BALL_IDS, CUE_IDS, RELIC_IDS, TRICK_IDS };

export const ROOT_ID = 'hero';
export const WORLD_COUNT = 6;

/** Ids whose effect applies after all flat nodes (percent multipliers). */
export const MULT_IDS = new Set<string>();
/** Ids that only apply while save.current belongs to the given world. */
export const WORLD_ONLY = new Map<string, number>();
/** Capstone id -> the island's cash node ids that must all be maxed. */
export const CAPSTONE_NEEDS = new Map<string, string[]>();
/** Portal id -> the `save.unlocked` it needs (4(k-1) for portal_w{k}, 24L for portal_l{L}). */
export const PORTAL_NEEDS = new Map<string, number>();

/** Relics that were cash stat nodes before v0.6 (now formula cards). */
export const STAT_RELICS = ['lightning', 'split', 'spitter'] as const;
/** v3 ball unlock node id -> card id (migration only). */
export const BALL_CARD = { ballHeavy: 'heavy', ballLight: 'light', ballSticky: 'sticky' } as const;
/** Card id -> the token that unlocks it. */
export const GEAR_TOKEN: Record<string, TokenId> = Object.fromEntries(CARDS.map((c) => [c.id, cardToken(c)]));

/** f_k = CASH_GROWTH^(4(k-1)): the cash band of world k. */
export const worldPriceFactor = (k: number) => CASH_GROWTH ** (4 * (k - 1));

// ------------------------------------------------------------------ geometry
const SPACING = 200;
/** Island centres (virtual canvas px). Index k = island k (index 0 unused). */
export const ISLAND_CENTRES: ReadonlyArray<readonly [number, number]> = [
  [320, 320], [320, 320], [320, 120], [520, 120], [520, 320], [520, 520], [320, 520],
];
/** Loop L's hub, west of island 6 (x may go negative). */
export const loopCentre = (L: number): [number, number] => [120 - SPACING * (L - 1), 520];

type Rot = (x: number, y: number) => [number, number];
/** Local frame -> world offset per island (previous island at local (-200, 0)). Loops use island 6's frame. */
const ROT: Record<number, Rot> = {
  2: (x, y) => [y, -x],
  3: (x, y) => [x, y],
  4: (x, y) => [-y, x],
  5: (x, y) => [-y, x],
  6: (x, y) => [-x, -y],
};
/** Out direction (towards the next island) per island, world space. */
const OUT: Record<number, [number, number]> = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [0, 1], 5: [-1, 0], 6: [-1, 0] };

/** Bounding box of a node set (the virtual canvas exceeds 640 and goes negative with loops). */
export function treeBounds(nodes: UpgradeNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  return { minX, minY, maxX, maxY };
}

// ------------------------------------------------------------------ builders
interface Def {
  id: string;
  name: string;
  desc: string;
  kind: NodeKind;
  max: number;
  cost: (l: number) => number;
  icon: string;
  apply: (s: RunStats, l: number) => void;
  currency?: Currency;
}

function place(d: Def, island: number, x: number, y: number, links: string[], loop?: number): UpgradeNode {
  return {
    id: d.id,
    name: d.name,
    desc: d.desc,
    currency: d.currency ?? 'cash',
    kind: d.kind,
    maxLevel: d.max,
    cost: d.cost,
    x,
    y,
    links,
    ring: island,
    trunk: 'power',
    ...(loop !== undefined ? { loop } : {}),
    island,
    icon: d.icon,
    apply: d.apply,
  };
}

/** Cash price on island k: base x f_k x step^l x ISLAND_PRICE_MULT[k] (the lever is read at call time). */
const price = (k: number, base: number, step: number) => (l: number) =>
  Math.max(1, Math.round(base * worldPriceFactor(k) * Math.pow(step, l) * (ISLAND_PRICE_MULT[k] ?? 1)));
/** A per-level table, scaled like `price`. */
const table = (k: number, t: number[]) => (l: number) =>
  Math.max(1, Math.round((t[l] ?? t[t.length - 1]) * worldPriceFactor(k) * (ISLAND_PRICE_MULT[k] ?? 1)));
const flat = (n: number) => () => n;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// ------------------------------------------------------------------ shared node kinds
const dmgTier = (k: number, id: string): Def => ({ id, name: `DAMAGE ${ROMAN[k + 1]}`, desc: '+12% damage', kind: 'stat', max: 8, cost: price(k, 300, 1.5), icon: 'icon_damage',
  apply: (s, l) => { s.damage *= 1 + 0.12 * l; } });
const hpTier = (k: number, id: string): Def => ({ id, name: `MAX HP ${ROMAN[k + 1]}`, desc: '+12% max HP', kind: 'stat', max: 8, cost: price(k, 300, 1.5), icon: 'icon_hp',
  apply: (s, l) => { s.maxHp *= 1 + 0.12 * l; } });
const gritTier = (k: number, id: string, name: string): Def => ({ id, name, desc: '+1 armor, +4% HP', kind: 'stat', max: 4, cost: price(k, 250, 1.5), icon: 'icon_armor',
  apply: (s, l) => { s.armor += 1; s.maxHp *= 1 + 0.04 * (l - 1); } });

/** World capstone perks (today's graft capstones). */
const CAPS: Record<number, [string, string, (s: RunStats) => void]> = {
  1: ['FELT MASTER', '+5 max HP always', (s) => { s.maxHp += 5; }],
  2: ['ICE MASTER', '+25% mass,+1 heal', (s) => { s.massMult += 0.25; s.waveHeal += 1; }],
  3: ['TIMEKEEPER', '+1 aim, +10% mass', (s) => { s.aimPreview += 1; s.massMult += 0.1; }],
  4: ['MIRE KING', 'Kill heal+1,+10% chn', (s) => { s.healOnKill += 1; s.comboChain += 0.1; }],
  5: ['EMBER HEART', '+2 damage always', (s) => { s.damage += 2; }],
  6: ['HIGH ROLLER', '+25% cash always', (s) => { s.cashMult += 0.25; }],
};
const capDef = (k: number): Def => {
  const [name, desc, fx] = CAPS[k];
  return { id: `cap_w${k}`, name, desc, kind: 'capstone', max: 1, cost: flat(2), currency: TOKEN_OF_WORLD[k - 1], icon: 'icon_cap', apply: (s) => fx(s) };
};

/** Portal name (the world) and its counter (portal = counter level 1; g{k}_counter adds the rest). */
interface IslandSpec {
  world: string;
  counter: [string, string, string];
  cleats?: boolean;
  cash: [string, string];
  themed: [string, string];
  /** An extra cash keystone (chests on island 2, shrine on island 3), at local (0,-80) off the counter. */
  extra?: string;
}
const ISLANDS: Record<number, IslandSpec> = {
  2: { world: 'ICE CAVERN', counter: ['ICE GRIP', '+2 HP on ice', 'icon_hp'], cash: ['ICE FUNDS', '+5% cash on ice'], themed: ['secondWind', 'reflex'], extra: 'chests' },
  3: { world: 'CLOCKWORK', counter: ['CLEATS', 'Belts move you -12px', 'icon_cleats'], cleats: true, cash: ['SCRAP SALE', '+5% cash on works'], themed: ['heavyHits', 'speed'], extra: 'shrine' },
  4: { world: 'BOG', counter: ['MUD BOOTS', '+2 HP in bog', 'icon_hp'], cash: ['BOG TRADE', '+5% cash in bog'], themed: ['waveRest', 'armor'] },
  5: { world: 'EMBER PIT', counter: ['HEAT SHIELD', '+2 HP in pit', 'icon_hp'], cash: ['ASH MARKET', '+5% cash in pit'], themed: ['bossHeal', 'comboSweep'] },
  6: { world: 'NEON CASINO', counter: ['LUCKY SOCKS', '+2 HP at casino', 'icon_hp'], cash: ['HOUSE CUT', '+5% cash at casino'], themed: ['comboBank', 'comboCascade'] },
};

/** Themed nodes (today's names, descs, effects, steps); base price x f_k on their island. */
const THEMED: Record<string, (k: number) => Def> = {
  secondWind: (k) => ({ id: 'secondWind', name: 'SECOND WIND', desc: 'Kills heal {v}', kind: 'stat', max: 4, cost: price(k, 25, 1.6), icon: 'icon_heal',
    apply: (s, l) => { s.healOnKill = 2 + (l - 1); } }),
  reflex: (k) => ({ id: 'reflex', name: 'REFLEX', desc: 'Skip 1st enemy turn', kind: 'unlock', max: 1, cost: price(k, 200, 1), icon: 'icon_reflex',
    apply: (s) => { s.reflex = 1; } }),
  heavyHits: (k) => ({ id: 'heavyHits', name: 'HEAVY HITS', desc: 'Hard hits stagger', kind: 'unlock', max: 1, cost: price(k, 120, 1), icon: 'icon_stagger',
    apply: (s) => { s.heavyHits = 1; } }),
  speed: (k) => ({ id: 'speed', name: 'VELOCITY', desc: 'Fast hits +{v} dmg', kind: 'stat', max: 5, cost: price(k, 60, 1.8), icon: 'icon_speed',
    apply: (s, l) => { s.speedDamage = l; } }),
  waveRest: (k) => ({ id: 'waveRest', name: 'WAVE REST', desc: 'Wave clear heals {v}', kind: 'stat', max: 4, cost: price(k, 30, 1.6), icon: 'icon_wave',
    apply: (s, l) => { s.waveHeal = 6 + 3 * (l - 1); } }),
  armor: (k) => ({ id: 'armor', name: 'ARMOR', desc: 'Hits hurt {v} less', kind: 'stat', max: 3, cost: price(k, 40, 1.8), icon: 'icon_armor',
    apply: (s, l) => { s.armor += l; } }),
  bossHeal: (k) => ({ id: 'bossHeal', name: 'BOSS HEAL', desc: 'Boss heals {v}%', kind: 'stat', max: 3, cost: table(k, [30, 60, 120]), icon: 'icon_boss',
    apply: (s, l) => { s.bossHeal = 0.25 * l; } }),
  comboSweep: (k) => ({ id: 'comboSweep', name: 'SWEEP', desc: 'Clear bonus +{v}', kind: 'stat', max: 4, cost: price(k, 100, 1.7), icon: 'icon_wave',
    apply: (s, l) => { s.comboSweep = 25 * l; } }),
  comboBank: (k) => ({ id: 'comboBank', name: 'BANK', desc: 'Bank kill bonus', kind: 'stat', max: 4, cost: price(k, 60, 1.7), icon: 'icon_bank',
    apply: (s, l) => { s.comboBank = 0.5 * l; } }),
  comboCascade: (k) => ({ id: 'comboCascade', name: 'CASCADE', desc: 'Bump-kill bonus', kind: 'unlock', max: 1, cost: price(k, 90, 1), icon: 'icon_bumper',
    apply: (s) => { s.comboCascade = 1; } }),
};

/** Cash keystones (table fixtures); today's level counts and curves, x f_k on their island. */
const KEYSTONES: Record<string, (k: number) => Def> = {
  bumpers: (k) => ({ id: 'bumpers', name: 'BUMPERS', desc: '{v} bumpers on table', kind: 'keystone', max: 3, cost: table(k, [60, 120, 240]), icon: 'icon_bumper',
    apply: (s, l) => { s.bumpers = l; } }),
  crates: (k) => ({ id: 'crates', name: 'CRATES', desc: '{v} cash crates', kind: 'keystone', max: 3, cost: table(k, [60, 120, 240]), icon: 'icon_crate',
    apply: (s, l) => { s.crates = l; s.crateCash = 8 + 4 * l; } }),
  chests: (k) => ({ id: 'chests', name: 'CHESTS', desc: 'Richer chests', kind: 'keystone', max: 3, cost: table(k, [120, 240, 480]), icon: 'icon_chest',
    apply: (s, l) => { s.chests = Math.min(l, 2); s.chestCash = 25 + 15 * l; } }),
  shrine: (k) => ({ id: 'shrine', name: 'SHRINE', desc: 'Shrine heals {v}', kind: 'keystone', max: 4, cost: table(k, [240, 360, 540, 800]), icon: 'icon_shrine',
    apply: (s, l) => { s.shrineChance = 0.3 + 0.15 * (l - 1); s.shrineHeal = 8 + 2 * l; } }),
};

// ------------------------------------------------------------------ island 1
function island1(): UpgradeNode[] {
  const [cx, cy] = ISLAND_CENTRES[1];
  const k = 1;
  const rows: Array<[Def, [number, number], string[]]> = [
    [{ id: ROOT_ID, name: 'HERO', desc: 'The 8-ball', kind: 'unlock', max: 1, cost: () => 0, icon: 'icon_ball', apply: () => {} }, [0, 0], []],
    [{ id: 'damage', name: 'DAMAGE', desc: 'Hits deal {v} damage', kind: 'stat', max: 5, cost: price(k, 5, 1.8), icon: 'icon_damage',
      apply: (s, l) => { s.damage += l; } }, [0, -40], [ROOT_ID]],
    [{ id: 'maxHp', name: 'MAX HP', desc: '+5 max HP', kind: 'stat', max: 5, cost: price(k, 6, 1.5), icon: 'icon_hp',
      apply: (s, l) => { s.maxHp += 5 * l; } }, [0, 40], [ROOT_ID]],
    [{ id: 'aim', name: 'AIM LINE', desc: 'Preview {v} bounces', kind: 'stat', max: 3, cost: table(k, [25, 80, 200]), icon: 'icon_aim',
      apply: (s, l) => { s.aimPreview = l; } }, [-40, 0], [ROOT_ID]],
    [{ id: 'comboChain', name: 'CHAIN', desc: '3+ hits: +{v}% cash', kind: 'stat', max: 5, cost: price(k, 40, 1.7), icon: 'icon_combo',
      apply: (s, l) => { s.comboChain = 0.25 * l; } }, [40, 0], ['damage', 'maxHp']],
    [{ id: 'mass', name: 'MASS', desc: '+{v}% hero mass', kind: 'stat', max: 4, cost: price(k, 60, 1.7), icon: 'icon_mass',
      apply: (s, l) => { s.massMult += 0.25 * l; } }, [-80, 0], ['aim']],
    [{ id: 'cashBonus', name: 'POCKET CHG', desc: '+10% cash per level', kind: 'stat', max: 5, cost: price(k, 50, 1.7), icon: 'icon_cash',
      apply: (s, l) => { s.cashMult += 0.1 * l; } }, [-40, 40], ['aim', 'maxHp']],
    [gritTier(k, 'g1_grit', 'GRIT'), [-40, -40], ['aim', 'damage']],
    [dmgTier(k, 'g1_dmg'), [0, -80], ['damage']],
    [hpTier(k, 'g1_hp'), [0, 80], ['maxHp']],
    [KEYSTONES.bumpers(k), [80, 0], ['comboChain']],
    [KEYSTONES.crates(k), [80, 40], ['bumpers']],
    [capDef(k), [-80, 80], ['cashBonus']],
  ];
  const out = rows.map(([d, [x, y], links]) => place(d, 1, cx + x, cy + y, links));
  for (const id of ['g1_grit', 'g1_dmg', 'g1_hp']) MULT_IDS.add(id);
  CAPSTONE_NEEDS.set('cap_w1', out.filter((n) => n.id !== ROOT_ID && n.kind !== 'capstone').map((n) => n.id));
  return out;
}

/** The pier of island k: the node the next portal links to. */
export const pierOf = (k: number): string => (k === 1 ? 'g1_dmg' : `g${k}_grit`);

// ------------------------------------------------------------------ islands 2-6
function islandK(k: number): UpgradeNode[] {
  const spec = ISLANDS[k];
  const [cx, cy] = ISLAND_CENTRES[k];
  const rot = ROT[k];
  const id = (s: string) => `g${k}_${s}`;
  const hub = `portal_w${k}`;
  const [cName, cDesc, cIcon] = spec.counter;
  const counterLv1 = spec.cleats
    ? (s: RunStats) => { s.beltGrip = Math.max(s.beltGrip, 1); }
    : (s: RunStats) => { s.maxHp += 2; };
  const portal: Def = { id: hub, name: spec.world, desc: cDesc, kind: 'portal', max: 1, cost: flat(3), currency: TOKEN_OF_WORLD[k - 2], icon: 'icon_portal',
    apply: (s) => counterLv1(s) };
  const counter: Def = { id: id('counter'), name: cName, desc: cDesc, kind: 'counter', max: spec.cleats ? 1 : 2, cost: price(k, 100, 1.5), icon: cIcon,
    apply: spec.cleats ? (s, l) => { s.beltGrip = Math.max(s.beltGrip, 1 + l); } : (s, l) => { s.maxHp += 2 * l; } };
  const cash: Def = { id: id('cash'), name: spec.cash[0], desc: spec.cash[1], kind: 'stat', max: 5, cost: price(k, 80, 1.5), icon: 'icon_cash',
    apply: (s, l) => { s.cashMult += 0.05 * l; } };
  const [A, B] = spec.themed;
  const rows: Array<[Def, [number, number], string[]]> = [
    [portal, [0, 0], [pierOf(k - 1)]],
    [counter, [0, -40], [hub]],
    [hpTier(k, id('hp')), [0, 40], [hub]],
    [dmgTier(k, id('dmg')), [40, 0], [hub]],
    [cash, [40, 40], [id('dmg'), id('hp')]],
    [THEMED[A](k), [-40, -40], [id('counter')]],
    [THEMED[B](k), [40, -40], [id('counter'), id('dmg')]],
    [capDef(k), [-40, 40], [id('hp')]],
  ];
  if (spec.extra) rows.push([KEYSTONES[spec.extra](k), [0, -80], [id('counter')]]);
  const out = rows.map(([d, [x, y], links]) => {
    const [wx, wy] = rot(x, y);
    return place(d, k, cx + wx, cy + wy, links);
  });
  // The pier sits at world 80*o, linked to the kit node at 40*o.
  const [ox, oy] = OUT[k];
  const kit = out.find((n) => n.x === cx + 40 * ox && n.y === cy + 40 * oy)!;
  out.push(place(gritTier(k, id('grit'), `GRIT ${ROMAN[k + 1]}`), k, cx + 80 * ox, cy + 80 * oy, [kit.id]));
  PORTAL_NEEDS.set(hub, 4 * (k - 1));
  for (const n of [hub, id('counter'), id('cash')]) WORLD_ONLY.set(n, k);
  for (const n of [id('dmg'), id('hp'), id('grit')]) MULT_IDS.add(n);
  CAPSTONE_NEEDS.set(`cap_w${k}`, out.filter((n) => n.kind !== 'portal' && n.kind !== 'capstone').map((n) => n.id));
  return out;
}

/** Every island 1..6 node (portals included). */
export const ISLAND_NODES: UpgradeNode[] = [...island1()];
for (let k = 2; k <= WORLD_COUNT; k++) ISLAND_NODES.push(...islandK(k));

/** Hub node id of island k (1..6) or of loop L (island 6+L). */
export const islandHub = (island: number): string => (island <= 1 ? ROOT_ID : island <= WORLD_COUNT ? `portal_w${island}` : `portal_l${island - WORLD_COUNT}`);

// ------------------------------------------------------------------ loops
type LoopTrunk = 'power' | 'vitality' | 'tactics' | 'combo';
const LOOP_EFFECT: Record<LoopTrunk, [string, string, string, [number, number], (s: RunStats, l: number) => void]> = {
  power: ['DMG', '+8% damage', 'icon_damage', [40, 0], (s, l) => { s.damage *= 1 + 0.08 * l; }],
  vitality: ['HP', '+8% max HP', 'icon_hp', [0, 40], (s, l) => { s.maxHp *= 1 + 0.08 * l; }],
  tactics: ['CASH', '+8% cash', 'icon_cash', [0, -40], (s, l) => { s.cashMult *= 1 + 0.08 * l; }],
  combo: ['COMBO', '+8% combo cash', 'icon_combo', [-40, 40], (s, l) => {
    s.comboChain *= 1 + 0.08 * l;
    s.comboBank *= 1 + 0.08 * l;
    s.comboSweep *= 1 + 0.08 * l;
  }],
};
const LOOP_TRUNKS: LoopTrunk[] = ['power', 'vitality', 'tactics', 'combo'];

function makeLoop(L: number): UpgradeNode[] {
  const [cx, cy] = loopCentre(L);
  const rot = ROT[6];
  const island = WORLD_COUNT + L;
  const hub = `portal_l${L}`;
  const at = (x: number, y: number): [number, number] => { const [wx, wy] = rot(x, y); return [cx + wx, cy + wy]; };
  const out: UpgradeNode[] = [];
  const [hx, hy] = at(0, 0);
  out.push(place({ id: hub, name: `LOOP ${L}`, desc: `Loop ${L} ring`, kind: 'portal', max: 1, cost: flat(3), currency: 'house', icon: 'icon_portal', apply: () => {} },
    island, hx, hy, [L === 1 ? pierOf(6) : `l${L - 1}_power_b`], L));
  PORTAL_NEEDS.set(hub, 24 * L);
  const f = CASH_GROWTH ** (24 + 4 * L);
  for (const t of LOOP_TRUNKS) {
    const [label, desc, icon, [lx, ly], apply] = LOOP_EFFECT[t];
    (['a', 'b'] as const).forEach((k, i) => {
      const nid = `l${L}_${t}_${k}`;
      const [x, y] = at(lx * (i + 1), ly * (i + 1));
      out.push(place({ id: nid, name: `L${L} ${label}`, desc, kind: 'stat', max: 5, cost: (l) => Math.max(1, Math.round(300 * f * Math.pow(1.5, l))), icon, apply },
        island, x, y, [i === 0 ? hub : `l${L}_${t}_a`], L));
      MULT_IDS.add(nid);
    });
  }
  return out;
}

const loopCache = new Map<number, UpgradeNode[]>();
/** Loop L's portal and ring nodes. */
export function loopNodes(L: number): UpgradeNode[] {
  let r = loopCache.get(L);
  if (!r) loopCache.set(L, (r = makeLoop(L)));
  return r;
}

export const FIRST_LOOP_NODES = loopNodes(1);
