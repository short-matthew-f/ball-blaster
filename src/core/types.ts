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

export interface Vec {
  x: number;
  y: number;
}

// ---------- Stage ----------

/** Stage ids: `w1s1` ... `w6s4` (world 1-6, slot 1-4); loops prefix `l<k>`, e.g. `l1w1s1`. See core/worlds.ts. */
export type StageId = string;

/** Stage modifiers (DESIGN-v0.3 "Modifier pool"). Picked per stage by core/worlds.ts; never twice in one world. */
export type Modifier =
  | 'ranged' // ranged-heavy: grunts become skirmishers/clerics
  | 'bombers' // double bombers
  | 'elite' // extra elite: one more elite on every wave
  | 'thinRails' // rails bounce 0.6
  | 'bigRack' // +1 enemy per wave
  | 'earlyBoss' // boss after 2 waves
  | 'wardens' // clerics/thornbacks common
  | 'swift' // all Advance +50 %
  | 'hardy' // +25 % HP, -20 % count
  | 'dark' // intents revealed only within reach (RunState.dark; see sim intentVisible)
  | 'hiveWorld' // one hive per wave
  | 'frostWorld'; // one frost per wave

/** Boss traits: phases (HP thresholds), cadre (shield minions), moves (repositions every phase). */
export type BossTrait = 'phases' | 'cadre' | 'moves';

/** Board hazards. Only 'ice' has behaviour yet (zero friction inside); the rest are data-only stubs. */
export type HazardKind = 'ice' | 'conveyor' | 'gear' | 'mud' | 'lava' | 'slot';

export interface Hazard {
  kind: HazardKind;
  x: number;
  y: number;
  /** Radius (circular hazards: ice, gear). Conveyors use r 0 with w/h. */
  r: number;
  /** Conveyor rect size (centre at x,y). */
  w?: number;
  h?: number;
  /** Conveyor unit direction (one of the four axes). The Mainspring's phase 2 negates these on RunState.hazards. */
  dx?: number;
  dy?: number;
}

export type Formation = 'rack' | 'wall' | 'pincer' | 'ring' | 'scatter';

/** One wave: each slot is a kind, or a list of alternatives rolled with s.rng. */
export interface WaveDef {
  slots: (TargetKind | TargetKind[])[];
  formations: Formation[];
  /** Optional weights per formation (overrides a uniform pick from `formations`). */
  formationWeights?: Partial<Record<Formation, number>>;
  /** Elite wave marker (from wave 3): >= 0 = one random regular of the wave is elite; -1/absent = none. */
  elite?: number;
  /** Number of elites (random regulars of the wave); overrides `elite` when set. */
  elites?: number;
}

export interface StageDef {
  id: StageId;
  /** Global stage index n (0 = w1s1, 23 = w6s4, 24 = l1w1s1). Drives scaling. */
  index: number;
  /** World 1-6, slot 1-4, loop 0+. */
  world: number;
  slot: number;
  loop: number;
  /** Display name, e.g. "Felt Hall 2". */
  name: string;
  modifiers: Modifier[];
  bossTraits: BossTrait[];
  /** Board hazards (copied onto RunState.hazards at run start). */
  hazards: Hazard[];
  /** Multiplier on enemy attack values (intents, blasts, thorns). */
  atkScale: number;
  /** Advance distance multiplier (swift). */
  advanceMult: number;
  /** Extra Shoot damage before scaling (ranged). */
  shootBonus: number;
  /** Wave-clear cash multiplier (scaling). */
  waveCashScale: number;
  /** Hero proportional speed decay per second (v *= 1 - friction*dt). Enemies use ENEMY_FRICTION_MULT x this. */
  friction: number;
  /** Hero constant rolling deceleration in px/s^2 (kills the exponential tail). */
  rollDecel: number;
  /** Wall restitution 0..1 (hero). Enemies use ENEMY_WALL_BOUNCE x their kind bounce. */
  wallBounce: number;
  /** Regular waves, then the boss wave (last entry). */
  waves: WaveDef[];
  bossWave: WaveDef;
  /** Multiplier on all enemy HP for this stage (scaling x modifiers); the boss uses boss.hp directly. */
  hpScale: number;
  /** Cash per kill multiplier. */
  cashScale: number;
  boss: BossDef;
}

