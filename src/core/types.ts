// Shared contracts between modules. Every module imports from here; nothing here imports a module.
//
// Module boundaries
//   core/    rng, math, types, constants (no DOM)
//   sim/     deterministic simulation: physics, run state machine, energy, targets, boss, spawning, combos (no DOM)
//   meta/    upgrade trees, derived RunStats, save/load/export (localStorage only in save.ts)
//   render/  palette, sprites, bitmap font, canvas renderer, fx (shake, particles, hit-stop)
//   ui/      screens (title, run HUD, summary, shop, settings) drawn on canvas, input routing
//   audio/   procedural WebAudio sfx (no audio files)
//   main.ts  boot, game loop, screen switching
//
// Coordinate system: internal pixels of a VIEW_W x VIEW_H canvas, origin top-left, +y down.
// Time: seconds. Sim runs at a fixed timestep (SIM_DT); the sim never reads wall-clock time or Math.random.

export const VIEW_W = 180;
export const VIEW_H = 320;

/** Playfield inner rect (inside the rails). Balls and targets live inside this. */
export const TABLE = { x: 10, y: 34, w: 160, h: 252 } as const;
// HUD band: y 0..TABLE.y-6 (energy, cash). Boss meter band: y TABLE.y+TABLE.h+6..VIEW_H.

export const SIM_DT = 1 / 240;

import type { Rng } from './rng';

// ---------- Sim constants ----------
export const MAX_PULL = 60; // px of drag for full power
export const MAX_LAUNCH_SPEED = 480; // px/s
export const CANCEL_RADIUS = 12; // release within this drag length = cancel, no cost
export const STOP_SPEED = 6; // px/s; below this a ball snaps to rest
export const SPEED_DMG_REF = 200; // px/s per +speedDamage
export const FAST_FORWARD_MULT = 4;
export const ENEMY_PHASE_SECONDS = 0.4;
export const SHIMMER_SECONDS = 0.5;
export const MAX_RESOLVE_SECONDS = 12; // stall guard: force rest
export const CURVE_CAP = 1.0; // total refill per run <= CURVE_CAP * maxEnergy
/** Boss arrival zone (cleared of regular targets on arrival). */
export const BOSS_ZONE = { x: 50, y: 50, w: 80, h: 60 } as const;

export interface Vec {
  x: number;
  y: number;
}

// ---------- Stage ----------

export type StageId = 'felt' | 'ice' | 'clock' | 'bog';

export interface StageDef {
  id: StageId;
  index: number; // 0-based order
  name: string;
  /** Proportional speed decay per second (v *= 1 - friction*dt). */
  friction: number;
  /** Constant rolling deceleration in px/s^2 (kills the exponential tail). */
  rollDecel: number;
  /** Guaranteed kinds for the first spawns of a run (before the pool is used). */
  openingBoard: TargetKind[];
  /** Wall restitution 0..1. */
  wallBounce: number;
  /** Weighted spawn pool for regular targets. */
  pool: { kind: TargetKind; weight: number; minEnemyCount?: number; maxLive?: number }[];
  /** Max live regular targets regardless of enemyCount stat. */
  densityCap: number;
  /** Multiplier on all enemy HP for this stage (stage balance). */
  hpScale: number;
  /** Cash per kill multiplier. */
  cashScale: number;
  /** Kills needed to fill the boss meter. */
  meterKills: number;
  boss: BossDef;
  /** Emeralds for first boss kill; repeats pay less (see tuning). */
  emeraldReward: number;
}

export type BossPhaseFx = 'drain' | 'spawnMini' | 'bouncy';

export interface BossDef {
  name: string;
  hp: number;
  r: number;
  /** HP fractions where the boss enters its next phase, descending, e.g. [0.66, 0.33]. */
  phases: number[];
  /** Behaviours active in each phase (index 0 = before first threshold). Length = phases.length + 1. */
  phaseFx: BossPhaseFx[][];
  cadre: number; // number of shield minions, 0 = none
  moves: boolean;
}

// ---------- Entities ----------

export type BallKind = 'main' | 'split' | 'spat';
export type BallType = 'standard' | 'heavy' | 'light' | 'sticky';

