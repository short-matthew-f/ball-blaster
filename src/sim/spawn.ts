// Enemy construction, wave composition, formations (Rack, Wall, Pincer, Ring, Scatter) and free-spot search.
import { TABLE, type EliteMod, type Formation, type FxEvent, type Obstacle, type ObstacleKind, type RunState, type Target, type TargetKind, type WaveDef } from '../core/types';
import {
  AREA_CAP,
  FORMATION_JITTER,
  HARDY_HP_MULT,
  OVERTIME_HP_PER_WAVE,
  OVERTIME_SCATTER_WEIGHT,
  WAVE_HP_STEP,
  REGULAR_CAP,
  SPAWN_ZONE,
  TARGET_DEFS,
  WAVES_PER_STAGE,
  COG_WAVE_CAP,
  stageById,
} from '../core/tuning';
import { rollIntent } from './intents';
import { heal, updateBossShield } from './damage';

/** Formations live above the spawn-only zone. Front rank centre line: */
const FRONT_Y = TABLE.y + 108; // y 142: ~120 px from the hero start (step 2)
const REGION = { x0: TABLE.x + 2, x1: TABLE.x + TABLE.w - 2, y0: TABLE.y + 2, y1: TABLE.y + TABLE.h - SPAWN_ZONE };
const GAP = 2;
const HERO_CLEARANCE = 8;
const RACK_PITCH = 27;
const WALL_GAP = 30;

export const OBSTACLE_R: Record<ObstacleKind, number> = { bumper: 6, crate: 5, chest: 6, shrine: 6, gear: 14 };
const OBSTACLE_HP: Record<ObstacleKind, number> = { bumper: Infinity, crate: 1, chest: 2, shrine: 1, gear: Infinity };

/** Summons (grubs) never count for wave clear or the area cap. */
export function isRegular(t: Target): boolean {
  return !t.summon;
}

export function liveRegulars(s: RunState): number {
  let n = 0;
  for (const t of s.targets) if (!t.dead && isRegular(t)) n++;
  return n;
}

export function bossAlive(s: RunState): boolean {
  return s.targets.some((t) => t.kind === 'boss' && !t.dead);
}

export function makeEnemy(s: RunState, kind: TargetKind, x: number, y: number, atkBonus = 0): Target {
  const def = TARGET_DEFS[kind];
  const st = stageById(s.stage);
  // The boss uses the stage's boss HP (archetype HP x HP_GROWTH^n), not hpScale (Hardy and the v0.2 per-world
  // multiplier never applied to it: Rime Golem 60 HP behind 3 cadre was a slog).
  const hp = kind === 'boss' ? st.boss.hp : Math.ceil(def.hp * st.hpScale);
  const t: Target = {
    id: s.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r: kind === 'boss' ? st.boss.r : def.r,
    mass: def.mass,
    hp,
    maxHp: hp,
    resting: true,
    intent: { t: 'rest' },
    stagger: 0,
    shimmer: 0,
    flash: 0,
    phase: 0,
    shielded: false,
    dead: false,
  };
  if (atkBonus > 0) t.atkBonus = atkBonus;
  rollIntent(s, t);
  return t;
}

interface Slot {
  kind: TargetKind;
  r: number;
  x: number;
  y: number;
}

/** Can a circle sit at (x,y) without touching live bodies / obstacles / `extra` (and away from the balls)? */
export function spotFree(s: RunState, x: number, y: number, r: number, extra: { x: number; y: number; r: number }[] = [], ignoreBalls = false): boolean {
  if (x - r < TABLE.x || x + r > TABLE.x + TABLE.w || y - r < TABLE.y || y + r > TABLE.y + TABLE.h) return false;
  if (!ignoreBalls) for (const b of s.balls) if (Math.hypot(b.x - x, b.y - y) < r + b.r + HERO_CLEARANCE) return false;
  for (const t of s.targets) if (!t.dead && Math.hypot(t.x - x, t.y - y) < r + t.r + GAP) return false;
  for (const o of s.obstacles) if (!o.dead && Math.hypot(o.x - x, o.y - y) < r + o.r + GAP) return false;
  for (const o of extra) if (Math.hypot(o.x - x, o.y - y) < r + o.r + GAP) return false;
  return true;
}

