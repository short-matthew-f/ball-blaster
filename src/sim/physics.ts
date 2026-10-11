// Custom circle physics: integration, wall, static-circle (targets/obstacles) and ball-ball collisions.
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
import { BALL_TYPES, SPIT_LIFE_CAP, STICKY_HOLD_SECONDS, STICKY_RELEASE_MULT, TARGET_DEFS, stageById } from '../core/tuning';
import { refill, spend } from './energy';
import { bossPhaseFx } from './boss';
import { applyDamage, chainLightning } from './targets';

export const MAX_BALL_SPEED = MAX_LAUNCH_SPEED * 1.5;
const BALL_RESTITUTION = 0.95;
const OBSTACLE_RESTITUTION = 0.8;
const BUMPER_MIN_KICK = 80;
const SPLIT_R = 2.5;
const SPLIT_MASS = 0.5;
const SPAT_R = 2;
const SPAT_MASS = 0.4;

function capSpeed(b: Ball): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_BALL_SPEED) {
    const k = MAX_BALL_SPEED / sp;
    b.vx *= k;
    b.vy *= k;
  }
}

/**
 * Resolve a moving ball against a static circle. Pushes the ball out and, if it was approaching,
 * reflects the normal component with restitution `e`. Returns the pre-impact speed if it was a real hit, else -1.
 */
function collideStatic(b: Ball, cx: number, cy: number, cr: number, e: number, minKick = 0): number {
  const dx = b.x - cx;
  const dy = b.y - cy;
  const min = cr + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return -1;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 0;
  const ny = d > 1e-9 ? dy / d : -1;
  b.x = cx + nx * min;
  b.y = cy + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return -1;
  const speed = Math.hypot(b.vx, b.vy);
  const outN = Math.max(-vn * e, minKick);
  b.vx += (outN - vn) * nx;
  b.vy += (outN - vn) * ny;
  capSpeed(b);
  return speed;
}

function mainDamage(s: RunState, speed: number): number {
  const bt = BALL_TYPES[s.stats.ballType];
  return s.stats.damage + bt.dmgBonus + Math.floor(speed / SPEED_DMG_REF) * s.stats.speedDamage;
}

function hitTarget(s: RunState, b: Ball, t: Target, speed: number, fx: FxEvent[]): void {
  const def = TARGET_DEFS[t.kind];
  let dmg: number;
  if (b.kind === 'main') {
    // A shielded boss takes no damage, so it only costs the flat hit cost (no drain, no drain-phase surcharge).
    let cost = s.stats.hitCost;
    if (!(t.kind === 'boss' && t.shielded)) {
      cost += def.drain;
      if (t.kind === 'boss' && bossPhaseFx(s).includes('drain')) cost += 1;
    }
    spend(s, cost, b.x, b.y, fx);
    dmg = mainDamage(s, speed);
  } else if (b.kind === 'spat') {
    dmg = s.stats.spitDamage > 0 ? s.stats.spitDamage : s.stats.damage;
  } else {
    dmg = s.stats.damage;
  }
  applyDamage(s, t, dmg, b.kind, fx, b);
  chainLightning(s, t, fx);
  if (b.kind === 'main') {
    if (s.stats.splitCount > 0 && !s.splitUsed) {
      s.splitUsed = true;
      spawnSplit(s, b, fx);
    }
    if (s.stats.ballType === 'sticky') {
      // Hold on the target's surface; release later along the reflected direction at reduced speed.
      const rs = Math.hypot(b.vx, b.vy);
      const k = rs > 1e-9 ? (speed * STICKY_RELEASE_MULT) / rs : 0;
      b.stuck = STICKY_HOLD_SECONDS;
      b.stuckVx = b.vx * k;
      b.stuckVy = b.vy * k;
      b.stuckTarget = t.id;
      b.stuckDmg = dmg;
      b.vx = 0;
      b.vy = 0;
    }
  }
}

