// Intent rolls. Not reach-aware (execution is): an Attack rolled out of reach executes as Advance.
import type { RunState, Target } from '../core/types';
import { BOSS_ATTACK, BOSS_SLAM, TARGET_DEFS, stageById } from '../core/tuning';

/** Stage attack scaling (x ATK_GROWTH^n), applied before the Overtime bonus so the shown number is the hit. */
function atk(s: RunState, n: number): number {
  return n > 0 ? Math.max(1, Math.round(n * stageById(s.stage).atkScale)) : n;
}

export function rollIntent(s: RunState, e: Target): void {
  const def = TARGET_DEFS[e.kind];
  const bonus = e.atkBonus ?? 0;
  switch (e.kind) {
    case 'bomber': {
      // Fixed cycle: Advance, Advance, Detonate.
      const c = e.cycle ?? 0;
      e.cycle = c + 1;
      e.intent = c % 3 === 2 ? { t: 'detonate' } : { t: 'advance' };
      return;
    }
    case 'brute':
      // Charge -> Attack 5, alternating; an out-of-reach Attack advances and keeps the charge.
      e.intent = e.charged ? { t: 'attack', n: atk(s, def.chargedAttack ?? 5) + bonus } : { t: 'charge' };
      return;
    case 'boss':
      if (e.phase === 0) {
        const p = s.rng.pick([
          { t: 'attack' as const, weight: 50 },
          { t: 'advance' as const, weight: 25 },
          { t: 'summon' as const, weight: 25 },
        ]);
        e.intent = p.t === 'attack' ? { t: 'attack', n: atk(s, BOSS_ATTACK) + bonus } : { t: p.t };
      } else if (e.charged) {
        e.intent = { t: 'attack', n: atk(s, BOSS_SLAM) + bonus };
      } else {
        e.intent = s.rng.chance(0.5) ? { t: 'charge' } : { t: 'attack', n: atk(s, BOSS_ATTACK) + bonus };
      }
      return;
  }
  const p = s.rng.pick(def.intents);
  let n = p.n;
  if (n !== undefined) {
    if (p.t === 'attack' && e.charged) n = def.chargedAttack ?? n * 2;
    if (p.t === 'shoot') n += stageById(s.stage).shootBonus;
    n = atk(s, n) + bonus;
  }
  e.intent = n === undefined ? { t: p.t } : { t: p.t, n };
}
