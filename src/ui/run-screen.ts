// Run screen: fixed-step sim driving, hit-stop, aim input, HUD overlay.
import type { RunResult, RunState, Vec } from '../core/types';
import { CANCEL_RADIUS, FAST_FORWARD_MULT, MAX_PULL, MIN_POWER, SIM_DT, TABLE } from '../core/types';
import { PALETTE } from '../render/palette';
import { drawHud, drawWorld, ringDots } from '../render/renderer';
import { stageById } from '../core/tuning';
import { Fx } from '../render/fx';
import { drawText } from '../render/text';
import { Buttons, inRect } from './widgets';
import { fastEnemiesOn } from './app';
import type { App, Screen } from './app';
import type { Button } from './widgets';

const P = PALETTE;
const FF_RECT = { x: 138, y: 296, w: 32, h: 18 };
const OVER_DELAY = 0.8;
const BAND_Y = 293; // tap anywhere at/below this y toggles fast-forward
const PULSE_T = 0.7;

export class RunScreen implements Screen {
  state: RunState | null = null;
  fx = new Fx();
  private acc = 0;
  private ff = false;
  private overTimer = 0;
  private finished = false;
  private bestWave = 0;
  private drag: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private ffPressed = false;
  private buttons = new Buttons();
  private prevPhase = '';
  private pulse = 0;
  private phaseHint = 0;

  constructor(private app: App) {}

  start(state: RunState): void {
    this.state = state;
    this.fx.clear();
    this.fx.bossName = stageById(state.stage).boss.name;
    this.acc = 0;
    this.ff = false;
    this.overTimer = 0;
    this.finished = false;
    this.drag = null;
    this.bestWave = this.app.save.bestWave[state.stage] ?? 0;
    this.prevPhase = '';
    this.pulse = 0;
    this.phaseHint = 0;
  }

  enter(): void {
    this.fx.shakeEnabled = this.app.save.settings.shake;
    this.fx.flashEnabled = this.app.save.settings.flash;
  }

  private heroResting(s: RunState): boolean {
    const mb = s.balls.find((b) => b.kind === 'main');
    return !mb || mb.resting;
  }

  /** Fast-forward is offered while only extras move (resolve) or while the enemy phase plays out around a resting hero. */
  private ffAvailable(): boolean {
    const s = this.state;
    if (!s || s.phase === 'over') return false;
    return this.app.sim.canFastForward(s) || (s.phase === 'enemy' && this.heroResting(s));
  }

  /** FAST ENEMIES: the enemy phase fast-forwards by itself once the hero is at rest (never over the first-time hint). */
  private autoFast(s: RunState): boolean {
    return s.phase === 'enemy' && this.phaseHint <= 0 && fastEnemiesOn(this.app.save) && this.heroResting(s);
  }

