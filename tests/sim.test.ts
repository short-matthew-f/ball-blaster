import { describe, expect, it } from 'vitest';
import { FAST_FORWARD_MULT, MAX_LAUNCH_SPEED, MAX_PULL, MIN_POWER, SIM_DT, TABLE, type FxEvent, type RunState, type TargetKind, type Vec } from '../src/core/types';
import { ATK_GROWTH, BASE_STATS, CASH_GROWTH, HARDY_MOD_HP, HP_GROWTH, RANGED_PHASE_CAP, SLOT_ATK_MULT, SLOT_HP_MULT, SPAWN_ZONE, TARGET_DEFS, WAVE_CASH, stageById } from '../src/core/tuning';
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
import { hasCorridor, jamRule } from '../src/sim/run';
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

describe('step 4: arrivals and Overtime enrage', () => {
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
  it('Overtime enrage starts at turn 6 of each Overtime wave', () => {
    const s = lab();
    s.wave = 6;
    s.waveTurn = 4; // turn 5
    expect(rageLevel(s)).toBe(0);
    s.waveTurn = 5; // turn 6
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

  it('slots: modifier counts, boss traits, elites from wave 2; loops: two modifiers, all traits, Overtime 1x', () => {
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
          expect(st.overtimeCash).toBe(loop > 0 ? 1 : 2);
          if (k >= 3 && !st.modifiers.includes('earlyBoss')) expect(st.waves[1].elites ?? 0).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(makeStage('w1s2').bossTraits).toEqual(['phases', 'cadre']);
    expect(makeStage('w1s3').bossTraits).toEqual(['phases', 'moves']);
    expect(makeStage('w2s1').bossTraits).toContain('cadre'); // Rime Golem's signature
    expect(makeStage('w1s1').boss.cadre).toBe(0);
  });

  it('scaling: HP, attack and cash grow per global index; emeralds 3 + n', () => {
    const a = makeStage('w1s1');
    const b = makeStage('w1s4');
    expect(a.hpScale).toBe(1);
    expect(a.cashScale).toBe(0.5);
    expect(b.cashScale).toBeCloseTo(0.5 * CASH_GROWTH ** 3);
    expect(b.atkScale).toBeCloseTo(SLOT_ATK_MULT[3] * ATK_GROWTH ** 3);
    expect(b.emeraldReward).toBe(6);
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
    s.stats.waveHeal = 0; // the Overtime wave's clear-heal would revive a 0-HP hero
    s.hp = 0;
    enemyPhaseOnly(s);
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
    expect(makeStage('w3s1').hazards).toEqual([]);
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
