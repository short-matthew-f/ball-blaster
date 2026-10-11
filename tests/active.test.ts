import { describe, expect, it } from 'vitest';
import { MAX_PULL, SIM_DT, type Ball, type FxEvent, type RunState, type StageId, type Target, type TargetKind } from '../src/core/types';
import { BASE_STATS, FREEZE_PHASES, SHIELD_CAP, SPORE_CAP } from '../src/core/tuning';
import { createRun, shoot, step } from '../src/sim/index';
import { liveRegulars, makeTarget } from '../src/sim/spawn';
import { applyDamage } from '../src/sim/targets';

/** Empty felt board, no respawns, main ball resting at the bottom. */
function lab(stage: StageId = 'felt'): { s: RunState; main: Ball } {
  const s = createRun(stage, { ...BASE_STATS, enemyCount: 0, respawnPerTurn: 0 }, 42);
  s.targets = [];
  s.obstacles = [];
  return { s, main: s.balls[0] };
}

function add(s: RunState, kind: TargetKind, x: number, y: number): Target {
  const t = makeTarget(s, kind, x, y, 0);
  s.targets.push(t);
  return t;
}

/** Run one enemy phase: settle -> endShot -> startEnemy (activePhase). Returns the fx. Shimmer is cleared. */
function phase(s: RunState): FxEvent[] {
  s.phase = 'resolve';
  for (const b of s.balls) b.resting = true;
  const fx = step(s, SIM_DT);
  for (const t of s.targets) t.shimmer = 0;
  return fx;
}

/** Fire the main ball straight up into whatever is above it at `vy` px/s; step until it has hit something. */
function fire(s: RunState, main: Ball, x: number, y: number, vy: number, steps = 40): FxEvent[] {
  main.x = x;
  main.y = y;
  main.vx = 0;
  main.vy = vy;
  main.resting = false;
  s.phase = 'resolve';
  const fx: FxEvent[] = [];
  for (let i = 0; i < steps; i++) fx.push(...step(s, SIM_DT));
  return fx;
}

describe('active tier: warden', () => {
  it('telegraphs one phase, shields the next', () => {
    const { s } = lab();
    const w = add(s, 'warden', 90, 100);
    const b = add(s, 'basic', 110, 100);
    expect(w.act).toBe(2);
    const f1 = phase(s);
    expect(w.aimId).toBe(b.id);
    expect(w.act).toBe(1);
    expect(f1.some((f) => f.t === 'telegraph' && f.kind === 'shield')).toBe(true);
    expect(b.shield ?? 0).toBe(0);
    const f2 = phase(s);
    expect(b.shield).toBe(1);
    expect(f2.some((f) => f.t === 'shieldUp')).toBe(true);
    expect(w.act).toBe(2);
    expect(w.aimId).toBeUndefined();
  });

  it('shielded armored: first main hit strips for hitCost only, next hit damages', () => {
    const { s, main } = lab();
    const a = add(s, 'armored', 90, 100);
    a.shield = 1;
    const e0 = s.energy;
    const fx = fire(s, main, 90, 130, -200);
    expect(a.hp).toBe(a.maxHp);
    expect(a.shield).toBe(0);
    expect(e0 - s.energy).toBe(BASE_STATS.hitCost);
    expect(fx.some((f) => f.t === 'shieldBreak')).toBe(true);
    expect(fx.some((f) => f.t === 'hit' && f.dmg === 0)).toBe(true);
    const e1 = s.energy;
    fire(s, main, 90, 130, -200);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(e1 - s.energy).toBe(BASE_STATS.hitCost + 2);
  });

  it('sticky ball: first hit strips, the free second hit damages', () => {
    const { s, main } = lab();
    s.stats.ballType = 'sticky';
    const a = add(s, 'armored', 90, 100);
    a.shield = 1;
    fire(s, main, 90, 130, -200, 240);
    expect(a.shield).toBe(0);
    expect(a.hp).toBe(a.maxHp - BASE_STATS.damage);
  });

  it('warden death strips every shield; 3 wardens never shield more than SHIELD_CAP', () => {
    const { s } = lab();
    const ws = [add(s, 'warden', 40, 80), add(s, 'warden', 90, 80), add(s, 'warden', 140, 80)];
    const bs = [add(s, 'basic', 40, 100), add(s, 'basic', 90, 100), add(s, 'basic', 140, 100)];
    for (let i = 0; i < 8; i++) {
      phase(s);
      expect(bs.filter((b) => (b.shield ?? 0) > 0).length).toBeLessThanOrEqual(SHIELD_CAP);
    }
    expect(bs.filter((b) => (b.shield ?? 0) > 0).length).toBe(SHIELD_CAP);
    s.phase = 'resolve';
    const fx: FxEvent[] = [];
    applyDamage(s, ws[0], 99, 'main', fx);
    expect(ws[0].dead).toBe(true);
    expect(bs.every((b) => !((b.shield ?? 0) > 0))).toBe(true);
    expect(fx.filter((f) => f.t === 'shieldBreak').length).toBe(SHIELD_CAP);
  });
});

