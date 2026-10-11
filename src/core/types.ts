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
// HUD band: y 0..TABLE.y-6 (HP, cash). Boss meter band: y TABLE.y+TABLE.h+6..VIEW_H.

export const SIM_DT = 1 / 240;

import type { Rng } from './rng';

// ---------- Sim constants ----------
export const MAX_PULL = 60; // px of drag for full power
export const MAX_LAUNCH_SPEED = 480; // px/s
export const CANCEL_RADIUS = 12; // release within this drag length = cancel, no cost
export const STOP_SPEED = 6; // px/s; below this a ball snaps to rest
export const SPEED_DMG_REF = 200; // px/s per +speedDamage
export const FAST_FORWARD_MULT = 4;
export const SHIMMER_SECONDS = 0.5;
export const MAX_RESOLVE_SECONDS = 12; // stall guard: force rest
/** Enemy phase stall guard (seconds) and launch spacing. */
export const MAX_ENEMY_SECONDS = 4;
export const LAUNCH_GAP = 0.15;
/** Minimum shot power (fraction of full) for any release past the cancel radius. */
export const MIN_POWER = 0.25;
export const CURVE_CAP = 1.0; // total healing per run <= CURVE_CAP * maxHp
/** Boss arrival zone (cleared of regular targets on arrival). */
export const BOSS_ZONE = { x: 50, y: 50, w: 80, h: 60 } as const;

export interface Vec {
  x: number;
  y: number;
}

// ---------- Stage ----------

export type StageId = 'felt' | 'ice' | 'clock' | 'bog';

export type Formation = 'rack' | 'wall' | 'pincer' | 'ring' | 'scatter';

/** One wave: each slot is a kind, or a list of alternatives rolled with s.rng. */
export interface WaveDef {
  slots: (TargetKind | TargetKind[])[];
  formations: Formation[];
  /** Index into `slots` of the elite (from wave 3), or -1/absent for none. */
  elite?: number;
}

export interface StageDef {
  id: StageId;
  index: number; // 0-based order
  name: string;
  /** Hero proportional speed decay per second (v *= 1 - friction*dt). Enemies use ENEMY_FRICTION_MULT x this. */
  friction: number;
  /** Hero constant rolling deceleration in px/s^2 (kills the exponential tail). */
  rollDecel: number;
  /** Wall restitution 0..1 (hero). Enemies use ENEMY_WALL_BOUNCE x their kind bounce. */
  wallBounce: number;
  /** Regular waves, then the boss wave (last entry). */
  waves: WaveDef[];
  bossWave: WaveDef;
  /** Multiplier on all enemy HP for this stage (stage balance). */
  hpScale: number;
  /** Cash per kill multiplier. */
  cashScale: number;
  boss: BossDef;
  /** Emeralds for first boss kill; repeats pay less (see tuning). */
  emeraldReward: number;
}

