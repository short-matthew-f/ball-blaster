// Gear helpers (DESIGN-v0.4-loadout): is a relic equipped, and at what level.
import type { RelicId, RunState } from '../core/types';

export function has(s: RunState, id: RelicId): boolean {
  return s.stats.relics.includes(id);
}

/** Upgrade level of a gear id (0 = base). */
export function lv(s: RunState, id: string): number {
  return s.stats.gearLevel[id] ?? 0;
}
