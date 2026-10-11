import { SPIT_LIFE_CAP } from '../core/tuning';
import type { Currency, RunStats, TreeId, UpgradeNode } from '../core/types';

const geo = (base: number, mult: number) => (l: number) => Math.round(base * Math.pow(mult, l));

interface Def {
  id: string;
  tree: TreeId;
  name: string;
  desc: string;
  max: number;
  cost: (l: number) => number;
  col: number;
  row: number;
  icon: string;
  apply: (s: RunStats, l: number) => void;
  requires?: string[];
  currency?: Currency;
}

const mk = (d: Def): UpgradeNode => ({
  id: d.id,
  tree: d.tree,
  name: d.name,
  desc: d.desc,
  currency: d.currency ?? 'cash',
  maxLevel: d.max,
  cost: d.cost,
  requires: d.requires,
  pos: { col: d.col, row: d.row },
  icon: d.icon,
  apply: d.apply,
});

const em = (d: Omit<Def, 'currency' | 'tree'>) => mk({ ...d, tree: 'emerald', currency: 'emerald' });

export const NODES: UpgradeNode[] = [
  // ---- POWER ----
  mk({ id: 'damage', tree: 'power', name: 'DAMAGE', desc: 'Hits deal {v} damage', max: 12, cost: geo(5, 1.8), col: 1, row: 0, icon: 'icon_damage',
    apply: (s, l) => { s.damage += l; } }),
  mk({ id: 'speed', tree: 'power', name: 'VELOCITY', desc: 'Fast hits +{v} dmg', max: 5, cost: geo(60, 1.8), col: 0, row: 1, icon: 'icon_speed', requires: ['damage'],
    apply: (s, l) => { s.speedDamage = l; } }),
  mk({ id: 'lightning', tree: 'power', name: 'LIGHTNING', desc: 'Arcs between targets', max: 6, cost: geo(150, 1.7), col: 1, row: 1, icon: 'icon_lightning', requires: ['damage'],
    apply: (s, l) => {
      s.lightningChance = 0.15 + 0.07 * l;
      s.lightningArcs = 1 + Math.floor(l / 2);
      s.lightningRange = 40;
      s.lightningDamage = 1 + Math.floor(l / 3);
    } }),
  mk({ id: 'split', tree: 'power', name: 'SPLIT', desc: '{v} balls on 1st hit', max: 3, cost: geo(200, 2), col: 2, row: 1, icon: 'icon_split', requires: ['damage'],
    apply: (s, l) => { s.splitCount = l + 1; } }),
  mk({ id: 'spitter', tree: 'power', name: 'SPITTER', desc: 'Spits mini balls', max: 5, cost: geo(250, 1.8), col: 2, row: 2, icon: 'icon_spit', requires: ['split'],
    apply: (s, l) => {
      s.spitInterval = 0.6 - 0.08 * (l - 1);
      s.spitLife = Math.min(SPIT_LIFE_CAP, 1.2 + 0.3 * l);
      s.spitDamage = 1;
    } }),
  // ---- VITALITY ----
  mk({ id: 'maxHp', tree: 'vitality', name: 'MAX HP', desc: '+5 max HP', max: 10, cost: geo(6, 1.5), col: 1, row: 0, icon: 'icon_hp',
    apply: (s, l) => { s.maxHp += 5 * l; } }),
  mk({ id: 'armor', tree: 'vitality', name: 'ARMOR', desc: 'Hits hurt {v} less', max: 3, cost: geo(40, 1.8), col: 0, row: 1, icon: 'icon_armor', requires: ['maxHp'],
    apply: (s, l) => { s.armor += l; } }),
  mk({ id: 'secondWind', tree: 'vitality', name: 'SECOND WIND', desc: 'Kills heal {v}', max: 4, cost: geo(25, 1.6), col: 1, row: 1, icon: 'icon_heal', requires: ['maxHp'],
    apply: (s, l) => { s.healOnKill = 2 + (l - 1); } }),
  mk({ id: 'waveRest', tree: 'vitality', name: 'WAVE REST', desc: 'Wave clear heals {v}', max: 4, cost: geo(30, 1.6), col: 2, row: 1, icon: 'icon_wave', requires: ['maxHp'],
    apply: (s, l) => { s.waveHeal = 6 + 3 * (l - 1); } }),
  mk({ id: 'bossHeal', tree: 'vitality', name: 'BOSS HEAL', desc: 'Boss heals {v}%', max: 3, cost: (l) => [30, 60, 120][l] ?? 120, col: 1, row: 2, icon: 'icon_boss', requires: ['secondWind'],
    apply: (s, l) => { s.bossHeal = 0.25 * l; } }),
  mk({ id: 'thickSkin', tree: 'vitality', name: 'THICK SKIN', desc: 'Ranged hits -{v}', max: 2, cost: geo(50, 1.8), col: 2, row: 2, icon: 'icon_armor', requires: ['armor'],
    apply: (s, l) => { s.rangedResist += l; } }),
  // ---- TACTICS ----
  mk({ id: 'aim', tree: 'tactics', name: 'AIM LINE', desc: 'Preview {v} bounces', max: 3, cost: (l) => [25, 80, 200][l] ?? 200, col: 0, row: 0, icon: 'icon_aim',
    apply: (s, l) => { s.aimPreview = l; } }),
  mk({ id: 'heavyHits', tree: 'tactics', name: 'HEAVY HITS', desc: 'Hard hits stagger', max: 1, cost: () => 120, col: 0, row: 1, icon: 'icon_stagger', requires: ['aim'],
    apply: (s) => { s.heavyHits = 1; } }),
  mk({ id: 'mass', tree: 'tactics', name: 'MASS', desc: '+{v}% hero mass', max: 4, cost: geo(60, 1.7), col: 1, row: 0, icon: 'icon_mass',
    apply: (s, l) => { s.massMult += 0.25 * l; } }),
  mk({ id: 'reflex', tree: 'tactics', name: 'REFLEX', desc: 'Skip 1st enemy turn', max: 1, cost: () => 200, col: 0, row: 2, icon: 'icon_reflex', requires: ['heavyHits'],
    apply: (s) => { s.reflex = 1; } }),
  mk({ id: 'cashBonus', tree: 'tactics', name: 'CASH BONUS', desc: '+10% cash per level', max: 8, cost: geo(50, 1.7), col: 2, row: 0, icon: 'icon_cash',
    apply: (s, l) => { s.cashMult += 0.1 * l; } }),
  // ---- COMBO ----
  mk({ id: 'comboChain', tree: 'combo', name: 'CHAIN', desc: 'Multi-kill bonus', max: 5, cost: geo(40, 1.7), col: 1, row: 0, icon: 'icon_combo',
    apply: (s, l) => { s.comboChain = 0.25 * l; } }),
  mk({ id: 'comboBank', tree: 'combo', name: 'BANK', desc: 'Bank kill bonus', max: 4, cost: geo(60, 1.7), col: 0, row: 1, icon: 'icon_bank',
    apply: (s, l) => { s.comboBank = 0.5 * l; } }),
  mk({ id: 'comboCascade', tree: 'combo', name: 'CASCADE', desc: 'Bump-kill bonus', max: 1, cost: () => 90, col: 1, row: 1, icon: 'icon_bumper',
    apply: (s) => { s.comboCascade = 1; } }),
  mk({ id: 'comboSweep', tree: 'combo', name: 'SWEEP', desc: 'Clear bonus +{v}', max: 4, cost: geo(100, 1.7), col: 2, row: 1, icon: 'icon_wave',
    apply: (s, l) => { s.comboSweep = 25 * l; } }),
  mk({ id: 'comboLockdown', tree: 'combo', name: 'LOCKDOWN', desc: 'Combos stagger {v}', max: 4, cost: geo(120, 1.8), col: 1, row: 2, icon: 'icon_stagger', requires: ['comboChain'],
    apply: (s, l) => { s.comboLockdown = 2 * l; } }),
  // ---- EMERALD ----
  em({ id: 'bumpers', name: 'BUMPERS', desc: '{v} bumpers on table', max: 3, cost: (l) => l + 1, col: 0, row: 0, icon: 'icon_bumper',
    apply: (s, l) => { s.bumpers = l; } }),
  em({ id: 'crates', name: 'CRATES', desc: '{v} cash crates', max: 3, cost: (l) => 2 + l, col: 1, row: 0, icon: 'icon_crate',
    apply: (s, l) => { s.crates = l; s.crateCash = 8 + 4 * l; } }),
  em({ id: 'chests', name: 'CHESTS', desc: 'Richer chests', max: 3, cost: (l) => 3 + l, col: 2, row: 0, icon: 'icon_chest',
    apply: (s, l) => { s.chests = Math.min(l, 2); s.chestCash = 25 + 15 * l; } }),
  em({ id: 'shrine', name: 'SHRINE', desc: 'Shrine heals {v}', max: 4, cost: (l) => 3 + 2 * l, col: 3, row: 0, icon: 'icon_shrine',
    apply: (s, l) => { s.shrineChance = 0.3 + 0.15 * (l - 1); s.shrineHeal = 8 + 2 * l; } }),
  em({ id: 'ballHeavy', name: 'HEAVY BALL', desc: 'Unlock heavy ball', max: 1, cost: () => 3, col: 0, row: 1, icon: 'icon_ball', apply: () => {} }),
  em({ id: 'ballLight', name: 'LIGHT BALL', desc: 'Unlock light ball', max: 1, cost: () => 3, col: 1, row: 1, icon: 'icon_ball', apply: () => {} }),
  em({ id: 'ballSticky', name: 'STICKY BALL', desc: 'Unlock sticky ball', max: 1, cost: () => 4, col: 2, row: 1, icon: 'icon_ball', apply: () => {} }),
  em({ id: 'strayEmerald', name: 'STRAY GEMS', desc: 'Kills may drop gems', max: 5, cost: (l) => 10 + 5 * l, col: 3, row: 1, icon: 'icon_emerald', requires: ['shrine'],
    apply: (s, l) => { s.strayEmeraldChance = 0.01 * l; } }),
  // ---- STAGE: FELT ----
  mk({ id: 'felt_nap', tree: 'stage:felt', name: 'FELT HIDE', desc: '+2 max HP on felt', max: 2, cost: (l) => 100 + 100 * l, col: 0, row: 0, icon: 'icon_hp',
    apply: (s, l) => { s.maxHp += 2 * l; } }),
  mk({ id: 'felt_change', tree: 'stage:felt', name: 'POCKET CHG', desc: '+5% cash on felt', max: 3, cost: (l) => 80 + 80 * l, col: 1, row: 0, icon: 'icon_cash',
    apply: (s, l) => { s.cashMult += 0.05 * l; } }),
  mk({ id: 'felt_master', tree: 'stage:felt', name: 'FELT MASTER', desc: '+5 max HP always', max: 1, cost: () => 400, col: 0, row: 1, icon: 'icon_lock', requires: ['felt_nap', 'felt_change'],
    apply: (s) => { s.maxHp += 5; } }),
  // ---- STAGE: ICE ----
  mk({ id: 'ice_grip', tree: 'stage:ice', name: 'ICE GRIP', desc: '+1 bumper on ice', max: 2, cost: (l) => 300 + 300 * l, col: 0, row: 0, icon: 'icon_bumper',
    apply: (s) => { s.bumpers += 1; } }),
  mk({ id: 'ice_thaw', tree: 'stage:ice', name: 'THAW', desc: '+1 damage on ice', max: 2, cost: (l) => 350 + 350 * l, col: 1, row: 0, icon: 'icon_damage',
    apply: (s, l) => { s.damage += l; } }),
  mk({ id: 'ice_master', tree: 'stage:ice', name: 'ICE MASTER', desc: '+25% mass always', max: 1, cost: () => 1500, col: 0, row: 1, icon: 'icon_lock', requires: ['ice_grip', 'ice_thaw'],
    apply: (s) => { s.massMult += 0.25; } }),
];

/** Stage index required to buy nodes of a stage sub-tree. */
export const STAGE_TREE_INDEX: Record<string, number> = { 'stage:felt': 0, 'stage:ice': 1 };
/** Capstones: global perks (apply regardless of current stage). */
export const GLOBAL_NODES = new Set(['felt_master', 'ice_master']);
/** Capstone requirements must be fully maxed (not just >= 1). */
export const REQUIRES_MAXED = new Set(['felt_master', 'ice_master']);
