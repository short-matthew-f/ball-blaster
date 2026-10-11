import { describe, expect, it } from 'vitest';
import { MAX_PULL, SIM_DT, type RunState } from '../src/core/types';
import { BASE_STATS } from '../src/core/tuning';
import { createRun, shoot, step } from '../src/sim/index';

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
    expect(cash).toBeGreaterThanOrEqual(10);
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(150);
    expect(allKilled).toBeLessThan(10);
  });
});
