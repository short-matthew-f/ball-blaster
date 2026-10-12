import type { SaveData } from '../core/types';
import { BALL_CARD, CUE_IDS, RELIC_IDS, STAT_RELICS, TRICK_IDS } from './upgrades';

export const GEAR_SET = new Set<string>([...CUE_IDS, ...RELIC_IDS, ...TRICK_IDS]);
const STAT_RELIC_SET = new Set<string>(STAT_RELICS);

/**
 * Level of a tree node. Gear lives in save.cards: a gear keystone (id = card id; balls via BALL_CARD) is 1 when the card exists;
 * lightning/split/spitter report card.level + 1; `${gear}_lv` reports card.level. Everything else is save.levels.
 */
export function nodeLevel(save: SaveData, id: string): number {
  const cards = save.cards ?? {};
  const ball = (BALL_CARD as Record<string, string>)[id];
  if (ball) return cards[ball] ? 1 : 0;
  if (GEAR_SET.has(id)) {
    const c = cards[id];
    return c ? (STAT_RELIC_SET.has(id) ? c.level + 1 : 1) : 0;
  }
  if (id.endsWith('_lv')) {
    const base = id.slice(0, -3);
    if (GEAR_SET.has(base) && !STAT_RELIC_SET.has(base)) return cards[base]?.level ?? 0;
  }
  const v = save.levels[id];
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}