export interface Ball {
  id: number;
  kind: BallKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  /** Seconds left before despawn; Infinity for main/split. */
  life: number;
  resting: boolean;
  /** True once this ball has hit a wall during the current shot (bank-shot combo). */
  banked: boolean;
  /** Sticky ball: seconds left held on a target (absent/0 = not stuck). Ball stays non-resting while held. */
  stuck?: number;
  /** Sticky ball: velocity to release with, target to hit again, and that hit's damage. */
  stuckVx?: number;
  stuckVy?: number;
  stuckTarget?: number;
  stuckDmg?: number;
}

export type TargetKind =
  | 'basic'
  | 'armored'
  | 'bouncy'
  | 'moving'
  | 'splitting'
  | 'volatile'
  | 'mini' // spawned by 'splitting'
  | 'boss'
  | 'cadre' // boss shield minion
  // Active tier (see DECISIONS.md "Active target tier")
  | 'warden' // shields a nearby regular target
  | 'hive' // spawns non-regular spores
  | 'spore' // spawned by 'hive'; not a regular target
  | 'frost'; // freezes a nearby regular target

export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  /** Drift velocity for 'moving' targets / moving bosses (applied during enemy phase). */
  vx: number;
  vy: number;
  /** Seconds of spawn shimmer remaining; > 0 means not yet solid. */
  shimmer: number;
  /** Seconds of hit-flash remaining (render only). */
  flash: number;
  /** Boss: current phase index (0-based). */
  phase: number;
  /** Boss shielded by live cadre. */
  shielded: boolean;
  dead: boolean;
  /** Active targets: 2 = ready to pick, 1 = telegraphed (executes next enemy phase). Absent for non-actives. */
  act?: number;
  /** Active targets: id of the target telegraphed for shield/freeze (renderer skips the link if not found). */
  aimId?: number;
  /** Warden shield on this target: 1 = absorbs the next damaging hit, 0/absent = none. */
  shield?: number;
  /** Frost: enemy phases left frozen (> 0 = frozen). */
  frozen?: number;
}

export type ObstacleKind = 'bumper' | 'crate' | 'chest' | 'shrine';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  r: number;
  hp: number; // crates/chests break; bumpers/shrines Infinity
  flash: number;
  dead: boolean;
}

// ---------- Run state machine ----------

export type TurnPhase =
  | 'aim' // waiting for player input; all balls at rest
  | 'resolve' // balls moving
  | 'enemy' // enemy phase animating (moves, respawns, boss arrival)
  | 'over'; // after settle + enemy phase, energy < releaseCost; summary pending

export interface ComboTally {
  kills: number;
  bankKills: number;
  bumperHits: number;
  chainKills: number; // kills from lightning or volatile explosions
  /** Cash earned from kills this shot (base for combo bonuses). Added by sim. */
  cash?: number;
}

export interface TargetDef {
  hp: number;
  r: number;
  cash: number;
  /** Extra energy drained when the main ball hits it (on top of hitCost). */
  drain: number;
  /** Boss-meter kills credited. */
  meter: number;
  /** Restitution multiplier on ball bounce (bouncy > 1). */
  bounce: number;
  explodeR?: number;
  explodeDmg?: number;
  /** px moved per enemy phase. */
  drift?: number;
  /** Kind + count spawned on death. */
  splitsInto?: { kind: TargetKind; count: number };
}

export interface RunState {
  stage: StageId;
  seed: number;
  rng: Rng;
  stats: RunStats;
  phase: TurnPhase;
  /** Sim time in seconds. */
  t: number;
  energy: number;
  /** Shared refill curve state: cumulative energy granted by refills this run. */
  refilled: number;
  cash: number;
  emeralds: number;
  kills: number;
  meterKills: number;
  shots: number;
  bossPending: boolean;
  bossSpawned: boolean;
  bossKilled: boolean;
  balls: Ball[];
  targets: Target[];
  obstacles: Obstacle[];
  /** Tally for the current shot (release -> all balls stopped). */
  combo: ComboTally;
  bestCombo: number;
  splitUsed: boolean;
  /** True once the board-clear bonus fired this shot (reset on shoot). */
  boardCleared?: boolean;
  spitTimer: number;
  respawnAccum: number;
  /** Countdown for enemy-phase animation. */
  phaseTimer: number;
  /** Seconds since release (stall guard). */
  resolveTime: number;
  nextId: number;
  result?: RunResult;
  /** Fx queued outside step() (e.g. by shoot()); drained at the start of the next step. */
  pendingFx?: FxEvent[];
}

