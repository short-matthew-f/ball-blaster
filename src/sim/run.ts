// Run state machine: createRun, step, shoot, previewShot, canFastForward.
// aim -> (shoot) resolve -> (everything stopped) enemy -> (everything stopped) [death check] -> jam rule -> aim.
import {
  CANCEL_RADIUS,
  MAX_LAUNCH_SPEED,
  MAX_PULL,
  MAX_RESOLVE_SECONDS,
  MIN_POWER,
  SIM_DT,
  TABLE,
  type Ball,
  type FxEvent,
  type RunResult,
  type RunState,
  type RunStats,
  type StageId,
  type Vec,
} from '../core/types';
import {
  BALL_TYPES,
  BREAK_MIN_POWER,
  BREAK_SPEED_MULT,
  DRAW_POWER,
  JAM_CLEAR,
  MOMENTUM_HITS,
  MOMENTUM_MAX,
  RACK_PULL,
  RECALL_Y_OFFSET,
  SHOCKWAVE_R,
  WAVES_PER_STAGE,
  gearVal,
  stageById,
} from '../core/tuning';
import { addStagger } from './damage';
import { has, lv } from './gear';
import { Rng } from '../core/rng';
import { physicsStep, relaxAll, spawnSpat } from './physics';
import { emptyCombo, evaluateCombos } from './combos';
import { enemyStep, startEnemyPhase } from './enemy';
import { OBSTACLE_R, spawnObstacle, spawnWave } from './spawn';
import { hero, stageWaves } from './damage';

export function mainBall(s: RunState): Ball {
  return hero(s);
}

export function createRun(stage: StageId, stats: RunStats, seed: number, _bestWave?: number): RunState {
  const st = stageById(stage);
  const bt = BALL_TYPES[stats.ballType];
  const s: RunState = {
    stage: st.id,
    // Deep copy (hazards are flat): the Mainspring's reversal negates dx/dy on the run's copy, never the StageDef.
    hazards: st.hazards.filter((z) => z.kind !== 'gear').map((z) => ({ ...z })),
    dark: st.modifiers.includes('dark'),
    seed,
    rng: new Rng(seed),
    stats: { ...stats, relics: [...(stats.relics ?? [])], gearLevel: { ...(stats.gearLevel ?? {}) } },
    phase: 'aim',
    t: 0,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    healed: 0,
    cash: 0,
    emeralds: 0,
    kills: 0,
    shots: 0,
    wave: 1,
    waveTurn: 0,
    wavePending: false,
    bossSpawned: false,
    bossKilled: false,
    balls: [],
    targets: [],
    obstacles: [],
    combo: emptyCombo(),
    bestCombo: 0,
    splitUsed: false,
    stickyUsed: false,
    spitTimer: 0,
    acted: [],
    resolveTime: 0,
    enemyQueue: [],
    enemyNext: 0,
    lastHit: {},
    touching: {},
    jams: 0,
    waveKillShot: -1,
    nextId: 1,
    pendingFx: [],
    trickUsesLeft: stats.trick ? stats.trickUses : 0,
    skipNextEnemyPhase: false,
    momentum: 0,
    shotBounces: 0,
    firstHitDone: false,
    lanternOn: (stats.relics ?? []).includes('lantern'),
    loot: 0,
    goblinHits: 0,
    tooth: false,
    tokens: 0,
  };
  s.balls.push({
    id: s.nextId++,
    kind: 'main',
    x: TABLE.x + TABLE.w / 2,
    y: TABLE.y + TABLE.h - 24,
    vx: 0,
    vy: 0,
    r: bt.r,
    mass: bt.mass * (stats.massMult > 0 ? stats.massMult : 1),
    life: Infinity,
    resting: true,
    banked: false,
  });
  // Clockwork gear hazards become static, unbreakable obstacles before the first wave is placed around them.
  for (const z of st.hazards) {
    if (z.kind === 'gear') s.obstacles.push({ id: s.nextId++, kind: 'gear', x: z.x, y: z.y, r: OBSTACLE_R.gear, hp: Infinity, flash: 0, dead: false });
  }
  spawnWave(s, s.pendingFx!);
  for (const t of s.targets) t.shimmer = 0;

  for (let i = 0; i < stats.bumpers; i++) spawnObstacle(s, 'bumper');
  for (let i = 0; i < stats.crates; i++) spawnObstacle(s, 'crate');
  for (let i = 0; i < stats.chests; i++) spawnObstacle(s, 'chest');
  if (stats.shrineChance > 0 && s.rng.chance(stats.shrineChance)) spawnObstacle(s, 'shrine');
  return s;
}

