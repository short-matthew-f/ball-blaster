// v0.6 gallery cards (M2). Every piece of gear is a card with the same tree: unlock -> base I/II -> fork -> base III -> capstone.
// Forks and capstones are typed here but empty until M3.
import type { CardState, RunStats, SaveData } from '../core/types';

export type CardSlot = 'cue' | 'ball' | 'relic' | 'trick';

export interface BaseNode {
  name: string;
  desc: string;
  /** Cost (cash) of base level l+1 for l = 0..2. */
  cost: (l: 0 | 1 | 2) => number;
  /** Optional formula hook; most cards are read through gearLevel[id] in buildStats. */
  apply?: (s: RunStats, level: number) => void;
}

/** A fork or capstone choice (M3). */
export interface ForkChoice {
  id: string;
  name: string;
  desc: string;
  /** Tokens of the card's world. */
  cost: number;
}

export interface CardDef {
  id: string;
  slot: CardSlot;
  /** World whose boss token unlocks it (1..6). */
  world: number;
  name: string;
  desc: string;
  /** Sprite name (9x9). */
  icon: string;
  /** Visible but unbuyable until its world ships. */
  stub?: boolean;
  base: [BaseNode, BaseNode, BaseNode];
  forks: ForkChoice[];
  caps: ForkChoice[];
}

export type CardBuyState = 'stub' | 'locked' | 'open' | 'owned' | 'maxed';

/** The card catalogue (filled by M2). */
export const CARDS: CardDef[] = [];

export const cardById = (id: string): CardDef | undefined => CARDS.find((c) => c.id === id);
export const cardOwned = (save: SaveData, id: string): boolean => id === 'standard' || !!save.cards[id];
export const cardState = (save: SaveData, id: string): CardState | undefined => save.cards[id];

/** Stub until M2: nothing is buyable. */
export function cardBuyState(_save: SaveData, _id: string): CardBuyState {
  return 'locked';
}
export function buyCard(_save: SaveData, _id: string): boolean {
  return false;
}
export function buyBase(_save: SaveData, _id: string): boolean {
  return false;
}
export function setFork(_save: SaveData, _id: string, _choice: string): boolean {
  return false;
}
export function setCap(_save: SaveData, _id: string, _choice: string): boolean {
  return false;
}
