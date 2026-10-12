import type { SaveData, UpgradeNode } from '../core/types';
import { CORE_NODES, FIRST_LOOP_NODES, GRAFT_NODES, ROOT_ID, loopNodes } from './upgrades';

const LOOP_LEN = 24;

/** Loop the player has reached: from the current stage id or the highest unlocked stage index. */
export function currentLoop(save: SaveData): number {
  const m = /^l(\d+)w/.exec(save.current);
  return Math.max(m ? Number(m[1]) : 0, Math.floor((save.unlocked || 0) / LOOP_LEN));
}

const setCache = new Map<number, UpgradeNode[]>();

/** Core + all grafts (locked ones included) + loop rings up to the current loop + 1. */
export function nodesFor(save: SaveData): UpgradeNode[] {
  const top = currentLoop(save) + 1;
  let r = setCache.get(top);
  if (!r) {
    r = [...CORE_NODES, ...GRAFT_NODES, ...FIRST_LOOP_NODES];
    for (let l = 2; l <= top; l++) r.push(...loopNodes(l));
    setCache.set(top, r);
  }
  return r;
}

export const NODES: UpgradeNode[] = nodesFor({ current: "", unlocked: 0 } as unknown as SaveData);

interface Graph {
  byId: Map<string, UpgradeNode>;
  adj: Map<string, string[]>;
}
const graphCache = new WeakMap<UpgradeNode[], Graph>();

function graphOf(nodes: UpgradeNode[]): Graph {
  let g = graphCache.get(nodes);
  if (!g) {
    const byId = new Map<string, UpgradeNode>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      byId.set(n.id, n);
      adj.set(n.id, []);
    }
    for (const n of nodes) {
      for (const l of n.links) {
        if (!byId.has(l)) continue;
        adj.get(n.id)!.push(l);
        adj.get(l)!.push(n.id);
      }
    }
    graphCache.set(nodes, (g = { byId, adj }));
  }
  return g;
}

export function nodeById(save: SaveData, id: string): UpgradeNode | undefined {
  return graphOf(nodesFor(save)).byId.get(id);
}

const owned = (save: SaveData, id: string) => id === ROOT_ID || (typeof save.levels[id] === 'number' && save.levels[id] > 0);

/** Multi-source BFS from owned nodes. Returns dist and parent maps. */
function bfs(save: SaveData) {
  const { byId, adj } = graphOf(nodesFor(save));
  const dist = new Map<string, number>();
  const parent = new Map<string, string>();
  const q: string[] = [];
  for (const id of byId.keys()) {
    if (owned(save, id)) {
      dist.set(id, 0);
      q.push(id);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const id = q[i];
    for (const nb of adj.get(id)!) {
      if (dist.has(nb)) continue;
      dist.set(nb, dist.get(id)! + 1);
      parent.set(nb, id);
      q.push(nb);
    }
  }
  return { dist, parent };
}

export function distanceFromOwned(save: SaveData, id: string): number {
  return bfs(save).dist.get(id) ?? Infinity;
}

export function isReachable(save: SaveData, id: string): boolean {
  const { adj } = graphOf(nodesFor(save));
  return (adj.get(id) ?? []).some((nb) => owned(save, nb));
}

/** Shortest path of node ids from the nearest owned node to `id`, inclusive. Empty if unreachable. */
export function pathToOwned(save: SaveData, id: string): string[] {
  const { dist, parent } = bfs(save);
  if (!dist.has(id)) return [];
  const path = [id];
  while (parent.has(path[0])) path.unshift(parent.get(path[0])!);
  return path;
}
