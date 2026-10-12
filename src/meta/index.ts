import type { RunResult, SaveData, StageId, TokenId, UpgradeNode } from '../core/types';
import { globalIndex, nextStageId } from '../core/worlds';
import { cueSlotOpen, equip, gearOwned, ownedGear, relicSlots, trickSlotOpen, unequip } from './gear';
import { exportSave, importSave, loadSave, newSave, writeSave } from './save';
import { buildStats, nodeLevel, worldOf } from './stats';
import { NODES, currentLoop, distanceFromOwned, isReachable, nodesFor, pathToOwned } from './tree';
import { BALL_CARD, CAPSTONE_NEEDS, CUE_IDS, RELIC_IDS, ROOT_ID, STAT_RELICS, TRICK_IDS } from './upgrades';

export { NODES, ROOT_ID, nodesFor, isReachable, distanceFromOwned, pathToOwned, newSave, loadSave, writeSave, exportSave, importSave, buildStats, nodeLevel, relicSlots, trickSlotOpen, cueSlotOpen, gearOwned, ownedGear, equip, unequip };

export function nextCost(save: SaveData, node: UpgradeNode): number | null {
  const l = nodeLevel(save, node.id);
  return l >= node.maxLevel ? null : node.cost(l);
}

/** A world is cleared when any of its stages (in any loop) has a boss kill. */
/**
 * A world's graft opens when the player REACHES the world (its first stage is unlocked), not when they clear it:
 * the graft is what makes the world beatable. Loops never re-lock a graft.
 */
export function worldCleared(save: SaveData, world: number): boolean {
  if (world <= 1) return true; // Felt Hall's graft is available from the start
  if (save.unlocked >= 4 * (world - 1)) return true;
  return Object.entries(save.bossKills).some(([id, n]) => n > 0 && worldOf(id) === world);
}

/** Capstone sibling node ids (counter, cash, dmg, hp) that must be maxed; empty for other nodes. */
export function capstoneRequires(node: UpgradeNode): string[] {
  return CAPSTONE_NEEDS.get(node.id) ?? [];
}

export function buyState(save: SaveData, node: UpgradeNode): 'ok' | 'locked' | 'maxed' | 'poor' | 'hidden' {
  const level = nodeLevel(save, node.id);
  if (node.id === ROOT_ID || level >= node.maxLevel) return 'maxed';
  if (node.graft !== undefined && !worldCleared(save, node.graft)) return 'locked';
  const dist = distanceFromOwned(save, node.id);
  if (dist > 2) return 'hidden';
  if (node.loop !== undefined && node.loop > currentLoop(save)) return 'locked';
  if (dist > 1 && level === 0) return 'locked';
  const sibs = CAPSTONE_NEEDS.get(node.id);
  if (sibs) {
    const all = nodesFor(save);
    for (const id of sibs) {
      const sib = all.find((n) => n.id === id);
      if (!sib || nodeLevel(save, id) < sib.maxLevel) return 'locked';
    }
  }
  const cost = node.cost(level);
  const bal = node.currency === 'cash' ? save.cash : save.tokens[node.currency];
  return bal >= cost ? 'ok' : 'poor';
}

const GEAR_IDS = new Set<string>([...CUE_IDS, ...RELIC_IDS, ...TRICK_IDS]);

const newCard = () => ({ level: 0, forks: [] as string[], fork: null, caps: [] as string[], cap: null });

export function buy(save: SaveData, node: UpgradeNode): boolean {
  if (buyState(save, node) !== 'ok') return false;
  const cost = node.cost(nodeLevel(save, node.id));
  if (node.currency === 'cash') save.cash -= cost;
  else save.tokens[node.currency] -= cost;
  const id = node.id;
  const ballCard = (BALL_CARD as Record<string, string>)[id];
  if (ballCard) {
    save.cards[ballCard] ??= newCard();
  } else if (GEAR_IDS.has(id)) {
    const card = save.cards[id];
    if (!card) save.cards[id] = newCard(); // unlock; lightning/split/spitter node level 1 = card level 0
    else if ((STAT_RELICS as readonly string[]).includes(id)) card.level++;
  } else if (id.endsWith('_lv') && GEAR_IDS.has(id.slice(0, -3))) {
    const card = save.cards[id.slice(0, -3)];
    if (card) card.level++;
  } else {
    save.levels[id] = nodeLevel(save, id) + 1;
  }
  return true;
}

export function bankRun(save: SaveData, result: RunResult): { tokens: number; tokenId: TokenId; unlocked: StageId | null } {
  save.cash += result.cash;
  const tokenId = result.tokenId;
  const tokens = Math.max(0, Math.floor(result.tokens ?? 0));
  save.tokens[tokenId] += tokens;
  let unlocked: StageId | null = null;
  if (result.bossKilled) {
    const n = globalIndex(result.stage);
    save.bossKills[result.stage] = (save.bossKills[result.stage] ?? 0) + 1;
    if (n + 1 > save.unlocked) {
      save.unlocked = n + 1;
      unlocked = nextStageId(result.stage) ?? null;
    }
  }
  const cleared = Math.min(4, Math.max(0, result.wave - 1) + (result.bossKilled ? 1 : 0));
  save.bestWave[result.stage] = Math.max(save.bestWave[result.stage] ?? 0, cleared);
  save.bestLoot[result.stage] = Math.max(save.bestLoot[result.stage] ?? 0, Math.floor(result.loot ?? 0));
  save.stats.runs++;
  save.stats.kills += result.kills;
  save.stats.shots += result.shots;
  save.stats.teeth += result.tooth ? 1 : 0;
  return { tokens, tokenId, unlocked };
}
