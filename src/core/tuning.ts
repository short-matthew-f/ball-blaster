// All balance numbers live here. Sim and meta both read from this file.
import type { RunStats, StageDef, StageId, TargetDef, TargetKind } from './types';
import { makeStage } from './worlds';

// Roster (DESIGN-v0.2.md "Roster (Felt Hall)"). Masses are near-equal, pool-break style (step 2): hero 1 (x massMult),
// grub 0.8, grunt/skirmisher/bomber 1.2, bouncer 1, cleric/frost 1.5, broodmother/thornback 2, hive 3, brute 4, boss 8.
// reach = edge-to-edge gap (px) within which an Attack charges; beyond it, Attack executes as Advance.
export const TARGET_DEFS: Record<TargetKind, TargetDef> = {
  grunt: {
    hp: 3, r: 12, mass: 1.2, cash: 4, bounce: 1, staggerAt: 2, chargeSpeed: 260, reach: 110,
    intents: [{ t: 'attack', n: 3, weight: 70 }, { t: 'advance', weight: 25 }, { t: 'rest', weight: 5 }],
  },
  skirmisher: {
    hp: 3, r: 12, mass: 1.2, cash: 5, bounce: 1, staggerAt: 1, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'shoot', n: 2, weight: 60 }, { t: 'advance', weight: 40 }], // advance = sideways reposition
  },
  bouncer: {
    hp: 4, r: 14, mass: 1.0, cash: 7, bounce: 1.3, staggerAt: 2, chargeSpeed: 300, reach: 140,
    intents: [{ t: 'attack', n: 1, weight: 60 }, { t: 'rest', weight: 40 }],
  },
  bomber: {
    hp: 2, r: 13, mass: 1.2, cash: 7, bounce: 1, staggerAt: 1, chargeSpeed: 0, reach: 0, explodes: true,
    intents: [], // fixed cycle: advance, advance, detonate
  },
  broodmother: {
    hp: 5, r: 15, mass: 2, cash: 8, bounce: 1, staggerAt: 2, chargeSpeed: 220, reach: 100,
    splitsInto: { kind: 'grub', count: 2 },
    intents: [{ t: 'attack', n: 2, weight: 60 }, { t: 'rest', weight: 40 }],
  },
  grub: {
    hp: 1, r: 10, mass: 0.8, cash: 1, bounce: 1, staggerAt: 1, chargeSpeed: 240, reach: 80,
    intents: [{ t: 'attack', n: 1, weight: 70 }, { t: 'advance', weight: 30 }],
  },
  thornback: {
    hp: 5, r: 14, mass: 2, cash: 9, bounce: 1, staggerAt: 2, chargeSpeed: 240, reach: 100, thorns: 1,
    intents: [{ t: 'attack', n: 2, weight: 50 }, { t: 'guard', weight: 50 }],
  },
  brute: {
    hp: 8, r: 19, mass: 4, cash: 14, bounce: 0.8, staggerAt: 3, chargeSpeed: 200, chargedSpeed: 300, reach: 70,
    chargedAttack: 5,
    intents: [], // scripted: Charge -> Attack 5 (Advance while out of reach, keeping the charge)
  },
  cleric: {
    hp: 5, r: 14, mass: 1.5, cash: 10, bounce: 1, staggerAt: 2, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'guard', weight: 60 }, { t: 'shoot', n: 1, weight: 40 }], // guard = shield an ally
  },
  hive: {
    hp: 6, r: 17, mass: 3, cash: 14, bounce: 0.9, staggerAt: 3, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'summon', weight: 50 }, { t: 'rest', weight: 50 }],
  },
  frost: {
    hp: 4, r: 14, mass: 1.5, cash: 12, bounce: 0.8, staggerAt: 2, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'guard', weight: 55 }, { t: 'shoot', n: 1, weight: 45 }], // guard = freeze an ally
  },
  cadre: {
    hp: 4, r: 11, mass: 1.2, cash: 4, bounce: 1, staggerAt: 1, chargeSpeed: 240, reach: 90,
    intents: [{ t: 'attack', n: 1, weight: 50 }, { t: 'rest', weight: 50 }], // boss shield minion (Rime Golem)
  },
  // Clockwork (spec values; sim owner may retune within the gate)
  cog: {
    hp: 4, r: 13, mass: 1.5, cash: 9, bounce: 1.2, staggerAt: 2, chargeSpeed: 280, reach: 140,
    intents: [{ t: 'attack', n: 3, weight: 55 }, { t: 'advance', weight: 30 }, { t: 'rest', weight: 15 }], // banked charge, ricochets, friendly fire
  },
  tinker: {
    hp: 3, r: 12, mass: 1.2, cash: 8, bounce: 1, staggerAt: 1, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'repair', weight: 60 }, { t: 'shoot', n: 1, weight: 40 }], // repair = heal most damaged ally within 70 px
  },
  // Loot Goblin (loot phase; spec numbers, sim owner may retune within the hits-per-pull test)
  goblin: {
    hp: Infinity, r: 13, mass: 1.5, cash: 0, bounce: 1.3, staggerAt: Infinity, chargeSpeed: 0, reach: 0,
    intents: [], // scripted: always Flee (rollIntent, no rng draw); never damaged, staggered or killed
  },
  boss: {
    hp: 40, r: 23, mass: 8, cash: 60, bounce: 0.9, staggerAt: 4, chargeSpeed: 240, chargedSpeed: 400, reach: 90,
    intents: [], // scripted per phase (sim/enemy.ts)
  },
};

