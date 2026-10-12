import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_STATS, CASH_GROWTH, ISLAND_PRICE_MULT } from '../src/core/tuning';
import { CAPSTONE_NEEDS, ISLAND_CENTRES, MULT_IDS, PORTAL_NEEDS, WORLD_ONLY, pierOf } from '../src/meta/upgrades';
import type { CardState, RunResult, SaveData, TokenId, UpgradeNode } from '../src/core/types';
import { TOKEN_OF_WORLD } from '../src/core/types';
import {
  CARDS, anyCardAffordable, baseBuyState, buyBase, buyCard, cardBuyState, cardById, nextBaseCost,
} from '../src/meta/cards';
import {
  NODES, ROOT_ID, bankRun, buildStats, buy, buyState, distanceFromOwned, exportSave, importSave, isReachable, loadSave, newSave, nextCost,
  nodesFor, pathToOwned, cueSlotOpen, equip, gearOwned, ownedGear, relicSlots, trickSlotOpen, unequip, treeBounds, portalNeeds,
} from '../src/meta';
import { repairV6 } from '../src/meta/save';

const node = (id: string, sv: SaveData = newSave()) => nodesFor(sv).find((n) => n.id === id)!;
const run = (o: Partial<RunResult> = {}): RunResult => ({
  stage: 'w1s1', cash: 0, tokens: 0, tokenId: 'stripe', loot: 0, goblinHits: 0, tooth: false, kills: 0, wave: 1, wavesCleared: 0, bossKilled: false, shots: 0, bestCombo: 0, seconds: 0, ...o,
});

const card = (level = 0): CardState => ({ level, forks: [], fork: null, caps: [], cap: null });
const zero = { stripe: 0, frost: 0, cog: 0, pearl: 0, ember: 0, house: 0 };

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

/** BFS over `nodes` from `from`; returns the reached ids. */
function reach(nodes: UpgradeNode[], from: string): Set<string> {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const l of n.links) if (ids.has(l)) { adj.get(n.id)!.push(l); adj.get(l)!.push(n.id); }
  const seen = new Set([from]);
  const q = [from];
  while (q.length) for (const nb of adj.get(q.pop()!)!) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  return seen;
}
/** Owns every node of `ids` at its max level. */
const maxOut = (sv: SaveData, ids: string[]) => { for (const id of ids) sv.levels[id] = node(id, sv).maxLevel; };

describe('tree structure', () => {
  const all = nodesFor({ ...newSave(), unlocked: 48 });
  it('unique ids, valid links, all reachable from root', () => {
    const ids = new Set(all.map((n) => n.id));
    expect(ids.size).toBe(all.length);
    for (const n of all) for (const l of n.links) expect(ids.has(l), `${n.id}->${l}`).toBe(true);
    const seen = reach(all, ROOT_ID);
    expect([...ids].filter((i) => !seen.has(i))).toEqual([]);
  });
  it('no two nodes within 24 px', () => {
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y), `${all[i].id}/${all[j].id}`).toBeGreaterThanOrEqual(24);
    }
  });
  it('node data sanity', () => {
    for (const n of all) {
      expect(n.name.length, n.id).toBeLessThanOrEqual(12);
      expect(n.desc.length, n.id).toBeLessThanOrEqual(20);
      expect(n.island, n.id).toBeGreaterThanOrEqual(1);
      if (n.id === ROOT_ID) continue;
      for (let l = 0; l < n.maxLevel; l++) expect(Number.isInteger(n.cost(l)) && n.cost(l) > 0, `${n.id} L${l}`).toBe(true);
    }
  });
  it('apply touches only RunStats fields', () => {
    for (const n of all) {
      const s = { ...BASE_STATS };
      n.apply(s, n.maxLevel);
      expect(Object.keys(s).sort(), n.id).toEqual(Object.keys(BASE_STATS).sort());
    }
    for (const c of CARDS) {
      const s = { ...BASE_STATS };
      c.apply?.(s, 3);
      expect(Object.keys(s).sort(), c.id).toEqual(Object.keys(BASE_STATS).sort());
    }
  });
  it('root is always owned', () => {
    const sv = newSave();
    expect(distanceFromOwned(sv, ROOT_ID)).toBe(0);
    expect(buy(sv, node(ROOT_ID))).toBe(false);
    expect(node(ROOT_ID).cost(0)).toBe(0);
    expect(NODES.length).toBeGreaterThan(30);
  });
  it('treeBounds spans the spiral (islands 1..6 and loop 1)', () => {
    const b = treeBounds(nodesFor(newSave()));
    expect(b.minX).toBeLessThanOrEqual(120 - 80);
    expect(b.maxX).toBeGreaterThanOrEqual(520 + 40);
    expect(b.minY).toBeLessThanOrEqual(120 - 40);
    expect(b.maxY).toBeGreaterThanOrEqual(520 + 40);
    expect(treeBounds(nodesFor({ ...newSave(), unlocked: 48 })).minX).toBeLessThan(0); // loop 2+ goes negative
  });
  it('gear is not in the tree', () => {
    for (const c of CARDS) expect(all.some((n) => n.id === c.id || n.id === `${c.id}_lv`), c.id).toBe(false);
    for (const id of ['ballHeavy', 'ballLight', 'ballSticky', 'thickSkin', 'comboLockdown', 'g1_counter', 'g1_cash', 'strayEmerald', 'g1_cap'])
      expect(all.some((n) => n.id === id), id).toBe(false);
  });
});

