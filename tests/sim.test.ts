import { describe, expect, it } from 'vitest';
import { CURVE_CAP, FAST_FORWARD_MULT, MAX_PULL, SIM_DT, type Ball, type FxEvent, type RunState, type Vec } from '../src/core/types';
import { BASE_STATS, BOARD_CLEAR_REFILL } from '../src/core/tuning';
import { canFastForward, createRun, previewShot, refill, shoot, step } from '../src/sim/index';
import { makeTarget } from '../src/sim/spawn';

const SHOTS: Vec[] = [
  { x: 0, y: 60 },
  { x: 20, y: 50 },
  { x: -35, y: 40 },
  { x: 10, y: -60 },
  { x: -50, y: 10 },
  { x: 40, y: 40 },
];

function untilSettled(s: RunState, dt = SIM_DT, max = 240 * 60): FxEvent[] {
  const all: FxEvent[] = [];
  let n = 0;
  do all.push(...step(s, dt));
  while (s.phase !== 'aim' && s.phase !== 'over' && n++ < max);
  return all;
}

function play(seed: number, dt = SIM_DT) {
  const s = createRun('felt', BASE_STATS, seed);
  for (const p of SHOTS) {
    if (s.phase !== 'aim') break;
    shoot(s, p);
    untilSettled(s, dt);
  }
  return s;
}

function snapshot(s: RunState) {
  return { balls: s.balls, targets: s.targets, energy: s.energy, cash: s.cash, t: s.t, phase: s.phase, refilled: s.refilled };
}

/** A clean resolve-phase state with one target in front of the resting main ball and no other targets. */
function lab(): { s: RunState; main: Ball } {
  const s = createRun('felt', { ...BASE_STATS }, 42);
  s.targets = [];
  s.obstacles = [];
  const main = s.balls[0];
  s.targets.push(makeTarget(s, 'armored', 90, 100, 0));
  s.phase = 'resolve';
  return { s, main };
}

function extraBall(s: RunState, kind: 'split' | 'spat', x: number, y: number, vy: number): Ball {
  const b: Ball = { id: s.nextId++, kind, x, y, vx: 0, vy, r: kind === 'split' ? 2.5 : 2, mass: 0.5, life: kind === 'spat' ? 3 : Infinity, resting: false, banked: false };
  s.balls.push(b);
  return b;
}

describe('sim determinism', () => {
  it('same seed + same shots => identical state', () => {
    expect(snapshot(play(7))).toEqual(snapshot(play(7)));
    expect(snapshot(play(123))).toEqual(snapshot(play(123)));
  });
  it('fast-forward stepping (dt multiples) matches single steps', () => {
    // Only idle 'aim' time can differ (a coarse step overshoots into aim); the physics is bit-identical.
    const { t: _a, ...ff } = snapshot(play(9, SIM_DT * FAST_FORWARD_MULT));
    const { t: _b, ...normal } = snapshot(play(9));
    expect(ff).toEqual(normal);
  });
  it('different seeds lay out different boards', () => {
    const a = createRun('felt', BASE_STATS, 1);
    const b = createRun('felt', BASE_STATS, 2);
    expect(a.targets.map((t) => t.x)).not.toEqual(b.targets.map((t) => t.x));
  });
});

describe('shooting', () => {
  it('cancel (drag < CANCEL_RADIUS) costs nothing and stays in aim', () => {
    const s = createRun('felt', BASE_STATS, 1);
    expect(shoot(s, { x: 3, y: 2 })).toBe(false);
    expect(s.energy).toBe(BASE_STATS.maxEnergy);
    expect(s.phase).toBe('aim');
    expect(s.shots).toBe(0);
  });
  it('release pays the flat release cost regardless of power', () => {
    const s = createRun('felt', BASE_STATS, 1);
    expect(shoot(s, { x: 0, y: 20 })).toBe(true);
    expect(s.energy).toBe(BASE_STATS.maxEnergy - BASE_STATS.releaseCost);
    expect(s.phase).toBe('resolve');
    expect(shoot(s, { x: 0, y: MAX_PULL })).toBe(false); // no shooting while balls move
    const fx = step(s, SIM_DT);
    expect(fx.some((f) => f.t === 'shoot')).toBe(true);
  });
  it('previewShot is empty without the upgrade and a polyline with it', () => {
    const s = createRun('felt', BASE_STATS, 1);
    expect(previewShot(s, { x: 0, y: 40 })).toEqual([]);
    s.stats.aimPreview = 2;
    s.targets = [];
    const pts = previewShot(s, { x: 30, y: 40 });
    expect(pts.length).toBe(4); // start + 2 bounces + end
  });
});