  update(dt: number): void {
    const s = this.state;
    if (!s) return;
    const sim = this.app.sim;
    const sfx = this.app.sfx;
    dt = Math.min(dt, 0.1);
    this.fx.update(dt);
    sfx.beginFrame();
    this.pulse = Math.max(0, this.pulse - dt);
    this.phaseHint = Math.max(0, this.phaseHint - dt);
    if (s.phase === 'aim' && this.prevPhase !== '' && this.prevPhase !== 'aim') this.pulse = PULSE_T;
    if (s.phase === 'enemy' && this.prevPhase !== 'enemy' && !this.app.save.hints.phaseTaught) {
      this.app.save.hints.phaseTaught = true;
      this.app.persist();
      this.phaseHint = 2.2;
    }
    if (this.prevPhase === 'resolve' && s.phase !== 'resolve' && s.combo.hits >= 2) {
      const h = s.balls.find((b) => b.kind === 'main');
      if (h) this.fx.hits(h.x, h.y, s.combo.hits);
    }
    this.prevPhase = s.phase;
    const mb = s.balls.find((b) => b.kind === 'main');
    this.fx.ballPos = mb ? { x: mb.x, y: mb.y } : null;

    if (s.phase === 'over') {
      this.overTimer += dt;
      if (this.overTimer >= OVER_DELAY && !this.finished) {
        this.finished = true;
        this.app.finishRun(s.result ?? fallbackResult(s));
      }
      return;
    }
    if (s.phase === 'aim') this.ff = false;
    const mult = (this.ff && this.ffAvailable()) || this.autoFast(s) ? FAST_FORWARD_MULT : 1;
    // Fast-forward (manual or FAST ENEMIES) skips hit-stop: zeroing `acc` per kill made 4x hitch.
    const fast = mult > 1;
    if (fast) this.fx.hitStop = 0;
    if (this.fx.hitStop > 0) {
      this.fx.hitStop--;
      return;
    }
    this.acc += dt * mult;
    const all = [] as ReturnType<typeof sim.step>;
    let guard = 0;
    while (this.acc >= SIM_DT && guard++ < 1000) {
      this.acc -= SIM_DT;
      const ev = sim.step(s, SIM_DT);
      if (ev.length) {
        this.fx.consume(ev);
        if (fast) this.fx.hitStop = 0;
        for (const e of ev) all.push(e);
      }
      if (this.fx.hitStop > 0 || (s.phase as string) === 'over') {
        this.acc = 0;
        break;
      }
    }
    if (all.length) sfx.handle(all);
    if (this.fx.pendingWave > 0 && !s.targets.some((t) => !t.dead && t.shimmer > 0)) this.fx.releaseWave();
    if (s.phase === 'aim') this.acc = 0;
  }

  private pull(): Vec | null {
    const d = this.drag;
    return d ? { x: d.sx - d.cx, y: d.sy - d.cy } : null;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.state;
    if (!s) return;
    const sh = this.fx.shakeOffset();
    ctx.save();
    ctx.translate(sh.x, sh.y);
    const flash = this.app.save.settings.flash;
    drawWorld(ctx, s, now, flash, { heroFlash: this.fx.heroFlash });
    this.drawHint(ctx, s, now);
    this.drawAim(ctx, s);
    this.fx.draw(ctx);
    drawHud(ctx, s, this.bestWave, now, { flash });
    this.drawPips(ctx, s);
    if (s.phase === 'over') {
      ctx.globalAlpha = Math.min(0.55, this.overTimer);
      ctx.fillStyle = P['0'];
      ctx.fillRect(0, 0, 180, 320);
      ctx.globalAlpha = 1;
    }
    this.drawPhaseHint(ctx);
    this.fx.drawOverlay(ctx);
    ctx.restore();

    const btns: Button[] = [];
    if (this.ffAvailable()) {
      const on = this.ff || this.autoFast(s);
      btns.push({ id: 'ff', ...FF_RECT, label: '>>', style: on ? 'gold' : 'gray', scale: 2, active: on });
    }
    this.buttons.set(btns);
    this.buttons.draw(ctx);

  }

