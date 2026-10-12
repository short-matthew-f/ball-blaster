import type { BallType, CueId, RelicId, SaveData, TrickId } from '../core/types';
import { BALL_IDS, CUE_IDS, RELIC_IDS, TRICK_IDS } from './cards';

/** Gallery slots a card can be equipped into. The world counter is never in the loadout (it comes from the portal). */
export type GearSlot = 'ball' | 'cue' | 'relic' | 'trick';

const owned = (save: SaveData, id: string): boolean => !!save.cards?.[id];

/** Relic-slot count: 1, +1 from stage 4 (world 2), +1 from stage 12 (world 4). */
export const relicSlots = (save: SaveData): number => 1 + (save.unlocked >= 4 ? 1 : 0) + (save.unlocked >= 12 ? 1 : 0);
export const trickSlotOpen = (save: SaveData): boolean => save.unlocked >= 4;
export const cueSlotOpen = (save: SaveData): boolean => CUE_IDS.some((id) => owned(save, id));

const GEAR_IDS = new Set<string>([...CUE_IDS, ...RELIC_IDS, ...TRICK_IDS, ...BALL_IDS]);

/** Owned = the card exists in save.cards (stubs are never owned). The 'standard' cue/ball is always owned. */
export const gearOwned = (save: SaveData, id: string): boolean => id === 'standard' || (GEAR_IDS.has(id) && owned(save, id));

/** Owned cards by slot, in CARDS order (world, then table). `balls` excludes 'standard'. */
export function ownedGear(save: SaveData): { cues: CueId[]; relics: RelicId[]; tricks: TrickId[]; balls: BallType[] } {
  return {
    cues: CUE_IDS.filter((id) => owned(save, id)),
    relics: RELIC_IDS.filter((id) => owned(save, id)),
    tricks: TRICK_IDS.filter((id) => owned(save, id)),
    balls: BALL_IDS.filter((id) => owned(save, id)),
  };
}

export function equip(save: SaveData, slot: GearSlot, id: string, index?: number): boolean {
  const lo = save.loadout;
  if (slot === 'ball') {
    if (id !== 'standard' && !(BALL_IDS as string[]).includes(id)) return false;
    if (!gearOwned(save, id)) return false;
    lo.ball = id as BallType;
    return true;
  }
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

/** Ball / cue -> 'standard', trick -> null, relic -> removes slot `index` (default: the last one). */
export function unequip(save: SaveData, slot: GearSlot, index?: number): boolean {
  const lo = save.loadout;
  if (slot === 'ball') {
    if (lo.ball === 'standard') return false;
    lo.ball = 'standard';
    return true;
  }
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
  const ball: BallType = typeof r.ball === 'string' && (BALL_IDS as string[]).includes(r.ball) && owned(save, r.ball) ? (r.ball as BallType) : 'standard';
  save.loadout = { ball, cue, relics: relics.slice(0, relicSlots(save)), trick };
  return save.loadout;
}

/** One-time migration: former always-on lightning/split/spitter owners keep them on (into free relic slots). */
export function autoEquipLegacy(save: SaveData): void {
  if (save.hints.relicsMigrated || save.loadout.relics.length > 0) return;
  const legacy = (['lightning', 'split', 'spitter'] as RelicId[]).filter((id) => owned(save, id));
  if (!legacy.length) return;
  save.loadout.relics = legacy.slice(0, relicSlots(save));
  save.hints.relicsMigrated = true;
}