// ---------- v0.2 physics + enemy phase ----------
/** Enemy friction and rolling deceleration = this x the stage's hero values. */
export const ENEMY_FRICTION_MULT = 1.3;
/** Pair restitution = BASE_RESTITUTION x kind bounce of each enemy involved, capped at MAX_RESTITUTION. */
export const BASE_RESTITUTION = 0.9;
export const MAX_RESTITUTION = 1.3;
/** Enemy-wall restitution = this x the kind's bounce (bouncers bank, others die on the rail). */
export const ENEMY_WALL_BOUNCE = 0.6;
/** Enemy-enemy bump: 1 damage + 1 stagger to the bumped body above this relative impact speed (px/s). */
export const BUMP_DMG_SPEED = 60;
/** A body killed mid-shot keeps rolling (and bumping) as a ghost for this long. */
export const GHOST_SECONDS = 0.25;
/** Ball contact on an enemy counts as a hit above this approach speed (px/s). */
export const HIT_MIN_SPEED = 15;
/** A pair must separate and wait this long (s) before another hit counts. */
export const HIT_COOLDOWN = 0.1;
/**
 * A charger stops dead when its blow lands (the hero keeps the full knock). Without it heavy chargers (brute, boss)
 * plough on and pin the hero into rails/corners: jams 0.6-1.1/run -> <= 0.1/run in the step-1 bot.
 */
export const CHARGE_STOPS_ON_HIT = true;
/** Soft roll (Advance / reposition) distance in px (launch speed is solved from enemy friction; ~150 px/s on Felt). */
export const ADVANCE_DIST = 60;
/** An Advance stops this far (edge gap, px) short of the hero instead of shoving it. */
export const ADVANCE_STANDOFF = 6;
/** Hero must have a clear corridor of this many px in some direction before aim, or it is nudged. */
export const JAM_CLEAR = 24;
/** Bottom spawn-only zone height (formations never enter it). */
export const SPAWN_ZONE = 60;
export const FORMATION_JITTER = 6;
/** Regulars may cover at most this fraction of the table. */
export const AREA_CAP = 0.1;
export const REGULAR_CAP = 6;
export const SUMMON_CAP = 3;
export const HIVE_GRUB_CAP = 4;
/** Detonate / bomber death: damage to the hero within HERO_R (edge gap), to enemies within ENEMY_R. */
export const BLAST_HERO_R = 60;
export const BLAST_HERO_DMG = 4;
/** A bomber killed by a hit (death blast) deals this to the hero instead; Detonate keeps BLAST_HERO_DMG. */
export const BLAST_DEATH_HERO_DMG = 2;
export const BLAST_ENEMY_R = 40;
export const BLAST_ENEMY_DMG = 3;
export const CLERIC_RANGE = 60;
/** Frost: freezes an ally within FROST_RANGE (edge gap) for FREEZE_PHASES enemy phases; max FREEZE_CAP frozen. */
export const FROST_RANGE = 60;
export const FREEZE_PHASES = 3;
export const FREEZE_CAP = 2;
/**
 * A frozen enemy ignores hits below SHATTER_SPEED (approach, px/s); at or above it shatters: it thaws and takes
 * SHATTER_MULT x the hit's damage (not an instant kill), plus SHATTER_DMG to neighbours.
 */
