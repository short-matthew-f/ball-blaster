// Damage both ways: enemy hits (stagger, shield, HP, death, splits, blasts), hero damage (armor), and the shared
// diminishing heal curve.
import { CURVE_CAP, TABLE, type Ball, type BallKind, type FxEvent, type RunState, type Target, type TargetKind, type Vec } from '../core/types';
import {
  BLAST_ENEMY_DMG,
  GHOST_SECONDS,
  CASCADE_R,
  SHATTER_DMG,
  SHATTER_R,
  SHATTER_SPEED,
  BLAST_ENEMY_R,
  BLAST_HERO_DMG,
  BLAST_HERO_R,
  ELITE_CASH_MULT,
  OVERTIME_CASH_MULT,
  OVERTIME_CASH_WAVES,
  SHATTER_MULT,
  BLAST_DEATH_HERO_DMG,
  TARGET_DEFS,
  WAVES_PER_STAGE,
  stageById,
} from '../core/tuning';
import { makeEnemy } from './spawn';

export type DamageSource = BallKind | 'lightning' | 'explosion' | 'bump';

function isBallSource(src: DamageSource): src is BallKind {
  return src === 'main' || src === 'split' || src === 'spat';
}

export function hero(s: RunState): Ball {
  const b = s.balls.find((x) => x.kind === 'main');
  if (!b) throw new Error('sim: hero missing');
  return b;
}

export function isOvertime(s: RunState): boolean {
  return s.wave > WAVES_PER_STAGE + 1;
}

/** Overtime cash multiplier: OVERTIME_CASH_MULT for the first OVERTIME_CASH_WAVES Overtime waves, then 1. */
export function overtimeCashMult(s: RunState): number {
  const k = s.wave - (WAVES_PER_STAGE + 1);
  return k >= 1 && k <= OVERTIME_CASH_WAVES ? OVERTIME_CASH_MULT : 1;
}

/**
 * A contact hit on an enemy (any ball, bump, lightning, blast): +stagger, counts in the chain, then damage.
 * Frozen enemies ignore soft hits; an impact >= SHATTER_SPEED (or any blast) shatters them (thaw + SHATTER_MULT x
 * damage); lightning thaws.
 */
export function hitEnemy(s: RunState, t: Target, dmg: number, src: DamageSource, fx: FxEvent[], killer?: Ball, stagger = 1, speed = 0): void {
  if (t.dead) return;
  if ((t.frozen ?? 0) > 0) {
    if (src === 'explosion' || speed >= SHATTER_SPEED) {
      addStagger(t, stagger, fx);
      countHit(s, src);
      shatter(s, t, dmg, src, fx, killer);
    } else if (src === 'lightning') {
      t.frozen = 0;
      t.flash = 0.12;
      fx.push({ t: 'thaw', x: t.x, y: t.y });
    } else {
      t.flash = 0.12;
      if (isBallSource(src)) fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg: 0, killed: false });
    }
    return;
  }
  addStagger(t, stagger, fx);
  countHit(s, src);
  applyDamage(s, t, dmg, src, fx, killer);
}

/** Add stagger; emits { t: 'stagger' } when the enemy crosses its threshold. */
export function addStagger(t: Target, n: number, fx: FxEvent[]): void {
  const at = TARGET_DEFS[t.kind].staggerAt;
  const before = t.stagger;
  t.stagger += n;
  if (before < at && t.stagger >= at) fx.push({ t: 'stagger', x: t.x, y: t.y });
}

function countHit(s: RunState, src: DamageSource): void {
  if (s.phase !== 'resolve') return;
  s.combo.hits++;
  if (src === 'bump') s.combo.bumps = (s.combo.bumps ?? 0) + 1;
  else if (isBallSource(src)) s.combo.direct = (s.combo.direct ?? 0) + 1;
}

/** A frozen enemy breaks: it thaws and takes SHATTER_MULT x the hit's damage (not an instant kill), then SHATTER_DMG to neighbours. */
export function shatter(s: RunState, t: Target, dmg: number, src: DamageSource, fx: FxEvent[], killer?: Ball): void {
  if (t.dead) return;
  fx.push({ t: 'shatter', x: t.x, y: t.y, r: SHATTER_R });
  t.frozen = 0;
  applyDamage(s, t, SHATTER_MULT * dmg, src, fx, killer);
  for (const o of s.targets.slice()) {
    if (o.dead || o === t) continue;
    if (Math.hypot(o.x - t.x, o.y - t.y) <= SHATTER_R + t.r + o.r) hitEnemy(s, o, SHATTER_DMG, 'explosion', fx);
  }
}

