// Enemy phase: unstaggered enemies execute their visible intents. Melee intents are rolls (launches with the same
// physics as the hero), in array order LAUNCH_GAP apart; the phase ends when every body has stopped (stall guard).
import { LAUNCH_GAP, MAX_ENEMY_SECONDS, TABLE, type Ball, type FxEvent, type RunState, type Target } from '../core/types';
import {
  ADVANCE_DIST,
  ADVANCE_STANDOFF,
  FREEZE_CAP,
  FREEZE_PHASES,
  FROST_RANGE,
  ENEMY_FRICTION_MULT,
  stageById,
  CLERIC_RANGE,
  RANGED_PHASE_CAP,
  DARK_REVEAL_R,
  ENRAGE_BASE,
  ENRAGE_OVERTIME_TURN,
  ENRAGE_PER_WAVE,
  ENRAGE_STRIKE_LEVEL,
  HIVE_GRUB_CAP,
  SUMMON_CAP,
  SWIFT_ADVANCE_DIST,
  TARGET_DEFS,
  WAVE_CASH,
  WAVE_CASH_CAP_WAVE,
  WAVES_PER_STAGE,
  CHILL_ADVANCE_MULT,
  CHILL_CHARGE_MULT,
  MIRROR_CHANCE,
  MIRROR_DMG,
  POISON_NO_DECAY_LV,
  gearVal,
} from '../core/tuning';
import { applyDamage, heal, hero, heroDamage, kill, scaleCash, stageWaves } from './damage';
import { has, lv } from './gear';
import { rollIntent } from './intents';
import { relaxAll } from './physics';
import { liveRegulars, spawnWave, summonNear } from './spawn';

/** Turn of the current wave at which enrage starts (stage waves: ENRAGE_BASE + ENRAGE_PER_WAVE x wave; Overtime: flat). */
export function rageStart(s: RunState): number {
  // Early Boss stages keep the normal boss-wave clock (the boss wave counts as wave 4).
  const nw = stageWaves(s);
  if (s.wave > nw + 1) return ENRAGE_OVERTIME_TURN;
  const w = s.wave === nw + 1 ? WAVES_PER_STAGE + 1 : s.wave;
  return ENRAGE_BASE + ENRAGE_PER_WAVE * w;
}

/** Enrage level for the current (or next, during aim) enemy phase: +1 attack per turn from rageStart. */
export function rageLevel(s: RunState): number {
  return Math.max(0, s.waveTurn + 1 - rageStart(s) + 1);
}

export function staggered(t: Target): boolean {
  return t.stagger >= TARGET_DEFS[t.kind].staggerAt;
}

export function startEnemyPhase(s: RunState, fx: FxEvent[]): void {
  s.phase = 'enemy';
  s.resolveTime = 0;
  s.lastHit = {};
  s.touching = {};
  s.acted = [];
  s.rangedTaken = 0;
  for (const t of s.targets) t.chargeDmg = 0;
  // Freezes tick down first, so a freeze set this phase lasts FREEZE_PHASES full phases.
  for (const t of s.targets) {
    if (t.dead || !((t.frozen ?? 0) > 0)) continue;
    t.frozen = (t.frozen ?? 0) - 1;
    if (t.frozen <= 0) fx.push({ t: 'thaw', x: t.x, y: t.y });
  }
  // Poison ticks before the wave check, so a tick that kills the last regular brings the next wave.
  poisonTick(s, fx);

  const fresh = advanceWave(s, fx);
  const rage = rageLevel(s);
  if (rage > 0) fx.push({ t: 'enrage', level: rage });
  // Reflex: the first enemy phase of each wave is skipped. Time Stop (trick): this whole phase is skipped.
  const reflex = s.stats.reflex > 0 && s.waveTurn === 0 && fresh.size === 0;
  const stopped = s.skipNextEnemyPhase;
  s.skipNextEnemyPhase = false;
  s.enemyQueue = reflex || stopped ? [] : s.targets.filter((t) => !t.dead && !fresh.has(t.id)).map((t) => t.id);
  s.enemyNext = s.t;
}

/**
 * Poison relic: each poisoned enemy takes damage equal to its stacks (no stagger, ignores 1-hit shields, kills pay but
 * never count for the chain), then loses a stack (no decay from level POISON_NO_DECAY_LV).
 */
