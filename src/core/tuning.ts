// All balance numbers live here. Sim and meta both read from this file.
import type { RunStats, StageDef, StageId, TargetDef, TargetKind, WaveDef } from './types';

// Roster (DESIGN-v0.2.md "Roster (Felt Hall)"). Masses: hero 1, grub 1.5, grunt 3, bouncer 2, brute 8, boss 20.
// reach = edge-to-edge gap (px) within which an Attack charges; beyond it, Attack executes as Advance.
export const TARGET_DEFS: Record<TargetKind, TargetDef> = {
  grunt: {
    hp: 3, r: 12, mass: 3, cash: 4, bounce: 1, staggerAt: 1, chargeSpeed: 260, reach: 90,
    intents: [{ t: 'attack', n: 2, weight: 50 }, { t: 'advance', weight: 35 }, { t: 'rest', weight: 15 }],
  },
  skirmisher: {
    hp: 3, r: 12, mass: 3, cash: 5, bounce: 1, staggerAt: 1, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'shoot', n: 1, weight: 60 }, { t: 'advance', weight: 40 }], // advance = sideways reposition
  },
  bouncer: {
    hp: 4, r: 14, mass: 2, cash: 7, bounce: 1.3, staggerAt: 2, chargeSpeed: 300, reach: 140,
    intents: [{ t: 'attack', n: 1, weight: 60 }, { t: 'rest', weight: 40 }],
  },
  bomber: {
    hp: 2, r: 13, mass: 2.5, cash: 7, bounce: 1, staggerAt: 1, chargeSpeed: 0, reach: 0, explodes: true,
    intents: [], // fixed cycle: advance, advance, detonate
  },
  broodmother: {
    hp: 5, r: 15, mass: 4, cash: 8, bounce: 1, staggerAt: 2, chargeSpeed: 220, reach: 80,
    splitsInto: { kind: 'grub', count: 2 },
    intents: [{ t: 'attack', n: 2, weight: 60 }, { t: 'rest', weight: 40 }],
  },
  grub: {
    hp: 1, r: 10, mass: 1.5, cash: 1, bounce: 1, staggerAt: 1, chargeSpeed: 240, reach: 80,
    intents: [{ t: 'attack', n: 1, weight: 70 }, { t: 'advance', weight: 30 }],
  },
  thornback: {
    hp: 5, r: 14, mass: 4, cash: 9, bounce: 1, staggerAt: 2, chargeSpeed: 240, reach: 85, thorns: 1,
    intents: [{ t: 'attack', n: 2, weight: 50 }, { t: 'guard', weight: 50 }],
  },
  brute: {
    hp: 8, r: 19, mass: 8, cash: 14, bounce: 0.8, staggerAt: 3, chargeSpeed: 200, chargedSpeed: 300, reach: 70,
    chargedAttack: 5,
    intents: [], // scripted: Charge -> Attack 5 (Advance while out of reach, keeping the charge)
  },
  cleric: {
    hp: 5, r: 14, mass: 3, cash: 10, bounce: 1, staggerAt: 2, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'guard', weight: 60 }, { t: 'shoot', n: 1, weight: 40 }], // guard = shield an ally
  },
  hive: {
    hp: 6, r: 17, mass: 6, cash: 14, bounce: 0.9, staggerAt: 3, chargeSpeed: 0, reach: 0,
    intents: [{ t: 'summon', weight: 50 }, { t: 'rest', weight: 50 }],
  },
  boss: {
    hp: 40, r: 23, mass: 20, cash: 60, bounce: 0.9, staggerAt: 4, chargeSpeed: 240, chargedSpeed: 400, reach: 90,
    intents: [], // scripted per phase (sim/enemy.ts)
  },
};

