// v0.2 circle physics: every ball and every enemy is a body with mass. Integration, rails, obstacles,
// circle-circle impulses for all pairs, positional relaxation (no body is ever left intersecting), friction.
// Contact hits (damage, stagger, chain) are decided here and applied through sim/damage.ts.
import {
  MAX_LAUNCH_SPEED,
  SPEED_DMG_REF,
  STOP_SPEED,
  TABLE,
  type Ball,
  type FxEvent,
  type Obstacle,
  type RunState,
  type Target,
} from '../core/types';
import {
  BALL_TYPES,
  BASE_RESTITUTION,
  BUMP_DMG_SPEED,
  BUMPER_STAGGER_R,
  FROZEN_BOUNCE,
  HEAVY_HIT_SPEED,
  CHARGE_STOPS_ON_HIT,
  ENEMY_FRICTION_MULT,
  ENEMY_WALL_BOUNCE,
  HIT_COOLDOWN,
  HIT_MIN_SPEED,
  MAX_RESTITUTION,
  SPIT_LIFE_CAP,
  TARGET_DEFS,
  stageById,
} from '../core/tuning';
import { addStagger, chainLightning, heal, heroDamage, hitEnemy } from './damage';

export const MAX_BALL_SPEED = MAX_LAUNCH_SPEED * 1.5;
const OBSTACLE_RESTITUTION = 0.8;
const BUMPER_MIN_KICK = 80;
const SPLIT_R = 2.5;
const SPLIT_MASS = 0.5;
const SPAT_R = 2;
const SPAT_MASS = 0.4;
/** Pairs closer than r1 + r2 + this are "touching" (contact bookkeeping). */
const TOUCH_SLOP = 0.5;
const RELAX_ITERS = 6;

/** A physics body: a ball or an enemy. */
interface Body {
  ball?: Ball;
  en?: Target;
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  im: number; // inverse mass (0 = static: frozen enemy)
  resting: boolean;
  /** Dead enemy still rolling (see Target.ghost). */
  ghost?: boolean;
}

function bodies(s: RunState): Body[] {
  const out: Body[] = [];
  for (const b of s.balls) out.push(wrapBall(b));
  for (const t of s.targets) {
    if (!t.dead) out.push(wrapEnemy(t));
    else if ((t.ghost ?? 0) > 0 && !t.resting) out.push({ ...wrapEnemy(t), ghost: true });
  }
  return out;
}

// Bodies are thin views; write-back keeps Ball/Target as the single source of truth.
function wrapBall(b: Ball): Body {
  return { ball: b, id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r, im: 1 / b.mass, resting: b.resting };
}
function wrapEnemy(t: Target): Body {
  const im = (t.frozen ?? 0) > 0 ? 0 : 1 / t.mass;
  return { en: t, id: t.id, x: t.x, y: t.y, vx: t.vx, vy: t.vy, r: t.r, im, resting: t.resting };
}
function writeBack(list: Body[]): void {
  for (const b of list) {
    const o = (b.ball ?? b.en)!;
    o.x = b.x;
    o.y = b.y;
    o.vx = b.vx;
    o.vy = b.vy;
    o.resting = b.resting;
  }
}

function capSpeed(b: { vx: number; vy: number }): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_BALL_SPEED) {
    const k = MAX_BALL_SPEED / sp;
    b.vx *= k;
    b.vy *= k;
  }
}

