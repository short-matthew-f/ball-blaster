import type { RunResult, SaveData, StageId, TokenId, UpgradeNode } from '../core/types';
import { globalIndex, nextStageId } from '../core/worlds';
import { cueSlotOpen, equip, fixLoadout, gearOwned, ownedGear, relicSlots, trickSlotOpen, unequip } from './gear';
import { exportSave, importSave, loadSave, newSave, writeSave } from './save';
import { buildStats, nodeLevel, worldOf } from './stats';
import { NODES, currentLoop, distanceFromOwned, isReachable, nodesFor, pathToOwned, treeBounds } from './tree';
import { CAPSTONE_NEEDS, ISLAND_CENTRES, PORTAL_NEEDS, ROOT_ID, WORLD_COUNT, islandHub, loopCentre, pierOf } from './upgrades';

export {
  NODES, ROOT_ID, nodesFor, isReachable, distanceFromOwned, pathToOwned, treeBounds, newSave, loadSave, writeSave, exportSave, importSave, buildStats,
  nodeLevel, relicSlots, trickSlotOpen, cueSlotOpen, gearOwned, ownedGear, equip, unequip, fixLoadout,
  CAPSTONE_NEEDS, PORTAL_NEEDS, ISLAND_CENTRES, islandHub, loopCentre, pierOf,
};
export {
  CARDS, CARD_IDS, CARD_MAX_LEVEL, CARD_UNLOCK_COST, anyCardAffordable, baseBuyState, basePrice, buyBase, buyCard, cardBuyState, cardById, cardLevel,
  cardOwned, cardState, cardToken, capBuyState, forkBuyState, nextBaseCost, setCap, setFork,
} from './cards';
export type { ChoiceBuyState, BaseBuyState, BaseNode, CardBuyState, CardDef, CardSlot, ForkChoice } from './cards';

export function nextCost(save: SaveData, node: UpgradeNode): number | null {
  const l = nodeLevel(save, node.id);
  return l >= node.maxLevel ? null : node.cost(l);
}

/**
 * True once the player has reached world `world` (its first stage is unlocked) or killed one of its bosses.
 * Kept for the UI; island gating is by portal ownership (see buyState).
 */
export function worldCleared(save: SaveData, world: number): boolean {
  if (world <= 1) return true;
  if (save.unlocked >= 4 * (world - 1)) return true;
  return Object.entries(save.bossKills).some(([id, n]) => n > 0 && worldOf(id) === world);
}

/** Island cash node ids that must be maxed before a capstone opens; empty for other nodes. */
export function capstoneRequires(node: UpgradeNode): string[] {
  return CAPSTONE_NEEDS.get(node.id) ?? [];
}

/** `save.unlocked` a portal needs (4(k-1) for portal_w{k}, 24L for portal_l{L}); undefined for other nodes. */
export function portalNeeds(node: UpgradeNode | string): number | undefined {
  return PORTAL_NEEDS.get(typeof node === 'string' ? node : node.id);
}

/** World whose last stage must be beaten to open a portal (portal_w{k} -> k-1; loop portals -> 6). */
export function portalGateWorld(node: UpgradeNode | string): number | undefined {
  const id = typeof node === 'string' ? node : node.id;
  const m = /^portal_w(\d)$/.exec(id);
  if (m) return Number(m[1]) - 1;
  return /^portal_l\d+$/.test(id) ? WORLD_COUNT : undefined;
}

/** True when the portal's world gate is met (`save.unlocked` high enough); true for non-portals. */
export function portalOpen(save: SaveData, node: UpgradeNode | string): boolean {
  const need = portalNeeds(node);
  return need === undefined || save.unlocked >= need;
}

/** True when the node's island is open: island 1 always; island k / loop L once its portal is owned. */
export function islandOpen(save: SaveData, island: number | undefined): boolean {
  if (island === undefined || island <= 1) return true;
  return nodeLevel(save, islandHub(island)) > 0;
}

export function buyState(save: SaveData, node: UpgradeNode): 'ok' | 'locked' | 'maxed' | 'poor' | 'hidden' {
  const level = nodeLevel(save, node.id);
  if (node.id === ROOT_ID || level >= node.maxLevel) return 'maxed';
  const dist = distanceFromOwned(save, node.id);
  // Portals are the walls of the tree: never hidden by disclosure. Gated or far -> 'locked' (drawn with "BEAT ... 4").
  if (node.kind === 'portal') {
    if (!portalOpen(save, node)) return 'locked';
    if (dist > 1) return 'locked';
  } else if (dist > 2) return 'hidden';
  if (node.loop !== undefined && node.loop > currentLoop(save)) return 'locked';
  if (dist > 1 && level === 0) return 'locked';
  if (node.kind !== 'portal' && !islandOpen(save, node.island)) {
    // Nodes owned before their island moved behind a portal (v3/M1 saves) are BFS sources; further buys still wait for the portal.
    return 'locked';
  }
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

export function buy(save: SaveData, node: UpgradeNode): boolean {
  if (buyState(save, node) !== 'ok') return false;
  const cost = node.cost(nodeLevel(save, node.id));
  if (node.currency === 'cash') save.cash -= cost;
  else save.tokens[node.currency] -= cost;
  save.levels[node.id] = nodeLevel(save, node.id) + 1;
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
