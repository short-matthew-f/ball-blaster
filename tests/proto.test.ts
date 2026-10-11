// v0.2 build step 1: physics + sizes + formations + enemy charges, bot-measured.
// Two bots (nearest enemy / largest cluster, always full power) x two stat lines (run 1 base, mid-game) x 30 seeds.
import { describe, expect, it } from 'vitest';
import { MAX_PULL, SIM_DT, TABLE, type RunResult, type RunState, type RunStats, type SaveData, type Target } from '../src/core/types';
import { NODES, bankRun, buildStats, buy, buyState, newSave, nextCost } from '../src/meta/index';
import { BASE_STATS } from '../src/core/tuning';
import { createRun, shoot, step } from '../src/sim/index';
import { maxOverlap } from '../src/sim/physics';

const SEEDS = 30;
const SHOT_CAP = 300;
const MID: RunStats = { ...BASE_STATS, damage: 4, maxHp: 35 };

type Bot = 'nearest' | 'cluster';

function pickTarget(s: RunState, bot: Bot): Target {
  const h = s.balls[0];
  const live = s.targets.filter((t) => !t.dead);
  const dist = (t: Target) => Math.hypot(t.x - h.x, t.y - h.y);
  if (bot === 'nearest') return live.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  const score = (t: Target) => live.filter((o) => Math.hypot(o.x - t.x, o.y - t.y) <= 50).length;
  return live.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && dist(b) < dist(a)) ? b : a));
}

interface RunLog {
  hits: number[];
  kills: number[];
  jams: number;
  knock: number[];
  enemySec: number[];
  resolveSec: number[];
  dmgPerPhase: number[];
  charges: number;
  restGap: number[];
  bumps: number;
  direct: number;
  connects: number;
  blockedCharges: number;
  attackAsAdvance: number;
  shotsFired: number;
  shots: number;
  seconds: number;
  cash: number;
  wave: number;
  terminated: boolean;
  problems: string[];
}

function checkSane(s: RunState, where: string, problems: string[]): void {
  const bodies = [...s.balls, ...s.targets.filter((t) => !t.dead)];
  for (const b of bodies) {
    if (![b.x, b.y, b.vx, b.vy].every(Number.isFinite)) problems.push(`${where}: NaN body`);
    if (b.x - b.r < TABLE.x - 0.01 || b.x + b.r > TABLE.x + TABLE.w + 0.01 || b.y - b.r < TABLE.y - 0.01 || b.y + b.r > TABLE.y + TABLE.h + 0.01) {
      problems.push(`${where}: body outside table`);
    }
  }
  if (!Number.isFinite(s.hp)) problems.push(`${where}: NaN hp`);
  const ov = maxOverlap(s);
  if (ov > 0.5) problems.push(`${where}: overlap ${ov.toFixed(2)} at rest`);
}

function playRun(seed: number, stats: RunStats, bot: Bot): RunLog {
  const s = createRun('felt', stats, seed);
  const log: RunLog = { hits: [], kills: [], jams: 0, knock: [], enemySec: [], resolveSec: [], dmgPerPhase: [], charges: 0, restGap: [], bumps: 0, direct: 0, connects: 0, blockedCharges: 0, attackAsAdvance: 0, shotsFired: 0, shots: 0, seconds: 0, cash: 0, wave: 0, terminated: false, problems: [] };
  checkSane(s, 'start', log.problems);
  while (s.phase === 'aim' && s.shots < SHOT_CAP) {
    const h = s.balls[0];
    const tg = pickTarget(s, bot);
    const d = Math.hypot(tg.x - h.x, tg.y - h.y) || 1;
    shoot(s, { x: ((tg.x - h.x) / d) * MAX_PULL, y: ((tg.y - h.y) / d) * MAX_PULL });
    const t0 = s.t;
    while ((s.phase as string) === 'resolve') step(s, SIM_DT);
    log.resolveSec.push(s.t - t0);
    log.hits.push(s.combo.hits);
    log.bumps += s.combo.bumps ?? 0;
    log.direct += s.combo.direct ?? 0;
    {
      const live = s.targets.filter((t) => !t.dead);
      if (live.length) log.restGap.push(Math.min(...live.map((t) => Math.hypot(t.x - h.x, t.y - h.y) - t.r - h.r)));
    }
    log.kills.push(s.combo.kills);
    const t1 = s.t;
    const hx = h.x;
    const hy = h.y;
    const hp0 = s.hp;
    let jamFrom: { x: number; y: number } | null = null;
    const attackers = new Set(s.targets.filter((t) => !t.dead && t.intent.t === 'attack').map((t) => t.id));
    while ((s.phase as string) === 'enemy') {
      for (const f of step(s, SIM_DT)) {
        if (f.t === 'jam') jamFrom = { x: f.x0, y: f.y0 };
        if (f.t === 'launch' && f.intent === 'attack') log.charges++;
        if (f.t === 'launch' && f.intent === 'advance' && attackers.has(f.id)) log.attackAsAdvance++;
        if (f.t === 'heroHit' && f.how === 'charge') log.connects++;
        if (f.t === 'heroHit' && f.how === 'shot') log.shotsFired++;
        if (f.t === 'blocked') log.blockedCharges++;
      }
    }
    log.enemySec.push(s.t - t1);
    const end = jamFrom ?? h;
    log.knock.push(Math.hypot(end.x - hx, end.y - hy));
    log.dmgPerPhase.push(hp0 - s.hp);
    if (s.phase === 'aim') checkSane(s, `seed ${seed} shot ${s.shots}`, log.problems);
  }
  log.terminated = s.phase === 'over';
  log.jams = s.jams;
  log.shots = s.shots;
  log.seconds = s.t;
  log.cash = s.cash;
  log.wave = s.wave;
  return log;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);
