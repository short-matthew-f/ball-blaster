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
  SHATTER_MULT,
  BLAST_DEATH_HERO_DMG,
  FOLLOW_CHARGE_EXTRA,
  POISON_MAX,
  SHARD_LIFE,
  SHARD_SPEED,
  SHRAPNEL_COUNT,
  STATIC_DMG,
  TARGET_DEFS,
  TOKENS_FIRST_SLOT4,
  TOKENS_KILL,
  gearVal,
  stageById,
  LANTERN_DARK_CASH,
  POCKET_MULT,
  SNOWBALL_CASH,
  UNSTOPPABLE_AT,
  CHAIN_DMG,
  OVERLOAD_DMG,
  OVERLOAD_R,
  SLOW_MULT,
  TESLA_AT,
  TESLA_DMG,
  TESLA_R,
} from '../core/tuning';
import { makeEnemy } from './spawn';
import { mitosis } from './balls';
import { has, heroGap, lanternR, lv, mod } from './gear';

/** poison/static/mirror/thorns: relic damage that never staggers and never counts as a hit. */
export type DamageSource = BallKind | 'lightning' | 'explosion' | 'bump' | 'poison' | 'static' | 'mirror' | 'thorns';

function isBallSource(src: DamageSource): src is BallKind {
  return src === 'main' || src === 'split' || src === 'spat';
}

export function hero(s: RunState): Ball {
  const b = s.balls.find((x) => x.kind === 'main');
  if (!b) throw new Error('sim: hero missing');
  return b;
}

/** Regular waves before the boss on this stage (3; Early Boss: 2). The boss wave is stageWaves + 1. */
export function stageWaves(s: RunState): number {
  return stageById(s.stage).waves.length;
}

/** The Loot Goblin: never damaged, staggered, statused, killed or counted. */
export function isGoblin(t: Target): boolean {
  return t.kind === 'goblin';
}

/** Enemy attack value scaled for the stage (intents, blasts, thorns), at least 1 for a positive base. */
export function scaleAtk(s: RunState, n: number): number {
  return n > 0 ? Math.max(1, Math.round(n * stageById(s.stage).atkScale)) : n;
}

/** Flat cash (wave bonus, chests, crates, Sweep) scaled for the stage. */
export function scaleCash(s: RunState, n: number): number {
  return Math.round(n * stageById(s.stage).waveCashScale);
}

/**
 * A contact hit on an enemy (any ball, bump, lightning, blast): +stagger, counts in the chain, then damage.
 * Frozen enemies ignore soft hits; an impact >= SHATTER_SPEED (or any blast) shatters them (thaw + SHATTER_MULT x
 * damage); lightning thaws.
 */
