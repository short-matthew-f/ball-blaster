// v0.6 gallery cards (M2). Every piece of gear is a card with the same tree: unlock -> base I/II -> fork -> base III -> capstone.
// Forks and capstones are typed here but empty until M3. Leaf module: imports only core/types and core/tuning.
import {
  CARD_BASE_PRICE, CASH_GROWTH, CHILL_PHASES, EXPLOSIVE_R, HEAVY_MASS, LANTERN_REACH, LIGHT_SPEED, MIRROR_CHANCE, MOMENTUM_MAX,
  POISON_MAX, RICOCHET_MAX, SHRAPNEL_COUNT, SPIT_LIFE_CAP, STATIC_DMG, STICKY_STAGGER, THORNS_RELIC_DMG, TRICK_USES,
  BREAK_SPEED_MULT_LV, BREAK_MIN_POWER_LV, DRAW_POWER_LV, FOLLOW_KEEP_LV, JUMP_PENALTY,
} from '../core/tuning';
import type { BallType, CardState, CueId, RelicId, RunStats, SaveData, TokenId, TrickId } from '../core/types';
import { TOKEN_OF_WORLD } from '../core/types';

export type CardSlot = 'cue' | 'ball' | 'relic' | 'trick';

export interface BaseNode {
  name: string;
  desc: string;
  /** Cost (cash) of base level l+1 for l = 0..2. */
  cost: (l: 0 | 1 | 2) => number;
  /** Optional formula hook; most cards are read through gearLevel[id] in buildStats. */
  apply?: (s: RunStats, level: number) => void;
}

/** A fork or capstone choice (M3). */
export interface ForkChoice {
  id: string;
  name: string;
  desc: string;
  /** Tokens of the card's world. */
  cost: number;
}

export interface CardDef {
  id: string;
  slot: CardSlot;
  /** World whose boss token unlocks it (1..6). */
  world: number;
  name: string;
  desc: string;
  /** Sprite name (9x9). */
  icon: string;
  /** Visible but unbuyable until its world ships. */
  stub?: boolean;
  base: [BaseNode, BaseNode, BaseNode];
  forks: ForkChoice[];
  caps: ForkChoice[];
  /** Formula cards (lightning / split / spitter): applied in buildStats with the card level (0..3) while equipped. */
  apply?: (s: RunStats, level: number) => void;
}

export type CardBuyState = 'stub' | 'locked' | 'open' | 'owned' | 'maxed';
/** State of a card's next base node: 'unowned' (card not unlocked), 'locked' (base III waits for a fork choice). */
export type BaseBuyState = 'unowned' | 'locked' | 'poor' | 'ok' | 'maxed';

/** Cards cost 1 token of their world to unlock. */
export const CARD_UNLOCK_COST = 1;
export const CARD_MAX_LEVEL = 3;

const ROMAN = ['I', 'II', 'III'];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fWorld = (world: number) => CASH_GROWTH ** (4 * (world - 1));

/** Base cost round(B x f_world x 2^l). */
export function basePrice(slot: CardSlot, world: number, l: number): number {
  return Math.round(CARD_BASE_PRICE[slot] * fWorld(world) * 2 ** l);
}

/** Today's lightning node at level L (card level + 1). */
function lightningAt(s: RunStats, L: number): void {
  s.lightningChance = 0.15 + 0.07 * L;
  s.lightningArcs = 1 + Math.floor(L / 2);
  s.lightningRange = 40;
  s.lightningDamage = 1 + Math.floor(L / 3);
}
/** Today's spitter node at level L (card level + 1). */
function spitterAt(s: RunStats, L: number): void {
  s.spitInterval = 0.6 - 0.08 * (L - 1);
  s.spitLife = Math.min(SPIT_LIFE_CAP, 1.2 + 0.3 * L);
  s.spitDamage = 1;
}

interface Row {
  id: string;
  slot: CardSlot;
  world: number;
  name: string;
  desc: string;
  icon: string;
  /** Desc of base level 1..3 (index 0..2). */
  lv: [string, string, string];
  stub?: boolean;
  apply?: (s: RunStats, level: number) => void;
}