describe('energy', () => {
  it('main-ball hit costs hitCost + drain', () => {
    const { s, main } = lab();
    main.x = 90;
    main.y = 130;
    main.vy = -200;
    main.resting = false;
    const e0 = s.energy;
    for (let i = 0; i < 40; i++) step(s, SIM_DT);
    expect(s.targets[0].hp).toBeLessThan(s.targets[0].maxHp);
    expect(e0 - s.energy).toBe(BASE_STATS.hitCost + 2);
  });
  it('split and spat hits cost no energy but deal damage', () => {
    for (const kind of ['split', 'spat'] as const) {
      const { s } = lab();
      extraBall(s, kind, 90, 130, -300);
      const e0 = s.energy;
      for (let i = 0; i < 40; i++) step(s, SIM_DT);
      expect(s.targets[0].hp).toBe(s.targets[0].maxHp - BASE_STATS.damage);
      expect(s.energy).toBe(e0);
    }
  });
  it('fast balls do not tunnel through the smallest target', () => {
    const { s } = lab();
    s.targets = [makeTarget(s, 'mini', 90, 100, 0)];
    extraBall(s, 'spat', 90, 200, -600);
    for (let i = 0; i < 120; i++) step(s, SIM_DT);
    expect(s.targets[0].dead || s.targets.length === 0 || s.kills === 1).toBe(true);
  });
  it('shared refill curve caps total refills at CURVE_CAP * maxEnergy', () => {
    const s = createRun('felt', BASE_STATS, 1);
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      s.energy = 0;
      total += refill(s, 25);
    }
    expect(total).toBeLessThanOrEqual(CURVE_CAP * BASE_STATS.maxEnergy + 1e-9);
    expect(total).toBeGreaterThan(CURVE_CAP * BASE_STATS.maxEnergy * 0.95);
    expect(s.refilled).toBeCloseTo(total, 9);
    // Each refill is worth less than the last.
    const t = createRun('felt', BASE_STATS, 1);
    t.energy = 0;
    const a = refill(t, 10);
    const b = refill(t, 10);
    expect(b).toBeLessThan(a);
  });
});

describe('turn machine', () => {
  it("ends 'over' once energy < releaseCost and every ball has stopped; runOver emitted once", () => {
    const s = createRun('felt', BASE_STATS, 3);
    s.energy = BASE_STATS.releaseCost;
    expect(shoot(s, { x: 0, y: MAX_PULL })).toBe(true);
    const fx = untilSettled(s);
    expect(s.phase).toBe('over');
    expect(s.balls.every((b) => b.resting)).toBe(true);
    expect(fx.filter((f) => f.t === 'runOver').length).toBe(1);
    expect(s.result).toBeDefined();
    expect(s.result!.shots).toBe(1);
    expect(step(s, SIM_DT)).toEqual([]);
  });
  it('energy can hit 0 mid-roll and the machine keeps running', () => {
    const { s, main } = lab();
    s.energy = 1;
    main.x = 90;
    main.y = 130;
    main.vy = -300;
    main.resting = false;
    for (let i = 0; i < 40; i++) step(s, SIM_DT);
    expect(s.energy).toBe(0);
    untilSettled(s);
    expect(s.phase).toBe('over');
  });
  it('boss spawns only in the enemy phase', () => {
    const s = createRun('felt', BASE_STATS, 5);
    shoot(s, { x: 0, y: MAX_PULL });
    s.bossPending = true;
    while (s.phase === 'resolve') {
      step(s, SIM_DT);
      if (s.phase === 'resolve') expect(s.targets.some((t) => t.kind === 'boss')).toBe(false);
    }
    expect(s.phase).toBe('enemy');
    expect(s.targets.some((t) => t.kind === 'boss' && !t.dead)).toBe(true);
    expect(s.bossSpawned).toBe(true);
    expect(s.bossPending).toBe(false);
  });
  it('canFastForward only when the main ball rests and an extra ball moves', () => {
    const { s, main } = lab();
    expect(canFastForward(s)).toBe(false);
    extraBall(s, 'spat', 30, 200, -100);
    expect(main.resting).toBe(true);
    expect(canFastForward(s)).toBe(true);
  });
});

