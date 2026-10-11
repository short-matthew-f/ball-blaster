import { PALETTE } from '../render/palette';
import { getMenuBg } from '../render/renderer';
import { drawText } from '../render/text';
import { Buttons } from './widgets';
import type { App, Screen } from './app';

const P = PALETTE;

/** Minimal DOM overlay with a textarea (used for export fallback and import). */
function showOverlay(title: string, text: string, readOnly: boolean, actions: { label: string; run: (value: string, msg: (m: string) => void) => boolean | void }[]): void {
  document.getElementById('overlay')?.remove();
  const root = document.createElement('div');
  root.id = 'overlay';
  root.style.cssText = 'position:fixed;inset:0;z-index:10;background:rgba(13,11,20,.94);display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font:bold 14px monospace;color:#d8d2e6;touch-action:auto;user-select:text;-webkit-user-select:text';
  const h = document.createElement('div');
  h.textContent = title;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = readOnly;
  ta.style.cssText = 'width:min(92vw,420px);height:40vh;background:#2a2238;color:#d8d2e6;border:2px solid #8a7fa3;font:12px monospace;padding:6px;box-sizing:border-box;-webkit-user-select:text;user-select:text';
  const msg = document.createElement('div');
  msg.style.color = '#f2c44b';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px';
  const close = (): void => root.remove();
  const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:bold 14px monospace;padding:10px 16px;background:#4b3f63;color:#fff;border:2px solid #0d0b14;border-radius:0';
    b.onclick = fn;
    return b;
  };
  for (const a of actions) {
    row.appendChild(mkBtn(a.label, () => {
      if (a.run(ta.value, (m) => { msg.textContent = m; }) !== false) close();
    }));
  }
  row.appendChild(mkBtn('CLOSE', close));
  root.append(h, ta, msg, row);
  document.body.appendChild(root);
  if (readOnly) { ta.focus(); ta.select(); }
}

export class SettingsScreen implements Screen {
  private buttons = new Buttons();
  private confirming = false;
  private toast = '';
  private toastUntil = 0;
  private now = 0;

  constructor(private app: App) {}

  enter(): void {
    this.confirming = false;
    this.toast = '';
  }

  private say(m: string): void {
    this.toast = m;
    this.toastUntil = this.now + 2;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.now = now;
    ctx.drawImage(getMenuBg(), 0, 0);
    const set = this.app.save.settings;
    drawText(ctx, 'SETTINGS', 90, 16, { align: 'center', scale: 3, color: P['5'], shadow: P['0'], shadowOff: 2 });
    const confirming = this.confirming;
    this.buttons.set([
      { id: 'sound', x: 20, y: 56, w: 140, h: 22, label: `SOUND: ${set.sound ? 'ON' : 'OFF'}`, scale: 1, style: set.sound ? 'green' : 'gray' },
      { id: 'shake', x: 20, y: 86, w: 140, h: 22, label: `SHAKE: ${set.shake ? 'ON' : 'OFF'}`, style: set.shake ? 'green' : 'gray' },
      { id: 'flash', x: 20, y: 116, w: 140, h: 22, label: `FLASH: ${set.flash ? 'ON' : 'OFF'}`, style: set.flash ? 'green' : 'gray' },
      { id: 'export', x: 20, y: 156, w: 140, h: 22, label: 'EXPORT SAVE', style: 'blue' },
      { id: 'import', x: 20, y: 186, w: 140, h: 22, label: 'IMPORT SAVE', style: 'blue' },
      ...(confirming
        ? [
            { id: 'resetYes', x: 20, y: 226, w: 66, h: 22, label: 'YES, RESET', style: 'red' as const },
            { id: 'resetNo', x: 94, y: 226, w: 66, h: 22, label: 'CANCEL', style: 'gray' as const },
          ]
        : [{ id: 'reset', x: 20, y: 226, w: 140, h: 22, label: 'RESET SAVE', style: 'red' as const }]),
      { id: 'back', x: 50, y: 270, w: 80, h: 22, label: 'BACK', scale: 2, style: 'gray' },
    ]);
    this.buttons.draw(ctx);
    if (now < this.toastUntil) drawText(ctx, this.toast, 90, 254, { align: 'center', color: P.Y, shadow: P['0'] });
  }

  down(x: number, y: number): void {
    this.buttons.down(x, y);
  }
  move(): void {}
  up(x: number, y: number): void {
    const id = this.buttons.up(x, y);
    if (!id) return;
    const app = this.app;
    app.sfx.ui();
    const set = app.save.settings;
    if (id === 'sound') {
      set.sound = !set.sound;
      app.sfx.enabled = set.sound;
      app.persist();
    } else if (id === 'shake') {
      set.shake = !set.shake;
      app.persist();
    } else if (id === 'flash') {
      set.flash = !set.flash;
      app.persist();
    } else if (id === 'export') {
      const code = app.meta.exportSave(app.save);
      const nav = navigator.clipboard;
      if (nav && nav.writeText) {
        nav.writeText(code).then(() => this.say('COPIED TO CLIPBOARD'), () => showOverlay('COPY YOUR SAVE CODE', code, true, []));
      } else showOverlay('COPY YOUR SAVE CODE', code, true, []);
    } else if (id === 'import') {
      showOverlay('PASTE SAVE CODE', '', false, [{
        label: 'IMPORT',
        run: (value, msg) => {
          const s = app.meta.importSave(value.trim());
          if (!s) { msg('INVALID SAVE CODE'); return false; }
          app.replaceSave(s);
          this.say('SAVE IMPORTED');
          return true;
        },
      }]);
    } else if (id === 'reset') {
      this.confirming = true;
    } else if (id === 'resetNo') {
      this.confirming = false;
    } else if (id === 'resetYes') {
      app.replaceSave(app.meta.newSave());
      this.confirming = false;
      this.say('SAVE RESET');
    } else if (id === 'back') app.go(app.settingsFrom);
  }
  cancel(): void {
    this.buttons.pressed = null;
  }
}