/** Public sim API implemented by sim/index.ts. */
export interface SimApi {
  createRun(stage: StageId, stats: RunStats, seed: number, bestFill?: number): RunState;
  /** Advance by exactly dt (caller passes SIM_DT multiples). Returns fx emitted during the step. */
  step(s: RunState, dt: number): FxEvent[];
  /** pull = drag vector (finger start - finger now), ball launches along it. False if cancelled / not allowed. */
  shoot(s: RunState, pull: Vec): boolean;
  /** Aim-line points from the main ball, honoring stats.aimPreview wall bounces (empty if 0). */
  previewShot(s: RunState, pull: Vec): Vec[];
  /** True when only extra (split/spat) balls are still moving. */
  canFastForward(s: RunState): boolean;
}

export interface RunResult {
  stage: StageId;
  cash: number;
  emeralds: number;
  kills: number;
  meterFill: number; // 0..1 best fill reached this run
  bossKilled: boolean;
  shots: number;
  bestCombo: number;
  seconds: number;
}

/** Visual/audio events emitted by the sim for render + audio to consume. Sim never calls them directly. */
export type FxEvent =
  | { t: 'hit'; x: number; y: number; targetKind: TargetKind; ballKind: BallKind; dmg: number; killed: boolean }
  | { t: 'wall'; x: number; y: number; speed: number }
  | { t: 'bumper'; x: number; y: number }
  | { t: 'ballClack'; x: number; y: number; speed: number }
  | { t: 'kill'; x: number; y: number; targetKind: TargetKind; cash: number }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'lightning'; points: Vec[] }
  | { t: 'split'; x: number; y: number }
  | { t: 'spit'; x: number; y: number }
  | { t: 'energy'; x: number; y: number; amount: number } // + refill / - cost
  | { t: 'shimmer'; x: number; y: number }
  | { t: 'combo'; name: string; mult: number; x: number; y: number }
  | { t: 'bossArrive' }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDead'; x: number; y: number }
  | { t: 'emerald'; x: number; y: number; amount: number }
  | { t: 'shrine'; x: number; y: number }
  | { t: 'chest'; x: number; y: number; cash: number }
  | { t: 'shoot'; power: number }
  | { t: 'runOver' }
  /** The last regular target on the board died during a shot (once per shot). Board refills next enemy phase. */
  | { t: 'boardClear'; x: number; y: number }
  /** Active target telegraph ping (state lives on Target.act/aimId; renderer polls it). */
  | { t: 'telegraph'; x: number; y: number; kind: 'shield' | 'freeze' | 'spawn' }
  | { t: 'shieldUp'; x: number; y: number }
  | { t: 'shieldBreak'; x: number; y: number }
  | { t: 'freeze'; x: number; y: number }
  | { t: 'thaw'; x: number; y: number }
  | { t: 'shatter'; x: number; y: number; r: number };

// ---------- Derived per-run stats (meta -> sim contract) ----------

/** Everything the sim needs from progression. meta/stats.ts builds this from SaveData. Zero = locked/off. */
export interface RunStats {
  damage: number;
  /** Extra damage per (impact speed / SPEED_DMG_REF), floored. 0 = locked. */
  speedDamage: number;

  maxEnergy: number;
  releaseCost: number;
  hitCost: number; // main-ball hit on a target
  bumperRefill: number; // base amount before the shared curve
  killRefillChance: number; // 0..1
  killRefillAmount: number;
  bossRefillPct: number; // 0..1 of maxEnergy

  enemyCount: number; // desired live regular targets
  respawnPerTurn: number; // targets added per enemy phase (fractional accumulates)
  aimPreview: number; // 0 = off, else number of wall bounces to preview

  lightningChance: number; // 0..1 per target hit
  lightningArcs: number;
  lightningRange: number; // px
  lightningDamage: number;

