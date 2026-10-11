// Run state machine: createRun, step, shoot, previewShot, canFastForward.
import {
  CANCEL_RADIUS,
  ENEMY_PHASE_SECONDS,
  MAX_LAUNCH_SPEED,
  MAX_PULL,
  MAX_RESOLVE_SECONDS,
  SHIMMER_SECONDS,
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
import { BALL_TYPES, stageById } from '../core/tuning';
import { Rng } from '../core/rng';
import { physicsStep, spawnSpat, unstick } from './physics';
import { emptyCombo, evaluateCombos } from './combos';
import { bossEnemyPhase, spawnBoss } from './boss';
import { liveRegulars, poolKind, regularCap, spawnObstacle, spawnRegular } from './spawn';

export function mainBall(s: RunState): Ball {
  const b = s.balls.find((x) => x.kind === 'main');
  if (!b) throw new Error('sim: main ball missing');
  return b;
}

export function createRun(stage: StageId, stats: RunStats, seed: number, _bestFill?: number): RunState {
  const st = stageById(stage);
  const bt = BALL_TYPES[stats.ballType];
  const s: RunState = {
    stage: st.id,
    seed,
    rng: new Rng(seed),
    stats: { ...stats },
    phase: 'aim',
    t: 0,
    energy: stats.maxEnergy,
    refilled: 0,
    cash: 0,
    emeralds: 0,
    kills: 0,
    meterKills: 0,
    shots: 0,
    bossPending: false,
    bossSpawned: false,
    bossKilled: false,
    balls: [],
    targets: [],
    obstacles: [],
    combo: emptyCombo(),
    bestCombo: 0,
    splitUsed: false,
    spitTimer: 0,
    respawnAccum: 0,
    phaseTimer: 0,
    resolveTime: 0,
    nextId: 1,
    pendingFx: [],
  };
  s.balls.push({
    id: s.nextId++,
    kind: 'main',
    x: TABLE.x + TABLE.w / 2,
    y: TABLE.y + TABLE.h - 24,
    vx: 0,
    vy: 0,
    r: bt.r,
    mass: bt.mass,
    life: Infinity,
    resting: true,
    banked: false,
  });

  const n = regularCap(s);
  for (let i = 0; i < n; i++) spawnRegular(s, st.openingBoard[i] ?? poolKind(s), false);

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
  if (s.energy < s.stats.releaseCost) return false;
  const b = mainBall(s);
  const power = Math.min(len, MAX_PULL) / MAX_PULL;
  const speed = power * MAX_LAUNCH_SPEED * BALL_TYPES[s.stats.ballType].speedMult;
  b.vx = (pull.x / len) * speed;
  b.vy = (pull.y / len) * speed;
  b.resting = false;
  b.banked = false;
  unstick(b);
  s.energy -= s.stats.releaseCost;
  s.shots++;
  s.combo = emptyCombo();
  s.splitUsed = false;
  s.boardCleared = false;
  s.spitTimer = s.stats.spitInterval;
  s.resolveTime = 0;
  s.phase = 'resolve';
  const q = (s.pendingFx ??= []);
  q.push({ t: 'shoot', power });
  q.push({ t: 'energy', x: b.x, y: b.y, amount: -s.stats.releaseCost });
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
  else if (s.phase === 'enemy') enemyStep(s, h, fx);
}

function resolveStep(s: RunState, h: number, fx: FxEvent[]): void {
  s.resolveTime += h;
  const main = mainBall(s);
  if (s.stats.spitInterval > 0 && s.stats.spitLife > 0 && !main.resting) {
    s.spitTimer -= h;
    if (s.spitTimer <= 0) {
      s.spitTimer += s.stats.spitInterval;
      spawnSpat(s, main, fx);
    }
  }

  physicsStep(s, h, fx);

  for (const b of s.balls) if (b.kind === 'spat' && !b.resting) b.life -= h;
  if (s.resolveTime >= MAX_RESOLVE_SECONDS) {
    for (const b of s.balls) {
      b.vx = 0;
      b.vy = 0;
      b.resting = true;
      unstick(b);
    }
  }
  // Extra balls leave the table when they stop (or their life runs out).
  s.balls = s.balls.filter((b) => b.kind === 'main' || (!b.resting && b.life > 0));

  if (s.balls.every((b) => b.resting)) endShot(s, fx);
}

function endShot(s: RunState, fx: FxEvent[]): void {
  const main = mainBall(s);
  evaluateCombos(s, main.x, main.y, fx);
  s.targets = s.targets.filter((t) => !t.dead);
  s.obstacles = s.obstacles.filter((o) => !o.dead);
  startEnemy(s, fx);
}

function startEnemy(s: RunState, fx: FxEvent[]): void {
  s.phase = 'enemy';
  let spawned = false;
  if (s.bossPending) spawnBoss(s, fx);

  const cap = regularCap(s);
  s.respawnAccum = Math.min(s.respawnAccum + s.stats.respawnPerTurn, Math.max(1, cap));
  // Empty board (after any boss zone-clear): refill at least two targets right away.
  if (liveRegulars(s) === 0) s.respawnAccum = Math.max(s.respawnAccum, Math.min(cap, 2));
  while (s.respawnAccum >= 1 && liveRegulars(s) < cap) {
    const t = spawnRegular(s, poolKind(s), true);
    if (!t) break;
    s.respawnAccum -= 1;
    spawned = true;
    fx.push({ t: 'shimmer', x: t.x, y: t.y });
  }
  if (bossEnemyPhase(s, fx)) spawned = true;
  s.phaseTimer = spawned ? Math.max(ENEMY_PHASE_SECONDS, SHIMMER_SECONDS) : ENEMY_PHASE_SECONDS;
}

function enemyStep(s: RunState, h: number, fx: FxEvent[]): void {
  driftTargets(s, h);
  s.phaseTimer -= h;
  if (s.phaseTimer > 1e-9) return;
  s.phaseTimer = 0;
  if (s.energy < s.stats.releaseCost) {
    s.phase = 'over';
    s.result = buildResult(s);
    fx.push({ t: 'runOver' });
  } else {
    s.phase = 'aim';
  }
}

/** Moving targets (and moving bosses) drift during the enemy phase, bouncing off rails and blockers. */
function driftTargets(s: RunState, h: number): void {
  for (const t of s.targets) {
    if (t.dead || (t.vx === 0 && t.vy === 0)) continue;
    const px = t.x;
    const py = t.y;
    t.x += t.vx * h;
    t.y += t.vy * h;
    if (t.x - t.r < TABLE.x || t.x + t.r > TABLE.x + TABLE.w) {
      t.vx = -t.vx;
      t.x = px;
    }
    if (t.y - t.r < TABLE.y || t.y + t.r > TABLE.y + TABLE.h) {
      t.vy = -t.vy;
      t.y = py;
    }
    let blocked = false;
    for (const o of s.targets) {
      if (o === t || o.dead) continue;
      if (Math.hypot(o.x - t.x, o.y - t.y) < o.r + t.r) blocked = true;
    }
    for (const o of s.obstacles) if (!o.dead && Math.hypot(o.x - t.x, o.y - t.y) < o.r + t.r) blocked = true;
    for (const b of s.balls) if (Math.hypot(b.x - t.x, b.y - t.y) < b.r + t.r) blocked = true;
    if (blocked) {
      t.x = px;
      t.y = py;
      t.vx = -t.vx;
      t.vy = -t.vy;
    }
  }
}

function buildResult(s: RunState): RunResult {
  const st = stageById(s.stage);
  const meterFill = s.bossSpawned || s.bossPending ? 1 : Math.max(0, Math.min(1, s.meterKills / st.meterKills));
  return {
    stage: s.stage,
    cash: s.cash,
    emeralds: s.emeralds,
    kills: s.kills,
    meterFill,
    bossKilled: s.bossKilled,
    shots: s.shots,
    bestCombo: s.bestCombo,
    seconds: s.t,
  };
}

/** Straight-line aim preview from the main ball with wall reflections only. */
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
  for (const t of s.targets) if (!t.dead && t.shimmer <= 0) circles.push(t);
  for (const o of s.obstacles) if (!o.dead) circles.push(o);

  for (let k = 0; k <= bounces; k++) {
    // Nearest wall along the ray.
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
    // Nearest circle along the ray.
    let tc = Infinity;
    for (const c of circles) {
      const R = c.r + r;
      const fx = px - c.x;
      const fy = py - c.y;
      const bq = fx * dx + fy * dy;
      const cq = fx * fx + fy * fy - R * R;
      if (cq <= 0) continue; // already overlapping
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
