// Damage, death and on-death effects (cash, meter, splitting, volatile chains, lightning).
import { TABLE, type Ball, type BallKind, type FxEvent, type RunState, type Target, type Vec } from '../core/types';
import { BOARD_CLEAR_REFILL, TARGET_DEFS, stageById } from '../core/tuning';
import { refill } from './energy';
import { checkBossPhase, updateShield } from './boss';
import { isRegular, liveRegulars, makeTarget } from './spawn';

export type DamageSource = BallKind | 'lightning' | 'explosion';

/** Every point of damage goes through here: shield -> hp -> boss phase -> death. */
export function applyDamage(s: RunState, t: Target, dmg: number, src: DamageSource, fx: FxEvent[], killer?: Ball): void {
  if (t.dead) return;
  if (t.kind === 'boss' && t.shielded) dmg = 0;
  t.hp -= dmg;
  t.flash = 0.12;
  const killed = t.hp <= 0;
  if (src !== 'lightning' && src !== 'explosion') {
    fx.push({ t: 'hit', x: t.x, y: t.y, targetKind: t.kind, ballKind: src, dmg, killed });
  }
  if (t.kind === 'boss' && !killed) checkBossPhase(s, t, fx);
  if (killed) kill(s, t, src, fx, killer);
}

export function kill(s: RunState, t: Target, src: DamageSource, fx: FxEvent[], killer?: Ball): void {
  if (t.dead) return;
  t.dead = true;
  t.hp = 0;
  const def = TARGET_DEFS[t.kind];
  const st = stageById(s.stage);
  const cash = Math.round(def.cash * st.cashScale * s.stats.cashMult);
  s.cash += cash;
  s.combo.cash = (s.combo.cash ?? 0) + cash;
  fx.push({ t: 'kill', x: t.x, y: t.y, targetKind: t.kind, cash });

  if (t.kind === 'boss') {
    s.bossKilled = true;
    fx.push({ t: 'bossDead', x: t.x, y: t.y });
  } else {
    s.kills++;
    s.combo.kills++;
    if (src === 'main' && killer && killer.banked) s.combo.bankKills++;
    if (src === 'lightning' || src === 'explosion') s.combo.chainKills++;
    s.meterKills += def.meter;
    if (!s.bossSpawned && !s.bossPending && s.meterKills >= st.meterKills) s.bossPending = true;
  }
  if (t.kind === 'cadre') updateShield(s);

  if (s.stats.killRefillChance > 0 && s.rng.chance(s.stats.killRefillChance)) {
    refill(s, s.stats.killRefillAmount, t.x, t.y, fx);
  }
  if (s.stats.strayEmeraldChance > 0 && s.rng.chance(s.stats.strayEmeraldChance)) {
    s.emeralds += 1;
    fx.push({ t: 'emerald', x: t.x, y: t.y, amount: 1 });
  }

  if (def.splitsInto) {
    const { kind, count } = def.splitsInto;
    const cr = TARGET_DEFS[kind].r;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + s.rng.range(0, Math.PI);
      const d = t.r * 0.6 + cr;
      const m = makeTarget(s, kind, clampX(t.x + Math.cos(a) * d, cr), clampY(t.y + Math.sin(a) * d, cr), 0);
      s.targets.push(m);
    }
  }

  // Board clear: the last regular target died during a shot (checked after splits so minis count).
  if (s.phase === 'resolve' && !s.boardCleared && isRegular(t) && liveRegulars(s) === 0) {
    s.boardCleared = true;
    fx.push({ t: 'boardClear', x: t.x, y: t.y });
    refill(s, BOARD_CLEAR_REFILL, t.x, t.y, fx);
  }

  if (def.explodeR && def.explodeDmg) {
    fx.push({ t: 'explode', x: t.x, y: t.y, r: def.explodeR });
    for (const o of s.targets.slice()) {
      if (o.dead || o === t || o.shimmer > 0) continue;
      if (Math.hypot(o.x - t.x, o.y - t.y) <= def.explodeR + o.r) applyDamage(s, o, def.explodeDmg, 'explosion', fx);
    }
  }
}

/** Chain lightning from a struck target to the nearest other live targets. */
export function chainLightning(s: RunState, from: Target, fx: FxEvent[]): void {
  const { lightningChance, lightningArcs, lightningRange, lightningDamage } = s.stats;
  if (lightningChance <= 0 || lightningArcs <= 0 || lightningRange <= 0) return;
  if (!s.rng.chance(lightningChance)) return;
  const cands = s.targets
    .filter((o) => !o.dead && o !== from && o.shimmer <= 0)
    .map((o) => ({ o, d: Math.hypot(o.x - from.x, o.y - from.y) }))
    .filter((c) => c.d <= lightningRange)
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .slice(0, lightningArcs);
  if (cands.length === 0) return;
  const points: Vec[] = [{ x: from.x, y: from.y }];
  for (const c of cands) points.push({ x: c.o.x, y: c.o.y });
  fx.push({ t: 'lightning', points });
  for (const c of cands) applyDamage(s, c.o, lightningDamage, 'lightning', fx);
}

function clampX(x: number, r: number): number {
  return Math.max(TABLE.x + r + 1, Math.min(TABLE.x + TABLE.w - r - 1, x));
}
function clampY(y: number, r: number): number {
  return Math.max(TABLE.y + r + 1, Math.min(TABLE.y + TABLE.h - r - 1, y));
}