const uses = (t: TrickId): [string, string, string] => [1, 2, 3].map((l) => `${TRICK_USES[t] + l} uses a run`) as [string, string, string];
const at = <T,>(f: (l: number) => T): [T, T, T] => [f(1), f(2), f(3)];
const soon: [string, string, string] = ['Coming soon', 'Coming soon', 'Coming soon'];

// Order: world, then the spec table's order within the world.
const ROWS: Row[] = [
  // ---- World 1 · Felt Hall (stripe)
  { id: 'break', slot: 'cue', world: 1, name: 'BREAK CUE', desc: '+20% speed, no aim', icon: 'gear_break',
    lv: [`Speed +${pct(BREAK_SPEED_MULT_LV[1] - 1)}`, `Min power ${pct(BREAK_MIN_POWER_LV[2])}`, `Speed +${pct(BREAK_SPEED_MULT_LV[3] - 1)}`] },
  { id: 'heavy', slot: 'ball', world: 1, name: 'HEAVY BALL', desc: 'Mass x2, +1 dmg', icon: 'gear_heavy', lv: at((l) => `Mass x${HEAVY_MASS[l]}`) },
  { id: 'ricochet', slot: 'relic', world: 1, name: 'RICOCHET', desc: 'Rail bounces +dmg', icon: 'gear_ricochet', lv: at((l) => `Bounce cap ${RICOCHET_MAX[l]}`) },
  { id: 'momentum', slot: 'relic', world: 1, name: 'MOMENTUM', desc: 'Streaks add dmg', icon: 'gear_momentum', lv: at((l) => `Streak cap ${MOMENTUM_MAX[l]}`) },
  { id: 'lantern', slot: 'relic', world: 1, name: 'LANTERN', desc: 'Intents stay lit', icon: 'gear_lantern', lv: at((l) => `Reach +${LANTERN_REACH[l]}`) },
  { id: 'recall', slot: 'trick', world: 1, name: 'RECALL', desc: 'Ball to safe spot', icon: 'gear_recall', lv: uses('recall') },
  // ---- World 2 · Ice Cavern (frost)
  { id: 'jump', slot: 'cue', world: 2, name: 'JUMP CUE', desc: 'Hop 1st enemy', icon: 'gear_jump',
    lv: at((l) => (JUMP_PENALTY[l] > 0 ? `Landing -${JUMP_PENALTY[l]} dmg` : JUMP_PENALTY[l] === 0 ? 'No landing penalty' : `Landing +${-JUMP_PENALTY[l]} dmg`)) },
  { id: 'light', slot: 'ball', world: 2, name: 'LIGHT BALL', desc: 'Fast, light ball', icon: 'gear_light', lv: at((l) => `Speed x${LIGHT_SPEED[l]}`) },
  { id: 'chill', slot: 'relic', world: 2, name: 'CHILL', desc: 'Hits slow enemies', icon: 'gear_chill', lv: at((l) => `Chill ${CHILL_PHASES[l]} phases`) },
  { id: 'mirror', slot: 'relic', world: 2, name: 'MIRROR', desc: 'Reflect ranged', icon: 'gear_mirror', lv: at((l) => `Reflect ${pct(MIRROR_CHANCE[l])}`) },
  { id: 'split', slot: 'relic', world: 2, name: 'SPLIT', desc: 'Splits on 1st hit', icon: 'gear_split', lv: at((l) => `${2 + l} split balls`),
    apply: (s, level) => { s.splitCount = 2 + level; } },
  { id: 'shockwave', slot: 'trick', world: 2, name: 'SHOCKWAVE', desc: 'Stagger nearby', icon: 'gear_shockwave', lv: uses('shockwave') },
  // ---- World 3 · Clockwork Works (cog)
  { id: 'draw', slot: 'cue', world: 3, name: 'DRAW CUE', desc: 'Backspin pullback', icon: 'gear_draw', lv: at((l) => `Power ${pct(DRAW_POWER_LV[l])}`) },
  { id: 'sticky', slot: 'ball', world: 3, name: 'STICKY BALL', desc: 'Stops on 1st hit', icon: 'gear_sticky', lv: at((l) => `Stagger +${STICKY_STAGGER[l]}`) },
  { id: 'lightning', slot: 'relic', world: 3, name: 'LIGHTNING', desc: 'Arcs between targets', icon: 'gear_lightning',
    lv: at((l) => { const s = { lightningChance: 0, lightningArcs: 0 } as RunStats; lightningAt(s, l + 1); return `${pct(s.lightningChance)}, ${s.lightningArcs} arc${s.lightningArcs > 1 ? 's' : ''}`; }),
    apply: (s, level) => lightningAt(s, level + 1) },
  { id: 'static', slot: 'relic', world: 3, name: 'STATIC', desc: 'Stagger deals dmg', icon: 'gear_static', lv: at((l) => `Stagger dmg ${STATIC_DMG[l]}`) },
  { id: 'spitter', slot: 'relic', world: 3, name: 'SPITTER', desc: 'Spits mini balls', icon: 'gear_spitter',
    lv: at((l) => `Spit every ${(0.6 - 0.08 * l).toFixed(2)}s`), apply: (s, level) => spitterAt(s, level + 1) },
  { id: 'timeStop', slot: 'trick', world: 3, name: 'TIME STOP', desc: 'Skip enemy phase', icon: 'gear_timeStop', lv: uses('timeStop') },
  // ---- World 4 · Bog (pearl)
  { id: 'follow', slot: 'cue', world: 4, name: 'FOLLOW CUE', desc: 'Topspin carry', icon: 'gear_follow', lv: at((l) => `Keep ${pct(FOLLOW_KEEP_LV[l])} speed`) },
  { id: 'poison', slot: 'relic', world: 4, name: 'POISON', desc: 'Hits add poison', icon: 'gear_poison', lv: ['+1 stack per hit', `No decay, cap ${POISON_MAX[2]}`, `Cap ${POISON_MAX[3]} stacks`] },
  { id: 'thorns', slot: 'relic', world: 4, name: 'THORNS', desc: 'Chargers take dmg', icon: 'gear_thorns', lv: at((l) => `Thorns dmg ${THORNS_RELIC_DMG[l]}`) },
  { id: 'shrapnel', slot: 'relic', world: 4, name: 'SHRAPNEL', desc: 'Kills fire shards', icon: 'gear_shrapnel', lv: at((l) => `${SHRAPNEL_COUNT[l]} shards a kill`) },
  { id: 'rackEm', slot: 'trick', world: 4, name: "RACK 'EM", desc: 'Pull enemies in', icon: 'gear_rackEm', lv: uses('rackEm') },
  // ---- World 5 · Ember Pit (ember)
  { id: 'explosive', slot: 'relic', world: 5, name: 'EXPLOSIVE', desc: 'First hit blasts', icon: 'gear_explosive',
    lv: [`Blast radius ${EXPLOSIVE_R[1]}`, `Radius ${EXPLOSIVE_R[2]}, no slow`, `Blast radius ${EXPLOSIVE_R[3]}`] },
  { id: 'comet', slot: 'ball', world: 5, name: 'COMET BALL', desc: 'Burning trail', icon: 'gear_comet', lv: soon, stub: true },
  { id: 'fire', slot: 'relic', world: 5, name: 'FIRE', desc: 'Hits set fires', icon: 'gear_fire', lv: soon, stub: true },
  { id: 'magnet', slot: 'relic', world: 5, name: 'MAGNET', desc: 'Pulls enemies in', icon: 'gear_magnet', lv: soon, stub: true },
  // ---- World 6 · Neon Casino (house)
  { id: 'greed', slot: 'relic', world: 6, name: 'GREED', desc: 'More cash, more risk', icon: 'gear_greed', lv: soon, stub: true },
  { id: 'decoy', slot: 'trick', world: 6, name: 'DECOY', desc: 'Draws enemy fire', icon: 'gear_decoy', lv: soon, stub: true },
  { id: 'bulwark', slot: 'relic', world: 6, name: 'BULWARK', desc: 'Blocks one hit', icon: 'gear_bulwark', lv: soon, stub: true },
];

