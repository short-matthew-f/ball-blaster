// Per-shot combo evaluation (release -> every ball stopped). Combos count hits, not kills.
// Cascade pays at the kill (sim/damage.ts); Sweep pays at wave clear (sim/enemy.ts).
import type { ComboTally, FxEvent, RunState } from '../core/types';
import { CHAIN_BONUS_CAP, TARGET_DEFS } from '../core/tuning';
import { heal } from './damage';

export function emptyCombo(): ComboTally {
  return { hits: 0, bumps: 0, direct: 0, bankCash: 0, kills: 0, bankKills: 0, bumperHits: 0, chainKills: 0, cash: 0 };
}

/** Pays unlocked combos for the shot just finished. */
export function evaluateCombos(s: RunState, x: number, y: number, fx: FxEvent[]): void {
  const c = s.combo;
  const st = s.stats;
  const shotCash = c.cash ?? 0;
  s.bestCombo = Math.max(s.bestCombo, c.hits);

  // Chain xN: 3+ hits in one shot, +comboChain of the shot's cash per hit beyond 2, capped at +CHAIN_BONUS_CAP
  // (floor of 1 per hit).
  if (st.comboChain > 0 && c.hits >= 3) {
    const extra = c.hits - 2;
    const frac = Math.min(CHAIN_BONUS_CAP, st.comboChain * extra);
    const bonus = Math.max(extra, Math.round(shotCash * frac));
    s.cash += bonus;
    fx.push({ t: 'combo', name: `CHAIN x${c.hits}`, mult: 1 + frac, x, y });
  }
  // Bank: +comboBank on kills made after a wall bounce.
  if (st.comboBank > 0 && (c.bankCash ?? 0) > 0) {
    s.cash += Math.max(1, Math.round((c.bankCash ?? 0) * st.comboBank));
    fx.push({ t: 'combo', name: 'BANK SHOT', mult: 1 + st.comboBank, x, y });
  }
  // Lockdown: every live enemy staggered (or frozen) this shot -> heal via the curve.
  if (st.comboLockdown > 0) {
    const live = s.targets.filter((t) => !t.dead);
    if (live.length > 0 && live.every((t) => t.stagger >= TARGET_DEFS[t.kind].staggerAt || (t.frozen ?? 0) > 0)) {
      fx.push({ t: 'combo', name: 'LOCKDOWN', mult: 1, x, y });
      heal(s, st.comboLockdown, x, y, fx);
    }
  }
}
