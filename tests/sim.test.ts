import { describe, expect, it } from 'vitest';
import { FAST_FORWARD_MULT, MAX_LAUNCH_SPEED, MAX_PULL, MIN_POWER, SIM_DT, TABLE, type FxEvent, type RunState, type TargetKind, type Vec } from '../src/core/types';
import { ATK_GROWTH, BASE_STATS, CASH_GROWTH, HARDY_MOD_HP, HP_GROWTH, RANGED_PHASE_CAP, SLOT_ATK_MULT, SLOT_HP_MULT, SPAWN_ZONE, TARGET_DEFS, WAVE_CASH, stageById, MITOSIS_KIDS } from '../src/core/tuning';
import { WORLDS, allStageIds, globalIndex, idFromIndex, makeStage, nextStageId, parseStageId, stageId } from '../src/core/worlds';
import { rollIntent as rollIntentForTest } from '../src/sim/intents';
import type { Modifier, TargetKind as TK } from '../src/core/types';
import { Rng } from '../src/core/rng';

const SPAWN_ZONE_Y = TABLE.y + TABLE.h - SPAWN_ZONE;
import { canFastForward, createRun, heal, intentVisible, previewShot, shoot, step, useTrick } from '../src/sim/index';
import type { RunStats } from '../src/core/types';
import { BREAK_SPEED_MULT, THIN_RAILS_BOUNCE } from '../src/core/tuning';
import { makeEnemy, placeFormation } from '../src/sim/spawn';
import { maxOverlap } from '../src/sim/physics';
import { rageLevel } from '../src/sim/enemy';
import { buildResult, hasCorridor, jamRule } from '../src/sim/run';
import { endLootShot, goblinHit, scurryDest, startLoot } from '../src/sim/loot';
import { kill, updateBossShield } from '../src/sim/damage';

const SHOTS: Vec[] = [
  { x: 0, y: -60 },
  { x: 20, y: -50 },
  { x: -35, y: -40 },
  { x: 10, y: 60 },
  { x: -50, y: -10 },
  { x: 40, y: -40 },
];

function untilSettled(s: RunState, dt = SIM_DT, max = 240 * 60): FxEvent[] {
  const all: FxEvent[] = [];
  let n = 0;
  do all.push(...step(s, dt));
  while (s.phase !== 'aim' && s.phase !== 'over' && n++ < max);
  return all;
}

function play(seed: number, dt = SIM_DT) {
  const s = createRun('w1s1', BASE_STATS, seed);
  for (const p of SHOTS) {
    if (s.phase !== 'aim') break;
    shoot(s, p);
    untilSettled(s, dt);
  }
  return s;
}

/** Sim state minus render-only timers (flash/shimmer tick during idle aim, so a coarse step overshoots them). */
function snapshot(s: RunState) {
  const targets = s.targets.map(({ flash: _f, shimmer: _s, ...rest }) => rest);
  return { balls: s.balls, targets, hp: s.hp, cash: s.cash, t: s.t, phase: s.phase, wave: s.wave };
}

/** Empty table with the hero at (x,y), resting. */
function lab(x = 90, y = 240): RunState {
  const s = createRun('w1s1', { ...BASE_STATS }, 42);
  s.targets = [];
  s.obstacles = [];
  s.balls[0].x = x;
  s.balls[0].y = y;
  return s;
}

function put(s: RunState, kind: TargetKind, x: number, y: number) {
  const e = makeEnemy(s, kind, x, y);
  s.targets.push(e);
  return e;
}

/** Run one enemy phase directly from aim (no hero shot). */
function enemyPhaseOnly(s: RunState): FxEvent[] {
  // A zero-length resolve: shoot then immediately stop the hero, so the machine runs resolve -> enemy -> aim.
  shoot(s, { x: 0, y: 20 });
  s.balls[0].vx = 0;
  s.balls[0].vy = 0;
  s.balls[0].resting = true;
  return untilSettled(s);
}

describe('sim determinism', () => {
  it('same seed + same shots => identical state', () => {
    expect(snapshot(play(7))).toEqual(snapshot(play(7)));
    expect(snapshot(play(123))).toEqual(snapshot(play(123)));
  });
  it('fast-forward stepping (dt multiples) matches single steps', () => {
    const { t: _a, ...ff } = snapshot(play(9, SIM_DT * FAST_FORWARD_MULT));
    const { t: _b, ...normal } = snapshot(play(9));
    expect(ff).toEqual(normal);
  });
  it('different seeds lay out different boards', () => {
    const a = createRun('w1s1', BASE_STATS, 1);
    const b = createRun('w1s1', BASE_STATS, 2);
    expect(a.targets.map((t) => t.x)).not.toEqual(b.targets.map((t) => t.x));
  });
});

describe('shooting', () => {
  it('cancel (drag < CANCEL_RADIUS) stays in aim', () => {
    const s = createRun('w1s1', BASE_STATS, 1);
    expect(shoot(s, { x: 3, y: 2 })).toBe(false);
    expect(s.phase).toBe('aim');
    expect(s.shots).toBe(0);
  });
  it('shots are free and fire at >= MIN_POWER', () => {
    const s = createRun('w1s1', BASE_STATS, 1);
    expect(shoot(s, { x: 0, y: -13 })).toBe(true);
    const b = s.balls[0];
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(MIN_POWER * MAX_LAUNCH_SPEED, 6);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(shoot(s, { x: 0, y: MAX_PULL })).toBe(false); // no shooting while balls move
    expect(step(s, SIM_DT).some((f) => f.t === 'shoot')).toBe(true);
  });
  it('previewShot is empty without the upgrade and a polyline with it', () => {
    const s = createRun('w1s1', BASE_STATS, 1);
    expect(previewShot(s, { x: 0, y: -40 })).toEqual([]);
    s.stats.aimPreview = 2;
    s.targets = [];
    expect(previewShot(s, { x: 30, y: -40 }).length).toBe(4);
  });
});

describe('physics', () => {
  it('hero contact deals flat damage once per enemy per contact (no machine-gun while overlapping)', () => {
    const s = lab(90, 200);
    const brute = put(s, 'brute', 90, 120);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilSettled(s);
    expect(brute.maxHp - brute.hp).toBe(1);
    expect(s.combo.hits).toBe(1);
  });
  it('an enemy knocked into another bumps it: 1 damage, counts in the chain', () => {
    const s = lab(90, 230);
    const a = put(s, 'grunt', 90, 170);
    const b = put(s, 'grunt', 90, 140);
    shoot(s, { x: 0, y: -MAX_PULL });
    // stop before the enemy phase so intents don't interfere
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(a.hp).toBe(a.maxHp - 1);
    expect(b.hp).toBe(b.maxHp - 1);
    expect(s.combo.hits).toBe(2);
  });
  it('heavier enemies are knocked slower; near-equal masses break (hero nearly stops); nothing overlaps at rest', () => {
    const knock = (kind: TargetKind) => {
      const s = lab(90, 230);
      const e = put(s, kind, 90, 150);
      shoot(s, { x: 0, y: -MAX_PULL });
      while (s.combo.hits === 0) step(s, SIM_DT);
      const out = { enemy: Math.hypot(e.vx, e.vy), hero: Math.hypot(s.balls[0].vx, s.balls[0].vy) };
      while (s.phase === 'resolve') step(s, SIM_DT);
      expect(maxOverlap(s)).toBeLessThan(0.5);
      return out;
    };
    const g = knock('grunt');
    expect(knock('brute').enemy).toBeLessThan(g.enemy);
    expect(g.enemy).toBeGreaterThan(300);
    expect(g.hero).toBeLessThan(60);
  });
  it('thornback pricks the hero on contact', () => {
    const s = lab(90, 230);
    put(s, 'thornback', 90, 150);
    shoot(s, { x: 0, y: -MAX_PULL });
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(s.hp).toBe(BASE_STATS.maxHp - 1);
  });
});

describe('enemy phase', () => {
  it('Attack within reach charges and deals N on first contact', () => {
    const s = lab(90, 240);
    const g = put(s, 'grunt', 90, 170); // gap 46 < reach 90
    g.intent = { t: 'attack', n: 2 };
    const fx = enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - 2);
    expect(fx.filter((f) => f.t === 'heroHit').length).toBe(1);
  });
  it('a blocked charge deals nothing to the hero and bumps the cover', () => {
    const s = lab(90, 250);
    const g = put(s, 'grunt', 90, 160);
    g.intent = { t: 'attack', n: 2 };
    const cover = put(s, 'brute', 90, 205);
    cover.intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(cover.hp).toBe(cover.maxHp - 1);
  });
  it('Attack beyond reach executes as Advance (soft roll that stops short of the hero)', () => {
    const s = lab(90, 270);
    const g = put(s, 'grunt', 90, 60);
    g.intent = { t: 'attack', n: 2 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(g.y - 60).toBeGreaterThan(50);
    expect(g.y - 60).toBeLessThan(70);
  });
  it('staggered enemies skip and keep their intent; stagger clears after the phase', () => {
    const s = lab(90, 240);
    const g = put(s, 'grunt', 90, 170);
    g.intent = { t: 'attack', n: 2 };
    g.stagger = TARGET_DEFS.grunt.staggerAt;
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(g.intent).toEqual({ t: 'attack', n: 2 });
    expect(g.stagger).toBe(0);
  });
  it('Shoot is instant; armor reduces damage to a minimum of 1', () => {
    const s = lab(90, 240);
    s.stats.armor = 3;
    const k = put(s, 'skirmisher', 90, 60);
    k.intent = { t: 'shoot', n: 1 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - 1);
  });
  it('bomber Detonate: 4 to the hero within 60 px, 3 to nearby enemies; it dies without paying', () => {
    const s = lab(90, 240);
    const b = put(s, 'bomber', 90, 190);
    b.intent = { t: 'detonate' };
    const g = put(s, 'grunt', 125, 190);
    g.intent = { t: 'rest' };
    put(s, 'grunt', 30, 60).intent = { t: 'rest' }; // keeps the wave alive (no wave-clear heal)
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - 4);
    expect(g.dead).toBe(true);
    expect(s.targets.includes(b)).toBe(false);
  });
  it('enemy-phase duration stays under the 4 s stall guard', () => {
    const s = lab(90, 240);
    for (const [k, x, y] of [['grunt', 40, 150], ['bouncer', 90, 120], ['brute', 140, 150]] as const) {
      const e = put(s, k, x, y);
      e.intent = k === 'brute' ? { t: 'attack', n: 5 } : { t: 'attack', n: 1 };
    }
    const t0 = s.t;
    enemyPhaseOnly(s);
    expect(s.t - t0).toBeLessThanOrEqual(4.01);
    expect(maxOverlap(s)).toBeLessThan(0.5);
  });
  it('enrage: +1 per turn from turn 8 + 2 x wave', () => {
    const s = lab();
    s.wave = 1;
    s.waveTurn = 8; // phase number 9
    expect(rageLevel(s)).toBe(0);
    s.waveTurn = 9; // turn 10
    expect(rageLevel(s)).toBe(1);
    s.waveTurn = 11;
    expect(rageLevel(s)).toBe(3);
  });
});

describe('waves, health, run end', () => {
  it('clearing a wave spawns the next in the following enemy phase with 8 x wave cash', () => {
    const s = createRun('w1s1', BASE_STATS, 3);
    for (const t of s.targets) t.dead = true;
    const fx = enemyPhaseOnly(s);
    expect(s.wave).toBe(2);
    expect(s.cash).toBe(WAVE_CASH * 1);
    expect(fx.some((f) => f.t === 'waveStart')).toBe(true);
    expect(s.targets.filter((t) => !t.dead).length).toBeGreaterThanOrEqual(4);
  });
  it('heals share one diminishing curve capped at 1x max HP per run', () => {
    const s = lab();
    s.hp = 1;
    let total = 0;
    for (let i = 0; i < 500; i++) total += heal(s, 5);
    expect(total).toBeLessThanOrEqual(s.maxHp + 1e-9);
    expect(s.hp).toBeLessThanOrEqual(s.maxHp);
  });
  it("death is checked after the enemy phase; runOver once; 'over' is terminal", () => {
    const s = lab(90, 240);
    s.hp = 2;
    const g = put(s, 'grunt', 90, 170);
    g.intent = { t: 'attack', n: 5 };
    const fx = enemyPhaseOnly(s);
    expect(s.phase).toBe('over');
    expect(fx.filter((f) => f.t === 'runOver').length).toBe(1);
    expect(s.result?.wave).toBe(1);
    expect(step(s, SIM_DT).length).toBe(0);
  });
  it('canFastForward only while the hero rests and something else moves', () => {
    const s = lab();
    expect(canFastForward(s)).toBe(false);
    const g = put(s, 'grunt', 90, 100);
    shoot(s, { x: 0, y: 40 });
    s.balls[0].resting = true;
    g.resting = false;
    g.vx = 50;
    expect(canFastForward(s)).toBe(true);
  });
});

describe('formations and the jam rule', () => {
  it('every formation places every enemy above the spawn zone with no overlaps (40 seeds each)', () => {
    const kinds: TargetKind[] = ['grunt', 'skirmisher', 'bomber', 'broodmother', 'brute'];
    for (const f of ['rack', 'wall', 'pincer', 'ring', 'scatter'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = lab();
        s.rng = new Rng(seed);
        const slots = placeFormation(s, kinds, f);
        expect(slots.length, f).toBe(kinds.length);
        for (let i = 0; i < slots.length; i++) {
          const a = slots[i];
          expect(a.y + a.r, f).toBeLessThanOrEqual(SPAWN_ZONE_Y + 1e-6);
          expect(a.x - a.r).toBeGreaterThanOrEqual(TABLE.x);
          expect(a.x + a.r).toBeLessThanOrEqual(TABLE.x + TABLE.w);
          for (let j = i + 1; j < slots.length; j++) {
            const b = slots[j];
            expect(Math.hypot(a.x - b.x, a.y - b.y), f).toBeGreaterThanOrEqual(a.r + b.r);
          }
        }
      }
    }
  });
  it('does not fire at run start; nudges a boxed-in hero to an open spot', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createRun('w1s1', BASE_STATS, seed);
      expect(hasCorridor(s, s.balls[0].x, s.balls[0].y)).toBe(true);
    }
    const s = lab(90, 150);
    const ring = 6;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      put(s, 'grunt', 90 + Math.cos(a) * 25, 150 + Math.sin(a) * 25);
    }
    expect(hasCorridor(s, 90, 150)).toBe(false);
    expect(jamRule(s, [])).toBe(true);
    expect(s.jams).toBe(1);
    expect(hasCorridor(s, s.balls[0].x, s.balls[0].y)).toBe(true);
  });
});

describe('step 2: frost, cadre, thorns, stats, combos', () => {
  it('frost freezes the nearest ally; frozen ignores soft hits and skips its intent; fast hits shatter', () => {
    const s = lab(90, 250);
    const f = put(s, 'frost', 60, 80);
    f.intent = { t: 'guard' };
    const g = put(s, 'grunt', 95, 80);
    g.intent = { t: 'rest' };
    put(s, 'grunt', 150, 60).intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(g.frozen).toBeGreaterThan(0);
    const calm = () => s.targets.forEach((t) => (t.intent = { t: 'rest' }));
    // Soft hit: no damage, no stagger.
    calm();
    s.balls[0].x = 95;
    s.balls[0].y = 130;
    shoot(s, { x: 0, y: -15 }); // 25 % power = 120 px/s < shatter
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(g.hp).toBe(g.maxHp);
    expect(g.dead).toBe(false);
    while (s.phase !== 'aim') step(s, SIM_DT);
    // Hard hit (>= SHATTER_SPEED): shatter = thaw + 2x the hit's damage, not an instant kill.
    calm();
    s.balls[0].x = 95;
    s.balls[0].y = 200;
    const hp0 = g.hp;
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    while ((s.phase as string) === 'resolve') fx.push(...step(s, SIM_DT));
    expect(fx.some((e) => e.t === 'shatter')).toBe(true);
    expect(g.frozen ?? 0).toBe(0);
    expect(hp0 - g.hp).toBeGreaterThanOrEqual(2 * s.stats.damage);
    expect(hp0).toBeGreaterThan(2 * s.stats.damage); // not one-shot by the shatter
    expect(g.dead).toBe(false);
  });
  it('a frozen enemy skips its intent', () => {
    const s = lab(90, 240);
    const g = put(s, 'grunt', 90, 170);
    g.intent = { t: 'attack', n: 3 };
    g.frozen = 2;
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
  });
  it('Rime Golem arrives with a cadre; it takes no damage until the cadre is dead', () => {
    const s = createRun('w2s1', BASE_STATS, 5);
    s.targets = [];
    s.wave = 3;
    s.wavePending = true;
    enemyPhaseOnly(s);
    const boss = s.targets.find((t) => t.kind === 'boss')!;
    expect(s.targets.filter((t) => t.kind === 'cadre').length).toBe(3);
    expect(boss.shielded).toBe(true);
    for (const c of s.targets.filter((t) => t.kind === 'cadre')) c.dead = true;
    s.targets = s.targets.filter((t) => !t.dead);
    updateBossShield(s);
    expect(boss.shielded).toBe(false);
  });
  it('thorns prick when the hero is knocked into a thornback during the enemy phase', () => {
    const s = lab(90, 200);
    const g = put(s, 'grunt', 90, 250);
    g.intent = { t: 'attack', n: 1 };
    const tb = put(s, 'thornback', 90, 160);
    tb.intent = { t: 'rest' };
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'heroHit' && f.how === 'thorns').length).toBe(1);
    expect(s.hp).toBe(BASE_STATS.maxHp - 2);
  });
  it('rangedResist reduces Shoot (min 1); healOnKill heals via the curve; heavyHits staggers 2', () => {
    const s = lab(90, 240);
    s.stats.rangedResist = 1;
    s.hp = 10;
    const k = put(s, 'skirmisher', 90, 60);
    k.intent = { t: 'shoot', n: 2 };
    put(s, 'grunt', 30, 60).intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(9);
    const s2 = lab(90, 230);
    s2.stats.heavyHits = 1;
    s2.stats.healOnKill = 2;
    s2.stats.damage = 3;
    s2.hp = 10;
    const b = put(s2, 'brute', 90, 150);
    shoot(s2, { x: 0, y: -MAX_PULL });
    while (s2.combo.hits === 0) step(s2, SIM_DT);
    expect(b.stagger).toBe(2);
    while (s2.phase === 'resolve') step(s2, SIM_DT);
    const s3 = lab(90, 230);
    s3.stats.healOnKill = 2;
    s3.stats.damage = 5;
    s3.hp = 10;
    put(s3, 'grunt', 90, 170);
    put(s3, 'grunt', 30, 60);
    shoot(s3, { x: 0, y: -MAX_PULL });
    while (s3.phase === 'resolve') step(s3, SIM_DT);
    expect(s3.hp).toBeCloseTo(10 + 2 * (1 - 0), 6);
  });
  it('reflex skips the first enemy phase of a wave', () => {
    const s = lab(90, 240);
    s.stats.reflex = 1;
    s.waveTurn = 0;
    const g = put(s, 'grunt', 90, 170);
    g.intent = { t: 'attack', n: 3 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    g.intent = { t: 'attack', n: 3 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - 3);
  });
  it('a killed enemy keeps rolling as a ghost and still bumps its neighbour (cascade survives the kill)', () => {
    const s = lab(90, 230);
    s.stats.damage = 5;
    s.stats.comboCascade = 1;
    put(s, 'grunt', 90, 170);
    const b = put(s, 'grunt', 90, 140);
    const c = put(s, 'grunt', 30, 140);
    shoot(s, { x: 0, y: -MAX_PULL });
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(b.hp).toBe(b.maxHp - 1);
    expect(s.combo.bumps).toBe(1);
    expect(c.hp).toBe(c.maxHp);
  });
  it('Sweep pays when a wave is cleared within one shot; Lockdown heals when every enemy is staggered', () => {
    const s = lab(90, 230);
    s.stats.comboSweep = 50;
    s.stats.damage = 5;
    put(s, 'grunt', 90, 170);
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    while (s.phase !== 'aim' && s.phase !== 'over') fx.push(...step(s, SIM_DT));
    expect(fx.some((f) => f.t === 'combo' && f.name === 'SWEEP')).toBe(true);
    const s2 = lab(90, 230);
    s2.stats.comboLockdown = 2;
    s2.hp = 10;
    put(s2, 'skirmisher', 90, 170); // stagger threshold 1
    shoot(s2, { x: 0, y: -MAX_PULL });
    const fx2: FxEvent[] = [];
    while (s2.phase === 'resolve') fx2.push(...step(s2, SIM_DT));
    expect(fx2.some((f) => f.t === 'combo' && f.name === 'LOCKDOWN')).toBe(true);
  });
  it('Ice runs (bot, mid stats) terminate with sane state', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = createRun('w2s1', { ...BASE_STATS, damage: 4, maxHp: 35 }, seed);
      while (s.phase === 'aim' && s.shots < 300) {
        const h = s.balls[0];
        const tg = s.targets.filter((t) => !t.dead).reduce((a, b) => (Math.hypot(b.x - h.x, b.y - h.y) < Math.hypot(a.x - h.x, a.y - h.y) ? b : a));
        const d = Math.hypot(tg.x - h.x, tg.y - h.y) || 1;
        shoot(s, { x: ((tg.x - h.x) / d) * MAX_PULL, y: ((tg.y - h.y) / d) * MAX_PULL });
        untilSettled(s);
        if (s.phase === 'aim') expect(maxOverlap(s)).toBeLessThan(0.5);
      }
      expect(s.phase).toBe('over');
      expect(Number.isFinite(s.hp)).toBe(true);
    }
  });
});

describe('step 3: fx', () => {
  it("emits { t: 'stagger' } when an enemy crosses its threshold, and { t: 'enrage' } when rage is active", () => {
    const s = lab(90, 230);
    put(s, 'skirmisher', 90, 170).intent = { t: 'rest' };
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') fx.push(...step(s, SIM_DT));
    expect(fx.filter((f) => f.t === 'stagger').length).toBe(1);
    const s2 = lab(90, 240);
    put(s2, 'grunt', 30, 60).intent = { t: 'rest' };
    s2.waveTurn = 20;
    expect(enemyPhaseOnly(s2).some((f) => f.t === 'enrage')).toBe(true);
  });
});

describe('step 4: arrivals and the boss-wave enrage clock', () => {
  it('no live enemy is shimmering at any transition to aim (waves, boss, summons)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = createRun('w1s1', { ...BASE_STATS, damage: 4, maxHp: 40 }, seed);
      expect(s.targets.some((t) => t.shimmer > 0)).toBe(false);
      while (s.phase === 'aim' && s.shots < 200) {
        const h = s.balls[0];
        const tg = s.targets.reduce((a, b) => (Math.hypot(b.x - h.x, b.y - h.y) < Math.hypot(a.x - h.x, a.y - h.y) ? b : a));
        const d = Math.hypot(tg.x - h.x, tg.y - h.y) || 1;
        shoot(s, { x: ((tg.x - h.x) / d) * MAX_PULL, y: ((tg.y - h.y) / d) * MAX_PULL });
        untilSettled(s);
        if (s.phase === 'aim') expect(s.targets.filter((t) => !t.dead && t.shimmer > 0)).toEqual([]);
      }
    }
  });
  it('the boss wave keeps the stage clock (8 + 2 x 4 = turn 16); there is no wave after it', () => {
    const s = lab();
    s.wave = 4;
    s.waveTurn = 14; // turn 15
    expect(rageLevel(s)).toBe(0);
    s.waveTurn = 15; // turn 16
    expect(rageLevel(s)).toBe(1);
  });
  it('the boss takes its spot; a hero standing there is nudged clear', () => {
    let nudged = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = createRun('w1s1', BASE_STATS, seed);
      s.targets = [];
      s.wave = 3;
      s.wavePending = true;
      // Park the hero where Pincer/Ring put the boss (upper centre band).
      s.balls[0].x = 90;
      s.balls[0].y = 70;
      const fx = enemyPhaseOnly(s);
      const boss = s.targets.find((t) => t.kind === 'boss')!;
      const h = s.balls[0];
      expect(Math.hypot(boss.x - h.x, boss.y - h.y)).toBeGreaterThanOrEqual(boss.r + h.r - 0.5);
      if (fx.some((f) => f.t === 'jam')) nudged++;
    }
    expect(nudged).toBeGreaterThan(0);
  });
});

