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
  ICE_PATCH_FRICTION,
  HIT_COOLDOWN,
  HIT_MIN_SPEED,
  MAX_RESTITUTION,
  SPIT_LIFE_CAP,
  TARGET_DEFS,
  CHILL_PHASES,
  DRAW_RETURN,
  EXPLOSIVE_KEEP,
  EXPLOSIVE_R,
  JUMP_PENALTY,
  RICOCHET_MAX,
  SHARD_DMG,
  THORNS_RELIC_DMG,
  GEAR_BOUNCE,
  GEAR_MIN_KICK,
  GEAR_SPIN_DEG,
  GEAR_EXIT_MAX_DEG,
  GOBLIN_HIT_COOLDOWN,
  GOBLIN_HIT_SPEED,
  gearVal,
  stageById,
  FOLLOW_KEEP_LV,
  STICKY_STAGGER,
  ANCHOR_DMG,
  ANVIL_MULT,
  AVALANCHE_BUMP,
  BANK_MIN_RAILS,
  BANK_PER_RAIL,
  BREAKER_SHOVE,
  POCKET_MULT,
  POCKET_RAILS,
  WRECK_SHOVE,
  AIMED_R,
  BRITTLE_DMG,
  DART_DMG,
  DART_SPEED,
  DEEP_FREEZE_PHASES,
  FREEZE_CAP,
  HEAVY_SPIT_DMG,
  MORTAR_BLASTS,
  MORTAR_DMG,
  MORTAR_R,
  NUMB_DMG,
  POUNCE_MULT,
  PULL_K,
  SEEK_R,
  SNAP_RETURN,
  STOMP_STAGGER,
  SWARM_DMG,
  TAILWIND_MULT,
  TRAP_MULT,
  WEB_R,
  WEB_STAGGER,
} from '../core/tuning';
import { addPoison, addStagger, applyDamage, chainLightning, heal, heroDamage, hitEnemy, scaleAtk, scaleCash } from './damage';
import { clampIn, spawnSplit } from './balls';
import { has, heroGap, lv, mod } from './gear';
import { goblinHit } from './loot';

export const MAX_BALL_SPEED = MAX_LAUNCH_SPEED * 1.5;
const OBSTACLE_RESTITUTION = 0.8;
const BUMPER_MIN_KICK = 80;
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
  // Wrecking (heavy fork): Heavy's +1 goes; every contact shoves instead.
  const bonus = mod(s, 'heavy.wrecking') ? 0 : bt.dmgBonus;
  // Dart (light fork): a flat +DART_DMG at DART_SPEED or faster (Velocity still adds).
  const dart = mod(s, 'light.dart') && speed >= DART_SPEED ? DART_DMG : 0;
  return s.stats.damage + bonus + dart + Math.floor(speed / SPEED_DMG_REF) * s.stats.speedDamage;
}

/** Numb (chill fork): a chilled enemy's blow deals NUMB_DMG less (min 1; a 0 stays 0). */
export function numbed(s: RunState, t: Target, n: number): number {
  return n > 0 && (t.chill ?? 0) > 0 && mod(s, 'chill.numb') ? Math.max(1, n - NUMB_DMG) : n;
}

/** Nearest live enemy (not the goblin, not `except`) within `R` (edge gap) of the hero; ties: lowest id. */
function nearestToHero(s: RunState, R: number, except?: Target): Target | undefined {
  let best: Target | undefined;
  let bestD = Infinity;
  for (const o of s.targets) {
    if (o.dead || o === except || o.kind === 'goblin') continue;
    const d = heroGap(s, o);
    if (d <= R && (d < bestD || (d === bestD && best && o.id < best.id))) ((best = o), (bestD = d));
  }
  return best;
}

/** Breaker / Wrecking: scale an enemy's (post-impact) velocity by k, speed-capped. */
function shove(t: Target, k: number): void {
  t.vx *= k;
  t.vy *= k;
  capSpeed(t);
}

