import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_STATS, CASH_GROWTH } from '../src/core/tuning';
import { CAPSTONE_NEEDS, MULT_IDS } from '../src/meta/upgrades';
import type { RunResult, SaveData } from '../src/core/types';
import {
  NODES, ROOT_ID, bankRun, buildStats, buy, buyState, distanceFromOwned, exportSave, importSave, isReachable, loadSave, newSave, nextCost,
  nodesFor, pathToOwned, cueSlotOpen, equip, gearOwned, ownedGear, relicSlots, trickSlotOpen, unequip,
} from '../src/meta';

const node = (id: string, sv: SaveData = newSave()) => nodesFor(sv).find((n) => n.id === id)!;
const run = (o: Partial<RunResult> = {}): RunResult => ({
  stage: 'w1s1', cash: 0, emeralds: 0, kills: 0, wave: 1, wavesCleared: 0, overtimeWaves: 0, bossKilled: false, shots: 0, bestCombo: 0, seconds: 0, ...o,
});

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('tree structure', () => {
  const all = nodesFor({ ...newSave(), unlocked: 48 });
  it('unique ids, valid links, all reachable from root', () => {
    const ids = new Set(all.map((n) => n.id));
    expect(ids.size).toBe(all.length);
    const adj = new Map<string, string[]>(all.map((n) => [n.id, []]));
    for (const n of all) for (const l of n.links) {
      expect(ids.has(l), `${n.id}->${l}`).toBe(true);
      adj.get(n.id)!.push(l);
      adj.get(l)!.push(n.id);
    }
    const seen = new Set([ROOT_ID]);
    const q = [ROOT_ID];
    while (q.length) for (const nb of adj.get(q.pop()!)!) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
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
      if (n.id === ROOT_ID) continue;
      for (let l = 0; l < n.maxLevel; l++) expect(Number.isInteger(n.cost(l)) && n.cost(l) > 0, `${n.id} L${l}`).toBe(true);
    }
    const core = all.filter((n) => n.graft === undefined && n.loop === undefined && n.id !== ROOT_ID);
    for (const n of core) expect(n.ring).toBeGreaterThanOrEqual(1), expect(n.ring).toBeLessThanOrEqual(3);
    expect(core.length).toBeGreaterThanOrEqual(28);
  });
  it('apply touches only RunStats fields', () => {
    for (const n of all) {
      const s = { ...BASE_STATS };
      n.apply(s, n.maxLevel);
      expect(Object.keys(s).sort(), n.id).toEqual(Object.keys(BASE_STATS).sort());
    }
  });
  it('root is always owned', () => {
    const sv = newSave();
    expect(distanceFromOwned(sv, ROOT_ID)).toBe(0);
    expect(buy(sv, node(ROOT_ID))).toBe(false);
    expect(node(ROOT_ID).cost(0)).toBe(0);
    expect(NODES.length).toBeGreaterThan(30);
  });
});