describe('v0.3 review fixes', () => {
  it('a charge that hits a crate is blocked (no damage)', () => {
    const s = lab(90, 240);
    const g = put(s, 'grunt', 90, 150);
    g.intent = { t: 'attack', n: 3 };
    s.obstacles.push({ id: s.nextId++, kind: 'crate', x: 90, y: 196, r: 5, hp: 1, flash: 0, dead: false });
    const fx = enemyPhaseOnly(s);
    expect(fx.some((e) => e.t === 'blocked')).toBe(true);
    expect(s.hp).toBe(BASE_STATS.maxHp);
  });
  it('a cleric never shields the boss', () => {
    const s = lab(90, 260);
    const b = put(s, 'boss', 90, 90);
    b.intent = { t: 'rest' };
    const c = put(s, 'cleric', 90 + b.r + 14 + 10, 90);
    c.intent = { t: 'guard' };
    enemyPhaseOnly(s);
    expect(b.shield ?? 0).toBe(0);
  });
  it('a bomber killed by a hit blasts the hero for 2 (Detonate stays 4)', () => {
    const s = lab(90, 240);
    const b = put(s, 'bomber', 90, 210);
    kill(s, b, 'main', []);
    expect(s.hp).toBe(BASE_STATS.maxHp - 2);
  });
  it('the boss scales with its archetype HP x HP_GROWTH^n, not the stage hpScale (v0.3 step 2)', () => {
    const s = createRun('w2s1', BASE_STATS, 5);
    const st = stageById('w2s1');
    expect(st.index).toBe(4);
    expect(makeEnemy(s, 'boss', 90, 90).maxHp).toBe(Math.round(40 * HP_GROWTH ** 4));
    expect(makeEnemy(s, 'grunt', 90, 90).maxHp).toBe(Math.ceil(TARGET_DEFS.grunt.hp * WORLDS[1].hpMult * HP_GROWTH ** 4));
  });
});

describe('v0.3 step 2: stage generator, scaling, modifiers, boss traits, hazards', () => {
  it('stage ids round-trip; global index runs 0..23 then loops', () => {
    expect(stageId(1, 1)).toBe('w1s1');
    expect(stageId(3, 2, 2)).toBe('l2w3s2');
    expect(parseStageId('l2w3s2')).toEqual({ world: 3, slot: 2, loop: 2 });
    expect(globalIndex('w1s1')).toBe(0);
    expect(globalIndex('w6s4')).toBe(23);
    expect(globalIndex('l1w1s1')).toBe(24);
    expect(nextStageId('w1s4')).toBe('w2s1');
    expect(nextStageId('w6s4')).toBe('l1w1s1');
    const ids = allStageIds(0);
    expect(ids.length).toBe(24);
    ids.forEach((id, i) => {
      expect(globalIndex(id)).toBe(i);
      expect(idFromIndex(i)).toBe(id);
      expect(makeStage(id).index).toBe(i);
    });
    expect(WORLDS.length).toBe(6);
    expect(makeStage('w2s3')).toBe(makeStage('w2s3')); // memoised
  });

  it('slots: modifier counts, boss traits, elites from wave 2; loops: two modifiers, all traits', () => {
    for (const loop of [0, 1, 2]) {
      for (let w = 1; w <= 6; w++) {
        const seen = new Set<string>();
        for (let k = 1; k <= 4; k++) {
          const st = makeStage(stageId(w, k, loop));
          expect(st.modifiers.length).toBe(loop > 0 ? 2 : [0, 1, 1, 2][k - 1]);
          for (const m of st.modifiers) {
            expect(seen.has(m), `${st.id} repeats ${m}`).toBe(false);
            seen.add(m);
          }
          if (loop > 0 || k === 4) expect(st.bossTraits).toEqual(['phases', 'cadre', 'moves']);
          expect(st.bossTraits).toContain('phases');
          if (k >= 3 && !st.modifiers.includes('earlyBoss')) expect(st.waves[1].elites ?? 0).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(makeStage('w1s2').bossTraits).toEqual(['phases', 'cadre']);
    expect(makeStage('w1s3').bossTraits).toEqual(['phases', 'moves']);
    expect(makeStage('w2s1').bossTraits).toContain('cadre'); // Rime Golem's signature
    expect(makeStage('w1s1').boss.cadre).toBe(0);
  });

  it('scaling: HP, attack and cash grow per global index', () => {
    const a = makeStage('w1s1');
    const b = makeStage('w1s4');
    expect(a.hpScale).toBe(1);
    expect(a.cashScale).toBe(0.5);
    expect(b.cashScale).toBeCloseTo(0.5 * CASH_GROWTH ** 3);
    expect(b.atkScale).toBeCloseTo(SLOT_ATK_MULT[3] * ATK_GROWTH ** 3);
    expect(b.boss.hp).toBe(Math.round(60 * SLOT_HP_MULT[3] * HP_GROWTH ** 3));
    const s = createRun('w3s1', BASE_STATS, 1);
    const g = makeEnemy(s, 'grunt', 90, 90);
    expect(g.maxHp).toBe(Math.ceil(3 * WORLDS[2].hpMult * HP_GROWTH ** 8));
    g.intent = { t: 'rest' };
    for (let i = 0; i < 40 && g.intent.t !== 'attack'; i++) rollIntentForTest(s, g);
    expect(g.intent.n).toBe(Math.round(3 * WORLDS[2].atkMult * ATK_GROWTH ** 8));
  });

  it('modifiers change the waves / physics they name', () => {
    const base = WORLDS[0].waves;
    const count = (st: ReturnType<typeof makeStage>, k: string) => st.waves.reduce((a, w) => a + w.slots.filter((x) => x === k).length, 0);
    const find = (m: Modifier) => allStageIds(1).map(makeStage).find((st) => st.modifiers.includes(m) && st.world !== 2)!;
    expect(find('thinRails').wallBounce).toBe(THIN_RAILS_BOUNCE);
    expect(find('swift').advanceMult).toBe(1.5);
    expect(find('earlyBoss').waves.length).toBe(2);
    expect(count(find('bombers'), 'bomber')).toBeGreaterThanOrEqual(4);
    expect(find('bigRack').waves[0].slots.length).toBeGreaterThan(base[0].slots.length - (find('bigRack').modifiers.includes('hardy') ? 1 : 0));
    const dark = find('dark');
    expect(createRun(dark.id, BASE_STATS, 1).dark).toBe(true);
    expect(createRun('w1s1', BASE_STATS, 1).dark).toBe(false);
    for (const m of ['hiveWorld', 'frostWorld'] as Modifier[]) {
      const st = find(m);
      const k = m === 'hiveWorld' ? 'hive' : 'frost';
      for (const w of st.waves) expect(w.slots.includes(k as TK), `${st.id} ${m}`).toBe(true);
    }
    const hardy = find('hardy');
    expect(hardy.hpScale).toBeCloseTo(HARDY_MOD_HP * SLOT_HP_MULT[hardy.slot - 1] * HP_GROWTH ** hardy.index * WORLDS[hardy.world - 1].hpMult);
  });

  it('dark: intents are visible only within reach of the hero', () => {
    const s = lab(90, 260);
    s.dark = true;
    const near = put(s, 'grunt', 90, 200);
    const far = put(s, 'grunt', 90, 60);
    expect(intentVisible(s, near)).toBe(true);
    expect(intentVisible(s, far)).toBe(false);
    s.dark = false;
    expect(intentVisible(s, far)).toBe(true);
  });

  it('early boss: the boss arrives after 2 waves and a kill still banks wave 4', () => {
    const st = allStageIds(1).map(makeStage).find((x) => x.modifiers.includes('earlyBoss'))!;
    const s = createRun(st.id, { ...BASE_STATS, damage: 99, maxHp: 999 }, 3);
    s.targets = [];
    s.wave = 2;
    s.wavePending = true;
    enemyPhaseOnly(s);
    expect(s.bossSpawned).toBe(true);
    const boss = s.targets.find((t) => t.kind === 'boss')!;
    for (const t of s.targets) if (t.kind === 'cadre') kill(s, t, 'main', []);
    updateBossShield(s);
    kill(s, boss, 'main', []);
    expect(s.phase).toBe('aim');
    // The next shot ends in the loot phase (no enemy phase), then three pulls end the run.
    enemyPhaseOnly(s);
    expect(s.targets.map((t) => t.kind)).toEqual(['goblin']);
    for (let i = 0; i < 3 && s.phase === 'aim'; i++) {
      shoot(s, { x: 0, y: -MAX_PULL });
      untilSettled(s);
    }
    expect(s.phase).toBe('over');
    expect(s.result?.wavesCleared).toBe(4);
    expect(s.result?.wave).toBe(4);
  });

  it('cadre trait: any boss arrives with its cadre; moves trait: the boss repositions on a non-attack intent', () => {
    const s = createRun('w1s2', BASE_STATS, 5);
    s.targets = [];
    s.wave = 3;
    s.wavePending = true;
    enemyPhaseOnly(s);
    expect(s.targets.filter((t) => t.kind === 'cadre').length).toBe(WORLDS[0].boss.cadre);
    const m = createRun('w1s3', BASE_STATS, 5);
    m.targets = [];
    m.obstacles = [];
    m.balls[0].x = 90;
    m.balls[0].y = 270;
    const b = put(m, 'boss', 90, 80);
    b.intent = { t: 'charge' };
    const fx = enemyPhaseOnly(m);
    expect(fx.some((f) => f.t === 'launch' && f.id === b.id)).toBe(true);
    expect(b.y).toBeGreaterThan(90);
  });

  it('ice hazard: patches only on Ice; a body crossing one keeps (almost) all its speed', () => {
    expect(makeStage('w1s1').hazards).toEqual([]);
    expect(makeStage('w5s1').hazards).toEqual([]); // w3 has conveyors, w4 mud (v0.7); lava is still a stub
    const st = makeStage('w2s1');
    expect(st.hazards.length).toBeGreaterThan(0);
    expect(st.hazards.every((h) => h.kind === 'ice')).toBe(true);
    const roll = (ice: boolean) => {
      const s = lab(90, 250);
      s.hazards = ice ? [{ kind: 'ice', x: 90, y: 160, r: 60 }] : [];
      shoot(s, { x: 0, y: -MAX_PULL * 0.4 });
      while (s.phase === 'resolve') step(s, SIM_DT);
      return 250 - s.balls[0].y;
    };
    expect(roll(true)).toBeGreaterThan(roll(false) + 20);
  });
});

describe('v0.3 step 2b: enrage liveness backstop', () => {
  it('an enraged attacker beyond reach charges; deep enrage behind cover lands as an instant strike', () => {
    const s = lab(90, 260);
    const g = put(s, 'grunt', 90, 60);
    g.intent = { t: 'attack', n: 3 };
    s.waveTurn = 10; // rage 2: charges from anywhere
    let fx = enemyPhaseOnly(s);
    expect(fx.some((f) => f.t === 'launch' && f.intent === 'attack')).toBe(true);
    const c = lab(90, 260);
    const e = put(c, 'grunt', 90, 60);
    e.intent = { t: 'attack', n: 3 };
    c.obstacles.push({ id: c.nextId++, kind: 'bumper', x: 90, y: 90, r: 6, hp: Infinity, flash: 0, dead: false });
    c.waveTurn = 13; // rage 5
    fx = enemyPhaseOnly(c);
    expect(fx.some((f) => f.t === 'heroHit')).toBe(true);
    expect(c.hp).toBeLessThan(BASE_STATS.maxHp);
  });
});

describe('v0.3 step 2c: ranged guardrail', () => {
  it('Shoot damage in one enemy phase is capped at half max HP; charges are not', () => {
    const s = lab(90, 260);
    for (let i = 0; i < 4; i++) put(s, 'skirmisher', 30 + i * 40, 60).intent = { t: 'shoot', n: 16 };
    enemyPhaseOnly(s);
    expect(BASE_STATS.maxHp - s.hp).toBe(Math.floor(RANGED_PHASE_CAP * BASE_STATS.maxHp));
    // The cap resets every enemy phase.
    s.hp = s.maxHp;
    for (const t of s.targets) t.intent = { t: 'shoot', n: 3 };
    enemyPhaseOnly(s);
    expect(s.maxHp - s.hp).toBe(Math.min(12, Math.floor(RANGED_PHASE_CAP * BASE_STATS.maxHp)));
  });
});

// ---------- v0.4 gear (DESIGN-v0.4-loadout) ----------

/** Empty table with gear stats; hero at (x,y). */
function glab(over: Partial<RunStats>, x = 90, y = 240): RunState {
  const s = createRun('w1s1', { ...BASE_STATS, ...over }, 42);
  s.targets = [];
  s.obstacles = [];
  s.balls[0].x = x;
  s.balls[0].y = y;
  return s;
}
const speedOf = (s: RunState) => Math.hypot(s.balls[0].vx, s.balls[0].vy);
function untilFirstHit(s: RunState): FxEvent[] {
  const fx: FxEvent[] = [];
  while (!s.firstHitDone && s.phase === 'resolve') fx.push(...step(s, SIM_DT));
  return fx;
}

describe('v0.4 cues', () => {
  it('break: faster launch (BREAK_SPEED_MULT) and at least 50 % power', () => {
    const s = glab({ cue: 'break' });
    shoot(s, { x: 0, y: -13 });
    expect(speedOf(s)).toBeCloseTo(0.5 * MAX_LAUNCH_SPEED * BREAK_SPEED_MULT, 6);
    const t = glab({ cue: 'break' });
    shoot(t, { x: 0, y: -MAX_PULL });
    expect(speedOf(t)).toBeCloseTo(MAX_LAUNCH_SPEED * BREAK_SPEED_MULT, 6);
  });
  it('jump: passes over the first enemy untouched, lands, and its next contact deals -1', () => {
    const s = glab({ cue: 'jump', damage: 3 }, 90, 260);
    const g = put(s, 'grunt', 90, 190);
    const b = put(s, 'brute', 90, 110);
    g.hp = g.maxHp = 10;
    b.hp = b.maxHp = 20;
    shoot(s, { x: 0, y: -MAX_PULL });
    while (s.combo.hits === 0 && s.phase === 'resolve') step(s, SIM_DT);
    expect(g.hp).toBe(10);
    expect(g.resting).toBe(true);
    expect(b.hp).toBe(20 - 2);
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(maxOverlap(s)).toBeLessThan(0.5);
  });
  it('draw: after the first contact the ball heads back to the launch point at 50 % of launch speed (20 % less power)', () => {
    const s = glab({ cue: 'draw' }, 90, 240);
    const g = put(s, 'grunt', 90, 170);
    g.hp = g.maxHp = 10;
    shoot(s, { x: 0, y: -MAX_PULL });
    expect(speedOf(s)).toBeCloseTo(0.8 * MAX_LAUNCH_SPEED, 6);
    untilFirstHit(s);
    const h = s.balls[0];
    expect(h.vy).toBeGreaterThan(0);
    expect(Math.abs(h.vx)).toBeLessThan(1);
    expect(Math.abs(speedOf(s) - 0.5 * 0.8 * MAX_LAUNCH_SPEED)).toBeLessThan(4);
  });
  it('follow: the ball keeps 60 % of its pre-impact velocity; charges deal +1', () => {
    const s = glab({ cue: 'follow' }, 90, 240);
    const g = put(s, 'grunt', 90, 170);
    g.hp = g.maxHp = 10;
    shoot(s, { x: 0, y: -MAX_PULL });
    let pre = 0;
    while (!s.firstHitDone) {
      pre = speedOf(s);
      step(s, SIM_DT);
    }
    expect(s.balls[0].vy).toBeLessThan(0);
    expect(Math.abs(speedOf(s) - 0.6 * pre)).toBeLessThan(4);
    const t = glab({ cue: 'follow' }, 90, 240);
    put(t, 'grunt', 90, 170).intent = { t: 'attack', n: 2 };
    enemyPhaseOnly(t);
    expect(t.hp).toBe(BASE_STATS.maxHp - 3);
  });
});

describe('v0.4 relics', () => {
  it('lightning, split and spitter only work when equipped', () => {
    const fx = (relics: RunStats['relics']) => {
      const s = glab({ relics, lightningChance: 1, lightningArcs: 1, lightningRange: 80, lightningDamage: 1, splitCount: 2, spitInterval: 0.05, spitLife: 1, spitDamage: 1 });
      put(s, 'grunt', 90, 170).hp = 10;
      put(s, 'grunt', 130, 170).hp = 10;
      shoot(s, { x: 0, y: -MAX_PULL });
      const out: FxEvent[] = [];
      while (s.phase === 'resolve') out.push(...step(s, SIM_DT));
      return new Set(out.map((f) => f.t));
    };
    const off = fx([]);
    expect(off.has('lightning') || off.has('split') || off.has('spit')).toBe(false);
    const on = fx(['lightning', 'split', 'spitter']);
    expect(on.has('lightning') && on.has('split') && on.has('spit')).toBe(true);
  });
  it('poison: +1 stack per contact (+level), ticks at the enemy phase start, decays by 1 (no decay at level 2)', () => {
    for (const [lvl, stacks, after] of [[0, 1, 0], [1, 2, 1], [2, 3, 3]] as const) {
      const s = glab({ relics: ['poison'], gearLevel: { poison: lvl } });
      const g = put(s, 'grunt', 90, 170);
      g.hp = g.maxHp = 20;
      g.intent = { t: 'rest' };
      shoot(s, { x: 0, y: -MAX_PULL });
      untilFirstHit(s);
      expect(g.poison).toBe(stacks);
      const hp = g.hp;
      const fx = untilSettled(s);
      expect(s.combo.hits).toBe(1);
      expect(fx.some((f) => f.t === 'poisonTick' && f.dmg === stacks)).toBe(true);
      expect(g.hp).toBe(hp - stacks);
      expect(g.poison).toBe(after);
      expect(g.stagger).toBe(0);
    }
  });
  it('poison ignores 1-hit shields and never staggers; poison kills pay cash but not the chain', () => {
    const s = glab({ relics: ['poison'] });
    const g = put(s, 'grunt', 90, 60);
    g.hp = g.maxHp = 10;
    g.shield = 1;
    g.poison = 2;
    g.intent = { t: 'rest' };
    const fx: FxEvent[] = [];
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    s.balls[0].resting = true;
    // Watch the tick itself (stagger clears at the end of the phase).
    while (s.phase !== 'enemy') fx.push(...step(s, SIM_DT));
    expect(g.hp).toBe(8);
    expect(g.shield).toBe(1);
    expect(g.stagger).toBe(0);
    untilSettled(s);
    const k = put(s, 'grunt', 30, 60);
    k.hp = 1;
    k.poison = 3;
    const cash = s.cash;
    enemyPhaseOnly(s);
    expect(k.dead).toBe(true);
    expect(s.cash).toBeGreaterThan(cash);
    expect(s.combo.chainKills).toBe(0);
  });
  it('explosive: the first hit blasts floor(dmg/2) (min 1) + 1 stagger to enemies near the impact and costs half the speed', () => {
    const run = (relics: RunStats['relics']) => {
      const s = glab({ relics, damage: 3 });
      const a = put(s, 'grunt', 90, 170);
      const b = put(s, 'brute', 125, 150);
      a.hp = a.maxHp = 10;
      b.hp = b.maxHp = 10;
      shoot(s, { x: 0, y: -MAX_PULL });
      const fx = untilFirstHit(s);
      return { s, b, fx };
    };
    const on = run(['explosive']);
    const off = run([]);
    expect(on.fx.some((f) => f.t === 'blast')).toBe(true);
    expect(on.b.hp).toBe(10 - 1);
    expect(on.b.stagger).toBe(1);
    expect(off.b.hp).toBe(10);
    expect(speedOf(on.s)).toBeCloseTo(speedOf(off.s) / 2, 0);
  });
  it('chill: a hit chills for one phase; chilled charges reach 60 % and Advances roll half as far', () => {
    const s = glab({ relics: ['chill'] });
    const g = put(s, 'grunt', 90, 170);
    g.hp = g.maxHp = 10;
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') fx.push(...step(s, SIM_DT));
    expect(g.chill).toBe(1);
    expect(fx.some((f) => f.t === 'status' && f.kind === 'chill' && f.on)).toBe(true);
    const off = untilSettled(s);
    expect(g.chill).toBe(0);
    expect(off.some((f) => f.t === 'status' && f.kind === 'chill' && !f.on)).toBe(true);
    // Gap 80: within a grunt's reach (110) but not a chilled one's (66) -> Advance, no hit.
    const t = glab({ relics: ['chill'] }, 90, 260);
    const c = put(t, 'grunt', 90, 260 - 24 - 80);
    c.intent = { t: 'attack', n: 2 };
    c.chill = 1;
    const y0 = c.y;
    enemyPhaseOnly(t);
    expect(t.hp).toBe(BASE_STATS.maxHp);
    expect(c.y - y0).toBeGreaterThan(20);
    expect(c.y - y0).toBeLessThan(36);
  });
  it('shrapnel: a ball kill releases 2 shards (3 at level 1) that deal 1', () => {
    for (const [lvl, n] of [[0, 2], [1, 3]] as const) {
      const s = glab({ relics: ['shrapnel'], gearLevel: { shrapnel: lvl } });
      put(s, 'grunt', 90, 170).hp = 1;
      shoot(s, { x: 0, y: -MAX_PULL });
      const fx = untilFirstHit(s);
      expect(fx.filter((f) => f.t === 'shard').length).toBe(1);
      expect(s.balls.filter((b) => b.shard).length).toBe(n);
      expect(s.balls.filter((b) => b.shard).every((b) => b.life <= 0.8)).toBe(true);
    }
  });
  it('static: an enemy crossing its stagger threshold takes 1 (2 at level 1)', () => {
    for (const [lvl, d] of [[0, 1], [1, 2]] as const) {
      const s = glab({ relics: ['static'], gearLevel: { static: lvl } });
      const k = put(s, 'skirmisher', 90, 170); // staggerAt 1
      k.hp = k.maxHp = 10;
      shoot(s, { x: 0, y: -MAX_PULL });
      untilFirstHit(s);
      expect(k.hp).toBe(10 - 1 - d);
    }
  });
  it('ricochet: +1 damage per rail bounce before the first hit', () => {
    const run = (relics: RunStats['relics']) => {
      const s = glab({ relics }, 90, 230);
      const g = put(s, 'grunt', 90, 120);
      g.hp = g.maxHp = 10;
      shoot(s, { x: 0, y: MAX_PULL }); // down into the rail, back up into the grunt
      untilFirstHit(s);
      return { g, s };
    };
    const on = run(['ricochet']);
    expect(on.s.shotBounces).toBe(1);
    expect(on.g.hp).toBe(10 - 2);
    expect(run([]).g.hp).toBe(10 - 1);
  });
  it('lantern: intents are always visible on dark', () => {
    const s = glab({ relics: ['lantern'] }, 90, 260);
    expect(s.lanternOn).toBe(true);
    s.dark = true;
    expect(intentVisible(s, put(s, 'grunt', 90, 60))).toBe(true);
  });
  it('thorns: an enemy whose charge lands takes 2 (3 at level 1)', () => {
    for (const [lvl, d] of [[0, 2], [1, 3]] as const) {
      const s = glab({ relics: ['thorns'], gearLevel: { thorns: lvl } });
      const g = put(s, 'grunt', 90, 170);
      g.hp = g.maxHp = 10;
      g.intent = { t: 'attack', n: 2 };
      enemyPhaseOnly(s);
      expect(s.hp).toBe(BASE_STATS.maxHp - 2);
      expect(g.hp).toBe(10 - d);
    }
  });
  it('momentum: a 2-hit shot adds +1 damage; a shot with fewer hits resets it', () => {
    const s = glab({ relics: ['momentum'] }, 90, 230);
    const a = put(s, 'grunt', 90, 170);
    const b = put(s, 'grunt', 90, 140);
    for (const e of [a, b]) ((e.hp = e.maxHp = 20), (e.intent = { t: 'rest' }));
    shoot(s, { x: 0, y: -MAX_PULL });
    untilSettled(s);
    expect(s.momentum).toBe(1);
    // Next shot hits: +1 damage on the hero's contacts.
    s.targets = [];
    const c = put(s, 'brute', s.balls[0].x, s.balls[0].y - 80);
    c.hp = c.maxHp = 20;
    c.intent = { t: 'rest' };
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(c.hp).toBe(20 - 2);
    untilSettled(s);
    expect(s.momentum).toBe(0); // one hit: reset
  });
  it('mirror: reflects ~30 % of Shoots with a fixed seed (no hero damage, 1 to the shooter)', () => {
    const s = glab({ relics: ['mirror'], maxHp: 200 }, 90, 260);
    s.maxHp = s.hp = 200;
    const ks = [0, 1, 2, 3].map((i) => put(s, 'skirmisher', 30 + i * 40, 60));
    let mirrors = 0;
    let shots = 0;
    for (let p = 0; p < 10; p++) {
      for (const k of ks) ((k.intent = { t: 'shoot', n: 1 }), (k.hp = k.maxHp = 99));
      s.waveTurn = 0; // keep enrage out of it
      const hp = s.hp;
      const fx = enemyPhaseOnly(s);
      const m = fx.filter((f) => f.t === 'mirror').length;
      mirrors += m;
      shots += 4;
      expect(hp - s.hp).toBe(4 - m);
      expect(ks.filter((k) => k.hp === 98).length).toBe(m);
    }
    expect(mirrors).toBe(MIRROR_COUNT_SEED42);
    expect(mirrors / shots).toBeGreaterThan(0.15);
    expect(mirrors / shots).toBeLessThan(0.45);
  });
});

/** Mirror reflections in 40 Shoots, seed 42 (pinned: a change here means the rng stream moved). */
const MIRROR_COUNT_SEED42 = 11;

describe('v0.4 tricks', () => {
  it('recall: hero back to the bottom-centre spot; aim only; uses run out', () => {
    const s = glab({ trick: 'recall', trickUses: 1 }, 40, 100);
    expect(s.trickUsesLeft).toBe(1);
    const fx: FxEvent[] = [];
    expect(useTrick(s)).toBe(true);
    fx.push(...step(s, SIM_DT));
    expect(fx.some((f) => f.t === 'trick' && f.id === 'recall')).toBe(true);
    expect(s.balls[0].x).toBeCloseTo(TABLE.x + TABLE.w / 2, 6);
    expect(s.balls[0].y).toBeCloseTo(TABLE.y + TABLE.h - 24, 6);
    expect(useTrick(s)).toBe(false);
    // Occupied spot: nudged clear.
    const t = glab({ trick: 'recall', trickUses: 1 }, 40, 100);
    put(t, 'brute', TABLE.x + TABLE.w / 2, TABLE.y + TABLE.h - 24);
    useTrick(t);
    expect(maxOverlap(t)).toBeLessThan(0.01);
    expect(t.balls[0].y).toBeGreaterThan(200);
    // Not during resolve.
    const u = glab({ trick: 'recall', trickUses: 1 });
    shoot(u, { x: 0, y: -MAX_PULL });
    expect(useTrick(u)).toBe(false);
    expect(glab({}).trickUsesLeft).toBe(0);
    expect(useTrick(glab({}))).toBe(false);
  });
  it('time stop: the next enemy phase only lets enemies close in; nothing hits and intents keep', () => {
    const s = glab({ trick: 'timeStop', trickUses: 1 });
    const g = put(s, 'grunt', 90, 120);
    g.intent = { t: 'attack', n: 2 };
    const k = put(s, 'skirmisher', 30, 60);
    k.intent = { t: 'shoot', n: 2 };
    expect(useTrick(s)).toBe(true);
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(g.y).toBeGreaterThan(150); // advanced toward the hero
    expect(g.intent).toEqual({ t: 'attack', n: 2 });
    expect(k.intent).toEqual({ t: 'shoot', n: 2 });
    k.intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - 2);
  });
  it("rack 'em: every enemy moves 20 px toward the table centre, overlaps resolved", () => {
    const s = glab({ trick: 'rackEm', trickUses: 1 }, 90, 270);
    const cx = TABLE.x + TABLE.w / 2;
    const cy = TABLE.y + TABLE.h / 2;
    const es = [put(s, 'grunt', 30, 60), put(s, 'grunt', 150, 60), put(s, 'brute', 40, 200)];
    const d0 = es.map((e) => Math.hypot(e.x - cx, e.y - cy));
    useTrick(s);
    es.forEach((e, i) => expect(d0[i] - Math.hypot(e.x - cx, e.y - cy)).toBeCloseTo(20, 1));
    expect(maxOverlap(s)).toBeLessThan(0.01);
  });
  it('shockwave: +1 stagger within 60 px of the ball, 2 uses; static applies', () => {
    const s = glab({ trick: 'shockwave', trickUses: 2, relics: ['static'] }, 90, 240);
    const near = put(s, 'skirmisher', 90, 180);
    near.hp = near.maxHp = 10;
    const far = put(s, 'grunt', 90, 60);
    expect(useTrick(s)).toBe(true);
    expect(near.stagger).toBe(1);
    expect(near.hp).toBe(9); // static
    expect(far.stagger).toBe(0);
    expect(useTrick(s)).toBe(true);
    expect(near.stagger).toBe(2);
    expect(useTrick(s)).toBe(false);
  });
});

describe('v0.4 determinism with gear', () => {
  it('same seed + same shots with a full loadout => identical state', () => {
    const gear: RunStats = { ...BASE_STATS, damage: 2, cue: 'follow', relics: ['poison', 'explosive', 'shrapnel', 'mirror', 'momentum', 'chill', 'static'], trick: null, trickUses: 0, gearLevel: { poison: 1 } };
    const go = (dt: number) => {
      const s = createRun('w1s2', gear, 11);
      for (const p of SHOTS) {
        if (s.phase !== 'aim') break;
        shoot(s, p);
        untilSettled(s, dt);
      }
      return s;
    };
    expect(snapshot(go(SIM_DT))).toEqual(snapshot(go(SIM_DT)));
    const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT));
    const { t: _b, ...normal } = snapshot(go(SIM_DT));
    expect(ff).toEqual(normal);
  });
});