/** True if this pair's contact may count as a new hit (separated since the last one, and the cooldown passed). */
function eligible(s: RunState, key: string, cooldown = HIT_COOLDOWN): boolean {
  if (s.touching[key]) return false;
  const last = s.lastHit[key];
  return last === undefined || s.t - last >= cooldown;
}
function markHit(s: RunState, key: string): void {
  s.lastHit[key] = s.t;
  s.touching[key] = true;
}

/** A ball (hero/split/spat) struck an enemy with approach speed `speed`; (pvx,pvy) = the ball's pre-impact velocity. */
function ballHitsEnemy(s: RunState, b: Ball, t: Target, speed: number, fx: FxEvent[], pvx = b.vx, pvy = b.vy): void {
  if (s.phase === 'enemy') {
    // Enemy phase: a charging enemy deals its attack on first hero contact.
    if (b.kind === 'main' && (t.chargeDmg ?? 0) > 0) {
      // Cling (sticky capstone): the enemy the hero last stuck to cannot land a charge (never the boss; no Thorns).
      if (mod(s, 'sticky.cling') && t.id === s.stuckId && t.kind !== 'boss') {
        t.chargeDmg = 0;
        t.vx = 0;
        t.vy = 0;
        fx.push({ t: 'blocked', x: (b.x + t.x) / 2, y: (b.y + t.y) / 2 });
        return;
      }
      // Juggernaut (heavy capstone): the first charge to land each enemy phase is blocked (no blow, no Thorns).
      if (mod(s, 'heavy.jugger') && !s.juggerUsed) {
        s.juggerUsed = true;
        t.chargeDmg = 0;
        t.vx = 0;
        t.vy = 0;
        fx.push({ t: 'blocked', x: (b.x + t.x) / 2, y: (b.y + t.y) / 2 });
        return;
      }
      heroDamage(s, numbed(s, t, t.chargeDmg ?? 0), t.kind, b.x, b.y, fx, 'charge');
      t.chargeDmg = 0;
      // Thorns relic: the charger pays for landing its blow.
      if (has(s, 'thorns')) applyDamage(s, t, gearVal(THORNS_RELIC_DMG, lv(s, 'thorns')), 'thorns', fx);
      // The blow lands: the charger stops on contact (the hero keeps the full knock). Without this, heavy
      // chargers (brute, boss) plough on and pin the hero into rails and corners.
      if (CHARGE_STOPS_ON_HIT) {
        t.vx = 0;
        t.vy = 0;
      }
    } else if (b.kind === 'main') {
      // Knocked into a thornback (or a Spiky elite) during the enemy phase: thorns still prick.
      const thorns = thornsOf(s, t);
      if (thorns > 0) heroDamage(s, thorns, t.kind, b.x, b.y, fx, 'thorns');
    }
    return;
  }
  let dmg: number;
  const first = b.kind === 'main' && !s.firstHitDone;
  // Brittle / Deep Freeze read the chill from before this contact (the Chill relic sets it below).
  const chilled = (t.chill ?? 0) > 0;
  const carom = b.kind === 'main' && mod(s, 'ricochet.carom');
  const anvil = first && mod(s, 'heavy.anvil');
  if (b.kind === 'main') {
    dmg = mainDamage(s, speed) + s.momentum;
    const cap = gearVal(RICOCHET_MAX, lv(s, 'ricochet'));
    // Ricochet: +1 per rail bounce before the first hit of the shot (that hit only). Bank: +BANK_PER_RAIL per rail from
    // BANK_MIN_RAILS rails (else +0). Carom: every hero contact counts as a rail and every contact gets the bonus.
    if (carom) dmg += Math.min(s.shotBounces, cap);
    else if (first && mod(s, 'ricochet.bank')) dmg += s.shotBounces >= BANK_MIN_RAILS ? Math.min(BANK_PER_RAIL * s.shotBounces, cap) : 0;
    else if (first && has(s, 'ricochet')) dmg += Math.min(s.shotBounces, cap);
    // Pocket: a first hit after POCKET_RAILS rails makes this shot's kills pay double (set before the hit: a killing bank pays).
    if (first && mod(s, 'ricochet.pocket') && s.shotBounces >= POCKET_RAILS) {
      s.pocketShot = s.shots;
      fx.push({ t: 'combo', name: 'POCKET', mult: POCKET_MULT, x: b.x, y: b.y });
    }
    // Anchor: the shot after a Recall hits harder on every hero contact.
    if (mod(s, 'recall.anchor') && s.anchorShot === s.shots) dmg += ANCHOR_DMG;
    // Brittle (chill fork): chilled enemies take +BRITTLE_DMG from the hero.
    if (chilled && mod(s, 'chill.brittle')) dmg += BRITTLE_DMG;
    // Jump: the first contact after landing is softer (Pounce: doubled first, then the level penalty/bonus).
    if (b.jumpLanded) {
      b.jumpLanded = false;
      dmg = Math.max(1, dmg * (mod(s, 'jump.pounce') ? POUNCE_MULT : 1) - gearVal(JUMP_PENALTY, lv(s, 'jump')));
      // Trample (jump capstone): the enemy just jumped takes the landing hit too (no status, lightning or blast).
      const j = mod(s, 'jump.trample') && b.lastJumped !== undefined ? s.targets.find((o) => o.id === b.lastJumped) : undefined;
      if (j && !j.dead && j !== t) hitEnemy(s, j, dmg, 'main', fx, b, 1, speed);
      b.lastJumped = undefined;
    }
    // Trap (sticky capstone): a later hero contact on the enemy the hero stuck to deals x TRAP_MULT, once.
    if (t.trapped) {
      t.trapped = false;
      dmg *= TRAP_MULT;
    }
    // Anvil: the first contact doubles after every additive bonus (and stops the hero, below).
    if (anvil) dmg *= ANVIL_MULT;
  } else if (b.shard) dmg = SHARD_DMG;
  else if (b.kind === 'spat') dmg = mod(s, 'spitter.heavyspit') ? HEAVY_SPIT_DMG : s.stats.spitDamage > 0 ? s.stats.spitDamage : s.stats.damage;
  else dmg = mod(s, 'split.swarm') ? SWARM_DMG : s.stats.damage;
  const sticky = b.kind === 'main' && s.stats.ballType === 'sticky' && !s.stickyUsed;
  // Heavy Hits relic or Blur (light capstone): a fast hero contact staggers 2 (never 3).
  const heavy = b.kind === 'main' && (s.stats.heavyHits > 0 || mod(s, 'light.blur')) && speed >= HEAVY_HIT_SPEED;
  const thorns = thornsOf(s, t);
  // Crack (break fork): the first hero contact of the shot staggers +1.
  const crack = first && mod(s, 'break.crack') ? 1 : 0;
  hitEnemy(s, t, dmg, b.kind, fx, b, (heavy ? 2 : 1) + (sticky ? gearVal(STICKY_STAGGER, lv(s, 'sticky')) : 0) + crack, speed);
  // Breaker (first contact) and Wrecking (every contact) shove the struck enemy during the shot.
  if (b.kind === 'main' && !t.dead) {
    if (first && mod(s, 'break.breaker')) shove(t, BREAKER_SHOVE);
    if (mod(s, 'heavy.wrecking')) shove(t, WRECK_SHOVE);
  }
  if (carom) s.shotBounces++;
  // Mortar (spitter fork): a spat contact also blasts the others near the struck enemy (MORTAR_BLASTS a shot).
  if (b.kind === 'spat' && !b.shard && mod(s, 'spitter.mortar') && (s.mortarBlasts ?? 0) < MORTAR_BLASTS) {
    s.mortarBlasts = (s.mortarBlasts ?? 0) + 1;
    fx.push({ t: 'blast', x: t.x, y: t.y, r: MORTAR_R + t.r });
    for (const o of s.targets.slice()) {
      if (o.dead || o === t) continue;
      if (Math.hypot(o.x - t.x, o.y - t.y) - o.r - t.r <= MORTAR_R) hitEnemy(s, o, MORTAR_DMG, 'explosion', fx);
    }
  }
  addPoison(s, t, fx);
  if (!t.dead && has(s, 'chill')) {
    const was = t.chill ?? 0;
    t.chill = Math.max(was, gearVal(CHILL_PHASES, lv(s, 'chill')));
    if (was <= 0) fx.push({ t: 'status', id: t.id, kind: 'chill', on: true });
  }
  // Deep Freeze (chill capstone): a hero contact on an already-chilled enemy freezes it (not boss/cadre, FREEZE_CAP).
  if (b.kind === 'main' && chilled && !t.dead && mod(s, 'chill.deepfreeze') && t.kind !== 'boss' && t.kind !== 'cadre' && !((t.frozen ?? 0) > 0)) {
    if (s.targets.filter((o) => !o.dead && (o.frozen ?? 0) > 0).length < FREEZE_CAP) {
      t.frozen = DEEP_FREEZE_PHASES;
      t.vx = 0;
      t.vy = 0;
      t.resting = true;
      t.chargeDmg = 0;
      fx.push({ t: 'freeze', x: t.x, y: t.y });
    }
  }
  if (b.kind === 'main') {
    if (thorns > 0) heroDamage(s, thorns, t.kind, b.x, b.y, fx, 'thorns');
    if (sticky) {
      // Stun shot: stops dead on the first enemy contact of the shot.
      s.stickyUsed = true;
      b.vx = 0;
      b.vy = 0;
      stick(s, t, fx);
    }
    if (anvil) {
      b.vx = 0;
      b.vy = 0;
    }
    if (first) {
      s.firstHitDone = true;
      if (!sticky && !anvil) cueAfterContact(s, b, pvx, pvy, t, fx);
      if (has(s, 'explosive')) explode(s, b, t, dmg, fx);
    }
    if (s.stats.splitCount > 0 && !s.splitUsed && has(s, 'split')) {
      s.splitUsed = true;
      spawnSplit(s, b, fx);
    }
  }
  // Surge (lightning capstone): the hero's first contact of the shot always arcs.
  chainLightning(s, t, fx, first && mod(s, 'lightning.surge'));
}

