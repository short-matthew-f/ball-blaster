import { BASE_STATS } from '../core/tuning';
import type { RunStats, SaveData } from '../core/types';
import { nodesFor } from './tree';
import { MULT_IDS, WORLD_ONLY } from './upgrades';

export function nodeLevel(save: SaveData, id: string): number {
  const v = save.levels[id];
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

const BALL_NODE = { heavy: 'ballHeavy', light: 'ballLight', sticky: 'ballSticky' } as const;

/** World index of a stage id ('w2s1', 'l1w3s4'); 0 if unparseable. */
export function worldOf(stage: string): number {
  const m = /^(?:l\d+)?w(\d)s\d$/.exec(stage);
  return m ? Number(m[1]) : 0;
}

export function buildStats(save: SaveData): RunStats {
  const s: RunStats = { ...BASE_STATS };
  const world = worldOf(save.current);
  const nodes = nodesFor(save);
  let mult = false;
  for (const pass of [false, true]) {
    for (const n of nodes) {
      if (MULT_IDS.has(n.id) !== pass) continue;
      const l = Math.min(nodeLevel(save, n.id), n.maxLevel);
      if (l <= 0) continue;
      const w = WORLD_ONLY.get(n.id);
      if (w !== undefined && w !== world) continue;
      n.apply(s, l);
      if (pass) mult = true;
    }
  }
  if (mult) {
    s.damage = Math.max(1, Math.round(s.damage));
    s.maxHp = Math.round(s.maxHp);
    s.waveHeal = Math.round(s.waveHeal);
  }
  const bt = save.ballType;
  s.ballType = bt !== 'standard' && nodeLevel(save, BALL_NODE[bt]) > 0 ? bt : 'standard';
  return s;
}
