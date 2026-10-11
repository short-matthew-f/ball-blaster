import { describe, expect, it } from 'vitest';
import { MAX_PULL, SIM_DT, type RunState, type RunStats } from '../src/core/types';
import { BASE_STATS } from '../src/core/tuning';
import { createRun, shoot, step } from '../src/sim/index';
import { NODES, bankRun, buildStats, buy, buyState, newSave, nextCost } from '../src/meta';

/** Simple bot: aim at the nearest live target at full power; step until aim/over. */
function playRun(seed: number) {
  const s: RunState = createRun('felt', BASE_STATS, seed);
  const openingIds = s.targets.map((t) => t.id);
  const killedOpening = new Set<number>();
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 400) {
    const main = s.balls.find((b) => b.kind === 'main')!;
    const live = s.targets.filter((t) => !t.dead && t.shimmer <= 0);
    if (live.length === 0) break;
    live.sort((a, b) => Math.hypot(a.x - main.x, a.y - main.y) - Math.hypot(b.x - main.x, b.y - main.y));
    const t = live[0];
    const d = Math.hypot(t.x - main.x, t.y - main.y) || 1;
    if (!shoot(s, { x: ((t.x - main.x) / d) * MAX_PULL, y: ((t.y - main.y) / d) * MAX_PULL })) break;
    let n = 0;
    do {
      step(s, SIM_DT);
      for (const id of openingIds) {
        const ot = s.targets.find((x) => x.id === id);
        if (!ot || ot.dead) killedOpening.add(id);
      }
    } while ((s.phase as string) !== 'aim' && (s.phase as string) !== 'over' && n++ < 240 * 60);
  }
  return {
    cash: s.cash,
    seconds: s.t,
    shots: s.shots,
    kills: s.kills,
    over: s.phase === 'over',
    allOpeningKilled: killedOpening.size === openingIds.length,
  };
}

describe('balance: run 1 with BASE_STATS on felt', () => {
  it('earns the first upgrade, lasts a reasonable time, and leaves the opening board standing', () => {
    const runs = Array.from({ length: 20 }, (_, i) => playRun(1000 + i * 7919));
    const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const cash = avg((r) => r.cash);
    const seconds = avg((r) => r.seconds);
    const allKilled = runs.filter((r) => r.allOpeningKilled).length;
    console.log(
      `balance: avg cash ${cash.toFixed(1)}, avg seconds ${seconds.toFixed(1)}, avg shots ${avg((r) => r.shots).toFixed(1)}, ` +
        `avg kills ${avg((r) => r.kills).toFixed(1)}, all-opening-killed ${allKilled}/20, cash>=5 on ${runs.filter((r) => r.cash >= 5).length}/20`,
    );
    expect(runs.every((r) => r.over)).toBe(true);
    expect(cash).toBeGreaterThanOrEqual(6);
    expect(seconds).toBeGreaterThanOrEqual(14); // target ~7 shots, 15-30 s
    expect(seconds).toBeLessThanOrEqual(150);
    expect(allKilled).toBeLessThan(10);
  });
});

// ---------- Progression pacing ----------

/** Plays one run with `stats`: nearest live target at full power. Returns result + first boss-arrival energy. */
function botRun(stats: RunStats, seed: number) {
  const s: RunState = createRun('felt', stats, seed);
  let arrivalEnergy: number | null = null;
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 2000) {
    const main = s.balls.find((b) => b.kind === 'main')!;
    const live = s.targets.filter((t) => !t.dead && t.shimmer <= 0);
    let pull = { x: 0, y: -MAX_PULL };
    if (live.length) {
      live.sort((a, b) => Math.hypot(a.x - main.x, a.y - main.y) - Math.hypot(b.x - main.x, b.y - main.y));
      const t = live[0];
      const d = Math.hypot(t.x - main.x, t.y - main.y) || 1;
      pull = { x: ((t.x - main.x) / d) * MAX_PULL, y: ((t.y - main.y) / d) * MAX_PULL };
    }
    if (!shoot(s, pull)) break;
    let n = 0;
    do {
      const fx = step(s, SIM_DT);
      if (arrivalEnergy === null && fx.some((f) => f.t === 'bossArrive')) arrivalEnergy = s.energy;
    } while ((s.phase as string) !== 'aim' && (s.phase as string) !== 'over' && n++ < 240 * 60);
  }
  return { result: s.result!, arrivalEnergy };
}

function progression(seed: number, runs: number) {
  const save = newSave();
  const log: { spawned: boolean; killed: boolean; seconds: number; arrivalEnergy: number | null }[] = [];
  for (let i = 0; i < runs; i++) {
    const { result, arrivalEnergy } = botRun(buildStats(save), seed * 1000 + i);
    log.push({ spawned: arrivalEnergy !== null, killed: result.bossKilled, seconds: result.seconds, arrivalEnergy });
    bankRun(save, result);
    // Greedy: keep buying the cheapest affordable cash node.
    for (;;) {
      const ok = NODES.filter((n) => n.currency === 'cash' && buyState(save, n) === 'ok');
      if (!ok.length) break;
      ok.sort((a, b) => nextCost(save, a)! - nextCost(save, b)! || a.id.localeCompare(b.id));
      buy(save, ok[0]);
    }
  }
  return log;
}

describe('balance: progression pacing (greedy shopper bot, felt)', () => {
  it('first boss spawn ~run 4-7, first kill ~6-10, runs lengthen', () => {
    const SEEDS = [11, 23, 37, 41, 53, 67, 79, 97];
    const logs = SEEDS.map((sd) => progression(sd, 30));
    const firstIdx = (l: (typeof logs)[number], f: (r: (typeof l)[number]) => boolean) => {
      const i = l.findIndex(f);
      return i < 0 ? 99 : i + 1;
    };
    const spawns = logs.map((l) => firstIdx(l, (r) => r.spawned));
    const kills = logs.map((l) => firstIdx(l, (r) => r.killed));
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const avgAt = (i: number) => logs.reduce((a, l) => a + l[i - 1].seconds, 0) / logs.length;
    const arrival = logs.map((l) => l.find((r) => r.spawned)?.arrivalEnergy ?? NaN);
    console.log(
      `pacing: first boss spawn runs ${spawns.join(',')} (median ${median(spawns)}); first kill runs ${kills.join(',')} (median ${median(kills)})\n` +
        `pacing: avg run seconds r1 ${avgAt(1).toFixed(1)}, r5 ${avgAt(5).toFixed(1)}, r10 ${avgAt(10).toFixed(1)}, r20 ${avgAt(20).toFixed(1)}\n` +
        `pacing: energy at first boss arrival ${arrival.map((e) => e.toFixed(0)).join(',')}`,
    );
    expect(median(spawns)).toBeGreaterThanOrEqual(3);
    expect(median(spawns)).toBeLessThanOrEqual(9);
    expect(median(kills)).toBeGreaterThanOrEqual(4);
    expect(median(kills)).toBeLessThanOrEqual(14);
    expect(avgAt(1)).toBeGreaterThanOrEqual(14);
    expect(avgAt(1)).toBeLessThanOrEqual(50);
    expect(avgAt(10)).toBeGreaterThanOrEqual(60);
    for (const e of arrival) if (Number.isFinite(e)) expect(e).toBeGreaterThan(0);
  }, 120_000);
});
