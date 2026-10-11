import type { BallType, SaveData, StageId } from '../core/types';

export const SAVE_KEY = 'ballblaster.save.v1';

export function newSave(): SaveData {
  return {
    version: 1,
    cash: 0,
    emeralds: 0,
    levels: {},
    unlocked: 0,
    current: 'felt',
    bestFill: {},
    bossKills: {},
    ballType: 'standard',
    settings: { sound: true, shake: true },
    stats: { runs: 0, kills: 0, shots: 0 },
  };
}

const STAGE_IDS: StageId[] = ['felt', 'ice', 'clock', 'bog'];
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
  const r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version !== 1) return null;
  // must look like a save: at least one recognizable field
  if (!['cash', 'emeralds', 'levels', 'unlocked', 'current', 'stats'].some((k) => k in r)) return null;
  const d = newSave();
  const settings = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  const unlocked = Math.floor(num(r.unlocked, 0));
  const current = STAGE_IDS.includes(r.current as StageId) ? (r.current as StageId) : d.current;
  return {
    version: 1,
    cash: num(r.cash, 0),
    emeralds: num(r.emeralds, 0),
    levels: numMap(r.levels),
    unlocked,
    current,
    bestFill: numMap(r.bestFill) as SaveData['bestFill'],
    bossKills: numMap(r.bossKills) as SaveData['bossKills'],
    ballType: BALLS.includes(r.ballType as BallType) ? (r.ballType as BallType) : 'standard',
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : true,
      shake: typeof settings.shake === 'boolean' ? settings.shake : true,
    },
    stats: { runs: num(st.runs, 0), kills: num(st.kills, 0), shots: num(st.shots, 0) },
  };
}

export function loadSave(): SaveData {
  try {
    const t = localStorage.getItem(SAVE_KEY);
    if (!t) return newSave();
    return sanitize(JSON.parse(t)) ?? newSave();
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