describe('fully upgraded smoke run', () => {
  const STRONG = {
    ...BASE_STATS,
    damage: 3,
    speedDamage: 1,
    maxEnergy: 160,
    killRefillChance: 0.3,
    killRefillAmount: 4,
    bossRefillPct: 0.3,
    enemyCount: 8,
    respawnPerTurn: 2,
    aimPreview: 2,
    lightningChance: 0.4,
    lightningArcs: 2,
    lightningRange: 40,
    lightningDamage: 1,
    splitCount: 2,
    spitInterval: 0.3,
    spitLife: 2,
    spitDamage: 1,
    comboMultiKill: 0.25,
    comboBank: 0.5,
    comboBumperChain: 0.25,
    comboChainReaction: 0.5,
    comboEnergy: 2,
    bumpers: 3,
    crates: 2,
    chests: 1,
    shrineChance: 1,
    strayEmeraldChance: 0.05,
  };
  for (const stage of ['felt', 'ice'] as const) {
    it(`${stage}: terminates with sane state and reaches the boss`, () => {
      let bosses = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = createRun(stage, STRONG, seed);
        const seen = new Set<string>();
        for (let shot = 0; shot < 200 && s.phase !== 'over'; shot++) {
          const main = s.balls.find((b) => b.kind === 'main')!;
          const t = s.targets.find((x) => !x.dead && x.kind !== 'cadre') ?? s.targets[0];
          const d = t ? Math.hypot(t.x - main.x, t.y - main.y) || 1 : 1;
          const pull = t ? { x: ((t.x - main.x) / d) * MAX_PULL, y: ((t.y - main.y) / d) * MAX_PULL } : { x: 0, y: -MAX_PULL };
          expect(shoot(s, pull)).toBe(true);
          for (const f of untilSettled(s)) seen.add(f.t);
          for (const b of s.balls) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
          expect(s.energy).toBeGreaterThanOrEqual(0);
          expect(s.energy).toBeLessThanOrEqual(STRONG.maxEnergy);
          expect(s.refilled).toBeLessThanOrEqual(STRONG.maxEnergy + 1e-9);
        }
        expect(s.phase).toBe('over');
        expect(s.result!.seconds).toBe(s.t);
        if (s.bossSpawned) bosses++;
        expect(seen.has('split')).toBe(true);
        expect(seen.has('spit')).toBe(true);
      }
      expect(bosses).toBeGreaterThan(0);
    });
  }
});