/** The card catalogue: 24 real cards + 6 stubs, ordered by world then the spec table. */
export const CARDS: CardDef[] = ROWS.map((r) => ({
  id: r.id,
  slot: r.slot,
  world: r.world,
  name: r.name,
  desc: r.desc,
  icon: r.icon,
  ...(r.stub ? { stub: true } : {}),
  base: [0, 1, 2].map((i) => ({
    name: `BASE ${ROMAN[i]}`,
    desc: r.lv[i],
    cost: (l: 0 | 1 | 2) => basePrice(r.slot, r.world, l),
    ...(r.apply ? { apply: r.apply } : {}),
  })) as [BaseNode, BaseNode, BaseNode],
  forks: [],
  caps: [],
  ...(r.apply ? { apply: r.apply } : {}),
}));

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const real = (slot: CardSlot) => CARDS.filter((c) => c.slot === slot && !c.stub).map((c) => c.id);

/** Buyable card ids by slot (stubs excluded), in CARDS order. */
export const CUE_IDS = real('cue') as Exclude<CueId, 'standard'>[];
export const RELIC_IDS = real('relic') as RelicId[];
export const TRICK_IDS = real('trick') as TrickId[];
export const BALL_IDS = real('ball') as Exclude<BallType, 'standard'>[];
/** Every card id, stubs included. */
export const CARD_IDS: string[] = CARDS.map((c) => c.id);

