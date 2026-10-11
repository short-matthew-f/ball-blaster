// Entity construction and placement rules (spawn budget, respawns).
import { BOSS_ZONE, ENEMY_PHASE_SECONDS, SHIMMER_SECONDS, TABLE, type Obstacle, type ObstacleKind, type RunState, type Target, type TargetKind } from '../core/types';
import { TARGET_DEFS, stageById } from '../core/tuning';

const EDGE_MARGIN = 4;
const BALL_CLEARANCE = 20;
const GAP = 3;
/** Regular targets spawn in the upper part of the table so the launch area stays clear. */
const SPAWN_MAX_Y = TABLE.y + TABLE.h * 0.72;

export const OBSTACLE_R: Record<ObstacleKind, number> = { bumper: 6, crate: 5, chest: 6, shrine: 6 };
const OBSTACLE_HP: Record<ObstacleKind, number> = { bumper: Infinity, crate: 1, chest: 2, shrine: 1 };

export function isRegular(t: Target): boolean {
  return t.kind !== 'boss' && t.kind !== 'cadre';
}

export function bossAlive(s: RunState): boolean {
  return s.bossSpawned && !s.bossKilled;
}

export function liveRegulars(s: RunState): number {
  let n = 0;
  for (const t of s.targets) if (!t.dead && isRegular(t)) n++;
  return n;
}

/** Desired live regular targets: min(enemyCount, densityCap), halved while the boss lives. */
export function regularCap(s: RunState): number {
  const st = stageById(s.stage);
  const cap = Math.min(s.stats.enemyCount, st.densityCap);
  return bossAlive(s) ? Math.max(1, Math.floor(cap / 2)) : cap;
}

export function circleHitsRect(x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  const cx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

/** True if a circle at (x,y,r) satisfies all placement rules. */
export function spotFree(s: RunState, x: number, y: number, r: number, avoidBossZone: boolean): boolean {
  if (x - r < TABLE.x + EDGE_MARGIN || x + r > TABLE.x + TABLE.w - EDGE_MARGIN) return false;
  if (y - r < TABLE.y + EDGE_MARGIN || y + r > TABLE.y + TABLE.h - EDGE_MARGIN) return false;
  if (avoidBossZone && circleHitsRect(x, y, r, BOSS_ZONE)) return false;
  for (const b of s.balls) if (Math.hypot(b.x - x, b.y - y) < r + b.r + BALL_CLEARANCE) return false;
  for (const t of s.targets) if (!t.dead && Math.hypot(t.x - x, t.y - y) < r + t.r + GAP) return false;
  for (const o of s.obstacles) if (!o.dead && Math.hypot(o.x - x, o.y - y) < r + o.r + GAP) return false;
  return true;
}

function findSpot(s: RunState, r: number, avoidBossZone: boolean, maxY: number): { x: number; y: number } | null {
  for (let i = 0; i < 80; i++) {
    const x = s.rng.range(TABLE.x + r + EDGE_MARGIN, TABLE.x + TABLE.w - r - EDGE_MARGIN);
    const y = s.rng.range(TABLE.y + r + EDGE_MARGIN, maxY - r);
    if (spotFree(s, x, y, r, avoidBossZone)) return { x, y };
  }
  return null;
}

export function makeTarget(s: RunState, kind: TargetKind, x: number, y: number, shimmer: number): Target {
  const def = TARGET_DEFS[kind];
  const st = stageById(s.stage);
  const hp = Math.ceil(def.hp * st.hpScale);
  let vx = 0;
  let vy = 0;
  if (def.drift) {
    const a = s.rng.range(0, Math.PI * 2);
    const sp = def.drift / ENEMY_PHASE_SECONDS;
    vx = Math.cos(a) * sp;
    vy = Math.sin(a) * sp;
  }
  return { id: s.nextId++, kind, x, y, r: def.r, hp, maxHp: hp, vx, vy, shimmer, flash: 0, phase: 0, shielded: false, dead: false };
}

/** Place a regular target of `kind` at a random legal spot. Returns null if no room. */
export function spawnRegular(s: RunState, kind: TargetKind, shimmer: boolean): Target | null {
  const r = TARGET_DEFS[kind].r;
  const spot = findSpot(s, r, bossAlive(s), SPAWN_MAX_Y);
  if (!spot) return null;
  const t = makeTarget(s, kind, spot.x, spot.y, shimmer ? SHIMMER_SECONDS : 0);
  s.targets.push(t);
  return t;
}

export function poolKind(s: RunState): TargetKind {
  return s.rng.pick(stageById(s.stage).pool).kind;
}

export function spawnObstacle(s: RunState, kind: ObstacleKind): Obstacle | null {
  const r = OBSTACLE_R[kind];
  const spot = findSpot(s, r, true, TABLE.y + TABLE.h - 30);
  if (!spot) return null;
  const o: Obstacle = { id: s.nextId++, kind, x: spot.x, y: spot.y, r, hp: OBSTACLE_HP[kind], flash: 0, dead: false };
  s.obstacles.push(o);
  return o;
}