// ---------- v0.2 physics + enemy phase ----------
/** Enemy friction and rolling deceleration = this x the stage's hero values. */
export const ENEMY_FRICTION_MULT = 1.5;
/** Pair restitution = BASE_RESTITUTION x kind bounce of each enemy involved, capped at MAX_RESTITUTION. */
export const BASE_RESTITUTION = 0.9;
export const MAX_RESTITUTION = 1.3;
/** Enemy-wall restitution = this x the kind's bounce (bouncers bank, others die on the rail). */
export const ENEMY_WALL_BOUNCE = 0.6;
/** Enemy-enemy bump: 1 damage + 1 stagger to the bumped body above this relative impact speed (px/s). */
export const BUMP_DMG_SPEED = 60;
/** Ball contact on an enemy counts as a hit above this approach speed (px/s). */
export const HIT_MIN_SPEED = 15;
/** A pair must separate and wait this long (s) before another hit counts. */
export const HIT_COOLDOWN = 0.1;
/** Soft roll (Advance / reposition) launch speed: carries ~40 px. */
/**
 * A charger stops dead when its blow lands (the hero keeps the full knock). Without it heavy chargers (brute, boss)
 * plough on and pin the hero into rails/corners: jams 0.6-1.1/run -> <= 0.1/run in the step-1 bot.
 */
export const CHARGE_STOPS_ON_HIT = true;
export const ADVANCE_SPEED = 120;
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
export const WAVES_PER_STAGE = 3;
export const WAVE_CASH = 8; // x wave number
export const WAVE_HEAL = 3; // via the heal curve
/** Enrage starts at turn ENRAGE_BASE + ENRAGE_PER_WAVE x wave; +1 attack per turn after. */
export const ENRAGE_BASE = 8;
export const ENRAGE_PER_WAVE = 2;
export const OVERTIME_CASH_MULT = 2;
export const ELITE_CASH_MULT = 2;
/** Elite Swift: soft-roll speed (carries ~50 px). Hardy: HP multiplier. */
export const SWIFT_ADVANCE_SPEED = 135;
export const HARDY_HP_MULT = 1.5;
/** Old Eight: phase 1 Attack, phase 2 Slam (after Charge; full-table, banks once). */
export const BOSS_ATTACK = 4;
export const BOSS_SLAM = 8;

/** Base stats before any upgrade. meta/stats.ts clones this and applies nodes. */
export const BASE_STATS: RunStats = {
  maxHp: 20,
  armor: 0,
  damage: 1,
  speedDamage: 0,
  maxEnergy: 72,
  releaseCost: 8,
  hitCost: 1,
  bumperRefill: 3,
  killRefillChance: 0,
  killRefillAmount: 0,
  bossRefillPct: 0.25,
  enemyCount: 3,
  respawnPerTurn: 0.5,
  aimPreview: 0,
  lightningChance: 0,
  lightningArcs: 0,
  lightningRange: 0,
  lightningDamage: 0,
  splitCount: 0,
  spitInterval: 0,
  spitLife: 0,
  spitDamage: 0,
  comboMultiKill: 0,
  comboBank: 0,
  comboBumperChain: 0,
  comboChainReaction: 0,
  comboEnergy: 0,
  ballType: 'standard',
  bumpers: 0,
  crates: 0,
  chests: 0,
  shrineChance: 0,
  strayEmeraldChance: 0,
  chestCash: 25,
  crateCash: 8,
  shrineEnergy: 25,
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

const FELT_WAVES: WaveDef[] = [
  { slots: ['grunt', 'grunt', 'grunt', 'skirmisher'], formations: ['rack', 'wall', 'pincer'] },
  { slots: ['grunt', 'grunt', 'skirmisher', ['bouncer', 'thornback'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring'] },
  { slots: ['grunt', 'skirmisher', 'bomber', ['broodmother', 'hive'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring', 'scatter'], elite: 4 },
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
    bossWave: { slots: ['boss', 'grunt', 'cleric'], formations: ['rack'] },
    hpScale: 1,
    cashScale: 1,
    emeraldReward: 5,
    boss: { name: 'Old Eight', hp: 40, r: 23, phases: [0.5] },
  },
  {
    id: 'ice',
    index: 1,
    name: 'Ice Cavern',
    friction: 0.4,
    rollDecel: 45,
    wallBounce: 0.92,
    waves: FELT_WAVES,
    bossWave: { slots: ['boss', 'grunt', 'cleric'], formations: ['rack'] },
    hpScale: 2,
    cashScale: 2.2,
    emeraldReward: 6,
    boss: { name: 'Rime Golem', hp: 40, r: 23, phases: [0.5] },
  },
];

export function stageById(id: StageId): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
