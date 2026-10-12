import type { SaveData } from '../core/types';

/** Level of a tree node (save.levels). Gear is not in the tree since v0.6 M2: cards live in save.cards (meta/cards.ts). */
export function nodeLevel(save: SaveData, id: string): number {
  const v = save.levels[id];
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}