export const cardById = (id: string): CardDef | undefined => BY_ID.get(id);
export const cardOwned = (save: SaveData, id: string): boolean => id === 'standard' || !!save.cards?.[id];
export const cardState = (save: SaveData, id: string): CardState | undefined => save.cards?.[id];
/** Base level of a card (0 when not owned). */
export const cardLevel = (save: SaveData, id: string): number => save.cards?.[id]?.level ?? 0;
/** The token that unlocks a card. */
export const cardToken = (def: CardDef): TokenId => TOKEN_OF_WORLD[def.world - 1];

export function cardBuyState(save: SaveData, id: string): CardBuyState {
  const def = BY_ID.get(id);
  if (!def || def.stub) return 'stub';
  const c = save.cards?.[id];
  if (c) return c.level >= CARD_MAX_LEVEL ? 'maxed' : 'owned';
  return (save.tokens[cardToken(def)] ?? 0) >= CARD_UNLOCK_COST ? 'open' : 'locked';
}

/** Unlock: not owned, not a stub, 1 token of the card's world (no `unlocked` check: the token proves the boss). */
export function buyCard(save: SaveData, id: string): boolean {
  if (cardBuyState(save, id) !== 'open') return false;
  const def = BY_ID.get(id)!;
  save.tokens[cardToken(def)] -= CARD_UNLOCK_COST;
  save.cards[id] = { level: 0, forks: [], fork: null, caps: [], cap: null };
  return true;
}

/** Cash cost of the card's next base node, or null when not owned / maxed. */
export function nextBaseCost(save: SaveData, id: string): number | null {
  const def = BY_ID.get(id);
  const c = save.cards?.[id];
  if (!def || !c || c.level >= CARD_MAX_LEVEL) return null;
  return def.base[c.level].cost(c.level as 0 | 1 | 2);
}

export function baseBuyState(save: SaveData, id: string): BaseBuyState {
  const def = BY_ID.get(id);
  const c = save.cards?.[id];
  if (!def || def.stub || !c) return 'unowned';
  if (c.level >= CARD_MAX_LEVEL) return 'maxed';
  // Base III needs an active fork choice, but only once the card has forks (M3).
  if (c.level === 2 && def.forks.length > 0 && c.fork === null) return 'locked';
  return save.cash >= def.base[c.level].cost(c.level as 0 | 1 | 2) ? 'ok' : 'poor';
}

/** Buys the next base node with cash. */
export function buyBase(save: SaveData, id: string): boolean {
  if (baseBuyState(save, id) !== 'ok') return false;
  const c = save.cards[id];
  save.cash -= BY_ID.get(id)!.base[c.level].cost(c.level as 0 | 1 | 2);
  c.level++;
  return true;
}

/** True when any card can be unlocked or any owned card's next base node bought (the GEAR button's dot). */
export function anyCardAffordable(save: SaveData): boolean {
  return CARDS.some((c) => cardBuyState(save, c.id) === 'open' || baseBuyState(save, c.id) === 'ok');
}

/** M3: fork / capstone choices. Typed now; nothing to choose in M2. */
export function setFork(_save: SaveData, _id: string, _choice: string): boolean {
  return false;
}
export function setCap(_save: SaveData, _id: string, _choice: string): boolean {
  return false;
}