describe('purchasing', () => {
  it('fresh save: only ring-1 purchasable', () => {
    const sv = newSave();
    sv.cash = 1e9;
    sv.emeralds = 1e9;
    const ok = nodesFor(sv).filter((n) => buyState(sv, n) === 'ok').map((n) => n.id).sort();
    expect(ok).toEqual(['aim', 'damage', 'maxHp']);
    expect(nodesFor(sv).filter((n) => n.ring === 1).map((n) => n.id).sort()).toEqual(["aim", "damage", "maxHp"]);
  });
  it('adjacency gating and poor/maxed', () => {
    const sv = newSave();
    expect(buyState(sv, node('damage'))).toBe('poor');
    sv.cash = 1e6;
    expect(buyState(sv, node('lightning'))).toBe('locked');
    expect(isReachable(sv, 'lightning')).toBe(false);
    for (let i = 0; i < 5; i++) expect(buy(sv, node('damage'))).toBe(true);
    expect(buyState(sv, node('damage'))).toBe('maxed');
    expect(nextCost(sv, node('damage'))).toBeNull();
    expect(buy(sv, node('damage'))).toBe(false);
    expect(buyState(sv, node('lightning'))).toBe('ok');
    expect(buildStats(sv).damage).toBe(BASE_STATS.damage + 5);
  });
  it('disclosure distances and path', () => {
    const sv = newSave();
    expect(distanceFromOwned(sv, 'damage')).toBe(1);
    expect(distanceFromOwned(sv, 'lightning')).toBe(2);
    expect(distanceFromOwned(sv, 'spitter')).toBe(4);
    expect(buyState(sv, node('lightning'))).toBe('locked');
    expect(buyState(sv, node('split'))).toBe('hidden');
    expect(pathToOwned(sv, 'lightning')).toEqual([ROOT_ID, 'damage', 'lightning']);
    sv.levels.damage = 1;
    expect(distanceFromOwned(sv, 'damage')).toBe(0);
    expect(pathToOwned(sv, 'split')).toEqual(['damage', 'lightning', 'split']);
    expect(buyState(sv, node('split'))).toBe('locked');
  });
  it('ball type needs unlock', () => {
    const sv = newSave();
    sv.ballType = 'heavy';
    expect(buildStats(sv).ballType).toBe('standard');
    sv.levels.ballHeavy = 1;
    expect(buildStats(sv).ballType).toBe('heavy');
  });
});

describe('grafts', () => {
  const ownAround = (sv: SaveData, id: string) => {
    for (const n of nodesFor(sv)) if (n.links.includes(id)) sv.levels[n.id] = 1;
    for (const l of node(id).links) sv.levels[l] = 1;
  };
  it('world 1 revealed; others locked until the boss dies', () => {
    const sv = newSave();
    sv.cash = 1e9;
    ownAround(sv, 'g2_counter');
    expect(buyState(sv, node('g2_counter'))).toBe('locked');
    sv.bossKills.w2s1 = 1;
    expect(buyState(sv, node('g2_counter'))).toBe('ok');
    ownAround(sv, 'g1_counter');
    expect(buyState(sv, node('g1_counter'))).toBe('ok');
  });
  it('capstone needs siblings maxed', () => {
    const sv = newSave();
    sv.cash = 1e9;
    sv.levels = { thickSkin: 1, g1_counter: 3, g1_cash: 5, g1_dmg: 8, g1_hp: 7 };
    expect(buyState(sv, node('g1_cap'))).toBe('locked');
    sv.levels.g1_hp = 8;
    expect(buyState(sv, node('g1_cap'))).toBe('ok');
    expect(buy(sv, node('g1_cap'))).toBe(true);
    expect(buildStats(sv).maxHp).toBe(Math.round((BASE_STATS.maxHp + 6 + 5) * 1.96));
  });
  it('counter/cash nodes apply only on their world; graft cost scales', () => {
    const sv = newSave();
    sv.levels = { g2_counter: 2, g2_cash: 2 };
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp);
    sv.current = 'w2s3';
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp + 4);
    expect(buildStats(sv).cashMult).toBeCloseTo(1.1);
    sv.current = 'l1w2s1';
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp + 4);
    expect(node('g3_counter').cost(0) / node('g2_counter').cost(0)).toBeCloseTo(CASH_GROWTH ** 4, 1);
  });
});