const pct = (a: number[], p: number) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0;
};
const f1 = (x: number) => Math.round(x * 10) / 10;
const f2 = (x: number) => Math.round(x * 100) / 100;

const CONFIGS: { name: string; stats: RunStats; bot: Bot }[] = [
  { name: 'run1/nearest', stats: BASE_STATS, bot: 'nearest' },
  { name: 'run1/cluster', stats: BASE_STATS, bot: 'cluster' },
  { name: 'mid/nearest', stats: MID, bot: 'nearest' },
  { name: 'mid/cluster', stats: MID, bot: 'cluster' },
];

describe('v0.2 prototype bot (30 seeds per config)', () => {
  const results = CONFIGS.map((c) => ({ c, logs: Array.from({ length: SEEDS }, (_, i) => playRun(1000 + i, c.stats, c.bot)) }));

  it('reports metrics', () => {
    const hitsTable: Record<string, Record<string, string | number>> = {};
    const phaseTable: Record<string, Record<string, string | number>> = {};
    const runTable: Record<string, Record<string, string | number>> = {};
    const intentTable: Record<string, Record<string, string | number>> = {};
    const leaveTable: Record<string, Record<string, string | number>> = {};
    for (const { c, logs } of results) {
      const hits = logs.flatMap((l) => l.hits);
      const kills = logs.flatMap((l) => l.kills);
      const n = hits.length;
      const share = (f: (h: number) => boolean) => `${Math.round((100 * hits.filter(f).length) / n)}%`;
      hitsTable[c.name] = {
        shots: n,
        '0': share((h) => h === 0),
        '1': share((h) => h === 1),
        '2': share((h) => h === 2),
        '3': share((h) => h === 3),
        '4+': share((h) => h >= 4),
        'hits/shot': f2(mean(hits)),
        'kills/shot': f2(mean(kills)),
      };
      const knock = logs.flatMap((l) => l.knock);
      const es = logs.flatMap((l) => l.enemySec);
      const rs = logs.flatMap((l) => l.resolveSec);
      const dmg = logs.flatMap((l) => l.dmgPerPhase);
      phaseTable[c.name] = {
        'jams/run': f2(mean(logs.map((l) => l.jams))),
        'knock mean': f1(mean(knock)),
        'knock p90': f1(pct(knock, 0.9)),
        'knock max': f1(max(knock)),
        'enemy s mean': f2(mean(es)),
        'enemy s max': f2(max(es)),
        'resolve s mean': f2(mean(rs)),
        'resolve s max': f2(max(rs)),
        'dmg/phase mean': f2(mean(dmg)),
        'dmg/phase max': max(dmg),
      };
      const sum = (f: (l: RunLog) => number) => logs.reduce((a, l) => a + f(l), 0);
      const phases = es.length;
      intentTable[c.name] = {
        'charges/phase': f2(sum((l) => l.charges) / phases),
        'connect %': Math.round((100 * sum((l) => l.connects)) / Math.max(1, sum((l) => l.charges))),
        'blocked/phase': f2(sum((l) => l.blockedCharges) / phases),
        'attack->advance/phase': f2(sum((l) => l.attackAsAdvance) / phases),
        'ranged hits/phase': f2(sum((l) => l.shotsFired) / phases),
      };
      const gaps = logs.flatMap((l) => l.restGap);
      const g = (lo: number, hi: number) => `${Math.round((100 * gaps.filter((x) => x >= lo && x < hi).length) / Math.max(1, gaps.length))}%`;
      const totalHits = sum((l) => l.bumps + l.direct);
      leaveTable[c.name] = {
        'gap <2 (touching)': g(-1, 2),
        '2-30': g(2, 30),
        '30-60': g(30, 60),
        '60-110': g(60, 110),
        '110+': g(110, 1e9),
        'gap median': f1(pct(gaps, 0.5)),
        'bump share of hits': `${Math.round((100 * sum((l) => l.bumps)) / Math.max(1, totalHits))}%`,
      };
      runTable[c.name] = {
        'shots mean': f1(mean(logs.map((l) => l.shots))),
        'shots p10-p90': `${pct(logs.map((l) => l.shots), 0.1)}-${pct(logs.map((l) => l.shots), 0.9)}`,
        'seconds mean': f1(mean(logs.map((l) => l.seconds))),
        'cash mean': f1(mean(logs.map((l) => l.cash))),
        'wave mean': f2(mean(logs.map((l) => l.wave))),
        'wave max': max(logs.map((l) => l.wave)),
        'boss kills': logs.filter((l) => l.wave > 4).length,
      };
    }
    console.log('Hits per shot');
    console.table(hitsTable);
    console.log('Enemy phase / physics');
    console.table(phaseTable);
    console.log('Enemy actions');
    console.table(intentTable);
    console.log('Leave: hero edge gap to the nearest enemy after the shot; hit sources');
    console.table(leaveTable);
    console.log('Runs');
    console.table(runTable);
  });

  it('sanity: no NaN, nothing outside the table, no overlap at rest, every run terminates', () => {
    for (const { c, logs } of results) {
      for (const l of logs) {
        expect(l.problems.slice(0, 3), c.name).toEqual([]);
        expect(l.terminated, `${c.name} hit the ${SHOT_CAP}-shot cap`).toBe(true);
      }
    }
  });

  it('enemy phases settle fast and jams are rare', () => {
    for (const { c, logs } of results) {
      expect(mean(logs.flatMap((l) => l.enemySec)), c.name).toBeLessThan(2.5);
      expect(mean(logs.map((l) => l.jams)), c.name).toBeLessThan(0.3);
    }
  });
});