export function hitEnemy(s: RunState, t: Target, dmg: number, src: DamageSource, fx: FxEvent[], killer?: Ball, stagger = 1, speed = 0): void {
  if (t.dead || isGoblin(t)) return;
  if ((t.frozen ?? 0) > 0) {
    if (src === 'explosion' || speed >= SHATTER_SPEED) {
      addStagger(t, stagger, fx, s);
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
  addStagger(t, stagger, fx, s);
  countHit(s, src);
  applyDamage(s, t, dmg, src, fx, killer);
}

/**
 * Add stagger; emits { t: 'stagger' } when the enemy crosses its threshold. With `s` and the Static relic equipped,
 * crossing the threshold also deals STATIC_DMG (via applyDamage: no further stagger, respects 1-hit shields).
 */
export function addStagger(t: Target, n: number, fx: FxEvent[], s?: RunState): void {
  if (isGoblin(t)) return;
  const at = TARGET_DEFS[t.kind].staggerAt;
  const before = t.stagger;
  t.stagger += n;
  if (before < at && t.stagger >= at) {
    fx.push({ t: 'stagger', x: t.x, y: t.y });
    if (s && has(s, 'static')) staticCrossing(s, t, fx);
  }
}

/** Nearest live enemy (not the goblin, not `t`) within `R` px (edge gap) of `t`; ties: lowest id. */
function nearestTo(s: RunState, t: Target, R: number): Target | undefined {
  let best: Target | undefined;
  let bestD = Infinity;
  for (const o of s.targets) {
    if (o.dead || o === t || isGoblin(o)) continue;
    const d = Math.hypot(o.x - t.x, o.y - t.y) - o.r - t.r;
    if (d <= R && (d < bestD || (d === bestD && best && o.id < best.id))) ((best = o), (bestD = d));
  }
  return best;
}

/**
 * v0.6 M3 Overload / Epicentre: `n` static damage (no stagger, no hit count, respects 1-hit shields) with a cosmetic
 * 'hit' fx (static damage is otherwise silent).
 */
export function staticZap(s: RunState, o: Target, n: number, fx: FxEvent[]): void {
  if (o.dead || isGoblin(o)) return;
  const hp = o.hp;
  applyDamage(s, o, n, 'static', fx);
  fx.push({ t: 'hit', x: o.x, y: o.y, targetKind: o.kind, ballKind: 'main', dmg: hp - Math.max(0, o.hp), killed: o.dead });
}

/**
 * Static relic: an enemy crossing its stagger threshold takes STATIC_DMG. v0.6 M3: Overload zaps the nearest other
 * enemy; Paralysis holds it one more phase (resolve only, never the boss); Tesla zaps on the shot's TESLA_AT-th crossing.
 */
function staticCrossing(s: RunState, t: Target, fx: FxEvent[]): void {
  if (!t.dead) applyDamage(s, t, gearVal(STATIC_DMG, lv(s, 'static')), 'static', fx);
  if (mod(s, 'static.overload')) {
    const o = nearestTo(s, t, OVERLOAD_R);
    if (o) staticZap(s, o, OVERLOAD_DMG, fx);
  }
  if (s.phase !== 'resolve') return;
  if (mod(s, 'static.paralysis') && !t.dead && t.kind !== 'boss') t.held = Math.max(t.held ?? 0, 1);
  if (mod(s, 'static.tesla')) {
    s.teslaHits = (s.teslaHits ?? 0) + 1;
    if (s.teslaHits === TESLA_AT) {
      const o = nearestTo(s, t, TESLA_R);
      if (o) {
        fx.push({ t: 'lightning', points: [{ x: t.x, y: t.y }, { x: o.x, y: o.y }] });
        hitEnemy(s, o, TESLA_DMG, 'lightning', fx);
      }
    }
  }
}

/** Poison relic: a ball contact adds 1 + level stacks (max POISON_MAX). */
export function addPoison(s: RunState, t: Target, fx: FxEvent[]): void {
  if (t.dead || isGoblin(t) || !has(s, 'poison')) return;
  const before = t.poison ?? 0;
  t.poison = Math.min(gearVal(POISON_MAX, lv(s, 'poison')), before + 1 + lv(s, 'poison'));
  if (before <= 0 && t.poison > 0) fx.push({ t: 'status', id: t.id, kind: 'poison', on: true });
}

/** Shrapnel relic: a kill by the hero ball releases shards (spat-like balls, SHARD_LIFE s, 1 damage). */
function spawnShards(s: RunState, t: Target, fx: FxEvent[]): void {
  if (isGoblin(t)) return;
  const n = gearVal(SHRAPNEL_COUNT, lv(s, 'shrapnel'));
  const r = 2;
  const a0 = s.rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    s.balls.push({
      id: s.nextId++,
      kind: 'spat',
      shard: true,
      x: clampX(t.x + Math.cos(a) * t.r * 0.5, r),
      y: clampY(t.y + Math.sin(a) * t.r * 0.5, r),
      vx: Math.cos(a) * SHARD_SPEED,
      vy: Math.sin(a) * SHARD_SPEED,
      r,
      mass: 0.4,
      life: SHARD_LIFE,
      resting: false,
      banked: false,
    });
  }
  fx.push({ t: 'shard', x: t.x, y: t.y });
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
  if (t.dead || isGoblin(t)) return;
  if (t.kind === 'boss' && t.shielded) dmg = 0;
  // Poison ignores 1-hit shields (the boss cadre shield still holds).
  if ((t.shield ?? 0) > 0 && dmg > 0 && src !== 'poison') {
    t.shield = 0;
    t.flash = 0.12;
    fx.push({ t: 'shieldBreak', x: t.x, y: t.y });
    // Unstoppable (momentum capstone): at UNSTOPPABLE_AT the hero breaks the shield and the hit still lands.
    const through = src === 'main' && mod(s, 'momentum.unstop') && s.momentum >= UNSTOPPABLE_AT;
    if (!through) {
      if (isBallSource(src)) fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg: 0, killed: false });
      return;
    }
  }
  t.hp -= dmg;
  t.flash = 0.12;
  const killed = t.hp <= 0;
  if (isBallSource(src)) fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg, killed });
  if (t.kind === 'boss' && !killed) checkBossPhase(s, t, fx);
  if (killed) kill(s, t, src, fx, killer);
}