export function shoot(s: RunState, pull: Vec): boolean {
  if (s.phase !== 'aim') return false;
  const len = Math.hypot(pull.x, pull.y);
  if (len < CANCEL_RADIUS) return false;
  const b = mainBall(s);
  // Minimum shot power: every release is a leave; no free micro-taps.
  const cue = s.stats.cue;
  const power = Math.max(cue === 'break' ? BREAK_MIN_POWER : MIN_POWER, Math.min(len, MAX_PULL) / MAX_PULL);
  const cueMult = cue === 'break' ? BREAK_SPEED_MULT : cue === 'draw' ? DRAW_POWER : 1;
  const speed = power * MAX_LAUNCH_SPEED * BALL_TYPES[s.stats.ballType].speedMult * cueMult;
  b.vx = (pull.x / len) * speed;
  b.vy = (pull.y / len) * speed;
  b.resting = false;
  b.banked = false;
  b.jumpOver = undefined;
  b.jumpLanded = false;
  s.launch = { x: b.x, y: b.y, speed };
  s.shotBounces = 0;
  s.firstHitDone = false;
  s.shots++;
  s.combo = emptyCombo();
  s.splitUsed = false;
  s.stickyUsed = false;
  s.spitTimer = s.stats.spitInterval;
  s.resolveTime = 0;
  s.lastHit = {};
  s.touching = {};
  s.phase = 'resolve';
  (s.pendingFx ??= []).push({ t: 'shoot', power });
  return true;
}

export function canFastForward(s: RunState): boolean {
  if (s.phase !== 'resolve') return false;
  let mainResting = false;
  let otherMoving = false;
  for (const b of s.balls) {
    if (b.kind === 'main') mainResting = b.resting;
    else if (!b.resting) otherMoving = true;
  }
  for (const t of s.targets) if (!t.dead && !t.resting) otherMoving = true;
  return mainResting && otherMoving;
}

export function step(s: RunState, dt: number): FxEvent[] {
  const fx: FxEvent[] = [];
  if (s.pendingFx && s.pendingFx.length) {
    fx.push(...s.pendingFx);
    s.pendingFx.length = 0;
  }
  if (s.phase === 'over') return fx;
  // Always integrate in exact SIM_DT substeps so fast-forward and normal speed stay bit-identical.
  const n = Math.max(1, Math.round(dt / SIM_DT));
  for (let i = 0; i < n; i++) {
    substep(s, SIM_DT, fx);
    if ((s.phase as string) === 'over') break;
  }
  return fx;
}

function substep(s: RunState, h: number, fx: FxEvent[]): void {
  s.t += h;
  for (const t of s.targets) {
    if (t.flash > 0) t.flash = Math.max(0, t.flash - h);
    if (t.shimmer > 0) t.shimmer = Math.max(0, t.shimmer - h);
  }
  for (const o of s.obstacles) if (o.flash > 0) o.flash = Math.max(0, o.flash - h);

  if (s.phase === 'resolve') resolveStep(s, h, fx);
  else if (s.phase === 'enemy' && enemyStep(s, h, fx, physicsStep)) endTurn(s, fx);
}

function resolveStep(s: RunState, h: number, fx: FxEvent[]): void {
  s.resolveTime += h;
  const main = mainBall(s);
  if (s.stats.spitInterval > 0 && s.stats.spitLife > 0 && !main.resting && has(s, 'spitter')) {
    s.spitTimer -= h;
    if (s.spitTimer <= 0) {
      s.spitTimer += s.stats.spitInterval;
      spawnSpat(s, main, fx);
    }
  }

  physicsStep(s, h, fx);

  for (const b of s.balls) if (b.kind === 'spat' && !b.resting) b.life -= h;
  if (s.resolveTime >= MAX_RESOLVE_SECONDS) {
    for (const b of s.balls) ((b.vx = 0), (b.vy = 0), (b.resting = true));
    for (const t of s.targets) ((t.vx = 0), (t.vy = 0), (t.resting = true));
  }
  // Extra balls leave the table when they stop (or their life runs out).
  s.balls = s.balls.filter((b) => b.kind === 'main' || (!b.resting && b.life > 0));

  if (s.balls.every((b) => b.resting) && s.targets.every((t) => t.dead || t.resting)) endShot(s, fx);
}