// ---------- v0.5 Clockwork Works (world 3) ----------
import { BELT_SHIFT, ENEMY_WALL_BOUNCE, MAINSPRING_MOVE_DIST } from '../src/core/tuning';
import { beltPreview } from '../src/sim/index';
import { liveRegulars, spawnWave } from '../src/sim/spawn';
const spawnWaveForTest = (s: RunState) => spawnWave(s, []);
import { applyDamage } from '../src/sim/damage';
import type { Hazard, Target } from '../src/core/types';

const belt = (x: number, y: number, w: number, h: number, dx: number, dy: number): Hazard => ({ kind: 'conveyor', x, y, r: 0, w, h, dx, dy });
/** A full-width belt carrying right along y = 150. */
const RIGHT_BELT = belt(90, 150, 160, 20, 1, 0);

/** Empty table on `stage` with the hero at (x,y) and the given belts. */
function clab(hazards: Hazard[], x = 40, y = 150, over: Partial<RunStats> = {}, stage = 'w1s1'): RunState {
  const s = createRun(stage, { ...BASE_STATS, ...over }, 42);
  s.targets = [];
  s.obstacles = [];
  s.hazards = hazards.map((z) => ({ ...z }));
  s.balls[0].x = x;
  s.balls[0].y = y;
  return s;
}
function resting(s: RunState, kind: TargetKind, x: number, y: number): Target {
  const e = put(s, kind, x, y);
  e.intent = { t: 'rest' };
  return e;
}
const belts = (fx: FxEvent[]) => fx.filter((f): f is Extract<FxEvent, { t: 'belt' }> => f.t === 'belt');
/** Put the state into a bare enemy phase (no intents queued) so hand-launched bodies play out under enemy rules. */
function bareEnemyPhase(s: RunState): void {
  s.phase = 'enemy';
  s.enemyQueue = [];
  s.enemyNext = s.t;
  s.resolveTime = 0;
  s.lastHit = {};
  s.touching = {};
}

describe('v0.5 Clockwork: stage generator', () => {
  it('w3s1-4: belts 1/2/2/3, gears 0/1/1/1, in bounds above the spawn zone, no overlaps, deterministic', () => {
    const want = [[1, 0], [2, 1], [2, 1], [3, 1]];
    for (let k = 1; k <= 4; k++) {
      const hz = makeStage(stageId(3, k)).hazards;
      const bs = hz.filter((z) => z.kind === 'conveyor');
      const gs = hz.filter((z) => z.kind === 'gear');
      expect([bs.length, gs.length]).toEqual(want[k - 1]);
      bs.forEach((b, i) => {
        expect([b.w, b.h]).toEqual(i % 2 === 0 ? [100, 20] : [20, 80]);
        expect(Math.abs(b.dx!) + Math.abs(b.dy!)).toBe(1);
        expect(i % 2 === 0 ? b.dy : b.dx).toBe(0);
        expect(b.x - b.w! / 2).toBeGreaterThanOrEqual(16);
        expect(b.x + b.w! / 2).toBeLessThanOrEqual(164);
        expect(b.y - b.h! / 2).toBeGreaterThanOrEqual(50);
        expect(b.y + b.h! / 2).toBeLessThanOrEqual(222);
        expect(b.y + b.h! / 2).toBeLessThan(SPAWN_ZONE_Y);
        for (const o of bs) {
          if (o === b) continue;
          const gx = Math.max(0, Math.abs(o.x - b.x) - (o.w! + b.w!) / 2);
          const gy = Math.max(0, Math.abs(o.y - b.y) - (o.h! + b.h!) / 2);
          expect(Math.hypot(gx, gy)).toBeGreaterThanOrEqual(12);
        }
        for (const g of gs) {
          const gx = Math.max(0, Math.abs(g.x - b.x) - b.w! / 2);
          const gy = Math.max(0, Math.abs(g.y - b.y) - b.h! / 2);
          expect(Math.hypot(gx, gy) - g.r).toBeGreaterThanOrEqual(8);
        }
      });
      for (const g of gs) {
        expect(g.r).toBe(14);
        expect(g.x).toBeGreaterThanOrEqual(50);
        expect(g.x).toBeLessThanOrEqual(130);
        expect(g.y).toBeGreaterThanOrEqual(94);
        expect(g.y).toBeLessThanOrEqual(160);
      }
    }
    // Deterministic: seeded by the global index only (snapshot of w3s1).
    const b0 = makeStage('w3s1').hazards[0];
    expect([Math.round(b0.x), Math.round(b0.y), b0.dx, b0.dy]).toEqual([111, 81, 1, 0]);
  });
  it('worlds 1-2 stage data is unchanged by v0.5 (hash of makeStage n = 0..7)', () => {
    let h = 0;
    const str = JSON.stringify(Array.from({ length: 8 }, (_, n) => makeStage(idFromIndex(n))));
    for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    // v0.6 M1 rebaseline: overtimeCash and emeraldReward left StageDef (nothing else changed: -35 chars per stage).
    expect([h, str.length]).toEqual([1834690106, 9165]);
  });
  it('createRun: the gear becomes an unbreakable obstacle; hazards are a copy (a reversal never leaks into the stage)', () => {
    const a = createRun('w3s2', BASE_STATS, 3);
    const stageBelts = makeStage('w3s2').hazards.filter((z) => z.kind === 'conveyor');
    expect(a.hazards).toEqual(stageBelts);
    const gear = a.obstacles.filter((o) => o.kind === 'gear');
    expect(gear.length).toBe(1);
    expect(gear[0].hp).toBe(Infinity);
    expect(gear[0].r).toBe(14);
    for (const t of a.targets) expect(Math.hypot(t.x - gear[0].x, t.y - gear[0].y)).toBeGreaterThanOrEqual(t.r + 14);
    // The Mainspring's phase 2 reverses the run's belts; the next run starts un-reversed.
    const boss = makeEnemy(a, 'boss', 90, 60);
    a.targets.push(boss);
    applyDamage(a, boss, boss.hp - Math.floor(boss.maxHp / 2), 'main', []);
    expect(a.hazards.map((z) => z.dx! + 2 * z.dy!)).toEqual(stageBelts.map((z) => -(z.dx! + 2 * z.dy!)));
    const b = createRun('w3s2', BASE_STATS, 3);
    expect(b.hazards).toEqual(stageBelts);
    expect(createRun('w3s2', BASE_STATS, 4).hazards).toEqual(stageBelts);
  });
});

describe('v0.5 Clockwork: conveyor sweep', () => {
  it('a right belt carries the hero and a resting grunt 24 px (one belt fx each), after the hold, before anyone acts', () => {
    const s = clab([RIGHT_BELT], 40, 150);
    const g = put(s, 'grunt', 100, 150);
    g.intent = { t: 'advance' };
    const fx = enemyPhaseOnly(s);
    expect(BELT_SHIFT).toBe(24);
    expect(s.balls[0].x).toBeCloseTo(64, 6);
    const bf = belts(fx);
    expect(bf.length).toBe(2);
    for (const f of bf) expect([f.dx, f.dy]).toEqual([24, 0]);
    // The sweep fires before the queue: the grunt's launch comes after the belt fx.
    expect(fx.findIndex((f) => f.t === 'launch')).toBeGreaterThan(fx.findIndex((f) => f.t === 'belt'));
    expect(maxOverlap(s)).toBeLessThanOrEqual(0.01);
    expect(s.beltAt).toBeUndefined();
  });
  it('a frozen enemy stays (and blocks); a body 1 px from the rail moves 1; queues advance front-first', () => {
    const s = clab([RIGHT_BELT], 40, 150);
    const ice = resting(s, 'grunt', 100, 150);
    ice.frozen = 2;
    const edge = resting(s, 'grunt', TABLE.x + TABLE.w - 12 - 1, 150);
    enemyPhaseOnly(s);
    expect(ice.x).toBe(100);
    expect(edge.x).toBeCloseTo(TABLE.x + TABLE.w - 12, 6);
    expect(s.balls[0].x).toBeCloseTo(64, 6);
    // Hero behind a grunt that is stopped by the rail: slides to contact.
    const q = clab([RIGHT_BELT], 120, 150);
    const front = resting(q, 'grunt', TABLE.x + TABLE.w - 12 - 1, 150);
    const pv = beltPreview(q)!;
    const fx = enemyPhaseOnly(q);
    expect(front.x).toBeCloseTo(158, 6);
    expect(q.balls[0].x).toBeCloseTo(158 - 24, 6);
    expect(pv.x).toBeCloseTo(q.balls[0].x, 6);
    expect(belts(fx).length).toBe(2);
    expect(maxOverlap(q)).toBeLessThanOrEqual(0.01);
  });
  it('CLEATS: beltGrip 1 carries the hero 12 px, 2 not at all; enemies always 24; beltPreview matches', () => {
    for (const [grip, d] of [[0, 24], [1, 12], [2, 0]]) {
      const s = clab([RIGHT_BELT], 40, 150, { beltGrip: grip });
      const g = resting(s, 'grunt', 100, 150);
      expect(beltPreview(s)!.x).toBeCloseTo(40 + d, 6);
      const fx = enemyPhaseOnly(s);
      expect(s.balls[0].x).toBeCloseTo(40 + d, 6);
      expect(g.x).toBeCloseTo(124, 6);
      expect(belts(fx).length).toBe(d > 0 ? 2 : 1);
    }
    const off = clab([RIGHT_BELT], 90, 250);
    expect(beltPreview(off)).toBeNull();
    expect(beltPreview(lab())).toBeNull();
  });
  it('belts still run under Time Stop and Reflex', () => {
    const s = clab([RIGHT_BELT], 40, 150, { trick: 'timeStop', trickUses: 1 });
    const g = put(s, 'grunt', 100, 150);
    g.intent = { t: 'attack', n: 2 };
    expect(useTrick(s)).toBe(true);
    enemyPhaseOnly(s);
    expect(s.balls[0].x).toBeCloseTo(64, 6);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    const r = clab([RIGHT_BELT], 40, 150, { reflex: 1 });
    resting(r, 'grunt', 100, 230);
    r.waveTurn = 0;
    enemyPhaseOnly(r);
    expect(r.balls[0].x).toBeCloseTo(64, 6);
  });
  it('no belt under anyone: no hold (worlds without belts take the v0.4 path)', () => {
    const s = clab([RIGHT_BELT], 90, 250);
    resting(s, 'grunt', 90, 60);
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    step(s, SIM_DT);
    expect(s.phase).toBe('enemy');
    expect(s.beltAt).toBeUndefined();
  });
});

describe('v0.5 Clockwork: gear', () => {
  const gearAt = (s: RunState, x: number, y: number) => s.obstacles.push({ id: 900, kind: 'gear', x, y, r: 14, hp: Infinity, flash: 0, dead: false });
  it('the hero leaves the gear 35 deg clockwise off the reflection, untouched', () => {
    const s = lab(90, 240);
    gearAt(s, 90, 150);
    shoot(s, { x: 0, y: -MAX_PULL });
    let fx: FxEvent[] = [];
    while (s.phase === 'resolve' && !fx.some((f) => f.t === 'gearSpin')) fx = step(s, SIM_DT);
    expect(fx.some((f) => f.t === 'gearSpin')).toBe(true);
    const h = s.balls[0];
    // Head-on from below: the reflection points straight down (90 deg, y-down); the gear turns it to 125 deg.
    const deg = (Math.atan2(h.vy, h.vx) * 180) / Math.PI;
    expect(Math.abs(deg - 125)).toBeLessThanOrEqual(3);
    untilSettled(s);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(s.obstacles.find((o) => o.kind === 'gear')!.dead).toBe(false);
  });
  it('a charger through the gear deals nothing and takes +1 stagger (once)', () => {
    const s = lab(90, 240);
    gearAt(s, 90, 172);
    const g = put(s, 'grunt', 90, 115);
    g.intent = { t: 'attack', n: 2 };
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    let stag = -1;
    const all: FxEvent[] = [];
    for (let i = 0; i < 240 * 6 && s.phase !== 'aim'; i++) {
      const fx = step(s, SIM_DT);
      all.push(...fx);
      if (stag < 0 && fx.some((f) => f.t === 'gearSpin')) stag = g.stagger;
    }
    expect(all.some((f) => f.t === 'gearSpin')).toBe(true);
    expect(all.some((f) => f.t === 'blocked')).toBe(true);
    expect(stag).toBe(1);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(g.hp).toBe(g.maxHp);
  });
});

describe('v0.5 Clockwork: cog and tinker', () => {
  it('a charging cog bumps its own side (1 each down the line) and keeps its charge', () => {
    const s = lab(150, 280);
    const cog = resting(s, 'cog', 90, 80);
    const g1 = resting(s, 'grunt', 90, 140);
    const g2 = resting(s, 'grunt', 90, 175);
    bareEnemyPhase(s);
    cog.chargeDmg = 3;
    cog.railHits = 0;
    cog.vy = TARGET_DEFS.cog.chargeSpeed;
    cog.resting = false;
    let kept = -1;
    for (let i = 0; i < 240 * 6 && s.phase === 'enemy'; i++) {
      step(s, SIM_DT);
      if (kept < 0 && g1.hp < g1.maxHp) kept = cog.chargeDmg ?? 0;
    }
    expect(kept).toBe(3);
    expect(g1.hp).toBe(g1.maxHp - 1);
    expect(g2.hp).toBe(g2.maxHp - 1);
  });
  it('a cog Attack hits the hero for the scaled 3; banks off one rail; the second rail contact stops it', () => {
    const s = clab([], 90, 250, {}, 'w3s1');
    const cog = put(s, 'cog', 90, 140);
    rollIntentForTest(s, cog);
    const n3 = Math.max(1, Math.round(3 * stageById('w3s1').atkScale));
    cog.intent = { t: 'attack', n: n3 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(BASE_STATS.maxHp - n3);
    // Two rails: left, then top.
    const r = lab(150, 280);
    resting(r, 'grunt', 150, 200);
    const c = resting(r, 'cog', 40, 100);
    bareEnemyPhase(r);
    c.chargeDmg = 3;
    c.railHits = 0;
    c.vx = -250;
    c.vy = -120;
    c.resting = false;
    let after1: number | null = null;
    let stopped = false;
    for (let i = 0; i < 240 * 4 && r.phase === 'enemy'; i++) {
      const vx0 = c.vx;
      step(r, SIM_DT);
      if (after1 === null && c.railHits === 1) after1 = c.vx / vx0;
      if (c.railHits === 2) {
        stopped = c.vx === 0 && c.vy === 0 && (c.chargeDmg ?? 0) === 0;
        break;
      }
    }
    // Rail restitution 0.6 x 1.2 (never the stage's hero wallBounce / Thin Rails).
    expect(after1!).toBeCloseTo(-ENEMY_WALL_BOUNCE * TARGET_DEFS.cog.bounce, 1);
    expect(stopped).toBe(true);
  });
  it('cogs per regular wave are capped at 2 (extras become grunts)', () => {
    const s = createRun('w3s4', BASE_STATS, 5);
    for (let w = 1; w <= 3; w++) {
      s.targets = [];
      s.wave = w;
      spawnWaveForTest(s);
      expect(s.targets.filter((t) => t.kind === 'cog').length).toBeLessThanOrEqual(2);
    }
  });
  it('tinker: Repair heals the most damaged ally in range (never itself); none in range: it rolls Shoot and executes nothing', () => {
    const s = lab(90, 270);
    const tk = put(s, 'tinker', 90, 100);
    tk.hp = 1;
    const a = resting(s, 'grunt', 55, 100);
    const b = resting(s, 'grunt', 125, 100);
    a.hp = a.maxHp - 1;
    b.hp = b.maxHp - 2;
    tk.intent = { t: 'repair' };
    const fx = enemyPhaseOnly(s);
    expect(b.hp).toBe(b.maxHp);
    expect(a.hp).toBe(a.maxHp - 1);
    expect(tk.hp).toBe(1);
    expect(fx.filter((f) => f.t === 'repair')).toEqual([{ t: 'repair', x: b.x, y: b.y, amount: 2 }]);
    // Nobody damaged in range: always Shoot.
    const q = lab(90, 270);
    const t2 = put(q, 'tinker', 90, 100);
    t2.hp = 1;
    const far = resting(q, 'grunt', 90, 200);
    far.hp = 1;
    for (let i = 0; i < 30; i++) {
      rollIntentForTest(q, t2);
      expect(t2.intent.t).toBe('shoot');
    }
    // A Repair whose target is gone is a Rest.
    t2.intent = { t: 'repair' };
    const hp0 = q.hp;
    const f2 = enemyPhaseOnly(q);
    expect(q.hp).toBe(hp0);
    expect(f2.some((f) => f.t === 'repair' || f.t === 'heroHit')).toBe(false);
  });
});

describe('v0.5 Clockwork: The Mainspring', () => {
  it('Wind: the next sweep runs twice (48 px), then clears; the boss soft-rolls 40 px after it', () => {
    const s = clab([belt(90, 200, 160, 20, 1, 0)], 90, 270, {}, 'w3s1');
    const boss = put(s, 'boss', 90, 70);
    boss.intent = { t: 'wind' };
    resting(s, 'grunt', 150, 60);
    enemyPhaseOnly(s);
    expect(s.beltWound).toBe(true);
    expect(boss.y - 70).toBeGreaterThan(MAINSPRING_MOVE_DIST - 10);
    expect(boss.y - 70).toBeLessThan(MAINSPRING_MOVE_DIST + 10);
    boss.intent = { t: 'rest' };
    s.balls[0].x = 40;
    s.balls[0].y = 200;
    expect(beltPreview(s)!.x).toBeCloseTo(88, 6);
    const fx = enemyPhaseOnly(s);
    expect(s.balls[0].x).toBeCloseTo(88, 6);
    expect(belts(fx).find((f) => Math.abs(f.y - 200) < 1e-6)!.dx).toBeCloseTo(48, 6);
    expect(s.beltWound).toBe(false);
  });
  it('phase 2 (50 %) reverses every belt once, with beltReverse right after bossPhase; other bosses do not', () => {
    const s = clab([belt(90, 100, 100, 20, 1, 0), belt(40, 180, 20, 80, 0, -1)], 90, 270, {}, 'w3s1');
    const boss = put(s, 'boss', 120, 220);
    const fx: FxEvent[] = [];
    applyDamage(s, boss, boss.hp - Math.floor(boss.maxHp / 2), 'main', fx);
    const i = fx.findIndex((f) => f.t === 'bossPhase');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(fx[i + 1]).toEqual({ t: 'beltReverse' });
    expect(s.hazards.map((z) => [z.dx, z.dy])).toEqual([[-1, 0], [0, 1]]);
    applyDamage(s, boss, 1, 'main', fx);
    expect(fx.filter((f) => f.t === 'beltReverse').length).toBe(1);
    // Big Stripe (w1) keeps its v0.4 kit.
    const w1 = clab([belt(90, 100, 100, 20, 1, 0)], 90, 270, {}, 'w1s2');
    const bs = put(w1, 'boss', 120, 220);
    const f1: FxEvent[] = [];
    applyDamage(w1, bs, bs.hp - Math.floor(bs.maxHp / 2), 'main', f1);
    expect(f1.some((f) => f.t === 'beltReverse')).toBe(false);
    expect(w1.hazards[0].dx).toBe(1);
  });
  it('phase 2: Summon makes cogs (cap 2, pay 1, never count for the clear); weight 0 at the cap', () => {
    const s = clab([], 90, 280, {}, 'w3s1');
    const boss = put(s, 'boss', 90, 70);
    boss.phase = 1;
    const g = resting(s, 'grunt', 30, 250);
    for (let k = 0; k < 3; k++) {
      boss.intent = { t: 'summon' };
      for (const t of s.targets) if (t !== boss) t.intent = { t: 'rest' };
      enemyPhaseOnly(s);
    }
    const cogs = s.targets.filter((t) => !t.dead && t.kind === 'cog');
    expect(cogs.length).toBe(2);
    for (const c of cogs) expect([c.summon, c.cashBase]).toEqual([true, 1]);
    expect(liveRegulars(s)).toBe(2); // boss + grunt
    expect(g.dead).toBe(false);
    for (let i = 0; i < 60; i++) {
      boss.charged = false;
      rollIntentForTest(s, boss);
      expect(boss.intent.t).not.toBe('summon');
    }
    const fx: FxEvent[] = [];
    kill(s, cogs[0], 'main', fx);
    const st = stageById('w3s1');
    expect(fx.find((f) => f.t === 'kill')).toMatchObject({ cash: Math.round(1 * st.cashScale) });
  });
  it('phase 1 rolls Attack / Advance / Wind; other bosses never Wind', () => {
    const s = clab([], 90, 280, {}, 'w3s1');
    const boss = put(s, 'boss', 90, 70);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      rollIntentForTest(s, boss);
      seen.add(boss.intent.t);
    }
    expect([...seen].sort()).toEqual(['advance', 'attack', 'wind']);
    const w = lab();
    const b2 = put(w, 'boss', 90, 70);
    for (let i = 0; i < 200; i++) {
      rollIntentForTest(w, b2);
      expect(b2.intent.t).not.toBe('wind');
    }
  });
});