function poisonTick(s: RunState, fx: FxEvent[]): void {
  const decay = lv(s, 'poison') < POISON_NO_DECAY_LV;
  for (const t of s.targets.slice()) {
    const n = t.poison ?? 0;
    if (t.dead || n <= 0) continue;
    fx.push({ t: 'poisonTick', x: t.x, y: t.y, dmg: n });
    applyDamage(s, t, n, 'poison', fx);
    if (t.dead) continue;
    if (decay) t.poison = n - 1;
    if ((t.poison ?? 0) <= 0) fx.push({ t: 'status', id: t.id, kind: 'poison', on: false });
  }
}

/** Charge reach (edge gap, px) of `t` this enemy phase: the kind's reach, x CHILL_CHARGE_MULT while chilled. */
export function effectiveReach(t: Target): number {
  const r = TARGET_DEFS[t.kind].reach;
  return (t.chill ?? 0) > 0 ? r * CHILL_CHARGE_MULT : r;
}

/** Wave clear: no live regular (non-summon) enemy left, or the boss died (Overtime begins). Returns new ids. */
function advanceWave(s: RunState, fx: FxEvent[]): Set<number> {
  const fresh = new Set<number>();
  if (!s.wavePending && liveRegulars(s) > 0) return fresh;
  const cleared = s.wave;
  if (cleared >= 1) {
    s.cash += scaleCash(s, WAVE_CASH * Math.min(cleared, WAVE_CASH_CAP_WAVE));
    const h = hero(s);
    fx.push({ t: 'boardClear', x: h.x, y: h.y });
    heal(s, s.stats.waveHeal, h.x, h.y, fx);
    // Sweep: every regular of the wave died within one shot (the one just played).
    if (s.stats.comboSweep > 0 && s.waveKillShot === s.shots && s.shots > 0) {
      s.cash += scaleCash(s, s.stats.comboSweep * s.stats.cashMult);
      fx.push({ t: 'combo', name: 'SWEEP', mult: 1, x: h.x, y: h.y });
    }
  }
  s.wave++;
  s.wavePending = false;
  for (const e of spawnWave(s, fx)) fresh.add(e.id);
  s.waveTurn = -1; // the arrival phase is not a turn of the new wave (enrage clock)
  return fresh;
}

/** One enemy-phase substep. Returns true when the phase has finished (intents rerolled, stagger cleared). */
export function enemyStep(s: RunState, h: number, fx: FxEvent[], physics: (s: RunState, h: number, fx: FxEvent[]) => void): boolean {
  s.resolveTime += h;
  while (s.enemyQueue.length > 0 && s.t + 1e-9 >= s.enemyNext) {
    const id = s.enemyQueue.shift()!;
    const e = s.targets.find((t) => t.id === id);
    if (!e || e.dead) continue;
    // Staggered (or frozen): skip; the intent is kept, not rerolled.
    if (staggered(e) || (e.frozen ?? 0) > 0) continue;
    s.acted.push(e.id);
    if (execute(s, e, fx)) {
      s.enemyNext = s.t + LAUNCH_GAP;
      break;
    }
  }

  physics(s, h, fx);

  // A charge that stops without connecting deals nothing.
  for (const t of s.targets) if (t.resting && (t.chargeDmg ?? 0) > 0) t.chargeDmg = 0;

  if (s.resolveTime >= MAX_ENEMY_SECONDS) {
    s.enemyQueue = [];
    for (const b of s.balls) ((b.vx = 0), (b.vy = 0), (b.resting = true));
    for (const t of s.targets) ((t.vx = 0), (t.vy = 0), (t.resting = true), (t.chargeDmg = 0));
  }
  if (s.enemyQueue.length > 0) return false;
  if (!s.balls.every((b) => b.resting) || !s.targets.every((t) => t.dead || t.resting)) return false;
  // The last regular died during the enemy phase (bump, detonation): the next wave arrives now (it acts next phase).
  if (s.wavePending || liveRegulars(s) === 0) {
    s.targets = s.targets.filter((t) => !t.dead);
    advanceWave(s, fx);
    return false;
  }
  // Hold the phase until every arrival (wave, boss, summons, splits) is solid: aim never sees a shimmering enemy.
  if (s.targets.some((t) => !t.dead && t.shimmer > 0)) return false;
  endEnemyPhase(s, fx);
  return true;
}