/** Boss cadre shield: the boss takes no damage while any cadre lives. */
export function updateBossShield(s: RunState): void {
  const boss = s.targets.find((t) => t.kind === 'boss' && !t.dead);
  if (boss) boss.shielded = s.targets.some((t) => t.kind === 'cadre' && !t.dead);
}

/** Every point of enemy damage goes through here: shield -> hp -> boss phase -> death. */
export function applyDamage(s: RunState, t: Target, dmg: number, src: DamageSource, fx: FxEvent[], killer?: Ball): void {
  if (t.dead) return;
  if (t.kind === 'boss' && t.shielded) dmg = 0;
  if ((t.shield ?? 0) > 0 && dmg > 0) {
    t.shield = 0;
    t.flash = 0.12;
    fx.push({ t: 'shieldBreak', x: t.x, y: t.y });
    if (isBallSource(src)) fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg: 0, killed: false });
    return;
  }
  t.hp -= dmg;
  t.flash = 0.12;
  const killed = t.hp <= 0;
  if (isBallSource(src)) fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg, killed });
  if (t.kind === 'boss' && !killed) checkBossPhase(s, t, fx);
  if (killed) kill(s, t, src, fx, killer);
}

export function checkBossPhase(s: RunState, b: Target, fx: FxEvent[]): void {
  const phases = stageById(s.stage).boss.phases;
  const frac = b.hp / b.maxHp;
  while (b.phase < phases.length && frac <= phases[b.phase]) {
    b.phase++;
    b.charged = false;
    fx.push({ t: 'bossPhase', phase: b.phase });
  }
}

/** Death with rewards. `quiet` (bomber detonating itself) skips cash and kill credit. */
export function kill(s: RunState, t: Target, src: DamageSource, fx: FxEvent[], killer?: Ball, quiet = false): void {
  if (t.dead) return;
  t.dead = true;
  t.hp = 0;
  t.chargeDmg = 0;
  if (s.phase === 'resolve' && !quiet && !t.resting) {
    t.ghost = GHOST_SECONDS; // keeps its momentum: the cascade survives the kill
  } else {
    t.vx = 0;
    t.vy = 0;
  }
  const def = TARGET_DEFS[t.kind];
  if (!quiet) {
    const st = stageById(s.stage);
    const mult = (t.elite ? ELITE_CASH_MULT : 1) * overtimeCashMult(s);
    const cash = Math.round(def.cash * st.cashScale * s.stats.cashMult * mult);
    s.cash += cash;
    s.combo.cash = (s.combo.cash ?? 0) + cash;
    fx.push({ t: 'kill', x: t.x, y: t.y, targetKind: t.kind, cash });
    if (src === 'main' && killer && killer.banked && s.phase === 'resolve') s.combo.bankCash = (s.combo.bankCash ?? 0) + cash;
    if (s.stats.healOnKill > 0) heal(s, s.stats.healOnKill, t.x, t.y, fx);
    // Cascade: a kill caused by an enemy bumping another staggers everything within CASCADE_R.
    if (src === 'bump' && s.stats.comboCascade > 0) {
      const hh = hero(s);
      fx.push({ t: 'combo', name: 'CASCADE', mult: 1, x: hh.x, y: hh.y });
      for (const o of s.targets) if (!o.dead && o !== t && Math.hypot(o.x - t.x, o.y - t.y) <= CASCADE_R + o.r) addStagger(o, 1, fx);
    }
    if (t.kind === 'boss') {
      s.bossKilled = true;
      s.wavePending = true; // Overtime starts next enemy phase
      fx.push({ t: 'bossDead', x: t.x, y: t.y });
    } else {
      s.kills++;
      if (s.phase === 'resolve') {
        s.combo.kills++;
        if (src === 'main' && killer && killer.banked) s.combo.bankKills++;
        if (src === 'lightning' || src === 'explosion' || src === 'bump') s.combo.chainKills++;
      }
    }
    if (s.stats.strayEmeraldChance > 0 && s.rng.chance(s.stats.strayEmeraldChance)) {
      s.emeralds += 1;
      fx.push({ t: 'emerald', x: t.x, y: t.y, amount: 1 });
    }
  }
  if (!t.summon && t.kind !== 'boss' && (s.waveKillShot ?? -1) < 0) s.waveKillShot = s.shots;
  if (t.kind === 'cadre') updateBossShield(s);
  if (def.splitsInto) {
    const { kind, count } = def.splitsInto;
    const cr = TARGET_DEFS[kind].r;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + s.rng.range(0, Math.PI);
      const d = t.r * 0.6 + cr;
      const g = makeEnemy(s, kind, clampX(t.x + Math.cos(a) * d, cr), clampY(t.y + Math.sin(a) * d, cr));
      g.summon = true;
      g.resting = false;
      s.targets.push(g);
    }
  }
  // Detonate (quiet) hits the hero for BLAST_HERO_DMG; a bomber killed by a hit only for BLAST_DEATH_HERO_DMG.
  if (def.explodes) blast(s, t.x, t.y, t.kind, fx, quiet ? BLAST_HERO_DMG : BLAST_DEATH_HERO_DMG);
}

