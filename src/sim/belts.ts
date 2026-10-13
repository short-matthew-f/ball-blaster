// Clockwork conveyors (DESIGN v0.5 / clockwork spec section 2). At the start of an enemy phase, if any body's centre is
// on a belt, the phase holds BELT_HOLD s (s.beltAt) and then sweeps: every resting body on a belt slides up to
// BELT_SHIFT px along it (the hero 24/12/0 by CLEATS level), stopping at the first contact with a rail, an obstacle or
// another live body. Front-most bodies move first (projection on the belt direction, ties: lower id), so a queue on a
// belt advances together. Frozen enemies never move but block. Wind (the Mainspring) makes the next sweep run twice.
// Pure geometry: no rng, no velocities; relaxAll runs once after the sweep.
import { TABLE, type Ball, type FxEvent, type Hazard, type RunState, type Target } from '../core/types';
import { BELT_GRIP_SHIFT, BELT_HOLD, BELT_SHIFT, gearVal } from '../core/tuning';
import { relaxAll } from './physics';

/** A body as the sweep sees it (a copy: planning never mutates the state). */
interface SweepBody {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Max carry per pass (0 = blocker only: frozen enemies, a hero with full CLEATS, rolling bodies). */
  shift: number;
  ref: Ball | Target;
}

export function hasBelts(s: RunState): boolean {
  for (const z of s.hazards) if (z.kind === 'conveyor') return true;
  return false;
}

/** The first belt (hazard order) whose rect contains (x,y), or undefined. */
export function beltUnder(s: RunState, x: number, y: number): Hazard | undefined {
  for (const z of s.hazards) {
    if (z.kind !== 'conveyor') continue;
    if (Math.abs(x - z.x) <= (z.w ?? 0) / 2 && Math.abs(y - z.y) <= (z.h ?? 0) / 2) return z;
  }
  return undefined;
}

/** Hero carry per pass for the run's CLEATS level (24 / 12 / 0). */
export function heroBeltShift(s: RunState): number {
  return gearVal(BELT_GRIP_SHIFT, s.stats.beltGrip ?? 0);
}

function sweepBodies(s: RunState): SweepBody[] {
  const out: SweepBody[] = [];
  for (const b of s.balls) {
    if (b.kind !== 'main') continue;
    out.push({ id: b.id, x: b.x, y: b.y, r: b.r, shift: b.resting ? heroBeltShift(s) : 0, ref: b });
  }
  for (const t of s.targets) {
    if (t.dead) continue; // dead bodies and ghosts are skipped entirely
    const still = (t.frozen ?? 0) > 0 || !t.resting;
    out.push({ id: t.id, x: t.x, y: t.y, r: t.r, shift: still ? 0 : BELT_SHIFT, ref: t });
  }
  return out;
}

/** Distance along unit (dx,dy) from p until a circle of radius R round c is touched; Infinity if never (moving away). */
function rayToCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, R: number): number {
  const fx = px - cx;
  const fy = py - cy;
  const b = fx * dx + fy * dy;
  if (b >= 0) return Infinity; // not approaching
  const c = fx * fx + fy * fy - R * R;
  if (c <= 0) return 0; // already touching and approaching
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  return Math.max(0, -b - Math.sqrt(disc));
}

/** Free travel (<= max) of `m` along (dx,dy) before a rail, a live obstacle or another body. */
function freeTravel(s: RunState, m: SweepBody, list: SweepBody[], dx: number, dy: number, max: number): number {
  let t = max;
  if (dx > 0) t = Math.min(t, TABLE.x + TABLE.w - m.r - m.x);
  else if (dx < 0) t = Math.min(t, m.x - (TABLE.x + m.r));
  if (dy > 0) t = Math.min(t, TABLE.y + TABLE.h - m.r - m.y);
  else if (dy < 0) t = Math.min(t, m.y - (TABLE.y + m.r));
  for (const o of s.obstacles) {
    if (o.dead) continue;
    t = Math.min(t, rayToCircle(m.x, m.y, dx, dy, o.x, o.y, m.r + o.r));
  }
  for (const o of list) {
    if (o === m) continue;
    t = Math.min(t, rayToCircle(m.x, m.y, dx, dy, o.x, o.y, m.r + o.r));
  }
  return Math.max(0, t);
}