/** Reroll intents for enemies that acted, clear stagger, tick chill, advance the enrage clock. */
function endEnemyPhase(s: RunState, fx: FxEvent[]): void {
  s.targets = s.targets.filter((t) => !t.dead);
  const acted = new Set(s.acted);
  for (const t of s.targets) {
    if (acted.has(t.id)) rollIntent(s, t);
    t.stagger = 0;
    // Chill wears off at the end of a phase, so a chill set during the shot covers the phase that follows it.
    if ((t.chill ?? 0) > 0) {
      t.chill = (t.chill ?? 0) - 1;
      if (t.chill <= 0) fx.push({ t: 'status', id: t.id, kind: 'chill', on: false });
    }
  }
  s.waveTurn++;
  relaxAll(s);
}

function launch(e: Target, dx: number, dy: number, speed: number, fx: FxEvent[], as: 'attack' | 'advance'): void {
  const d = Math.hypot(dx, dy);
  const ux = d > 1e-9 ? dx / d : 0;
  const uy = d > 1e-9 ? dy / d : 1;
  e.vx = ux * speed;
  e.vy = uy * speed;
  e.resting = false;
  fx.push({ t: 'launch', id: e.id, x: e.x, y: e.y, intent: as });
}

/** Distance from point (px,py) to segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const L2 = vx * vx + vy * vy;
  const k = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
  return Math.hypot(px - (ax + vx * k), py - (ay + vy * k));
}

/** Is the straight roll of `e` from a to b blocked by another enemy or an obstacle (cover; shrines are not cover)? */
function blocked(s: RunState, e: Target, ax: number, ay: number, bx: number, by: number): boolean {
  for (const o of s.targets) {
    if (o === e || o.dead) continue;
    if (segDist(o.x, o.y, ax, ay, bx, by) < e.r + o.r - 1) return true;
  }
  for (const o of s.obstacles) {
    if (o.dead || o.kind === 'shrine') continue;
    if (segDist(o.x, o.y, ax, ay, bx, by) < e.r + o.r - 1) return true;
  }
  return false;
}

/** Direction to charge at the hero; bankers try a one-rail bank when the direct line is covered. */
function chargeDir(s: RunState, e: Target, h: Ball, bank: boolean): { x: number; y: number } {
  const direct = { x: h.x - e.x, y: h.y - e.y };
  if (!bank || !blocked(s, e, e.x, e.y, h.x, h.y)) return direct;
  const xl = TABLE.x + e.r;
  const xr = TABLE.x + TABLE.w - e.r;
  const yt = TABLE.y + e.r;
  const yb = TABLE.y + TABLE.h - e.r;
  const mirrors = [
    { mx: 2 * xl - h.x, my: h.y, axis: 'x' as const, w: xl },
    { mx: 2 * xr - h.x, my: h.y, axis: 'x' as const, w: xr },
    { mx: h.x, my: 2 * yt - h.y, axis: 'y' as const, w: yt },
    { mx: h.x, my: 2 * yb - h.y, axis: 'y' as const, w: yb },
  ];
  let best: { x: number; y: number } | null = null;
  let bestL = Infinity;
  for (const m of mirrors) {
    const dx = m.mx - e.x;
    const dy = m.my - e.y;
    const k = m.axis === 'x' ? (Math.abs(dx) > 1e-9 ? (m.w - e.x) / dx : -1) : Math.abs(dy) > 1e-9 ? (m.w - e.y) / dy : -1;
    if (k <= 0 || k >= 1) continue;
    const px = e.x + dx * k;
    const py = e.y + dy * k;
    if (blocked(s, e, e.x, e.y, px, py) || blocked(s, e, px, py, h.x, h.y)) continue;
    const L = Math.hypot(dx, dy);
    if (L < bestL) {
      bestL = L;
      best = { x: dx, y: dy };
    }
  }
  return best ?? direct;
}