// ---------- Progression bot: newSave -> buildStats -> play -> bankRun -> greedy cheapest buys ----------

const PROG_RUNS = 25;
const PROG_SEEDS = 8;

function playForResult(seed: number, stats: RunStats): RunResult {
  const s = createRun('felt', stats, seed);
  while (s.phase === 'aim' && s.shots < 600) {
    const h = s.balls[0];
    const tg = pickTarget(s, 'cluster');
    const d = Math.hypot(tg.x - h.x, tg.y - h.y) || 1;
    shoot(s, { x: ((tg.x - h.x) / d) * MAX_PULL, y: ((tg.y - h.y) / d) * MAX_PULL });
    while ((s.phase as string) === 'resolve' || (s.phase as string) === 'enemy') step(s, SIM_DT * 8);
  }
  expect(s.phase, `seed ${seed}: progression run hit the shot cap`).toBe('over');
  return s.result!;
}

function greedyBuy(save: SaveData): void {
  for (;;) {
    const ok = NODES.filter((n) => buyState(save, n) === 'ok');
    if (!ok.length) return;
    ok.sort((a, b) => (nextCost(save, a) ?? 0) - (nextCost(save, b) ?? 0) || a.id.localeCompare(b.id));
    buy(save, ok[0]);
  }
}

describe('progression bot (greedy cheapest-node shopper, felt)', () => {
  it('reports first boss reached / killed, run lengths and overtime', () => {
    const firstReach: number[] = [];
    const firstKill: number[] = [];
    const secs: Record<number, number[]> = { 1: [], 5: [], 10: [], 20: [], 25: [] };
    const otAt20: number[] = [];
    const waveAt: Record<number, number[]> = { 1: [], 5: [], 10: [], 20: [] };
    for (let k = 0; k < PROG_SEEDS; k++) {
      const save = newSave();
      let reach = 0;
      let killed = 0;
      for (let r = 1; r <= PROG_RUNS; r++) {
        const res = playForResult(5000 + k * 100 + r, buildStats(save));
        bankRun(save, res);
        save.current = 'felt';
        if (!reach && res.wave >= 4) reach = r;
        if (!killed && res.bossKilled) killed = r;
        if (secs[r]) secs[r].push(res.seconds);
        if (waveAt[r]) waveAt[r].push(res.bossKilled ? 4 + res.overtimeWaves : res.wave);
        if (r === 20) otAt20.push(res.overtimeWaves);
        greedyBuy(save);
      }
      firstReach.push(reach || PROG_RUNS + 1);
      firstKill.push(killed || PROG_RUNS + 1);
    }
    const med = (a: number[]) => pct(a, 0.5);
    const table: Record<string, Record<string, string | number>> = {
      'first boss reached (run)': { median: med(firstReach), min: Math.min(...firstReach), max: Math.max(...firstReach) },
      'first boss kill (run)': { median: med(firstKill), min: Math.min(...firstKill), max: Math.max(...firstKill) },
    };
    for (const r of [1, 5, 10, 20, 25]) table[`r${r} seconds`] = { median: f1(med(secs[r])), min: f1(Math.min(...secs[r])), max: f1(Math.max(...secs[r])) };
    for (const r of [1, 5, 10, 20]) table[`r${r} wave (5+ = overtime)`] = { median: med(waveAt[r]), min: Math.min(...waveAt[r]), max: Math.max(...waveAt[r]) };
    table['r20 overtime waves'] = { median: med(otAt20), min: Math.min(...otAt20), max: Math.max(...otAt20) };
    console.log(`Progression (${PROG_SEEDS} seeds x ${PROG_RUNS} runs; ${PROG_RUNS + 1} = never)`);
    console.table(table);
  });
});