describe('islands', () => {
  const all = nodesFor({ ...newSave(), unlocked: 48 });
  const isl = (k: number) => all.filter((n) => n.island === k);
  it('island 1 table', () => {
    const at = (id: string) => { const n = node(id); return [n.x - 320, n.y - 320]; };
    const want: Record<string, [number, number]> = {
      hero: [0, 0], damage: [0, -40], maxHp: [0, 40], aim: [-40, 0], comboChain: [40, 0], mass: [-80, 0], cashBonus: [-40, 40],
      g1_grit: [-40, -40], g1_dmg: [0, -80], g1_hp: [0, 80], bumpers: [80, 0], crates: [80, 40], cap_w1: [-80, 80],
    };
    for (const [id, xy] of Object.entries(want)) expect([id, ...at(id)]).toEqual([id, ...xy]);
    expect(isl(1).map((n) => n.id).sort()).toEqual(Object.keys(want).sort());
    expect(node('cashBonus').name).toBe('POCKET CHG');
    expect(node('g1_grit').name).toBe('GRIT');
    expect(node('bumpers').currency).toBe('cash');
    expect([0, 1, 2].map((l) => node('bumpers').cost(l))).toEqual([60, 120, 240]);
    expect([0, 1, 2].map((l) => node('crates').cost(l))).toEqual([60, 120, 240]);
    expect(node('cap_w1').currency).toBe('stripe');
    expect(node('cap_w1').cost(0)).toBe(2);
    expect(node('cap_w1').icon).toBe('icon_cap');
  });
  it('islands 2-6: template, rotation, piers, themed and keystone nodes', () => {
    const THEMED: Record<number, string[]> = { 2: ['secondWind', 'reflex', 'chests'], 3: ['heavyHits', 'speed', 'shrine'], 4: ['waveRest', 'armor'], 5: ['bossHeal', 'comboSweep'], 6: ['comboBank', 'comboCascade'] };
    for (let k = 2; k <= 6; k++) {
      const ids = [`portal_w${k}`, ...['counter', 'hp', 'dmg', 'cash', 'grit'].map((x) => `g${k}_${x}`), `cap_w${k}`, ...THEMED[k]];
      expect(isl(k).map((n) => n.id).sort(), `island ${k}`).toEqual(ids.sort());
      const [cx, cy] = ISLAND_CENTRES[k];
      const portal = node(`portal_w${k}`);
      expect([portal.x, portal.y]).toEqual([cx, cy]);
      expect(portal.kind).toBe('portal');
      expect(portal.links).toEqual([pierOf(k - 1)]);
      expect(portal.currency).toBe(TOKEN_OF_WORLD[k - 2]);
      expect(portal.cost(0)).toBe(3);
      expect(portal.icon).toBe('icon_portal');
      expect(portalNeeds(portal)).toBe(4 * (k - 1));
      // the in-bridge from the previous pier crosses no node: the previous island's direction 40 px out is empty
      const prev = ISLAND_CENTRES[k - 1];
      const dx = Math.sign(prev[0] - cx), dy = Math.sign(prev[1] - cy);
      expect(all.some((n) => n.x === cx + 40 * dx && n.y === cy + 40 * dy), `island ${k} in-bridge`).toBe(false);
      // pier 120 px from the next hub (or the loop hub for island 6)
      const pier = node(pierOf(k));
      const next = k < 6 ? ISLAND_CENTRES[k + 1] : [120, 520];
      expect(Math.hypot(pier.x - next[0], pier.y - next[1]), `pier ${k}`).toBe(120);
      expect(Math.hypot(pier.x - cx, pier.y - cy)).toBe(80);
      expect(node(`cap_w${k}`).currency).toBe(TOKEN_OF_WORLD[k - 1]);
      expect(node(`cap_w${k}`).cost(0)).toBe(2);
      expect(node(`g${k}_dmg`).name).toBe(`DAMAGE ${['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][k + 1]}`);
      expect(WORLD_ONLY.get(`portal_w${k}`)).toBe(k);
      expect(WORLD_ONLY.get(`g${k}_counter`)).toBe(k);
      expect(WORLD_ONLY.get(`g${k}_cash`)).toBe(k);
      expect(MULT_IDS.has(`g${k}_dmg`) && MULT_IDS.has(`g${k}_hp`) && MULT_IDS.has(`g${k}_grit`)).toBe(true);
      expect(CAPSTONE_NEEDS.get(`cap_w${k}`)!.sort()).toEqual(ids.filter((i) => !/^portal|^cap/.test(i)).sort());
    }
    expect(node('g3_counter').name).toBe('CLEATS');
    expect(node('g3_counter').maxLevel).toBe(1);
    expect(node('g2_counter').maxLevel).toBe(2);
    expect(node('portal_w3').name).toBe('CLOCKWORK');
  });
  it('every node reaches hero; island k reaches its portal inside island k', () => {
    expect(reach(all, ROOT_ID).size).toBe(all.length);
    for (let k = 2; k <= 6; k++) {
      const own = isl(k);
      expect(reach(own, `portal_w${k}`).size, `island ${k}`).toBe(own.length);
    }
    for (const L of [1, 2]) {
      const own = all.filter((n) => n.island === 6 + L);
      expect(own.length).toBe(9);
      expect(reach(own, `portal_l${L}`).size).toBe(9);
    }
  });
  it('themed prices: base x f_k, step as today', () => {
    const f = (k: number) => CASH_GROWTH ** (4 * (k - 1));
    expect(node('secondWind').cost(1)).toBe(Math.round(25 * f(2) * 1.6));
    expect(node('heavyHits').cost(0)).toBe(Math.round(120 * f(3)));
    expect(node('bossHeal').cost(2)).toBe(Math.round(120 * f(5)));
    expect(node('chests').cost(0)).toBe(Math.round(120 * f(2)));
    expect(node('shrine').cost(3)).toBe(Math.round(800 * f(3)));
    expect(node('g4_dmg').cost(0)).toBe(Math.round(300 * CASH_GROWTH ** 12));
    expect(node('g2_counter').cost(0)).toBe(Math.round(100 * f(2)));
  });
  it('ISLAND_PRICE_MULT reprices an island at call time', () => {
    const before = node('g2_dmg').cost(0);
    ISLAND_PRICE_MULT[2] = 1.5;
    try {
      expect(node('g2_dmg').cost(0)).toBe(Math.round(300 * CASH_GROWTH ** 4 * 1.5));
      expect(node('damage').cost(0)).toBe(5);
      expect(node('portal_w2').cost(0)).toBe(3);
    } finally {
      ISLAND_PRICE_MULT[2] = 1;
    }
    expect(node('g2_dmg').cost(0)).toBe(before);
  });
});

