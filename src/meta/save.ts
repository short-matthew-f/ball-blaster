import type { BallType, SaveData } from '../core/types';
import { LEGACY_STAGES, v2Refund } from './legacy';

export const SAVE_KEY = 'ballblaster.save.v3';
export const SAVE_KEY_V2 = 'ballblaster.save.v2';

export function newSave(): SaveData {
  return {
    version: 1,
    cash: 0,
    emeralds: 0,
    levels: {},
    unlocked: 0,
    current: 'w1s1',
    bestWave: {},
    bossKills: {},
    ballType: 'standard',
    settings: { sound: true, shake: true, flash: !prefersReducedMotion() },
    hints: {},
    stats: { runs: 0, kills: 0, shots: 0 },
  };
}

const STAGE_RE = /^(?:l\d+)?w[1-6]s[1-4]$/;
const LEGACY_IDS = ['felt', 'ice', 'clock', 'bog'];
const BALLS: BallType[] = ['standard', 'heavy', 'light', 'sticky'];
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'number' && isFinite(x) && x >= 0) out[k] = x;
    }
  }
  return out;
}

/** Validates unknown data; fills missing fields from newSave(). Null if not an object. */
export function sanitize(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version !== 1) return null;
  // must look like a save: at least one recognizable field
  if (!['cash', 'emeralds', 'levels', 'unlocked', 'current', 'stats'].some((k) => k in r)) return null;
  if (LEGACY_IDS.includes(r.current as string)) r = migrateV2(r);
  const d = newSave();
  const settings = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  const unlocked = Math.floor(num(r.unlocked, 0));
  const current = typeof r.current === 'string' && STAGE_RE.test(r.current) ? r.current : d.current;
  return {
    version: 1,
    cash: num(r.cash, 0),
    emeralds: num(r.emeralds, 0),
    levels: numMap(r.levels),
    unlocked,
    current,
    bestWave: stageMap(r.bestWave),
    bossKills: stageMap(r.bossKills),
    ballType: BALLS.includes(r.ballType as BallType) ? (r.ballType as BallType) : 'standard',
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : true,
      shake: typeof settings.shake === 'boolean' ? settings.shake : true,
      flash: typeof settings.flash === 'boolean' ? settings.flash : !prefersReducedMotion(),
    },
    stats: { runs: num(st.runs, 0), kills: num(st.kills, 0), shots: num(st.shots, 0) },
    hints: boolMap(r.hints),
  };
}

function stageMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(numMap(v))) if (STAGE_RE.test(k)) out[k] = x;
  return out;
}

/** v2 -> v3: refund every owned node into the wallet, clear levels, re-key stages. Returns a raw (unsanitized) v3 object. */
function migrateV2(r: Record<string, unknown>): Record<string, unknown> {
  const refund = v2Refund(numMap(r.levels));
  const rekey = (m: unknown) => {
    const out: Record<string, number> = {};
    for (const [k, x] of Object.entries(numMap(m))) if (LEGACY_STAGES[k]) out[LEGACY_STAGES[k]] = x;
    return out;
  };
  return {
    ...r,
    // No refund of spent upgrades (owner: "that's too much" — the tree is a grind). Wallet carries over as-is.
    cash: num(r.cash, 0) + refund.cash * 0,
    emeralds: num(r.emeralds, 0) + refund.emeralds * 0,
    levels: {},
    ballType: 'standard',
    unlocked: Math.floor(num(r.unlocked, 0)) >= 1 ? 4 : 0,
    current: LEGACY_STAGES[r.current as string] ?? 'w1s1',
    bestWave: rekey(r.bestWave),
    bossKills: rekey(r.bossKills),
  };
}

export function loadSave(): SaveData {
  try {
    const t = localStorage.getItem(SAVE_KEY);
    if (t) return sanitize(JSON.parse(t)) ?? newSave();
    const old = localStorage.getItem(SAVE_KEY_V2);
    if (!old) return newSave();
    const j = JSON.parse(old);
    const save = sanitize(j && typeof j === 'object' && !Array.isArray(j) ? migrateV2(j) : j);
    if (!save) return newSave();
    writeSave(save);
    localStorage.removeItem(SAVE_KEY_V2);
    return save;
  } catch {
    return newSave();
  }
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable */
  }
}

export function exportSave(save: SaveData): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(save))));
}

export function importSave(text: string): SaveData | null {
  try {
    const json = decodeURIComponent(escape(atob(String(text).trim())));
    return sanitize(JSON.parse(json));
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function boolMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'boolean') out[k] = x;
  return out;
}