/** Sticky ball forks/capstones, at the stick: Glue holds, Web staggers neighbours, Trap arms, Cling marks. */
function stick(s: RunState, t: Target, fx: FxEvent[]): void {
  if (mod(s, 'sticky.web')) {
    for (const o of s.targets.slice()) {
      if (o.dead || o === t) continue;
      if (Math.hypot(o.x - t.x, o.y - t.y) - o.r - t.r <= WEB_R) addStagger(o, WEB_STAGGER, fx, s);
    }
  }
  if (t.dead) return;
  if (mod(s, 'sticky.glue') && t.kind !== 'boss') t.held = Math.max(t.held ?? 0, 1);
  if (mod(s, 'sticky.trap')) t.trapped = true;
  if (mod(s, 'sticky.cling')) s.stuckId = t.id;
}

/**
 * A counted ball contact on the Loot Goblin: the loot draw (sim/loot.ts). No damage, stagger, status, lightning,
 * Explosive, Sticky stop or thorns; it never counts in s.combo. The hero's first contact of the shot fires Draw / Follow
 * and releases Split.
 */
function ballHitsGoblin(s: RunState, b: Ball, g: Target, fx: FxEvent[], pvx: number, pvy: number): void {
  goblinHit(s, g, fx);
  if (b.kind !== 'main') return;
  if (!s.firstHitDone) {
    s.firstHitDone = true;
    cueAfterContact(s, b, pvx, pvy, g, fx);
  }
  if (s.stats.splitCount > 0 && !s.splitUsed && has(s, 'split')) {
    s.splitUsed = true;
    spawnSplit(s, b, fx);
  }
}