describe('purchasing', () => {
  it('fresh save: only the hero ring purchasable', () => {
    const sv = newSave();
    sv.cash = 1e9;
    for (const id of TOKEN_OF_WORLD) sv.tokens[id] = 1e9;
    const ok = nodesFor(sv).filter((n) => buyState(sv, n) === 'ok').map((n) => n.id).sort();
    expect(ok).toEqual(['aim', 'damage', 'maxHp']);
  });
  it('adjacency gating and poor/maxed', () => {
    const sv = newSave();
    expect(buyState(sv, node('damage'))).toBe('poor');
    sv.cash = 1e6;
    expect(buyState(sv, node('g1_dmg'))).toBe('locked');
    expect(isReachable(sv, 'g1_dmg')).toBe(false);
    for (let i = 0; i < 5; i++) expect(buy(sv, node('damage'))).toBe(true);
    expect(buyState(sv, node('damage'))).toBe('maxed');
    expect(nextCost(sv, node('damage'))).toBeNull();
    expect(buy(sv, node('damage'))).toBe(false);
    expect(buyState(sv, node('g1_dmg'))).toBe('ok');
    expect(buildStats(sv).damage).toBe(BASE_STATS.damage + 5);
  });
  it('disclosure distances and path', () => {
    const sv = newSave();
    expect(distanceFromOwned(sv, 'damage')).toBe(1);
    expect(distanceFromOwned(sv, 'g1_dmg')).toBe(2);
    expect(distanceFromOwned(sv, 'portal_w2')).toBe(3);
    expect(buyState(sv, node('g1_dmg'))).toBe('locked');
    expect(buyState(sv, node('portal_w2'))).toBe('hidden');
    expect(pathToOwned(sv, 'portal_w2')).toEqual([ROOT_ID, 'damage', 'g1_dmg', 'portal_w2']);
    sv.levels.damage = 1;
    expect(distanceFromOwned(sv, 'damage')).toBe(0);
    expect(pathToOwned(sv, 'g2_counter')).toEqual(['damage', 'g1_dmg', 'portal_w2', 'g2_counter']);
    expect(buyState(sv, node('portal_w2'))).toBe('locked');
  });
  it('ball type needs the card', () => {
    const sv = newSave();
    sv.loadout.ball = 'heavy';
    expect(buildStats(sv).ballType).toBe('standard');
    sv.cards.heavy = card(0);
    expect(buildStats(sv).ballType).toBe('heavy');
  });
  it('portal gating', () => {
    const sv = newSave();
    sv.levels = { damage: 1, g1_dmg: 1 };
    sv.tokens.stripe = 3;
    sv.unlocked = 3;
    expect(buyState(sv, node('portal_w2'))).toBe('locked');
    sv.unlocked = 4;
    expect(buyState(sv, node('portal_w2'))).toBe('ok');
    sv.tokens.stripe = 2;
    expect(buyState(sv, node('portal_w2'))).toBe('poor');
    sv.tokens.stripe = 3;
    expect(buy(sv, node('portal_w2'))).toBe(true);
    expect(sv.tokens.stripe).toBe(0);
    expect(sv.levels.portal_w2).toBe(1);
    sv.current = 'w2s1';
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp + 2);
    sv.current = 'w1s1';
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp);
    expect(buyState(sv, node('g2_counter'))).toBe('poor');
    sv.cash = Math.round(100 * CASH_GROWTH ** 4);
    expect(buyState(sv, node('g2_counter'))).toBe('ok');
    expect(buy(sv, node('g2_counter'))).toBe(true);
    sv.current = 'w2s3';
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp + 4);
  });
  it('island nodes wait for their portal even when a neighbour is owned (moved themed nodes)', () => {
    const sv = newSave();
    sv.cash = 1e9;
    sv.levels = { speed: 2 }; // bought on world 1 before M2; now on island 3
    expect(distanceFromOwned(sv, 'g3_counter')).toBe(1);
    expect(buyState(sv, node('g3_counter'))).toBe('locked');
    expect(buyState(sv, node('speed'))).toBe('locked');
    expect(buildStats(sv).speedDamage).toBe(2); // still applies
    sv.levels.portal_w3 = 1;
    expect(buyState(sv, node('g3_counter'))).toBe('ok');
    expect(buyState(sv, node('speed'))).toBe('ok');
  });
  it('cleats', () => {
    const sv = newSave();
    sv.current = 'w3s2';
    sv.levels.portal_w3 = 1;
    expect(buildStats(sv).beltGrip).toBe(1);
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp);
    sv.levels.g3_counter = 1;
    expect(buildStats(sv).beltGrip).toBe(2);
    sv.current = 'w2s2';
    expect(buildStats(sv).beltGrip).toBe(0);
  });
  it('capstone', () => {
    const sv = newSave();
    const needs = CAPSTONE_NEEDS.get('cap_w1')!;
    expect(needs.sort()).toEqual(['aim', 'bumpers', 'cashBonus', 'comboChain', 'crates', 'damage', 'g1_dmg', 'g1_grit', 'g1_hp', 'mass', 'maxHp'].sort());
    maxOut(sv, needs);
    sv.levels.g1_hp -= 1;
    sv.tokens.stripe = 2;
    expect(buyState(sv, node('cap_w1'))).toBe('locked');
    sv.levels.g1_hp += 1;
    expect(buyState(sv, node('cap_w1'))).toBe('ok');
    sv.tokens.stripe = 1;
    expect(buyState(sv, node('cap_w1'))).toBe('poor');
    sv.tokens.stripe = 2;
    const hp = buildStats(sv).maxHp;
    expect(buy(sv, node('cap_w1'))).toBe(true);
    expect(sv.tokens.stripe).toBe(0);
    expect(buildStats(sv).maxHp).toBeGreaterThan(hp); // FELT MASTER +5 before the percent tiers
  });
});

