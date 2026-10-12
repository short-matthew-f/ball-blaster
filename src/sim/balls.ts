// Extra-ball spawners shared by physics (first contact, Rail Split) and damage (Mitosis kills). Imports core + gear only,
// so damage.ts can use it without an import cycle through physics.ts.
import { TABLE, type Ball, type FxEvent, type RunState, type Target } from '../core/types';
import { HOMING_R, MITOSIS_KIDS, SWARM_EXTRA } from '../core/tuning';
import { heroGap, mod } from './gear';

export const SPLIT_R = 2.5;
const SPLIT_MASS = 0.5;

export function clampIn(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Children of a Split: the card's count (Swarm: + SWARM_EXTRA). */
export function splitKids(s: RunState): number {
  return s.stats.splitCount + (mod(s, 'split.swarm') ? SWARM_EXTRA : 0);
}

/** Homing (split capstone): live enemies (not the goblin) within HOMING_R of the hero, nearest first (ties: id). */
function homingTargets(s: RunState): Target[] {
  return s.targets
    .filter((t) => !t.dead && t.kind !== 'goblin')
    .map((t) => ({ t, d: heroGap(s, t) }))
    .filter((c) => c.d <= HOMING_R)
    .sort((a, b) => a.d - b.d || a.t.id - b.t.id)
    .map((c) => c.t);
}

/**
 * Split: `n` children fan out from `b` at 0.9x its speed. Homing: child i heads for the i-th nearest enemy within
 * HOMING_R of the hero instead of its fan angle (no rng either way).
 */
export function spawnSplit(s: RunState, b: Ball, fx: FxEvent[], n = splitKids(s)): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1e-6 || n <= 0) return;
  const base = Math.atan2(b.vy, b.vx);
  const deg = Math.PI / 180;
  const homing = mod(s, 'split.homing') ? homingTargets(s) : [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const step = Math.floor(i / 2) + 1;
    const spread = Math.min(25, (25 * step) / Math.ceil(n / 2));
    const h = homing[i];
    const a = h ? Math.atan2(h.y - b.y, h.x - b.x) : base + side * spread * deg;
    const off = b.r + SPLIT_R + 0.5;
    s.balls.push({
      id: s.nextId++,
      kind: 'split',
      x: clampIn(b.x + Math.cos(a) * off, TABLE.x + SPLIT_R, TABLE.x + TABLE.w - SPLIT_R),
      y: clampIn(b.y + Math.sin(a) * off, TABLE.y + SPLIT_R, TABLE.y + TABLE.h - SPLIT_R),
      vx: Math.cos(a) * sp * 0.9,
      vy: Math.sin(a) * sp * 0.9,
      r: SPLIT_R,
      mass: SPLIT_MASS,
      life: Infinity,
      resting: false,
      banked: b.banked,
    });
  }
  fx.push({ t: 'split', x: b.x, y: b.y });
}

/** Mitosis (split capstone): the first child kill of a shot releases MITOSIS_KIDS more from the killer (no grandchildren). */
export function mitosis(s: RunState, killer: Ball, fx: FxEvent[]): void {
  if (s.childSplitUsed) return;
  s.childSplitUsed = true;
  spawnSplit(s, killer, fx, MITOSIS_KIDS);
}
