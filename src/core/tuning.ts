// All balance numbers live here. Sim and meta both read from this file.
import type { RunStats, StageDef, StageId, TargetDef, TargetKind } from './types';

export const TARGET_DEFS: Record<TargetKind, TargetDef> = {
  basic: { hp: 3, r: 6, cash: 6, drain: 0, meter: 1, bounce: 1 },
  armored: { hp: 8, r: 7, cash: 12, drain: 2, meter: 1, bounce: 0.9 },
  bouncy: { hp: 4, r: 7, cash: 6, drain: 0, meter: 1, bounce: 1.3 },
  moving: { hp: 3, r: 6, cash: 6, drain: 0, meter: 1, bounce: 1, drift: 12 },
  splitting: { hp: 4, r: 7, cash: 6, drain: 0, meter: 1, bounce: 1, splitsInto: { kind: 'mini', count: 2 } },
  volatile: { hp: 2, r: 6, cash: 7, drain: 0, meter: 1, bounce: 1, explodeR: 24, explodeDmg: 3 },
  mini: { hp: 1, r: 4, cash: 2, drain: 0, meter: 1, bounce: 1 },
  cadre: { hp: 6, r: 5, cash: 4, drain: 0, meter: 0, bounce: 1 },
  boss: { hp: 36, r: 14, cash: 60, drain: 1, meter: 0, bounce: 0.9 },
  // Active tier (DECISIONS.md "Active target tier").
  warden: { hp: 5, r: 7, cash: 10, drain: 0, meter: 1, bounce: 1 },
  hive: { hp: 6, r: 8, cash: 14, drain: 0, meter: 1, bounce: 0.9 },
  spore: { hp: 1, r: 4, cash: 1, drain: 0, meter: 0, bounce: 1 },
  frost: { hp: 4, r: 7, cash: 12, drain: 0, meter: 1, bounce: 0.8 },
};

/** Active tier: kinds that run the telegraph -> execute cycle in the enemy phase. */
export const ACTIVE_KINDS: readonly TargetKind[] = ['warden', 'hive', 'frost'];
/** Max distance (centre to centre) a warden/frost can pick a target from. */
export const ACTIVE_RANGE = 40;
/** Board caps: live shielded targets, live frozen targets, live spores. */
export const SHIELD_CAP = 2;
export const FREEZE_CAP = 2;
export const SPORE_CAP = 4;
/** Enemy phases a freeze lasts. */
export const FREEZE_PHASES = 3;
/** Pre-impact ball speed (px/s) at or above which a frozen target shatters. */
export const SHATTER_SPEED = 160;
/** Shatter blast radius (plus the victim's r) and damage. */
export const SHATTER_R = 20;
export const SHATTER_DMG = 2;
/** Restitution off a frozen target. */
export const FROZEN_BOUNCE = 1.1;

/** Base stats before any upgrade. meta/stats.ts clones this and applies nodes. */
export const BASE_STATS: RunStats = {
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

export const BALL_TYPES = {
  standard: { r: 3.5, mass: 1, speedMult: 1, dmgBonus: 0 },
  heavy: { r: 4.5, mass: 2, speedMult: 0.8, dmgBonus: 1 },
  light: { r: 2.5, mass: 0.6, speedMult: 1.25, dmgBonus: 0 },
  sticky: { r: 3.5, mass: 1, speedMult: 1, dmgBonus: 0 }, // sticks briefly to a hit target, hitting it again on release
} as const;

export const SPIT_LIFE_CAP = 3;
export const EMERALD_REPEAT_DECAY = 0.68; // reward = max(1, round(base * decay^priorKills)); felt 5 -> 5,3,2,2,1...
/** Base refill (via the shared curve) when the last regular target on the board dies during a shot. */
export const BOARD_CLEAR_REFILL = 4;
/** Sticky ball: seconds held on a hit target, and release speed as a fraction of the impact speed. */
export const STICKY_HOLD_SECONDS = 0.25;
export const STICKY_RELEASE_MULT = 0.6;

export const STAGES: StageDef[] = [
  {
    id: 'felt',
    index: 0,
    name: 'Felt Hall',
    friction: 0.6,
    rollDecel: 70,
    wallBounce: 0.75,
    openingBoard: ['basic', 'basic', 'armored'],
    pool: [
      { kind: 'basic', weight: 50 },
      { kind: 'armored', weight: 15 },
      { kind: 'bouncy', weight: 10 },
      { kind: 'moving', weight: 10 },
      { kind: 'volatile', weight: 10 },
      { kind: 'splitting', weight: 5 },
      { kind: 'warden', weight: 8, minEnemyCount: 5, maxLive: 2 },
      { kind: 'hive', weight: 6, minEnemyCount: 6, maxLive: 1 },
    ],
    densityCap: 8,
    hpScale: 1,
    cashScale: 1,
    meterKills: 14,
    emeraldReward: 5,
    boss: {
      name: 'Old Eight',
      hp: 36,
      r: 14,
      phases: [0.5],
      phaseFx: [[], ['drain', 'spawnMini']],
      cadre: 0,
      moves: false,
    },
  },
  {
    id: 'ice',
    index: 1,
    name: 'Ice Cavern',
    friction: 0.4,
    rollDecel: 45,
    wallBounce: 0.92,
    openingBoard: ['basic', 'armored', 'volatile', 'basic'],
    pool: [
      { kind: 'basic', weight: 40 },
      { kind: 'armored', weight: 20 },
      { kind: 'bouncy', weight: 10 },
      { kind: 'moving', weight: 15 },
      { kind: 'volatile', weight: 10 },
      { kind: 'splitting', weight: 5 },
      { kind: 'frost', weight: 12, maxLive: 2 },
    ],
    densityCap: 9,
    hpScale: 2.5,
    cashScale: 2.2,
    meterKills: 14,
    emeraldReward: 6,
    boss: {
      name: 'Rime Golem',
      hp: 36,
      r: 14,
      phases: [0.6, 0.3],
      phaseFx: [[], ['bouncy'], ['bouncy', 'spawnMini']],
      cadre: 3,
      moves: false,
    },
  },
];

export function stageById(id: StageId): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