function kindBounce(b: Body): number {
  if (!b.en) return 1;
  return (b.en.frozen ?? 0) > 0 ? FROZEN_BOUNCE : TARGET_DEFS[b.en.kind].bounce;
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function mainDamage(s: RunState, speed: number): number {
  const bt = BALL_TYPES[s.stats.ballType];
  return s.stats.damage + bt.dmgBonus + Math.floor(speed / SPEED_DMG_REF) * s.stats.speedDamage;
}

/** True if this pair's contact may count as a new hit (separated since the last one, and the cooldown passed). */
function eligible(s: RunState, key: string): boolean {
  if (s.touching[key]) return false;
  const last = s.lastHit[key];
  return last === undefined || s.t - last >= HIT_COOLDOWN;
}
function markHit(s: RunState, key: string): void {
  s.lastHit[key] = s.t;
  s.touching[key] = true;
}

/** A ball (hero/split/spat) struck an enemy with approach speed `speed`. */
function ballHitsEnemy(s: RunState, b: Ball, t: Target, speed: number, fx: FxEvent[]): void {
  if (s.phase === 'enemy') {
    // Enemy phase: a charging enemy deals its attack on first hero contact.
    if (b.kind === 'main' && (t.chargeDmg ?? 0) > 0) {
      heroDamage(s, t.chargeDmg ?? 0, t.kind, b.x, b.y, fx, 'charge');
      t.chargeDmg = 0;
      // The blow lands: the charger stops on contact (the hero keeps the full knock). Without this, heavy
      // chargers (brute, boss) plough on and pin the hero into rails and corners.
      if (CHARGE_STOPS_ON_HIT) {
        t.vx = 0;
        t.vy = 0;
      }
    } else if (b.kind === 'main') {
      // Knocked into a thornback (or a Spiky elite) during the enemy phase: thorns still prick.
      const thorns = thornsOf(t);
      if (thorns > 0) heroDamage(s, thorns, t.kind, b.x, b.y, fx, 'thorns');
    }
    return;
  }
  let dmg: number;
  if (b.kind === 'main') dmg = mainDamage(s, speed);
  else if (b.kind === 'spat') dmg = s.stats.spitDamage > 0 ? s.stats.spitDamage : s.stats.damage;
  else dmg = s.stats.damage;
  const sticky = b.kind === 'main' && s.stats.ballType === 'sticky' && !s.stickyUsed;
  const heavy = b.kind === 'main' && s.stats.heavyHits > 0 && speed >= HEAVY_HIT_SPEED;
  const thorns = thornsOf(t);
  hitEnemy(s, t, dmg, b.kind, fx, b, (heavy ? 2 : 1) + (sticky ? 1 : 0), speed);
  if (b.kind === 'main') {
    if (thorns > 0) heroDamage(s, thorns, t.kind, b.x, b.y, fx, 'thorns');
    if (sticky) {
      // Stun shot: stops dead on the first enemy contact of the shot.
      s.stickyUsed = true;
      b.vx = 0;
      b.vy = 0;
    }
    if (s.stats.splitCount > 0 && !s.splitUsed) {
      s.splitUsed = true;
      spawnSplit(s, b, fx);
    }
  }
  chainLightning(s, t, fx);
}

function thornsOf(t: Target): number {
  return (TARGET_DEFS[t.kind].thorns ?? 0) + (t.elite === 'spiky' ? 1 : 0);
}

/** Enemy-enemy bump: the slower body (pre-impact) is the bumped one; a charger that bumps anything is blocked. */
function enemyBump(s: RunState, a: Target, b: Target, rel: number, spA: number, spB: number, fx: FxEvent[]): void {
  for (const c of [a, b]) {
    if ((c.chargeDmg ?? 0) > 0) {
      c.chargeDmg = 0;
      fx.push({ t: 'blocked', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  if (rel <= BUMP_DMG_SPEED) return;
  const bumped = a.dead ? b : b.dead ? a : spA < spB ? a : spB < spA ? b : a.id < b.id ? a : b;
  hitEnemy(s, bumped, 1, 'bump', fx, undefined, 1, rel);
}

function collidePair(s: RunState, A: Body, B: Body, fx: FxEvent[]): void {
  if (A.resting && B.resting) return;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const min = A.r + B.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const sum = A.im + B.im;
  if (sum <= 0) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  const overlap = min - d;
  A.x -= nx * overlap * (A.im / sum);
  A.y -= ny * overlap * (A.im / sum);
  B.x += nx * overlap * (B.im / sum);
  B.y += ny * overlap * (B.im / sum);
  const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
  if (rv >= 0) return;
  const spA = Math.hypot(A.vx, A.vy);
  const spB = Math.hypot(B.vx, B.vy);
  const e = Math.min(MAX_RESTITUTION, BASE_RESTITUTION * kindBounce(A) * kindBounce(B));
  const j = (-(1 + e) * rv) / sum;
  A.vx -= j * A.im * nx;
  A.vy -= j * A.im * ny;
  B.vx += j * B.im * nx;
  B.vy += j * B.im * ny;
  if (A.im > 0) A.resting = false;
  if (B.im > 0) B.resting = false;
  capSpeed(A);
  capSpeed(B);
  const impact = -rv;
  if (impact > 20) fx.push({ t: 'ballClack', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, speed: impact });

  // Contact gameplay. Write positions/velocities back first so damage/fx see the post-impact state.
  writeBack([A, B]);
  const key = pairKey(A.id, B.id);
  if (A.en && B.en) {
    if (impact > HIT_MIN_SPEED && eligible(s, key)) {
      markHit(s, key);
      enemyBump(s, A.en, B.en, impact, spA, spB, fx);
    }
  } else if (A.ball && B.ball) {
    // ball-ball: no gameplay
  } else {
    const ball = (A.ball ?? B.ball)!;
    const en = (A.en ?? B.en)!;
    if (impact > HIT_MIN_SPEED && eligible(s, key)) {
      markHit(s, key);
      ballHitsEnemy(s, ball, en, ball === A.ball ? spA : spB, fx);
      // Sticky stop / landed charges change velocities; refresh the views.
      for (const v of [A, B]) {
        const o = (v.ball ?? v.en)!;
        v.vx = o.vx;
        v.vy = o.vy;
      }
    }
  }
}

function wallBounceOf(s: RunState, b: Body): number {
  if (b.en) return Math.min(1, ENEMY_WALL_BOUNCE * kindBounce(b));
  return stageById(s.stage).wallBounce;
}

/** Clamp inside the rails; reflect velocity with restitution `e`. Returns the impact speed (0 if none). */
function wallCollide(b: Body, e: number): number {
  const x0 = TABLE.x + b.r;
  const x1 = TABLE.x + TABLE.w - b.r;
  const y0 = TABLE.y + b.r;
  const y1 = TABLE.y + TABLE.h - b.r;
  let speed = 0;
  if (b.x < x0) {
    b.x = x0;
    if (b.vx < 0) ((speed = -b.vx), (b.vx = -b.vx * e));
  } else if (b.x > x1) {
    b.x = x1;
    if (b.vx > 0) ((speed = b.vx), (b.vx = -b.vx * e));
  }
  if (b.y < y0) {
    b.y = y0;
    if (b.vy < 0) ((speed = Math.max(speed, -b.vy)), (b.vy = -b.vy * e));
  } else if (b.y > y1) {
    b.y = y1;
    if (b.vy > 0) ((speed = Math.max(speed, b.vy)), (b.vy = -b.vy * e));
  }
  return speed;
}

/** Resolve a body against a static circle; returns pre-impact speed if it was approaching, else -1. */
function collideStatic(b: Body, o: { x: number; y: number; r: number }, e: number, minKick = 0): number {
  const dx = b.x - o.x;
  const dy = b.y - o.y;
  const min = o.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return -1;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 0;
  const ny = d > 1e-9 ? dy / d : -1;
  b.x = o.x + nx * min;
  b.y = o.y + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0 || b.im === 0) return -1;
  const speed = Math.hypot(b.vx, b.vy);
  const outN = Math.max(-vn * e, minKick);
  b.vx += (outN - vn) * nx;
  b.vy += (outN - vn) * ny;
  b.resting = false;
  capSpeed(b);
  return speed;
}

function hitObstacle(s: RunState, o: Obstacle, fx: FxEvent[]): void {
  o.flash = 0.12;
  if (o.kind === 'bumper') {
    s.combo.bumperHits++;
    fx.push({ t: 'bumper', x: o.x, y: o.y });
    for (const t of s.targets) {
      if (!t.dead && Math.hypot(t.x - o.x, t.y - o.y) <= BUMPER_STAGGER_R + t.r) addStagger(t, 1, fx);
    }
    return;
  }
  o.hp -= 1;
  if (o.hp > 0) return;
  o.dead = true;
  if (o.kind === 'shrine') {
    fx.push({ t: 'shrine', x: o.x, y: o.y });
    heal(s, s.stats.shrineHeal, o.x, o.y, fx);
  } else {
    const cash = Math.round((o.kind === 'chest' ? s.stats.chestCash : s.stats.crateCash) * s.stats.cashMult);
    s.cash += cash;
    fx.push({ t: 'chest', x: o.x, y: o.y, cash });
  }
}

function spawnSplit(s: RunState, b: Ball, fx: FxEvent[]): void {
  const n = s.stats.splitCount;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1e-6) return;
  const base = Math.atan2(b.vy, b.vx);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const step = Math.floor(i / 2) + 1;
    const spread = Math.min(25, (25 * step) / Math.ceil(n / 2));
    const a = base + side * spread * deg;
    const off = b.r + SPLIT_R + 0.5;
    s.balls.push({
      id: s.nextId++,
      kind: 'split',
      x: clampIn(b.x + Math.cos(a) * off, TABLE.x + SPLIT_R, TABLE.x + TABLE.w - SPLIT_R),
      y: clampIn(b.y + Math.sin(a) * off, TABLE.y + SPLIT_R, TABLE.y + TABLE.h - SPLIT_R),
      vx: Math.cos(a) * sp * 0.9,
      vy: Math.sin(a) * sp * 0.9,
      r: SPLIT_R,
      mass: SPLIT_MASS,
      life: Infinity,
      resting: false,
      banked: b.banked,
    });
  }
  fx.push({ t: 'split', x: b.x, y: b.y });
}

export function spawnSpat(s: RunState, b: Ball, fx: FxEvent[]): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1e-6) return;
  const life = Math.min(s.stats.spitLife, SPIT_LIFE_CAP);
  if (life <= 0) return;
  const side = s.rng.chance(0.5) ? 1 : -1;
  const a = Math.atan2(b.vy, b.vx) + side * s.rng.range(0.6, 1.2);
  const off = b.r + SPAT_R + 0.5;
  s.balls.push({
    id: s.nextId++,
    kind: 'spat',
    x: clampIn(b.x + Math.cos(a) * off, TABLE.x + SPAT_R, TABLE.x + TABLE.w - SPAT_R),
    y: clampIn(b.y + Math.sin(a) * off, TABLE.y + SPAT_R, TABLE.y + TABLE.h - SPAT_R),
    vx: Math.cos(a) * Math.max(sp * 0.8, 120),
    vy: Math.sin(a) * Math.max(sp * 0.8, 120),
    r: SPAT_R,
    mass: SPAT_MASS,
    life,
    resting: false,
    banked: false,
  });
  fx.push({ t: 'spit', x: b.x, y: b.y });
}

