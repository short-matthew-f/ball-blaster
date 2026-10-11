// All balance numbers live here. Sim and meta both read from this file.
import type { Formation, RunStats, StageDef, StageId, TargetDef, TargetKind, WaveDef } from './types';

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
export const BLAST_ENEMY_R = 40;
export const BLAST_ENEMY_DMG = 3;
export const CLERIC_RANGE = 60;
/** Frost: freezes an ally within FROST_RANGE (edge gap) for FREEZE_PHASES enemy phases; max FREEZE_CAP frozen. */
export const FROST_RANGE = 60;
export const FREEZE_PHASES = 3;
export const FREEZE_CAP = 2;
/** A frozen enemy ignores hits below SHATTER_SPEED (approach, px/s); at or above it shatters (kill + blast). */
export const SHATTER_SPEED = 160;
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
export const WAVE_CASH = 8; // x wave number
/** Enrage starts at turn ENRAGE_BASE + ENRAGE_PER_WAVE x wave; +1 attack per turn after. */
export const ENRAGE_BASE = 8;
export const ENRAGE_PER_WAVE = 2;
export const OVERTIME_CASH_MULT = 2;
/** Enemy HP scaling (step 3): x(1 + WAVE_HP_STEP) per stage wave after the first; +OVERTIME_HP_PER_WAVE x k in Overtime wave k. */
export const WAVE_HP_STEP = 0.25;
export const OVERTIME_HP_PER_WAVE = 2;
export const ELITE_CASH_MULT = 2;
/** Elite Swift: soft-roll distance (+25 %). Hardy: HP multiplier. */
export const SWIFT_ADVANCE_DIST = 75;
export const HARDY_HP_MULT = 1.5;
/** Old Eight: phase 1 Attack, phase 2 Slam (after Charge; full-table, banks once). */
export const BOSS_ATTACK = 4;
export const BOSS_SLAM = 8;

/** Base stats before any upgrade. meta/stats.ts clones this and applies nodes. */
export const BASE_STATS: RunStats = {
  maxHp: 16,
  armor: 0,
  damage: 1,
  speedDamage: 0,
  aimPreview: 0,
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
  strayEmeraldChance: 0,
  chestCash: 25,
  crateCash: 8,
  shrineHeal: 8,
  bumperBounce: 1.15,
  cashMult: 1,
};

/** Hero ball types. The hero is always r 12; types change mass, speed and damage. Sticky = stun shot. */
export const HERO_R = 12;
export const BALL_TYPES = {
  standard: { r: HERO_R, mass: 1, speedMult: 1, dmgBonus: 0 },
  heavy: { r: HERO_R, mass: 2, speedMult: 0.8, dmgBonus: 1 },
  light: { r: HERO_R, mass: 0.6, speedMult: 1.25, dmgBonus: 0 },
  sticky: { r: HERO_R, mass: 1, speedMult: 1, dmgBonus: 0 }, // stops dead on first enemy contact, +1 stagger
} as const;

export const SPIT_LIFE_CAP = 3;
export const EMERALD_REPEAT_DECAY = 0.68; // reward = max(1, round(base * decay^priorKills)); felt 5 -> 5,3,2,2,1...

// Formation weights by wave (step 3): racks break for 3-4 hits; Scatter appears only in Overtime.
const W1_FORM: Partial<Record<Formation, number>> = { rack: 1 };
const W2_FORM: Partial<Record<Formation, number>> = { rack: 60, wall: 40 };
const W3_FORM: Partial<Record<Formation, number>> = { rack: 30, wall: 30, pincer: 25, ring: 15 };
const BOSS_FORM: Partial<Record<Formation, number>> = { pincer: 50, ring: 50 };
/** Overtime waves reuse their wave's weights plus Scatter at this weight. */
export const OVERTIME_SCATTER_WEIGHT = 20;

const FELT_WAVES: WaveDef[] = [
  { slots: ['grunt', 'grunt', 'skirmisher'], formations: ['rack'], formationWeights: W1_FORM },
  { slots: ['grunt', 'grunt', 'skirmisher', ['bouncer', 'thornback'], 'brute'], formations: ['rack', 'wall'], formationWeights: W2_FORM },
  { slots: ['grunt', 'skirmisher', 'bomber', ['broodmother', 'hive'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring'], formationWeights: W3_FORM, elite: 4 },
];

const ICE_WAVES: WaveDef[] = [
  { slots: ['grunt', 'grunt', 'frost', 'skirmisher'], formations: ['rack'], formationWeights: W1_FORM },
  { slots: ['grunt', 'frost', 'skirmisher', ['bouncer', 'thornback'], 'brute'], formations: ['rack', 'wall'], formationWeights: W2_FORM },
  { slots: ['grunt', 'frost', 'bomber', ['broodmother', 'thornback'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring'], formationWeights: W3_FORM, elite: 4 },
];

export const STAGES: StageDef[] = [
  {
    id: 'felt',
    index: 0,
    name: 'Felt Hall',
    friction: 0.6,
    rollDecel: 70,
    wallBounce: 0.75,
    waves: FELT_WAVES,
    bossWave: { slots: ['boss', 'grunt', 'cleric'], formations: ['pincer', 'ring'], formationWeights: BOSS_FORM },
    hpScale: 1,
    cashScale: 0.5,
    emeraldReward: 5,
    boss: { name: 'Old Eight', hp: 60, r: 23, phases: [0.5], cadre: 0 },
  },
  {
    id: 'ice',
    index: 1,
    name: 'Ice Cavern',
    friction: 0.4,
    rollDecel: 45,
    wallBounce: 0.92,
    waves: ICE_WAVES,
    bossWave: { slots: ['boss', 'frost', 'grunt'], formations: ['pincer', 'ring'], formationWeights: BOSS_FORM },
    hpScale: 1.5,
    cashScale: 2.2,
    emeraldReward: 6,
    boss: { name: 'Rime Golem', hp: 40, r: 23, phases: [0.5], cadre: 3 },
  },
];

export function stageById(id: StageId): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