/** Bomber blast: `heroDmg` to the hero within BLAST_HERO_R of its body, BLAST_ENEMY_DMG to enemies within BLAST_ENEMY_R. */
export function blast(s: RunState, x: number, y: number, src: TargetKind, fx: FxEvent[], heroDmg = BLAST_HERO_DMG): void {
  fx.push({ t: 'explode', x, y, r: BLAST_ENEMY_R });
  const h = hero(s);
  if (Math.hypot(h.x - x, h.y - y) <= BLAST_HERO_R + h.r) heroDamage(s, heroDmg, src, h.x, h.y, fx, 'blast');
  for (const o of s.targets.slice()) {
    if (o.dead) continue;
    if (Math.hypot(o.x - x, o.y - y) <= BLAST_ENEMY_R + o.r) hitEnemy(s, o, BLAST_ENEMY_DMG, 'explosion', fx);
  }
}

/** Damage to the hero: attack - armor, minimum 1. Death is checked after the enemy phase. */
export function heroDamage(s: RunState, n: number, src: TargetKind, x: number, y: number, fx: FxEvent[], how: 'charge' | 'shot' | 'blast' | 'thorns'): number {
  if (n <= 0) return 0;
  const dmg = Math.max(1, Math.round(n) - s.stats.armor);
  s.hp = Math.max(0, s.hp - dmg);
  fx.push({ t: 'heroHit', x, y, dmg, src, how });
  return dmg;
}

/**
 * The ONLY way the hero heals. Every source (wave clear, shrine, kill heals, boss heal) draws from one per-run
 * diminishing curve (total <= CURVE_CAP * maxHp) so stacked sources cannot make a run infinite. Returns HP granted.
 */
export function heal(s: RunState, base: number, x = 0, y = 0, fx?: FxEvent[]): number {
  if (base <= 0) return 0;
  const cap = CURVE_CAP * s.maxHp;
  const mult = cap > 0 ? Math.max(0, 1 - s.healed / cap) : 0;
  const granted = base * mult;
  if (granted <= 0) return 0;
  s.healed += granted;
  const before = s.hp;
  s.hp = Math.min(s.maxHp, s.hp + granted);
  if (fx && s.hp > before) fx.push({ t: 'heroHeal', x, y, amount: s.hp - before });
  return granted;
}

/** Chain lightning from a struck enemy to the nearest other live enemies. */
export function chainLightning(s: RunState, from: Target, fx: FxEvent[]): void {
  const { lightningChance, lightningArcs, lightningRange, lightningDamage } = s.stats;
  if (lightningChance <= 0 || lightningArcs <= 0 || lightningRange <= 0) return;
  if (!s.rng.chance(lightningChance)) return;
  const cands = s.targets
    .filter((o) => !o.dead && o !== from)
    .map((o) => ({ o, d: Math.hypot(o.x - from.x, o.y - from.y) }))
    .filter((c) => c.d <= lightningRange + c.o.r)
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .slice(0, lightningArcs);
  if (cands.length === 0) return;
  const points: Vec[] = [{ x: from.x, y: from.y }];
  for (const c of cands) points.push({ x: c.o.x, y: c.o.y });
  fx.push({ t: 'lightning', points });
  for (const c of cands) hitEnemy(s, c.o, lightningDamage, 'lightning', fx);
}

function clampX(x: number, r: number): number {
  return Math.max(TABLE.x + r, Math.min(TABLE.x + TABLE.w - r, x));
}
function clampY(y: number, r: number): number {
  return Math.max(TABLE.y + r, Math.min(TABLE.y + TABLE.h - r, y));
}
