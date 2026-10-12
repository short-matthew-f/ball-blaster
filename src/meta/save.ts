import type { CardState, SaveData, TokenId } from '../core/types';
import { TOKEN_OF_WORLD } from '../core/types';
import { autoEquipLegacy, fixLoadout } from './gear';
import { LEGACY_STAGES, v2Refund, v3CardRefund } from './legacy';
import { worldOf } from './stats';
import { BALL_CARD, CUE_IDS, RELIC_IDS, STAT_RELICS, TRICK_IDS } from './upgrades';

export const SAVE_KEY_V4 = 'ballblaster.save.v4';
export const SAVE_KEY_V3 = 'ballblaster.save.v3';
export const SAVE_KEY_V2 = 'ballblaster.save.v2';
export const SAVE_KEY = SAVE_KEY_V4;

export function newSave(): SaveData {
  return {
    version: 4,
    cash: 0,
    tokens: zeroTokens(),
    levels: {},
    cards: {},
    unlocked: 0,
    current: 'w1s1',
    bestWave: {},
    bossKills: {},
    bestLoot: {},
    loadout: { ball: 'standard', cue: 'standard', relics: [], trick: null },
    settings: { sound: true, shake: true, flash: !prefersReducedMotion() },
    hints: {},
    stats: { runs: 0, kills: 0, shots: 0, teeth: 0 },
  };
}

function zeroTokens(): Record<TokenId, number> {
  return { stripe: 0, frost: 0, cog: 0, pearl: 0, ember: 0, house: 0 };
}

const STAGE_RE = /^(?:l\d+)?w[1-6]s[1-4]$/;
const LEGACY_IDS = ['felt', 'ice', 'clock', 'bog'];
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

/**
 * Validates unknown data; fills missing fields from newSave(). Null if not an object.
 * Accepts version 4, and version 1 / absent (the v3 shape, migrated). Idempotent on v4.
 */
export function sanitize(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version !== 1 && r.version !== 4) return null;
  // must look like a save: at least one recognizable field
  if (!['cash', 'emeralds', 'tokens', 'levels', 'unlocked', 'current', 'stats'].some((k) => k in r)) return null;
  if (r.version !== 4) {
    if (LEGACY_IDS.includes(r.current as string)) r = migrateV2(r);
    r = migrateV3(r);
  }
  return sanitizeV4(r);
}

function sanitizeV4(r: Record<string, unknown>): SaveData {
  const d = newSave();
  const settings = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  const unlocked = Math.floor(num(r.unlocked, 0));
  const current = typeof r.current === 'string' && STAGE_RE.test(r.current) ? r.current : d.current;
  const out: SaveData = {
    version: 4,
    cash: num(r.cash, 0),
    tokens: tokenMap(r.tokens),
    levels: numMap(r.levels),
    cards: cardMap(r.cards),
    unlocked,
    current,
    bestWave: stageMap(r.bestWave),
    bossKills: stageMap(r.bossKills),
    bestLoot: stageMap(r.bestLoot),
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : true,
      shake: typeof settings.shake === 'boolean' ? settings.shake : true,
      flash: typeof settings.flash === 'boolean' ? settings.flash : !prefersReducedMotion(),
    },
    stats: { runs: num(st.runs, 0), kills: num(st.kills, 0), shots: num(st.shots, 0), teeth: num(st.teeth, 0) },
    hints: boolMap(r.hints),
    loadout: d.loadout,
  };
  if (typeof settings.fastEnemies === 'boolean') out.settings.fastEnemies = settings.fastEnemies;
  fixLoadout(out, r.loadout);
  autoEquipLegacy(out);
  return out;
}

function tokenMap(v: unknown): Record<TokenId, number> {
  const out = zeroTokens();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const id of TOKEN_OF_WORLD) {
      const x = (v as Record<string, unknown>)[id];
      if (typeof x === 'number' && isFinite(x) && x >= 0) out[id] = Math.floor(x);
    }
  }
  return out;
}