function clampIn(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/**
 * Positional-only relaxation: push every overlapping pair apart by inverse mass, then clamp to the rails and
 * obstacles. Never changes velocities or resting flags.
 */
function relaxList(s: RunState, list: Body[], iters: number): void {
  for (let it = 0; it < iters; it++) {
    let worst = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const sum = A.im + B.im;
        if (sum <= 0) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const min = A.r + B.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        // Coincident centres: separate along a deterministic axis.
        const nx = d > 1e-9 ? dx / d : 1;
        const ny = d > 1e-9 ? dy / d : 0;
        const ov = min - d;
        worst = Math.max(worst, ov);
        A.x -= nx * ov * (A.im / sum);
        A.y -= ny * ov * (A.im / sum);
        B.x += nx * ov * (B.im / sum);
        B.y += ny * ov * (B.im / sum);
      }
    }
    for (const b of list) {
      if (b.im === 0) continue;
      for (const o of s.obstacles) {
        if (o.dead) continue;
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const min = o.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-9 ? dx / d : 0;
        const ny = d > 1e-9 ? dy / d : -1;
        b.x = o.x + nx * min;
        b.y = o.y + ny * min;
      }
      b.x = clampIn(b.x, TABLE.x + b.r, TABLE.x + TABLE.w - b.r);
      b.y = clampIn(b.y, TABLE.y + b.r, TABLE.y + TABLE.h - b.r);
    }
    if (worst < 0.01) break;
  }
}

