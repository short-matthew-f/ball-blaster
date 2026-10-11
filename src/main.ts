// Boot, screen switching, scaling and the main loop.
import * as simMod from './sim/index';
import * as metaMod from './meta/index';
import type { MetaApi, RunResult, SaveData, SimApi } from './core/types';
import { VIEW_H, VIEW_W } from './core/types';
import { Sfx } from './audio/sfx';
import { attachInput } from './input';
import type { App, Screen, ScreenId, SummaryInfo } from './ui/app';
import { RunScreen } from './ui/run-screen';
import { TitleScreen } from './ui/title';
import { SummaryScreen } from './ui/summary';
import { ShopScreen } from './ui/shop';
import { SettingsScreen } from './ui/settings';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
ctx.imageSmoothingEnabled = false;

const sim: SimApi = simMod;
const meta: MetaApi = metaMod;
const sfx = new Sfx();

let save: SaveData = meta.loadSave();
sfx.enabled = save.settings.sound;

let summary: SummaryInfo | null = null;
let current: ScreenId = 'title';

const app: App = {
  get save() { return save; },
  meta,
  sim,
  sfx,
  get summary() { return summary; },
  settingsFrom: 'title',
  go(id) {
    current = id;
    screens[id].enter?.();
  },
  startRun() {
    const stats = meta.buildStats(save);
    const seed = Date.now() & 0x7fffffff;
    const state = sim.createRun(save.current, stats, seed, save.bestFill[save.current] ?? 0);
    runScreen.start(state);
    app.go('run');
  },
  finishRun(result: RunResult) {
    const prevBest = save.bestFill[result.stage] ?? 0;
    const banked = meta.bankRun(save, result);
    meta.writeSave(save);
    summary = { result, bossEmeralds: banked.bossEmeralds, unlocked: banked.unlocked, prevBest };
    app.go('summary');
  },
  persist() {
    meta.writeSave(save);
  },
  replaceSave(s) {
    save = s;
    sfx.enabled = save.settings.sound;
    meta.writeSave(save);
  },
} as App;

const runScreen = new RunScreen(app);
const screens: Record<ScreenId, Screen> = {
  title: new TitleScreen(app),
  run: runScreen,
  summary: new SummaryScreen(app),
  shop: new ShopScreen(app),
  settings: new SettingsScreen(app),
};

// ---- scaling ----
function fit(): void {
  const stage = document.getElementById('stage')!;
  const cs = getComputedStyle(stage);
  const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.max(1, Math.floor(Math.min(w / VIEW_W, h / VIEW_H)));
  canvas.style.width = `${VIEW_W * k}px`;
  canvas.style.height = `${VIEW_H * k}px`;
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
window.visualViewport?.addEventListener('resize', fit);
fit();

attachInput(
  canvas,
  () => screens[current],
  () => sfx.unlock(),
);

// ---- loop ----
let last = performance.now();
function frame(nowMs: number): void {
  const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
  last = nowMs;
  const scr = screens[current];
  scr.update?.(dt);
  ctx.imageSmoothingEnabled = false;
  scr.draw(ctx, nowMs / 1000);
  requestAnimationFrame(frame);
}
screens.title.enter?.();
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support optional */ });
  });
}

// Dev-only handle for playtesting from the console.
if (import.meta.env.DEV) (window as unknown as { __bb: unknown }).__bb = { app, screens, sim };
