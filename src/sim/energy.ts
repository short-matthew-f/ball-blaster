// Energy economy: the single cost choke point and the single shared refill curve.
import { CURVE_CAP, type FxEvent, type RunState } from '../core/types';

/** Pay an energy cost (clamped at 0). Emits a negative 'energy' fx. */
export function spend(s: RunState, amount: number, x: number, y: number, fx: FxEvent[]): void {
  if (amount <= 0) return;
  const paid = Math.min(s.energy, amount);
  if (paid <= 0) return;
  s.energy = Math.max(0, s.energy - amount);
  fx.push({ t: 'energy', x, y, amount: -paid });
}

/**
 * The ONLY way energy is ever refilled. Every source (bumpers, kill refills, boss arrival, shrine, combos)
 * draws from one per-run diminishing curve so stacked sources cannot make a run infinite.
 * Returns the energy actually granted.
 */
export function refill(s: RunState, base: number, x = 0, y = 0, fx?: FxEvent[]): number {
  if (base <= 0) return 0;
  const cap = CURVE_CAP * s.stats.maxEnergy;
  const mult = cap > 0 ? Math.max(0, 1 - s.refilled / cap) : 0;
  const granted = base * mult;
  if (granted <= 0) return 0;
  s.refilled += granted;
  const before = s.energy;
  s.energy = Math.min(s.stats.maxEnergy, s.energy + granted);
  if (fx) fx.push({ t: 'energy', x, y, amount: s.energy - before });
  return granted;
}
