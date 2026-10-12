// v0.2 build step 1: physics + sizes + formations + enemy charges, bot-measured.
// Two bots (nearest enemy / largest cluster, always full power) x two stat lines (run 1 base, mid-game) x 30 seeds.
import { describe, expect, it } from 'vitest';
import { MAX_PULL, SIM_DT, TABLE, type RunResult, type RunState, type RunStats, type SaveData, type Target } from '../src/core/types';
import { bankRun, buildStats, buy, buyState, newSave, nextCost, nodesFor } from '../src/meta/index';
import { BASE_STATS, stageById } from '../src/core/tuning';
import { globalIndex, idFromIndex, nextStageId, stageId } from '../src/core/worlds';
import { createRun, shoot, step } from '../src/sim/index';
import { maxOverlap } from '../src/sim/physics';
import { Rng } from '../src/core/rng';

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
  if (s.phase === 'aim' && s.targets.some((t) => !t.dead && t.shimmer > 0)) problems.push(`${where}: shimmering enemy at aim`);
  if (s.phase === 'aim' && s.targets.filter((t) => !t.dead).length === 0) problems.push(`${where}: empty board at aim`);
  const ov = maxOverlap(s);
  if (ov > 0.5) problems.push(`${where}: overlap ${ov.toFixed(2)} at rest`);
}

function playRun(seed: number, stats: RunStats, bot: Bot): RunLog {
  const s = createRun('w1s1', stats, seed);
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

// ---------- Multi-stage progression bot (DESIGN-v0.3 "Scaling": the release gate) ----------
// newSave -> buildStats -> play the current stage -> bankRun -> greedy cheapest buys -> on a boss kill advance current
// to nextStageId. Runs-to-clear = runs played on a stage up to and including its first boss kill.
// Env overrides for tuning: PROG_SEEDS, PROG_RUNS.

const PROG_SEEDS = Number(process.env.PROG_SEEDS ?? 16);
const PROG_RUNS = Number(process.env.PROG_RUNS ?? 160);
const GATE_STAGES = 12; // w1s1 .. w3s4: asserted
const SMOKE_STAGES = 16; // + w4s1 .. w4s4: reported only
const GATE: [number, number] = [4, 9];
const LAST_STAGE_MAX = 20; // stage 11: worst seed
const BUY_WINDOW = 3;
const PERFECT_MIN = 2; // perfect bot: no stage may be a 1-run clear (median) // runs after arrival within which at least one node must be affordable

type ProgBot = 'perfect' | 'noisy';

/** Noisy (human-like) aim: +-NOISE_DEG error, 70-100 % power, 15 % of shots at the second-nearest enemy. */
const NOISE_DEG = 6;
const NOISE_POWER: [number, number] = [0.7, 1];
const NOISE_SECOND = 0.15;

function playForResult(stage: string, seed: number, stats: RunStats, bot: ProgBot = 'perfect'): RunResult {
  const s = createRun(stage, stats, seed);
  const noise = new Rng(seed * 7919 + 17);
  while (s.phase === 'aim' && s.shots < 600) {
    const h = s.balls[0];
    let tg: Target;
    let ang: number;
    let power = 1;
    if (bot === 'perfect') {
      tg = pickTarget(s, 'cluster');
      ang = Math.atan2(tg.y - h.y, tg.x - h.x);
    } else {
      const live = s.targets.filter((t) => !t.dead).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y) || a.id - b.id);
      tg = live.length > 1 && noise.chance(NOISE_SECOND) ? live[1] : live[0];
      ang = Math.atan2(tg.y - h.y, tg.x - h.x) + ((noise.range(-NOISE_DEG, NOISE_DEG) * Math.PI) / 180);
      power = noise.range(NOISE_POWER[0], NOISE_POWER[1]);
    }
    shoot(s, { x: Math.cos(ang) * MAX_PULL * power, y: Math.sin(ang) * MAX_PULL * power });
    while ((s.phase as string) === 'resolve' || (s.phase as string) === 'enemy') step(s, SIM_DT * 8);
  }
  expect(s.phase, `${stage} seed ${seed} (${bot}): progression run hit the shot cap`).toBe('over');
  return s.result!;
}

/** Greedy cheapest-first shopping. Returns nodes bought and cash spent. */
function greedyBuy(save: SaveData): { bought: number; cash: number } {
  const out = { bought: 0, cash: 0 };
  for (;;) {
    const ok = nodesFor(save).filter((n) => buyState(save, n) === 'ok');
    if (!ok.length) return out;
    ok.sort((a, b) => (nextCost(save, a) ?? 0) - (nextCost(save, b) ?? 0) || a.id.localeCompare(b.id));
    const c0 = save.cash;
    buy(save, ok[0]);
    out.bought++;
    out.cash += c0 - save.cash;
  }
}

/** Nodes still worth buying (not maxed, not hidden/locked by world). */
function openNodes(save: SaveData): number {
  return nodesFor(save).filter((n) => {
    const b = buyState(save, n);
    return b === 'ok' || b === 'poor';
  }).length;
}

interface StageLog {
  runs: number;
  cleared: boolean;
  dmg: number;
  hp: number;
  open: number;
  secs: number[];
  /** Nodes bought from arrival through the first BUY_WINDOW runs on the stage. */
  earlyBuys: number;
}

interface ProgLog {
  stages: StageLog[];
  earned60: number;
  spent60: number;
}