describe('v0.5 Clockwork: determinism', () => {
  it('same seed + same shots on a belt + gear stage => identical state; fast-forward matches', () => {
    const go = (dt: number, seed: number) => {
      const s = createRun('w3s4', BASE_STATS, seed);
      for (const p of SHOTS) {
        if (s.phase !== 'aim') break;
        shoot(s, p);
        untilSettled(s, dt);
      }
      return s;
    };
    for (const seed of [3, 8]) {
      expect(snapshot(go(SIM_DT, seed))).toEqual(snapshot(go(SIM_DT, seed)));
      const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT, seed));
      const { t: _b, ...normal } = snapshot(go(SIM_DT, seed));
      expect(ff).toEqual(normal);
    }
  });
});

// ---------- v0.6 M1: the Loot Goblin (replaces Overtime) and boss tokens ----------

/** Loot phase on an empty w1s1 table: hero at (hx,hy), goblin moved to (gx,gy), arrival hold run down (aim). */
function lootLab(stats: RunStats = BASE_STATS, hx = 90, hy = 240, gx = 90, gy = 150, seed = 42) {
  const s = createRun('w1s1', { ...stats }, seed);
  s.targets = [];
  s.obstacles = [];
  s.balls[0].x = hx;
  s.balls[0].y = hy;
  s.bossKilled = true;
  startLoot(s, []);
  const g = s.targets[0];
  g.x = gx;
  g.y = gy;
  untilSettled(s);
  return { s, g };
}

/** Pull toward (x,y) from the hero at `power` (0..1). */
function aimAt(s: RunState, x: number, y: number, power = 1): Vec {
  const h = s.balls[0];
  const d = Math.hypot(x - h.x, y - h.y) || 1;
  return { x: ((x - h.x) / d) * MAX_PULL * power, y: ((y - h.y) / d) * MAX_PULL * power };
}

describe('v0.6 loot goblin', () => {
  it('loot: boss death ends the waves', () => {
    const s = lab(90, 240);
    s.wave = 4;
    s.bossSpawned = true;
    const boss = put(s, 'boss', 90, 150);
    boss.hp = 1;
    const escort = put(s, 'grunt', 30, 60);
    escort.intent = { t: 'attack', n: 3 };
    const cash0 = s.cash;
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    const phases = new Set<string>();
    while (s.phase !== 'aim' && s.phase !== 'over') {
      fx.push(...step(s, SIM_DT));
      phases.add(s.phase);
    }
    const dead = fx.findIndex((f) => f.t === 'bossDead');
    expect(dead).toBeGreaterThanOrEqual(0);
    expect(phases.has('enemy')).toBe(false);
    expect(fx.slice(dead).some((f) => f.t === 'waveStart')).toBe(false);
    expect(s.targets.map((t) => t.kind)).toEqual(['goblin']);
    expect(s.targets[0].intent.t).toBe('flee');
    expect(s.pulls).toBe(3);
    expect(fx.filter((f) => f.t === 'lootStart').length).toBe(1);
    expect(fx.filter((f) => f.t === 'boardClear').length).toBe(1);
    const killCash = fx.reduce((a, f) => a + (f.t === 'kill' ? f.cash : 0), 0);
    expect(s.cash - cash0).toBe(killCash + WAVE_CASH * 4);
    expect(s.wave).toBe(4);
    // A boss killed in the enemy phase: the escort never acts again and the turn ends in the loot phase.
    const e = lab(90, 240);
    e.wave = 4;
    e.bossSpawned = true;
    const b2 = put(e, 'boss', 90, 100);
    b2.hp = 1;
    b2.poison = 3;
    const g2 = put(e, 'grunt', 90, 180);
    g2.intent = { t: 'attack', n: 3 };
    e.stats = { ...e.stats, relics: ['poison'] };
    const fx2 = enemyPhaseOnly(e);
    expect(fx2.some((f) => f.t === 'bossDead')).toBe(true);
    expect(fx2.some((f) => f.t === 'launch')).toBe(false);
    expect(fx2.slice(fx2.findIndex((f) => f.t === 'bossDead')).some((f) => f.t === 'waveStart')).toBe(false);
    expect(e.phase).toBe('aim');
    expect(e.targets.map((t) => t.kind)).toEqual(['goblin']);
  });

  it('loot: hits debounce', () => {
    // A press into a goblin parked on the rail: one hit.
    {
      const { s } = lootLab(BASE_STATS, 90, 90, 90, TABLE.y + 13);
      shoot(s, aimAt(s, 90, 0, MIN_POWER));
      untilSettled(s);
      expect(s.goblinHits).toBe(1);
    }
    // Full power from below, near the top rail: the goblin returns off the rail into the hero: two hits.
    {
      const { s } = lootLab(BASE_STATS, 90, 200, 90, 100);
      shoot(s, aimAt(s, 90, 100));
      untilSettled(s);
      expect(s.goblinHits).toBe(2);
    }
    // Relics and tricks never add hits, damage, stagger, statuses or combo hits.
    const kit: RunStats = { ...BASE_STATS, relics: ['lightning', 'explosive', 'poison', 'chill', 'static'], lightningChance: 1, lightningArcs: 2, lightningRange: 200, lightningDamage: 3, trick: 'shockwave', trickUses: 2, heavyHits: 1 };
    const { s, g } = lootLab(kit, 90, 240, 90, 200);
    expect(useTrick(s)).toBe(false);
    shoot(s, aimAt(s, 90, 200, MIN_POWER));
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') fx.push(...step(s, SIM_DT));
    expect(s.goblinHits).toBe(1);
    expect(s.combo.hits).toBe(0);
    expect(g.stagger).toBe(0);
    expect(g.poison ?? 0).toBe(0);
    expect(g.chill ?? 0).toBe(0);
    expect(g.hp).toBe(Infinity);
    expect(fx.some((f) => f.t === 'lightning' || f.t === 'blast' || f.t === 'hit' || f.t === 'stagger')).toBe(false);
  });

  it('loot: scurry geometry', () => {
    const go = (hx: number, hy: number, gx: number, gy: number, bumper?: [number, number]) => {
      const { s, g } = lootLab(BASE_STATS, hx, hy, gx, gy);
      if (bumper) s.obstacles.push({ id: s.nextId++, kind: 'bumper', x: bumper[0], y: bumper[1], r: 6, hp: Infinity, flash: 0, dead: false });
      s.shotGoblinHits = 0;
      s.goblinHits = 1;
      const fx: FxEvent[] = [];
      endLootShot(s, fx);
      const sc = fx.find((f) => f.t === 'scurry');
      return { s, g, sc };
    };
    const a = go(90, 240, 90, 150, [90, 100]);
    expect([a.g.x, a.g.y]).toEqual([90, 47]);
    expect(a.g.resting).toBe(true);
    expect(a.sc).toEqual({ t: 'scurry', id: a.g.id, x: 90, y: 47, x0: 90, y0: 150 });
    expect(a.s.phase).toBe('loot');
    expect(canFastForward(a.s)).toBe(true);
    const b = go(60, 240, 90, 47);
    expect([b.g.x, b.g.y]).toEqual([157, 47]);
    expect(scurryDest(90, 150, 13, 90, 150)).toEqual({ x: 90, y: 47 });
    // Into a corner: stays (a 0 px scurry still emits its fx).
    const c = go(120, 100, 23, 47);
    expect([c.g.x, c.g.y]).toEqual([23, 47]);
    expect(c.sc).toBeDefined();
    // No hit this pull: no scurry.
    const { s, g } = lootLab(BASE_STATS, 90, 240, 90, 150);
    const fx: FxEvent[] = [];
    s.shotGoblinHits = 0;
    endLootShot(s, fx);
    expect([g.x, g.y]).toEqual([90, 150]);
    expect(fx.some((f) => f.t === 'scurry')).toBe(false);
  });

  it('loot: loot draw is seeded', () => {
    const draw = (seed: number) => {
      const { s, g } = lootLab(BASE_STATS, 90, 240, 90, 150, seed);
      const fx: FxEvent[] = [];
      for (let i = 0; i < 300; i++) goblinHit(s, g, fx);
      return { s, cash: fx.flatMap((f) => (f.t === 'goblinHit' ? [f.cash] : [])), tiers: fx.flatMap((f) => (f.t === 'goblinHit' ? [f.tier] : [])) };
    };
    const a = draw(5);
    const b = draw(5);
    expect(a.s.loot).toBe(b.s.loot);
    expect(a.cash).toEqual(b.cash);
    expect(a.s.loot).not.toBe(draw(6).s.loot);
    expect(new Set(a.cash)).toEqual(new Set([2, 6, 18]));
    for (let i = 0; i < a.cash.length; i++) expect(a.cash[i]).toBe({ small: 2, big: 6, jackpot: 18 }[a.tiers[i]]);
    expect(a.s.loot).toBe(a.cash.reduce((x, y) => x + y, 0));
  });

  it('loot: golden tooth on the 4th hit across pulls (one multi-hit needed)', () => {
    const run = (perPull: number[]) => {
      const s = lab(90, 240);
      const boss = put(s, 'boss', 90, 100);
      kill(s, boss, 'main', []);
      expect(s.tokens).toBe(1);
      s.targets = [];
      const fx: FxEvent[] = [];
      startLoot(s, fx);
      untilSettled(s);
      const g = s.targets[0];
      for (const n of perPull) {
        shoot(s, { x: 0, y: MAX_PULL });
        // A dead pull (the hero never rolls); the hits are scored directly.
        s.balls[0].vx = 0;
        s.balls[0].vy = 0;
        s.balls[0].resting = true;
        for (let i = 0; i < n; i++) goblinHit(s, g, fx);
        fx.push(...untilSettled(s));
      }
      return { s, fx };
    };
    const a = run([1, 3]);
    expect(a.s.tokens).toBe(2);
    expect(a.s.tooth).toBe(true);
    expect(a.fx.filter((f) => f.t === 'tooth').length).toBe(1);
    expect(a.fx.filter((f) => f.t === 'token').length).toBe(1);
    const b = run([1, 1, 1]);
    expect(b.s.tokens).toBe(1);
    expect(b.s.tooth).toBe(false);
    expect(b.fx.some((f) => f.t === 'tooth')).toBe(false);
    expect(b.s.phase).toBe('over');
    expect(b.s.result?.tooth).toBe(false);
  });

  it("loot: run ends after the third pull's balls stop", () => {
    const stats: RunStats = { ...BASE_STATS, relics: ['split'], splitCount: 2 };
    const { s, g } = lootLab(stats, 90, 240, 90, 150);
    let sawSplit = false;
    const fx: FxEvent[] = [];
    for (let pull = 0; pull < 3; pull++) {
      expect(s.phase).toBe('aim');
      shoot(s, aimAt(s, g.x, g.y));
      while (s.phase !== 'aim' && s.phase !== 'over') {
        fx.push(...step(s, SIM_DT));
        if (s.balls.some((b) => b.kind === 'split')) sawSplit = true;
        if ((s.phase as string) === 'over') expect(s.balls.every((b) => b.kind === 'main')).toBe(true);
      }
    }
    expect(sawSplit).toBe(true);
    expect(s.phase).toBe('over');
    expect(s.pulls).toBe(0);
    expect(fx.filter((f) => f.t === 'lootEnd')).toEqual([{ t: 'lootEnd', cash: s.loot, hits: s.goblinHits }]);
    expect(fx.some((f) => f.t === 'runOver')).toBe(false);
    expect(s.result?.loot).toBe(s.loot);
    expect(s.result?.goblinHits).toBe(s.goblinHits);
    expect(s.result?.bossKilled).toBe(true);
    expect(s.result?.wavesCleared).toBe(4);
    expect(s.goblinHits).toBeGreaterThan(0);
  });

  it('tokens: drop rule', () => {
    const killBoss = (stage: string, bestWave?: number) => {
      const s = createRun(stage, { ...BASE_STATS, tokenId: 'frost' }, 1, bestWave);
      const boss = makeEnemy(s, 'boss', 90, 100);
      s.targets = [boss];
      const fx: FxEvent[] = [];
      kill(s, boss, 'main', fx);
      return { s, fx };
    };
    expect(killBoss('w1s1').s.tokens).toBe(1);
    expect(killBoss('w1s4', 0).s.tokens).toBe(3);
    expect(killBoss('w1s4', 3).s.tokens).toBe(3);
    expect(killBoss('w1s4', 4).s.tokens).toBe(1);
    expect(killBoss('w1s3', 0).s.tokens).toBe(1);
    expect(killBoss('w1s4', 0).fx.filter((f) => f.t === 'token')).toEqual([{ t: 'token', x: 90, y: 100, amount: 3 }]);
    const { s } = killBoss('w1s4', 0);
    const r = buildResult(s);
    expect(r.tokenId).toBe(s.stats.tokenId);
    expect(r.tokenId).toBe('frost');
    expect(r.tokens).toBe(3);
  });

  it('loot: cue rules and fast-forward', () => {
    const firstHit = (stats: RunStats, gy = 150) => {
      const { s } = lootLab(stats, 90, 240, 90, gy);
      shoot(s, aimAt(s, 90, gy));
      const v0 = s.launch!.speed;
      while (s.phase === 'resolve') {
        const fx = step(s, SIM_DT);
        if (fx.some((f) => f.t === 'goblinHit')) return { s, h: s.balls[0], v0 };
      }
      throw new Error('no goblin hit');
    };
    // Jump: the goblin is struck, never jumped.
    const j = firstHit({ ...BASE_STATS, cue: 'jump' });
    expect(j.h.jumpOver).toBeUndefined();
    expect(j.s.goblinHits).toBe(1);
    expect(j.s.firstHitDone).toBe(true);
    // Sticky: the hero does not stop dead on the goblin.
    const st = firstHit({ ...BASE_STATS, ballType: 'sticky' });
    expect(Math.hypot(st.h.vx, st.h.vy)).toBeGreaterThan(20);
    expect(st.s.stickyUsed).toBe(false);
    // Draw: back toward the launch point at DRAW_RETURN x launch speed.
    const d = firstHit({ ...BASE_STATS, cue: 'draw' });
    expect(d.h.vy).toBeGreaterThan(0);
    expect(Math.abs(d.h.vx)).toBeLessThan(1);
    expect(Math.hypot(d.h.vx, d.h.vy) / d.v0).toBeCloseTo(0.5, 1);
    // Tricks off; fast-forward through the holds.
    const { s } = lootLab({ ...BASE_STATS, trick: 'recall', trickUses: 1 });
    expect(useTrick(s)).toBe(false);
    shoot(s, aimAt(s, 90, 150));
    while (s.phase === 'resolve') step(s, SIM_DT);
    expect(s.phase).toBe('loot');
    expect(canFastForward(s)).toBe(true);
  });
});

describe('v0.6 determinism across the loot phase', () => {
  it('same seed + same shots through the boss kill and a scurry hold => identical state; fast-forward matches', () => {
    const go = (dt: number, seed: number) => {
      const s = createRun('w1s1', { ...BASE_STATS, damage: 99, maxHp: 999 }, seed);
      let scurries = 0;
      while ((s.phase === 'aim' || s.phase === 'loot') && s.shots < 120) {
        if (s.phase === 'loot') {
          step(s, dt);
          continue;
        }
        const h = s.balls[0];
        const tg = s.targets.filter((t) => !t.dead).reduce((a, b) => (Math.hypot(b.x - h.x, b.y - h.y) < Math.hypot(a.x - h.x, a.y - h.y) ? b : a));
        shoot(s, aimAt(s, tg.x, tg.y));
        for (const f of untilSettled(s, dt)) if (f.t === 'scurry') scurries++;
      }
      return { s, scurries };
    };
    for (const seed of [2, 9]) {
      const a = go(SIM_DT, seed);
      expect(a.s.phase).toBe('over');
      expect(a.scurries).toBeGreaterThan(0);
      expect(snapshot(a.s)).toEqual(snapshot(go(SIM_DT, seed).s));
      const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT, seed).s);
      const { t: _b, ...normal } = snapshot(a.s);
      expect(ff).toEqual(normal);
      expect(go(SIM_DT * FAST_FORWARD_MULT, seed).s.loot).toBe(a.s.loot);
    }
  });
});

// ---------- v0.6 M3: world-1 forks and capstones (stats.mods) ----------
import {
  ANCHOR_DMG,
  ANVIL_MULT,
  AVALANCHE_BUMP,
  BLINK_MARGIN,
  BREAK_SPEED_MULT_LV,
  BREAKER_SHOVE,
  LANTERN_R_LV,
  LAUNCH_MULT_CAP,
  MOMENTUM_MAX,
  OVERDRIVE_MULT,
  POCKET_MULT,
  SLAM_MIN_POWER,
  SLAM_MULT,
  SNOWBALL_CASH,
  WRECK_SHOVE,
  gearVal,
} from '../src/core/tuning';

/** glab with `mods` active. */
function mlab(mods: string[], over: Partial<RunStats> = {}, x = 90, y = 240): RunState {
  return glab({ ...over, mods }, x, y);
}
const enemySpeed = (t: Target) => Math.hypot(t.vx, t.vy);
/** Enemy speed right after the hero's first contact of a shot with `pull`. */
function firstHitShove(mods: string[], over: Partial<RunStats>, pull: Vec): { t: Target; s: RunState; v: number } {
  const s = mlab(mods, over, 90, 240);
  const t = put(s, 'grunt', 90, 170);
  t.hp = t.maxHp = 20;
  t.intent = { t: 'rest' };
  shoot(s, pull);
  untilFirstHit(s);
  return { t, s, v: enemySpeed(t) };
}
/** A one-rail shot (down, back up into a grunt) with `extra` rails credited before contact. */
function bankShot(mods: string[], over: Partial<RunStats>, extra: number, hp = 20): { s: RunState; g: Target; fx: FxEvent[] } {
  const s = mlab(mods, { relics: ['ricochet'], gearLevel: { ricochet: 3 }, ...over }, 90, 230);
  const g = put(s, 'grunt', 90, 120);
  g.hp = g.maxHp = hp;
  g.cashBase = 10;
  g.intent = { t: 'rest' };
  shoot(s, { x: 0, y: MAX_PULL });
  s.shotBounces += extra;
  const fx = untilFirstHit(s);
  return { s, g, fx };
}
const thinStage = () => allStageIds(1).map(makeStage).find((st) => st.modifiers.includes('thinRails') && st.world !== 3)!.id;

describe('v0.6 M3: break cue', () => {
  it('break.slam: launch x1.1 and at least 60 % power', () => {
    const s = mlab(['break.slam'], { cue: 'break', gearLevel: { break: 2 } });
    shoot(s, { x: 0, y: -13 });
    expect(speedOf(s)).toBeCloseTo(SLAM_MIN_POWER * MAX_LAUNCH_SPEED * gearVal(BREAK_SPEED_MULT_LV, 2) * SLAM_MULT, 6);
    expect(SLAM_MULT).toBe(1.1);
    expect(SLAM_MIN_POWER).toBe(0.6);
  });
  it('break.crack: the first hit staggers 2, later contacts 1; launch speed unchanged', () => {
    const on = firstHitShove(['break.crack'], { cue: 'break', gearLevel: { break: 2 } }, { x: 0, y: -MAX_PULL / 2 });
    const off = firstHitShove([], { cue: 'break', gearLevel: { break: 2 } }, { x: 0, y: -MAX_PULL / 2 });
    expect(on.t.stagger).toBe(2);
    expect(off.t.stagger).toBe(1);
    expect(on.s.launch!.speed).toBeCloseTo(off.s.launch!.speed, 9);
  });
  it('break.breaker: the first contact shoves the enemy x2', () => {
    const pull = { x: 0, y: -MAX_PULL / 2 };
    const on = firstHitShove(['break.breaker'], { cue: 'break', gearLevel: { break: 3 } }, pull);
    const off = firstHitShove([], { cue: 'break', gearLevel: { break: 3 } }, pull);
    expect(on.v / off.v).toBeCloseTo(BREAKER_SHOVE, 1);
    expect(on.t.hp).toBe(off.t.hp);
  });
  it('break.steady: the sim leaves the aim preview to meta (Break with Steady previews)', () => {
    const s = mlab(['break.steady'], { cue: 'break', gearLevel: { break: 3 }, aimPreview: 2 });
    expect(previewShot(s, { x: 0, y: -MAX_PULL }).length).toBeGreaterThan(1);
  });
});

describe('v0.6 M3: heavy ball', () => {
  it('heavy.anvil: the first hit deals x2 and stops the hero dead', () => {
    const on = firstHitShove(['heavy.anvil'], { ballType: 'heavy', gearLevel: { heavy: 2 } }, { x: 0, y: -MAX_PULL });
    expect(on.t.hp).toBe(20 - (1 + 1) * ANVIL_MULT);
    expect(speedOf(on.s)).toBe(0);
    const off = firstHitShove([], { ballType: 'heavy', gearLevel: { heavy: 2 } }, { x: 0, y: -MAX_PULL });
    expect(off.t.hp).toBe(20 - 2);
  });
  it('heavy.wrecking: no +1 damage, every contact shoves x1.5', () => {
    const pull = { x: 0, y: -MAX_PULL / 2 };
    const on = firstHitShove(['heavy.wrecking'], { ballType: 'heavy', gearLevel: { heavy: 2 } }, pull);
    const off = firstHitShove([], { ballType: 'heavy', gearLevel: { heavy: 2 } }, pull);
    expect(on.t.hp).toBe(20 - 1);
    expect(off.t.hp).toBe(20 - 2);
    expect(on.v / off.v).toBeCloseTo(WRECK_SHOVE, 1);
  });
  it('heavy.jugger: the first charge of the wave is blocked, the second lands', () => {
    const s = mlab(['heavy.jugger'], { ballType: 'heavy', gearLevel: { heavy: 3 } }, 90, 240);
    const a = put(s, 'grunt', 90, 170);
    const b = put(s, 'grunt', 150, 240);
    a.intent = { t: 'attack', n: 2 };
    b.intent = { t: 'attack', n: 3 };
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'blocked').length).toBe(1);
    expect(s.hp).toBe(BASE_STATS.maxHp - 3);
    expect(s.juggerUsed).toBe(true);
  });
  it('heavy.avalanche: a bump during the shot deals 2 (1 without)', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { ballType: 'heavy', gearLevel: { heavy: 3 } }, 90, 270);
      const a = put(s, 'grunt', 40, 100);
      const b = put(s, 'grunt', 100, 100);
      for (const e of [a, b]) ((e.hp = e.maxHp = 20), (e.intent = { t: 'rest' }));
      shoot(s, { x: 0, y: 20 });
      s.balls[0].vx = s.balls[0].vy = 0;
      s.balls[0].resting = true;
      a.vx = 300;
      a.resting = false;
      while (s.phase === 'resolve') step(s, SIM_DT);
      return b;
    };
    expect(run(['heavy.avalanche']).hp).toBe(20 - AVALANCHE_BUMP);
    expect(run([]).hp).toBe(20 - 1);
  });
});