export interface BossDef {
  name: string;
  /** Scaled HP for this stage. */
  hp: number;
  r: number;
  /** HP fractions where the boss enters its next phase, descending, e.g. [0.5]. */
  phases: number[];
  /** Shield minions spawned around the boss; the boss takes no damage while any lives. 0 = none. */
  cadre: number;
  /** v0.5: intent kit from the world's boss archetype (absent = 'stripe'). Sim rollIntent/checkBossPhase dispatch on it. */
  kit?: 'stripe' | 'golem' | 'mainspring';
}

// ---------- Entities ----------

export type BallKind = 'main' | 'split' | 'spat';
export type BallType = 'standard' | 'heavy' | 'light' | 'sticky';

// ---------- Gear (DESIGN-v0.4-loadout) ----------
/** Cue: how the shot behaves. */
export type CueId = 'standard' | 'break' | 'jump' | 'draw' | 'follow';
/** Relic: a rule-changing passive. lightning/split/spitter stats are honoured only when equipped. */
export type RelicId =
  | 'lightning'
  | 'split'
  | 'spitter'
  | 'poison'
  | 'explosive'
  | 'chill'
  | 'shrapnel'
  | 'static'
  | 'ricochet'
  | 'lantern'
  | 'thorns'
  | 'momentum'
  | 'mirror';
/** Trick: one active, no targeting, limited uses per run, usable only during aim. */
export type TrickId = 'recall' | 'timeStop' | 'rackEm' | 'shockwave';

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
  /** Shrapnel shard (a spat-like ball released by a kill). */
  shard?: boolean;
  /** Jump cue: id of the enemy being jumped (no collision until past its far edge). */
  jumpOver?: number;
  /** Jump cue: landed; the next enemy contact deals -1 (min 1). */
  jumpLanded?: boolean;
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
  | 'frost' // freezes an ally (Ice)
  | 'cadre' // boss shield minion (Rime Golem)
  | 'goblin' // Loot Goblin (loot phase): unkillable, never attacks; every player-ball contact drops loot
  | 'cog' // Clockwork: rolling gear; banked charge that ricochets and bumps its own side
  | 'tinker' // Clockwork: repairs (heals) the most damaged ally in range
  | 'boss';

/** Alias: v0.2 enemies are physics bodies. `Target` is kept so render/ui keep compiling. */
export type EnemyKind = TargetKind;

export type IntentType = 'attack' | 'shoot' | 'advance' | 'charge' | 'guard' | 'detonate' | 'summon' | 'rest' | 'repair' | 'wind' | 'flee';

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
  /**
   * Dead but still rolling (s): a body killed mid-shot keeps its momentum for a moment and can still bump live
   * enemies (cascades survive kills). Invisible (dead); never touches balls; removed at shot end.
   */
  ghost?: number;
  /** Poison relic: stacks (damage at the start of each enemy phase). */
  poison?: number;
  /** Chill relic: enemy phases left chilled (charge speed/reach x0.6, Advance x0.5). */
  chill?: number;
  /** Cog: rail contacts during the current charge (reset at launch; the second stops the charge). */
  railHits?: number;
  /** Per-body cash override (boss-summoned cogs pay 1). kill() reads it instead of the kind's cash. */
  cashBase?: number;
}

export type ObstacleKind = 'bumper' | 'crate' | 'chest' | 'shrine' | 'gear';

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
  | 'loot' // Loot Goblin phase after the boss dies: scurry/arrival animating; no intents, waves, poison, belts or enrage
  | 'over'; // hero HP <= 0 after an enemy phase (or a shot); summary pending