/** Distance (px) a body launched at v0 rolls under enemy friction before it stops (closed form, no collisions). */
export function rollDistance(s: RunState, v0: number): number {
  const st = stageById(s.stage);
  const a = st.friction * ENEMY_FRICTION_MULT;
  const b = st.rollDecel * ENEMY_FRICTION_MULT;
  return v0 / a - (b / (a * a)) * Math.log(1 + (a * v0) / b);
}

/** Launch speed that rolls `dist` px (bisection on rollDistance). */
function speedFor(s: RunState, dist: number, vmax: number): number {
  let lo = 0;
  let hi = vmax;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(s, mid) < dist) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Advance: a soft roll toward the hero (skirmisher: sideways reposition). It stops ADVANCE_STANDOFF short of the
 * hero instead of shoving it (an advance is not an attack), so the roll is shortened when the hero is close.
 */
function advance(s: RunState, e: Target, h: Ball, fx: FxEvent[], sideways = e.kind === 'skirmisher'): boolean {
  let dx = h.x - e.x;
  let dy = h.y - e.y;
  let dist = (e.elite === 'swift' ? SWIFT_ADVANCE_DIST : ADVANCE_DIST) * stageById(s.stage).advanceMult;
  if ((e.chill ?? 0) > 0) dist *= CHILL_ADVANCE_MULT;
  if (sideways) {
    const px = -dy;
    const py = dx;
    const towardCentre = TABLE.x + TABLE.w / 2 - e.x;
    const sign = px * towardCentre >= 0 ? 1 : -1;
    dx = px * sign;
    dy = py * sign;
  } else {
    const gap = Math.hypot(dx, dy) - e.r - h.r;
    dist = Math.min(dist, gap - ADVANCE_STANDOFF);
  }
  if (dist < 2) return false;
  launch(e, dx, dy, speedFor(s, dist, 1000), fx, 'advance');
  return true;
}

/** Frost: freeze the nearest live ally within FROST_RANGE (not a frost, boss or cadre), up to FREEZE_CAP frozen. */
function freezeAlly(s: RunState, e: Target, fx: FxEvent[]): void {
  const frozen = s.targets.filter((t) => !t.dead && (t.frozen ?? 0) > 0).length;
  if (frozen >= FREEZE_CAP) return;
  let best: Target | undefined;
  let bestD = Infinity;
  for (const o of s.targets) {
    if (o === e || o.dead || (o.frozen ?? 0) > 0 || o.kind === 'frost' || o.kind === 'boss' || o.kind === 'cadre') continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y) - o.r - e.r;
    if (d <= FROST_RANGE && (d < bestD || (d === bestD && best && o.id < best.id))) ((best = o), (bestD = d));
  }
  if (!best) return;
  best.frozen = FREEZE_PHASES;
  best.vx = 0;
  best.vy = 0;
  best.resting = true;
  best.chargeDmg = 0;
  e.aimId = best.id;
  fx.push({ t: 'freeze', x: best.x, y: best.y });
}

/**
 * Dark modifier: is `t`'s intent visible to the player? Always true off Dark; on Dark only within
 * max(reach, DARK_REVEAL_R) px (edge gap) of the hero. Render-only (the sim never reads it).
 */
export function intentVisible(s: RunState, t: Target): boolean {
  if (!s.dark || s.lanternOn) return true;
  const h = s.balls.find((b) => b.kind === 'main');
  if (!h) return true;
  const gap = Math.hypot(h.x - t.x, h.y - t.y) - h.r - t.r;
  return gap <= Math.max(TARGET_DEFS[t.kind].reach, DARK_REVEAL_R);
}

/**
 * Execute `e`'s intent. Returns true if it launched (the next launch waits LAUNCH_GAP). A boss with the 'moves' trait
 * also repositions after an intent that did not launch (summon, charge, rest): toward the hero, or sideways when close.
 */
function execute(s: RunState, e: Target, fx: FxEvent[]): boolean {
  const launched = executeIntent(s, e, fx);
  if (launched || e.dead || e.kind !== 'boss' || !stageById(s.stage).bossTraits.includes('moves')) return launched;
  const h = hero(s);
  return advance(s, e, h, fx) || advance(s, e, h, fx, true);
}