describe('graft shape', () => {
  it('six nodes per graft with fixed ids, all reachable, capstone gated by four siblings', () => {
    for (let w = 1; w <= 6; w++) {
      const ids = ['counter', 'cash', 'dmg', 'hp', 'grit', 'cap'].map((k) => `g${w}_${k}`);
      const own = NODES.filter((n) => n.graft === w).map((n) => n.id);
      expect(own.sort()).toEqual([...ids].sort());
      expect(CAPSTONE_NEEDS.get(`g${w}_cap`)).toEqual(ids.filter((i) => !/grit|cap/.test(i)));
      expect(MULT_IDS.has(`g${w}_dmg`) && MULT_IDS.has(`g${w}_hp`)).toBe(true);
      const sv = newSave();
      for (const id of ids.filter((i) => !/grit|cap/.test(i))) sv.levels[id] = 1;
      for (const id of ids) {
        const reach = new Set<string>(['hero']);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of NODES) if (!reach.has(n.id) && (n.links.some((l) => reach.has(l)) || NODES.some((m) => reach.has(m.id) && m.links.includes(n.id)))) { reach.add(n.id); grew = true; }
        }
        expect(reach.has(id)).toBe(true);
      }
    }
  });
  it('levels and grit', () => {
    expect(node('g3_dmg').maxLevel).toBe(8);
    expect(node('g3_hp').maxLevel).toBe(8);
    expect(node('g3_grit').maxLevel).toBe(4);
    expect(node('g3_grit').name).toBe('GRIT IV');
    expect(node('g3_grit').links).toEqual(['g3_hp']);
    const sv = newSave();
    sv.levels = { g1_grit: 1 };
    expect(buildStats(sv).armor).toBe(BASE_STATS.armor + 1);
    sv.levels = { g1_grit: 3 };
    expect(buildStats(sv).maxHp).toBe(Math.round(BASE_STATS.maxHp * 1.08));
  });
  it('prices use CASH_GROWTH; dmg/hp tiers apply after flat nodes', () => {
    expect(node('g4_dmg').cost(0)).toBe(Math.round(300 * CASH_GROWTH ** 12));
    expect(node('g1_dmg').name).toBe('DAMAGE II');
    expect(node('g2_hp').name).toBe('MAX HP III');
    expect(node('l1_power_a').cost(0)).toBe(Math.round(300 * CASH_GROWTH ** 28));
    const sv = newSave();
    sv.levels = { g1_hp: 8, g1_counter: 3 };
    expect(buildStats(sv).maxHp).toBe(Math.round((BASE_STATS.maxHp + 6) * 1.96));
  });
});

describe('loops and multipliers', () => {
  it('loop rings appear with the loop', () => {
    const sv = newSave();
    expect(nodesFor(sv).some((n) => n.loop === 1)).toBe(true);
    expect(nodesFor(sv).some((n) => n.loop === 2)).toBe(false);
    sv.unlocked = 24;
    expect(nodesFor(sv).some((n) => n.loop === 2)).toBe(true);
    expect(nodesFor(sv).some((n) => n.loop === 3)).toBe(false);
    const a = nodesFor(sv).find((n) => n.id === 'l1_power_a')!;
    expect(a.links).toContain('g5_dmg');
    expect(a.cost(0)).toBeGreaterThan(node('g6_dmg').cost(0));
  });
  it('percent nodes multiply after flat nodes', () => {
    const sv = newSave();
    sv.levels = { damage: 5, g5_dmg: 8 };
    expect(buildStats(sv).damage).toBe(Math.round((BASE_STATS.damage + 5) * 1.96));
    sv.levels.g5_cap = 1; // +2 flat damage, still before the percent
    expect(buildStats(sv).damage).toBe(Math.round((BASE_STATS.damage + 7) * 1.96));
  });
});