export interface ComboTally {
  /** Contact hits this shot (hero/split/spat contacts, enemy-enemy bumps, lightning, explosions). */
  hits: number;
  /** Of `hits`, how many were enemy-enemy bumps (the rest: ball contacts, lightning, blasts). */
  bumps?: number;
  /** Ball-contact hits (hero, split, spat). */
  direct?: number;
  /** Cash from kills after a wall bounce (Bank combo base). */
  bankCash?: number;
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
  /** Board hazards for this run (from the stage). */
  hazards: Hazard[];
  /** Shoot damage taken in the current enemy phase (capped at RANGED_PHASE_CAP x maxHp). */
  rangedTaken?: number;
  /** 'dark' modifier: the renderer shows an enemy's intent only when sim intentVisible(s, t) is true. */
  dark: boolean;
  /** Clockwork: sim time at which the conveyor sweep fires this enemy phase (undefined = no sweep pending). */
  beltAt?: number;
  /** Clockwork: the Mainspring's Wind intent: the next sweep runs twice. */
  beltWound?: boolean;
  /** Loot phase: shots left (3 -> 0). Undefined before the boss dies. */
  pulls?: number;
  /** Cash taken from the Loot Goblin this run. */
  loot: number;
  /** Player-ball contacts with the goblin this run (3rd = golden tooth). */
  goblinHits: number;
  /** Golden tooth taken this run (+1 token). */
  tooth: boolean;
  /** Boss tokens earned this run (banked into save.tokens[stats.tokenId] at run end). */
  tokens: number;
  /** save.bestWave[stage] at run start (createRun's 4th arg): the slot-4 first-kill token rule. */
  bestWave: number;
  /** Loot phase hold (s left): the goblin's arrival (LOOT_ARRIVE_HOLD) or scurry (SCURRY_HOLD). */
  lootHold?: number;
  /** goblinHits when the current loot shot was fired (scurry only after a shot that hit). */
  shotGoblinHits?: number;
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
  kills: number;
  shots: number;
  /** Current wave: 1..wavesPerStage = regular waves, wavesPerStage+1 = boss wave (the boss's death ends the waves). */
  wave: number;
  /** Enemy phases completed in the current wave (enrage clock). */
  waveTurn: number;
  /** Next wave spawns at the start of the next enemy phase. */
  wavePending: boolean;
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
  /** Shot number of the first regular kill of the current wave (-1 none): Sweep = wave cleared within one shot. */
  waveKillShot?: number;
  nextId: number;
  result?: RunResult;
  /** Fx queued outside step() (e.g. by shoot()); drained at the start of the next step. */
  pendingFx?: FxEvent[];
  /** Trick uses left this run. */
  trickUsesLeft: number;
  /** Time Stop: the next enemy phase is stopped (enemies only close in; intents keep). */
  skipNextEnemyPhase: boolean;
  /** Time Stop is active in the current enemy phase. */
  timeStopped?: boolean;
  /** Momentum relic: current bonus damage. */
  momentum: number;
  /** Rail bounces of the main ball before its first enemy hit this shot (Ricochet). */
  shotBounces: number;
  /** The first enemy hit of this shot has happened (Explosive, Ricochet, Draw/Follow). */
  firstHitDone: boolean;
  /** Lantern relic: intents always visible (overrides dark). */
  lanternOn: boolean;
  /** Hero launch point and speed of the current shot (Draw cue). */
  launch?: { x: number; y: number; speed: number };
}

/** Public sim API implemented by sim/index.ts. */
export interface SimApi {
  createRun(stage: StageId, stats: RunStats, seed: number, bestWave?: number): RunState;
  /** Advance by exactly dt (caller passes SIM_DT multiples). Returns fx emitted during the step. */
  step(s: RunState, dt: number): FxEvent[];
  /** pull = drag vector (finger start - finger now), ball launches along it. False if cancelled / not allowed. */
  shoot(s: RunState, pull: Vec): boolean;
  /** Aim-line points from the main ball, honoring stats.aimPreview wall bounces (empty if 0). */
  previewShot(s: RunState, pull: Vec): Vec[];
  /** True when only extra (split/spat) balls are still moving. */
  canFastForward(s: RunState): boolean;
  /** Uses the equipped trick (only in 'aim' with uses left). False otherwise. */
  useTrick(s: RunState): boolean;
}