describe('v0.6 M3: ricochet', () => {
  it('ricochet.bank: one rail +0, two rails +2 each', () => {
    expect(bankShot(['ricochet.bank'], {}, 0).g.hp).toBe(20 - 1);
    expect(bankShot([], {}, 0).g.hp).toBe(20 - 2);
    const two = bankShot(['ricochet.bank'], {}, 1);
    expect(two.s.shotBounces).toBe(2);
    expect(two.g.hp).toBe(20 - 1 - 4);
  });
  it('ricochet.carom: hero contacts count as rails, rails count after the first hit, every contact gets the bonus (2nd contact +2)', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { relics: ['ricochet'], gearLevel: { ricochet: 3 } }, 90, 240);
      const g = put(s, 'grunt', 90, 170);
      g.hp = g.maxHp = 40;
      g.intent = { t: 'rest' };
      shoot(s, { x: 15, y: -MAX_PULL }); // grunt, top rail, grunt again
      const hits: { dmg: number; bounces: number }[] = [];
      while (s.phase === 'resolve') {
        for (const f of step(s, SIM_DT)) if (f.t === 'hit' && f.ballKind === 'main') hits.push({ dmg: f.dmg, bounces: s.shotBounces });
      }
      return hits;
    };
    const on = run(['ricochet.carom']);
    expect(on.length).toBe(2);
    expect(on.map((h) => h.dmg)).toEqual([1, 1 + 2]);
    expect(on.map((h) => h.bounces)).toEqual([1, 3]);
    expect(run([]).map((h) => h.dmg)).toEqual([1, 1]);
  });
  it('ricochet.pocket: a 2-rail first hit makes the shot\'s kills pay x2', () => {
    const on = bankShot(['ricochet.pocket'], {}, 1, 1);
    const off = bankShot(['ricochet.pocket'], {}, 0, 1);
    expect(on.g.dead && off.g.dead).toBe(true);
    expect(on.s.cash).toBe(off.s.cash * POCKET_MULT);
    expect(on.fx.some((f) => f.t === 'combo' && f.name === 'POCKET')).toBe(true);
    expect(off.fx.some((f) => f.t === 'combo' && f.name === 'POCKET')).toBe(false);
  });
  it('ricochet.ghost: the hero banks at full speed on Thin Rails until its first hit', () => {
    const run = (mods: string[]) => {
      const s = createRun(thinStage(), { ...BASE_STATS, relics: ['ricochet'], gearLevel: { ricochet: 3 }, mods }, 42);
      s.targets = [];
      s.obstacles = [];
      s.balls[0].x = 90;
      s.balls[0].y = 230;
      shoot(s, { x: 0, y: MAX_PULL });
      let pre = 0;
      for (;;) {
        pre = speedOf(s);
        if (step(s, SIM_DT).some((f) => f.t === 'wall')) break;
      }
      return speedOf(s) / pre;
    };
    expect(run(['ricochet.ghost'])).toBeGreaterThan(0.97);
    expect(run([])).toBeLessThan(THIN_RAILS_BOUNCE + 0.02);
  });
});

describe('v0.6 M3: momentum', () => {
  it('momentum.streak: a 1-hit shot holds Momentum, a 0-hit shot resets it', () => {
    const s = mlab(['momentum.streak'], { relics: ['momentum'], gearLevel: { momentum: 2 } }, 90, 230);
    s.momentum = 2;
    const g = put(s, 'brute', 90, 150);
    g.hp = g.maxHp = 40;
    g.intent = { t: 'rest' };
    shoot(s, { x: 0, y: -MAX_PULL });
    untilSettled(s);
    expect(s.combo.hits).toBe(1);
    expect(s.momentum).toBe(2);
    s.targets.forEach((t) => (t.intent = { t: 'rest' }));
    shoot(s, { x: 0, y: MAX_PULL / 4 });
    untilSettled(s);
    expect(s.combo.hits).toBe(0);
    expect(s.momentum).toBe(0);
  });
  it('momentum.snowball: kill cash x1.1 at Momentum 2', () => {
    const cashAt = (mods: string[]) => {
      const s = mlab(mods, { relics: ['momentum'], gearLevel: { momentum: 2 } });
      s.momentum = 2;
      const g = put(s, 'grunt', 90, 100);
      g.cashBase = 20 / stageById('w1s1').cashScale;
      kill(s, g, 'main', []);
      return s.cash;
    };
    expect(cashAt([])).toBe(20);
    expect(cashAt(['momentum.snowball'])).toBe(Math.round(20 * (1 + SNOWBALL_CASH * 2)));
    expect(cashAt(['momentum.snowball'])).toBe(22);
  });
  it('momentum.unstop: at 3 a hero hit pops a 1-hit shield and still lands; the cadre shield holds', () => {
    const s = mlab(['momentum.unstop'], { relics: ['momentum'], gearLevel: { momentum: 3 } });
    s.momentum = 3;
    const g = put(s, 'grunt', 90, 100);
    g.hp = g.maxHp = 10;
    g.shield = 1;
    const fx: FxEvent[] = [];
    applyDamage(s, g, 4, 'main', fx);
    expect(g.shield).toBe(0);
    expect(g.hp).toBe(6);
    expect(fx.some((f) => f.t === 'shieldBreak')).toBe(true);
    // Below 3 the shield eats the hit.
    s.momentum = 2;
    g.shield = 1;
    applyDamage(s, g, 4, 'main', fx);
    expect(g.hp).toBe(6);
    // Split/spat never pierce.
    s.momentum = 3;
    g.shield = 1;
    applyDamage(s, g, 4, 'split', fx);
    expect(g.hp).toBe(6);
    // Cadre shield (boss shielded): no damage at any Momentum.
    const boss = put(s, 'boss', 90, 60);
    const hp = boss.hp;
    boss.shielded = true;
    applyDamage(s, boss, 4, 'main', fx);
    expect(boss.hp).toBe(hp);
  });
  it('momentum.overdrive: x1.1 launch at max Momentum; cue x Slam x Overdrive capped at 1.4', () => {
    const s = mlab(['momentum.overdrive'], { relics: ['momentum'], gearLevel: { momentum: 3 } });
    s.momentum = gearVal(MOMENTUM_MAX, 3);
    shoot(s, { x: 0, y: -MAX_PULL });
    expect(speedOf(s)).toBeCloseTo(MAX_LAUNCH_SPEED * OVERDRIVE_MULT, 6);
    const u = mlab(['momentum.overdrive'], { relics: ['momentum'], gearLevel: { momentum: 3 } });
    u.momentum = gearVal(MOMENTUM_MAX, 3) - 1;
    shoot(u, { x: 0, y: -MAX_PULL });
    expect(speedOf(u)).toBeCloseTo(MAX_LAUNCH_SPEED, 6);
    const c = mlab(['momentum.overdrive', 'break.slam'], { cue: 'break', relics: ['momentum'], gearLevel: { momentum: 3, break: 3 } });
    c.momentum = gearVal(MOMENTUM_MAX, 3);
    shoot(c, { x: 0, y: -MAX_PULL });
    expect(LAUNCH_MULT_CAP).toBe(1.4);
    expect(speedOf(c)).toBeCloseTo(MAX_LAUNCH_SPEED * LAUNCH_MULT_CAP, 6);
  });
});

describe('v0.6 M3: recall', () => {
  it('recall.blink: the hero lands on the nearest spot outside every attacker\'s reach (shooters ignored)', () => {
    const s = mlab(['recall.blink'], { trick: 'recall', trickUses: 1 }, 90, 130);
    const g = put(s, 'grunt', 90, 80);
    g.intent = { t: 'attack', n: 3 };
    const k = put(s, 'skirmisher', 60, 230);
    k.intent = { t: 'shoot', n: 2 };
    expect(useTrick(s)).toBe(true);
    const h = s.balls[0];
    const gap = Math.hypot(h.x - g.x, h.y - g.y) - h.r - g.r;
    expect(gap).toBeGreaterThan(TARGET_DEFS.grunt.reach + BLINK_MARGIN);
    expect(gap).toBeLessThan(TARGET_DEFS.grunt.reach + BLINK_MARGIN + 6);
    expect(Math.hypot(h.x - 90, h.y - 130)).toBeLessThan(120);
    // Nobody in reach can be escaped within 300 px: the start spot.
    const t = mlab(['recall.blink'], { trick: 'recall', trickUses: 1 }, 90, 200);
    put(t, 'grunt', 90, 150).intent = { t: 'attack', n: 3 };
    useTrick(t);
    expect(t.balls[0].y).toBeCloseTo(TABLE.y + TABLE.h - 24, 6);
  });
  it('recall.rewind: back to the last launch point; no launch yet = the start spot', () => {
    const s = mlab(['recall.rewind'], { trick: 'recall', trickUses: 2 }, 60, 200);
    put(s, 'grunt', 30, 50).intent = { t: 'rest' };
    shoot(s, { x: 20, y: 20 });
    untilSettled(s);
    expect(s.balls[0].x !== 60 || s.balls[0].y !== 200).toBe(true);
    expect(useTrick(s)).toBe(true);
    expect(s.balls[0].x).toBeCloseTo(60, 6);
    expect(s.balls[0].y).toBeCloseTo(200, 6);
    const t = mlab(['recall.rewind'], { trick: 'recall', trickUses: 1 }, 40, 100);
    useTrick(t);
    expect(t.balls[0].x).toBeCloseTo(TABLE.x + TABLE.w / 2, 6);
    expect(t.balls[0].y).toBeCloseTo(TABLE.y + TABLE.h - 24, 6);
  });
  it('recall.encore: one free Recall a wave, then the paid uses', () => {
    const s = mlab(['recall.encore'], { trick: 'recall', trickUses: 1 }, 40, 100);
    expect(useTrick(s)).toBe(true);
    expect(s.trickUsesLeft).toBe(1);
    expect(useTrick(s)).toBe(true);
    expect(s.trickUsesLeft).toBe(0);
    expect(useTrick(s)).toBe(false);
    s.wave = 2;
    expect(useTrick(s)).toBe(true);
    expect(useTrick(s)).toBe(false);
  });
  it('recall.anchor: the next shot deals +2 on hero contacts; the one after does not', () => {
    const s = mlab(['recall.anchor'], { trick: 'recall', trickUses: 1 }, 40, 100);
    expect(useTrick(s)).toBe(true);
    const h = s.balls[0];
    const g = put(s, 'brute', h.x, h.y - 80);
    g.hp = g.maxHp = 40;
    g.intent = { t: 'rest' };
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(g.hp).toBe(40 - 1 - ANCHOR_DMG);
    untilSettled(s);
    s.targets = [];
    const c = put(s, 'brute', h.x, h.y - 80);
    c.hp = c.maxHp = 40;
    c.intent = { t: 'rest' };
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(c.hp).toBe(40 - 1);
  });
});

describe('v0.6 M3: lantern', () => {
  const lit = (mods: string[], gx: number, gy: number, hx = 90, hy = 240) => {
    const s = mlab(mods, { relics: ['lantern'], gearLevel: { lantern: 2 } }, hx, hy);
    expect(s.dark).toBe(false);
    const g = put(s, 'grunt', gx, gy);
    g.cashBase = 20 / stageById('w1s1').cashScale;
    kill(s, g, 'main', []);
    return s.cash;
  };
  it('lantern.beacon: off dark, kills within reach pay +10 %/level (+20 % at II); beyond reach plain', () => {
    expect(gearVal(LANTERN_R_LV, 2)).toBe(120);
    expect(lit(['lantern.beacon'], 90, 240 - 24 - 100)).toBe(24);
    expect(lit(['lantern.beacon'], 90, 240 - 24 - 140)).toBe(20);
    expect(lit([], 90, 240 - 24 - 100)).toBe(20);
  });
  it('lantern.glare: the nearest queued shooter in reach rests; the other shoots', () => {
    const s = mlab(['lantern.glare'], { relics: ['lantern'], gearLevel: { lantern: 2 }, maxHp: 50 }, 90, 240);
    s.hp = s.maxHp = 50;
    const near = put(s, 'skirmisher', 40, 200);
    const far = put(s, 'skirmisher', 140, 160);
    for (const k of [far, near]) k.intent = { t: 'shoot', n: 2 };
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'tracer').length).toBe(1);
    expect(fx.some((f) => f.t === 'tracer' && f.x0 === far.x)).toBe(true);
    expect(fx.filter((f) => f.t === 'blocked').length).toBe(1);
    expect(s.hp).toBe(50 - 2);
  });
  it('lantern.sunrise: Beacon pays across the whole table', () => {
    const hx = TABLE.x + 12;
    const hy = TABLE.y + TABLE.h - 12;
    const gx = TABLE.x + TABLE.w - 12;
    const gy = TABLE.y + 12;
    expect(Math.hypot(gx - hx, gy - hy) - 24).toBeGreaterThan(240);
    expect(lit(['lantern.beacon', 'lantern.sunrise'], gx, gy, hx, hy)).toBe(24);
    expect(lit(['lantern.beacon'], gx, gy, hx, hy)).toBe(20);
  });
  it('lantern.moth: two shooters in reach roll at the hero, the third shoots', () => {
    const s = mlab(['lantern.moth'], { relics: ['lantern'], gearLevel: { lantern: 2 }, maxHp: 50 }, 90, 240);
    s.hp = s.maxHp = 50;
    const ks = [put(s, 'skirmisher', 30, 170), put(s, 'skirmisher', 150, 170), put(s, 'skirmisher', 90, 130)];
    for (const k of ks) k.intent = { t: 'shoot', n: 2 };
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'launch' && f.intent === 'advance').length).toBe(2);
    expect(fx.filter((f) => f.t === 'tracer').length).toBe(1);
    expect(s.hp).toBe(50 - 2);
    expect(s.mothLeft).toBe(0);
  });
});

// ---------- v0.6 M3 parts 2-3: world-2 and world-3 forks and capstones (stats.mods) ----------
import {
  ABSORB_HEAL,
  CHAIN_DMG,
  CHILL_PHASES,
  DEEP_FREEZE_PHASES,
  EPICENTRE_DMG,
  GATLING_MULT,
  HEAVY_SPIT_DMG,
  JUMP_PENALTY,
  LIGHT_SPEED,
  MORTAR_BLASTS,
  MORTAR_MULT,
  POUNCE_MULT,
  PULL_K,
  PULSE_PUSH,
  SNAP_RETURN,
  SPIT_LIVE_CAP,
  STOMP_STAGGER,
  SWARM_EXTRA,
  TAILWIND_MULT,
  TESLA_DMG,
  TRAP_MULT,
  ZIP_MULT,
} from '../src/core/tuning';
import { addStagger } from '../src/sim/damage';

/** Resolve the current shot to its end, collecting fx (stops at the enemy phase). */
function resolveAll(s: RunState): FxEvent[] {
  const fx: FxEvent[] = [];
  while (s.phase === 'resolve') fx.push(...step(s, SIM_DT));
  return fx;
}
/** Hero hits (fx) of one ball kind. */
const hitsOf = (fx: FxEvent[], kind: string) => fx.filter((f): f is Extract<FxEvent, { t: 'hit' }> => f.t === 'hit' && f.ballKind === kind);
/** A resting test enemy with `hp` and a Rest intent. */
function dummy(s: RunState, kind: TargetKind, x: number, y: number, hp = 20): Target {
  const e = put(s, kind, x, y);
  e.hp = e.maxHp = hp;
  e.intent = { t: 'rest' };
  return e;
}
/** Shoot, then stop the hero dead (a resolve with no hero contact). */
function stillShot(s: RunState): void {
  shoot(s, { x: 0, y: 20 });
  s.balls[0].vx = s.balls[0].vy = 0;
  s.balls[0].resting = true;
}
/** Put the hero on a velocity (after shoot) for a contact at a known speed. */
function launchAt(s: RunState, vx: number, vy: number): void {
  shoot(s, { x: 0, y: -MAX_PULL });
  s.balls[0].vx = vx;
  s.balls[0].vy = vy;
}

describe('v0.6 M3: jump cue', () => {
  const JUMP = { cue: 'jump' as const, gearLevel: { jump: 2 } };
  it('jump.long: hops two enemies, the third collides', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, JUMP, 90, 270);
      const es = [dummy(s, 'grunt', 90, 215, 10), dummy(s, 'grunt', 90, 165, 10), dummy(s, 'brute', 90, 100, 20)];
      shoot(s, { x: 0, y: -MAX_PULL });
      while (s.combo.hits === 0 && s.phase === 'resolve') step(s, SIM_DT);
      return { s, hp: es.map((e) => e.hp) };
    };
    const land = 1 - gearVal(JUMP_PENALTY, 2); // the landing hit (level II: +1)
    const on = run(['jump.long']);
    expect(on.hp).toEqual([10, 10, 20 - land]);
    expect(on.s.jumpsLeft).toBe(0);
    const off = run([]);
    expect(off.hp).toEqual([10, 10 - land, 20]);
  });
  it('jump.stomp: the landing staggers the jumped enemy +1, no damage', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, JUMP, 90, 270);
      const g = dummy(s, 'brute', 90, 200, 10);
      shoot(s, { x: 0, y: -MAX_PULL });
      while (!s.balls[0].jumpLanded && s.phase === 'resolve') step(s, SIM_DT);
      return g;
    };
    const on = run(['jump.stomp']);
    expect(on.stagger).toBe(STOMP_STAGGER);
    expect(on.hp).toBe(10);
    expect(run([]).stagger).toBe(0);
  });
  it('jump.pounce: the landing hit is (dmg x2) - penalty', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { cue: 'jump', gearLevel: { jump: 3 }, damage: 3 }, 90, 270);
      dummy(s, 'grunt', 90, 200, 10);
      const b = dummy(s, 'brute', 90, 110, 20);
      shoot(s, { x: 0, y: -MAX_PULL });
      while (s.combo.hits === 0 && s.phase === 'resolve') step(s, SIM_DT);
      return b.hp;
    };
    const pen = gearVal(JUMP_PENALTY, 3);
    expect(run(['jump.pounce'])).toBe(20 - (3 * POUNCE_MULT - pen));
    expect(run(['jump.pounce'])).toBe(20 - 8);
    expect(run([])).toBe(20 - (3 - pen));
  });
  it('jump.trample: the jumped enemy takes the landing hit too; no second blast', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { cue: 'jump', gearLevel: { jump: 3 }, damage: 3, relics: ['explosive'] }, 90, 270);
      const g = dummy(s, 'grunt', 90, 200, 10);
      const b = dummy(s, 'brute', 90, 110, 20);
      shoot(s, { x: 0, y: -MAX_PULL });
      const fx: FxEvent[] = [];
      while (s.combo.hits === 0 && s.phase === 'resolve') fx.push(...step(s, SIM_DT));
      return { g, b, fx };
    };
    const on = run(['jump.trample']);
    expect(on.b.hp).toBe(20 - 5);
    expect(on.g.hp).toBe(10 - 5);
    expect(on.fx.filter((f) => f.t === 'blast').length).toBe(1);
    expect(run([]).g.hp).toBe(10);
  });
});

describe('v0.6 M3: light ball', () => {
  it('light.zip: launch x1.1; with Break III the stack caps at 1.4', () => {
    const s = mlab(['light.zip'], { ballType: 'light', gearLevel: { light: 2 } });
    shoot(s, { x: 0, y: -MAX_PULL });
    expect(speedOf(s)).toBeCloseTo(MAX_LAUNCH_SPEED * gearVal(LIGHT_SPEED, 2) * ZIP_MULT, 6);
    const c = mlab(['light.zip'], { ballType: 'light', cue: 'break', gearLevel: { light: 2, break: 3 } });
    shoot(c, { x: 0, y: -MAX_PULL });
    expect(gearVal(BREAK_SPEED_MULT_LV, 3) * ZIP_MULT).toBeCloseTo(1.43, 6);
    expect(speedOf(c)).toBeCloseTo(MAX_LAUNCH_SPEED * gearVal(LIGHT_SPEED, 2) * LAUNCH_MULT_CAP, 6);
  });
  it('light.dart: +1 damage at 450 px/s, +0 at 350', () => {
    const run = (v: number, mods = ['light.dart']) => {
      const s = mlab(mods, { ballType: 'light', gearLevel: { light: 2 } }, 90, 240);
      const g = dummy(s, 'brute', 90, 205);
      launchAt(s, 0, -v);
      untilFirstHit(s);
      return g.hp;
    };
    expect(run(470)).toBe(20 - 2);
    expect(run(350)).toBe(20 - 1);
    expect(run(470, [])).toBe(20 - 1);
  });
  it('light.blur: a 250 px/s hero contact staggers 2', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { ballType: 'light', gearLevel: { light: 3 } }, 90, 240);
      const g = dummy(s, 'brute', 90, 205);
      launchAt(s, 0, -260);
      untilFirstHit(s);
      return g.stagger;
    };
    expect(run(['light.blur'])).toBe(2);
    expect(run([])).toBe(1);
  });
  it('light.tailwind: hero rails x1.15 during the shot; enemies bounce as before', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { ballType: 'light', gearLevel: { light: 3 } }, 90, 230);
      const g = dummy(s, 'grunt', 40, 100);
      launchAt(s, 0, 150);
      g.vx = -150;
      g.resting = false;
      let hero = 0;
      let enemy = 0;
      for (let i = 0; i < 400 && (!hero || !enemy); i++) {
        const pre = speedOf(s);
        const pe = Math.abs(g.vx);
        const fx = step(s, SIM_DT);
        if (!hero && fx.some((f) => f.t === 'wall')) hero = speedOf(s) / pre;
        if (!enemy && g.vx > 0) enemy = g.vx / pe;
      }
      return { hero, enemy };
    };
    const on = run(['light.tailwind']);
    const off = run([]);
    expect(on.hero / off.hero).toBeCloseTo(TAILWIND_MULT, 2);
    expect(on.enemy).toBeCloseTo(off.enemy, 9);
  });
});

describe('v0.6 M3: chill', () => {
  const CHILL = { relics: ['chill' as const], gearLevel: { chill: 2 } };
  it('chill.brittle: the 2nd contact (chilled) deals +1, the 1st +0', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, CHILL, 90, 240);
      dummy(s, 'grunt', 90, 170, 40);
      shoot(s, { x: 15, y: -MAX_PULL });
      return hitsOf(resolveAll(s), 'main').map((h) => h.dmg);
    };
    expect(run(['chill.brittle'])).toEqual([1, 2]);
    expect(run([])).toEqual([1, 1]);
  });
  it('chill.numb: a chilled 1-damage charge still deals 1; 3 deals 2', () => {
    const run = (mods: string[], n: number) => {
      const s = mlab(mods, CHILL, 90, 240);
      const g = put(s, 'grunt', 90, 240 - 24 - 40);
      g.intent = { t: 'attack', n };
      g.chill = 1;
      enemyPhaseOnly(s);
      return BASE_STATS.maxHp - s.hp;
    };
    expect(run(['chill.numb'], 1)).toBe(1);
    expect(run(['chill.numb'], 3)).toBe(2);
    expect(run([], 3)).toBe(3);
  });
  it('chill.frostbite: a bump in the shot passes the chill on; an enemy-phase bump does not', () => {
    const setup = (mods: string[]) => {
      const s = mlab(mods, { relics: ['chill'], gearLevel: { chill: 3 } }, 90, 270);
      const a = dummy(s, 'grunt', 40, 100);
      const b = dummy(s, 'grunt', 100, 100);
      a.chill = 1;
      return { s, a, b };
    };
    const r = setup(['chill.frostbite']);
    stillShot(r.s);
    r.a.vx = 300;
    r.a.resting = false;
    resolveAll(r.s);
    expect(r.b.chill).toBe(gearVal(CHILL_PHASES, 3));
    const o = setup([]);
    stillShot(o.s);
    o.a.vx = 300;
    o.a.resting = false;
    resolveAll(o.s);
    expect(o.b.chill ?? 0).toBe(0);
    const e = setup(['chill.frostbite']);
    bareEnemyPhase(e.s);
    e.a.vx = 300;
    e.a.resting = false;
    for (let i = 0; i < 60; i++) step(e.s, SIM_DT);
    expect(e.b.hp).toBeLessThan(20);
    expect(e.b.chill ?? 0).toBe(0);
  });
  it('chill.deepfreeze: a hit on a chilled enemy freezes it (2), it skips one phase; never the boss', () => {
    const s = mlab(['chill.deepfreeze'], { relics: ['chill'], gearLevel: { chill: 3 } }, 90, 240);
    const g = dummy(s, 'grunt', 90, 170);
    g.chill = 1;
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx = untilFirstHit(s);
    expect(g.frozen).toBe(DEEP_FREEZE_PHASES);
    expect(fx.some((f) => f.t === 'freeze')).toBe(true);
    untilSettled(s);
    expect(s.acted).not.toContain(g.id);
    expect(g.frozen).toBe(1);
    enemyPhaseOnly(s);
    expect(g.frozen).toBe(0);
    expect(s.acted).toContain(g.id);
    // A fresh (unchilled) enemy is not frozen by its first contact; the boss never.
    const t = mlab(['chill.deepfreeze'], { relics: ['chill'], gearLevel: { chill: 3 } }, 90, 240);
    const f = dummy(t, 'grunt', 90, 170);
    shoot(t, { x: 0, y: -MAX_PULL });
    untilFirstHit(t);
    expect(f.frozen ?? 0).toBe(0);
    const u = mlab(['chill.deepfreeze'], { relics: ['chill'], gearLevel: { chill: 3 } }, 90, 260);
    const boss = put(u, 'boss', 90, 160);
    boss.intent = { t: 'rest' };
    boss.chill = 1;
    shoot(u, { x: 0, y: -MAX_PULL });
    untilFirstHit(u);
    expect(boss.frozen ?? 0).toBe(0);
  });
});

