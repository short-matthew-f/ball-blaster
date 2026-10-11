// Boss arrival, cadre shield, phases and phase behaviours.
import { BOSS_ZONE, ENEMY_PHASE_SECONDS, SHIMMER_SECONDS, type BossPhaseFx, type FxEvent, type RunState, type Target } from '../core/types';
import { TARGET_DEFS, stageById } from '../core/tuning';
import { refill } from './energy';
import { circleHitsRect, isRegular, makeTarget, spotFree } from './spawn';

const MAX_LIVE_MINIS = 3;

export function liveBoss(s: RunState): Target | undefined {
  return s.targets.find((t) => t.kind === 'boss' && !t.dead);
}

/** Active phase behaviours of the live boss (empty if none). */
export function bossPhaseFx(s: RunState): BossPhaseFx[] {
  const b = liveBoss(s);
  if (!b) return [];
  return stageById(s.stage).boss.phaseFx[b.phase] ?? [];
}

export function updateShield(s: RunState): void {
  const b = liveBoss(s);
  if (!b) return;
  b.shielded = s.targets.some((t) => t.kind === 'cadre' && !t.dead);
}

export function checkBossPhase(s: RunState, b: Target, fx: FxEvent[]): void {
  const phases = stageById(s.stage).boss.phases;
  const frac = b.hp / b.maxHp;
  while (b.phase < phases.length && frac <= phases[b.phase]) {
    b.phase++;
    fx.push({ t: 'bossPhase', phase: b.phase });
  }
}

/** Called at the start of an enemy phase when bossPending. */
export function spawnBoss(s: RunState, fx: FxEvent[]): void {
  const st = stageById(s.stage);
  const def = st.boss;
  s.bossPending = false;
  s.bossSpawned = true;

  // Clear regular targets (and hive spores) out of the zone, no rewards.
  s.targets = s.targets.filter(
    (t) => t.dead || (!isRegular(t) && t.kind !== 'spore') || !circleHitsRect(t.x, t.y, t.r, BOSS_ZONE),
  );

  const cx = BOSS_ZONE.x + BOSS_ZONE.w / 2;
  const cy = BOSS_ZONE.y + BOSS_ZONE.h / 2;
  const boss = makeTarget(s, 'boss', cx, cy, 0);
  boss.r = def.r;
  boss.hp = boss.maxHp = Math.ceil(def.hp * st.hpScale);
  if (def.moves) {
    const a = s.rng.range(0, Math.PI * 2);
    const sp = 10 / ENEMY_PHASE_SECONDS;
    boss.vx = Math.cos(a) * sp;
    boss.vy = Math.sin(a) * sp;
  }
  s.targets.push(boss);

  const cr = TARGET_DEFS.cadre.r;
  for (let i = 0; i < def.cadre; i++) {
    const a = (i / def.cadre) * Math.PI * 2 - Math.PI / 2;
    const d = def.r + cr + 6;
    s.targets.push(makeTarget(s, 'cadre', cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0));
  }
  updateShield(s);

  // Push any resting ball out of the boss and cadre.
  for (const b of s.balls) {
    for (const t of s.targets) {
      if (t.dead || (t.kind !== 'boss' && t.kind !== 'cadre')) continue;
      const dx = b.x - t.x;
      const dy = b.y - t.y;
      const d = Math.hypot(dx, dy);
      const min = t.r + b.r + 1;
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 0;
        const ny = d > 1e-6 ? dy / d : 1;
        b.x = t.x + nx * min;
        b.y = t.y + ny * min;
      }
    }
  }

  fx.push({ t: 'bossArrive' });
  refill(s, s.stats.bossRefillPct * s.stats.maxEnergy, cx, cy, fx);
}

/** Enemy-phase boss behaviours (spawnMini). Returns true if anything spawned. */
export function bossEnemyPhase(s: RunState, fx: FxEvent[]): boolean {
  const b = liveBoss(s);
  if (!b || !bossPhaseFx(s).includes('spawnMini')) return false;
  const minis = s.targets.filter((t) => t.kind === 'mini' && !t.dead).length;
  if (minis >= MAX_LIVE_MINIS) return false;
  const r = TARGET_DEFS.mini.r;
  for (let i = 0; i < 16; i++) {
    const a = s.rng.range(0, Math.PI * 2);
    const d = b.r + r + s.rng.range(4, 16);
    const x = b.x + Math.cos(a) * d;
    const y = b.y + Math.sin(a) * d;
    if (spotFree(s, x, y, r, false)) {
      s.targets.push(makeTarget(s, 'mini', x, y, SHIMMER_SECONDS));
      fx.push({ t: 'shimmer', x, y });
      return true;
    }
  }
  return false;
}
