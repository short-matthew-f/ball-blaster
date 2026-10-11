// Per-shot combo evaluation (release -> every ball stopped). Combos count hits, not kills.
import type { ComboTally, FxEvent, RunState } from '../core/types';

export function emptyCombo(): ComboTally {
  return { hits: 0, kills: 0, bankKills: 0, bumperHits: 0, chainKills: 0, cash: 0 };
}

/** Pays unlocked combos for the shot just finished. */
export function evaluateCombos(s: RunState, x: number, y: number, fx: FxEvent[]): void {
  const c = s.combo;
  const st = s.stats;
  const shotCash = c.cash ?? 0;
  s.bestCombo = Math.max(s.bestCombo, c.hits);

  const trigger = (name: string, frac: number, units: number, base = shotCash) => {
    const bonus = Math.max(1, Math.round(base * frac * units));
    s.cash += bonus;
    fx.push({ t: 'combo', name, mult: 1 + frac * units, x, y });
  };

  // Chain xN: 3+ hits in one shot, +comboMultiKill cash per hit beyond 2.
  if (st.comboMultiKill > 0 && c.hits >= 3) trigger(`CHAIN x${c.hits}`, st.comboMultiKill, c.hits - 2, Math.max(shotCash, 4));
  if (st.comboBank > 0 && c.bankKills >= 1) trigger('BANK SHOT', st.comboBank, c.bankKills);
  if (st.comboBumperChain > 0 && c.bumperHits >= 3) trigger('BUMPER CHAIN', st.comboBumperChain, c.bumperHits - 2, Math.max(shotCash, 5));
  if (st.comboChainReaction > 0 && c.chainKills >= 1) trigger('CASCADE', st.comboChainReaction, c.chainKills);
}