export const SHATTER_SPEED = 320;
export const SHATTER_MULT = 2;
export const SHATTER_R = 20;
export const SHATTER_DMG = 2;
/** Restitution off a frozen enemy (it is a static body). */
export const FROZEN_BOUNCE = 1.1;
/** Tactics: hero hits at or above this speed apply 2 stagger with heavyHits. */
export const HEAVY_HIT_SPEED = 200;
/** Cascade combo: a bump kill staggers enemies within this radius. */
export const CASCADE_R = 50;
/** Bumper hit: +1 stagger to enemies within this radius. */
export const BUMPER_STAGGER_R = 40;
export const WAVES_PER_STAGE = 3;
/** Wave-clear cash = WAVE_CASH x wave (the boss-wave clear, paid as the loot phase starts, is WAVE_CASH x 4). */
export const WAVE_CASH = 8; // x wave number
export const WAVE_CASH_CAP_WAVE = WAVES_PER_STAGE + 1;
/** Enrage starts at turn ENRAGE_BASE + ENRAGE_PER_WAVE x wave; +1 attack per turn after. */
export const ENRAGE_BASE = 8;
export const ENRAGE_PER_WAVE = 2;
/**
 * Enraged Attack beyond reach charges anyway (banking round cover); from this rage level a covered attacker's blow lands
 * as an instant strike. Liveness backstop: a brute caged behind bumpers made a 600-shot run (v0.3 step 2 bot).
 */
export const ENRAGE_STRIKE_LEVEL = 5;
/** Unblockable (Shoot) damage per enemy phase is capped at this fraction of the hero's max HP; the excess is dropped. */
export const RANGED_PHASE_CAP = 0.5;
/** Chain combo bonus cap (fraction of the shot's cash). */
export const CHAIN_BONUS_CAP = 1;
/** Enemy HP scaling (step 3): x(1 + WAVE_HP_STEP) per stage wave after the first. */
export const WAVE_HP_STEP = 0.25;
export const ELITE_CASH_MULT = 2;
/** Elite Swift: soft-roll distance (+25 %). Hardy: HP multiplier. */
export const SWIFT_ADVANCE_DIST = 75;
export const HARDY_HP_MULT = 1.5;
/** Big Stripe: phase 1 Attack, phase 2 Slam (after Charge; full-table, banks once). */
export const BOSS_ATTACK = 4;
export const BOSS_SLAM = 8;

/** Base stats before any upgrade. meta/stats.ts clones this and applies nodes. */
export const BASE_STATS: RunStats = {
  maxHp: 16,
  armor: 0,
  damage: 1,
  speedDamage: 0,
  aimPreview: 0,
  beltGrip: 0,
  tokenId: 'stripe',
  mods: [],
  healOnKill: 0,
  waveHeal: 3,
  bossHeal: 0,
  rangedResist: 0,
  heavyHits: 0,
  massMult: 1,
  reflex: 0,
  lightningChance: 0,
  lightningArcs: 0,
  lightningRange: 0,
  lightningDamage: 0,
  splitCount: 0,
  spitInterval: 0,
  spitLife: 0,
  spitDamage: 0,
  comboChain: 0,
  comboBank: 0,
  comboCascade: 0,
  comboSweep: 0,
  comboLockdown: 0,
  ballType: 'standard',
  bumpers: 0,
  crates: 0,
  chests: 0,
  shrineChance: 0,
  chestCash: 25,
  crateCash: 8,
  shrineHeal: 8,
  bumperBounce: 1.15,
  cashMult: 1,
  cue: 'standard',
  relics: [],
  trick: null,
  trickUses: 0,
  gearLevel: {},
};