export function checkBossPhase(s: RunState, b: Target, fx: FxEvent[]): void {
  const boss = stageById(s.stage).boss;
  const phases = boss.phases;
  const frac = b.hp / b.maxHp;
  while (b.phase < phases.length && frac <= phases[b.phase]) {
    b.phase++;
    b.charged = false;
    fx.push({ t: 'bossPhase', phase: b.phase });
    // The Mainspring's phase 2 entry (once): every conveyor on this run's board reverses.
    if (boss.kit === 'mainspring' && b.phase === 1) {
      for (const z of s.hazards) {
        if (z.kind !== 'conveyor') continue;
        z.dx = -(z.dx ?? 0) || 0;
        z.dy = -(z.dy ?? 0) || 0;
      }
      fx.push({ t: 'beltReverse' });
    }
  }
}

/** Death with rewards. `quiet` (bomber detonating itself) skips cash and kill credit. */
export function kill(s: RunState, t: Target, src: DamageSource, fx: FxEvent[], killer?: Ball, quiet = false): void {
  if (t.dead || isGoblin(t)) return;
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
    // Lantern: kill cash +10 %/level on dark stages; Beacon also lights kills within lanternR of the hero (Sunrise: all).
    const lit = s.dark || (mod(s, 'lantern.beacon') && heroGap(s, t) <= lanternR(s));
    const lantern = lit && s.lanternOn ? 1 + LANTERN_DARK_CASH * lv(s, 'lantern') : 1;
    // Snowball: +SNOWBALL_CASH per Momentum step. Pocket: this shot opened with a 2-rail bank.
    const snowball = mod(s, 'momentum.snowball') ? 1 + SNOWBALL_CASH * s.momentum : 1;
    const pocket = s.phase === 'resolve' && s.pocketShot === s.shots && mod(s, 'ricochet.pocket') ? POCKET_MULT : 1;
    const mult = (t.elite ? ELITE_CASH_MULT : 1) * lantern * snowball * pocket;
    const cash = Math.round((t.cashBase ?? def.cash) * st.cashScale * s.stats.cashMult * mult);
    s.cash += cash;
    s.combo.cash = (s.combo.cash ?? 0) + cash;
    fx.push({ t: 'kill', x: t.x, y: t.y, targetKind: t.kind, cash });
    if (src === 'main' && killer && killer.banked && s.phase === 'resolve') s.combo.bankCash = (s.combo.bankCash ?? 0) + cash;
    if (s.stats.healOnKill > 0) heal(s, s.stats.healOnKill, t.x, t.y, fx);
    // Cascade: a kill caused by an enemy bumping another staggers everything within CASCADE_R.
    if (src === 'bump' && s.stats.comboCascade > 0) {
      const hh = hero(s);
      fx.push({ t: 'combo', name: 'CASCADE', mult: 1, x: hh.x, y: hh.y });
      for (const o of s.targets) if (!o.dead && o !== t && Math.hypot(o.x - t.x, o.y - t.y) <= CASCADE_R + o.r) addStagger(o, 1, fx, s);
    }
    if (t.kind === 'boss') {
      // The boss's death ends the waves: no wave follows; the loot phase starts when this shot / enemy phase ends.
      s.bossKilled = true;
      fx.push({ t: 'bossDead', x: t.x, y: t.y });
      const tokens = stageById(s.stage).slot === 4 && s.bestWave < 4 ? TOKENS_FIRST_SLOT4 : TOKENS_KILL;
      s.tokens += tokens;
      fx.push({ t: 'token', x: t.x, y: t.y, amount: tokens });
    } else {
      s.kills++;
      if (s.phase === 'resolve') {
        s.combo.kills++;
        if (src === 'main' && killer && killer.banked) s.combo.bankKills++;
        if (src === 'lightning' || src === 'explosion' || src === 'bump') s.combo.chainKills++;
      }
    }
  }
  // Sweep counts kills within a shot; a poison tick at the start of the enemy phase is not part of the shot.
  if (!t.summon && t.kind !== 'boss' && (s.waveKillShot ?? -1) < 0 && src !== 'poison') s.waveKillShot = s.shots;
  if (!quiet && src === 'main' && s.phase === 'resolve' && has(s, 'shrapnel')) spawnShards(s, t, fx);
  if (t.kind === 'cadre') updateBossShield(s);
  if (!quiet && s.phase === 'resolve') {
    // Mitosis (split capstone): the shot's first kill by a child releases more children from it.
    if (src === 'split' && killer && mod(s, 'split.mitosis')) mitosis(s, killer, fx);
    // Storm (lightning capstone): a ball kill also arcs (its own roll).
    if (isBallSource(src) && mod(s, 'lightning.storm')) chainLightning(s, t, fx);
  }
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
  if (def.explodes) blast(s, t.x, t.y, t.kind, fx, scaleAtk(s, quiet ? BLAST_HERO_DMG : BLAST_DEATH_HERO_DMG));
}