describe('loops and multipliers', () => {
  it('loop portals and rings appear with the loop', () => {
    const sv = newSave();
    expect(nodesFor(sv).some((n) => n.loop === 1)).toBe(true);
    expect(nodesFor(sv).some((n) => n.loop === 2)).toBe(false);
    sv.unlocked = 24;
    expect(nodesFor(sv).some((n) => n.loop === 2)).toBe(true);
    expect(nodesFor(sv).some((n) => n.loop === 3)).toBe(false);
    const p1 = node('portal_l1', sv);
    expect([p1.x, p1.y, p1.links, p1.currency, p1.cost(0), p1.kind]).toEqual([120, 520, ['g6_grit'], 'house', 3, 'portal']);
    expect(PORTAL_NEEDS.get('portal_l1')).toBe(24);
    const p2 = node('portal_l2', sv);
    expect([p2.x, p2.y, p2.links]).toEqual([-80, 520, ['l1_power_b']]);
    const a = node('l1_power_a', sv);
    expect(a.links).toEqual(['portal_l1']);
    expect(node('l1_power_b', sv).links).toEqual(['l1_power_a']);
    expect(a.cost(0)).toBe(Math.round(300 * CASH_GROWTH ** 28));
    expect(a.cost(0)).toBeGreaterThan(node('g6_dmg').cost(0));
  });
  it('loop portal gate: house tokens and unlocked >= 24L', () => {
    const sv = newSave();
    sv.levels.g6_grit = 1;
    sv.tokens.house = 3;
    sv.unlocked = 23;
    expect(buyState(sv, node('portal_l1', sv))).toBe('locked');
    sv.unlocked = 24;
    expect(buyState(sv, node('portal_l1', sv))).toBe('ok');
    sv.cash = 1e12;
    expect(buyState(sv, node('l1_power_a', sv))).toBe('locked'); // portal not owned
    expect(buy(sv, node('portal_l1', sv))).toBe(true);
    expect(buyState(sv, node('l1_power_a', sv))).toBe('ok');
  });
  it('percent nodes multiply after flat nodes', () => {
    const sv = newSave();
    sv.levels = { damage: 5, g5_dmg: 8 };
    expect(buildStats(sv).damage).toBe(Math.round((BASE_STATS.damage + 5) * 1.96));
    sv.levels.cap_w5 = 1; // +2 flat damage, still before the percent
    expect(buildStats(sv).damage).toBe(Math.round((BASE_STATS.damage + 7) * 1.96));
  });
  it('parity with the pre-island tree (values captured from v0.6 M1)', () => {
    const sv = newSave();
    sv.levels = { damage: 5, g1_dmg: 8 };
    expect(buildStats(sv).damage).toBe(12); // round(6 x 1.96)
    sv.levels = { maxHp: 5, g1_hp: 8, g1_grit: 3 };
    expect(buildStats(sv).maxHp).toBe(87);
    expect(buildStats(sv).armor).toBe(1);
    sv.levels = { g2_cash: 5 };
    expect(buildStats(sv).cashMult).toBe(1); // world-only
    sv.current = 'w2s1';
    expect(buildStats(sv).cashMult).toBeCloseTo(1.25);
    sv.levels = { comboChain: 3, cashBonus: 2, secondWind: 2, armor: 1, bumpers: 2, crates: 1 };
    sv.current = 'w3s1';
    const u = buildStats(sv);
    expect([u.comboChain, u.cashMult, u.healOnKill, u.armor, u.bumpers, u.crates, u.crateCash]).toEqual([0.75, 1.2, 3, 1, 2, 1, 12]);
  });
});

