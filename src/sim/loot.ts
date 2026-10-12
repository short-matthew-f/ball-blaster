// The Loot Goblin (v0.6 M1, replaces Overtime). The boss's death ends the waves; the table clears and the goblin
// arrives: three pulls (shots) with no enemy phase. Every ball contact with it is a hit that pays a seeded loot draw;
// the TOOTH_HIT-th (4th) hit of the phase is the golden tooth (+1 token). After a shot that hit it, it scurries straight away from
// the hero to the first rail (sliding along the rail when it is already on it), ignoring obstacles and hazards.
// aim -> resolve -> loot (hold) -> aim ... third pull -> loot (hold) -> over.
import { TABLE, type FxEvent, type RunState, type Target } from '../core/types';
import {
  GOBLIN_SPAWN,
  LOOT_ARRIVE_HOLD,
  LOOT_FRAC,
  LOOT_PULLS,
  LOOT_WEIGHTS,
  SCURRY_HOLD,
  TARGET_DEFS,
  TOOTH_HIT,
  WAVES_PER_STAGE,
  stageById,
} from '../core/tuning';
import { hero } from './damage';
import { payClear } from './enemy';
import { relaxAll } from './physics';
import { buildResult, jamRule } from './run';
import { findFreeNear, makeEnemy, spotFree } from './spawn';

export type LootTier = keyof typeof LOOT_WEIGHTS;
const TIERS: { tier: LootTier; weight: number }[] = (Object.keys(LOOT_WEIGHTS) as LootTier[]).map((tier) => ({ tier, weight: LOOT_WEIGHTS[tier] }));

/** The goblin, if the loot phase is running (it is the only target then). */
export function goblin(s: RunState): Target | undefined {
  return s.targets.find((t) => t.kind === 'goblin' && !t.dead);
}

/** Loot mode: the goblin is on the table (from startLoot to the end of the run). */
export function inLoot(s: RunState): boolean {
  return goblin(s) !== undefined;
}

/** The boss's kill cash on this stage (the kill formula: base x cashScale x cashMult); loot tiers are fractions of it. */
export function bossKillCash(s: RunState): number {
  return Math.round(TARGET_DEFS.boss.cash * stageById(s.stage).cashScale * s.stats.cashMult);
}

/** Cash for one loot draw of `tier`. */
export function lootCash(s: RunState, tier: LootTier): number {
  return Math.max(1, Math.round(bossKillCash(s) * LOOT_FRAC[tier]));
}

/**
 * A counted ball contact on the goblin: +1 hit, a seeded tier draw paid in cash (s.cash and s.loot), fx goblinHit; the
 * TOOTH_HIT-th hit of the phase drops the golden tooth (+1 token). Never touches s.combo or shotBounces.
 */
export function goblinHit(s: RunState, g: Target, fx: FxEvent[]): void {
  s.goblinHits++;
  const tier = s.rng.pick(TIERS).tier;
  const cash = lootCash(s, tier);
  s.cash += cash;
  s.loot += cash;
  fx.push({ t: 'goblinHit', x: g.x, y: g.y, tier, cash });
  if (s.goblinHits === TOOTH_HIT) {
    s.tooth = true;
    s.tokens += 1;
    fx.push({ t: 'tooth', x: g.x, y: g.y });
    fx.push({ t: 'token', x: g.x, y: g.y, amount: 1 });
  }
}

/** Distance along unit (ux,uy) from (x,y) to the first rail for a body of radius r, and which rail axis it meets. */
function railHit(x: number, y: number, ux: number, uy: number, r: number): { t: number; axis: 'x' | 'y' } {
  const x0 = TABLE.x + r;
  const x1 = TABLE.x + TABLE.w - r;
  const y0 = TABLE.y + r;
  const y1 = TABLE.y + TABLE.h - r;
  const tx = ux > 1e-9 ? (x1 - x) / ux : ux < -1e-9 ? (x0 - x) / ux : Infinity;
  const ty = uy > 1e-9 ? (y1 - y) / uy : uy < -1e-9 ? (y0 - y) / uy : Infinity;
  return tx <= ty ? { t: Math.max(0, tx), axis: 'x' } : { t: Math.max(0, ty), axis: 'y' };
}

/**
 * Scurry destination (pure geometry; rails only, obstacles and hazards ignored). u = direction from the hero to the
 * goblin ((0,-1) when they coincide); slide along u to the first rail. Already on that rail (< 2 px): slide along it
 * (u minus its normal component; zero: the rail's + axis) to the corner.
 */
