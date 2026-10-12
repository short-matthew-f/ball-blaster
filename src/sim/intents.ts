// Intent rolls. Not reach-aware (execution is): an Attack rolled out of reach executes as Advance.
import type { RunState, Target } from '../core/types';
import { BOSS_ATTACK, BOSS_COG_CAP, BOSS_SLAM, REPAIR_RANGE, TARGET_DEFS, stageById } from '../core/tuning';
import { mod } from './gear';

/** Stage attack scaling (x ATK_GROWTH^n): the shown number is the hit. */
function atk(s: RunState, n: number): number {
  return n > 0 ? Math.max(1, Math.round(n * stageById(s.stage).atkScale)) : n;
}

/** Live cogs summoned by the Mainspring (its own cap, BOSS_COG_CAP). */
export function bossCogs(s: RunState): number {
  let n = 0;
  for (const t of s.targets) if (!t.dead && t.kind === 'cog' && t.summon) n++;
  return n;
}

/**
 * Tinker Repair target: the live ally (not `e`, the boss or cadre) within REPAIR_RANGE (edge gap) missing the most HP;
 * ties: lowest id. Undefined when nobody in range is damaged.
 */
export function repairTarget(s: RunState, e: Target): Target | undefined {
  let best: Target | undefined;
  for (const o of s.targets) {
    if (o === e || o.dead || o.kind === 'boss' || o.kind === 'cadre' || o.hp >= o.maxHp) continue;
    // Grounded (static capstone): a staggered enemy cannot be repaired (inline: enemy.ts imports this module).
    if (o.stagger >= TARGET_DEFS[o.kind].staggerAt && mod(s, 'static.grounded')) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) - o.r - e.r > REPAIR_RANGE) continue;
    const miss = o.maxHp - o.hp;
    const bm = best ? best.maxHp - best.hp : -1;
    if (miss > bm || (miss === bm && best && o.id < best.id)) best = o;
  }
  return best;
}

/**
 * The Mainspring. Phase 1: Attack 4 (50) / Advance (25) / Wind (25). Phase 2: Slam 8 after a Charge; else Charge (40) /
 * Summon cog (30; 0 at BOSS_COG_CAP live boss cogs) / Attack 4 (30).
 */
function mainspringIntent(s: RunState, e: Target): void {
  if (e.phase === 0) {
    const p = s.rng.pick([
      { t: 'attack' as const, weight: 50 },
      { t: 'advance' as const, weight: 25 },
      { t: 'wind' as const, weight: 25 },
    ]);
    e.intent = p.t === 'attack' ? { t: 'attack', n: atk(s, BOSS_ATTACK) } : { t: p.t };
  } else if (e.charged) {
    e.intent = { t: 'attack', n: atk(s, BOSS_SLAM) };
  } else {
    const p = s.rng.pick([
      { t: 'charge' as const, weight: 40 },
      { t: 'summon' as const, weight: bossCogs(s) >= BOSS_COG_CAP ? 0 : 30 },
      { t: 'attack' as const, weight: 30 },
    ]);
    e.intent = p.t === 'attack' ? { t: 'attack', n: atk(s, BOSS_ATTACK) } : { t: p.t };
  }
}

export function rollIntent(s: RunState, e: Target): void {
  const def = TARGET_DEFS[e.kind];
  switch (e.kind) {
    case 'goblin':
      // The Loot Goblin only ever flees (scurry is driven by the loot phase). No rng draw.
      e.intent = { t: 'flee' };
      return;
    case 'bomber': {
      // Fixed cycle: Advance, Advance, Detonate.
      const c = e.cycle ?? 0;
      e.cycle = c + 1;
      e.intent = c % 3 === 2 ? { t: 'detonate' } : { t: 'advance' };
      return;
    }
    case 'brute':
      // Charge -> Attack 5, alternating; an out-of-reach Attack advances and keeps the charge.
      e.intent = e.charged ? { t: 'attack', n: atk(s, def.chargedAttack ?? 5) } : { t: 'charge' };
      return;
    case 'boss':
      if (stageById(s.stage).boss.kit === 'mainspring') {
        mainspringIntent(s, e);
        return;
      }
      if (e.phase === 0) {
        const p = s.rng.pick([
          { t: 'attack' as const, weight: 50 },
          { t: 'advance' as const, weight: 25 },
          { t: 'summon' as const, weight: 25 },
        ]);
        e.intent = p.t === 'attack' ? { t: 'attack', n: atk(s, BOSS_ATTACK) } : { t: p.t };
      } else if (e.charged) {
        e.intent = { t: 'attack', n: atk(s, BOSS_SLAM) };
      } else {
        e.intent = s.rng.chance(0.5) ? { t: 'charge' } : { t: 'attack', n: atk(s, BOSS_ATTACK) };
      }
      return;
  }
  let p = s.rng.pick(def.intents);
  // Tinker: Repair only rolls with a damaged ally in range; otherwise it Shoots.
  if (p.t === 'repair' && !repairTarget(s, e)) p = def.intents.find((x) => x.t === 'shoot') ?? p;
  let n = p.n;
  if (n !== undefined) {
    if (p.t === 'attack' && e.charged) n = def.chargedAttack ?? n * 2;
    if (p.t === 'shoot') n += stageById(s.stage).shootBonus;
    n = atk(s, n);
  }
  e.intent = n === undefined ? { t: p.t } : { t: p.t, n };
}