/** Hero ball types. The hero is always r 12; types change mass, speed and damage. Sticky = stun shot. */
export const HERO_R = 12;
export const BALL_TYPES = {
  standard: { r: HERO_R, mass: 1, speedMult: 1, dmgBonus: 0 },
  heavy: { r: HERO_R, mass: 2, speedMult: 0.8, dmgBonus: 1 },
  light: { r: HERO_R, mass: 0.6, speedMult: 1.25, dmgBonus: 0 },
  sticky: { r: HERO_R, mass: 1, speedMult: 1, dmgBonus: 0 }, // stops dead on first enemy contact, +1 stagger
} as const;
/** v0.6 ball cards, by card level (base I..III): Heavy mass, Light speed, Sticky stagger (STICKY_STAGGER: data only until the sim reads it). */
export const HEAVY_MASS = [2, 2.25, 2.5, 2.75];
export const LIGHT_SPEED = [1.25, 1.3, 1.35, 1.4];
export const STICKY_STAGGER = [1, 2, 3, 4];
/** BALL_TYPES entry for a ball at card level `lv` (Heavy mass and Light speed grow with the card). */
export function ballSpec(type: keyof typeof BALL_TYPES, lv = 0): { r: number; mass: number; speedMult: number; dmgBonus: number } {
  const b = BALL_TYPES[type] ?? BALL_TYPES.standard;
  if (type === 'heavy') return { ...b, mass: gearVal(HEAVY_MASS, lv) };
  if (type === 'light') return { ...b, speedMult: gearVal(LIGHT_SPEED, lv) };
  return b;
}

export const SPIT_LIFE_CAP = 3;

// ---------- v0.3 scaling (DESIGN-v0.3.md "Scaling"; tuned by the multi-stage bot in tests/proto.test.ts) ----------
/** Per global stage index n: enemy HP x HP_GROWTH^n (boss included), attack x ATK_GROWTH^n, cash x CASH_GROWTH^n. */
export const HP_GROWTH = 1.22;
export const ATK_GROWTH = 1.15;
export const CASH_GROWTH = 1.22;
/** Cash per kill at n = 0 (Felt 1). */
export const BASE_CASH_SCALE = 0.5;
/** Modifier strengths. */
export const HARDY_MOD_HP = 1;
export const HARDY_MOD_COUNT = 0.2;
/** Per-slot difficulty (slot 1..4): enemy HP and attack multipliers on top of scaling (smooths modifier bumps). */
export const SLOT_HP_MULT = [1, 1.05, 1.2, 1.05];
export const SLOT_ATK_MULT = [1, 1, 1.1, 1];
export const SWIFT_MOD = 1.5;
/** Ranged: extra skirmishers per wave and Shoot damage bonus (before attack scaling). */
export const RANGED_EXTRA = 1;
export const RANGED_SHOOT = 1;
/** Ranged's Shoot bonus applies from this slot on. */
export const RANGED_SHOOT_SLOT = 3;
export const THIN_RAILS_BOUNCE = 0.65;
export const EARLY_BOSS_WAVES = 2;
/** Ice hazard patches: friction and rolling deceleration x this inside a patch (near zero; a trace keeps phases finite). */
export const ICE_PATCH_FRICTION = 0.1;
/** Dark: an intent is shown only when the enemy is within max(its reach, DARK_REVEAL_R) px (edge gap) of the hero. */
export const DARK_REVEAL_R = 80;

