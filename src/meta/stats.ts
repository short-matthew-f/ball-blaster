import { BASE_STATS, TRICK_USES } from '../core/tuning';
import type { RelicId, RunStats, SaveData } from '../core/types';
import { TOKEN_OF_WORLD } from '../core/types';
import { nodesFor } from './tree';
import { cueSlotOpen, gearOwned, relicSlots, trickSlotOpen } from './gear';
import { nodeLevel } from './level';
import { MULT_IDS, WORLD_ONLY } from './upgrades';

export { nodeLevel };

/** World index of a stage id ('w2s1', 'l1w3s4'); 0 if unparseable. */
export function worldOf(stage: string): number {
  const m = /^(?:l\d+)?w(\d)s\d$/.exec(stage);
  return m ? Number(m[1]) : 0;
}

/** Effect nodes that are relics: their stat fields apply only while the relic is equipped. */
const GATED_RELICS = new Set<string>(['lightning', 'split', 'spitter']);


export function buildStats(save: SaveData): RunStats {
  const s: RunStats = { ...BASE_STATS };
  const lo = save.loadout ?? { ball: 'standard', cue: 'standard', relics: [], trick: null };
  const slots = relicSlots(save);
  const relics = lo.relics.filter((id, i, a) => i < slots && a.indexOf(id) === i && gearOwned(save, id));
  const world = worldOf(save.current);
  const nodes = nodesFor(save);
  let mult = false;
  for (const pass of [false, true]) {
    for (const n of nodes) {
      if (MULT_IDS.has(n.id) !== pass) continue;
      const l = Math.min(nodeLevel(save, n.id), n.maxLevel);
      if (l <= 0) continue;
      const w = WORLD_ONLY.get(n.id);
      if (w !== undefined && w !== world) continue;
      if (GATED_RELICS.has(n.id) && !relics.includes(n.id as RelicId)) continue;
      n.apply(s, l);
      if (pass) mult = true;
    }
  }
  if (mult) {
    s.damage = Math.max(1, Math.round(s.damage));
    s.maxHp = Math.round(s.maxHp);
    s.waveHeal = Math.round(s.waveHeal);
  }
  s.ballType = lo.ball !== 'standard' && save.cards?.[lo.ball] ? lo.ball : 'standard';
  s.tokenId = TOKEN_OF_WORLD[Math.max(1, world) - 1] ?? 'stripe';
  s.mods = [];
  const cue = lo.cue !== 'standard' && cueSlotOpen(save) && gearOwned(save, lo.cue) ? lo.cue : 'standard';
  const trick = lo.trick && trickSlotOpen(save) && gearOwned(save, lo.trick) ? lo.trick : null;
  s.cue = cue;
  s.relics = relics;
  s.trick = trick;
  const gl: Record<string, number> = {};
  for (const id of [...relics, ...(trick ? [trick] : []), ...(cue !== 'standard' ? [cue] : [])]) {
    gl[id] = GATED_RELICS.has(id) ? nodeLevel(save, id) : Math.min(2, nodeLevel(save, `${id}_lv`));
  }
  s.gearLevel = gl;
  s.trickUses = trick ? TRICK_USES[trick] + (gl[trick] >= 1 ? 1 : 0) : 0;
  if (cue === 'break') s.aimPreview = 0;
  return s;
}
