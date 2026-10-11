// Per-shot combo evaluation (release -> every ball stopped).
import type { ComboTally, FxEvent, RunState } from '../core/types';
import { refill } from './energy';

export function emptyCombo(): ComboTally {
  return { kills: 0, bankKills: 0, bumperHits: 0, chainKills: 0, cash: 0 };
}

/** Pays unlocked combos for the shot just finished. */
export function evaluateCombos(s: RunState, x: number, y: number, fx: FxEvent[]): void {
  const c = s.combo;
  const st = s.stats;
  const shotCash = c.cash ?? 0;
  s.bestCombo = Math.max(s.bestCombo, c.kills);

  const trigger = (name: string, frac: number, extraKills: number, base = shotCash) => {
    // frac = cash bonus fraction per unit; bumper chain pays a floor so kill-less chains still reward.
    const bonus = Math.max(1, Math.round(base * frac * extraKills));
    s.cash += bonus;
    fx.push({ t: 'combo', name, mult: 1 + frac * extraKills, x, y });
    if (st.comboEnergy > 0) refill(s, st.comboEnergy, x, y, fx);
  };

  if (st.comboMultiKill > 0 && c.kills >= 2) trigger('MULTI KILL', st.comboMultiKill, c.kills - 1);
  if (st.comboBank > 0 && c.bankKills >= 1) trigger('BANK SHOT', st.comboBank, c.bankKills);
  if (st.comboBumperChain > 0 && c.bumperHits >= 3) trigger('BUMPER CHAIN', st.comboBumperChain, c.bumperHits - 2, Math.max(shotCash, 5));
  if (st.comboChainReaction > 0 && c.chainKills >= 1) trigger('CHAIN REACTION', st.comboChainReaction, c.chainKills);
}