export interface RunResult {
  stage: StageId;
  cash: number;
  /** Boss tokens earned this run, of kind tokenId. */
  tokens: number;
  tokenId: TokenId;
  /** Goblin cash taken in the loot phase, hits landed on it, and whether the golden tooth dropped. */
  loot: number;
  goblinHits: number;
  tooth: boolean;
  kills: number;
  /** Highest stage wave reached, 1-4 (4 = boss wave). */
  wave: number;
  /** Stage waves cleared, 0-4 (4 = boss killed). */
  wavesCleared: number;
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
  | { t: 'waveStart'; wave: number }
  | { t: 'enrage'; level: number }
  /** An enemy just reached its stagger threshold (it will skip its intent). */
  | { t: 'stagger'; x: number; y: number }
  /** Jam rule nudged the hero from (x0,y0) to (x,y) before aim. */
  | { t: 'jam'; x0: number; y0: number; x: number; y: number }
  /** Poison damage at the start of the enemy phase. */
  | { t: 'poisonTick'; x: number; y: number; dmg: number }
  /** A status (poison/chill) went on or off an enemy. */
  | { t: 'status'; id: number; kind: 'poison' | 'chill'; on: boolean }
  /** A trick was used. */
  | { t: 'trick'; id: TrickId }
  /** Mirror reflected a Shoot at (x,y) (the shooter). */
  | { t: 'mirror'; x: number; y: number }
  /** Explosive relic blast ring. */
  | { t: 'blast'; x: number; y: number; r: number }
  /** Shrapnel shard released. */
  | { t: 'shard'; x: number; y: number }
  /** Clockwork: a body was carried by a conveyor from (x-dx, y-dy) to (x, y). */
  | { t: 'belt'; x: number; y: number; dx: number; dy: number }
  /** Clockwork: the gear deflected a body at (x,y). */
  | { t: 'gearSpin'; x: number; y: number }
  /** Clockwork: a tinker repaired an ally at (x,y). */
  | { t: 'repair'; x: number; y: number; amount: number }
  /** Clockwork: the Mainspring reversed every conveyor (phase 2 entry). */
  | { t: 'beltReverse' }
  /** Loot phase begins (goblin arriving). */
  | { t: 'lootStart' }
  /** A player ball hit the goblin: loot tier and cash paid. */
  | { t: 'goblinHit'; x: number; y: number; tier: 'small' | 'big' | 'jackpot'; cash: number }
  /** Third goblin hit: the golden tooth (+1 token). */
  | { t: 'tooth'; x: number; y: number }
  /** The goblin scurried from its old spot to (x, y). */
  | { t: 'scurry'; id: number; x: number; y: number; x0: number; y0: number }
  /** Loot phase over (after the third shot's balls stop). */
  | { t: 'lootEnd'; cash: number; hits: number }
  /** Boss token(s) earned (boss kill or tooth). */
  | { t: 'token'; x: number; y: number; amount: number };

// ---------- Derived per-run stats (meta -> sim contract) ----------

/** Everything the sim needs from progression. meta/stats.ts builds this from SaveData. Zero = locked/off. */
export interface RunStats {
  /** Hero max HP and flat armor (damage taken = attack - armor, min 1). */
  maxHp: number;
  armor: number;
  /** Flat contact damage per hit. */
  damage: number;
  /** Extra damage per (impact speed / SPEED_DMG_REF), floored. 0 = locked. */
  speedDamage: number;
  aimPreview: number; // 0 = off, else number of wall bounces to preview
  /** Clockwork counter (CLEATS): 0 = belts carry the hero 24 px, 1 = 12 px, 2 = 0. */
  beltGrip: number;

  // Vitality (every heal goes through the shared diminishing curve)
  healOnKill: number; // HP per kill, 0 = off
  waveHeal: number; // HP at wave clear
  bossHeal: number; // fraction of maxHp at boss arrival, 0 = off
  rangedResist: number; // flat reduction on Shoot damage (min 1)

  // Tactics
  heavyHits: number; // 0|1: hero hits at >= HEAVY_HIT_SPEED apply 2 stagger
  massMult: number; // hero mass multiplier (default 1)
  reflex: number; // 0|1: skip the first enemy phase of each wave