describe('cards', () => {
  it('catalogue: 24 real + 6 stubs, worlds, slots, text lengths', () => {
    expect(CARDS.length).toBe(30);
    expect(CARDS.filter((c) => !c.stub).length).toBe(24);
    const byWorld = (w: number) => CARDS.filter((c) => c.world === w && !c.stub).map((c) => c.id);
    expect(byWorld(1)).toEqual(['break', 'heavy', 'ricochet', 'momentum', 'lantern', 'recall']);
    expect(byWorld(2)).toEqual(['jump', 'light', 'chill', 'mirror', 'split', 'shockwave']);
    expect(byWorld(3)).toEqual(['draw', 'sticky', 'lightning', 'static', 'spitter', 'timeStop']);
    expect(byWorld(4)).toEqual(['follow', 'poison', 'thorns', 'shrapnel', 'rackEm']);
    expect(byWorld(5)).toEqual(['explosive']);
    expect(CARDS.filter((c) => c.stub).map((c) => `${c.id}:${c.world}`)).toEqual(['comet:5', 'fire:5', 'magnet:5', 'greed:6', 'decoy:6', 'bulwark:6']);
    for (const c of CARDS) {
      expect(c.name.length, c.id).toBeLessThanOrEqual(12);
      expect(c.desc.length, c.id).toBeLessThanOrEqual(20);
      expect(c.icon).toBe(`gear_${c.id}`);
      expect(c.forks).toEqual([]);
      expect(c.caps).toEqual([]);
      for (const b of c.base) { expect(b.name.length).toBeLessThanOrEqual(12); expect(b.desc.length, `${c.id} ${b.desc}`).toBeLessThanOrEqual(20); }
    }
    const f = (w: number) => CASH_GROWTH ** (4 * (w - 1));
    expect(cardById('lightning')!.base.map((b, l) => b.cost(l as 0 | 1 | 2))).toEqual([0, 1, 2].map((l) => Math.round(200 * f(3) * 2 ** l)));
    expect(cardById('heavy')!.base[0].cost(0)).toBe(150);
    expect(cardById('recall')!.base[2].cost(2)).toBe(1200);
  });
  it('buyCard / buyBase / gearLevel', () => {
    const sv = newSave();
    expect(cardBuyState(sv, 'break')).toBe('locked');
    expect(buyCard(sv, 'break')).toBe(false);
    sv.tokens.stripe = 1;
    expect(cardBuyState(sv, 'break')).toBe('open');
    expect(anyCardAffordable(sv)).toBe(true);
    expect(buyCard(sv, 'break')).toBe(true);
    expect(sv.tokens.stripe).toBe(0);
    expect(sv.cards.break).toEqual(card(0));
    expect(cardBuyState(sv, 'break')).toBe('owned');
    expect(buyCard(sv, 'break')).toBe(false);
    expect(baseBuyState(sv, 'break')).toBe('poor');
    expect(anyCardAffordable(sv)).toBe(false);
    sv.cash = 1050;
    const paid: number[] = [];
    for (let i = 0; i < 3; i++) { const c = sv.cash; expect(nextBaseCost(sv, 'break')).toBe(150 * 2 ** i); expect(buyBase(sv, 'break')).toBe(true); paid.push(c - sv.cash); }
    expect(paid).toEqual([150, 300, 600]);
    expect(sv.cash).toBe(0);
    expect(cardBuyState(sv, 'break')).toBe('maxed');
    expect(baseBuyState(sv, 'break')).toBe('maxed');
    expect(buyBase(sv, 'break')).toBe(false);
    expect(nextBaseCost(sv, 'break')).toBeNull();
    sv.unlocked = 4;
    expect(equip(sv, 'cue', 'break')).toBe(true);
    expect(buildStats(sv).gearLevel.break).toBe(3);
    // stubs never sell; tokens of the wrong world don't count
    sv.tokens.ember = 5;
    expect(cardBuyState(sv, 'fire')).toBe('stub');
    expect(buyCard(sv, 'fire')).toBe(false);
    expect(buyCard(sv, 'chill')).toBe(false);
    expect(buyCard(sv, 'explosive')).toBe(true); // no `unlocked` check: the token proves the boss
    expect(baseBuyState(sv, 'nope')).toBe('unowned');
  });
  it('legacy relics: lightning / split / spitter formulas at card level + 1', () => {
    const sv = newSave();
    sv.unlocked = 12;
    sv.cards = { lightning: card(2), split: card(3), spitter: card(1) };
    sv.loadout.relics = ['lightning', 'split', 'spitter'];
    const s = buildStats(sv);
    expect(s.lightningChance).toBeCloseTo(0.36);
    expect([s.lightningArcs, s.lightningDamage, s.lightningRange]).toEqual([2, 2, 40]);
    expect(s.splitCount).toBe(5);
    expect(s.spitInterval).toBeCloseTo(0.52);
    expect(s.gearLevel).toEqual({ lightning: 2, split: 3, spitter: 1 });
    sv.loadout.relics = [];
    const off = buildStats(sv);
    expect([off.lightningChance, off.splitCount, off.spitInterval]).toEqual([0, 0, 0]);
  });
  it('base III gate: only once a card has forks', () => {
    const sv = newSave();
    sv.cash = 1e6;
    sv.cards.ricochet = card(2);
    expect(baseBuyState(sv, 'ricochet')).toBe('ok');
    const def = cardById('ricochet')!;
    def.forks.push({ id: 'stub', name: 'STUB', desc: 'stub', cost: 1 });
    try {
      expect(baseBuyState(sv, 'ricochet')).toBe('locked');
      expect(buyBase(sv, 'ricochet')).toBe(false);
      sv.cards.ricochet.forks = ['stub'];
      sv.cards.ricochet.fork = 'stub';
      expect(buyBase(sv, 'ricochet')).toBe(true);
    } finally {
      def.forks.length = 0;
    }
    expect(sv.cards.ricochet.level).toBe(3);
  });
  it('parity: buildStats for owned gear (values captured from v0.6 M1; lightning/split gearLevel now = card level)', () => {
    const sv = newSave();
    sv.unlocked = 12;
    sv.cards = { break: card(1), poison: card(2), shockwave: card(1), lightning: card(2), split: card(2), spitter: card(1), chill: card(1), heavy: card(0) };
    sv.loadout = { ball: 'heavy', cue: 'break', relics: ['poison', 'lightning', 'split'], trick: 'shockwave' };
    const s = buildStats(sv);
    expect(s.gearLevel).toEqual({ poison: 2, lightning: 2, split: 2, shockwave: 1, break: 1, heavy: 0 });
    expect([s.trickUses, s.lightningChance, s.lightningArcs, s.lightningDamage, s.lightningRange, s.splitCount, s.ballType, s.aimPreview])
      .toEqual([3, 0.15 + 0.07 * 3, 2, 2, 40, 4, 'heavy', 0]);
    sv.loadout = { ball: 'standard', cue: 'standard', relics: ['spitter', 'chill'], trick: null };
    const t = buildStats(sv);
    expect(t.gearLevel).toEqual({ spitter: 1, chill: 1 });
    expect([t.spitInterval, t.spitLife, t.spitDamage]).toEqual([0.52, 1.7999999999999998, 1]);
  });
});