  private drawAim(ctx: CanvasRenderingContext2D, s: RunState): void {
    const pull = this.pull();
    if (!pull || s.phase !== 'aim') return;
    const main = s.balls.find((b) => b.kind === 'main');
    if (!main) return;
    const len = Math.hypot(pull.x, pull.y);
    const bx = Math.round(main.x), by = Math.round(main.y);
    const ty = Math.max(32, by - 15);
    const tx = Math.max(TABLE.x + 13, Math.min(TABLE.x + TABLE.w - 24, bx));
    if (len <= CANCEL_RADIUS) {
      ctx.fillStyle = P['3'];
      for (let a = 0; a < 8; a++) ctx.fillRect(Math.round(bx + Math.cos(a * 0.785) * 8), Math.round(by + Math.sin(a * 0.785) * 8), 1, 1);
      ctx.globalAlpha = 0.5;
      drawText(ctx, 'CANCEL', tx, ty, { align: 'center', color: P['3'], shadow: P['0'] });
      ctx.globalAlpha = 1;
      return;
    }
    const power = Math.max(MIN_POWER, Math.min(1, len / MAX_PULL));
    const ux = pull.x / len, uy = pull.y / len;
    // preview polyline
    const pts = this.app.sim.previewShot(s, pull);
    if (pts.length > 1) {
      ctx.fillStyle = P['4'];
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = carry; d < seg; d += 5) {
          ctx.globalAlpha = 0.7;
          ctx.fillRect(Math.round(a.x + ((b.x - a.x) * d) / seg), Math.round(a.y + ((b.y - a.y) * d) / seg), 1, 1);
        }
        carry = (carry + (5 - (seg % 5))) % 5;
        ctx.globalAlpha = 1;
        if (i > 0) {
          ctx.fillStyle = P['5'];
          ctx.fillRect(Math.round(a.x) - 1, Math.round(a.y), 3, 1);
          ctx.fillRect(Math.round(a.x), Math.round(a.y) - 1, 1, 3);
          ctx.fillStyle = P['4'];
        }
      }
      ctx.globalAlpha = 1;
    }
    // pull line from the ball: dotted, color ramps with power
    const color = power < 0.4 ? P.E : power < 0.75 ? P.Y : P.R;
    const L = Math.max(Math.min(len, MAX_PULL), MIN_POWER * MAX_PULL);
    ctx.fillStyle = color;
    for (let d = 8; d <= L; d += 3) {
      ctx.fillRect(Math.round(bx + ux * d), Math.round(by + uy * d), 2, 2);
    }
    const ex = Math.round(bx + ux * L), ey = Math.round(by + uy * L);
    ctx.fillStyle = P['5'];
    ctx.fillRect(ex - 1, ey - 1, 4, 4);
    ctx.fillStyle = color;
    ctx.fillRect(ex, ey, 2, 2);
  }

  /** Power pips sit beside the HP bar so the thumb never covers them. Past the cancel radius they never show empty (25% floor). */
  private drawPips(ctx: CanvasRenderingContext2D, s: RunState): void {
    const pull = this.pull();
    if (!pull || s.phase !== 'aim') return;
    const len = Math.hypot(pull.x, pull.y);
    if (len <= CANCEL_RADIUS) return;
    const power = Math.max(MIN_POWER, Math.min(1, len / MAX_PULL));
    const color = power < 0.4 ? P.E : power < 0.75 ? P.Y : P.R;
    const lit = Math.max(1, Math.round(power * 5));
    for (let i = 0; i < 5; i++) {
      const px = 110 + i * 5;
      ctx.fillStyle = P['0'];
      ctx.fillRect(px - 1, 3, 5, 5);
      ctx.fillStyle = i < lit ? color : P['2'];
      ctx.fillRect(px, 4, 3, 3);
    }
  }

  /** One-time "THEY MOVE AFTER YOU" plate on the first enemy phase. */
  private drawPhaseHint(ctx: CanvasRenderingContext2D): void {
    if (this.phaseHint <= 0) return;
    ctx.globalAlpha = Math.min(1, this.phaseHint / 0.4) * 0.8;
    ctx.fillStyle = P['0'];
    ctx.fillRect(24, 128, 132, 34);
    ctx.globalAlpha = Math.min(1, this.phaseHint / 0.4);
    drawText(ctx, 'THEY MOVE', 90, 132, { align: 'center', scale: 2, color: P['5'], shadow: P['0'] });
    drawText(ctx, 'AFTER YOU', 90, 146, { align: 'center', scale: 2, color: P.Y, shadow: P['0'] });
    ctx.globalAlpha = 1;
  }

  /** Ring pulse round the ball + first-session ghost pull demo. */
  private drawHint(ctx: CanvasRenderingContext2D, s: RunState, now: number): void {
    if (s.phase !== 'aim') return;
    const main = s.balls.find((b) => b.kind === 'main');
    if (!main) return;
    const bx = Math.round(main.x), by = Math.round(main.y);
    const teaching = !this.app.save.hints.shotTaught;
    if (this.drag) return;
    let k = -1;
    if (teaching) k = (now % 1.4) / 1.4;
    else if (this.pulse > 0) k = 1 - this.pulse / PULSE_T;
    if (k >= 0) {
      ctx.globalAlpha = 1 - k * 0.8;
      ringDots(ctx, bx, by, 8 + k * 4, P['5'], 0, 0.5);
      ctx.globalAlpha = 1;
    }
    if (!teaching) return;
    // ghost pull line demo from mid-table, growing and repeating
    const t = (now % 2) / 2;
    const gx = 90, gy = 168;
    const L = Math.min(1, t / 0.7) * 24;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = P.E;
    for (let d = 8; d <= L; d += 3) ctx.fillRect(gx, gy + d, 2, 2);
    ctx.fillStyle = P['5'];
    ctx.fillRect(gx - 1, gy - 1, 4, 4);
    ctx.fillRect(gx - 1, gy + Math.round(L) - 1, 4, 4);
    ctx.globalAlpha = 1;
    // dark plate so the hint stays legible over targets
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = P['0'];
    ctx.fillRect(28, 196, 124, 32);
    ctx.globalAlpha = 1;
    drawText(ctx, 'DRAG ANYWHERE', 90, 202, { align: 'center', scale: 2, color: P['5'], shadow: P['0'] });
    drawText(ctx, 'RELEASE TO SHOOT', 90, 220, { align: 'center', color: P['3'], shadow: P['0'] });
  }

  down(x: number, y: number): void {
    const s = this.state;
    if (!s) return;
    if (this.ffAvailable() && (y >= BAND_Y || inRect(x, y, FF_RECT.x, FF_RECT.y, FF_RECT.w, FF_RECT.h))) {
      this.ffPressed = true;
      this.buttons.down(x, y);
      return;
    }
    if (s.phase === 'aim') this.drag = { sx: x, sy: y, cx: x, cy: y };
  }

  move(x: number, y: number): void {
    if (this.drag) {
      this.drag.cx = x;
      this.drag.cy = y;
    }
  }

  up(x: number, y: number): void {
    const s = this.state;
    if (this.ffPressed) {
      this.ffPressed = false;
      const hit = this.buttons.up(x, y) === 'ff';
      if (hit || (y >= BAND_Y && this.ffAvailable())) {
        this.ff = !this.ff;
        this.app.sfx.ui();
      }
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!s || !d || s.phase !== 'aim') return;
    const pull = { x: d.sx - x, y: d.sy - y };
    const len = Math.hypot(pull.x, pull.y);
    if (len <= CANCEL_RADIUS) {
      this.pulse = PULSE_T; // acknowledge a cancelled tap
      return;
    }
    if (this.app.sim.shoot(s, pull)) {
      const hints = this.app.save.hints;
      if (!hints.shotTaught) {
        hints.shotTaught = true;
        this.app.persist();
      }
      this.app.sfx.shoot(Math.min(1, len / MAX_PULL));
      this.acc = 0;
    }
  }

  cancel(): void {
    this.drag = null;
    this.ffPressed = false;
    this.buttons.pressed = null;
  }
}

function fallbackResult(s: RunState): RunResult {
  return {
    stage: s.stage, cash: s.cash, emeralds: s.emeralds, kills: s.kills,
    wave: Math.min(s.wave, 4), wavesCleared: Math.max(0, Math.min(s.wave, 4) - 1), overtimeWaves: Math.max(0, s.wave - 4),  bossKilled: s.bossKilled, shots: s.shots, bestCombo: s.bestCombo, seconds: s.t,
  };
}