describe('active tier: frost', () => {
  function frozenLab() {
    const { s, main } = lab();
    const a = add(s, 'armored', 90, 100);
    a.frozen = FREEZE_PHASES;
    const n = add(s, 'basic', 105, 100);
    return { s, main, a, n };
  }

  it('slow hit: no damage, hitCost only', () => {
    const { s, main, a } = frozenLab();
    const e0 = s.energy;
    const fx = fire(s, main, 90, 115, -100, 120);
    expect(a.hp).toBe(a.maxHp);
    expect(a.dead).toBe(false);
    expect(e0 - s.energy).toBe(BASE_STATS.hitCost);
    expect(fx.some((f) => f.t === 'hit' && f.dmg === 0)).toBe(true);
  });

  it('fast hit shatters: kill rewards, shatter fx, neighbour takes 2 as explosion', () => {
    const { s, main, a, n } = frozenLab();
    const cash0 = s.cash;
    const fx = fire(s, main, 90, 130, -300);
    expect(a.dead).toBe(true);
    expect(s.cash).toBeGreaterThan(cash0);
    expect(fx.some((f) => f.t === 'shatter')).toBe(true);
    expect(n.hp).toBe(n.maxHp - 2);
    expect(fx.some((f) => f.t === 'hit' && f.targetKind === 'basic')).toBe(false); // explosion: no ball hit fx
  });

  it('frost freezes a moving target (zero velocity), thaws after FREEZE_PHASES', () => {
    const { s } = lab();
    const f = add(s, 'frost', 90, 100);
    const m = add(s, 'moving', 110, 100);
    m.vx = m.vy = 0; // keep it in range while we drive phases
    const f1 = phase(s);
    expect(f.aimId).toBe(m.id);
    expect(f1.some((e) => e.t === 'telegraph' && e.kind === 'freeze')).toBe(true);
    m.vx = 30;
    const f2 = phase(s);
    expect(m.frozen).toBe(FREEZE_PHASES);
    expect(m.vx).toBe(0);
    expect(m.vy).toBe(0);
    expect(f2.some((e) => e.t === 'freeze')).toBe(true);
    f.dead = true; // stop refreezing
    for (let i = 1; i < FREEZE_PHASES; i++) {
      phase(s);
      expect(m.frozen).toBe(FREEZE_PHASES - i);
    }
    const f3 = phase(s);
    expect(m.frozen ?? 0).toBe(0);
    expect(f3.some((e) => e.t === 'thaw')).toBe(true);
    expect(Math.hypot(m.vx, m.vy)).toBeGreaterThan(0); // drift re-rolled
  });

  it('lightning thaws without damage', () => {
    const { s, a } = frozenLab();
    const fx: FxEvent[] = [];
    applyDamage(s, a, 3, 'lightning', fx);
    expect(a.hp).toBe(a.maxHp);
    expect(a.frozen).toBe(0);
    expect(fx.some((f) => f.t === 'thaw')).toBe(true);
  });
});