/**
 * Deterministic spiral search for the nearest free spot to (x,y). Prefers the formation region (above the spawn
 * zone); falls back to anywhere on the table. Null if the table is full.
 */
export function findFreeNear(s: RunState, x: number, y: number, r: number, extra: { x: number; y: number; r: number }[] = [], regionOnly = false): { x: number; y: number } | null {
  for (const inRegion of regionOnly ? [true] : [true, false]) {
    for (let rho = 0; rho <= 260; rho += 3) {
      const n = rho === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * rho) / 4));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * rho;
        const py = y + Math.sin(a) * rho;
        if (inRegion && (px - r < REGION.x0 || px + r > REGION.x1 || py - r < REGION.y0 || py + r > REGION.y1)) continue;
        if (spotFree(s, px, py, r, extra)) return { x: px, y: py };
      }
    }
  }
  return null;
}

/** Nominal positions per formation. Slots arrive sorted small-first (front) to big-last (back). */
function layout(s: RunState, f: Formation, slots: Slot[]): void {
  const cx = TABLE.x + TABLE.w / 2;
  const n = slots.length;
  switch (f) {
    case 'rack': {
      // Triangle pointing at the hero: apex (front) at FRONT_Y, rows of 1, 2, 3... going up.
      let idx = 0;
      let row = 0;
      let y = FRONT_Y;
      let prevMax = 0;
      while (idx < n) {
        const cnt = Math.min(row + 1, n - idx);
        const members = slots.slice(idx, idx + cnt);
        const maxR = Math.max(...members.map((m) => m.r));
        const pitch = Math.max(RACK_PITCH, 2 * maxR + 3);
        if (row > 0) y -= Math.max(RACK_PITCH * 0.866, (prevMax + maxR + 3) * 0.866);
        members.forEach((m, j) => {
          m.x = cx + (j - (cnt - 1) / 2) * pitch;
          m.y = y;
        });
        prevMax = maxR;
        idx += cnt;
        row++;
      }
      return;
    }
    case 'wall': {
      // One line across with one interior gap; big bodies (r >= 17) anchor a back row.
      const back = slots.filter((m) => m.r >= 17);
      const front = slots.filter((m) => m.r < 17);
      const g = front.length >= 2 ? s.rng.int(1, front.length - 1) : -1;
      const used = front.reduce((a, m) => a + 2 * m.r, 0) + (g > 0 ? WALL_GAP : 0);
      const sp = Math.max(GAP, (TABLE.w - 4 - used) / (front.length + 1));
      let x = TABLE.x + 2 + sp;
      front.forEach((m, i) => {
        if (i === g) x += WALL_GAP;
        m.x = x + m.r;
        m.y = FRONT_Y - 8;
        x += 2 * m.r + sp;
      });
      back.forEach((m, j) => {
        m.x = cx + (j - (back.length - 1) / 2) * 56;
        m.y = FRONT_Y - 8 - 44;
      });
      return;
    }
    case 'pincer': {
      // Two clusters on the flanks, centre open.
      slots.forEach((m, i) => {
        const left = i % 2 === 0;
        const k = Math.floor(i / 2);
        m.x = left ? TABLE.x + 30 + (k % 2) * 14 : TABLE.x + TABLE.w - 30 - (k % 2) * 14;
        m.y = FRONT_Y - 4 - k * 28;
      });
      return;
    }
    case 'ring': {
      const circ = slots.reduce((a, m) => a + 2 * m.r + 8, 0);
      const R = Math.max(38, circ / (2 * Math.PI));
      const cy = FRONT_Y - 36;
      const a0 = s.rng.range(0, Math.PI * 2);
      slots.forEach((m, i) => {
        const a = a0 + (i / n) * Math.PI * 2;
        m.x = cx + Math.cos(a) * R;
        m.y = cy + Math.sin(a) * R * 0.8;
      });
      return;
    }
    case 'scatter': {
      for (const m of slots) {
        m.x = s.rng.range(REGION.x0 + m.r, REGION.x1 - m.r);
        m.y = s.rng.range(REGION.y0 + m.r, REGION.y1 - m.r);
      }
      return;
    }
  }
}

