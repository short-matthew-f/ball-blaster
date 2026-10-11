// Active target tier: wardens shield, frost freezes, hives spawn spores. Runs once per enemy phase
// (after respawns, before boss behaviours). Telegraph state lives on the Target (act/aimId); fx are pings.
import { SHIMMER_SECONDS, type FxEvent, type RunState, type Target } from '../core/types';
import { ACTIVE_RANGE, FREEZE_CAP, FREEZE_PHASES, SHIELD_CAP, SPORE_CAP, TARGET_DEFS } from '../core/tuning';
import { isActive, isRegular, makeTarget, spotFree } from './spawn';
import { thaw } from './targets';

const live = (t: Target) => !t.dead;
const solid = (t: Target) => !t.dead && t.shimmer <= 0;

function count(s: RunState, f: (t: Target) => boolean): number {
  let n = 0;
  for (const t of s.targets) if (live(t) && f(t)) n++;
  return n;
}
const shields = (s: RunState) => count(s, (t) => (t.shield ?? 0) > 0);
const frozens = (s: RunState) => count(s, (t) => (t.frozen ?? 0) > 0);
const spores = (s: RunState) => count(s, (t) => t.kind === 'spore');

function capReached(s: RunState, a: Target): boolean {
  if (a.kind === 'warden') return shields(s) >= SHIELD_CAP;
  if (a.kind === 'frost') return frozens(s) >= FREEZE_CAP;
  return spores(s) >= SPORE_CAP;
}

/** Can `t` be shielded/frozen (ignoring range and other actors' claims)? */
function affectable(t: Target): boolean {
  return solid(t) && isRegular(t) && !isActive(t) && !((t.shield ?? 0) > 0) && !((t.frozen ?? 0) > 0);
}

function pickAim(s: RunState, a: Target): Target | undefined {
  const claimed = new Set<number>();
  for (const o of s.targets) if (o !== a && live(o) && o.aimId !== undefined) claimed.add(o.aimId);
  let best: Target | undefined;
  let bestD = Infinity;
  for (const t of s.targets) {
    if (t === a || !affectable(t) || claimed.has(t.id)) continue;
    const d = Math.hypot(t.x - a.x, t.y - a.y);
    if (d <= ACTIVE_RANGE && (d < bestD || (d === bestD && best && t.id < best.id))) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function spawnSpore(s: RunState, hive: Target, fx: FxEvent[]): boolean {
  const r = TARGET_DEFS.spore.r;
  for (let i = 0; i < 16; i++) {
    const a = s.rng.range(0, Math.PI * 2);
    const d = hive.r + r + s.rng.range(4, 12);
    const x = hive.x + Math.cos(a) * d;
    const y = hive.y + Math.sin(a) * d;
    if (spotFree(s, x, y, r, false)) {
      s.targets.push(makeTarget(s, 'spore', x, y, SHIMMER_SECONDS));
      fx.push({ t: 'shimmer', x, y });
      return true;
    }
  }
  return false;
}

/** Enemy-phase active tier. Returns true if anything spawned (lengthens the enemy phase for the shimmer). */
export function activePhase(s: RunState, fx: FxEvent[]): boolean {
  // Freezes tick down first; a freeze set this phase therefore lasts FREEZE_PHASES full phases.
  for (const t of s.targets) {
    if (t.dead || !((t.frozen ?? 0) > 0)) continue;
    t.frozen = (t.frozen ?? 0) - 1;
    if (t.frozen <= 0) thaw(s, t, fx);
  }

  let spawned = false;
  for (const a of s.targets.slice()) {
    if (!solid(a) || !isActive(a)) continue;
    if (a.act === 1) {
      // Execute the telegraphed action, then return to ready.
      if (a.kind === 'hive') {
        if (!capReached(s, a) && spawnSpore(s, a, fx)) spawned = true;
      } else {
        const aim = s.targets.find((t) => t.id === a.aimId);
        if (aim && affectable(aim) && !capReached(s, a)) {
          if (a.kind === 'warden') {
            aim.shield = 1;
            fx.push({ t: 'shieldUp', x: aim.x, y: aim.y });
          } else {
            aim.frozen = FREEZE_PHASES;
            aim.vx = 0;
            aim.vy = 0;
            fx.push({ t: 'freeze', x: aim.x, y: aim.y });
          }
        }
      }
      a.act = 2;
      a.aimId = undefined;
    } else {
      // Pick: telegraph this phase, execute next phase.
      if (capReached(s, a)) continue;
      if (a.kind === 'hive') {
        a.act = 1;
        fx.push({ t: 'telegraph', x: a.x, y: a.y, kind: 'spawn' });
        continue;
      }
      const aim = pickAim(s, a);
      if (!aim) continue;
      a.act = 1;
      a.aimId = aim.id;
      fx.push({ t: 'telegraph', x: a.x, y: a.y, kind: a.kind === 'warden' ? 'shield' : 'freeze' });
    }
  }
  return spawned;
}