describe('save', () => {
  it('bankRun bestWave, unlock and emeralds', () => {
    const sv = newSave();
    bankRun(sv, run({ wave: 3 }));
    expect(sv.bestWave.w1s1).toBe(2);
    bankRun(sv, run({ wave: 2 }));
    expect(sv.bestWave.w1s1).toBe(2);
    const em: number[] = [];
    let unlocks = 0;
    for (let i = 0; i < 4; i++) {
      const r = bankRun(sv, run({ bossKilled: true, cash: 10, emeralds: 1, kills: 4, shots: 3, wave: 4 }));
      em.push(r.bossEmeralds);
      if (r.unlocked) { unlocks++; expect(r.unlocked).toBe('w1s2'); }
    }
    expect(unlocks).toBe(1);
    expect(sv.unlocked).toBe(1);
    expect(sv.bossKills.w1s1).toBe(4);
    expect(em[0]).toBeGreaterThanOrEqual(em[3]);
    expect(sv.bestWave.w1s1).toBe(4);
    expect(sv.stats.runs).toBe(6);
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
    expect(sv.emeralds).toBe(2);
    expect(sv.levels).toEqual({});
    expect(sv.current).toBe('w2s1');
    expect(sv.unlocked).toBe(4);
    expect(sv.bestWave).toEqual({ w1s1: 4, w2s1: 2 });
    expect(sv.bossKills).toEqual({ w1s1: 3 });
    expect(sv.ballType).toBe('standard');
    expect(sv.settings.sound).toBe(false);
    expect(sv.hints.shotTaught).toBe(true);
    expect(sv.stats.runs).toBe(9);
    expect(store.has('ballblaster.save.v2')).toBe(false);
    expect(store.has('ballblaster.save.v3')).toBe(true);
    expect(loadSave().cash).toBe(sv.cash);
  });
});