describe('v0.6 M3: mirror', () => {
  const shooters = (mods: string[], over: Partial<RunStats> = {}, chance = true) => {
    const s = mlab(mods, { relics: ['mirror'], maxHp: 50, ...over }, 90, 260);
    s.hp = s.maxHp = 50;
    let calls = 0;
    s.rng.chance = () => (calls++, chance);
    return { s, calls: () => calls };
  };
  it('mirror.lens: the reflection deals the hero damage stat', () => {
    const { s } = shooters(['mirror.lens'], { damage: 3 });
    const k = dummy(s, 'skirmisher', 40, 60);
    k.intent = { t: 'shoot', n: 2 };
    enemyPhaseOnly(s);
    expect(k.hp).toBe(20 - 3);
    expect(s.hp).toBe(50);
  });
  it('mirror.absorb: a reflection heals the hero 1; the shooter still takes 1', () => {
    const { s } = shooters(['mirror.absorb']);
    s.hp = 40;
    const k = dummy(s, 'skirmisher', 40, 60);
    k.intent = { t: 'shoot', n: 2 };
    const fx = enemyPhaseOnly(s);
    expect(s.hp).toBe(40 + ABSORB_HEAL);
    expect(k.hp).toBe(20 - 1);
    expect(fx.some((f) => f.t === 'heroHeal')).toBe(true);
  });
  it('mirror.flawless: the first Shoot of the phase is reflected at chance 0 (no roll), the second is not', () => {
    const { s, calls } = shooters(['mirror.flawless'], {}, false);
    const a = dummy(s, 'skirmisher', 40, 60);
    const b = dummy(s, 'skirmisher', 140, 60);
    a.intent = { t: 'shoot', n: 2 };
    b.intent = { t: 'shoot', n: 2 };
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'mirror').length).toBe(1);
    expect(a.hp).toBe(19);
    expect(b.hp).toBe(20);
    expect(s.hp).toBe(48);
    expect(calls()).toBe(1);
  });
  it('mirror.prism: the reflection splashes 1 to a neighbour of the shooter', () => {
    const { s } = shooters(['mirror.prism']);
    const k = dummy(s, 'skirmisher', 40, 60);
    k.intent = { t: 'shoot', n: 2 };
    const near = dummy(s, 'grunt', 70, 60);
    const far = dummy(s, 'grunt', 150, 60);
    enemyPhaseOnly(s);
    expect(k.hp).toBe(19);
    expect(near.hp).toBe(19);
    expect(far.hp).toBe(20);
  });
});

describe('v0.6 M3: split', () => {
  const SPLIT = { relics: ['split' as const], splitCount: 2 };
  it('split.swarm: +2 children, every child deals 1', () => {
    const s = mlab(['split.swarm'], { ...SPLIT, damage: 3 }, 90, 240);
    dummy(s, 'grunt', 108, 170); // glancing: the hero keeps its speed, so do the children
    for (const [x, y] of [[40, 110], [90, 90], [140, 110], [40, 60], [140, 60]]) dummy(s, 'brute', x, y);
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx = untilFirstHit(s);
    expect(s.balls.filter((b) => b.kind === 'split').length).toBe(2 + SWARM_EXTRA);
    fx.push(...resolveAll(s));
    const kids = hitsOf(fx, 'split');
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.every((h) => h.dmg === 1)).toBe(true);
    expect(hitsOf(fx, 'main')[0].dmg).toBe(3);
  });
  it('split.rail: the first rail before a hit releases the split; the hit then does not', () => {
    const s = mlab(['split.rail'], SPLIT, 90, 230);
    dummy(s, 'grunt', 90, 120);
    shoot(s, { x: 0, y: MAX_PULL });
    let atRail = -1;
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') {
      const f = step(s, SIM_DT);
      if (atRail < 0 && f.some((e) => e.t === 'split')) atRail = s.firstHitDone ? 1 : 0;
      fx.push(...f);
    }
    expect(atRail).toBe(0);
    expect(fx.filter((f) => f.t === 'split').length).toBe(1);
    // No rail first: the hit splits as before.
    const t = mlab(['split.rail'], SPLIT, 90, 240);
    dummy(t, 'grunt', 90, 170);
    shoot(t, { x: 0, y: -MAX_PULL });
    const g = untilFirstHit(t);
    expect(g.some((f) => f.t === 'split')).toBe(true);
  });
  it('split.mitosis: the first child kill releases MITOSIS_KIDS more children, once a shot', () => {
    const s = mlab(['split.mitosis'], SPLIT, 90, 260);
    stillShot(s);
    const kid = { id: s.nextId++, kind: 'split' as const, x: 90, y: 150, vx: 0, vy: -200, r: 2.5, mass: 0.5, life: Infinity, resting: false, banked: false };
    s.balls.push(kid);
    const a = dummy(s, 'grunt', 40, 60, 1);
    const b = dummy(s, 'grunt', 140, 60, 1);
    const n0 = s.balls.length;
    kill(s, a, 'split', [], kid);
    expect(s.balls.length).toBe(n0 + MITOSIS_KIDS);
    kill(s, b, 'split', [], kid);
    expect(s.balls.length).toBe(n0 + MITOSIS_KIDS);
    // Without the capstone (or a hero kill): nothing.
    const t = mlab([], SPLIT, 90, 260);
    stillShot(t);
    t.balls.push({ ...kid });
    const c = dummy(t, 'grunt', 40, 60, 1);
    const m = t.balls.length;
    kill(t, c, 'split', [], t.balls[1]);
    expect(t.balls.length).toBe(m);
  });
  it('split.homing: child i heads for the i-th nearest enemy near the hero', () => {
    const s = mlab(['split.homing'], SPLIT, 90, 240);
    dummy(s, 'grunt', 90, 170);
    const side = dummy(s, 'grunt', 140, 200);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    const kids = s.balls.filter((b) => b.kind === 'split');
    expect(kids.length).toBe(2);
    const k = kids[1];
    const dx = side.x - k.x;
    const dy = side.y - k.y;
    const dot = (k.vx * dx + k.vy * dy) / (Math.hypot(k.vx, k.vy) * Math.hypot(dx, dy));
    expect(dot).toBeGreaterThan(0.999);
  });
});

describe('v0.6 M3: shockwave', () => {
  const SW = { trick: 'shockwave' as const, trickUses: 2 };
  const gapPut = (s: RunState, kind: TargetKind, gap: number, hp = 10) => dummy(s, kind, 90, 240 - 12 - TARGET_DEFS[kind].r - gap, hp);
  it('shockwave.quake: radius 90 (gap 80 staggers; without it does not)', () => {
    const on = mlab(['shockwave.quake'], SW);
    const g = gapPut(on, 'brute', 80);
    useTrick(on);
    expect(g.stagger).toBe(1);
    const off = mlab([], SW);
    const h = gapPut(off, 'brute', 80);
    useTrick(off);
    expect(h.stagger).toBe(0);
  });
  it('shockwave.pulse: shoves 30 px away from the hero, no stagger', () => {
    const s = mlab(['shockwave.pulse'], { ...SW, relics: ['static'] });
    const g = gapPut(s, 'skirmisher', 20);
    const y0 = g.y;
    useTrick(s);
    expect(y0 - g.y).toBeCloseTo(PULSE_PUSH, 6);
    expect(g.stagger).toBe(0);
    expect(g.hp).toBe(10);
  });
  it('shockwave.aftershock: the wave fires again in the enemy phase of shot +2 (Pulse shape)', () => {
    const s = mlab(['shockwave.aftershock', 'shockwave.pulse'], SW);
    const g = gapPut(s, 'brute', 10);
    useTrick(s);
    step(s, SIM_DT); // flush the trick's own fx
    expect(s.aftershockShot).toBe(2);
    const gap = () => Math.hypot(g.x - s.balls[0].x, g.y - s.balls[0].y) - g.r - 12;
    expect(gap()).toBeCloseTo(10 + PULSE_PUSH, 6);
    const f1 = enemyPhaseOnly(s);
    expect(f1.some((f) => f.t === 'trick')).toBe(false);
    expect(gap()).toBeCloseTo(10 + PULSE_PUSH, 6);
    const f2 = enemyPhaseOnly(s);
    expect(f2.filter((f) => f.t === 'trick').length).toBe(1);
    expect(gap()).toBeCloseTo(10 + 2 * PULSE_PUSH, 6);
    expect(s.trickUsesLeft).toBe(1);
  });
  it('shockwave.epicentre: 2 to an enemy at gap 20, 0 at gap 30', () => {
    const s = mlab(['shockwave.epicentre'], SW);
    const a = gapPut(s, 'brute', 20);
    const t = mlab(['shockwave.epicentre'], SW);
    const b = gapPut(t, 'brute', 30);
    useTrick(s);
    useTrick(t);
    expect(a.hp).toBe(10 - EPICENTRE_DMG);
    expect(b.hp).toBe(10);
    expect(a.stagger).toBe(1);
  });
});

describe('v0.6 M3: draw cue', () => {
  const DRAW = { cue: 'draw' as const, gearLevel: { draw: 2 } };
  it('draw.snap: returns at 80 % of launch speed', () => {
    const s = mlab(['draw.snap'], DRAW, 90, 240);
    dummy(s, 'grunt', 90, 170);
    shoot(s, { x: 0, y: -MAX_PULL });
    const v = s.launch!.speed;
    untilFirstHit(s);
    expect(s.balls[0].vy).toBeGreaterThan(0);
    expect(Math.abs(speedOf(s) - SNAP_RETURN * v)).toBeLessThan(4);
  });
  it('draw.seek: the return heads for the nearest other enemy near the hero', () => {
    const s = mlab(['draw.seek'], DRAW, 90, 240);
    dummy(s, 'grunt', 90, 170);
    const g2 = dummy(s, 'grunt', 140, 215);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    const h = s.balls[0];
    const dx = g2.x - h.x;
    const dy = g2.y - h.y;
    expect((h.vx * dx + h.vy * dy) / (speedOf(s) * Math.hypot(dx, dy))).toBeGreaterThan(0.999);
  });
  it('draw.masse: the preview ends with the return to the hero', () => {
    const s = mlab(['draw.masse'], { ...DRAW, aimPreview: 1 }, 90, 240);
    dummy(s, 'grunt', 90, 170);
    const pts = previewShot(s, { x: 0, y: -MAX_PULL });
    expect(pts[pts.length - 1]).toEqual({ x: 90, y: 240 });
    expect(pts.length).toBe(3);
    const t = mlab([], { ...DRAW, aimPreview: 1 }, 90, 240);
    dummy(t, 'grunt', 90, 170);
    expect(previewShot(t, { x: 0, y: -MAX_PULL }).length).toBe(2);
  });
  it('draw.pull: the struck enemy is dragged along the return (x0.5), no extra damage', () => {
    const s = mlab(['draw.pull'], DRAW, 90, 240);
    const g = dummy(s, 'grunt', 90, 170);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    const h = s.balls[0];
    expect(g.vy).toBeGreaterThan(0);
    // Same direction as the return, PULL_K x its speed (both lost one substep of friction since).
    expect((g.vx * h.vx + g.vy * h.vy) / (enemySpeed(g) * speedOf(s))).toBeGreaterThan(0.9999);
    expect(enemySpeed(g) / speedOf(s)).toBeCloseTo(PULL_K, 2);
    expect(g.hp).toBe(19);
  });
});

describe('v0.6 M3: sticky ball', () => {
  const STICKY = { ballType: 'sticky' as const, gearLevel: { sticky: 2 } };
  it('sticky.glue: the stuck enemy is held: it acts again only in phase 3', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, STICKY, 90, 240);
      const g = dummy(s, 'grunt', 90, 170);
      shoot(s, { x: 0, y: -MAX_PULL });
      untilSettled(s);
      const acted = [s.acted.includes(g.id)];
      for (let i = 0; i < 2; i++) {
        g.intent = { t: 'rest' };
        enemyPhaseOnly(s);
        acted.push(s.acted.includes(g.id));
      }
      return acted;
    };
    expect(run(['sticky.glue'])).toEqual([false, false, true]);
    expect(run([])).toEqual([false, true, true]);
  });
  it('sticky.web: enemies near the stuck one take +1 stagger', () => {
    const s = mlab(['sticky.web'], STICKY, 90, 240);
    dummy(s, 'grunt', 90, 170);
    const n = dummy(s, 'brute', 90 + 12 + 19 + 20, 160);
    const far = dummy(s, 'brute', 160, 60);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(n.stagger).toBe(1);
    expect(n.hp).toBe(20);
    expect(far.stagger).toBe(0);
  });
  it('sticky.trap: the sticking hit deals x1, the next shot\'s hit x2', () => {
    const s = mlab(['sticky.trap'], STICKY, 90, 240);
    const g = dummy(s, 'brute', 90, 170, 40);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(g.hp).toBe(39);
    expect(g.trapped).toBe(true);
    untilSettled(s);
    g.intent = { t: 'rest' };
    shoot(s, aimAt(s, g.x, g.y));
    untilFirstHit(s);
    expect(g.hp).toBe(39 - TRAP_MULT);
  });
  it('sticky.cling: the stuck enemy\'s charge is blocked (0); a boss charge lands', () => {
    const s = mlab(['sticky.cling'], { ...STICKY, maxHp: 50 }, 90, 240);
    s.hp = s.maxHp = 50;
    const g = dummy(s, 'grunt', 90, 170);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilSettled(s);
    expect(s.stuckId).toBe(g.id);
    const hp = s.hp;
    g.intent = { t: 'attack', n: 3 };
    s.waveTurn = 0;
    const fx = enemyPhaseOnly(s);
    expect(fx.some((f) => f.t === 'launch' && f.id === g.id)).toBe(true);
    expect(fx.some((f) => f.t === 'blocked')).toBe(true);
    expect(s.hp).toBe(hp);
    const t = mlab(['sticky.cling'], { ...STICKY, maxHp: 50 }, 90, 240);
    t.hp = t.maxHp = 50;
    const boss = put(t, 'boss', 90, 160);
    boss.intent = { t: 'attack', n: 3 };
    t.stuckId = boss.id;
    enemyPhaseOnly(t);
    expect(t.hp).toBeLessThan(50);
  });
});

describe('v0.6 M3: lightning', () => {
  const LIT = { relics: ['lightning' as const], lightningChance: 1, lightningArcs: 1, lightningRange: 80, lightningDamage: 1 };
  const line = (mods: string[], over: Partial<RunStats> = {}) => {
    const s = mlab(mods, { ...LIT, ...over }, 90, 240);
    const a = dummy(s, 'grunt', 90, 170);
    const b = dummy(s, 'brute', 90, 120);
    const c = dummy(s, 'brute', 150, 120);
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx = untilFirstHit(s);
    return { s, a, b, c, fx };
  };
  it('lightning.chain: each arc hops once more for 1', () => {
    const on = line(['lightning.chain']);
    expect(on.b.hp).toBe(19);
    expect(on.c.hp).toBe(20 - CHAIN_DMG);
    expect(on.fx.filter((f) => f.t === 'lightning').length).toBe(2);
    expect(line([]).c.hp).toBe(20);
  });
  it('lightning.thunder: one arc at full damage, stagger 2', () => {
    const on = line(['lightning.thunder'], { lightningArcs: 3, damage: 3 });
    expect(on.b.hp).toBe(20 - 3);
    expect(on.b.stagger).toBe(2);
    expect(on.c.hp).toBe(20);
    const off = line([], { lightningArcs: 3, damage: 3 });
    expect(off.c.hp).toBe(19);
  });
  it('lightning.storm: a ball kill also arcs (chance 1)', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, LIT, 90, 240);
      dummy(s, 'grunt', 90, 170, 1);
      dummy(s, 'brute', 90, 120);
      shoot(s, { x: 0, y: -MAX_PULL });
      return untilFirstHit(s).filter((f) => f.t === 'lightning').length;
    };
    expect(run(['lightning.storm'])).toBe(2);
    expect(run([])).toBe(1);
  });
  it('lightning.surge: the first hero contact arcs at chance 0; the second does not', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { ...LIT, lightningChance: 0 }, 90, 240);
      dummy(s, 'grunt', 90, 170, 40);
      dummy(s, 'brute', 150, 150);
      shoot(s, { x: 15, y: -MAX_PULL });
      const fx = resolveAll(s);
      return { arcs: fx.filter((f) => f.t === 'lightning').length, hits: hitsOf(fx, 'main').length };
    };
    const on = run(['lightning.surge']);
    expect(on.hits).toBeGreaterThanOrEqual(2);
    expect(on.arcs).toBe(1);
    expect(run([]).arcs).toBe(0);
  });
});

describe('v0.6 M3: static', () => {
  const ST = { relics: ['static' as const] };
  it('static.overload: a crossing also zaps the nearest other enemy 1 (no stagger)', () => {
    const s = mlab(['static.overload'], ST, 90, 240);
    const k = dummy(s, 'skirmisher', 90, 170);
    const n = dummy(s, 'brute', 90 + 12 + 19 + 20, 160);
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(k.hp).toBe(20 - 1 - 1);
    expect(n.hp).toBe(19);
    expect(n.stagger).toBe(0);
  });
  it('static.paralysis: a crossing in the shot holds a grunt one more phase; never the boss', () => {
    const s = mlab(['static.paralysis'], ST, 90, 240);
    const g = dummy(s, 'grunt', 90, 170);
    g.stagger = 1;
    shoot(s, { x: 0, y: -MAX_PULL });
    untilFirstHit(s);
    expect(g.held).toBe(1);
    untilSettled(s);
    expect(s.acted).not.toContain(g.id);
    g.intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(s.acted).not.toContain(g.id);
    enemyPhaseOnly(s);
    expect(s.acted).toContain(g.id);
    const t = mlab(['static.paralysis'], ST, 90, 260);
    const boss = put(t, 'boss', 90, 160);
    boss.intent = { t: 'rest' };
    boss.stagger = TARGET_DEFS.boss.staggerAt - 1;
    shoot(t, { x: 0, y: -MAX_PULL });
    untilFirstHit(t);
    expect(boss.stagger).toBeGreaterThanOrEqual(TARGET_DEFS.boss.staggerAt);
    expect(boss.held ?? 0).toBe(0);
  });
  it('static.tesla: the 3rd crossing of a shot zaps the nearest enemy for 2, once', () => {
    const s = mlab(['static.tesla'], ST, 90, 270);
    const ks = [30, 70, 110].map((x) => dummy(s, 'skirmisher', x, 60));
    const z = dummy(s, 'brute', 150, 60);
    stillShot(s);
    const fx: FxEvent[] = [];
    addStagger(ks[0], 1, fx, s);
    addStagger(ks[1], 1, fx, s);
    expect(z.hp).toBe(20);
    addStagger(ks[2], 1, fx, s);
    expect(z.hp).toBe(20 - TESLA_DMG);
    expect(s.teslaHits).toBe(3);
    addStagger(z, 5, fx, s);
    expect(ks.map((k) => k.hp)).toEqual([19, 19, 19]);
  });
  it('static.grounded: a staggered ally is neither repaired nor shielded', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, ST, 90, 270);
      const g = dummy(s, 'grunt', 60, 80, 10);
      g.hp = 5;
      g.stagger = 2;
      const tk = dummy(s, 'tinker', 100, 80);
      tk.intent = { t: 'repair' };
      const cl = dummy(s, 'cleric', 60, 120);
      cl.intent = { t: 'guard' };
      enemyPhaseOnly(s);
      return { hp: g.hp, shield: g.shield ?? 0 };
    };
    expect(run(['static.grounded'])).toEqual({ hp: 5, shield: 0 });
    const off = run([]);
    expect(off.hp).toBeGreaterThan(5);
    expect(off.shield).toBe(1);
  });
});

describe('v0.6 M3: spitter', () => {
  const SP = { relics: ['spitter' as const], spitInterval: 0.05, spitLife: 1, spitDamage: 1 };
  it('spitter.gatling: interval x0.6; never more than 10 live spat balls', () => {
    const s = mlab(['spitter.gatling'], SP, 90, 240);
    shoot(s, { x: 0, y: -MAX_PULL });
    expect(s.spitTimer).toBeCloseTo(0.05 * GATLING_MULT, 9);
    const run = (mods: string[]) => {
      const t = mlab(mods, { ...SP, spitInterval: 0.001, spitLife: 3 }, 90, 240);
      shoot(t, { x: 10, y: -MAX_PULL });
      let most = 0;
      for (let i = 0; i < 200 && t.phase === 'resolve'; i++) {
        step(t, SIM_DT);
        most = Math.max(most, t.balls.filter((b) => b.kind === 'spat').length);
      }
      return most;
    };
    expect(run(['spitter.gatling'])).toBe(SPIT_LIVE_CAP);
    expect(run([])).toBeGreaterThan(SPIT_LIVE_CAP);
  });
  it('spitter.mortar: interval x1.5; spat contacts blast neighbours for 1, the 4th is silent', () => {
    const s = mlab(['spitter.mortar'], SP, 90, 240);
    shoot(s, { x: 0, y: -MAX_PULL });
    expect(s.spitTimer).toBeCloseTo(0.05 * MORTAR_MULT, 9);
    const t = mlab(['spitter.mortar'], SP, 90, 280);
    const a = dummy(t, 'brute', 90, 150, 40);
    const n = dummy(t, 'grunt', 90 + 19 + 12 + 10, 150, 40);
    stillShot(t);
    const spat = (x: number, y: number, vx: number, vy: number) =>
      t.balls.push({ id: t.nextId++, kind: 'spat', x, y, vx, vy, r: 2, mass: 0.4, life: 5, resting: false, banked: false });
    spat(30, 150, 300, 0);
    spat(90, 90, 0, 300);
    spat(90, 210, 0, -300);
    spat(45, 105, 200, 200);
    const fx = resolveAll(t);
    const onBrute = hitsOf(fx, 'spat').filter((h) => h.targetKind === 'brute').length;
    expect(onBrute).toBeGreaterThanOrEqual(4);
    expect(a.hp).toBe(40 - onBrute); // never blasted by its own contacts
    expect(fx.filter((f) => f.t === 'blast').length).toBe(MORTAR_BLASTS);
    expect(n.hp).toBe(40 - MORTAR_BLASTS);
  });
  it('spitter.aimed: a spit heads for the nearest enemy near the hero', () => {
    const s = mlab(['spitter.aimed'], SP, 90, 250);
    const g = dummy(s, 'grunt', 140, 230);
    shoot(s, { x: 0, y: -MAX_PULL });
    while (!s.balls.some((b) => b.kind === 'spat')) step(s, SIM_DT);
    const k = s.balls.find((b) => b.kind === 'spat')!;
    const dx = g.x - k.x;
    const dy = g.y - k.y;
    expect((k.vx * dx + k.vy * dy) / (Math.hypot(k.vx, k.vy) * Math.hypot(dx, dy))).toBeGreaterThan(0.99);
  });
  it('spitter.heavyspit: spat contacts deal 2', () => {
    const s = mlab(['spitter.heavyspit'], SP, 90, 280);
    dummy(s, 'brute', 90, 150, 40);
    stillShot(s);
    s.balls.push({ id: s.nextId++, kind: 'spat', x: 90, y: 210, vx: 0, vy: -300, r: 2, mass: 0.4, life: 5, resting: false, banked: false });
    const fx = resolveAll(s);
    expect(hitsOf(fx, 'spat')[0].dmg).toBe(HEAVY_SPIT_DMG);
  });
});

