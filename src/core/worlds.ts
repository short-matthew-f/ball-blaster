// Worlds (authored) x stages (generated) x loops (DESIGN-v0.3.md "Worlds x stages x loops", "Scaling").
// A world owns physics, roster, base waves, hazard and boss archetype; makeStage(id) derives every stage from it:
// global index n -> scaling, slot -> modifiers and boss traits, loop -> two modifiers + all traits + Overtime 1x.
//
// Import cycle note: tuning.ts imports makeStage from here and this file imports constants from tuning.ts. Nothing at
// the top level of this file may read a tuning binding (only functions do, at call time).
import { Rng } from './rng';
import { TABLE, type BossTrait, type Formation, type Hazard, type HazardKind, type Modifier, type StageDef, type StageId, type TargetKind, type WaveDef } from './types';
import {
  BASE_CASH_SCALE,
  CASH_GROWTH,
  EARLY_BOSS_WAVES,
  EMERALD_BASE,
  HARDY_MOD_COUNT,
  HARDY_MOD_HP,
  HP_GROWTH,
  OVERTIME_CASH_MULT,
  SLOT_ATK_MULT,
  SLOT_HP_MULT,
  RANGED_EXTRA,
  RANGED_SHOOT,
  RANGED_SHOOT_SLOT,
  ATK_GROWTH,
  SWIFT_MOD,
  THIN_RAILS_BOUNCE,
} from './tuning';

export type { HazardKind };

export interface BossArchetype {
  name: string;
  /** HP at n = 0 (scaled by HP_GROWTH^n). */
  hp: number;
  r: number;
  /** Traits this boss always has, whatever the slot (Rime Golem: cadre). */
  signature: BossTrait[];
  /** Cadre size when the boss has the cadre trait. */
  cadre: number;
}

export interface WorldDef {
  index: number; // 1-based
  id: string;
  name: string;
  /** Palette char (render/palette.ts) for the felt. */
  tint: string;
  physics: { friction: number; rollDecel: number; wallBounce: number };
  /** Authored world difficulty: regular enemy HP x this on top of HP_GROWTH^n (Ice slides: more hits per shot). */
  hpMult: number;
  /** Authored world difficulty: enemy attack x this on top of ATK_GROWTH^n. */
  atkMult: number;
  hazard: HazardKind | null;
  /** Regular kinds this world draws from (big rack, full roster weight). */
  roster: TargetKind[];
  boss: BossArchetype;
  /** Base regular waves (3) and boss wave (boss + escorts). */
  waves: WaveDef[];
  bossWave: WaveDef;
}

// Formation weights by wave (step 3): racks break for 3-4 hits; Scatter appears only in Overtime.
const W1_FORM: Partial<Record<Formation, number>> = { rack: 1 };
const W2_FORM: Partial<Record<Formation, number>> = { rack: 60, wall: 40 };
const W3_FORM: Partial<Record<Formation, number>> = { rack: 30, wall: 30, pincer: 25, ring: 15 };
const BOSS_FORM: Partial<Record<Formation, number>> = { pincer: 50, ring: 50 };