// ---------- v0.5 Clockwork Works (world 3) ----------
/** Conveyor sweep: px a body is carried per pass (slides to first contact), and the hold before it fires (s). */
export const BELT_SHIFT = 24;
export const BELT_HOLD = 0.3;
/** Hero carry by CLEATS level (RunStats.beltGrip 0/1/2). */
export const BELT_GRIP_SHIFT = [24, 12, 0];
/** Conveyor rect sizes (w x h, centre-anchored): horizontal 100 x 20, vertical 20 x 80. */
export const BELT_SIZE = { h: { w: 100, h: 20 }, v: { w: 20, h: 80 } } as const;
/** Gear obstacle: restitution, minimum kick (px/s) and the clockwise deflection of the exit velocity (deg, y-down). */
export const GEAR_BOUNCE = 0.9;
export const GEAR_MIN_KICK = 80;
export const GEAR_SPIN_DEG = 35;
/** The turned exit stays within this angle of the outward normal (a glancing exit is turned less), so nothing orbits. */
export const GEAR_EXIT_MAX_DEG = 75;
/** Tinker Repair: range (edge gap, px) and heal (x stage hpScale, ceil). */
export const REPAIR_RANGE = 70;
export const REPAIR_HEAL = 2;
/** Cogs per regular wave (extras become grunts) and live boss-summoned cogs. */
export const COG_WAVE_CAP = 2;
export const BOSS_COG_CAP = 2;
/** The Mainspring's soft roll after Wind / Charge / Summon (px). */
export const MAINSPRING_MOVE_DIST = 40;

/** Stage definitions are generated (core/worlds.ts); this delegates to the memoised generator. */
export function stageById(id: StageId): StageDef {
  return makeStage(id);
}

// ---------- v0.4 gear (DESIGN-v0.4-loadout). Arrays are indexed by gearLevel (clamped to the last entry). ----------
/** Break cue: launch speed x this (doc 1.35; bot-tuned v0.4: it was the first emerald buy and trivialised w2/w3); every shot fires at >= BREAK_MIN_POWER. */
export const BREAK_SPEED_MULT = 1.2;
export const BREAK_MIN_POWER = 0.5;
/**
 * v0.6 cue cards by level. The sim still reads the scalars above (level 0); these per-level tables are data only until
 * the sim reads them (owner: sim touches limited in M2).
 */
export const BREAK_SPEED_MULT_LV = [1.2, 1.25, 1.25, 1.3];
export const BREAK_MIN_POWER_LV = [0.5, 0.5, 0.4, 0.4];
/** Jump cue: damage penalty on the first contact after landing (min 1; negative = bonus). */
export const JUMP_PENALTY = [1, 0, -1, -2];
/** Draw cue: launch power x DRAW_POWER (doc trade); after the first contact the ball heads back to the launch point at DRAW_RETURN x launch speed. */
export const DRAW_POWER = 0.8;
export const DRAW_RETURN = 0.5;
export const DRAW_POWER_LV = [0.8, 0.85, 0.9, 0.95];
/** Follow cue: after the first contact the ball keeps FOLLOW_KEEP x its pre-impact velocity; charges deal +FOLLOW_CHARGE_EXTRA. */
export const FOLLOW_KEEP = 0.6;
export const FOLLOW_CHARGE_EXTRA = 1;
export const FOLLOW_KEEP_LV = [0.6, 0.7, 0.75, 0.8];
/** Poison: stacks per ball contact (+1 per level), cap by level; level >= POISON_NO_DECAY_LV: stacks never decay. */
export const POISON_MAX = [4, 4, 5, 6];
export const POISON_NO_DECAY_LV = 2;
/** Explosive: blast radius (px, edge gap from the impact point) and ball speed kept, by level. Blast = floor(dmg/2), min 1. */
export const EXPLOSIVE_R = [36, 46, 56, 66];
export const EXPLOSIVE_KEEP = [0.5, 0.5, 1, 1];
/** Chill: phases, charge speed / reach multiplier, Advance multiplier. */
export const CHILL_PHASES = [1, 2, 3, 4];
export const CHILL_CHARGE_MULT = 0.6;
export const CHILL_ADVANCE_MULT = 0.5;
/** Shrapnel: shards per ball kill, shard life (s), damage, launch speed (px/s). */
export const SHRAPNEL_COUNT = [2, 3, 4, 5];
export const SHARD_LIFE = 0.8;
export const SHARD_DMG = 1;
export const SHARD_SPEED = 220;
/** Static: damage when an enemy crosses its stagger threshold. */
export const STATIC_DMG = [1, 2, 3, 4];
/** Ricochet: +1 damage per main-ball rail bounce before the first hit, capped. */
export const RICOCHET_MAX = [3, 5, 6, 7];
/** Thorns relic: damage to an enemy whose charge lands on the hero. */
export const THORNS_RELIC_DMG = [2, 3, 4, 5];
/** Momentum: cap; a shot with >= MOMENTUM_HITS hits adds +1, fewer resets. */
export const MOMENTUM_MAX = [2, 4, 5, 6];
export const MOMENTUM_HITS = 2;
/** Mirror: chance a Shoot is reflected (no damage to the hero, MIRROR_DMG to the shooter). */
export const MIRROR_CHANCE = [0.3, 0.5, 0.6, 0.7];
/** Lantern reach by card level (data only until the sim reads it; the sim's Lantern is on/off). */
export const LANTERN_REACH = [0, 1, 2, 3];
export const MIRROR_DMG = 1;
/** Tricks: base uses per run (+1 per card base level, applied by meta into RunStats.trickUses). */
export const TRICK_USES: Record<'recall' | 'timeStop' | 'rackEm' | 'shockwave', number> = { recall: 1, timeStop: 1, rackEm: 1, shockwave: 2 };
export const RACK_PULL = 20;
export const SHOCKWAVE_R = 60;
/** Recall spot (bottom centre, same as the run start). */
export const RECALL_Y_OFFSET = 24;