export function scurryDest(gx: number, gy: number, r: number, hx: number, hy: number): { x: number; y: number } {
  let ux = gx - hx;
  let uy = gy - hy;
  const d = Math.hypot(ux, uy);
  if (d < 1e-6) ((ux = 0), (uy = -1));
  else ((ux /= d), (uy /= d));
  const a = railHit(gx, gy, ux, uy, r);
  if (a.t >= 2) return { x: gx + ux * a.t, y: gy + uy * a.t };
  // On the rail: drop the normal component (left/right rails: x; top/bottom: y).
  let vx = a.axis === 'x' ? 0 : ux;
  let vy = a.axis === 'y' ? 0 : uy;
  const L = Math.hypot(vx, vy);
  if (L < 1e-9) {
    vx = a.axis === 'y' ? 1 : 0;
    vy = a.axis === 'x' ? 1 : 0;
  } else ((vx /= L), (vy /= L));
  const b = railHit(gx, gy, vx, vy, r);
  return { x: gx + vx * b.t, y: gy + vy * b.t };
}

/**
 * Boss dead and everything at rest (from endShot or endTurn): pay the boss-wave clear, clear the table, the goblin
 * arrives (GOBLIN_SPAWN, else the nearest free spot), three pulls, then the LOOT_ARRIVE_HOLD hold before aim.
 */
export function startLoot(s: RunState, fx: FxEvent[]): void {
  payClear(s, fx, WAVES_PER_STAGE + 1);
  s.targets = [];
  s.enemyQueue = [];
  s.beltAt = undefined;
  s.timeStopped = false;
  s.skipNextEnemyPhase = false;
  s.balls = s.balls.filter((b) => b.kind === 'main');
  const r = TARGET_DEFS.goblin.r;
  const p = spotFree(s, GOBLIN_SPAWN.x, GOBLIN_SPAWN.y, r) ? { x: GOBLIN_SPAWN.x, y: GOBLIN_SPAWN.y } : findFreeNear(s, GOBLIN_SPAWN.x, GOBLIN_SPAWN.y, r) ?? { x: GOBLIN_SPAWN.x, y: GOBLIN_SPAWN.y };
  const g = makeEnemy(s, 'goblin', p.x, p.y);
  g.shimmer = LOOT_ARRIVE_HOLD;
  s.targets.push(g);
  fx.push({ t: 'shimmer', x: g.x, y: g.y });
  s.pulls = LOOT_PULLS;
  s.loot = 0;
  s.goblinHits = 0;
  relaxAll(s);
  jamRule(s, fx);
  fx.push({ t: 'lootStart' });
  s.phase = 'loot';
  s.lootHold = LOOT_ARRIVE_HOLD;
}

/** A loot pull ended (every ball at rest): scurry if it hit, then the SCURRY_HOLD hold. */
export function endLootShot(s: RunState, fx: FxEvent[]): void {
  s.targets = s.targets.filter((t) => !t.dead);
  s.obstacles = s.obstacles.filter((o) => !o.dead);
  relaxAll(s);
  const g = goblin(s);
  if (g && s.goblinHits > (s.shotGoblinHits ?? 0)) {
    const h = hero(s);
    const x0 = g.x;
    const y0 = g.y;
    const p = scurryDest(g.x, g.y, g.r, h.x, h.y);
    g.x = p.x;
    g.y = p.y;
    g.vx = 0;
    g.vy = 0;
    g.resting = true;
    relaxAll(s);
    fx.push({ t: 'scurry', id: g.id, x: g.x, y: g.y, x0, y0 });
  }
  s.phase = 'loot';
  s.lootHold = SCURRY_HOLD;
}

/** One loot-phase substep: the hold runs down (sim time), then aim (pulls left) or the run ends. */
export function lootStep(s: RunState, h: number, fx: FxEvent[]): void {
  s.lootHold = (s.lootHold ?? 0) - h;
  if (s.lootHold > 1e-9) return;
  s.lootHold = 0;
  const g = goblin(s);
  if (g) g.shimmer = 0;
  if ((s.pulls ?? 0) > 0) {
    jamRule(s, fx);
    s.phase = 'aim';
    return;
  }
  fx.push({ t: 'lootEnd', cash: s.loot, hits: s.goblinHits });
  s.phase = 'over';
  s.result = buildResult(s);
}
