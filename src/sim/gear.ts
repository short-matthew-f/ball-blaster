// Gear helpers (DESIGN-v0.4-loadout): is a relic equipped, and at what level.
import type { RunState, RelicId, Target } from '../core/types';
import { GATLING_MULT, LANTERN_R_LV, MORTAR_MULT, gearVal } from '../core/tuning';

export function has(s: RunState, id: RelicId): boolean {
  return s.stats.relics.includes(id);
}

/** Upgrade level of a gear id (0 = base). */
export function lv(s: RunState, id: string): number {
  return s.stats.gearLevel[id] ?? 0;
}

/** True when an equipped card's active fork/capstone choice `id` (e.g. 'break.slam') is in play this run (v0.6 M3). */
export function mod(s: RunState, id: string): boolean {
  return s.stats.mods.includes(id);
}

/** Lantern forks/capstones: reach (edge gap px from the hero); Sunrise = the whole table. */
export function lanternR(s: RunState): number {
  return mod(s, 'lantern.sunrise') ? Infinity : gearVal(LANTERN_R_LV, lv(s, 'lantern'));
}

/** Edge gap (px) between the hero and `t`. */
export function heroGap(s: RunState, t: Target): number {
  const h = s.balls.find((b) => b.kind === 'main');
  if (!h) return Infinity;
  return Math.hypot(h.x - t.x, h.y - t.y) - h.r - t.r;
}

/** Time Stop "in effect" (v0.6 M3): a stopped enemy phase, or a Slow phase (Clockwork and Stasis work under both). */
export function timeStopInEffect(s: RunState): boolean {
  return !!s.timeStopped || (s.slowPhases ?? 0) > 0;
}

/** Seconds between spat balls (Gatling x GATLING_MULT, Mortar x MORTAR_MULT). */
export function spitInterval(s: RunState): number {
  const k = mod(s, 'spitter.gatling') ? GATLING_MULT : mod(s, 'spitter.mortar') ? MORTAR_MULT : 1;
  return s.stats.spitInterval * k;
}