describe('gear', () => {
  const owns = (sv: SaveData, ...ids: string[]) => { for (const i of ids) sv.cards[i] = card(0); };
  it('slots by unlocked', () => {
    const sv = newSave();
    const at = (u: number) => { sv.unlocked = u; return [relicSlots(sv), trickSlotOpen(sv)]; };
    expect(at(0)).toEqual([1, false]);
    expect(at(3)).toEqual([1, false]);
    expect(at(4)).toEqual([2, true]);
    expect(at(11)).toEqual([2, true]);
    expect(at(12)).toEqual([3, true]);
    expect(cueSlotOpen(sv)).toBe(false);
    owns(sv, 'jump');
    expect(cueSlotOpen(sv)).toBe(true);
  });
  it('equip / unequip validate ownership and slots (keyed on cards)', () => {
    const sv = newSave();
    expect(equip(sv, 'relic', 'poison')).toBe(false);
    expect(equip(sv, 'cue', 'break')).toBe(false);
    expect(equip(sv, 'cue', 'standard')).toBe(true);
    owns(sv, 'poison', 'chill', 'static', 'break', 'recall', 'bogus', 'fire', 'light');
    expect(gearOwned(sv, 'poison')).toBe(true);
    expect(gearOwned(sv, 'bogus')).toBe(false);
    expect(gearOwned(sv, 'fire')).toBe(false); // stub
    expect(ownedGear(sv)).toEqual({ cues: ['break'], relics: ['chill', 'static', 'poison'], tricks: ['recall'], balls: ['light'] });
    expect(equip(sv, 'relic', 'poison')).toBe(true);
    expect(equip(sv, 'relic', 'chill')).toBe(false); // one slot
    expect(equip(sv, 'relic', 'chill', 1)).toBe(false);
    expect(equip(sv, 'relic', 'fire', 0)).toBe(false);
    expect(equip(sv, 'trick', 'recall')).toBe(false); // trick slot closed
    sv.unlocked = 4;
    expect(equip(sv, 'trick', 'recall')).toBe(true);
    expect(equip(sv, 'relic', 'poison')).toBe(false); // duplicate
    expect(equip(sv, 'relic', 'chill')).toBe(true);
    expect(equip(sv, 'relic', 'static')).toBe(false);
    expect(equip(sv, 'relic', 'static', 0)).toBe(true); // replace slot 0
    expect(sv.loadout.relics).toEqual(['static', 'chill']);
    expect(equip(sv, 'cue', 'break')).toBe(true);
    expect(unequip(sv, 'relic', 0)).toBe(true);
    expect(sv.loadout.relics).toEqual(['chill']);
    expect(unequip(sv, 'relic', 5)).toBe(false);
    expect(unequip(sv, 'cue')).toBe(true);
    expect(unequip(sv, 'cue')).toBe(false);
    expect(sv.loadout.cue).toBe('standard');
    expect(unequip(sv, 'trick')).toBe(true);
    expect(sv.loadout.trick).toBeNull();
    expect(equip(sv, 'ball', 'heavy')).toBe(false);
    expect(equip(sv, 'ball', 'light')).toBe(true);
    expect(sv.loadout.ball).toBe('light');
    expect(unequip(sv, 'ball')).toBe(true);
    expect(unequip(sv, 'ball')).toBe(false);
    expect(sv.loadout.ball).toBe('standard');
  });
  it('buildStats: cue, trick, uses, gearLevel, break kills aim preview', () => {
    const sv = newSave();
    sv.unlocked = 4;
    sv.levels.aim = 3;
    owns(sv, 'break', 'shockwave', 'poison');
    sv.cards.shockwave.level = 1;
    sv.cards.poison.level = 2;
    sv.loadout = { ball: 'standard', cue: 'break', relics: ['poison'], trick: 'shockwave' };
    const s = buildStats(sv);
    expect(s.cue).toBe('break');
    expect(s.aimPreview).toBe(0);
    expect(s.trick).toBe('shockwave');
    expect(s.trickUses).toBe(3);
    expect(s.gearLevel).toEqual({ poison: 2, shockwave: 1, break: 0 });
    sv.cards.shockwave.level = 3;
    expect(buildStats(sv).trickUses).toBe(5);
    sv.loadout.trick = 'recall'; // unowned
    expect(buildStats(sv).trick).toBeNull();
    expect(buildStats(sv).trickUses).toBe(0);
    sv.loadout.cue = 'standard';
    expect(buildStats(sv).aimPreview).toBe(3);
  });
  it('first load auto-equips owned lightning / split / spitter, once', () => {
    const sv = newSave();
    sv.unlocked = 12;
    owns(sv, 'lightning', 'split', 'spitter');
    delete (sv as Partial<SaveData>).loadout;
    const a = importSave(exportSave(sv))!;
    expect(a.loadout).toEqual({ ball: 'standard', cue: 'standard', relics: ['lightning', 'split', 'spitter'], trick: null });
    a.loadout.relics = [];
    expect(importSave(exportSave(a))!.loadout.relics).toEqual([]); // deliberate unequip sticks
    sv.unlocked = 0;
    expect(importSave(exportSave(sv))!.loadout.relics).toEqual(['lightning']); // truncated to slots
  });
  it('sanitize drops unowned gear and truncates', () => {
    const sv = { ...newSave(), unlocked: 4, cards: { poison: card(), chill: card(), static: card(), break: card() } } as SaveData;
    (sv as unknown as { loadout: unknown }).loadout = { cue: 'jump', relics: ['poison', 'poison', 'lantern', 'chill', 'static', 'nope'], trick: 'recall' };
    const r = importSave(exportSave(sv))!;
    expect(r.loadout).toEqual({ ball: 'standard', cue: 'standard', relics: ['poison', 'chill'], trick: null });
    (sv as unknown as { loadout: unknown }).loadout = 7;
    expect(importSave(exportSave(sv))!.loadout).toEqual({ ball: 'standard', cue: 'standard', relics: [], trick: null });
    expect(newSave().loadout).toEqual({ ball: 'standard', cue: 'standard', relics: [], trick: null });
  });
});

describe('island repair (repairV6)', () => {
  const v3 = (o: Record<string, unknown>) => ({ version: 1, ...o });
  const migrate = (o: Record<string, unknown>) => importSave(btoa(JSON.stringify(v3(o))))!;
  const v4 = (o: Partial<SaveData> & Record<string, unknown>) => importSave(exportSave({ ...newSave(), hints: {}, ...o } as SaveData))!;

  it('migration: v3 -> v4 -> repairV6 (spec test 7, crates kept per the owner)', () => {
    const sv = migrate({ unlocked: 8, levels: { g2_cap: 1, g2_counter: 2, thickSkin: 2, crates: 1, lightning: 5, ballHeavy: 1 } });
    expect(sv.levels).toEqual({ portal_w2: 1, portal_w3: 1, cap_w2: 1, g2_counter: 1, crates: 1 });
    expect(sv.cash).toBe(140 + 222 + 1253);
    expect(sv.tokens).toEqual(zero);
    expect(sv.cards.lightning.level).toBe(3);
    expect(sv.cards.heavy).toEqual(card(0));
    expect(sv.hints.islandsV6).toBe(true);
    for (const id of ['g2_cap', 'thickSkin', 'lightning', 'ballHeavy', 'strayEmerald']) expect(id in sv.levels, id).toBe(false);
    const again = importSave(exportSave(sv))!;
    expect(again).toEqual(sv);
    expect(importSave(exportSave(again))).toEqual(sv);
  });
  it("owner's v3 export: cash 60, stripe 12, damage 2 / maxHp 2, unlocked 4 -> owns portal_w2, nothing else changes", () => {
    const raw = { cash: 60, emeralds: 12, levels: { damage: 2, maxHp: 2 }, unlocked: 4, bossKills: { w1s1: 4 } };
    const sv = migrate(raw);
    expect(sv.cash).toBe(60);
    expect(sv.tokens).toEqual({ ...zero, stripe: 12 });
    expect(sv.levels).toEqual({ damage: 2, maxHp: 2, portal_w2: 1 });
    expect(sv.cards).toEqual({});
    expect(sv.loadout).toEqual({ ball: 'standard', cue: 'standard', relics: [], trick: null });
    expect(buildStats({ ...sv, current: 'w2s1' }).maxHp).toBe(BASE_STATS.maxHp + 10 + 2);
    expect(importSave(exportSave(sv))).toEqual(sv);
  });
  it('M1 v4 saves (no hint): portals, counter shift, cap rename, drops refunded, gear in levels, clamp; once', () => {
    const sv = v4({
      cash: 0, unlocked: 12,
      levels: { g1_cap: 1, g1_counter: 3, g1_cash: 2, comboLockdown: 1, g3_counter: 2, g4_counter: 1, strayEmerald: 2, chests: 2, shrine: 9, recall: 1, recall_lv: 2, ballSticky: 1 },
      cards: { ballLight: card(1) } as unknown as SaveData['cards'],
    });
    expect(sv.levels).toEqual({ portal_w2: 1, portal_w3: 1, portal_w4: 1, cap_w1: 1, g3_counter: 1, chests: 2, shrine: 4 });
    const f = (w: number) => Math.round(100 * CASH_GROWTH ** (4 * (w - 1)));
    expect(sv.cash).toBe((100 + 150 + 225) + (80 + 120) + 120 + f(3) + f(4));
    expect(sv.cards).toEqual({ recall: card(2), sticky: card(0), light: card(1) });
    const once = sv.cash;
    repairV6(sv);
    expect(sv.cash).toBe(once);
    expect(importSave(exportSave(sv))).toEqual(sv);
  });
  it('a fresh save never gets free portals', () => {
    const sv = newSave();
    expect(sv.hints.islandsV6).toBe(true);
    sv.unlocked = 8;
    const r = importSave(exportSave(sv))!;
    expect(r.levels).toEqual({});
  });
});

