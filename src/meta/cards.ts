// v0.6 gallery cards (M2). Every piece of gear is a card with the same tree: unlock -> base I/II -> fork -> base III -> capstone.
// Forks (base II, 1 token) and capstones (base III, 2 tokens) are the world 1-4 choices (M3, v0.7); worlds 5-6 stay empty. Leaf module: imports only core/types and core/tuning.
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

// ---- M3 part 1: world-1 forks (cost 1) and capstones (cost 2). id = `${card}.${choice}`; the sim reads them as `mod(s, id)`.
const ch = (card: string, key: string, name: string, desc: string, cost: number): ForkChoice => ({ id: `${card}.${key}`, name, desc, cost });
const CHOICES: Record<string, { forks: ForkChoice[]; caps: ForkChoice[] }> = {
  break: {
    forks: [ch('break', 'slam', 'SLAM', '+10% SPEED, MIN 60%', 1), ch('break', 'crack', 'CRACK', '1ST HIT +1 STAGGER', 1)],
    caps: [ch('break', 'breaker', 'BREAKER', '1ST HIT SHOVES X2', 2), ch('break', 'steady', 'STEADY', 'AIM PREVIEW ON', 2)],
  },
  heavy: {
    forks: [ch('heavy', 'anvil', 'ANVIL', '1ST HIT X2, STOPS', 1), ch('heavy', 'wrecking', 'WRECKING', 'SHOVES X1.5, NO +1', 1)],
    caps: [ch('heavy', 'jugger', 'JUGGERNAUT', 'BLOCKS 1 CHARGE/WAVE', 2), ch('heavy', 'avalanche', 'AVALANCHE', 'BUMPS DEAL 2', 2)],
  },
  ricochet: {
    forks: [ch('ricochet', 'bank', 'BANK', '2+ RAILS: +2 EACH', 1), ch('ricochet', 'carom', 'CAROM', 'HITS COUNT AS RAILS', 1)],
    caps: [ch('ricochet', 'pocket', 'POCKET', '2-RAIL SHOT: CASH X2', 2), ch('ricochet', 'ghost', 'GHOST RAIL', 'FULL-SPEED BANKS', 2)],
  },
  momentum: {
    forks: [ch('momentum', 'streak', 'STREAK', '1-HIT SHOTS HOLD IT', 1), ch('momentum', 'snowball', 'SNOWBALL', '+5% CASH PER STEP', 1)],
    caps: [ch('momentum', 'unstop', 'UNSTOPPABLE', 'AT 3: BREAK SHIELDS', 2), ch('momentum', 'overdrive', 'OVERDRIVE', 'AT MAX: +10% SPEED', 2)],
  },
  recall: {
    forks: [ch('recall', 'blink', 'BLINK', 'NEAREST SAFE SPOT', 1), ch('recall', 'rewind', 'REWIND', 'BACK TO LAST LAUNCH', 1)],
    caps: [ch('recall', 'encore', 'ENCORE', '1 FREE RECALL A WAVE', 2), ch('recall', 'anchor', 'ANCHOR', 'NEXT SHOT +2 DMG', 2)],
  },
  lantern: {
    forks: [ch('lantern', 'beacon', 'BEACON', 'LIT KILLS +10%/LEVEL', 1), ch('lantern', 'glare', 'GLARE', 'DAZZLES 1 SHOOTER', 1)],
    caps: [ch('lantern', 'sunrise', 'SUNRISE', 'REACH: WHOLE TABLE', 2), ch('lantern', 'moth', 'MOTH', 'SHOOTERS COME TO YOU', 2)],
  },
  // ---- M3 parts 2-3: worlds 2 (frost) and 3 (cog)
  jump: {
    forks: [ch('jump', 'long', 'LONG JUMP', 'HOPS 2 FOES A SHOT', 1), ch('jump', 'stomp', 'STOMP', 'LANDING STAGGERS +1', 1)],
    caps: [ch('jump', 'pounce', 'POUNCE', 'LANDING HIT X2', 2), ch('jump', 'trample', 'TRAMPLE', 'JUMPED FOE HIT TOO', 2)],
  },
  light: {
    forks: [ch('light', 'zip', 'ZIP', '+10% LAUNCH, CAPPED', 1), ch('light', 'dart', 'DART', '+1 DMG OVER 400 PX/S', 1)],
    caps: [ch('light', 'blur', 'BLUR', 'FAST HITS STAGGER +1', 2), ch('light', 'tailwind', 'TAILWIND', 'RAILS ADD 15% SPEED', 2)],
  },
  chill: {
    forks: [ch('chill', 'brittle', 'BRITTLE', 'CHILLED TAKE +1', 1), ch('chill', 'numb', 'NUMB', 'CHILLED DEAL -1', 1)],
    caps: [ch('chill', 'frostbite', 'FROSTBITE', 'BUMPS SPREAD CHILL', 2), ch('chill', 'deepfreeze', 'DEEP FREEZE', '2ND HIT FREEZES 1', 2)],
  },
  mirror: {
    forks: [ch('mirror', 'lens', 'LENS', 'REFLECT: YOUR DMG', 1), ch('mirror', 'absorb', 'ABSORB', 'REFLECT HEALS 1', 1)],
    caps: [ch('mirror', 'flawless', 'FLAWLESS', '1ST SHOT/PHASE: SURE', 2), ch('mirror', 'prism', 'PRISM', 'REFLECT SPLASHES 1', 2)],
  },
  split: {
    forks: [ch('split', 'swarm', 'SWARM', '+2 KIDS, ALL DEAL 1', 1), ch('split', 'rail', 'RAIL SPLIT', '1ST RAIL SPLITS TOO', 1)],
    caps: [ch('split', 'mitosis', 'MITOSIS', '1ST KID KILL SPLITS', 2), ch('split', 'homing', 'HOMING', 'KIDS AIM AT FOES', 2)],
  },
  shockwave: {
    forks: [ch('shockwave', 'quake', 'QUAKE', 'RADIUS 90', 1), ch('shockwave', 'pulse', 'PULSE', 'SHOVES 30PX, NO STUN', 1)],
    caps: [ch('shockwave', 'aftershock', 'AFTERSHOCK', 'FIRES AGAIN IN 2', 2), ch('shockwave', 'epicentre', 'EPICENTRE', 'TOUCHING YOU TAKE 2', 2)],
  },
  draw: {
    forks: [ch('draw', 'snap', 'SNAP BACK', 'RETURNS AT 80%', 1), ch('draw', 'seek', 'SEEK', 'RETURN AIMS AT A FOE', 1)],
    caps: [ch('draw', 'masse', 'MASSE', 'RETURN PATH SHOWN', 2), ch('draw', 'pull', 'PULL', 'FOE DRAGGED WITH YOU', 2)],
  },
  sticky: {
    forks: [ch('sticky', 'glue', 'GLUE', 'STUCK: HELD 2 PHASES', 1), ch('sticky', 'web', 'WEB', 'NEARBY +1 STAGGER', 1)],
    caps: [ch('sticky', 'trap', 'TRAP', 'STUCK: NEXT HIT X2', 2), ch('sticky', 'cling', 'CLING', 'STUCK FOE: NO CHARGE', 2)],
  },
  lightning: {
    forks: [ch('lightning', 'chain', 'CHAIN', 'ARCS HOP ONCE MORE', 1), ch('lightning', 'thunder', 'THUNDER', 'ONE FULL ARC, STUNS', 1)],
    caps: [ch('lightning', 'storm', 'STORM', 'KILLS ALSO ARC', 2), ch('lightning', 'surge', 'SURGE', '1ST HIT ALWAYS ARCS', 2)],
  },
  static: {
    forks: [ch('static', 'overload', 'OVERLOAD', 'ALSO ZAPS NEAREST 1', 1), ch('static', 'paralysis', 'PARALYSIS', 'STUN LASTS 2 PHASES', 1)],
    caps: [ch('static', 'tesla', 'TESLA', '3 STAGGERS: ZAP 2', 2), ch('static', 'grounded', 'GROUNDED', 'STUNNED: NO HEALS', 2)],
  },
  spitter: {
    forks: [ch('spitter', 'gatling', 'GATLING', 'SPITS 40% FASTER', 1), ch('spitter', 'mortar', 'MORTAR', 'SLOWER, SPITS BLAST', 1)],
    caps: [ch('spitter', 'aimed', 'AIMED', 'SPITS AIM AT FOES', 2), ch('spitter', 'heavyspit', 'HEAVY SPIT', 'SPIT DEALS 2', 2)],
  },
  timeStop: {
    forks: [ch('timeStop', 'freeze', 'FREEZE', 'NOBODY EVEN MOVES', 1), ch('timeStop', 'slow', 'SLOW', '2 PHASES: HALF DMG', 1)],
    caps: [ch('timeStop', 'clockwork', 'CLOCKWORK', 'BELTS STOP TOO', 2), ch('timeStop', 'stasis', 'STASIS', 'STATUS & RAGE HOLD', 2)],
  },
  // ---- v0.7: world 4 (pearl)
  follow: {
    forks: [ch('follow', 'plow', 'PLOW', '2ND HIT +1 DMG', 1), ch('follow', 'roll', 'ROLL', 'NO CHARGE PENALTY', 1)],
    caps: [ch('follow', 'cannon', 'CANNON', 'KEEPS SPEED 3 HITS', 2), ch('follow', 'topspin', 'TOPSPIN', 'RAILS FULL AFTER HIT', 2)],
  },
  poison: {
    forks: [ch('poison', 'plague', 'PLAGUE', 'BUMPS SPREAD POISON', 1), ch('poison', 'sap', 'SAP', 'POISONED DEAL -1', 1)],
    caps: [ch('poison', 'blight', 'BLIGHT', 'DYING SPREADS 2', 2), ch('poison', 'siphon', 'SIPHON', 'TICKS HEAL 1 PER 3', 2)],
  },
  thorns: {
    forks: [ch('thorns', 'barbs', 'BARBS', 'CHARGER POISONED 2', 1), ch('thorns', 'riposte', 'RIPOSTE', 'CHARGER KNOCKED BACK', 1)],
    caps: [ch('thorns', 'brace', 'BRACE', '1ST CHARGE/TURN -25%', 2), ch('thorns', 'quills', 'QUILLS', 'THORNS = HALF DMG', 2)],
  },
  shrapnel: {
    forks: [ch('shrapnel', 'flak', 'FLAK', 'SHARDS LAST 1.2 S', 1), ch('shrapnel', 'spear', 'SPEAR', '1 SHARD, YOUR DAMAGE', 1)],
    caps: [ch('shrapnel', 'fragment', 'FRAGMENT', 'SHARD KILL SHEDS 2', 2), ch('shrapnel', 'plating', 'PLATING', 'KILL: BLOCK A CHARGE', 2)],
  },
  rackEm: {
    forks: [ch('rackEm', 'tight', 'TIGHT', 'PULLS 30 PX', 1), ch('rackEm', 'scatter', 'SCATTER', 'PUSHES 20 PX OUTWARD', 1)],
    caps: [ch('rackEm', 'rerack', 'RE-RACK', 'ALSO REROLLS INTENTS', 2), ch('rackEm', 'tableroll', 'TABLE ROLL', 'INTO MUD: HELD 1', 2)],
  },
};

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
  forks: CHOICES[r.id]?.forks ?? [],
  caps: CHOICES[r.id]?.caps ?? [],
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