/** Bomber blast: `heroDmg` to the hero within BLAST_HERO_R of its body, BLAST_ENEMY_DMG to enemies within BLAST_ENEMY_R. */
export function blast(s: RunState, x: number, y: number, src: TargetKind, fx: FxEvent[], heroDmg = scaleAtk(s, BLAST_HERO_DMG)): void {
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
  // Slow (time stop fork): hero damage halved (rounded up) while Slow lasts.
  if ((s.slowPhases ?? 0) > 0) n = Math.ceil(n * SLOW_MULT);
  // Follow cue trade: charges hit harder.
  if (how === 'charge' && s.stats.cue === 'follow') n += FOLLOW_CHARGE_EXTRA;
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

/** Live enemies (not the goblin, not in `skip`) within lightningRange of `from`, nearest first (ties: id). */
function arcCands(s: RunState, from: Target, skip: Set<Target>): Target[] {
  const range = s.stats.lightningRange;
  return s.targets
    .filter((o) => !o.dead && !skip.has(o) && !isGoblin(o))
    .map((o) => ({ o, d: Math.hypot(o.x - from.x, o.y - from.y) }))
    .filter((c) => c.d <= range + c.o.r)
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .map((c) => c.o);
}

/**
 * Chain lightning from a struck enemy to the nearest other live enemies. `sure` (Surge) skips the roll (even at chance
 * 0). Thunder: one arc at the hero's damage, stagger 2. Chain: each arc target hops once more to its nearest unvisited
 * enemy for CHAIN_DMG (no second roll).
 */
export function chainLightning(s: RunState, from: Target, fx: FxEvent[], sure = false): void {
  const { lightningChance, lightningRange, lightningDamage } = s.stats;
  const thunder = mod(s, 'lightning.thunder');
  const arcs = thunder ? Math.min(1, s.stats.lightningArcs) : s.stats.lightningArcs;
  if ((lightningChance <= 0 && !sure) || arcs <= 0 || lightningRange <= 0 || !has(s, 'lightning')) return;
  if (!sure && !s.rng.chance(lightningChance)) return;
  if (isGoblin(from)) return;
  const visited = new Set<Target>([from]);
  const cands = arcCands(s, from, visited).slice(0, arcs);
  if (cands.length === 0) return;
  const points: Vec[] = [{ x: from.x, y: from.y }];
  for (const c of cands) points.push({ x: c.x, y: c.y });
  fx.push({ t: 'lightning', points });
  for (const c of cands) visited.add(c);
  for (const c of cands) hitEnemy(s, c, thunder ? s.stats.damage : lightningDamage, 'lightning', fx, undefined, thunder ? 2 : 1);
  if (!mod(s, 'lightning.chain')) return;
  for (const c of cands) {
    const next = arcCands(s, c, visited)[0];
    if (!next) continue;
    visited.add(next);
    fx.push({ t: 'lightning', points: [{ x: c.x, y: c.y }, { x: next.x, y: next.y }] });
    hitEnemy(s, next, CHAIN_DMG, 'lightning', fx);
  }
}

function clampX(x: number, r: number): number {
  return Math.max(TABLE.x + r, Math.min(TABLE.x + TABLE.w - r, x));
}
function clampY(y: number, r: number): number {
  return Math.max(TABLE.y + r, Math.min(TABLE.y + TABLE.h - r, y));
}