describe('v0.6 M3: time stop', () => {
  const TS = { trick: 'timeStop' as const, trickUses: 1 };
  it('timeStop.freeze: nobody even moves', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, TS, 90, 260);
      put(s, 'grunt', 90, 80).intent = { t: 'attack', n: 2 };
      useTrick(s);
      return enemyPhaseOnly(s).filter((f) => f.t === 'launch').length;
    };
    expect(run(['timeStop.freeze'])).toBe(0);
    expect(run([])).toBe(1);
  });
  it('timeStop.slow: two phases at half damage (4 -> 2), the third full', () => {
    const s = mlab(['timeStop.slow'], { ...TS, maxHp: 50 }, 90, 260);
    s.hp = s.maxHp = 50;
    const k = dummy(s, 'skirmisher', 40, 60);
    useTrick(s);
    expect(s.skipNextEnemyPhase).toBe(false);
    const lost: number[] = [];
    for (let i = 0; i < 3; i++) {
      k.intent = { t: 'shoot', n: 4 };
      s.waveTurn = 0;
      const hp = s.hp;
      enemyPhaseOnly(s);
      lost.push(hp - s.hp);
    }
    expect(lost).toEqual([2, 2, 4]);
  });
  it('timeStop.clockwork: no belt sweep while a Time Stop is in effect (also under Slow)', () => {
    const run = (mods: string[]) => {
      const s = clab([RIGHT_BELT], 40, 150, { ...TS, mods });
      resting(s, 'grunt', 100, 230);
      useTrick(s);
      return belts(enemyPhaseOnly(s)).length;
    };
    expect(run(['timeStop.clockwork'])).toBe(0);
    expect(run(['timeStop.clockwork', 'timeStop.slow'])).toBe(0);
    expect(run([])).toBeGreaterThan(0);
  });
  it('timeStop.stasis: chill and the enrage clock hold through the stopped phase', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { ...TS, relics: ['chill'] }, 90, 260);
      const g = dummy(s, 'grunt', 90, 80);
      g.chill = 2;
      useTrick(s);
      const w = s.waveTurn;
      enemyPhaseOnly(s);
      return { chill: g.chill, turns: s.waveTurn - w };
    };
    expect(run(['timeStop.stasis'])).toEqual({ chill: 2, turns: 0 });
    expect(run([])).toEqual({ chill: 1, turns: 1 });
  });
});

describe('v0.6 M3 w2/w3: determinism with the new choices', () => {
  const W2: RunStats = {
    ...BASE_STATS, damage: 2, cue: 'jump', ballType: 'light', relics: ['chill', 'mirror', 'split'], splitCount: 2, trick: 'shockwave', trickUses: 2,
    gearLevel: { jump: 3, light: 3, chill: 3, mirror: 3, split: 3, shockwave: 3 },
    mods: ['jump.long', 'jump.trample', 'light.zip', 'light.tailwind', 'chill.brittle', 'chill.deepfreeze', 'mirror.flawless', 'split.swarm', 'split.homing', 'shockwave.pulse', 'shockwave.aftershock'],
  };
  const W3: RunStats = {
    ...BASE_STATS, damage: 2, cue: 'draw', ballType: 'sticky', relics: ['lightning', 'static', 'spitter'], lightningChance: 0.5, lightningArcs: 2, lightningRange: 80, lightningDamage: 1,
    spitInterval: 0.1, spitLife: 1, spitDamage: 1, trick: 'timeStop', trickUses: 2,
    gearLevel: { draw: 3, sticky: 3, lightning: 3, static: 3, spitter: 3, timeStop: 3 },
    mods: ['draw.seek', 'draw.pull', 'sticky.glue', 'sticky.trap', 'lightning.chain', 'lightning.storm', 'static.overload', 'static.tesla', 'spitter.gatling', 'spitter.aimed', 'timeStop.slow', 'timeStop.stasis'],
  };
  for (const [name, stage, stats] of [['w2 kit', 'w2s2', W2], ['w3 kit', 'w3s2', W3]] as const) {
    it(`${name}: same seed => identical state; fast-forward matches`, () => {
      const go = (dt: number) => {
        const s = createRun(stage, stats, 7);
        SHOTS.forEach((p, i) => {
          if (s.phase !== 'aim') return;
          if (i === 1) useTrick(s);
          shoot(s, p);
          untilSettled(s, dt);
        });
        return s;
      };
      const a = go(SIM_DT);
      expect(a.shots).toBeGreaterThan(1);
      expect(Number.isFinite(a.hp) && a.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
      expect(snapshot(a)).toEqual(snapshot(go(SIM_DT)));
      const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT));
      const { t: _b, ...normal } = snapshot(go(SIM_DT));
      expect(ff).toEqual(normal);
    });
  }
});

// ---------- v0.7 Bog (world 4): mud, MUD BOOTS, leech, croaker, the Mire Queen, waves ----------
import { BELT_HOLD, BOSS_LEECH_CAP, LOB_R, MUD_GROW, MUD_KEEP, QUEEN_PULL, THORNS_RELIC_DMG } from '../src/core/tuning';
import { numbed, relaxAll } from '../src/sim/physics';
import { inMudAt, mudOnLine } from '../src/sim/index';

const MUD: Hazard = { kind: 'mud', x: 90, y: 150, r: 20 };
/** clab on Bog (w4s1 by default): empty table, hero at (x,y), the given hazards. */
function blab(hazards: Hazard[], x = 90, y = 240, over: Partial<RunStats> = {}, stage = 'w4s1'): RunState {
  return clab(hazards, x, y, over, stage);
}
const muds = (fx: FxEvent[]) => fx.filter((f): f is Extract<FxEvent, { t: 'mud' }> => f.t === 'mud');
const stageHash = (a: number, b: number): [number, number] => {
  let h = 0;
  const str = JSON.stringify(Array.from({ length: b - a }, (_, i) => makeStage(idFromIndex(a + i))));
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return [h, str.length];
};
/** Run the resolve phase only (no enemy phase), collecting fx. */
function resolveOnly(s: RunState): FxEvent[] {
  const fx: FxEvent[] = [];
  while (s.phase === 'resolve') fx.push(...step(s, SIM_DT));
  return fx;
}

describe('v0.7 Bog: stage generator', () => {
  it('w4s1-4: mud 2/3/3/4, r in [16,22], inside the ice box, gaps >= 10, deterministic', () => {
    const want = [2, 3, 3, 4];
    for (let k = 1; k <= 4; k++) {
      const hz = makeStage(stageId(4, k)).hazards;
      expect(hz.length).toBe(want[k - 1]);
      for (const z of hz) {
        expect(z.kind).toBe('mud');
        expect(z.r).toBeGreaterThanOrEqual(16);
        expect(z.r).toBeLessThanOrEqual(22);
        expect(z.x).toBeGreaterThanOrEqual(TABLE.x + z.r + 4);
        expect(z.x).toBeLessThanOrEqual(TABLE.x + TABLE.w - z.r - 4);
        expect(z.y).toBeGreaterThanOrEqual(TABLE.y + z.r + 20);
        expect(z.y).toBeLessThanOrEqual(TABLE.y + TABLE.h - z.r - 70);
        for (const o of hz) if (o !== z) expect(Math.hypot(o.x - z.x, o.y - z.y) - o.r - z.r).toBeGreaterThanOrEqual(10);
      }
    }
    const m0 = makeStage('w4s1').hazards[0];
    expect([Math.round(m0.x), Math.round(m0.y), Math.round(m0.r)]).toEqual([70, 172, 17]);
    expect(makeStage('l1w4s1').hazards.length).toBeLessThanOrEqual(4);
  });
  it('worlds 1-3 stage data unchanged by v0.7 (hashes n = 0..7 and 8..11)', () => {
    expect(stageHash(0, 8)).toEqual([1834690106, 9165]);
    expect(stageHash(8, 12)).toEqual([426042823, 5398]);
  });
  it('Bog waves, roster and boss wave; Thin Rails: Bog 0.5, Felt 0.65; no loop-0 w4 stage rolls it', () => {
    const w = WORLDS[3];
    expect([w.physics.friction, w.physics.rollDecel, w.physics.wallBounce, w.tint]).toEqual([0.9, 110, 0.6, 'w']);
    expect(w.roster).toContain('leech');
    expect(w.roster).toContain('croaker');
    expect(w.waves.map((x) => x.slots)).toEqual([
      ['grunt', 'leech', 'croaker'],
      ['grunt', 'leech', 'croaker', ['bouncer', 'thornback'], 'brute'],
      ['leech', 'croaker', 'bomber', ['broodmother', 'hive'], 'brute'],
    ]);
    expect(w.bossWave.slots).toEqual(['boss', 'leech', 'croaker']);
    expect(makeStage('w4s4').boss.kit).toBe('mirequeen');
    for (let k = 1; k <= 4; k++) expect(makeStage(stageId(4, k)).modifiers).not.toContain('thinRails');
    const all = [1, 2, 3].flatMap((l) => allStageIds(l)).map(makeStage).filter((st) => st.modifiers.includes('thinRails'));
    const bog = all.find((st) => st.world === 4)!;
    const felt = all.find((st) => st.world === 1)!;
    expect(bog.wallBounce).toBeCloseTo(0.5, 9);
    expect(felt.wallBounce).toBe(THIN_RAILS_BOUNCE);
    for (const st of all) if (st.world <= 3) expect(st.wallBounce).toBe(THIN_RAILS_BOUNCE);
  });
});

describe('v0.7 Bog: mud', () => {
  it('a shot through a patch stops at entry (resting, one mud fx)', () => {
    const s = blab([MUD]);
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx = resolveOnly(s);
    const h = s.balls[0];
    expect(muds(fx).map((f) => f.id)).toEqual([h.id]);
    expect(h.resting).toBe(true);
    expect(inMudAt(s, h.x, h.y)).toBe(true);
    expect(h.y).toBeGreaterThan(MUD.y + MUD.r - 3);
  });
  it('a body resting (placed) inside leaves freely; a rail return re-entering stops again', () => {
    const s = blab([MUD], 90, 150);
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx = resolveOnly(s);
    const h = s.balls[0];
    // Out the top, off the rail, back down into the patch: exactly one stop, on the way back in.
    expect(muds(fx).length).toBe(1);
    expect(fx.some((f) => f.t === 'wall')).toBe(true);
    expect(fx.findIndex((f) => f.t === 'wall')).toBeLessThan(fx.findIndex((f) => f.t === 'mud'));
    expect(h.y).toBeLessThan(MUD.y - MUD.r + 3);
    expect(h.resting).toBe(true);
    // Placed inside and shot down: it leaves without a stop.
    const q = blab([MUD], 90, 150);
    shoot(q, { x: 0, y: MAX_PULL / 3 });
    expect(muds(resolveOnly(q)).length).toBe(0);
    expect(q.balls[0].y).toBeGreaterThan(MUD.y + MUD.r);
  });
  it('split / spat balls entering are swallowed; a knocked enemy stops', () => {
    const s = blab([MUD], 30, 280);
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    s.balls[0].resting = true;
    s.balls.push({ id: 900, kind: 'split', x: 90, y: 230, vx: 0, vy: -300, r: 2.5, mass: 0.5, life: Infinity, resting: false, banked: false });
    s.balls.push({ id: 901, kind: 'spat', shard: true, x: 120, y: 160, vx: -300, vy: 0, r: 2, mass: 0.4, life: 2, resting: false, banked: false });
    const g = dummy(s, 'grunt', 90, 60);
    g.vy = 300;
    g.resting = false;
    let minY = Infinity;
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') {
      fx.push(...step(s, SIM_DT));
      const b = s.balls.find((x) => x.id === 900);
      if (b) minY = Math.min(minY, b.y);
    }
    expect(muds(fx).map((f) => f.id).sort()).toEqual([900, 901, g.id].sort());
    expect(s.balls.length).toBe(1);
    expect(minY).toBeGreaterThan(MUD.y + MUD.r - 4);
    expect(g.resting).toBe(true);
    expect(inMudAt(s, g.x, g.y)).toBe(true);
    expect(g.y).toBeLessThan(MUD.y - MUD.r + 4);
  });
  it('a charging grunt entering mud rests with chargeDmg 0; the hero is untouched', () => {
    const s = blab([MUD], 90, 60);
    const g = put(s, 'grunt', 90, 190);
    g.intent = { t: 'attack', n: 3 };
    const fx = enemyPhaseOnly(s);
    expect(fx.some((f) => f.t === 'launch')).toBe(true);
    expect(muds(fx).map((f) => f.id)).toEqual([g.id]);
    expect(g.chargeDmg ?? 0).toBe(0);
    expect(s.hp).toBe(s.maxHp);
    expect(inMudAt(s, g.x, g.y)).toBe(true);
  });
  it("Rack 'Em into mud fires nothing; the racked enemy leaves freely", () => {
    const s = blab([{ kind: 'mud', x: 90, y: 160, r: 20 }], 90, 270, { trick: 'rackEm', trickUses: 1 });
    const g = put(s, 'grunt', 90, 190);
    g.intent = { t: 'rest' };
    expect(useTrick(s)).toBe(true);
    expect(inMudAt(s, g.x, g.y)).toBe(true);
    expect(g.inMud).toBe(true);
    g.intent = { t: 'advance' };
    const fx = [...step(s, SIM_DT), ...enemyPhaseOnly(s)];
    expect(muds(fx).length).toBe(0);
    expect(fx.some((f) => f.t === 'launch')).toBe(true);
  });
  it('mudOnLine: a centre path entering a patch (not one it starts in)', () => {
    const s = blab([MUD]);
    expect(mudOnLine(s, 90, 240, 90, 60)).toBe(true);
    expect(mudOnLine(s, 30, 240, 30, 60)).toBe(false);
    expect(mudOnLine(s, 90, 150, 90, 60)).toBe(false);
    expect(mudOnLine(s, 90, 240, 90, 200)).toBe(false);
  });
});

describe('v0.7 Bog: MUD BOOTS', () => {
  const entry = (grip: number) => {
    const s = blab([MUD], 90, 240, { mudGrip: grip });
    shoot(s, { x: 0, y: -MAX_PULL });
    let before = 0;
    let after = -1;
    const fx: FxEvent[] = [];
    while (s.phase === 'resolve') {
      const v = speedOf(s);
      const f = step(s, SIM_DT);
      fx.push(...f);
      if (after < 0 && f.some((x) => x.t === 'mud')) ((before = v), (after = speedOf(s)));
    }
    return { s, fx, before, after };
  };
  it('mudGrip 1: the hero keeps 50 % on entry (one fx); 2: unchanged, no fx, it rolls through', () => {
    const one = entry(1);
    expect(muds(one.fx).length).toBe(1);
    expect(Math.abs(one.after - one.before * MUD_KEEP[1])).toBeLessThan(4);
    expect(one.s.balls[0].resting).toBe(true);
    const two = entry(2);
    expect(muds(two.fx).length).toBe(0);
    expect(two.s.balls[0].y).toBeLessThan(MUD.y - MUD.r);
  });
  it('enemies and shards still stop at mudGrip 2', () => {
    const s = blab([MUD], 30, 280, { mudGrip: 2 });
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    s.balls[0].resting = true;
    s.balls.push({ id: 901, kind: 'spat', shard: true, x: 120, y: 160, vx: -300, vy: 0, r: 2, mass: 0.4, life: 2, resting: false, banked: false });
    const g = dummy(s, 'grunt', 90, 60);
    g.vy = 300;
    g.resting = false;
    const fx = resolveOnly(s);
    expect(muds(fx).map((f) => f.id).sort()).toEqual([901, g.id].sort());
  });
  it('previewShot ends on the patch at grip 0/1 and passes at 2', () => {
    for (const grip of [0, 1, 2]) {
      const s = blab([MUD], 90, 240, { mudGrip: grip, aimPreview: 1 });
      const pts = previewShot(s, { x: 0, y: -MAX_PULL });
      if (grip < 2) {
        expect(pts.length).toBe(2);
        expect(pts[1].y).toBeCloseTo(MUD.y + MUD.r, 6);
      } else expect(pts[1].y).toBeCloseTo(TABLE.y + 12, 6);
    }
  });
});

describe('v0.7 Bog: leech', () => {
  const n2 = () => Math.max(1, Math.round(2 * stageById('w4s1').atkScale));
  const stealLab = (over: Partial<RunStats> = {}, room = 30) => {
    const s = blab([], 90, 240, { maxHp: 80, ...over });
    const l = put(s, 'leech', 90, 170);
    l.hp = l.maxHp - room;
    l.intent = { t: 'steal', n: n2() };
    return { s, l };
  };
  it('rolls Steal for the scaled 2; the landed steal hits for it and heals that (capped; Follow 3)', () => {
    const r = blab([]);
    const l0 = put(r, 'leech', 90, 100);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      rollIntentForTest(r, l0);
      seen.add(l0.intent.t);
      if (l0.intent.t === 'steal') expect(l0.intent.n).toBe(n2());
    }
    expect([...seen].sort()).toEqual(['advance', 'rest', 'steal']);
    const { s, l } = stealLab();
    const hp0 = l.hp;
    const fx = enemyPhaseOnly(s);
    expect(s.hp).toBe(80 - n2());
    expect(l.hp).toBe(hp0 + n2());
    expect(fx.filter((f) => f.t === 'steal')).toEqual([{ t: 'steal', x: expect.any(Number), y: expect.any(Number), amount: n2() }]);
    const full = stealLab({}, 0);
    const f2 = enemyPhaseOnly(full.s);
    expect(full.l.hp).toBe(full.l.maxHp);
    expect(f2.some((f) => f.t === 'steal')).toBe(false);
    const fol = stealLab({ cue: 'follow' });
    const h1 = fol.l.hp;
    enemyPhaseOnly(fol.s);
    expect(fol.s.hp).toBe(80 - n2() - 1);
    expect(fol.l.hp).toBe(h1 + n2() + 1);
  });
  it('Juggernaut and Cling block it (no heal); Thorns pricks it after the heal', () => {
    const j = stealLab({ mods: ['heavy.jugger'] });
    const hj = j.l.hp;
    enemyPhaseOnly(j.s);
    expect([j.l.hp, j.s.hp]).toEqual([hj, 80]);
    const c = stealLab({ mods: ['sticky.cling'] });
    c.s.stuckId = c.l.id;
    const hc = c.l.hp;
    enemyPhaseOnly(c.s);
    expect([c.l.hp, c.s.hp]).toEqual([hc, 80]);
    const t = stealLab({ relics: ['thorns'] });
    const ht = t.l.hp;
    enemyPhaseOnly(t.s);
    expect(t.l.hp).toBe(ht + n2() - THORNS_RELIC_DMG[0]);
  });
  it('Time Stop: a leech with Steal advances (no blow) and keeps its intent', () => {
    const { s, l } = stealLab({ trick: 'timeStop', trickUses: 1 });
    l.x = 90;
    l.y = 60;
    useTrick(s);
    const fx = enemyPhaseOnly(s);
    expect(fx.filter((f) => f.t === 'launch').map((f) => (f as { intent: string }).intent)).toEqual(['advance']);
    expect(s.hp).toBe(80);
    expect(l.intent.t).toBe('steal');
  });
});

describe('v0.7 Bog: croaker', () => {
  const lobLab = (over: Partial<RunStats> = {}) => {
    const s = blab([], 90, 240, { maxHp: 40, ...over });
    const c = put(s, 'croaker', 40, 80);
    c.intent = { t: 'lob', n: 5 };
    dummy(s, 'grunt', 150, 60);
    return { s, c };
  };
  const quiet = (s: RunState) => {
    for (const t of s.targets) t.intent = { t: 'rest' };
  };
  it('rolls Lob for the scaled 3 or a sideways Advance', () => {
    const s = blab([]);
    const c = put(s, 'croaker', 40, 100);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      rollIntentForTest(s, c);
      seen.add(c.intent.t);
      if (c.intent.t === 'lob') expect(c.intent.n).toBe(Math.max(1, Math.round(3 * stageById('w4s1').atkScale)));
    }
    expect([...seen].sort()).toEqual(['advance', 'lob']);
    c.intent = { t: 'advance' };
    s.balls[0].x = 40;
    s.balls[0].y = 250;
    enemyPhaseOnly(s);
    expect(Math.abs(c.y - 100)).toBeLessThan(3);
    expect(c.x - 40).toBeGreaterThan(30);
  });
  it('a lob marks the spot; next phase the hero inside LOB_R takes n (lobLand); moved 60 px it fizzles; a dead croaker never lands', () => {
    const { s, c } = lobLab();
    const fx = enemyPhaseOnly(s);
    expect(c.lob).toEqual({ x: 90, y: 240, n: 5 });
    expect(fx.filter((f) => f.t === 'lob')).toEqual([{ t: 'lob', x0: 40, y0: 80, x: 90, y: 240 }]);
    expect(s.hp).toBe(40);
    quiet(s);
    s.balls[0].x = 90 + LOB_R; // inside LOB_R + hero r
    const f2 = enemyPhaseOnly(s);
    expect(s.hp).toBe(35);
    expect(f2.find((f) => f.t === 'lobLand')).toEqual({ t: 'lobLand', x: 90, y: 240, r: LOB_R });
    expect(c.lob).toBeUndefined();
    const m = lobLab();
    enemyPhaseOnly(m.s);
    quiet(m.s);
    m.s.balls[0].x = 30; // moved 60 px
    const f3 = enemyPhaseOnly(m.s);
    expect(m.s.hp).toBe(40);
    expect(f3.some((f) => f.t === 'lobLand')).toBe(false);
    expect(m.c.lob).toBeUndefined();
    const d = lobLab();
    enemyPhaseOnly(d.s);
    quiet(d.s);
    kill(d.s, d.c, 'main', []);
    enemyPhaseOnly(d.s);
    expect(d.s.hp).toBe(40);
  });
  it('a lob never touches the rng (Mirror equipped: identical streams); four lobs exceed the ranged cap', () => {
    const rngAfter = (relics: RunStats['relics']) => {
      const { s } = lobLab({ relics });
      quiet(s);
      s.targets[0].intent = { t: 'lob', n: 5 };
      enemyPhaseOnly(s);
      return JSON.stringify(s.rng);
    };
    expect(rngAfter(['mirror'])).toBe(rngAfter([]));
    const s = blab([], 90, 240, { maxHp: 40 });
    for (const x of [30, 70, 110, 150]) put(s, 'croaker', x, 70).intent = { t: 'lob', n: 6 };
    enemyPhaseOnly(s);
    quiet(s);
    enemyPhaseOnly(s);
    expect(40 - s.hp).toBe(24);
    expect(24).toBeGreaterThan(Math.floor(RANGED_PHASE_CAP * 40));
  });
});

