// Shared app context handed to every screen.
import type { MetaApi, RunResult, SaveData, SimApi, StageId } from '../core/types';
import type { Sfx } from '../audio/sfx';

export type ScreenId = 'title' | 'run' | 'summary' | 'shop' | 'settings';

export interface SummaryInfo {
  result: RunResult;
  bossEmeralds: number;
  unlocked: StageId | null;
  /** Best fill for this stage before this run was banked (the ghost line). */
  prevBest: number;
}

export interface App {
  save: SaveData;
  meta: MetaApi;
  sim: SimApi;
  sfx: Sfx;
  summary: SummaryInfo | null;
  /** Screen to return to from settings. */
  settingsFrom: ScreenId;
  go(id: ScreenId): void;
  startRun(): void;
  /** Called by the run screen once the post-run delay has elapsed. */
  finishRun(result: RunResult): void;
  persist(): void;
  /** Replace save contents in place (import / reset). */
  replaceSave(s: SaveData): void;
}

export interface Screen {
  enter?(): void;
  update?(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel?(): void;
}