/** Push formation members apart (GAP) and into the region. */
function separate(slots: Slot[]): void {
  for (let it = 0; it < 60; it++) {
    let worst = 0;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const A = slots[i];
        const B = slots[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const min = A.r + B.r + GAP;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-9 ? dx / d : 1;
        const ny = d > 1e-9 ? dy / d : 0;
        const ov = (min - d) / 2;
        worst = Math.max(worst, ov);
        A.x -= nx * ov;
        A.y -= ny * ov;
        B.x += nx * ov;
        B.y += ny * ov;
      }
    }
    for (const m of slots) {
      m.x = Math.max(REGION.x0 + m.r, Math.min(REGION.x1 - m.r, m.x));
      m.y = Math.max(REGION.y0 + m.r, Math.min(REGION.y1 - m.r, m.y));
    }
    if (worst < 0.01) break;
  }
}

/** Place `kinds` in `formation`, jittered, overlap-free and clear of everything already on the table. */
export function placeFormation(s: RunState, kinds: TargetKind[], formation: Formation): Slot[] {
  const slots: Slot[] = kinds.map((kind) => ({ kind, r: kind === 'boss' ? stageById(s.stage).boss.r : TARGET_DEFS[kind].r, x: 0, y: 0 }));
  slots.sort((a, b) => a.r - b.r);
  layout(s, formation, slots);
  for (const m of slots) {
    m.x += s.rng.range(-FORMATION_JITTER, FORMATION_JITTER);
    m.y += s.rng.range(-FORMATION_JITTER, FORMATION_JITTER);
  }
  separate(slots);
  // Final legality against the live table (hero, survivors, obstacles) and the slots already accepted.
  const placed: Slot[] = [];
  for (const m of slots) {
    let ok = m.x - m.r >= REGION.x0 && m.x + m.r <= REGION.x1 && m.y - m.r >= REGION.y0 && m.y + m.r <= REGION.y1;
    // The boss owns its spot: the hero is moved out of the way instead (nudgeHeroClear).
    if (ok) ok = spotFree(s, m.x, m.y, m.r, placed, m.kind === 'boss');
    if (!ok) {
      const p = findFreeNear(s, m.x, m.y, m.r, placed);
      if (!p) continue; // table full: drop it
      m.x = p.x;
      m.y = p.y;
    }
    placed.push(m);
  }
  return placed;
}

function waveFor(s: RunState): { def: WaveDef; bonus: number } {
  const st = stageById(s.stage);
  const nw = st.waves.length;
  const w = s.wave;
  if (w <= nw) return { def: st.waves[w - 1], bonus: 0 };
  if (w === nw + 1) return { def: st.bossWave, bonus: 0 };
  const k = w - (nw + 1); // Overtime wave k: +k HP, +k attack
  return { def: st.waves[(k - 1) % nw], bonus: k };
}

function pickFormation(s: RunState, def: WaveDef, overtime: boolean): Formation {
  const w: Partial<Record<Formation, number>> = { ...(def.formationWeights ?? Object.fromEntries(def.formations.map((f) => [f, 1]))) };
  if (overtime) w.scatter = (w.scatter ?? 0) + OVERTIME_SCATTER_WEIGHT;
  const items = (Object.keys(w) as Formation[]).filter((f) => (w[f] ?? 0) > 0).map((f) => ({ f, weight: w[f] ?? 0 }));
  return s.rng.pick(items).f;
}