  splitCount: number; // children on first target hit of a shot; 0 = off
  spitInterval: number; // seconds between spat balls from main while moving; 0 = off
  spitLife: number; // seconds
  spitDamage: number;

  comboMultiKill: number; // 0 = locked; else cash bonus per extra kill (e.g. 0.25 = +25%)
  comboBank: number;
  comboBumperChain: number;
  comboChainReaction: number;
  comboEnergy: number; // energy granted per combo trigger (via shared curve); 0 = off

  ballType: BallType;
  bumpers: number;
  crates: number;
  chests: number;
  shrineChance: number;
  strayEmeraldChance: number; // per kill
  chestCash: number;
  crateCash: number;
  shrineEnergy: number; // via shared curve
  bumperBounce: number; // speed multiplier on bumper hit

  cashMult: number;
}

// ---------- Save ----------

export interface SaveData {
  version: 1;
  cash: number;
  emeralds: number;
  /** Upgrade node id -> level. Covers cash tree, emerald tree and stage sub-trees. */
  levels: Record<string, number>;
  /** Highest unlocked stage index. */
  unlocked: number;
  current: StageId;
  bestFill: Partial<Record<StageId, number>>;
  bossKills: Partial<Record<StageId, number>>;
  /** Equipped ball type (must be unlocked in emerald tree). */
  ballType: BallType;
  /** flash: false = reduced flashing (alpha fades, solid bolts, slow shimmer). Default from prefers-reduced-motion. */
  settings: { sound: boolean; shake: boolean; flash: boolean };
  /** One-shot onboarding / disclosure flags, e.g. 'shotTaught', 'tab:combo', 'tab:emerald', 'tab:stage'. */
  hints: Record<string, boolean>;
  stats: { runs: number; kills: number; shots: number };
}

// ---------- Upgrade tree data (meta) ----------

export type Currency = 'cash' | 'emerald';
export type TreeId = 'power' | 'energy' | 'board' | 'combo' | 'emerald' | `stage:${StageId}`;

export interface UpgradeNode {
  id: string;
  tree: TreeId;
  name: string;
  /** Short line for the shop card. Use {v} for the value at next level. */
  desc: string;
  currency: Currency;
  maxLevel: number;
  /** Cost to buy level (current+1). */
  cost: (level: number) => number;
  /** Node ids that must be >= 1 before this is purchasable. */
  requires?: string[];
  /** Grid position in the tree view (col 0..3, row 0..n). */
  pos: { col: number; row: number };
  /** Sprite name for the icon (render/sprites.ts). */
  icon: string;
  /** Applies this node's effect at `level` onto stats. */
  apply: (stats: RunStats, level: number) => void;
}

/**
 * Public meta API. Implemented by meta/index.ts as named exports with these exact signatures.
 * UI imports from 'meta/index'; sim never imports meta.
 */
export interface MetaApi {
  NODES: UpgradeNode[];
  newSave(): SaveData;
  /** Reads localStorage (try/catch); returns newSave() on missing/corrupt. */
  loadSave(): SaveData;
  writeSave(save: SaveData): void;
  /** Base64 string for clipboard export. */
  exportSave(save: SaveData): string;
  /** Validates + migrates; null if invalid. */
  importSave(text: string): SaveData | null;
  buildStats(save: SaveData): RunStats;
  nodeLevel(save: SaveData, id: string): number;
  /** Cost of next level, or null if maxed. */
  nextCost(save: SaveData, node: UpgradeNode): number | null;
  /** 'ok' | 'locked' (requires unmet or stage not reached) | 'maxed' | 'poor'. */
  buyState(save: SaveData, node: UpgradeNode): 'ok' | 'locked' | 'maxed' | 'poor';
  /** Mutates save; returns true on success. */
  buy(save: SaveData, node: UpgradeNode): boolean;
  /**
   * Banks a finished run: adds cash, emeralds (sim already applied repeat decay? no: meta computes boss emeralds
   * using bossKills + EMERALD_REPEAT_DECAY; sim's result.emeralds counts only stray drops), updates bestFill, bossKills,
   * unlocks next stage on boss kill, stats. Returns emeralds awarded for the boss and whether a stage unlocked.
   */
  bankRun(save: SaveData, result: RunResult): { bossEmeralds: number; unlocked: StageId | null };
}
