// Bog mud (v0.7 spec section 1). A live, moving body whose centre enters a mud patch stops dead (the hero keeps
// MUD_KEEP[mudGrip] of its speed); leaving is free. `inMud` = "centre inside a patch at the end of the last substep";
// positional moves (relaxAll, shoot, pull, Rack 'Em, jam, nudge, sweeps, growth) only refresh it, so a body placed
// inside a patch leaves freely. Pure geometry; imports core only (damage.ts and physics.ts both use it).
import { TABLE, type Hazard, type RunState } from '../core/types';
import { MUD_GROW, MUD_KEEP, gearVal } from '../core/tuning';

export function hasMud(s: RunState): boolean {
  for (const z of s.hazards) if (z.kind === 'mud') return true;
  return false;
}

/** True when (x,y) lies inside a mud patch (strictly, centre distance < r). */
export function inMudAt(s: RunState, x: number, y: number): boolean {
  for (const z of s.hazards) if (z.kind === 'mud' && (x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return true;
  return false;
}

/** Hero speed kept entering mud for the run's MUD BOOTS level (0 / 0.5 / 1). */
export function heroMudKeep(s: RunState): number {
  return gearVal(MUD_KEEP, s.stats.mudGrip ?? 0);
}

/** Re-read `inMud` for every live body (positional moves never fire an entry). No-op off Bog. */
export function refreshMud(s: RunState): void {
  if (!hasMud(s)) return;
  for (const b of s.balls) b.inMud = inMudAt(s, b.x, b.y);
  for (const t of s.targets) if (!t.dead) t.inMud = inMudAt(s, t.x, t.y);
}

/**
 * Does the straight centre path a -> b enter a mud patch (one not containing a)? For the bots' mud-aware target choice
 * (DESIGN v0.7 section 8): ignores MUD BOOTS.
 */
export function mudOnLine(s: RunState, ax: number, ay: number, bx: number, by: number): boolean {
  return mudEntry(s, ax, ay, bx - ax, by - ay, 1) !== null;
}

/**
 * First entry of the ray p + k*(dx,dy), k in (0, kmax], into a mud patch whose disc does not contain p (centre crosses
 * the rim). Returns k, or null.
 */
export function mudEntry(s: RunState, px: number, py: number, dx: number, dy: number, kmax = Infinity): number | null {
  let best: number | null = null;
  const a = dx * dx + dy * dy;
  if (a <= 0) return null;
  for (const z of s.hazards) {
    if (z.kind !== 'mud') continue;
    const fx = px - z.x;
    const fy = py - z.y;
    const c = fx * fx + fy * fy - z.r * z.r;
    if (c < 0) continue; // starts inside: leaves freely
    const b = fx * dx + fy * dy;
    const disc = b * b - a * c;
    if (disc < 0) continue;
    const k = (-b - Math.sqrt(disc)) / a;
    if (k > 1e-9 && k <= kmax && (best === null || k < best)) best = k;
  }
  return best;
}

/** The Mire Queen's phase-2 entry: every patch grows MUD_GROW px of radius (the disc stays inside the rails). */
export function growMud(s: RunState): void {
  for (const z of s.hazards) {
    if (z.kind !== 'mud') continue;
    z.r = Math.min(z.r + MUD_GROW, maxMudR(z));
  }
  refreshMud(s);
}

function maxMudR(z: Hazard): number {
  return Math.max(z.r, Math.min(z.x - TABLE.x, TABLE.x + TABLE.w - z.x, z.y - TABLE.y, TABLE.y + TABLE.h - z.y));
}