const area = (k: TargetKind, s: RunState) => Math.PI * (k === 'boss' ? stageById(s.stage).boss.r : TARGET_DEFS[k].r) ** 2;

/** Spawn wave `s.wave`. Returns the new enemies (they act from the next enemy phase). */
export function spawnWave(s: RunState, fx: FxEvent[]): Target[] {
  const { def, bonus } = waveFor(s);
  const kinds: TargetKind[] = [];
  def.slots.forEach((slot) => {
    kinds.push(Array.isArray(slot) ? slot[s.rng.int(0, slot.length - 1)] : slot);
  });
  // Clockwork: at most COG_WAVE_CAP cogs per wave (extras become grunts, before the caps below).
  for (let i = 0, cogs = 0; i < kinds.length; i++) if (kinds[i] === 'cog' && ++cogs > COG_WAVE_CAP) kinds[i] = 'grunt';
  // Area cap (regulars <= AREA_CAP of the table) and hard cap: drop grunts first.
  const cap = AREA_CAP * TABLE.w * TABLE.h;
  const total = () => kinds.reduce((a, k) => a + area(k, s), 0);
  while ((total() > cap || kinds.length > REGULAR_CAP) && kinds.includes('grunt')) kinds.splice(kinds.lastIndexOf('grunt'), 1);
  while (kinds.length > REGULAR_CAP) kinds.pop();
  // Elite waves: the elite is a random regular of the wave (not always the def.elite slot, which made a Hardy brute
  // the W3 elite every run).
  const eligible = kinds.filter((k) => k !== 'boss');
  // (Extra Elite: one more random regular per elite.)
  const nElite = def.elites ?? ((def.elite ?? -1) >= 0 ? 1 : 0);
  const eliteKinds: TargetKind[] = [];
  for (let i = 0; i < nElite && eligible.length > 0; i++) eliteKinds.push(eligible.splice(s.rng.int(0, eligible.length - 1), 1)[0]);

  const formation = pickFormation(s, def, bonus > 0);
  const slots = placeFormation(s, kinds, formation);
  const out: Target[] = [];
  for (const m of slots) {
    const e = makeEnemy(s, m.kind, m.x, m.y, bonus);
    // HP scaling: +WAVE_HP_STEP per stage wave (not the boss), + OVERTIME_HP_PER_WAVE x k in Overtime wave k.
    const waveIdx = Math.min(s.wave, stageById(s.stage).waves.length, WAVES_PER_STAGE) - 1;
    const hp = e.kind === 'boss' ? e.hp : Math.round(e.hp * (1 + WAVE_HP_STEP * waveIdx)) + OVERTIME_HP_PER_WAVE * bonus;
    e.hp = e.maxHp = hp;
    const ei = eliteKinds.indexOf(m.kind);
    if (ei >= 0) {
      eliteKinds.splice(ei, 1);
      const mods: EliteMod[] = ['spiky', 'hardy', 'swift'];
      e.elite = mods[s.rng.int(0, mods.length - 1)];
      if (e.elite === 'hardy') e.hp = e.maxHp = Math.ceil(e.maxHp * HARDY_HP_MULT);
    }
    e.shimmer = 0.5;
    s.targets.push(e);
    out.push(e);
    fx.push({ t: 'shimmer', x: e.x, y: e.y });
    if (e.kind === 'boss') {
      s.bossSpawned = true;
      fx.push({ t: 'bossArrive' });
      out.push(...spawnCadre(s, e, fx));
      const h = s.balls.find((b) => b.kind === 'main');
      if (s.stats.bossHeal > 0 && h) heal(s, s.stats.bossHeal * s.maxHp, h.x, h.y, fx);
    }
  }
  s.waveKillShot = -1;
  nudgeHeroClear(s, fx);
  s.waveTurn = 0;
  fx.push({ t: 'waveStart', wave: s.wave, overtime: bonus > 0 });
  return out;
}

