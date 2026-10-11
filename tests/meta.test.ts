import { describe, expect, it } from 'vitest';
import { BASE_STATS } from '../src/core/tuning';
import type { RunResult } from '../src/core/types';
import { NODES, bankRun, buildStats, buy, buyState, exportSave, importSave, newSave, nextCost } from '../src/meta';

const node = (id: string) => NODES.find((n) => n.id === id)!;
const run = (o: Partial<RunResult> = {}): RunResult => ({
  stage: 'felt', cash: 0, emeralds: 0, kills: 0, wave: 1, wavesCleared: 0, overtimeWaves: 0, bossKilled: false, shots: 0, bestCombo: 0, seconds: 0, ...o,
});

describe('meta', () => {
  it('base stats', () => {
    const s = buildStats(newSave());
    expect(s).toEqual(BASE_STATS);
    expect(s).not.toBe(BASE_STATS);
  });
  it('buy maxHp', () => {
    const sv = newSave();
    sv.cash = 6;
    expect(buy(sv, node('maxHp'))).toBe(true);
    expect(buildStats(sv).maxHp).toBe(BASE_STATS.maxHp + 5);
    expect(buyState(sv, node('armor'))).toBe('poor');
  });
  it('requires chain', () => {
    const sv = newSave();
    sv.cash = 1e6;
    expect(buyState(sv, node('heavyHits'))).toBe('locked');
    expect(buyState(sv, node('reflex'))).toBe('locked');
    sv.levels.aim = 1;
    expect(buyState(sv, node('heavyHits'))).toBe('ok');
    expect(buyState(sv, node('comboLockdown'))).toBe('locked');
  });
  it('bankRun bestWave', () => {
    const sv = newSave();
    bankRun(sv, run({ wave: 3 }));
    expect(sv.bestWave.felt).toBe(2);
    bankRun(sv, run({ wave: 2 }));
    expect(sv.bestWave.felt).toBe(2);
    bankRun(sv, run({ wave: 4, bossKilled: true }));
    expect(sv.bestWave.felt).toBe(4);
  });
  it('apply touches only RunStats fields', () => {
    for (const n of NODES) {
      const s = { ...BASE_STATS };
      n.apply(s, n.maxLevel);
      expect(Object.keys(s).sort(), n.id).toEqual(Object.keys(BASE_STATS).sort());
      for (const v of Object.values(s)) expect(v).not.toBeUndefined();
    }
  });
  it('buy damage', () => {
    const sv = newSave();
    sv.cash = 5;
    expect(buy(sv, node('damage'))).toBe(true);
    expect(sv.cash).toBe(0);
    expect(buildStats(sv).damage).toBe(2);
  });
  it('fails poor / maxed / locked', () => {
    const sv = newSave();
    expect(buy(sv, node('damage'))).toBe(false);
    expect(buyState(sv, node('damage'))).toBe('poor');
    sv.cash = 1e6;
    expect(buyState(sv, node('speed'))).toBe('locked');
    for (let i = 0; i < 12; i++) expect(buy(sv, node('damage'))).toBe(true);
    expect(buyState(sv, node('damage'))).toBe('maxed');
    expect(nextCost(sv, node('damage'))).toBeNull();
    expect(buy(sv, node('damage'))).toBe(false);
    expect(buyState(sv, node('speed'))).toBe('ok');
    expect(buyState(sv, node('ice_thaw'))).toBe('locked');
    sv.unlocked = 1;
    expect(buyState(sv, node('ice_thaw'))).toBe('ok');
  });
  it('stage nodes only apply on their stage; capstone global', () => {
    const sv = newSave();
    sv.unlocked = 1;
    sv.levels = { ice_thaw: 2, ice_grip: 2, ice_master: 1 };
    expect(buildStats(sv).damage).toBe(1);
    expect(buildStats(sv).massMult).toBe(1.25);
    sv.current = 'ice';
    expect(buildStats(sv).damage).toBe(3);
  });
  it('capstone needs maxed prereqs', () => {
    const sv = newSave();
    sv.cash = 1e6;
    sv.levels = { felt_nap: 1, felt_change: 3 };
    expect(buyState(sv, node('felt_master'))).toBe('locked');
    sv.levels.felt_nap = 2;
    expect(buyState(sv, node('felt_master'))).toBe('ok');
  });
  it('ball type needs unlock', () => {
    const sv = newSave();
    sv.ballType = 'heavy';
    expect(buildStats(sv).ballType).toBe('standard');
    sv.levels.ballHeavy = 1;
    expect(buildStats(sv).ballType).toBe('heavy');
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
  it('bankRun', () => {
    const sv = newSave();
    const em = [];
    let unlocks = 0;
    for (let i = 0; i < 5; i++) {
      const r = bankRun(sv, run({ bossKilled: true, cash: 10, emeralds: 1, kills: 4, shots: 3, wave: 4 }));
      em.push(r.bossEmeralds);
      if (r.unlocked) { unlocks++; expect(r.unlocked).toBe('ice'); }
    }
    expect(em).toEqual([5, 3, 2, 2, 1]);
    expect(unlocks).toBe(1);
    expect(sv.unlocked).toBe(1);
    expect(sv.cash).toBe(50);
    expect(sv.emeralds).toBe(5 + 13);
    expect(sv.bossKills.felt).toBe(5);
    expect(sv.stats).toEqual({ runs: 5, kills: 20, shots: 15 });
    expect(sv.bestWave.felt).toBe(4);
  });
  it('node data sanity', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    const pos = new Set<string>();
    for (const n of NODES) {
      expect(n.name.length).toBeLessThanOrEqual(12);
      expect(n.desc.length).toBeLessThanOrEqual(20);
      for (const r of n.requires ?? []) expect(ids.has(r)).toBe(true);
      for (let l = 0; l < n.maxLevel; l++) {
        const c = n.cost(l);
        expect(Number.isInteger(c) && c > 0).toBe(true);
      }
      const k = `${n.tree}:${n.pos.col}:${n.pos.row}`;
      expect(pos.has(k)).toBe(false);
      pos.add(k);
      expect(n.pos.col).toBeGreaterThanOrEqual(0);
      expect(n.pos.col).toBeLessThanOrEqual(3);
    }
    for (const t of ['power', 'vitality', 'tactics', 'combo']) {
      const root = NODES.find((n) => n.tree === t && !n.requires)!;
      expect(root.cost(0)).toBeLessThanOrEqual(40);
    }
    for (const id of ['damage', 'maxHp']) expect(node(id).cost(0)).toBeLessThanOrEqual(15);
  });
});