export type ChoiceBuyState = 'locked' | 'poor' | 'open' | 'owned' | 'active';

function choiceState(save: SaveData, card: string, id: string, row: 'fork' | 'cap'): ChoiceBuyState {
  const def = BY_ID.get(card);
  const c = save.cards?.[card];
  if (!def || def.stub || !c) return 'locked';
  const list = row === 'fork' ? def.forks : def.caps;
  const ch = list.find((x) => x.id === id);
  if (!ch || c.level < (row === 'fork' ? 2 : 3)) return 'locked';
  // A capstone also needs an active fork (a pre-M3 save can hold base III with none).
  if (row === 'cap' && c.fork === null) return 'locked';
  if ((row === 'fork' ? c.fork : c.cap) === id) return 'active';
  if ((row === 'fork' ? c.forks : c.caps).includes(id)) return 'owned';
  return (save.tokens[cardToken(def)] ?? 0) >= ch.cost ? 'open' : 'poor';
}
export const forkBuyState = (save: SaveData, card: string, id: string): ChoiceBuyState => choiceState(save, card, id, 'fork');
export const capBuyState = (save: SaveData, card: string, id: string): ChoiceBuyState => choiceState(save, card, id, 'cap');

function setChoice(save: SaveData, card: string, id: string, row: 'fork' | 'cap'): boolean {
  const st = choiceState(save, card, id, row);
  const c = save.cards[card];
  if (st === 'active') return true;
  if (st !== 'owned' && st !== 'open') return false;
  const list = row === 'fork' ? c.forks : c.caps;
  if (st === 'open') {
    const def = BY_ID.get(card)!;
    save.tokens[cardToken(def)] -= (row === 'fork' ? def.forks : def.caps).find((x) => x.id === id)!.cost;
    list.push(id);
  }
  if (row === 'fork') c.fork = id;
  else c.cap = id;
  return true;
}
/** Owned choice: activate free. Open: spend the card's world token, own, activate. Else false. One active per row. */
export const setFork = (save: SaveData, card: string, id: string): boolean => setChoice(save, card, id, 'fork');
export const setCap = (save: SaveData, card: string, id: string): boolean => setChoice(save, card, id, 'cap');

/** True when any card can be unlocked, any owned card's next base node bought, or any fork / capstone choice taken (the GEAR button's dot). */
export function anyCardAffordable(save: SaveData): boolean {
  return CARDS.some((c) =>
    cardBuyState(save, c.id) === 'open' || baseBuyState(save, c.id) === 'ok' ||
    c.forks.some((f) => forkBuyState(save, c.id, f.id) === 'open') || c.caps.some((f) => capBuyState(save, c.id, f.id) === 'open'));
}
