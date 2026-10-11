import { EMERALD_REPEAT_DECAY, STAGES } from '../core/tuning';
import type { RunResult, SaveData, StageId, UpgradeNode } from '../core/types';
import { exportSave, importSave, loadSave, newSave, writeSave } from './save';
import { buildStats, nodeLevel } from './stats';
import { NODES, REQUIRES_MAXED, STAGE_TREE_INDEX } from './upgrades';

export { NODES, newSave, loadSave, writeSave, exportSave, importSave, buildStats, nodeLevel };

export function nextCost(save: SaveData, node: UpgradeNode): number | null {
  const l = nodeLevel(save, node.id);
  return l >= node.maxLevel ? null : node.cost(l);
}

export function buyState(save: SaveData, node: UpgradeNode): 'ok' | 'locked' | 'maxed' | 'poor' {
  const need = STAGE_TREE_INDEX[node.tree];
  if (need !== undefined && save.unlocked < need) return 'locked';
  for (const id of node.requires ?? []) {
    const req = NODES.find((n) => n.id === id);
    const have = nodeLevel(save, id);
    if (REQUIRES_MAXED.has(node.id) && req ? have < req.maxLevel : have < 1) return 'locked';
  }
  const cost = nextCost(save, node);
  if (cost === null) return 'maxed';
  const bal = node.currency === 'cash' ? save.cash : save.emeralds;
  return bal >= cost ? 'ok' : 'poor';
}

export function buy(save: SaveData, node: UpgradeNode): boolean {
  if (buyState(save, node) !== 'ok') return false;
  const cost = node.cost(nodeLevel(save, node.id));
  if (node.currency === 'cash') save.cash -= cost;
  else save.emeralds -= cost;
  save.levels[node.id] = nodeLevel(save, node.id) + 1;
  return true;
}

export function bankRun(save: SaveData, result: RunResult): { bossEmeralds: number; unlocked: StageId | null } {
  save.cash += result.cash;
  save.emeralds += result.emeralds;
  let bossEmeralds = 0;
  let unlocked: StageId | null = null;
  if (result.bossKilled) {
    const stage = STAGES.find((s) => s.id === result.stage) ?? STAGES[0];
    const prior = save.bossKills[result.stage] ?? 0;
    bossEmeralds = Math.max(1, Math.round(stage.emeraldReward * Math.pow(EMERALD_REPEAT_DECAY, prior)));
    save.emeralds += bossEmeralds;
    save.bossKills[result.stage] = prior + 1;
    const next = STAGES.find((s) => s.index === stage.index + 1);
    if (next && save.unlocked < next.index) {
      save.unlocked = next.index;
      unlocked = next.id;
    }
  }
  const cleared = Math.min(4, Math.max(0, result.wave - 1) + (result.bossKilled ? 1 : 0));
  save.bestWave[result.stage] = Math.max(save.bestWave[result.stage] ?? 0, cleared);
  save.stats.runs++;
  save.stats.kills += result.kills;
  save.stats.shots += result.shots;
  return { bossEmeralds, unlocked };
}