/** Cadre trait (Rime Golem always): shield minions in a ring round the boss; the boss is shielded while any lives. */
function spawnCadre(s: RunState, boss: Target, fx: FxEvent[]): Target[] {
  const n = stageById(s.stage).boss.cadre;
  const out: Target[] = [];
  const r = TARGET_DEFS.cadre.r;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    const d = boss.r + r + 4;
    const p = findFreeNear(s, boss.x + Math.cos(a) * d, boss.y + Math.sin(a) * d, r);
    if (!p) continue;
    const c = makeEnemy(s, 'cadre', p.x, p.y, boss.atkBonus ?? 0);
    c.shimmer = 0.5;
    s.targets.push(c);
    out.push(c);
    fx.push({ t: 'shimmer', x: p.x, y: p.y });
  }
  updateBossShield(s);
  return out;
}

/** If the hero overlaps a just-spawned enemy (the boss takes its spot regardless), move the hero to the nearest free spot. */
export function nudgeHeroClear(s: RunState, fx: FxEvent[]): void {
  const h = s.balls.find((b) => b.kind === 'main');
  if (!h) return;
  const clear = (x: number, y: number) => {
    if (x - h.r < TABLE.x || x + h.r > TABLE.x + TABLE.w || y - h.r < TABLE.y || y + h.r > TABLE.y + TABLE.h) return false;
    for (const t of s.targets) if (!t.dead && Math.hypot(t.x - x, t.y - y) < t.r + h.r + GAP) return false;
    for (const o of s.obstacles) if (!o.dead && Math.hypot(o.x - x, o.y - y) < o.r + h.r + GAP) return false;
    return true;
  };
  if (s.targets.every((t) => t.dead || Math.hypot(t.x - h.x, t.y - h.y) >= t.r + h.r)) return;
  for (let rho = 2; rho <= 320; rho += 2) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * rho) / 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = h.x + Math.cos(a) * rho;
      const y = h.y + Math.sin(a) * rho;
      if (!clear(x, y)) continue;
      fx.push({ t: 'jam', x0: h.x, y0: h.y, x, y });
      h.x = x;
      h.y = y;
      h.vx = 0;
      h.vy = 0;
      return;
    }
  }
}

/** A summon next to `near` (grubs). Null if there is no room. */
export function summonNear(s: RunState, near: Target, kind: TargetKind, fx: FxEvent[]): Target | null {
  const r = TARGET_DEFS[kind].r;
  // Prefer the side facing the hero.
  const h = s.balls.find((b) => b.kind === 'main');
  const a = h ? Math.atan2(h.y - near.y, h.x - near.x) : Math.PI / 2;
  const d = near.r + r + GAP + 1;
  const p = findFreeNear(s, near.x + Math.cos(a) * d, near.y + Math.sin(a) * d, r);
  if (!p) return null;
  const g = makeEnemy(s, kind, p.x, p.y, near.atkBonus ?? 0);
  g.summon = true;
  g.shimmer = 0.5;
  s.targets.push(g);
  fx.push({ t: 'shimmer', x: p.x, y: p.y });
  return g;
}

export function spawnObstacle(s: RunState, kind: ObstacleKind): Obstacle | null {
  const r = OBSTACLE_R[kind];
  for (let i = 0; i < 80; i++) {
    const x = s.rng.range(REGION.x0 + r, REGION.x1 - r);
    const y = s.rng.range(REGION.y0 + r, REGION.y1 - r);
    if (!spotFree(s, x, y, r)) continue;
    const o: Obstacle = { id: s.nextId++, kind, x, y, r, hp: OBSTACLE_HP[kind], flash: 0, dead: false };
    s.obstacles.push(o);
    return o;
  }
  return null;
}