/**
 * Draw / Follow: replace the hero's post-impact velocity after the first contact of the shot (struck body `t`).
 * Snap Back: faster return. Seek: the return heads for the nearest other enemy near the hero. Pull: `t` is dragged along.
 */
function cueAfterContact(s: RunState, b: Ball, pvx: number, pvy: number, t: Target, fx: FxEvent[]): void {
  if (s.stats.cue === 'draw' && s.launch) {
    const seek = mod(s, 'draw.seek') ? nearestToHero(s, SEEK_R, t) : undefined;
    const dx = (seek ? seek.x : s.launch.x) - b.x;
    const dy = (seek ? seek.y : s.launch.y) - b.y;
    const d = Math.hypot(dx, dy);
    const sp = s.launch.speed * (mod(s, 'draw.snap') ? SNAP_RETURN : DRAW_RETURN);
    // Already on the launch point: just reverse the pre-impact direction.
    const ux = d > 1 ? dx / d : -pvx / (Math.hypot(pvx, pvy) || 1);
    const uy = d > 1 ? dy / d : -pvy / (Math.hypot(pvx, pvy) || 1);
    b.vx = ux * sp;
    b.vy = uy * sp;
    if (mod(s, 'draw.pull') && !t.dead && t.kind !== 'goblin') {
      t.vx = ux * sp * PULL_K;
      t.vy = uy * sp * PULL_K;
      t.resting = false;
      capSpeed(t);
      fx.push({ t: 'ballClack', x: t.x, y: t.y, speed: sp * PULL_K });
    }
  } else if (s.stats.cue === 'follow') {
    const keep = gearVal(FOLLOW_KEEP_LV, lv(s, 'follow'));
    b.vx = pvx * keep;
    b.vy = pvy * keep;
  }
}