describe('active tier: hive', () => {
  it('one spore every second phase, never more than SPORE_CAP', () => {
    const { s } = lab();
    add(s, 'hive', 90, 120);
    const counts: number[] = [];
    for (let i = 0; i < 14; i++) {
      phase(s);
      counts.push(s.targets.filter((t) => t.kind === 'spore' && !t.dead).length);
    }
    expect(counts.slice(0, 8)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(Math.max(...counts)).toBe(SPORE_CAP);
  });

  it('spores are not regular: respawns and empty-board refill ignore them', () => {
    const { s } = lab();
    const h = add(s, 'hive', 90, 120);
    for (let i = 0; i < 4; i++) add(s, 'spore', 40 + i * 30, 70);
    expect(liveRegulars(s)).toBe(1);
    h.dead = true;
    s.stats.enemyCount = 3;
    phase(s);
    expect(liveRegulars(s)).toBe(2); // empty-board refill fired despite 4 live spores
    expect(s.targets.filter((t) => t.kind === 'spore' && !t.dead).length).toBe(4);
  });

  it('killing the last regular with spores alive fires boardClear', () => {
    const { s, main } = lab();
    s.stats.damage = 10;
    add(s, 'basic', 90, 100);
    add(s, 'spore', 40, 70);
    add(s, 'spore', 140, 70);
    const fx = fire(s, main, 90, 130, -200);
    expect(fx.some((f) => f.t === 'boardClear')).toBe(true);
  });
});

/** Nearest-target bot; returns a compact fingerprint and the per-phase observations. */
function botRun(stage: StageId, enemyCount: number, seed: number) {
  const s = createRun(stage, { ...BASE_STATS, enemyCount, maxEnergy: 200, damage: 4 }, seed);
  let maxWarden = 0;
  let maxHive = 0;
  const seen = new Set<string>();
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 400) {
    const main = s.balls.find((b) => b.kind === 'main')!;
    const live = s.targets.filter((t) => !t.dead && t.shimmer <= 0);
    let pull = { x: 0, y: -MAX_PULL };
    if (live.length) {
      live.sort((a, b) => Math.hypot(a.x - main.x, a.y - main.y) - Math.hypot(b.x - main.x, b.y - main.y) || a.id - b.id);
      const t = live[0];
      const d = Math.hypot(t.x - main.x, t.y - main.y) || 1;
      pull = { x: ((t.x - main.x) / d) * MAX_PULL, y: ((t.y - main.y) / d) * MAX_PULL };
    }
    if (!shoot(s, pull)) break;
    let n = 0;
    do step(s, SIM_DT);
    while ((s.phase as string) !== 'aim' && (s.phase as string) !== 'over' && n++ < 240 * 60);
    for (const t of s.targets) if (!t.dead) seen.add(t.kind);
    maxWarden = Math.max(maxWarden, s.targets.filter((t) => t.kind === 'warden' && !t.dead).length);
    maxHive = Math.max(maxHive, s.targets.filter((t) => t.kind === 'hive' && !t.dead).length);
  }
  return { s, seen, maxWarden, maxHive, over: s.phase === 'over' };
}

/** Drive bare enemy phases, killing one live regular per phase so the pool keeps rolling. */
function phaseRun(enemyCount: number, seed: number, phases = 30) {
  const s = createRun('felt', { ...BASE_STATS, enemyCount }, seed);
  const seen = new Set<TargetKind>();
  let maxWarden = 0;
  let maxHive = 0;
  for (const t of s.targets) seen.add(t.kind);
  const initial = new Set(seen);
  for (let i = 0; i < phases; i++) {
    const victim = s.targets.find((t) => !t.dead && t.kind !== 'warden' && t.kind !== 'hive' && t.kind !== 'spore');
    if (victim) victim.dead = true;
    phase(s);
    for (const t of s.targets) if (!t.dead) seen.add(t.kind);
    maxWarden = Math.max(maxWarden, s.targets.filter((t) => t.kind === 'warden' && !t.dead).length);
    maxHive = Math.max(maxHive, s.targets.filter((t) => t.kind === 'hive' && !t.dead).length);
  }
  return { seen, initial, maxWarden, maxHive };
}

describe('active tier: gating and determinism', () => {
  it('felt enemyCount 3: no actives in 100 seeds x 30 phases', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = phaseRun(3, seed);
      for (const k of ['warden', 'hive', 'spore', 'frost'] as const) expect(r.seen.has(k)).toBe(false);
    }
  });

  it('felt enemyCount 6: warden and hive appear (never on the opening board), warden <= 2, hive <= 1', () => {
    let warden = 0;
    let hive = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = phaseRun(6, seed);
      expect(r.initial.has('warden') || r.initial.has('hive')).toBe(false);
      if (r.seen.has('warden')) warden++;
      if (r.seen.has('hive')) hive++;
      expect(r.maxWarden).toBeLessThanOrEqual(2);
      expect(r.maxHive).toBeLessThanOrEqual(1);
      expect(r.seen.has('frost')).toBe(false);
    }
    expect(warden).toBeGreaterThan(0);
    expect(hive).toBeGreaterThan(0);
  });

  it('smoke runs with actives are seed-identical and terminate', () => {
    for (const [stage, ec] of [
      ['felt', 6],
      ['ice', 6],
    ] as const) {
      let actives = 0;
      for (const seed of [3, 17, 29, 101]) {
        const a = botRun(stage, ec, seed);
        const b = botRun(stage, ec, seed);
        expect(a.over).toBe(true);
        expect({ t: a.s.targets, e: a.s.energy, c: a.s.cash, r: a.s.result }).toEqual({ t: b.s.targets, e: b.s.energy, c: b.s.cash, r: b.s.result });
        for (const k of a.seen) if (k === 'warden' || k === 'hive' || k === 'frost') actives++;
        expect(a.maxWarden).toBeLessThanOrEqual(2);
        expect(a.maxHive).toBeLessThanOrEqual(1);
      }
      expect(actives).toBeGreaterThan(0);
    }
  });
});