function spawnSplit(s: RunState, b: Ball, fx: FxEvent[]): void {
  const n = s.stats.splitCount;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1e-6) return;
  const base = Math.atan2(b.vy, b.vx);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    // Fan alternately +25, -25, then wider: children spread around the parent's heading within ±25°.
    const side = i % 2 === 0 ? 1 : -1;
    const step = Math.floor(i / 2) + 1;
    const spread = Math.min(25, (25 * step) / Math.ceil(n / 2));
    const a = base + side * spread * deg;
    const off = b.r + SPLIT_R + 0.5;
    s.balls.push({
      id: s.nextId++,
      kind: 'split',
      x: b.x + Math.cos(a) * off,
      y: b.y + Math.sin(a) * off,
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
    x: b.x + Math.cos(a) * off,
    y: b.y + Math.sin(a) * off,
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

function hitObstacle(s: RunState, b: Ball, o: Obstacle, fx: FxEvent[]): void {
  o.flash = 0.12;
  if (o.kind === 'bumper') {
    s.combo.bumperHits++;
    fx.push({ t: 'bumper', x: o.x, y: o.y });
    refill(s, s.stats.bumperRefill, o.x, o.y, fx);
    return;
  }
  o.hp -= 1;
  if (o.hp > 0) return;
  o.dead = true;
  if (o.kind === 'shrine') {
    fx.push({ t: 'shrine', x: o.x, y: o.y });
    refill(s, s.stats.shrineEnergy, o.x, o.y, fx);
  } else {
    const cash = Math.round((o.kind === 'chest' ? s.stats.chestCash : s.stats.crateCash) * s.stats.cashMult);
    s.cash += cash;
    fx.push({ t: 'chest', x: o.x, y: o.y, cash });
  }
  void b;
}

function wallCollide(s: RunState, b: Ball, e: number, fx: FxEvent[]): void {
  const x0 = TABLE.x + b.r;
  const x1 = TABLE.x + TABLE.w - b.r;
  const y0 = TABLE.y + b.r;
  const y1 = TABLE.y + TABLE.h - b.r;
  let hit = false;
  let speed = 0;
  if (b.x < x0) {
    b.x = x0;
    if (b.vx < 0) ((speed = Math.abs(b.vx)), (b.vx = -b.vx * e), (hit = true));
  } else if (b.x > x1) {
    b.x = x1;
    if (b.vx > 0) ((speed = Math.abs(b.vx)), (b.vx = -b.vx * e), (hit = true));
  }
  if (b.y < y0) {
    b.y = y0;
    if (b.vy < 0) ((speed = Math.max(speed, Math.abs(b.vy))), (b.vy = -b.vy * e), (hit = true));
  } else if (b.y > y1) {
    b.y = y1;
    if (b.vy > 0) ((speed = Math.max(speed, Math.abs(b.vy))), (b.vy = -b.vy * e), (hit = true));
  }
  if (hit) {
    b.banked = true;
    fx.push({ t: 'wall', x: b.x, y: b.y, speed });
  }
  void s;
}

/** Clear any sticky hold (new shot / stall guard). */
export function unstick(b: Ball): void {
  b.stuck = undefined;
  b.stuckVx = undefined;
  b.stuckVy = undefined;
  b.stuckTarget = undefined;
  b.stuckDmg = undefined;
}

/** Count down a sticky hold; on release, launch and hit the held target again (free: no energy cost). */
function stickyStep(s: RunState, b: Ball, h: number, fx: FxEvent[]): void {
  b.stuck = (b.stuck ?? 0) - h;
  if (b.stuck > 1e-9) return;
  const vx = b.stuckVx ?? 0;
  const vy = b.stuckVy ?? 0;
  const t = s.targets.find((x) => x.id === b.stuckTarget);
  const dmg = b.stuckDmg ?? 0;
  unstick(b);
  b.vx = vx;
  b.vy = vy;
  if (t && !t.dead && dmg > 0) applyDamage(s, t, dmg, b.kind, fx, b);
  if (Math.hypot(vx, vy) < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
    b.resting = true;
  }
}

function collideBalls(a: Ball, b: Ball, fx: FxEvent[]): void {
  if (a.resting && b.resting) return;
  if (a.stuck || b.stuck) return; // a held sticky ball is pinned to its target
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  const overlap = min - d;
  const im = 1 / a.mass;
  const jm = 1 / b.mass;
  const sum = im + jm;
  a.x -= nx * overlap * (im / sum);
  a.y -= ny * overlap * (im / sum);
  b.x += nx * overlap * (jm / sum);
  b.y += ny * overlap * (jm / sum);
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;
  const j = (-(1 + BALL_RESTITUTION) * rv) / sum;
  a.vx -= j * im * nx;
  a.vy -= j * im * ny;
  b.vx += j * jm * nx;
  b.vy += j * jm * ny;
  a.resting = false;
  b.resting = false;
  capSpeed(a);
  capSpeed(b);
  if (-rv > 20) fx.push({ t: 'ballClack', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -rv });
}

/** One fixed physics substep of `h` seconds for the resolve phase. */
export function physicsStep(s: RunState, h: number, fx: FxEvent[]): void {
  const st = stageById(s.stage);
  const bouncyBoss = bossPhaseFx(s).includes('bouncy');

  for (const b of s.balls) {
    if (b.resting) continue;
    if (b.stuck) {
      stickyStep(s, b, h, fx);
      continue;
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
    wallCollide(s, b, st.wallBounce, fx);

    for (const t of s.targets) {
      if (t.dead || t.shimmer > 0) continue;
      let e = TARGET_DEFS[t.kind].bounce;
      if (t.kind === 'boss' && bouncyBoss) e = 1.3;
      const sp = collideStatic(b, t.x, t.y, t.r, e);
      if (sp >= 0) hitTarget(s, b, t, sp, fx);
      if (b.stuck) break;
    }
    if (b.stuck) {
      wallCollide(s, b, st.wallBounce, fx);
      continue;
    }
    for (const o of s.obstacles) {
      if (o.dead) continue;
      const bumper = o.kind === 'bumper';
      const sp = collideStatic(b, o.x, o.y, o.r, bumper ? s.stats.bumperBounce : OBSTACLE_RESTITUTION, bumper ? BUMPER_MIN_KICK : 0);
      if (sp >= 0) hitObstacle(s, b, o, fx);
    }
    // Re-clamp in case a static push moved the ball through a rail.
    wallCollide(s, b, st.wallBounce, fx);
  }

  for (let i = 0; i < s.balls.length; i++) {
    for (let j = i + 1; j < s.balls.length; j++) collideBalls(s.balls[i], s.balls[j], fx);
  }

  for (const b of s.balls) {
    if (b.resting || b.stuck) continue;
    const k = Math.max(0, 1 - st.friction * h);
    b.vx *= k;
    b.vy *= k;
    const sp = Math.hypot(b.vx, b.vy);
    const ns = sp - st.rollDecel * h;
    if (ns < STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
      b.resting = true;
    } else {
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
  }
}