/** Explosive relic: the first hit of the shot blasts floor(dmg/2) (min 1) to other enemies near the impact; the ball loses speed. */
function explode(s: RunState, b: Ball, t: Target, dmg: number, fx: FxEvent[]): void {
  const L = lv(s, 'explosive');
  const R = gearVal(EXPLOSIVE_R, L);
  const k = b.r / (b.r + t.r);
  const ix = b.x + (t.x - b.x) * k;
  const iy = b.y + (t.y - b.y) * k;
  fx.push({ t: 'blast', x: ix, y: iy, r: R });
  const n = Math.max(1, Math.floor(dmg / 2));
  for (const o of s.targets.slice()) {
    if (o.dead || o === t) continue;
    if (Math.hypot(o.x - ix, o.y - iy) - o.r <= R) hitEnemy(s, o, n, 'explosion', fx);
  }
  const keep = gearVal(EXPLOSIVE_KEEP, L);
  b.vx *= keep;
  b.vy *= keep;
}

function thornsOf(s: RunState, t: Target): number {
  return scaleAtk(s, (TARGET_DEFS[t.kind].thorns ?? 0) + (t.elite === 'spiky' ? 1 : 0));
}

/** Ice hazard: a body whose centre is inside an ice patch has no friction or rolling deceleration. */
export function onIce(s: RunState, x: number, y: number): boolean {
  for (const z of s.hazards) if (z.kind === 'ice' && (x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return true;
  return false;
}

/**
 * Enemy-enemy bump: the slower body (pre-impact) is the bumped one; a charger that bumps anything is blocked.
 * Clockwork cog: a charging cog is never the bumped body and keeps its charge; the other takes the flat bump.
 */
function enemyBump(s: RunState, a: Target, b: Target, rel: number, spA: number, spB: number, fx: FxEvent[]): void {
  if (a.kind === 'goblin' || b.kind === 'goblin') return;
  // Frostbite (chill capstone): a bump during the shot passes the chill from a chilled body to an unchilled one.
  if (s.phase === 'resolve' && mod(s, 'chill.frostbite')) {
    const ca = (a.chill ?? 0) > 0;
    const cb = (b.chill ?? 0) > 0;
    const o = ca && !cb ? b : cb && !ca ? a : undefined;
    if (o && !o.dead) {
      o.chill = Math.max(o.chill ?? 0, gearVal(CHILL_PHASES, lv(s, 'chill')));
      fx.push({ t: 'status', id: o.id, kind: 'chill', on: true });
    }
  }
  const cogA = a.kind === 'cog' && (a.chargeDmg ?? 0) > 0;
  const cogB = b.kind === 'cog' && (b.chargeDmg ?? 0) > 0;
  if (cogA !== cogB) {
    const other = cogA ? b : a;
    if ((other.chargeDmg ?? 0) > 0) {
      other.chargeDmg = 0;
      fx.push({ t: 'blocked', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    hitEnemy(s, other, 1, 'bump', fx, undefined, 1, rel);
    return;
  }
  for (const c of [a, b]) {
    if ((c.chargeDmg ?? 0) > 0) {
      c.chargeDmg = 0;
      fx.push({ t: 'blocked', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  if (rel <= BUMP_DMG_SPEED) return;
  const bumped = a.dead ? b : b.dead ? a : spA < spB ? a : spB < spA ? b : a.id < b.id ? a : b;
  // Avalanche (heavy capstone): bumps during the shot deal AVALANCHE_BUMP.
  const n = s.phase === 'resolve' && mod(s, 'heavy.avalanche') ? AVALANCHE_BUMP : 1;
  hitEnemy(s, bumped, n, 'bump', fx, undefined, 1, rel);
}

/** Jump cue: the hero passes over this enemy (no collision, no relaxation) until they stop overlapping. */
function jumping(A: Body, B: Body): boolean {
  const ball = A.ball ?? B.ball;
  const en = A.en ?? B.en;
  return !!ball && !!en && ball.kind === 'main' && (ball.jumpOver ?? 0) > 0 && ball.jumpOver === en.id;
}

function collidePair(s: RunState, A: Body, B: Body, fx: FxEvent[]): void {
  if (A.resting && B.resting) return;
  if (jumping(A, B)) return;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const min = A.r + B.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const sum = A.im + B.im;
  if (sum <= 0) return;
  // Jump cue: the hero's first enemy contact of the shot starts a jump over it instead of a collision (never the goblin:
  // a hop would only waste a pull).
  {
    const ball = A.ball ?? B.ball;
    const en = A.en ?? B.en;
    if (ball && en && en.kind !== 'goblin' && ball.kind === 'main' && s.phase === 'resolve' && s.stats.cue === 'jump' && (ball.jumpOver === undefined || ball.jumpOver === 0) && (s.jumpsLeft ?? 0) > 0 && !s.firstHitDone) {
      // Long Jump: LONG_JUMP_HOPS hops a shot (set in shoot()), else one.
      ball.jumpOver = en.id;
      s.jumpsLeft = (s.jumpsLeft ?? 0) - 1;
      return;
    }
  }
  const pre = { avx: A.vx, avy: A.vy, bvx: B.vx, bvy: B.vy };
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
    const gob = en.kind === 'goblin';
    if (gob ? impact > GOBLIN_HIT_SPEED && eligible(s, key, GOBLIN_HIT_COOLDOWN) : impact > HIT_MIN_SPEED && eligible(s, key)) {
      markHit(s, key);
      const isA = ball === A.ball;
      if (gob) ballHitsGoblin(s, ball, en, fx, isA ? pre.avx : pre.bvx, isA ? pre.avy : pre.bvy);
      else ballHitsEnemy(s, ball, en, isA ? spA : spB, fx, isA ? pre.avx : pre.bvx, isA ? pre.avy : pre.bvy);
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
  const hero = b.ball?.kind === 'main' && s.phase === 'resolve';
  // Ghost Rail (ricochet capstone): the hero banks at full speed until its first hit of the shot.
  const e = hero && !s.firstHitDone && mod(s, 'ricochet.ghost') ? 1 : stageById(s.stage).wallBounce;
  // Tailwind (light capstone): the hero's rails add speed during the shot (MAX_BALL_SPEED bounds it).
  return hero && mod(s, 'light.tailwind') ? e * TAILWIND_MULT : e;
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
  if (o.kind === 'gear') return; // unbreakable; contact handled by gearSpin
  o.flash = 0.12;
  if (o.kind === 'bumper') {
    s.combo.bumperHits++;
    fx.push({ t: 'bumper', x: o.x, y: o.y });
    for (const t of s.targets) {
      if (!t.dead && Math.hypot(t.x - o.x, t.y - o.y) <= BUMPER_STAGGER_R + t.r) addStagger(t, 1, fx, s);
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
    const cash = scaleCash(s, (o.kind === 'chest' ? s.stats.chestCash : s.stats.crateCash) * s.stats.cashMult);
    s.cash += cash;
    fx.push({ t: 'chest', x: o.x, y: o.y, cash });
  }
}

/**
 * Clockwork gear contact (after collideStatic): the exit velocity turns GEAR_SPIN_DEG clockwise (y-down). An enemy takes
 * +1 stagger once per phase (pair bookkeeping); no damage, no chain. Chargers lose their charge (cover, in physicsStep).
 */
function gearSpin(s: RunState, b: Body, o: Obstacle, fx: FxEvent[]): void {
  const sp = Math.hypot(b.vx, b.vy);
  const d = Math.hypot(b.x - o.x, b.y - o.y);
  if (sp > 1e-9 && d > 1e-9) {
    // Exit angle relative to the outward normal; turn it clockwise by GEAR_SPIN_DEG but never past GEAR_EXIT_MAX_DEG,
    // so the body always leaves (an uncapped turn can aim a glancing exit back into the gear: it would orbit).
    const nx = (b.x - o.x) / d;
    const ny = (b.y - o.y) / d;
    const phi = Math.atan2(nx * b.vy - ny * b.vx, nx * b.vx + ny * b.vy);
    const max = (GEAR_EXIT_MAX_DEG * Math.PI) / 180;
    const turned = phi >= max ? phi : Math.min(phi + (GEAR_SPIN_DEG * Math.PI) / 180, max);
    const a = Math.atan2(ny, nx) + turned;
    b.vx = Math.cos(a) * sp;
    b.vy = Math.sin(a) * sp;
  }
  o.flash = 0.12;
  const k = (o.r / (o.r + b.r));
  fx.push({ t: 'gearSpin', x: o.x + (b.x - o.x) * k, y: o.y + (b.y - o.y) * k });
  if (b.en && !b.en.dead) {
    const key = pairKey(o.id, b.id);
    if (eligible(s, key)) {
      markHit(s, key);
      addStagger(b.en, 1, fx, s);
    }
  }
}

export function spawnSpat(s: RunState, b: Ball, fx: FxEvent[]): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1e-6) return;
  const life = Math.min(s.stats.spitLife, SPIT_LIFE_CAP);
  if (life <= 0) return;
  const side = s.rng.chance(0.5) ? 1 : -1;
  let a = Math.atan2(b.vy, b.vx) + side * s.rng.range(0.6, 1.2);
  // Aimed (spitter capstone): the spit heads for the nearest enemy near the hero (the side roll is still drawn).
  const aim = mod(s, 'spitter.aimed') ? nearestToHero(s, AIMED_R) : undefined;
  if (aim) a = Math.atan2(aim.y - b.y, aim.x - b.x);
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
        if (sum <= 0 || jumping(A, B)) continue;
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

  let railSplit: Ball | undefined;
  for (const b of list) {
    if (b.resting || b.im === 0) continue;
    b.x += b.vx * h;
    b.y += b.vy * h;
    const sp = wallCollide(b, wallBounceOf(s, b));
    if (sp > 0 && b.ball) {
      b.ball.banked = true;
      const heroShot = b.ball.kind === 'main' && s.phase === 'resolve';
      if (heroShot && (!s.firstHitDone || mod(s, 'ricochet.carom'))) s.shotBounces++;
      if (heroShot && mod(s, 'light.tailwind')) capSpeed(b);
      // Rail Split (split fork): the hero's first rail before any hit releases the split (spawned after writeBack).
      if (heroShot && !s.firstHitDone && !s.splitUsed && mod(s, 'split.rail') && s.stats.splitCount > 0 && has(s, 'split')) {
        s.splitUsed = true;
        railSplit = b.ball;
      }
      fx.push({ t: 'wall', x: b.x, y: b.y, speed: sp });
    }
    // Cog: a charge ricochets off one rail; the second rail contact of the same charge stops it dead.
    if (sp > 0 && b.en && b.en.kind === 'cog' && (b.en.chargeDmg ?? 0) > 0) {
      b.en.railHits = (b.en.railHits ?? 0) + 1;
      if (b.en.railHits >= 2) {
        b.vx = 0;
        b.vy = 0;
        b.en.chargeDmg = 0;
      }
    }
    for (const o of s.obstacles) {
      if (o.dead) continue;
      const bumper = o.kind === 'bumper';
      const gear = o.kind === 'gear';
      const e = bumper ? s.stats.bumperBounce : gear ? GEAR_BOUNCE : OBSTACLE_RESTITUTION;
      const hit = collideStatic(b, o, e, bumper ? BUMPER_MIN_KICK : gear ? GEAR_MIN_KICK : 0);
      if (hit >= 0 && gear) gearSpin(s, b, o, fx);
      else if (hit >= 0 && b.ball) hitObstacle(s, o, fx);
      // Obstacles are cover: a charger that hits a crate/bumper/chest loses its charge (shrines are not cover).
      if (hit >= 0 && b.en && o.kind !== 'shrine' && (b.en.chargeDmg ?? 0) > 0) {
        b.en.chargeDmg = 0;
        fx.push({ t: 'blocked', x: (b.x + o.x) / 2, y: (b.y + o.y) / 2 });
      }
    }
  }
  writeBack(list);
  if (railSplit) spawnSplit(s, railSplit, fx);

  // Jump cue: the hero lands once it no longer overlaps the enemy it jumped (or that enemy died).
  for (const b of list) {
    const jb = b.ball;
    if (!jb || jb.kind !== 'main' || !((jb.jumpOver ?? 0) > 0)) continue;
    const e = s.targets.find((t) => t.id === jb.jumpOver);
    if (!e || e.dead || Math.hypot(e.x - jb.x, e.y - jb.y) >= e.r + jb.r) {
      jb.lastJumped = jb.jumpOver;
      jb.jumpOver = 0;
      jb.jumpLanded = true;
      // Stomp (jump fork): the landing staggers the jumped enemy.
      if (e && !e.dead && mod(s, 'jump.stomp')) addStagger(e, STOMP_STAGGER, fx, s);
    }
  }

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
    // Ice patch: (almost) frictionless, the body slides on through; a trace of drag keeps phases finite.
    const ice = s.hazards.length > 0 && onIce(s, b.x, b.y) ? ICE_PATCH_FRICTION : 1;
    const fr = (enemy ? st.friction * ENEMY_FRICTION_MULT : st.friction) * ice;
    const rd = (enemy ? st.rollDecel * ENEMY_FRICTION_MULT : st.rollDecel) * ice;
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