  lightningChance: number; // 0..1 per enemy hit
  lightningArcs: number;
  lightningRange: number; // px
  lightningDamage: number;

  splitCount: number; // children on first enemy hit of a shot; 0 = off
  spitInterval: number; // seconds between spat balls from the hero while moving; 0 = off
  spitLife: number; // seconds
  spitDamage: number;

  // Combos (0 = locked)
  comboChain: number; // cash bonus fraction per hit beyond 2 (e.g. 0.25)
  comboBank: number; // cash bonus fraction on a kill after a wall bounce
  comboCascade: number; // 0|1: a kill by an enemy bump -> +1 stagger to enemies within 50 px
  comboSweep: number; // cash when a wave is cleared in a single shot
  comboLockdown: number; // HP (curve) when every live enemy is staggered by a shot

  ballType: BallType;
  bumpers: number;
  crates: number;
  chests: number;
  shrineChance: number;
  chestCash: number;
  crateCash: number;
  shrineHeal: number; // via shared curve
  bumperBounce: number; // speed multiplier on bumper hit

  cashMult: number;

  // Gear (DESIGN-v0.4-loadout). meta enforces slots and ownership.
  cue: CueId; // default 'standard'
  /** Equipped relics. lightning/split/spitter stats above apply only when the id is in here. */
  relics: RelicId[];
  trick: TrickId | null;
  /** Trick uses per run (0 if no trick). */
  trickUses: number;
  /** The boss token this stage drops (world's token; loops reuse). */
  tokenId: TokenId;
  /** Active fork / capstone ids of equipped cards (M3; the sim keys behaviour on these). */
  mods: string[];
  /** Upgrade level per equipped gear id (0 = base), e.g. gearLevel.poison = 1. */
  gearLevel: Record<string, number>;
}

// ---------- Save ----------

export interface SaveData {
  version: 4;
  cash: number;
  /** Unspent boss tokens, per boss. */
  tokens: Record<TokenId, number>;
  /** Upgrade node id -> level. Island nodes (portals / capstones / keystones are level 1); gear lives in `cards`. */
  levels: Record<string, number>;
  /** Gallery cards, keyed by gear id ('break', 'heavy', 'lightning', ...). Presence = unlocked. */
  cards: Record<string, CardState>;
  /** Highest global stage index reached (see core/worlds.ts globalIndex). */
  unlocked: number;
  current: StageId;
  /** Keyed by stage id. 0 none, 1-3 waves cleared, 4 = boss killed. */
  bestWave: Record<StageId, number>;
  bossKills: Record<StageId, number>;
  /** Best goblin cash total per stage. */
  bestLoot: Record<StageId, number>;
  /** Equipped gear (owned in the gallery, equipped pre-run). Slot counts: see meta relicSlots / trickSlotOpen / cueSlotOpen. */
  loadout: { ball: BallType; cue: CueId; relics: RelicId[]; trick: TrickId | null };
  /** flash: false = reduced flashing (alpha fades, solid bolts, slow shimmer). Default from prefers-reduced-motion. */
  settings: { sound: boolean; shake: boolean; flash: boolean; fastEnemies?: boolean };
  /** One-shot onboarding / disclosure flags, e.g. 'shotTaught', 'tab:combo', 'tab:stage'. */
  hints: Record<string, boolean>;
  /** teeth = golden teeth taken. */
  stats: { runs: number; kills: number; shots: number; teeth: number };
}

// ---------- Upgrade tree data (meta) ----------

/** Boss tokens: one kind per world's boss (loops reuse their world's). */
export type TokenId = 'stripe' | 'frost' | 'cog' | 'pearl' | 'ember' | 'house';
export const TOKEN_OF_WORLD: TokenId[] = ['stripe', 'frost', 'cog', 'pearl', 'ember', 'house'];

/** Gallery card progress (v0.6). Presence in SaveData.cards = unlocked. */
export interface CardState {
  /** Base nodes bought: 0..3 (I, II, III). */
  level: number;
  /** Owned fork-choice ids; `fork` = the active one (must be in `forks`). */
  forks: string[];
  fork: string | null;
  /** Owned capstone ids; `cap` = the active one. */
  caps: string[];
  cap: string | null;
}

export type Currency = 'cash' | TokenId;
export type NodeKind = 'stat' | 'unlock' | 'keystone' | 'capstone' | 'counter' | 'portal';
export type Trunk = 'power' | 'vitality' | 'tactics' | 'combo';

export interface UpgradeNode {
  id: string;
  name: string;
  /** Short line for the node panel. Use {v} for the value at next level. */
  desc: string;
  currency: Currency;
  kind: NodeKind;
  /** 1 for one-shot kinds. */
  maxLevel: number;
  /** Cost to buy level (current+1). */
  cost: (level: number) => number;
  /** Virtual tree canvas 640x640, root at (320,320), spacing ~40. */
  x: number;
  y: number;
  /** Adjacency (undirected; each edge listed once, on either node). */
  links: string[];
  /** 0 root, 1..3 core, 4+ grafts/loops. */
  ring: number;
  trunk: Trunk;
  /** World index (1..6) whose first boss kill reveals this node. */
  graft?: number;
  /** Loop index for procedural loop rings. */
  loop?: number;
  /** v0.6 islands: 1..6 = world islands, 6+L = loop L. Undefined on the pre-island tree. */
  island?: number;
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
  /** Core + all grafts + loop ring 1 (see nodesFor for the save-dependent set). */
  NODES: UpgradeNode[];
  nodesFor(save: SaveData): UpgradeNode[];
  isReachable(save: SaveData, id: string): boolean;
  distanceFromOwned(save: SaveData, id: string): number;
  pathToOwned(save: SaveData, id: string): string[];
  newSave(): SaveData;
  /** Reads localStorage (try/catch); returns newSave() on missing/corrupt. */
  loadSave(): SaveData;
  writeSave(save: SaveData): void;
  /** Base64 string for clipboard export. */
  exportSave(save: SaveData): string;
  /** Validates + migrates; null if invalid. */
  importSave(text: string): SaveData | null;
  buildStats(save: SaveData): RunStats;
  /** 1 + (unlocked >= 4) + (unlocked >= 12). */
  relicSlots(save: SaveData): number;
  trickSlotOpen(save: SaveData): boolean;
  /** True once any cue is owned. */
  cueSlotOpen(save: SaveData): boolean;
  /** 'standard' cue is always owned. */
  gearOwned(save: SaveData, id: string): boolean;
  ownedGear(save: SaveData): { cues: CueId[]; relics: RelicId[]; tricks: TrickId[] };
  /** Validates ownership + slot; mutates save.loadout; false if rejected. `index` is the relic slot (default: append if free; duplicates rejected). */
  equip(save: SaveData, slot: 'cue' | 'relic' | 'trick', id: string, index?: number): boolean;
  /** Clears a slot (cue -> 'standard'); relic `index` defaults to the last one. false if nothing to clear. */
  unequip(save: SaveData, slot: 'cue' | 'relic' | 'trick', index?: number): boolean;
  nodeLevel(save: SaveData, id: string): number;
  /** Cost of next level, or null if maxed. */
  nextCost(save: SaveData, node: UpgradeNode): number | null;
  /** 'locked' = graft unrevealed / not adjacent / capstone siblings unmaxed; 'hidden' = >2 steps from any owned node. */
  buyState(save: SaveData, node: UpgradeNode): 'ok' | 'locked' | 'maxed' | 'poor' | 'hidden';
  /** Mutates save; returns true on success. */
  buy(save: SaveData, node: UpgradeNode): boolean;
  /**
   * Banks a finished run: cash, boss tokens (result.tokens into save.tokens[result.tokenId]), bestWave, bossKills, bestLoot,
   * stats (runs, kills, shots, teeth), unlocks the next stage on a boss kill. Returns the tokens banked and the stage unlocked.
   */
  bankRun(save: SaveData, result: RunResult): { tokens: number; tokenId: TokenId; unlocked: StageId | null };
}