const CARD_IDS: string[] = [...CUE_IDS, ...RELIC_IDS, ...TRICK_IDS, ...Object.values(BALL_CARD)];
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function cardMap(v: unknown): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [id, c] of Object.entries(v as Record<string, unknown>)) {
    if (!CARD_IDS.includes(id) || !c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    const forks = strList(x.forks);
    const caps = strList(x.caps);
    out[id] = {
      level: Math.min(3, Math.floor(num(x.level, 0))),
      forks,
      fork: typeof x.fork === 'string' && forks.includes(x.fork) ? x.fork : null,
      caps,
      cap: typeof x.cap === 'string' && caps.includes(x.cap) ? x.cap : null,
    };
  }
  return out;
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

const newCard = (level: number): CardState => ({ level: Math.min(3, Math.max(0, Math.floor(level))), forks: [], fork: null, caps: [], cap: null });

/**
 * v3 shape -> v4 shape (raw in, raw out; sanitizeV4 validates). Emeralds become tokens split by each world's share of bossKills
 * (remainder to stripe); gear nodes move from `levels` to `cards`; lightning/split/spitter become cards at min(3, L-1) with a cash refund.
 */
function migrateV3(r: Record<string, unknown>): Record<string, unknown> {
  const levels = numMap(r.levels);
  const kills = stageMap(r.bossKills);
  const tokens = zeroTokens();
  const em = Math.floor(num(r.emeralds, 0));
  const byWorld = [0, 0, 0, 0, 0, 0];
  for (const [id, n] of Object.entries(kills)) {
    const w = worldOf(id);
    if (w >= 1 && w <= 6) byWorld[w - 1] += n;
  }
  const total = byWorld.reduce((a, b) => a + b, 0);
  let given = 0;
  if (total > 0) {
    byWorld.forEach((n, i) => {
      const part = Math.floor((em * n) / total);
      tokens[TOKEN_OF_WORLD[i]] += part;
      given += part;
    });
  }
  tokens.stripe += em - given;

  let cash = num(r.cash, 0);
  const cards: Record<string, CardState> = {};
  const drop = (id: string) => { delete levels[id]; };
  for (const id of [...CUE_IDS, ...RELIC_IDS, ...TRICK_IDS] as string[]) {
    const own = levels[id] ?? 0;
    if ((STAT_RELICS as readonly string[]).includes(id)) {
      if (own > 0) {
        const L = Math.floor(own);
        cards[id] = newCard(L - 1);
        cash += v3CardRefund(id, L);
      }
    } else if (own > 0) {
      cards[id] = newCard(levels[`${id}_lv`] ?? 0);
    }
    drop(id);
    drop(`${id}_lv`);
  }
  for (const [node, id] of Object.entries(BALL_CARD)) {
    if ((levels[node] ?? 0) > 0) cards[id] = newCard(0);
    drop(node);
  }
  drop('strayEmerald');
  const ball = typeof r.ballType === 'string' ? r.ballType : 'standard';
  const old = (r.loadout && typeof r.loadout === 'object' ? r.loadout : {}) as Record<string, unknown>;
  const { emeralds: _e, ballType: _b, ...rest } = r;
  const stats = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  return {
    ...rest,
    version: 4,
    cash,
    tokens,
    levels,
    cards,
    bestLoot: {},
    loadout: { ...old, ball },
    stats: { ...stats, teeth: 0 },
    hints: r.hints,
  };
}

export function loadSave(): SaveData {
  try {
    const t = localStorage.getItem(SAVE_KEY_V4);
    if (t) return sanitize(JSON.parse(t)) ?? newSave();
    const v3 = localStorage.getItem(SAVE_KEY_V3);
    const v2 = v3 ? null : localStorage.getItem(SAVE_KEY_V2);
    const old = v3 ?? v2;
    if (!old) return newSave();
    const j = JSON.parse(old);
    const save = sanitize(v2 && j && typeof j === 'object' && !Array.isArray(j) ? migrateV2(j) : j);
    if (!save) return newSave();
    writeSave(save);
    localStorage.removeItem(SAVE_KEY_V3);
    localStorage.removeItem(SAVE_KEY_V2);
    return save;
  } catch {
    return newSave();
  }
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY_V4, JSON.stringify(save));
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
