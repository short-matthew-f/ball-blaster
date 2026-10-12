import type { CueId, RelicId, SaveData, TrickId } from '../core/types';
import { CUE_IDS, RELIC_IDS, TRICK_IDS } from './upgrades';

const lvl = (save: SaveData, id: string) => {
  const v = save.levels[id];
  return typeof v === 'number' && v > 0 ? v : 0;
};

/** Relic-slot count: 1, +1 from stage 4 (world 2), +1 from stage 12 (world 4). */
export const relicSlots = (save: SaveData): number => 1 + (save.unlocked >= 4 ? 1 : 0) + (save.unlocked >= 12 ? 1 : 0);
export const trickSlotOpen = (save: SaveData): boolean => save.unlocked >= 4;
export const cueSlotOpen = (save: SaveData): boolean => CUE_IDS.some((id) => lvl(save, id) > 0);

/** Owned = the unlock node has a level. The 'standard' cue is always owned. */
export const gearOwned = (save: SaveData, id: string): boolean =>
  id === 'standard' || ((CUE_IDS as string[]).includes(id) || (RELIC_IDS as string[]).includes(id) || (TRICK_IDS as string[]).includes(id)) && lvl(save, id) > 0;

export function ownedGear(save: SaveData): { cues: CueId[]; relics: RelicId[]; tricks: TrickId[] } {
  return {
    cues: CUE_IDS.filter((id) => lvl(save, id) > 0),
    relics: RELIC_IDS.filter((id) => lvl(save, id) > 0),
    tricks: TRICK_IDS.filter((id) => lvl(save, id) > 0),
  };
}

export function equip(save: SaveData, slot: 'cue' | 'relic' | 'trick', id: string, index?: number): boolean {
  const lo = save.loadout;
  if (slot === 'cue') {
    if (!(CUE_IDS as string[]).includes(id) && id !== 'standard') return false;
    if (!gearOwned(save, id) || (id !== 'standard' && !cueSlotOpen(save))) return false;
    lo.cue = id as CueId;
    return true;
  }
  if (slot === 'trick') {
    if (!(TRICK_IDS as string[]).includes(id) || !trickSlotOpen(save) || !gearOwned(save, id)) return false;
    lo.trick = id as TrickId;
    return true;
  }
  if (!(RELIC_IDS as string[]).includes(id) || !gearOwned(save, id)) return false;
  const n = relicSlots(save);
  const at = lo.relics.indexOf(id as RelicId);
  if (index === undefined) {
    if (at >= 0 || lo.relics.length >= n) return false;
    lo.relics.push(id as RelicId);
    return true;
  }
  if (!Number.isInteger(index) || index < 0 || index >= n || index > lo.relics.length) return false;
  if (at >= 0 && at !== index) return false; // already equipped in another slot
  lo.relics[index] = id as RelicId;
  return true;
}

/** Cue -> 'standard', trick -> null, relic -> removes slot `index` (default: the last one). */
export function unequip(save: SaveData, slot: 'cue' | 'relic' | 'trick', index?: number): boolean {
  const lo = save.loadout;
  if (slot === 'cue') {
    if (lo.cue === 'standard') return false;
    lo.cue = 'standard';
    return true;
  }
  if (slot === 'trick') {
    if (lo.trick === null) return false;
    lo.trick = null;
    return true;
  }
  const i = index ?? lo.relics.length - 1;
  if (!Number.isInteger(i) || i < 0 || i >= lo.relics.length) return false;
  lo.relics.splice(i, 1);
  return true;
}

/** Drops unowned/unknown/duplicate gear and truncates to slot counts. Mutates and returns save.loadout. */
export function fixLoadout(save: SaveData, raw: unknown): SaveData['loadout'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cue = typeof r.cue === 'string' && gearOwned(save, r.cue) && (r.cue === 'standard' || cueSlotOpen(save)) ? (r.cue as CueId) : 'standard';
  const relics: RelicId[] = [];
  if (Array.isArray(r.relics)) {
    for (const x of r.relics) if (typeof x === 'string' && (RELIC_IDS as string[]).includes(x) && gearOwned(save, x) && !relics.includes(x as RelicId)) relics.push(x as RelicId);
  }
  const trick = typeof r.trick === 'string' && (TRICK_IDS as string[]).includes(r.trick) && trickSlotOpen(save) && gearOwned(save, r.trick) ? (r.trick as TrickId) : null;
  save.loadout = { cue, relics: relics.slice(0, relicSlots(save)), trick };
  return save.loadout;
}

/** One-time migration: former always-on lightning/split/spitter owners keep them on (into free relic slots). */
export function autoEquipLegacy(save: SaveData): void {
  if (save.hints.relicsMigrated || save.loadout.relics.length > 0) return;
  const legacy = (['lightning', 'split', 'spitter'] as RelicId[]).filter((id) => lvl(save, id) > 0);
  if (!legacy.length) return;
  save.loadout.relics = legacy.slice(0, relicSlots(save));
  save.hints.relicsMigrated = true;
}