describe('design review rules', () => {
  it('boss arrival refill applies before the run-over check (no anticlimax)', () => {
    const s = createRun('felt', BASE_STATS, 5);
    expect(shoot(s, { x: 0, y: MAX_PULL })).toBe(true);
    s.energy = 0;
    s.bossPending = true;
    untilSettled(s);
    expect(s.bossSpawned).toBe(true);
    expect(s.phase).toBe('aim');
    expect(s.energy).toBeCloseTo(0.25 * BASE_STATS.maxEnergy, 6);
  });
  it('empty board refills immediately in the enemy phase', () => {
    const s = createRun('felt', { ...BASE_STATS, respawnPerTurn: 0 }, 8);
    s.targets = [];
    s.obstacles = [];
    shoot(s, { x: 0, y: -20 });
    untilSettled(s);
    expect(s.targets.filter((t) => !t.dead).length).toBe(2);
  });
  it('killing the last regular target emits boardClear once and refills via the curve', () => {
    const { s, main } = lab();
    s.targets = [makeTarget(s, 'mini', 90, 100, 0)];
    s.energy = 50;
    main.x = 90;
    main.y = 130;
    main.vy = -200;
    main.resting = false;
    const fx: FxEvent[] = [];
    for (let i = 0; i < 40; i++) fx.push(...step(s, SIM_DT));
    expect(fx.filter((f) => f.t === 'boardClear').length).toBe(1);
    expect(s.refilled).toBeCloseTo(BOARD_CLEAR_REFILL, 6);
    expect(s.energy).toBe(50 - BASE_STATS.hitCost + BOARD_CLEAR_REFILL);
  });
  it('shielded boss costs only hitCost; drain phase surcharges boss hits only', () => {
    const hit = (kind: 'boss' | 'basic', shielded: boolean, phase: number) => {
      const { s, main } = lab();
      const t = makeTarget(s, kind, 90, 100, 0);
      t.shielded = shielded;
      t.phase = phase;
      s.targets = [t];
      if (kind === 'basic') {
        const boss = makeTarget(s, 'boss', 30, 50, 0);
        boss.phase = phase;
        s.targets.push(boss);
      }
      main.x = 90;
      main.y = 130;
      main.vy = -200;
      main.resting = false;
      const e0 = s.energy;
      for (let i = 0; i < 40; i++) step(s, SIM_DT);
      return e0 - s.energy;
    };
    const h = BASE_STATS.hitCost;
    expect(hit('boss', true, 1)).toBe(h);
    expect(hit('boss', false, 0)).toBe(h + 1);
    expect(hit('boss', false, 1)).toBe(h + 2); // felt phase 1 = drain
    expect(hit('basic', false, 1)).toBe(h);
  });
  it('sticky ball holds 0.25 s, releases at 60% reflected speed and hits again for free', () => {
    const { s, main } = lab();
    s.stats.ballType = 'sticky';
    const t = s.targets[0];
    main.x = 90;
    main.y = 130;
    main.vy = -200;
    main.resting = false;
    let fx: FxEvent[] = [];
    let n = 0;
    while (!main.stuck && n++ < 100) fx = step(s, SIM_DT);
    expect(main.stuck).toBeGreaterThan(0);
    const hp1 = t.hp;
    const e1 = s.energy;
    expect(hp1).toBe(t.maxHp - BASE_STATS.damage);
    const held = { x: main.x, y: main.y };
    const holdSteps = Math.round(0.25 / SIM_DT);
    for (let i = 0; i < holdSteps - 2; i++) step(s, SIM_DT);
    expect(main.x).toBe(held.x);
    expect(main.y).toBe(held.y);
    expect(main.resting).toBe(false);
    for (let i = 0; i < 4; i++) fx.push(...step(s, SIM_DT));
    expect(main.stuck).toBeFalsy();
    expect(t.hp).toBe(hp1 - BASE_STATS.damage);
    expect(s.energy).toBe(e1);
    expect(main.vy).toBeGreaterThan(0); // reflected away from the target
    expect(Math.hypot(main.vx, main.vy)).toBeGreaterThan(0.6 * 200 * 0.85);
    expect(Math.hypot(main.vx, main.vy)).toBeLessThanOrEqual(0.6 * 200 + 1e-6);
    untilSettled(s);
    expect(['aim', 'over']).toContain(s.phase);
  });
  it('sticky runs stay deterministic and terminate', () => {
    const run = () => {
      const s = createRun('felt', { ...BASE_STATS, ballType: 'sticky' }, 77);
      for (const p of SHOTS) {
        if (s.phase !== 'aim') break;
        shoot(s, p);
        untilSettled(s);
      }
      return snapshot(s);
    };
    expect(run()).toEqual(run());
  });
  it('full-power shots settle in under 4 s on felt and ice (empty table)', () => {
    for (const stage of ['felt', 'ice'] as const) {
      for (const p of [{ x: 0, y: -MAX_PULL }, { x: MAX_PULL, y: 0 }, { x: 20, y: -MAX_PULL }]) {
        const s = createRun(stage, BASE_STATS, 1);
        s.targets = [];
        s.obstacles = [];
        shoot(s, p);
        let t = 0;
        while (s.phase === 'resolve') {
          step(s, SIM_DT);
          t += SIM_DT;
        }
        expect(t).toBeLessThan(4);
      }
    }
  });
});