export interface BossDef {
  name: string;
  hp: number;
  r: number;
  /** HP fractions where the boss enters its next phase, descending, e.g. [0.5]. */
  phases: number[];
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
  | 'grunt'
  | 'skirmisher'
  | 'bouncer'
  | 'bomber'
  | 'broodmother'
  | 'grub' // summon (broodmother split, hive, boss); never counts for wave clear
  | 'thornback'
  | 'brute'
  | 'cleric'
  | 'hive'
  | 'boss';

/** Alias: v0.2 enemies are physics bodies. `Target` is kept so render/ui keep compiling. */
export type EnemyKind = TargetKind;

export type IntentType = 'attack' | 'shoot' | 'advance' | 'charge' | 'guard' | 'detonate' | 'summon' | 'rest';

export interface Intent {
  t: IntentType;
  /** Damage for attack/shoot (already includes charge doubling; enrage is added on execute). */
  n?: number;
}

export type EliteMod = 'spiky' | 'hardy' | 'swift';

/** An enemy: a ball with mass, friction, HP and a visible intent. */
export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  hp: number;
  maxHp: number;
  resting: boolean;
  /** Visible intent, executed in the enemy phase unless staggered. */
  intent: Intent;
  /** Contact hits taken since the last enemy phase; >= the kind's threshold = skips its intent. */
  stagger: number;
  /** Seconds of spawn shimmer remaining (render only; spawns are solid immediately). */
  shimmer: number;
  /** Seconds of hit-flash remaining (render only). */
  flash: number;
  /** Boss: current phase index (0-based). */
  phase: number;
  /** Boss shielded by live cadre (unused in Felt). */
  shielded: boolean;
  dead: boolean;
  /** 1-hit shield (Guard intent / cleric): the next damaging hit is absorbed and strips it. */
  shield?: number;
  /** Enemy phases left frozen (> 0 = frozen: static body, skips intent). */
  frozen?: number;
  /** Legacy active-tier telegraph fields (cleric guard target uses aimId). */
  act?: number;
  aimId?: number;
  /** Damage this body deals on its first hero contact during the current charge (0/absent = not charging). */
  chargeDmg?: number;
  /** Charge intent executed: the next attack is doubled and faster. */
  charged?: boolean;
  /** Fixed-cycle position (bomber). */
  cycle?: number;
  /** Elite modifier (double cash, crown). */
  elite?: EliteMod;
  /** Summons (grubs) never count for wave clear. */
  summon?: boolean;
  /** Overtime: extra attack per action. */
  atkBonus?: number;
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
  | 'over'; // hero HP <= 0 after an enemy phase (or a shot); summary pending

export interface ComboTally {
  /** Contact hits this shot (hero/split/spat contacts, enemy-enemy bumps, lightning, explosions). */
  hits: number;
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
  mass: number;
  cash: number;
  /** Restitution factor in collisions involving this body (bouncer 1.3, brute 0.8). */
  bounce: number;
  /** Contact hits in one shot needed to skip its intent. */
  staggerAt: number;
  /** Weighted intent table (rolled after each enemy phase). Bomber/brute/boss use scripted cycles. */
  intents: { t: IntentType; n?: number; weight: number }[];
  /** Charge launch speed (px/s) and reach (edge-to-edge px) for Attack. */
  chargeSpeed: number;
  reach: number;
  /** Charge speed when charged (Charge intent). Defaults to chargeSpeed * 1.25. */
  chargedSpeed?: number;
  /** Attack value after a Charge (default: 2x the base attack). */
  chargedAttack?: number;
  /** Damage to the hero per hero contact (thornback). */
  thorns?: number;
  /** On death: explode (bomber). */
  explodes?: boolean;
  /** On death: spawn these. */
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
  /** Hero health. */
  hp: number;
  maxHp: number;
  /** Shared heal curve state: cumulative HP healed this run. */
  healed: number;
  cash: number;
  emeralds: number;
  kills: number;
  shots: number;
  /** Current wave: 1..wavesPerStage = regular waves, wavesPerStage+1 = boss wave, beyond = Overtime. */
  wave: number;
  /** Enemy phases completed in the current wave (enrage clock). */
  waveTurn: number;
  /** Next wave spawns at the start of the next enemy phase. */
  wavePending: boolean;
  /** Kept for render compatibility: true once the boss wave is queued but not yet spawned. */
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
  /** Sticky ball: the stun stop already happened this shot. */
  stickyUsed: boolean;
  spitTimer: number;
  /** Enemy ids that executed an intent this enemy phase (they reroll; skipped ones keep theirs). */
  acted: number[];
  /** Seconds since release (resolve) or since the enemy phase began (enemy). */
  resolveTime: number;
  /** Enemy phase: ids still to act, in array order, and the time of the next launch. */
  enemyQueue: number[];
  enemyNext: number;
  /** Pair contact bookkeeping: "idA:idB" -> sim time of the last counted hit; and pairs touching last substep. */
  lastHit: Record<string, number>;
  touching: Record<string, boolean>;
  /** Jam-rule triggers this run. */
  jams: number;
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
  meterFill: number; // 0..1 wave progress reached this run (waves reached / (waves + boss))
  /** Highest wave reached. */
  wave: number;
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
  | { t: 'shatter'; x: number; y: number; r: number }
  /** Hero took damage (charge, shot, explosion, thorns). */
  | { t: 'heroHit'; x: number; y: number; dmg: number; src: TargetKind; how: 'charge' | 'shot' | 'blast' | 'thorns' }
  | { t: 'heroHeal'; x: number; y: number; amount: number }
  /** Enemy launched itself (charge / advance) in the enemy phase. */
  | { t: 'launch'; id: number; x: number; y: number; intent: IntentType }
  /** Ranged shot tracer. */
  | { t: 'tracer'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'blocked'; x: number; y: number }
  | { t: 'waveStart'; wave: number; overtime: boolean }
  | { t: 'enrage'; level: number }
  /** Jam rule nudged the hero from (x0,y0) to (x,y) before aim. */
  | { t: 'jam'; x0: number; y0: number; x: number; y: number };

// ---------- Derived per-run stats (meta -> sim contract) ----------

/** Everything the sim needs from progression. meta/stats.ts builds this from SaveData. Zero = locked/off. */
export interface RunStats {
  /** Hero max HP and flat armor (damage taken = attack - armor, min 1). */
  maxHp: number;
  armor: number;
  damage: number;
  /** Extra damage per (impact speed / SPEED_DMG_REF), floored. 0 = locked. */
  speedDamage: number;

  // --- Legacy v0.1 energy/board stats: unused by the v0.2 sim; meta trees are reworked in build step 5. ---
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