/** Value for gear level `lv` from a per-level table (clamped). */
export function gearVal(table: readonly number[], lv: number): number {
  return table[Math.max(0, Math.min(table.length - 1, lv))];
}

// ---------- v0.6 M1: the Loot Goblin (replaces Overtime) and boss tokens ----------
/** Goblin rest spot when the loot phase starts (else the nearest free spot, findFreeNear). */
export const GOBLIN_SPAWN = { x: 90, y: 106 } as const;
/** Shots in the loot phase. */
export const LOOT_PULLS = 3;
/** Loot phase holds (s, sim time): the goblin's arrival before the first pull; after each pull (scurry animation). */
export const LOOT_ARRIVE_HOLD = 0.5;
export const SCURRY_HOLD = 0.35;
/** A ball contact on the goblin counts as a hit above this approach speed (px/s), after separating and this cooldown (s). */
export const GOBLIN_HIT_SPEED = 40;
export const GOBLIN_HIT_COOLDOWN = 0.25;
/** Loot per goblin hit: a seeded tier draw; cash = max(1, round(boss kill cash x LOOT_FRAC[tier])). */
export const LOOT_WEIGHTS = { small: 60, big: 32, jackpot: 8 } as const;
export const LOOT_FRAC = { small: 0.08, big: 0.2, jackpot: 0.6 } as const;
/** The golden tooth (+1 token) drops on this goblin hit of the loot phase. */
export const TOOTH_HIT = 4; // 3 pulls, 4 hits: the tooth needs one multi-hit (bots land 1 hit per pull nearly always)
/** Boss tokens: first kill of a world's slot-4 stage (bestWave < 4) pays TOKENS_FIRST_SLOT4, every other kill TOKENS_KILL. */
export const TOKENS_FIRST_SLOT4 = 3;
export const TOKENS_KILL = 1;

// ---------- v0.6 M2: islands and gallery cards ----------
/** Price lever per island: [k] multiplies every cash node of island k ([0] unused). Read lazily by the cost functions. */
export const ISLAND_PRICE_MULT: number[] = [1, 1, 1, 1, 1, 1, 1];
/** Card base price (cash) before x CASH_GROWTH^(4(world-1)) x 2^level. */
export const CARD_BASE_PRICE = { cue: 150, ball: 150, relic: 200, trick: 300 } as const;