/** Relax every body in the state (used at phase ends and after spawns). */
export function relaxAll(s: RunState, iters = 40): void {
  const list = bodies(s);
  relaxList(s, list, iters);
  writeBack(list);
}

/** Largest overlap between any two live bodies (px). */
export function maxOverlap(s: RunState): number {
  const list = bodies(s);
  let worst = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      worst = Math.max(worst, A.r + B.r - Math.hypot(B.x - A.x, B.y - A.y));
    }
  }
  return worst;
}

/** One fixed physics substep of `h` seconds (resolve and enemy phases). */
export function physicsStep(s: RunState, h: number, fx: FxEvent[]): void {
  const st = stageById(s.stage);
  const list = bodies(s);

  for (const b of list) {
    if (b.resting || b.im === 0) continue;
    b.x += b.vx * h;
    b.y += b.vy * h;
    const sp = wallCollide(b, wallBounceOf(s, b));
    if (sp > 0 && b.ball) {
      b.ball.banked = true;
      fx.push({ t: 'wall', x: b.x, y: b.y, speed: sp });
    }
    for (const o of s.obstacles) {
      if (o.dead) continue;
      const bumper = o.kind === 'bumper';
      const e = bumper ? s.stats.bumperBounce : OBSTACLE_RESTITUTION;
      const hit = collideStatic(b, o, e, bumper ? BUMPER_MIN_KICK : 0);
      if (hit >= 0 && b.ball) hitObstacle(s, o, fx);
    }
  }
  writeBack(list);

  // Touching bookkeeping: a pair "separates" once it is more than TOUCH_SLOP apart.
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      const key = pairKey(A.id, B.id);
      if (!s.touching[key]) continue;
      if (Math.hypot(B.x - A.x, B.y - A.y) > A.r + B.r + TOUCH_SLOP) delete s.touching[key];
    }
  }

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      if (A.en?.dead || B.en?.dead) {
        // Ghosts only bump live enemies.
        const ok = (A.ghost && B.en && !B.en.dead) || (B.ghost && A.en && !A.en.dead);
        if (!ok || (A.ghost && A.en?.ghost === 0) || (B.ghost && B.en?.ghost === 0)) continue;
      }
      collidePair(s, A, B, fx);
    }
  }
  // Damage may have killed enemies (and spawned grubs/splits); relax only the survivors in this list.
  // Ghosts: friction like any enemy, then expire.
  for (const b of list) {
    if (!b.ghost || !b.en) continue;
    b.en.ghost = Math.max(0, (b.en.ghost ?? 0) - h);
    const k = Math.max(0, 1 - st.friction * ENEMY_FRICTION_MULT * h);
    const sp = Math.hypot(b.vx, b.vy) * k - st.rollDecel * ENEMY_FRICTION_MULT * h;
    const cur = Math.hypot(b.vx, b.vy);
    if (sp < STOP_SPEED || b.en.ghost <= 0 || cur < 1e-9) {
      b.vx = 0;
      b.vy = 0;
      b.resting = true;
      b.en.ghost = 0;
    } else {
      b.vx *= sp / cur;
      b.vy *= sp / cur;
    }
  }
  writeBack(list.filter((b) => b.ghost));
  const live = list.filter((b) => !b.en || !b.en.dead);
  relaxList(s, live, RELAX_ITERS);

  for (const b of live) {
    if (b.resting || b.im === 0) continue;
    const enemy = !!b.en;
    const fr = enemy ? st.friction * ENEMY_FRICTION_MULT : st.friction;
    const rd = enemy ? st.rollDecel * ENEMY_FRICTION_MULT : st.rollDecel;
    const k = Math.max(0, 1 - fr * h);
    b.vx *= k;
    b.vy *= k;
    const sp = Math.hypot(b.vx, b.vy);
    const ns = sp - rd * h;
    if (ns < STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
      b.resting = true;
    } else {
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
  }
  writeBack(live);
}