const FELT_WAVES: WaveDef[] = [
  { slots: ['grunt', 'grunt', 'skirmisher'], formations: ['rack'], formationWeights: W1_FORM },
  { slots: ['grunt', 'grunt', 'skirmisher', ['bouncer', 'thornback'], 'brute'], formations: ['rack', 'wall'], formationWeights: W2_FORM },
  { slots: ['grunt', 'skirmisher', 'bomber', ['broodmother', 'hive'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring'], formationWeights: W3_FORM, elite: 4 },
];
const FELT_BOSS_WAVE: WaveDef = { slots: ['boss', 'grunt', 'cleric'], formations: ['pincer', 'ring'], formationWeights: BOSS_FORM };

const ICE_WAVES: WaveDef[] = [
  { slots: ['grunt', 'grunt', 'frost', 'skirmisher'], formations: ['rack'], formationWeights: W1_FORM },
  { slots: ['grunt', 'frost', 'skirmisher', ['bouncer', 'thornback'], 'brute'], formations: ['rack', 'wall'], formationWeights: W2_FORM },
  { slots: ['grunt', 'frost', 'bomber', ['broodmother', 'thornback'], 'brute'], formations: ['rack', 'wall', 'pincer', 'ring'], formationWeights: W3_FORM, elite: 4 },
];
const ICE_BOSS_WAVE: WaveDef = { slots: ['boss', 'frost', 'grunt'], formations: ['pincer', 'ring'], formationWeights: BOSS_FORM };

const FELT_ROSTER: TargetKind[] = ['grunt', 'skirmisher', 'bouncer', 'bomber', 'broodmother', 'thornback', 'brute', 'cleric', 'hive'];
const FELT_PHYS = { friction: 0.6, rollDecel: 70, wallBounce: 0.75 };

/** Worlds 3-6 are stubs for now: Felt roster/waves, their own physics, names, tints and boss names. */
export const WORLDS: WorldDef[] = [
  {
    index: 1, id: 'felt', name: 'Felt Hall', tint: 'G', physics: FELT_PHYS, hpMult: 1, atkMult: 1, hazard: null, roster: FELT_ROSTER,
    boss: { name: 'Big Stripe', hp: 60, r: 23, signature: [], cadre: 2 }, waves: FELT_WAVES, bossWave: FELT_BOSS_WAVE,
  },
  {
    index: 2, id: 'ice', name: 'Ice Cavern', tint: 'b', physics: { friction: 0.4, rollDecel: 45, wallBounce: 0.92 }, hpMult: 1.9, atkMult: 2, hazard: 'ice',
    roster: [...FELT_ROSTER, 'frost'],
    boss: { name: 'Rime Golem', hp: 40, r: 23, signature: ['cadre'], cadre: 3 }, waves: ICE_WAVES, bossWave: ICE_BOSS_WAVE,
  },
  {
    index: 3, id: 'clock', name: 'Clockwork Works', tint: 'y', physics: { friction: 0.6, rollDecel: 70, wallBounce: 0.8 }, hpMult: 2.2, atkMult: 1.4, hazard: 'conveyor',
    roster: FELT_ROSTER,
    boss: { name: 'The Mainspring', hp: 60, r: 23, signature: ['moves'], cadre: 2 }, waves: FELT_WAVES, bossWave: FELT_BOSS_WAVE,
  },
  {
    index: 4, id: 'bog', name: 'Bog', tint: 'w', physics: { friction: 0.9, rollDecel: 110, wallBounce: 0.6 }, hpMult: 2.2, atkMult: 1.4, hazard: 'mud',
    roster: FELT_ROSTER,
    boss: { name: 'Mire Queen', hp: 60, r: 23, signature: [], cadre: 2 }, waves: FELT_WAVES, bossWave: FELT_BOSS_WAVE,
  },
  {
    index: 5, id: 'ember', name: 'Ember Pit', tint: 'r', physics: { friction: 0.5, rollDecel: 60, wallBounce: 0.8 }, hpMult: 2.2, atkMult: 1.4, hazard: 'lava',
    roster: FELT_ROSTER,
    boss: { name: 'The Kiln', hp: 60, r: 23, signature: [], cadre: 2 }, waves: FELT_WAVES, bossWave: FELT_BOSS_WAVE,
  },
  {
    index: 6, id: 'casino', name: 'Neon Casino', tint: 'm', physics: { friction: 0.6, rollDecel: 70, wallBounce: 0.95 }, hpMult: 2.2, atkMult: 1.4, hazard: 'slot',
    roster: FELT_ROSTER,
    boss: { name: 'The House', hp: 60, r: 23, signature: ['cadre', 'moves'], cadre: 3 }, waves: FELT_WAVES, bossWave: FELT_BOSS_WAVE,
  },
];

export const SLOTS_PER_WORLD = 4;
const STAGES_PER_LOOP = WORLDS.length * SLOTS_PER_WORLD; // 24

/** The modifier pool (12), in doc order. */
export const MODIFIERS: Modifier[] = ['ranged', 'bombers', 'elite', 'thinRails', 'bigRack', 'earlyBoss', 'wardens', 'swift', 'hardy', 'dark', 'hiveWorld', 'frostWorld'];

export const MODIFIER_NAMES: Record<Modifier, string> = {
  ranged: 'RANGED', bombers: 'BOMBERS', elite: 'EXTRA ELITE', thinRails: 'THIN RAILS', bigRack: 'BIG RACK', earlyBoss: 'EARLY BOSS',
  wardens: 'WARDENS', swift: 'SWIFT', hardy: 'HARDY', dark: 'DARK', hiveWorld: 'HIVES', frostWorld: 'FROST',
};

const ALL_TRAITS: BossTrait[] = ['phases', 'cadre', 'moves'];
const SLOT_TRAITS: BossTrait[][] = [['phases'], ['phases', 'cadre'], ['phases', 'moves'], ALL_TRAITS];

// ---------- Ids ----------

export function stageId(world: number, slot: number, loop = 0): StageId {
  return `${loop > 0 ? `l${loop}` : ''}w${world}s${slot}`;
}

/** Tolerant: anything unparseable (including v0.2 'felt'/'ice') maps to w1s1 / w2s1. */
export function parseStageId(id: StageId): { world: number; slot: number; loop: number } {
  const m = /^(?:l(\d+))?w(\d+)s(\d+)$/.exec(id ?? '');
  if (!m) return { world: id === 'ice' ? 2 : 1, slot: 1, loop: 0 };
  const loop = m[1] ? Math.max(0, parseInt(m[1], 10)) : 0;
  const world = Math.min(WORLDS.length, Math.max(1, parseInt(m[2], 10)));
  const slot = Math.min(SLOTS_PER_WORLD, Math.max(1, parseInt(m[3], 10)));
  return { world, slot, loop };
}

export function globalIndex(id: StageId): number {
  const { world, slot, loop } = parseStageId(id);
  return loop * STAGES_PER_LOOP + (world - 1) * SLOTS_PER_WORLD + (slot - 1);
}

export function idFromIndex(n: number): StageId {
  const i = Math.max(0, Math.floor(n));
  const loop = Math.floor(i / STAGES_PER_LOOP);
  const r = i % STAGES_PER_LOOP;
  return stageId(Math.floor(r / SLOTS_PER_WORLD) + 1, (r % SLOTS_PER_WORLD) + 1, loop);
}

export function nextStageId(id: StageId): StageId {
  return idFromIndex(globalIndex(id) + 1);
}

export function allStageIds(loop: number): StageId[] {
  const out: StageId[] = [];
  for (let w = 1; w <= WORLDS.length; w++) for (let k = 1; k <= SLOTS_PER_WORLD; k++) out.push(stageId(w, k, loop));
  return out;
}

// ---------- Modifiers ----------

/** Modifiers for every slot of a world in a loop: a deterministic shuffle of the pool, never repeating in the world. */
function worldModifiers(world: number, loop: number): Modifier[][] {
  const pool = MODIFIERS.filter((m) => !(m === 'frostWorld' && world === 2)); // Ice already has frost everywhere
  const rng = new Rng(0x5eed + 977 * (loop * STAGES_PER_LOOP + (world - 1) * SLOTS_PER_WORLD));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const counts = loop > 0 ? [2, 2, 2, 2] : [0, 1, 1, 2];
  let k = 0;
  return counts.map((c) => pool.slice(k, (k += c)));
}

const cloneWave = (w: WaveDef): WaveDef => ({ ...w, slots: w.slots.map((x) => (Array.isArray(x) ? [...x] : x)) });

/** Replace the first plain grunt slot with `kind` (or append when there is none). */
function swapGrunt(w: WaveDef, kind: TargetKind | TargetKind[]): void {
  const i = w.slots.findIndex((x) => x === 'grunt');
  if (i >= 0) w.slots[i] = kind;
  else w.slots.push(kind);
}

function hasKind(w: WaveDef, kind: TargetKind): boolean {
  return w.slots.some((x) => x === kind);
}

function eliteCount(w: WaveDef): number {
  return w.elites ?? ((w.elite ?? -1) >= 0 ? 1 : 0);
}

function applyModifier(m: Modifier, waves: WaveDef[], world: WorldDef): void {
  for (const w of waves) {
    switch (m) {
      case 'ranged':
        // Grunts become shooters, plus RANGED_EXTRA skirmishers and Shoot +RANGED_SHOOT (swapping alone softened the wave).
        w.slots = w.slots.map((x) => (x === 'grunt' ? (['skirmisher', 'skirmisher', 'cleric'] as TargetKind[]) : x));
        for (let i = 0; i < RANGED_EXTRA; i++) w.slots.push('skirmisher');
        break;
      case 'bombers':
        w.slots.push('bomber');
        break;
      case 'elite':
        w.elites = eliteCount(w) + 1;
        break;
      case 'bigRack':
        w.slots.push(world.roster.filter((k) => k !== 'brute' && k !== 'hive'));
        break;
      case 'wardens':
        swapGrunt(w, ['cleric', 'thornback']);
        break;
      case 'hardy': {
        let drop = Math.round(HARDY_MOD_COUNT * w.slots.length);
        while (drop-- > 0 && w.slots.length > 2) {
          const i = w.slots.lastIndexOf('grunt');
          const j = i >= 0 ? i : w.slots.findIndex((x) => x === 'skirmisher');
          if (j < 0) break;
          w.slots.splice(j, 1);
        }
        break;
      }
      case 'hiveWorld':
        if (!hasKind(w, 'hive')) swapGrunt(w, 'hive');
        break;
      case 'frostWorld':
        if (!hasKind(w, 'frost')) swapGrunt(w, 'frost');
        break;
      default:
        break; // thinRails, earlyBoss, swift, dark: stage-level (below)
    }
  }
}

// ---------- Hazards ----------

const ICE_PATCHES = 3;

function makeHazards(world: WorldDef, n: number): Hazard[] {
  if (world.hazard !== 'ice') return []; // conveyor / mud / lava / slot: data shape only, no generator or behaviour yet
  const rng = new Rng(0x1ce + 7919 * (n + 1));
  const out: Hazard[] = [];
  for (let tries = 0; out.length < ICE_PATCHES && tries < 200; tries++) {
    const r = rng.range(18, 26);
    const x = rng.range(TABLE.x + r + 4, TABLE.x + TABLE.w - r - 4);
    const y = rng.range(TABLE.y + r + 20, TABLE.y + TABLE.h - r - 70);
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 10)) continue;
    out.push({ kind: 'ice', x, y, r });
  }
  return out;
}

// ---------- Stage generator ----------

const cache = new Map<StageId, StageDef>();

export function makeStage(id: StageId): StageDef {
  const { world: wi, slot, loop } = parseStageId(id);
  const canon = stageId(wi, slot, loop);
  const hit = cache.get(canon);
  if (hit) {
    if (canon !== id) cache.set(id, hit);
    return hit;
  }
  const world = WORLDS[wi - 1];
  const n = globalIndex(canon);
  const modifiers = worldModifiers(wi, loop)[slot - 1];
  const traits = loop > 0 ? ALL_TRAITS : SLOT_TRAITS[slot - 1];
  const bossTraits = ALL_TRAITS.filter((t) => traits.includes(t) || world.boss.signature.includes(t));

  let waves = world.waves.map(cloneWave);
  if (slot >= 3 || loop > 0) waves[1].elites = Math.max(1, eliteCount(waves[1])); // elites from wave 2
  if (slot === 4 || loop > 0) {
    // The world's full roster weight: every either/or slot draws from the whole roster.
    const full = world.roster.filter((k) => k !== 'brute');
    for (const w of waves) w.slots = w.slots.map((x) => (Array.isArray(x) ? [...full] : x));
  }
  for (const m of modifiers) applyModifier(m, waves, world);
  if (modifiers.includes('earlyBoss')) waves = waves.slice(0, EARLY_BOSS_WAVES);

  const hpGrowth = Math.pow(HP_GROWTH, n);
  const cashGrowth = Math.pow(CASH_GROWTH, n);
  const st: StageDef = {
    id: canon,
    index: n,
    world: wi,
    slot,
    loop,
    name: `${world.name} ${slot}${loop > 0 ? ` +${loop}` : ''}`,
    modifiers,
    bossTraits,
    hazards: makeHazards(world, n),
    friction: world.physics.friction,
    rollDecel: world.physics.rollDecel,
    wallBounce: modifiers.includes('thinRails') ? THIN_RAILS_BOUNCE : world.physics.wallBounce,
    waves,
    bossWave: cloneWave(world.bossWave),
    hpScale: world.hpMult * SLOT_HP_MULT[slot - 1] * hpGrowth * (modifiers.includes('hardy') ? HARDY_MOD_HP : 1),
    atkScale: world.atkMult * SLOT_ATK_MULT[slot - 1] * Math.pow(ATK_GROWTH, n),
    advanceMult: modifiers.includes('swift') ? SWIFT_MOD : 1,
    shootBonus: modifiers.includes('ranged') && (slot >= RANGED_SHOOT_SLOT || loop > 0) ? RANGED_SHOOT : 0,
    overtimeCash: loop > 0 ? 1 : OVERTIME_CASH_MULT,
    cashScale: BASE_CASH_SCALE * cashGrowth,
    waveCashScale: cashGrowth,
    emeraldReward: EMERALD_BASE + n,
    boss: {
      name: world.boss.name,
      hp: Math.round(world.boss.hp * SLOT_HP_MULT[slot - 1] * hpGrowth),
      r: world.boss.r,
      phases: bossTraits.includes('phases') ? [0.5] : [],
      cadre: bossTraits.includes('cadre') ? world.boss.cadre : 0,
    },
  };
  cache.set(canon, st);
  if (canon !== id) cache.set(id, st);
  return st;
}