/**
 * Free travel (<= max px) of body `ref` (the hero or a live target) along unit (dx,dy) before it touches a rail, a live
 * obstacle or another live body (the sweep's slide-to-contact rule). The Mire Queen's pull uses it.
 */
export function slideRoom(s: RunState, ref: Ball | Target, dx: number, dy: number, max: number): number {
  const list = sweepBodies(s);
  const me = list.find((m) => m.ref === ref);
  if (!me) return 0;
  return freeTravel(s, me, list, dx, dy, max);
}

/** One sweep pass over `list` (mutates the copies). Owners are fixed at the start of the pass. */
function sweepPass(s: RunState, list: SweepBody[]): void {
  const owner = new Map<SweepBody, Hazard>();
  for (const m of list) {
    if (m.shift <= 0) continue;
    const z = beltUnder(s, m.x, m.y);
    if (z) owner.set(m, z);
  }
  for (const z of s.hazards) {
    if (z.kind !== 'conveyor') continue;
    const dx = z.dx ?? 0;
    const dy = z.dy ?? 0;
    const movers = list.filter((m) => owner.get(m) === z);
    // Front-most first along the belt; equal projections: lower id (the hero is id 1) first.
    movers.sort((a, b) => b.x * dx + b.y * dy - (a.x * dx + a.y * dy) || a.id - b.id);
    for (const m of movers) {
      const d = freeTravel(s, m, list, dx, dy, m.shift);
      m.x += dx * d;
      m.y += dy * d;
    }
  }
}

/** Planned sweep: copies with their final positions (passes = 2 when wound). */
function plan(s: RunState): SweepBody[] {
  const list = sweepBodies(s);
  const passes = s.beltWound ? 2 : 1;
  for (let p = 0; p < passes; p++) sweepPass(s, list);
  return list;
}

/** True if a sweep would move something now (some carriable body's centre is on a belt). */
export function anyOnBelt(s: RunState): boolean {
  if (!hasBelts(s)) return false;
  for (const m of sweepBodies(s)) if (m.shift > 0 && beltUnder(s, m.x, m.y)) return true;
  return false;
}

/** Enemy-phase start: schedule the sweep (and hold the queue) when something is on a belt. */
export function scheduleSweep(s: RunState): void {
  s.beltAt = undefined;
  if (!anyOnBelt(s)) return;
  s.beltAt = s.t + BELT_HOLD;
  s.enemyNext = s.beltAt;
}

/** Run the sweep now: move bodies, one `belt` fx per displaced body (total displacement), relax, clear Wind. */
export function runSweep(s: RunState, fx: FxEvent[]): void {
  s.beltAt = undefined;
  const list = plan(s);
  s.beltWound = false;
  for (const m of list) {
    const ddx = m.x - m.ref.x;
    const ddy = m.y - m.ref.y;
    if (Math.abs(ddx) < 1e-9 && Math.abs(ddy) < 1e-9) continue;
    m.ref.x = m.x;
    m.ref.y = m.y;
    fx.push({ t: 'belt', x: m.x, y: m.y, dx: ddx, dy: ddy });
  }
  relaxAll(s);
}

/**
 * Where the hero would rest after the next sweep from where it is now (CLEATS-adjusted, Wind honoured), or null when
 * the hero's centre is not on a belt. Render draws a dotted outline there during aim.
 */
export function beltPreview(s: RunState): { x: number; y: number } | null {
  if (!hasBelts(s)) return null;
  const h = s.balls.find((b) => b.kind === 'main');
  if (!h || !beltUnder(s, h.x, h.y)) return null;
  const list = sweepBodies(s);
  // Preview assumes the hero is at rest where it is (aim), whatever its current velocity.
  const me = list.find((m) => m.ref === h)!;
  me.shift = heroBeltShift(s);
  const passes = s.beltWound ? 2 : 1;
  for (let p = 0; p < passes; p++) sweepPass(s, list);
  return { x: me.x, y: me.y };
}