function executeIntent(s: RunState, e: Target, fx: FxEvent[]): boolean {
  const def = TARGET_DEFS[e.kind];
  const h = hero(s);
  const rage = rageLevel(s);
  const it = e.intent;
  switch (it.t) {
    case 'attack': {
      const slam = e.kind === 'boss' && !!e.charged;
      const gap = Math.hypot(h.x - e.x, h.y - e.y) - e.r - h.r;
      // Reach-aware: Attack beyond reach = Advance. Enraged, it charges from anywhere (banking round cover): an attacker
      // parked behind a bumper otherwise never connects and the run never ends.
      const far = gap > effectiveReach(e);
      if (!slam && far && rage === 0) return advance(s, e, h, fx);
      // Deep enrage with the line covered (e.g. caged behind bumpers): the blow lands anyway, as an instant strike.
      if (rage >= ENRAGE_STRIKE_LEVEL && blocked(s, e, e.x, e.y, h.x, h.y)) {
        fx.push({ t: 'tracer', x0: e.x, y0: e.y, x1: h.x, y1: h.y });
        heroDamage(s, (it.n ?? 0) + rage, e.kind, h.x, h.y, fx, 'charge');
        e.charged = false;
        return false;
      }
      const speed = (e.charged ? (def.chargedSpeed ?? def.chargeSpeed * 1.25) : def.chargeSpeed) * ((e.chill ?? 0) > 0 ? CHILL_CHARGE_MULT : 1);
      const d = chargeDir(s, e, h, e.kind === 'bouncer' || slam || far);
      launch(e, d.x, d.y, speed, fx, 'attack');
      e.chargeDmg = (it.n ?? 0) + rage;
      e.charged = false;
      return true;
    }
    case 'advance':
      return advance(s, e, h, fx);
    case 'shoot': {
      fx.push({ t: 'tracer', x0: e.x, y0: e.y, x1: h.x, y1: h.y });
      // Mirror relic: the shot is reflected (rng drawn only when equipped, so other runs keep their streams).
      if (has(s, 'mirror') && s.rng.chance(gearVal(MIRROR_CHANCE, lv(s, 'mirror')))) {
        fx.push({ t: 'mirror', x: e.x, y: e.y });
        applyDamage(s, e, MIRROR_DMG, 'mirror', fx);
        return false;
      }
      // Thick Skin: flat reduction on ranged damage (min 1), then armor. Unblockable, so capped per enemy phase at
      // RANGED_PHASE_CAP x max HP (the excess is dropped); charges stay uncapped (they can be dodged or blocked).
      const dmg = Math.max(1, Math.round(Math.max(1, (it.n ?? 1) + rage - s.stats.rangedResist)) - s.stats.armor);
      const give = Math.min(dmg, Math.floor(RANGED_PHASE_CAP * s.maxHp) - (s.rangedTaken ?? 0));
      if (give > 0) {
        s.rangedTaken = (s.rangedTaken ?? 0) + give;
        heroDamage(s, give + s.stats.armor, e.kind, h.x, h.y, fx, 'shot');
      }
      return false;
    }
    case 'charge':
      e.charged = true;
      return false;
    case 'guard': {
      if (e.kind === 'frost') {
        freezeAlly(s, e, fx);
      } else if (e.kind === 'cleric') {
        let best: Target | undefined;
        let bestD = Infinity;
        for (const o of s.targets) {
          // The boss is never shielded by a cleric (a shield eats a whole hit: boss waves dragged on).
          if (o === e || o.dead || o.kind === 'boss' || (o.shield ?? 0) > 0) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y) - o.r - e.r;
          if (d <= CLERIC_RANGE && d < bestD) ((best = o), (bestD = d));
        }
        if (best) {
          best.shield = 1;
          e.aimId = best.id;
          fx.push({ t: 'shieldUp', x: best.x, y: best.y });
        }
      } else {
        e.shield = 1;
        fx.push({ t: 'shieldUp', x: e.x, y: e.y });
      }
      return false;
    }
    case 'detonate':
      kill(s, e, 'explosion', fx, undefined, true);
      return false;
    case 'summon': {
      const grubs = s.targets.filter((t) => !t.dead && t.summon).length;
      const cap = e.kind === 'hive' ? HIVE_GRUB_CAP : SUMMON_CAP;
      if (grubs < cap) summonNear(s, e, 'grub', fx);
      return false;
    }
    case 'rest':
      return false;
  }
}