function endShot(s: RunState, fx: FxEvent[]): void {
  const main = mainBall(s);
  // Jump cue: a hero that stopped on top of the enemy it jumped is separated by relaxAll below.
  main.jumpOver = undefined;
  main.jumpLanded = false;
  evaluateCombos(s, main.x, main.y, fx);
  // Momentum relic: a shot with >= MOMENTUM_HITS hits builds it (capped); fewer resets it.
  if (has(s, 'momentum')) {
    s.momentum = s.combo.hits >= MOMENTUM_HITS ? Math.min(gearVal(MOMENTUM_MAX, lv(s, 'momentum')), s.momentum + 1) : 0;
  }
  s.targets = s.targets.filter((t) => !t.dead);
  s.obstacles = s.obstacles.filter((o) => !o.dead);
  relaxAll(s);
  startEnemyPhase(s, fx);
}

/** After the enemy phase: death check, then the jam rule, then aim. */
function endTurn(s: RunState, fx: FxEvent[]): void {
  if (s.hp <= 0) {
    s.phase = 'over';
    s.result = buildResult(s);
    fx.push({ t: 'runOver' });
    return;
  }
  jamRule(s, fx);
  s.phase = 'aim';
}

// ---------- Jam rule ----------

const JAM_DIRS = 64;

/** True if the hero at (x,y) could roll JAM_CLEAR px in at least one of JAM_DIRS directions without touching anything. */
export function hasCorridor(s: RunState, x: number, y: number): boolean {
  const h = mainBall(s);
  for (let k = 0; k < JAM_DIRS; k++) {
    const a = (k / JAM_DIRS) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let clear = true;
    for (let d = 3; d <= JAM_CLEAR && clear; d += 3) {
      if (!spotClear(s, h, x + ux * d, y + uy * d)) clear = false;
    }
    if (clear) return true;
  }
  return false;
}

function spotClear(s: RunState, h: Ball, x: number, y: number): boolean {
  const r = h.r;
  if (x < TABLE.x + r - 1e-6 || x > TABLE.x + TABLE.w - r + 1e-6 || y < TABLE.y + r - 1e-6 || y > TABLE.y + TABLE.h - r + 1e-6) return false;
  for (const t of s.targets) if (!t.dead && Math.hypot(t.x - x, t.y - y) < r + t.r - 0.01) return false;
  for (const o of s.obstacles) if (!o.dead && Math.hypot(o.x - x, o.y - y) < r + o.r - 0.01) return false;
  return true;
}

/** Nearest open spot (clear, with a corridor) around (x0,y0): deterministic spiral search. */
function nearestOpenSpot(s: RunState, x0: number, y0: number): Vec | null {
  const h = mainBall(s);
  for (let rho = 2; rho <= 300; rho += 2) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * rho) / 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = x0 + Math.cos(a) * rho;
      const y = y0 + Math.sin(a) * rho;
      if (spotClear(s, h, x, y) && hasCorridor(s, x, y)) return { x, y };
    }
  }
  return null;
}

/** Before aim: a hero with no clear corridor is nudged to the nearest open spot (deterministic spiral search). */
export function jamRule(s: RunState, fx: FxEvent[]): boolean {
  const h = mainBall(s);
  if (hasCorridor(s, h.x, h.y)) return false;
  const p = nearestOpenSpot(s, h.x, h.y);
  if (!p) return false;
  fx.push({ t: 'jam', x0: h.x, y0: h.y, x: p.x, y: p.y });
  h.x = p.x;
  h.y = p.y;
  s.jams++;
  return true;
}

// ---------- Tricks ----------

/**
 * Use the equipped trick (aim only, uses left). Recall: hero to the bottom-centre start spot (nudged if occupied).
 * Time Stop: the next enemy phase is skipped (intents keep). Rack 'Em: every live enemy moves RACK_PULL px toward the
 * table centre. Shockwave: +1 stagger to every enemy within SHOCKWAVE_R (edge gap) of the hero.
 */