describe('save', () => {
  it('bankRun: bestWave, unlock, tokens by tokenId, bestLoot, teeth', () => {
    const sv = newSave();
    bankRun(sv, run({ wave: 3 }));
    expect(sv.bestWave.w1s1).toBe(2);
    bankRun(sv, run({ wave: 2 }));
    expect(sv.bestWave.w1s1).toBe(2);
    let unlocks = 0;
    for (let i = 0; i < 4; i++) {
      const r = bankRun(sv, run({ bossKilled: true, cash: 10, tokens: i === 0 ? 3 : 1, loot: 40 + i, tooth: i === 1, kills: 4, shots: 3, wave: 4 }));
      expect(r.tokenId).toBe('stripe');
      expect(r.tokens).toBe(i === 0 ? 3 : 1);
      if (r.unlocked) { unlocks++; expect(r.unlocked).toBe('w1s2'); }
    }
    expect(unlocks).toBe(1);
    expect(sv.unlocked).toBe(1);
    expect(sv.bossKills.w1s1).toBe(4);
    expect(sv.tokens.stripe).toBe(6);
    expect(sv.bestLoot.w1s1).toBe(43);
    bankRun(sv, run({ bossKilled: true, loot: 5 }));
    expect(sv.bestLoot.w1s1).toBe(43);
    expect(sv.stats.teeth).toBe(1);
    expect(sv.bestWave.w1s1).toBe(4);
    expect(sv.stats.runs).toBe(7);
    bankRun(sv, run({ stage: 'w2s1', tokenId: 'frost', tokens: 1, wave: 2 }));
    expect(sv.tokens.frost).toBe(1);
    expect(sv.tokens.stripe).toBe(6);
  });
  it('export/import', () => {
    const sv = newSave();
    sv.cash = 42;
    sv.levels.damage = 3;
    expect(importSave(exportSave(sv))).toEqual(sv);
    expect(importSave('!!!garbage')).toBeNull();
    expect(importSave(btoa('[1,2]'))).toBeNull();
    expect(importSave(btoa('{"foo":1}'))).toBeNull();
    expect(importSave(btoa('{"cash":5}'))?.settings.sound).toBe(true);
  });
  it('migrates v2: no refund, clear levels, re-key stages, drop v2 key', () => {
    store.set('ballblaster.save.v2', JSON.stringify({
      version: 1, cash: 100, emeralds: 2, levels: { damage: 3, maxHp: 1, bumpers: 2, ice_master: 1, bogus: 4 }, unlocked: 1, current: 'ice',
      bestWave: { felt: 4, ice: 2 }, bossKills: { felt: 3 }, ballType: 'heavy', settings: { sound: false, shake: true, flash: true },
      hints: { shotTaught: true }, stats: { runs: 9, kills: 8, shots: 7 },
    }));
    const sv = loadSave();
    expect(sv.cash).toBe(100); // wallet carries over; spent upgrades are NOT refunded (the tree is a grind)
    expect(sv.tokens.stripe).toBe(2);
    expect(sv.cards).toEqual({});
    expect(sv.levels).toEqual({ portal_w2: 1 }); // unlocked 4: the M2 repair grants the Ice Cavern portal
    expect(sv.current).toBe('w2s1');
    expect(sv.unlocked).toBe(4);
    expect(sv.bestWave).toEqual({ w1s1: 4, w2s1: 2 });
    expect(sv.bossKills).toEqual({ w1s1: 3 });
    expect(sv.loadout.ball).toBe('standard');
    expect(sv.settings.sound).toBe(false);
    expect(sv.hints.shotTaught).toBe(true);
    expect(sv.stats.runs).toBe(9);
    expect(store.has('ballblaster.save.v2')).toBe(false);
    expect(store.has('ballblaster.save.v4')).toBe(true);
    expect(store.has('ballblaster.save.v3')).toBe(false);
    expect(loadSave().cash).toBe(sv.cash);
  });
});