describe('v0.7 Bog: the Mire Queen', () => {
  const queenLab = (over: Partial<RunStats> = {}, hx = 90, hy = 240, hazards: Hazard[] = []) => {
    const s = blab(hazards, hx, hy, over);
    const q = put(s, 'boss', 90, 70);
    q.intent = { t: 'rest' };
    return { s, q };
  };
  const pulls = (fx: FxEvent[]) => fx.filter((f): f is Extract<FxEvent, { t: 'pull' }> => f.t === 'pull');
  it('pulls the hero 40 px at her after the hold, before anyone acts; 10 px short slides 10', () => {
    const { s } = queenLab();
    put(s, 'grunt', 150, 120).intent = { t: 'advance' };
    shoot(s, { x: 0, y: 20 });
    s.balls[0].vx = s.balls[0].vy = 0;
    s.balls[0].resting = true;
    const fx: FxEvent[] = [];
    let tStart = -1;
    let tPull = -1;
    while (s.phase !== 'aim') {
      const f = step(s, SIM_DT);
      if (tStart < 0 && s.phase === 'enemy') tStart = s.t;
      if (f.some((x) => x.t === 'pull')) tPull = s.t;
      fx.push(...f);
    }
    expect(tPull - tStart).toBeCloseTo(BELT_HOLD, 1);
    expect(pulls(fx)).toEqual([{ t: 'pull', x: 90, y: 240 - QUEEN_PULL, dx: 0, dy: -QUEEN_PULL }]);
    expect(fx.findIndex((f) => f.t === 'pull')).toBeLessThan(fx.findIndex((f) => f.t === 'launch'));
    const near = queenLab({}, 90, 70 + 23 + 12 + 10);
    enemyPhaseOnly(near.s);
    expect(near.s.balls[0].y).toBeCloseTo(70 + 35, 6);
  });
  it('no pull when staggered, under Time Stop or Reflex; Slow still pulls; other bosses never pull', () => {
    const st = queenLab();
    st.q.stagger = TARGET_DEFS.boss.staggerAt;
    expect(pulls(enemyPhaseOnly(st.s)).length).toBe(0);
    const ts = queenLab({ trick: 'timeStop', trickUses: 1 });
    useTrick(ts.s);
    expect(pulls(enemyPhaseOnly(ts.s)).length).toBe(0);
    const rf = queenLab({ reflex: 1 });
    expect(pulls(enemyPhaseOnly(rf.s)).length).toBe(0);
    const sl = queenLab({ trick: 'timeStop', trickUses: 1, mods: ['timeStop.slow'] });
    useTrick(sl.s);
    expect(pulls(enemyPhaseOnly(sl.s)).length).toBe(1);
    for (const stage of ['w1s1', 'w3s1']) {
      const o = blab([], 90, 240, {}, stage);
      put(o, 'boss', 90, 70).intent = { t: 'rest' };
      expect(pulls(enemyPhaseOnly(o)).length).toBe(0);
    }
  });
  it('a pull into mud fires nothing; the hero then leaves freely', () => {
    const { s } = queenLab({}, 90, 190, [MUD]);
    const fx = enemyPhaseOnly(s);
    expect(pulls(fx).length).toBe(1);
    expect(inMudAt(s, s.balls[0].x, s.balls[0].y)).toBe(true);
    expect(muds(fx).length).toBe(0);
    shoot(s, { x: 0, y: MAX_PULL / 3 });
    expect(muds(resolveOnly(s)).length).toBe(0);
  });
  it('phase 2 grows every patch 8 once (mudGrow right after bossPhase; swallows nothing); a second createRun is ungrown', () => {
    const { s, q } = queenLab({}, 90, 240, [MUD, { kind: 'mud', x: 40, y: 220, r: 18 }]);
    const g = dummy(s, 'grunt', 90, 150 + MUD.r + 5);
    relaxAll(s);
    expect(g.inMud).toBe(false);
    const fx: FxEvent[] = [];
    applyDamage(s, q, q.hp - Math.floor(q.maxHp / 2), 'main', fx);
    const i = fx.findIndex((f) => f.t === 'bossPhase');
    expect(fx[i + 1]).toEqual({ t: 'mudGrow' });
    expect(s.hazards.map((z) => z.r)).toEqual([MUD.r + MUD_GROW, 18 + MUD_GROW]);
    expect(g.inMud).toBe(true);
    applyDamage(s, q, 1, 'main', fx);
    expect(fx.filter((f) => f.t === 'mudGrow').length).toBe(1);
    // A run's growth never leaks into the stage; patches stay inside the rails.
    const a = createRun('w4s2', BASE_STATS, 3);
    const boss = makeEnemy(a, 'boss', 90, 60);
    a.targets.push(boss);
    applyDamage(a, boss, boss.hp - Math.floor(boss.maxHp / 2), 'main', []);
    const base = makeStage('w4s2').hazards;
    a.hazards.forEach((z, k) => {
      expect(z.r).toBeGreaterThan(base[k].r);
      expect(z.r).toBeLessThanOrEqual(base[k].r + MUD_GROW);
      expect(Math.min(z.x - TABLE.x, TABLE.x + TABLE.w - z.x, z.y - TABLE.y, TABLE.y + TABLE.h - z.y)).toBeGreaterThanOrEqual(z.r - 1e-9);
    });
    expect(createRun('w4s2', BASE_STATS, 3).hazards).toEqual(base);
  });
  it('Summon makes leeches (cap 2, pay 1, never count for the clear); weight 0 at the cap; phase 1/2 kits', () => {
    const { s, q } = queenLab({}, 90, 280);
    const g = dummy(s, 'grunt', 30, 250);
    for (let k = 0; k < 3; k++) {
      q.intent = { t: 'summon' };
      for (const t of s.targets) if (t !== q) t.intent = { t: 'rest' };
      enemyPhaseOnly(s);
    }
    const ls = s.targets.filter((t) => !t.dead && t.kind === 'leech');
    expect(ls.length).toBe(BOSS_LEECH_CAP);
    for (const l of ls) expect([l.summon, l.cashBase]).toEqual([true, 1]);
    expect(liveRegulars(s)).toBe(2);
    expect(g.dead).toBe(false);
    const seen1 = new Set<string>();
    for (let i = 0; i < 200; i++) {
      rollIntentForTest(s, q);
      seen1.add(q.intent.t);
    }
    expect([...seen1].sort()).toEqual(['advance', 'attack']);
    q.phase = 1;
    const seen2 = new Set<string>();
    for (let i = 0; i < 200; i++) {
      q.charged = false;
      rollIntentForTest(s, q);
      seen2.add(q.intent.t);
    }
    expect([...seen2].sort()).toEqual(['attack', 'charge']);
    for (const l of ls) kill(s, l, 'main', []);
    const seen3 = new Set<string>();
    for (let i = 0; i < 200; i++) {
      q.charged = false;
      rollIntentForTest(s, q);
      seen3.add(q.intent.t);
    }
    expect([...seen3].sort()).toEqual(['attack', 'charge', 'summon']);
    q.charged = true;
    rollIntentForTest(s, q);
    expect(q.intent).toEqual({ t: 'attack', n: Math.max(1, Math.round(8 * stageById('w4s1').atkScale)) });
  });
});

describe('v0.7 Bog: waves and liveness', () => {
  it('leech / croaker <= 2 per wave (extras become grunts)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const id of ['w4s4', 'l1w4s3']) {
        const s = createRun(id, BASE_STATS, seed);
        for (let w = 1; w <= 3; w++) {
          s.targets = [];
          s.wave = w;
          spawnWaveForTest(s);
          expect(s.targets.filter((t) => t.kind === 'leech').length).toBeLessThanOrEqual(2);
          expect(s.targets.filter((t) => t.kind === 'croaker').length).toBeLessThanOrEqual(2);
        }
      }
    }
  });
  it('w4s4: every enemy phase ends inside MAX_ENEMY_SECONDS', () => {
    for (const seed of [2, 9]) {
      const s = createRun('w4s4', { ...BASE_STATS, maxHp: 400, damage: 4 }, seed);
      let worst = 0;
      for (let i = 0; i < 12 && s.phase === 'aim'; i++) {
        shoot(s, SHOTS[i % SHOTS.length]);
        let n = 0;
        while (s.phase !== 'aim' && s.phase !== 'over' && n++ < 240 * 60) {
          step(s, SIM_DT);
          if (s.phase === 'enemy') worst = Math.max(worst, s.resolveTime);
        }
      }
      expect(worst).toBeLessThan(4);
    }
  });
  it('w4s2: same seed + same shots => identical state; fast-forward matches', () => {
    const go = (dt: number, seed: number) => {
      const s = createRun('w4s2', { ...BASE_STATS, mudGrip: 1 }, seed);
      for (const p of SHOTS) {
        if (s.phase !== 'aim') break;
        shoot(s, p);
        untilSettled(s, dt);
      }
      return s;
    };
    for (const seed of [3, 8]) {
      expect(snapshot(go(SIM_DT, seed))).toEqual(snapshot(go(SIM_DT, seed)));
      const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT, seed));
      const { t: _b, ...normal } = snapshot(go(SIM_DT, seed));
      expect(ff).toEqual(normal);
    }
  });
});

// ---------- v0.7: world-4 forks and capstones (one test per choice) ----------
import { FOLLOW_KEEP_LV, SHARD_LIFE, SHRAPNEL_COUNT } from '../src/core/tuning';

/** Step until the first 'hit' fx (or the phase ends); returns the fx. */
function untilHit(s: RunState): FxEvent[] {
  const fx: FxEvent[] = [];
  while (s.phase === 'resolve') {
    const f = step(s, SIM_DT);
    fx.push(...f);
    if (f.some((x) => x.t === 'hit')) break;
  }
  return fx;
}
const FOLLOW = { cue: 'follow' as const, gearLevel: { follow: 3 } };
const RACK = { trick: 'rackEm' as const, trickUses: 1 };

describe('v0.7 M3: follow cue', () => {
  it('follow.plow: the 2nd hero contact of a shot +1, the 1st (and 3rd) +0', () => {
    const run = (mods: string[], prior: number) => {
      const s = mlab(mods, FOLLOW, 90, 240);
      const g = dummy(s, 'grunt', 90, 180);
      shoot(s, { x: 0, y: -MAX_PULL / 2 });
      s.followHits = prior;
      s.firstHitDone = prior > 0;
      untilHit(s);
      return 20 - g.hp;
    };
    expect(run(['follow.plow'], 0)).toBe(1);
    expect(run(['follow.plow'], 1)).toBe(2);
    expect(run(['follow.plow'], 2)).toBe(1);
    expect(run([], 1)).toBe(1);
  });
  it('follow.roll: no charge penalty (2, not 3)', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, FOLLOW, 90, 240);
      put(s, 'grunt', 90, 170).intent = { t: 'attack', n: 2 };
      enemyPhaseOnly(s);
      return BASE_STATS.maxHp - s.hp;
    };
    expect(run(['follow.roll'])).toBe(2);
    expect(run([])).toBe(3);
  });
  it('follow.cannon: the keep applies on contacts 1..3, not the 4th', () => {
    const ratio = (mods: string[], prior: number) => {
      const s = mlab(mods, FOLLOW, 90, 240);
      dummy(s, 'brute', 90, 170, 50);
      shoot(s, { x: 0, y: -MAX_PULL });
      s.followHits = prior;
      s.firstHitDone = prior > 0;
      while (s.phase === 'resolve') {
        const vy = s.balls[0].vy;
        if (step(s, SIM_DT).some((f) => f.t === 'hit')) return s.balls[0].vy / vy;
      }
      return NaN;
    };
    const keep = FOLLOW_KEEP_LV[3];
    for (const prior of [0, 1, 2]) expect(ratio(['follow.cannon'], prior)).toBeCloseTo(keep, 1);
    expect(ratio(['follow.cannon'], 3)).toBeLessThan(0.3);
    expect(ratio([], 1)).toBeLessThan(0.3);
  });
  it('follow.topspin: on Bog the hero rails at 1 after the first hit, 0.6 before', () => {
    const railRatio = (mods: string[], afterHit: boolean) => {
      const s = blab([], 90, 200, { ...FOLLOW, mods });
      shoot(s, { x: 0, y: -MAX_PULL });
      s.firstHitDone = afterHit;
      while (s.phase === 'resolve') {
        const vy = s.balls[0].vy;
        if (step(s, SIM_DT).some((f) => f.t === 'wall')) return -s.balls[0].vy / vy;
      }
      return NaN;
    };
    expect(railRatio(['follow.topspin'], true)).toBeCloseTo(1, 1);
    expect(railRatio(['follow.topspin'], false)).toBeCloseTo(0.6, 1);
    expect(railRatio([], true)).toBeCloseTo(0.6, 1);
  });
});

describe('v0.7 M3: poison', () => {
  it('poison.plague: a bump during the shot passes 1 stack; enemy-phase bumps do not', () => {
    const run = (mods: string[], enemy: boolean) => {
      const s = mlab(mods, { relics: ['poison'] }, 90, 270);
      const a = dummy(s, 'grunt', 40, 100);
      const b = dummy(s, 'grunt', 100, 100);
      a.poison = 3;
      if (enemy) bareEnemyPhase(s);
      else stillShot(s);
      a.vx = 300;
      a.resting = false;
      let maxP = 0;
      for (let i = 0; i < 240 * 3 && s.phase !== 'aim'; i++) {
        step(s, SIM_DT);
        maxP = Math.max(maxP, b.poison ?? 0);
      }
      return maxP;
    };
    expect(run(['poison.plague'], false)).toBe(1);
    expect(run(['poison.plague'], true)).toBe(0);
    expect(run([], false)).toBe(0);
  });
  it('poison.sap: a poisoned enemy deals 1 less (3 -> 2), a 1 stays 1', () => {
    const s = mlab(['poison.sap'], { relics: ['poison'] });
    const g = dummy(s, 'grunt', 90, 100);
    g.poison = 1;
    expect([numbed(s, g, 3), numbed(s, g, 1), numbed(s, g, 0)]).toEqual([2, 1, 0]);
    g.poison = 0;
    expect(numbed(s, g, 3)).toBe(3);
    const r = mlab(['poison.sap'], { relics: ['poison'] }, 90, 240);
    const c = put(r, 'grunt', 90, 170);
    c.hp = c.maxHp = 20;
    c.poison = 3; // ticks to 2 before it acts
    c.intent = { t: 'attack', n: 3 };
    enemyPhaseOnly(r);
    expect(BASE_STATS.maxHp - r.hp).toBe(2);
  });
  it('poison.blight: a poisoned enemy killed during the shot gives 2 within 40 px (gap 30 yes, 50 no); tick deaths do not', () => {
    const run = (phase: 'resolve' | 'enemy') => {
      const s = mlab(['poison.blight'], { relics: ['poison'] });
      s.phase = phase;
      const a = dummy(s, 'grunt', 60, 100, 1);
      a.poison = 2;
      const b = dummy(s, 'grunt', 60 + 24 + 30, 100);
      const c = dummy(s, 'grunt', 60, 100 + 24 + 50);
      kill(s, a, phase === 'resolve' ? 'main' : 'poison', []);
      return [b.poison ?? 0, c.poison ?? 0];
    };
    expect(run('resolve')).toEqual([2, 0]);
    expect(run('enemy')).toEqual([0, 0]);
  });
  it('poison.siphon: the phase ticks heal 1 per 3 (T 6 -> +2, T 2 -> 0)', () => {
    const run = (T: number, mods = ['poison.siphon']) => {
      const s = mlab(mods, { relics: ['poison'], maxHp: 30 });
      s.hp = 10;
      dummy(s, 'grunt', 90, 80, 50).poison = T;
      enemyPhaseOnly(s);
      return s.hp - 10;
    };
    expect(run(6)).toBe(2);
    expect(run(2)).toBe(0);
    expect(run(6, [])).toBe(0);
  });
});

describe('v0.7 M3: thorns', () => {
  const charge = (mods: string[], over: Partial<RunStats> = {}, kind: TargetKind = 'grunt') => {
    const s = mlab(mods, { relics: ['thorns'], maxHp: 60, ...over }, 90, 240);
    const e = put(s, kind, 90, kind === 'boss' ? 150 : 170);
    e.hp = e.maxHp = 200;
    e.intent = { t: 'attack', n: 2 };
    stillShot(s);
    const h = s.balls[0];
    let v = -1;
    let away = 0;
    const fx: FxEvent[] = [];
    while (s.phase !== 'aim') {
      const f = step(s, SIM_DT);
      fx.push(...f);
      if (v < 0 && f.some((x) => x.t === 'heroHit')) {
        v = Math.hypot(e.vx, e.vy);
        away = e.vx * (e.x - h.x) + e.vy * (e.y - h.y);
      }
    }
    return { s, e, v, away, fx };
  };
  it('thorns.barbs: a pricked charger is poisoned 2 and ticks without the Poison card', () => {
    const { s, e } = charge(['thorns.barbs']);
    expect(e.poison).toBe(2);
    expect(e.hp).toBe(200 - THORNS_RELIC_DMG[0]);
    e.intent = { t: 'rest' };
    enemyPhaseOnly(s);
    expect(e.hp).toBe(200 - THORNS_RELIC_DMG[0] - 2);
    expect(e.poison).toBe(1);
    expect(charge([]).e.poison ?? 0).toBe(0);
  });
  it('thorns.riposte: the charger rolls away at 200 px/s; the boss does not', () => {
    const r = charge(['thorns.riposte']);
    expect(Math.abs(r.v - 200)).toBeLessThan(3);
    expect(r.away).toBeGreaterThan(0);
    expect(charge(['thorns.riposte'], {}, 'boss').v).toBe(0);
    expect(charge([]).v).toBe(0);
  });
  it('thorns.brace: the first landed charge each phase deals half (4 -> 2), the next full', () => {
    const s = mlab(['thorns.brace'], { relics: ['thorns'], maxHp: 60 }, 90, 240);
    const a = put(s, 'grunt', 90, 170);
    const b = put(s, 'grunt', 90, 274);
    for (const e of [a, b]) ((e.hp = e.maxHp = 50), (e.intent = { t: 'attack', n: 4 }));
    const hits = (fx: FxEvent[]) => fx.filter((f): f is Extract<FxEvent, { t: 'heroHit' }> => f.t === 'heroHit' && f.how === 'charge').map((f) => f.dmg);
    expect(hits(enemyPhaseOnly(s))).toEqual([2, 4]);
    expect(a.hp).toBe(50 - THORNS_RELIC_DMG[0]);
    a.intent = { t: 'attack', n: 4 };
    b.intent = { t: 'rest' };
    expect(hits(enemyPhaseOnly(s))).toEqual([2]);
  });
  it('thorns.quills: the thorns deal the hero damage stat', () => {
    expect(charge(['thorns.quills'], { damage: 5 }).e.hp).toBe(200 - 5);
    expect(charge([], { damage: 5 }).e.hp).toBe(200 - THORNS_RELIC_DMG[0]);
  });
});

describe('v0.7 M3: shrapnel', () => {
  const killShards = (mods: string[], over: Partial<RunStats> = {}) => {
    const s = mlab(mods, { relics: ['shrapnel'], ...over }, 90, 270);
    stillShot(s);
    const a = dummy(s, 'grunt', 60, 100, 1);
    const fx: FxEvent[] = [];
    kill(s, a, 'main', fx, s.balls[0]);
    return { s, fx, shards: s.balls.filter((b) => b.shard) };
  };
  it('shrapnel.flak: shards live 1.2 s', () => {
    const on = killShards(['shrapnel.flak']).shards;
    expect(on.length).toBe(SHRAPNEL_COUNT[0]);
    for (const b of on) expect(b.life).toBe(1.2);
    for (const b of killShards([]).shards) expect(b.life).toBe(SHARD_LIFE);
  });
  it('shrapnel.spear: one shard at the hero damage, aimed at the nearest enemy within 80 px', () => {
    const s = mlab(['shrapnel.spear'], { relics: ['shrapnel'], damage: 3 }, 90, 270);
    stillShot(s);
    const a = dummy(s, 'grunt', 60, 100, 1);
    const b = dummy(s, 'grunt', 130, 100, 20);
    kill(s, a, 'main', [], s.balls[0]);
    const sh = s.balls.filter((x) => x.shard);
    expect(sh.length).toBe(1);
    expect(sh[0].spear).toBe(true);
    expect(sh[0].vx).toBeGreaterThan(0);
    expect(Math.abs(sh[0].vy)).toBeLessThan(1e-6);
    const fx = resolveAll(s);
    expect(hitsOf(fx, 'spat')[0].dmg).toBe(3);
    expect(b.hp).toBeLessThanOrEqual(17);
  });
  it('shrapnel.fragment: the first shard kill of a shot sheds 2 plain shards, once', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, { relics: ['shrapnel'] }, 90, 270);
      stillShot(s);
      const shard = { id: 950, kind: 'spat' as const, shard: true, x: 30, y: 60, vx: 0, vy: 0, r: 2, mass: 0.4, life: 1, resting: false, banked: false };
      s.balls.push(shard);
      const n0 = s.balls.length;
      kill(s, dummy(s, 'grunt', 60, 100, 1), 'spat', [], shard);
      const n1 = s.balls.length;
      kill(s, dummy(s, 'grunt', 120, 100, 1), 'spat', [], shard);
      return [n1 - n0, s.balls.length - n1, s.balls.filter((b) => b.spear).length];
    };
    expect(run(['shrapnel.fragment'])).toEqual([2, 0, 0]);
    expect(run([])).toEqual([0, 0, 0]);
  });
  it('shrapnel.plating: a hero-ball kill blocks one charge, at most once a wave', () => {
    const s = mlab(['shrapnel.plating'], { maxHp: 40 }, 90, 240);
    const g = put(s, 'grunt', 90, 170);
    g.hp = g.maxHp = 50;
    const kills = () => {
      s.phase = 'resolve';
      kill(s, dummy(s, 'grunt', 30, 60, 1), 'main', [], s.balls[0]);
      s.phase = 'aim';
    };
    kills();
    expect(s.plated).toBe(true);
    g.intent = { t: 'attack', n: 3 };
    const fx = enemyPhaseOnly(s);
    expect(s.hp).toBe(40);
    expect(fx.some((f) => f.t === 'blocked')).toBe(true);
    expect([s.plated, s.platingWave]).toEqual([false, s.wave]);
    kills();
    g.x = 90;
    g.y = 170;
    s.balls[0].x = 90;
    s.balls[0].y = 240;
    g.intent = { t: 'attack', n: 3 };
    enemyPhaseOnly(s);
    expect(s.hp).toBe(37);
  });
});

describe("v0.7 M3: rack 'em", () => {
  it('rackEm.tight: pulls 30 px (20 without)', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, RACK, 90, 270);
      const g = dummy(s, 'grunt', 90, 60);
      useTrick(s);
      return g.y - 60;
    };
    expect(run(['rackEm.tight'])).toBeCloseTo(30, 6);
    expect(run([])).toBeCloseTo(20, 6);
  });
  it('rackEm.scatter: every enemy pushed 20 px away from the centre; no overlaps', () => {
    const s = mlab(['rackEm.scatter'], RACK, 90, 270);
    const a = dummy(s, 'grunt', 64, 160);
    const b = dummy(s, 'grunt', 116, 160);
    const c = dummy(s, 'grunt', 90, 120);
    useTrick(s);
    expect([a.x, b.x, c.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([44, 136, 100]);
    expect(maxOverlap(s)).toBeLessThan(0.01);
  });
  it('rackEm.rerack: rerolls every intent but the scripted kinds; deterministic', () => {
    const run = (mods: string[]) => {
      const s = mlab(mods, RACK, 90, 270);
      const gs = [30, 70, 110, 150].map((x) => dummy(s, 'grunt', x, 80));
      const br = put(s, 'brute', 90, 150);
      const bi = br.intent;
      useTrick(s);
      return { intents: gs.map((g) => g.intent), brute: br.intent === bi, rng: JSON.stringify(s.rng) };
    };
    const a = run(['rackEm.rerack']);
    expect(a).toEqual(run(['rackEm.rerack']));
    expect(a.intents.some((i) => i.t !== 'rest')).toBe(true);
    expect(a.brute).toBe(true);
    expect(run([]).intents.every((i) => i.t === 'rest')).toBe(true);
  });
  it('rackEm.tableroll: a grunt racked into mud is held 1; the boss is not', () => {
    const MID: Hazard = { kind: 'mud', x: 90, y: 160, r: 20 };
    const g = (() => {
      const s = blab([MID], 90, 270, { ...RACK, mods: ['rackEm.tableroll'] });
      const e = dummy(s, 'grunt', 90, 190);
      useTrick(s);
      return e;
    })();
    expect(g.held).toBe(1);
    const s = blab([MID], 90, 290, { ...RACK, mods: ['rackEm.tableroll'] });
    const q = dummy(s, 'boss', 90, 195);
    useTrick(s);
    expect(inMudAt(s, q.x, q.y)).toBe(true);
    expect(q.held).toBeUndefined();
    const off = blab([MID], 90, 270, RACK);
    const e2 = dummy(off, 'grunt', 90, 190);
    useTrick(off);
    expect(e2.held).toBeUndefined();
  });
});

describe('v0.7 M3 w4: determinism with the new choices', () => {
  const W4: RunStats = {
    ...BASE_STATS, damage: 2, maxHp: 60, cue: 'follow', relics: ['poison', 'thorns', 'shrapnel'], trick: 'rackEm', trickUses: 2, mudGrip: 1,
    gearLevel: { follow: 3, poison: 3, thorns: 3, shrapnel: 3, rackEm: 3 },
    mods: ['follow.plow', 'follow.cannon', 'poison.plague', 'poison.blight', 'thorns.barbs', 'thorns.brace', 'shrapnel.spear', 'shrapnel.fragment', 'rackEm.rerack'],
  };
  it('w4 kit on w4s2: same seed => identical state; fast-forward matches', () => {
    const go = (dt: number) => {
      const s = createRun('w4s2', W4, 7);
      SHOTS.forEach((p, i) => {
        if (s.phase !== 'aim') return;
        if (i === 1) useTrick(s);
        shoot(s, p);
        untilSettled(s, dt);
      });
      return s;
    };
    const a = go(SIM_DT);
    expect(a.shots).toBeGreaterThan(1);
    expect(snapshot(a)).toEqual(snapshot(go(SIM_DT)));
    const { t: _a, ...ff } = snapshot(go(SIM_DT * FAST_FORWARD_MULT));
    const { t: _b, ...normal } = snapshot(go(SIM_DT));
    expect(ff).toEqual(normal);
  });
});