export function useTrick(s: RunState): boolean {
  const id = s.stats.trick;
  if (s.phase !== 'aim' || !id || s.trickUsesLeft <= 0) return false;
  const fx = (s.pendingFx ??= []);
  const h = mainBall(s);
  switch (id) {
    case 'recall': {
      const x = TABLE.x + TABLE.w / 2;
      const y = TABLE.y + TABLE.h - RECALL_Y_OFFSET;
      const p = spotClear(s, h, x, y) && hasCorridor(s, x, y) ? { x, y } : nearestOpenSpot(s, x, y);
      if (p) ((h.x = p.x), (h.y = p.y));
      break;
    }
    case 'timeStop':
      s.skipNextEnemyPhase = true;
      break;
    case 'rackEm': {
      const cx = TABLE.x + TABLE.w / 2;
      const cy = TABLE.y + TABLE.h / 2;
      for (const t of s.targets) {
        if (t.dead) continue;
        const d = Math.hypot(cx - t.x, cy - t.y);
        const k = Math.min(RACK_PULL, d) / (d || 1);
        t.x += (cx - t.x) * k;
        t.y += (cy - t.y) * k;
      }
      relaxAll(s);
      jamRule(s, fx);
      break;
    }
    case 'shockwave':
      for (const t of s.targets.slice()) {
        if (t.dead) continue;
        if (Math.hypot(t.x - h.x, t.y - h.y) - t.r - h.r <= SHOCKWAVE_R) addStagger(t, 1, fx, s);
      }
      // Static may have killed something during aim: drop the bodies (rewards were paid at the kill).
      s.targets = s.targets.filter((t) => !t.dead);
      break;
  }
  s.trickUsesLeft--;
  fx.push({ t: 'trick', id });
  return true;
}

/**
 * Result waves are normalised to the 3 + boss track (boss wave = 4) whatever the stage's wave count, so an Early Boss
 * stage (boss after 2 waves) still banks bestWave 4 for a kill.
 */
function buildResult(s: RunState): RunResult {
  const nw = stageWaves(s);
  const bossWave = WAVES_PER_STAGE + 1;
  return {
    stage: s.stage,
    cash: s.cash,
    emeralds: s.emeralds,
    kills: s.kills,
    wave: s.wave > nw ? bossWave : Math.min(s.wave, WAVES_PER_STAGE),
    wavesCleared: s.bossKilled ? bossWave : Math.min(s.wave - 1, nw),
    overtimeWaves: s.bossKilled ? Math.max(0, s.wave - (nw + 1)) : 0,
    bossKilled: s.bossKilled,
    shots: s.shots,
    bestCombo: s.bestCombo,
    seconds: s.t,
  };
}

/** Straight-line aim preview from the hero with wall reflections only. */
export function previewShot(s: RunState, pull: Vec): Vec[] {
  const bounces = s.stats.aimPreview;
  if (bounces <= 0 || s.phase !== 'aim') return [];
  const len = Math.hypot(pull.x, pull.y);
  if (len < CANCEL_RADIUS) return [];
  const b = mainBall(s);
  const r = b.r;
  let px = b.x;
  let py = b.y;
  let dx = pull.x / len;
  let dy = pull.y / len;
  const pts: Vec[] = [{ x: px, y: py }];
  const x0 = TABLE.x + r;
  const x1 = TABLE.x + TABLE.w - r;
  const y0 = TABLE.y + r;
  const y1 = TABLE.y + TABLE.h - r;
  const circles: { x: number; y: number; r: number }[] = [];
  for (const t of s.targets) if (!t.dead) circles.push(t);
  for (const o of s.obstacles) if (!o.dead) circles.push(o);

  for (let k = 0; k <= bounces; k++) {
    let tw = Infinity;
    let axis: 'x' | 'y' = 'x';
    if (dx > 1e-9) tw = (x1 - px) / dx;
    else if (dx < -1e-9) tw = (x0 - px) / dx;
    let ty = Infinity;
    if (dy > 1e-9) ty = (y1 - py) / dy;
    else if (dy < -1e-9) ty = (y0 - py) / dy;
    if (ty < tw) {
      tw = ty;
      axis = 'y';
    }
    tw = Math.max(0, tw);
    let tc = Infinity;
    for (const c of circles) {
      const R = c.r + r;
      const fx = px - c.x;
      const fy = py - c.y;
      const bq = fx * dx + fy * dy;
      const cq = fx * fx + fy * fy - R * R;
      if (cq <= 0) continue;
      const disc = bq * bq - cq;
      if (disc < 0) continue;
      const tt = -bq - Math.sqrt(disc);
      if (tt > 1e-6 && tt < tc) tc = tt;
    }
    if (tc <= tw) {
      pts.push({ x: px + dx * tc, y: py + dy * tc });
      return pts;
    }
    px += dx * tw;
    py += dy * tw;
    pts.push({ x: px, y: py });
    if (axis === 'x') dx = -dx;
    else dy = -dy;
  }
  return pts;
}
