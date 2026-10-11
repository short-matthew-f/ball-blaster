import { describe, expect, it } from 'vitest';
import { FAST_FORWARD_MULT, MAX_LAUNCH_SPEED, MAX_PULL, MIN_POWER, SIM_DT, TABLE, type FxEvent, type RunState, type TargetKind, type Vec } from '../src/core/types';
import { BASE_STATS, SPAWN_ZONE, TARGET_DEFS, WAVE_CASH } from '../src/core/tuning';
import { Rng } from '../src/core/rng';

const SPAWN_ZONE_Y = TABLE.y + TABLE.h - SPAWN_ZONE;
import { canFastForward, createRun, heal, previewShot, shoot, step } from '../src/sim/index';
import { makeEnemy, placeFormation } from '../src/sim/spawn';
import { maxOverlap } from '../src/sim/physics';
import { rageLevel } from '../src/sim/enemy';
import { hasCorridor, jamRule } from '../src/sim/run';
import { updateBossShield } from '../src/sim/damage';

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
  const s = createRun('felt', BASE_STATS, seed);
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
  const s = createRun('felt', { ...BASE_STATS }, 42);
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
    const a = createRun('felt', BASE_STATS, 1);
    const b = createRun('felt', BASE_STATS, 2);
    expect(a.targets.map((t) => t.x)).not.toEqual(b.targets.map((t) => t.x));
  });
});

describe('shooting', () => {
  it('cancel (drag < CANCEL_RADIUS) stays in aim', () => {
    const s = createRun('felt', BASE_STATS, 1);
    expect(shoot(s, { x: 3, y: 2 })).toBe(false);
    expect(s.phase).toBe('aim');
    expect(s.shots).toBe(0);
  });
  it('shots are free and fire at >= MIN_POWER', () => {
    const s = createRun('felt', BASE_STATS, 1);
    expect(shoot(s, { x: 0, y: -13 })).toBe(true);
    const b = s.balls[0];
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(MIN_POWER * MAX_LAUNCH_SPEED, 6);
    expect(s.hp).toBe(BASE_STATS.maxHp);
    expect(shoot(s, { x: 0, y: MAX_PULL })).toBe(false); // no shooting while balls move
    expect(step(s, SIM_DT).some((f) => f.t === 'shoot')).toBe(true);
  });
  it('previewShot is empty without the upgrade and a polyline with it', () => {
    const s = createRun('felt', BASE_STATS, 1);
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
    const s = createRun('felt', BASE_STATS, 3);
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
      const s = createRun('felt', BASE_STATS, seed);
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
    // Hard hit: shatter (kill + rewards).
    calm();
    s.balls[0].x = 95;
    s.balls[0].y = 200;
    const cash = s.cash;
    shoot(s, { x: 0, y: -MAX_PULL });
    const fx: FxEvent[] = [];
    while ((s.phase as string) === 'resolve') fx.push(...step(s, SIM_DT));
    expect(g.dead).toBe(true);
    expect(fx.some((e) => e.t === 'shatter')).toBe(true);
    expect(s.cash).toBeGreaterThan(cash);
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
    const s = createRun('ice', BASE_STATS, 5);
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
      const s = createRun('ice', { ...BASE_STATS, damage: 4, maxHp: 35 }, seed);
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