describe('save v4 and migration from v3', () => {
  const v3 = (o: Record<string, unknown>) => ({ version: 1, ...o });
  const migrate = (o: Record<string, unknown>) => importSave(btoa(JSON.stringify(v3(o))))!;
  const zero = { stripe: 0, frost: 0, cog: 0, pearl: 0, ember: 0, house: 0 };

  it('newSave has the full v4 shape', () => {
    const sv = newSave();
    expect(sv.version).toBe(4);
    expect(sv.tokens).toEqual(zero);
    expect(sv.cards).toEqual({});
    expect(sv.bestLoot).toEqual({});
    expect(sv.stats.teeth).toBe(0);
    expect(sv.loadout.ball).toBe('standard');
    expect('emeralds' in sv).toBe(false);
    expect('ballType' in sv).toBe(false);
  });
  it("owner's v3 export: emeralds become stripe tokens, cash and levels kept", () => {
    const sv = migrate({ cash: 60, emeralds: 12, levels: { damage: 2, maxHp: 2 }, unlocked: 4, bossKills: { w1s1: 4 } });
    expect(sv.version).toBe(4);
    expect(sv.tokens).toEqual({ ...zero, stripe: 12 });
    expect(sv.cards).toEqual({});
    expect(sv.cash).toBe(60);
    expect(sv.levels).toEqual({ damage: 2, maxHp: 2, portal_w2: 1 }); // repairV6: unlocked 4 -> the Ice Cavern portal, nothing else
    expect(sv.unlocked).toBe(4);
    expect(sv.bossKills).toEqual({ w1s1: 4 });
    expect(sv.bestLoot).toEqual({});
    expect(sv.stats.teeth).toBe(0);
    expect('emeralds' in sv).toBe(false);
  });
  it('emeralds split by share of boss kills, remainder to stripe; loops count for their world', () => {
    const a = migrate({ emeralds: 10, bossKills: { w1s1: 1, w2s1: 2 } });
    expect(a.tokens).toEqual({ ...zero, stripe: 4, frost: 6 });
    const b = migrate({ emeralds: 7, bossKills: { w1s4: 1, l1w3s4: 1, w3s4: 1 } });
    expect(b.tokens.stripe + b.tokens.cog).toBe(7);
    expect(b.tokens.cog).toBe(4);
    expect(migrate({ emeralds: 5, bossKills: {} }).tokens.stripe).toBe(5);
  });
  it('gear levels become cards; lightning / split / spitter fold to min(3, L-1) with refunds', () => {
    const sv = migrate({
      cash: 0, ballType: 'heavy',
      levels: { break: 1, break_lv: 1, poison: 1, lightning: 5, spitter: 3, split: 3, ballHeavy: 1, jump_lv: 2, damage: 2, strayEmerald: 3 },
      unlocked: 4,
    });
    expect(sv.cards.break).toEqual(card(1));
    expect(sv.cards.poison).toEqual(card(0));
    expect(sv.cards.lightning.level).toBe(3);
    expect(sv.cards.spitter.level).toBe(2);
    expect(sv.cards.split.level).toBe(2);
    expect(sv.cards.heavy).toEqual(card(0));
    expect(sv.cards.jump).toBeUndefined(); // _lv without the unlock is dropped
    expect(sv.loadout.ball).toBe('heavy');
    expect(sv.cash).toBe(1253);
    expect(sv.levels).toEqual({ damage: 2, portal_w2: 1 });
    // the node view reads the card back
    expect(buildStats(sv).ballType).toBe('heavy');
    const lv5 = migrate({ levels: { spitter: 5 } });
    expect(lv5.cash).toBe(2624);
    expect(lv5.cards.spitter.level).toBe(3);
  });
  it('ball type without the card falls back to standard', () => {
    expect(migrate({ ballType: 'sticky', levels: {} }).loadout.ball).toBe('standard');
  });
  it('migration is idempotent and round-trips through export/import', () => {
    const sv = migrate({ cash: 5, emeralds: 9, levels: { break: 1, break_lv: 1, lightning: 5, ballLight: 1 }, ballType: 'light', unlocked: 4, bossKills: { w1s1: 1, w2s1: 1 } });
    const again = importSave(exportSave(sv))!;
    expect(again).toEqual(sv);
    expect(importSave(exportSave(again))).toEqual(sv);
    expect(again.cash).toBe(5 + 1253);
    expect(again.tokens.stripe + again.tokens.frost).toBe(9);
  });
  it('loadSave migrates the v3 key, writes v4, removes v3', () => {
    store.set('ballblaster.save.v3', JSON.stringify(v3({ cash: 60, emeralds: 12, levels: { damage: 2 }, unlocked: 4, bossKills: { w1s1: 4 } })));
    const sv = loadSave();
    expect(sv.tokens.stripe).toBe(12);
    expect(store.has('ballblaster.save.v3')).toBe(false);
    expect(store.has('ballblaster.save.v4')).toBe(true);
    expect(loadSave()).toEqual(sv);
  });
  it('sanitize rejects other versions and repairs bad v4 fields', () => {
    expect(importSave(btoa(JSON.stringify({ version: 3, cash: 1 })))).toBeNull();
    const bad = importSave(btoa(JSON.stringify({
      version: 4, cash: 3, tokens: { stripe: 2.7, frost: -1, zzz: 4 }, cards: { break: { level: 9, fork: 'x' }, nope: {} }, loadout: { ball: 'heavy' },
    })))!;
    expect(bad.tokens).toEqual({ ...zero, stripe: 2 });
    expect(bad.cards).toEqual({ break: card(3) });
    expect(bad.loadout.ball).toBe('standard');
  });
  it('buildStats sets tokenId from the stage world (loops reuse it) and empty mods', () => {
    const sv = newSave();
    expect(buildStats(sv).tokenId).toBe('stripe');
    sv.current = 'w2s1';
    expect(buildStats(sv).tokenId).toBe('frost');
    sv.current = 'l1w3s4';
    expect(buildStats(sv).tokenId).toBe('cog');
    sv.current = 'w6s2';
    expect(buildStats(sv).tokenId).toBe('house');
    expect(buildStats(sv).mods).toEqual([]);
    const ids: TokenId[] = TOKEN_OF_WORLD;
    expect(ids.length).toBe(6);
  });
});

describe('loadSave persists the island repair', () => {
  it('an M1 v4 save is repaired once and written back', () => {
    store.set('ballblaster.save.v4', JSON.stringify({ ...newSave(), hints: {}, unlocked: 4, levels: { damage: 1 } }));
    const sv = loadSave();
    expect(sv.levels.portal_w2).toBe(1);
    expect(JSON.parse(store.get('ballblaster.save.v4')!).hints.islandsV6).toBe(true);
    expect(loadSave()).toEqual(sv);
  });
});