function progression(seed: number, bot: ProgBot): ProgLog {
  const save = newSave();
  save.current = stageId(1, 1);
  save.unlocked = 0;
  const log: ProgLog = { stages: [], earned60: 0, spent60: 0 };
  let cur: StageLog | null = null;
  let arrivalBuys = 0;
  for (let r = 1; r <= PROG_RUNS; r++) {
    const n = globalIndex(save.current);
    if (!cur) {
      const st = buildStats(save);
      cur = { runs: 0, cleared: false, dmg: st.damage, hp: st.maxHp, open: openNodes(save), secs: [], earlyBuys: arrivalBuys };
      log.stages[n] = cur;
    }
    const res = playForResult(save.current, seed * 1000 + r, buildStats(save), bot);
    bankRun(save, res);
    if (r <= 60) log.earned60 += res.cash;
    cur.runs++;
    cur.secs.push(res.seconds);
    const onStage = cur;
    if (res.bossKilled) {
      cur.cleared = true;
      cur = null;
      if (n + 1 >= SMOKE_STAGES) break;
      save.current = nextStageId(save.current);
      save.unlocked = Math.max(save.unlocked, globalIndex(save.current));
    }
    const b = greedyBuy(save);
    if (r <= 60) log.spent60 += b.cash;
    if (onStage.runs <= BUY_WINDOW && !onStage.cleared) onStage.earlyBuys += b.bought;
    arrivalBuys = cur ? 0 : b.bought; // buys right after a clear count for the next stage's arrival
  }
  return log;
}

interface BotReport {
  table: Record<string, Record<string, string | number>>;
  med: number[];
  worst: number[];
  dead: number[];
  earned: number;
  spent: number;
}

function runBot(bot: ProgBot): BotReport {
  const all = Array.from({ length: PROG_SEEDS }, (_, k) => progression(7 + k, bot));
  const rep: BotReport = { table: {}, med: [], worst: [], dead: [], earned: mean(all.map((l) => l.earned60)), spent: mean(all.map((l) => l.spent60)) };
  for (let n = 0; n < SMOKE_STAGES; n++) {
    const logs = all.map((l) => l.stages[n]).filter((x): x is StageLog => !!x);
    if (!logs.length) continue;
    // A seed still on the stage when the budget ran out counts as runs + 1 (censored) once it is past the gate.
    const rtc = logs.filter((l) => l.cleared || l.runs > GATE[1]).map((l) => (l.cleared ? l.runs : l.runs + 1));
    const st = stageById(idFromIndex(n));
    rep.med[n] = rtc.length * 2 > logs.length ? pct(rtc, 0.5) : NaN;
    rep.worst[n] = rtc.length ? Math.max(...rtc) : NaN;
    // Dead zone: a seed that stayed BUY_WINDOW+ runs on the stage without being able to buy anything.
    rep.dead[n] = logs.filter((l) => l.runs > BUY_WINDOW && l.earlyBuys === 0).length;
    rep.table[`${n} ${st.id}`] = {
      mods: st.modifiers.join(',') || '-',
      reached: logs.length,
      cleared: logs.filter((l) => l.cleared).length,
      'rtc median': rep.med[n],
      'rtc min-max': rtc.length ? `${Math.min(...rtc)}-${Math.max(...rtc)}` : '-',
      'run s median': f1(pct(logs.flatMap((l) => l.secs), 0.5)),
      'dmg/hp arrive': `${f1(mean(logs.map((l) => l.dmg)))}/${f1(mean(logs.map((l) => l.hp)))}`,
      'open nodes': f1(mean(logs.map((l) => l.open))),
      'dead seeds': rep.dead[n],
    };
  }
  console.log(`Multi-stage progression, ${bot} bot (${PROG_SEEDS} seeds x up to ${PROG_RUNS} runs; rtc = runs to clear; stages 12+ smoke only)`);
  console.table(rep.table);
  console.log(`Cash by run 60 (${bot}, mean over seeds): earned ${Math.round(rep.earned)}, spent on the tree ${Math.round(rep.spent)} (${Math.round((100 * rep.spent) / Math.max(1, rep.earned))} %)`);
  return rep;
}

describe('multi-stage progression bot (greedy cheapest-node shopper)', () => {
  it('noisy bot: rtc median in [4, 9], stage 11 worst <= 20, no dead economy; perfect bot: median >= 2 (no trivial stage)', () => {
    const noisy = runBot('noisy');
    const perfect = runBot('perfect');
    const fails: string[] = [];
    for (let n = 0; n < GATE_STAGES; n++) {
      const id = idFromIndex(n);
      const m = noisy.med[n];
      if (!(m >= GATE[0] && m <= GATE[1])) fails.push(`noisy ${id}: median ${m}`);
      if (n === GATE_STAGES - 1 && !(noisy.worst[n] <= LAST_STAGE_MAX)) fails.push(`noisy ${id}: worst ${noisy.worst[n]}`);
      if ((noisy.dead[n] ?? 0) > 0) fails.push(`noisy ${id}: ${noisy.dead[n]} seeds could not buy anything in ${BUY_WINDOW} runs`);
      if (!(perfect.med[n] >= PERFECT_MIN)) fails.push(`perfect ${id}: median ${perfect.med[n]}`);
    }
    expect(fails).toEqual([]);
  }, 3_600_000);
});