describe('gear', () => {
  const GEAR: Record<string, [number, number]> = {
    break: [1, -1], jump: [2, -3], draw: [2, -4], follow: [2, -5],
    poison: [-1, -1], chill: [-4, -3], static: [-4, -4], ricochet: [-4, -5], lantern: [-4, -6],
    explosive: [1, 1], shrapnel: [3, 2], momentum: [4, 3], thorns: [4, 4], mirror: [4, 5],
    recall: [-1, 1], shockwave: [-3, 2], rackEm: [-4, 3], timeStop: [-4, 4],
  };
  const price: Record<string, number> = { break: 3, jump: 5, draw: 6, follow: 8, poison: 3, explosive: 3, recall: 10, shockwave: 10, rackEm: 12, timeStop: 15 };
  const owns = (sv: SaveData, ...ids: string[]) => { for (const i of ids) sv.levels[i] = 1; };

  it('gear nodes: emerald keystones at fixed cells, level nodes behind them', () => {
    for (const [id, [gx, gy]] of Object.entries(GEAR)) {
      const n = node(id);
      expect([id, (n.x - 320) / 40, (n.y - 320) / 40]).toEqual([id, gx, gy]);
      expect(n.kind).toBe('keystone');
      expect(n.currency).toBe('emerald');
      expect(n.maxLevel).toBe(1);
      if (price[id]) expect(n.cost(0)).toBe(price[id]);
      const lv = node(`${id}_lv`);
      expect(lv.links).toEqual([id]);
      expect(lv.currency).toBe('cash');
      expect(lv.maxLevel).toBe(['break', 'jump', 'draw', 'follow'].includes(id) ? 1 : 2);
      const s = { ...BASE_STATS };
      lv.apply(s, 1);
      expect(s.gearLevel[id]).toBe(1);
      expect(BASE_STATS.gearLevel).toEqual({});
    }
    for (const id of ['lightning', 'split', 'spitter']) expect(node(id).maxLevel).toBeGreaterThan(1);
  });
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
  it('equip / unequip validate ownership and slots', () => {
    const sv = newSave();
    expect(equip(sv, 'relic', 'poison')).toBe(false);
    expect(equip(sv, 'cue', 'break')).toBe(false);
    expect(equip(sv, 'cue', 'standard')).toBe(true);
    owns(sv, 'poison', 'chill', 'static', 'break', 'recall', 'bogus');
    expect(gearOwned(sv, 'poison')).toBe(true);
    expect(gearOwned(sv, 'bogus')).toBe(false);
    expect(ownedGear(sv)).toEqual({ cues: ['break'], relics: ['poison', 'chill', 'static'], tricks: ['recall'] });
    expect(equip(sv, 'relic', 'poison')).toBe(true);
    expect(equip(sv, 'relic', 'chill')).toBe(false); // one slot
    expect(equip(sv, 'relic', 'chill', 1)).toBe(false);
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
  });
  it('buildStats gates lightning / split / spitter on equipped', () => {
    const sv = newSave();
    sv.unlocked = 4;
    owns(sv, 'lightning', 'split', 'spitter');
    const off = buildStats(sv);
    expect([off.lightningChance, off.splitCount, off.spitInterval]).toEqual([0, 0, 0]);
    expect(off.relics).toEqual([]);
    expect(equip(sv, 'relic', 'lightning')).toBe(true);
    expect(equip(sv, 'relic', 'spitter')).toBe(true);
    const on = buildStats(sv);
    expect(on.lightningChance).toBeGreaterThan(0);
    expect(on.spitInterval).toBeGreaterThan(0);
    expect(on.splitCount).toBe(0);
    expect(on.relics).toEqual(['lightning', 'spitter']);
    sv.unlocked = 0; // slots shrink -> truncated
    expect(buildStats(sv).relics).toEqual(['lightning']);
  });
  it('buildStats: cue, trick, uses, gearLevel, break kills aim preview', () => {
    const sv = newSave();
    sv.unlocked = 4;
    sv.levels.aim = 3;
    owns(sv, 'break', 'shockwave', 'poison');
    sv.levels.shockwave_lv = 1;
    sv.levels.poison_lv = 2;
    sv.loadout = { cue: 'break', relics: ['poison'], trick: 'shockwave' };
    const s = buildStats(sv);
    expect(s.cue).toBe('break');
    expect(s.aimPreview).toBe(0);
    expect(s.trick).toBe('shockwave');
    expect(s.trickUses).toBe(3);
    expect(s.gearLevel).toEqual({ poison: 2, shockwave: 1, break: 0 });
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
    expect(a.loadout).toEqual({ cue: 'standard', relics: ['lightning', 'split', 'spitter'], trick: null });
    a.loadout.relics = [];
    expect(importSave(exportSave(a))!.loadout.relics).toEqual([]); // deliberate unequip sticks
    sv.unlocked = 0;
    expect(importSave(exportSave(sv))!.loadout.relics).toEqual(['lightning']); // truncated to slots
  });
  it('sanitize drops unowned gear and truncates', () => {
    const sv = { ...newSave(), unlocked: 4, levels: { poison: 1, chill: 1, static: 1, break: 1 } } as SaveData;
    (sv as unknown as { loadout: unknown }).loadout = { cue: 'jump', relics: ['poison', 'poison', 'lantern', 'chill', 'static', 'nope'], trick: 'recall' };
    const r = importSave(exportSave(sv))!;
    expect(r.loadout).toEqual({ cue: 'standard', relics: ['poison', 'chill'], trick: null });
    (sv as unknown as { loadout: unknown }).loadout = 7;
    expect(importSave(exportSave(sv))!.loadout).toEqual({ cue: 'standard', relics: [], trick: null });
    expect(newSave().loadout).toEqual({ cue: 'standard', relics: [], trick: null });
  });
  it('chain entries are buyable with first emeralds, no Bumpers/Split needed', () => {
    const sv = newSave();
    sv.emeralds = 0;
    owns(sv, 'damage', 'maxHp', 'aim', 'speed', 'heavyHits', 'comboChain', 'armor', 'mass');
    for (const id of ['break', 'poison', 'explosive', 'recall']) expect(buyState(sv, node(id)), id).toBe('poor');
    sv.emeralds = 3;
    for (const id of ['break', 'poison', 'explosive']) expect(buyState(sv, node(id)), id).toBe('ok');
  });
  it('gear unlock reachable by buying along the tree', () => {
    const sv = newSave();
    sv.emeralds = 100;
    sv.cash = 1e9;
        buy(sv, node('damage'));
    expect(buyState(sv, node('break'))).toBe('ok');
    expect(buy(sv, node('break'))).toBe(true);
    expect(buy(sv, node('break_lv'))).toBe(true);
    expect(buyState(sv, node('jump'))).toBe('ok');
  });
});
