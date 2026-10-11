import { BASE_STATS } from '../core/tuning';
import type { RunStats, SaveData } from '../core/types';
import { GLOBAL_NODES, NODES } from './upgrades';

export function nodeLevel(save: SaveData, id: string): number {
  const v = save.levels[id];
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

const BALL_NODE = { heavy: 'ballHeavy', light: 'ballLight', sticky: 'ballSticky' } as const;

export function buildStats(save: SaveData): RunStats {
  const s: RunStats = { ...BASE_STATS };
  const stageTree = `stage:${save.current}`;
  for (const n of NODES) {
    const l = Math.min(nodeLevel(save, n.id), n.maxLevel);
    if (l <= 0) continue;
    if (n.tree.startsWith('stage:') && n.tree !== stageTree && !GLOBAL_NODES.has(n.id)) continue;
    n.apply(s, l);
  }
  const bt = save.ballType;
  s.ballType = bt !== 'standard' && nodeLevel(save, BALL_NODE[bt]) > 0 ? bt : 'standard';
  return s;
}
