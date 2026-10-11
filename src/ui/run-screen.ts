// Run screen: fixed-step sim driving, hit-stop, aim input, HUD overlay.
import type { RunResult, RunState, Vec } from '../core/types';
import { CANCEL_RADIUS, FAST_FORWARD_MULT, MAX_PULL, SIM_DT } from '../core/types';
import { PALETTE } from '../render/palette';
import { drawHud, drawWorld } from '../render/renderer';
import { Fx } from '../render/fx';
import { drawText } from '../render/text';
import { Buttons, inRect } from './widgets';
import type { App, Screen } from './app';
import type { Button } from './widgets';

const P = PALETTE;
const FF_RECT = { x: 138, y: 296, w: 32, h: 18 };
const OVER_DELAY = 0.8;

export class RunScreen implements Screen {
  state: RunState | null = null;
  fx = new Fx();
  private acc = 0;
  private ff = false;
  private overTimer = 0;
  private finished = false;
  private bestFill = 0;
  private drag: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private ffPressed = false;
  private buttons = new Buttons();

  constructor(private app: App) {}

  start(state: RunState): void {
    this.state = state;
    this.fx.clear();
    this.acc = 0;
    this.ff = false;
    this.overTimer = 0;
    this.finished = false;
    this.drag = null;
    this.bestFill = this.app.save.bestFill[state.stage] ?? 0;
  }

  enter(): void {
    this.fx.shakeEnabled = this.app.save.settings.shake;
  }

  private ffAvailable(): boolean {
    return !!this.state && this.state.phase !== 'over' && this.app.sim.canFastForward(this.state);
  }

  update(dt: number): void {
    const s = this.state;
    if (!s) return;
    const sim = this.app.sim;
    const sfx = this.app.sfx;
    dt = Math.min(dt, 0.1);
    this.fx.update(dt);
    sfx.beginFrame();

    if (s.phase === 'over') {
      this.overTimer += dt;
      if (this.overTimer >= OVER_DELAY && !this.finished) {
        this.finished = true;
        this.app.finishRun(s.result ?? fallbackResult(s));
      }
      return;
    }
    if (s.phase === 'aim') this.ff = false;
    if (this.fx.hitStop > 0) {
      this.fx.hitStop--;
      return;
    }
    const mult = this.ff && sim.canFastForward(s) ? FAST_FORWARD_MULT : 1;
    this.acc += dt * mult;
    const all = [] as ReturnType<typeof sim.step>;
    let guard = 0;
    while (this.acc >= SIM_DT && guard++ < 1000) {
      this.acc -= SIM_DT;
      const ev = sim.step(s, SIM_DT);
      if (ev.length) {
        this.fx.consume(ev);
        for (const e of ev) all.push(e);
      }
      if (this.fx.hitStop > 0 || (s.phase as string) === 'over') {
        this.acc = 0;
        break;
      }
    }
    if (all.length) sfx.handle(all);
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
    drawWorld(ctx, s, now);
    this.drawAim(ctx, s);
    this.fx.draw(ctx);
    drawHud(ctx, s, this.bestFill, now);
    this.fx.drawOverlay(ctx);
    ctx.restore();

    const btns: Button[] = [];
    if (this.ffAvailable()) {
      btns.push({ id: 'ff', ...FF_RECT, label: '>>', style: this.ff ? 'gold' : 'gray', scale: 2, active: this.ff });
    }
    this.buttons.set(btns);
    this.buttons.draw(ctx);

    if (s.phase === 'over') {
      ctx.globalAlpha = Math.min(0.6, this.overTimer);
      ctx.fillStyle = P['0'];
      ctx.fillRect(0, 0, 180, 320);
      ctx.globalAlpha = 1;
      drawText(ctx, s.bossKilled ? 'STAGE CLEAR!' : 'OUT OF ENERGY', 90, 150, { align: 'center', scale: 2, color: s.bossKilled ? P.Y : P.p, shadow: P['0'] });
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D, s: RunState): void {
    const pull = this.pull();
    if (!pull || s.phase !== 'aim') return;
    const main = s.balls.find((b) => b.kind === 'main');
    if (!main) return;
    const len = Math.hypot(pull.x, pull.y);
    const bx = Math.round(main.x), by = Math.round(main.y);
    if (len <= CANCEL_RADIUS) {
      ctx.fillStyle = P['3'];
      for (let a = 0; a < 8; a++) ctx.fillRect(Math.round(bx + Math.cos(a * 0.785) * 8), Math.round(by + Math.sin(a * 0.785) * 8), 1, 1);
      return;
    }
    const power = Math.min(1, len / MAX_PULL);
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
    const L = Math.min(len, MAX_PULL);
    ctx.fillStyle = color;
    for (let d = 8; d <= L; d += 3) {
      ctx.fillRect(Math.round(bx + ux * d), Math.round(by + uy * d), 2, 2);
    }
    const ex = Math.round(bx + ux * L), ey = Math.round(by + uy * L);
    ctx.fillStyle = P['5'];
    ctx.fillRect(ex - 1, ey - 1, 4, 4);
    ctx.fillStyle = color;
    ctx.fillRect(ex, ey, 2, 2);
    // power pips near the ball
    drawText(ctx, `${Math.round(power * 100)}%`, bx, by - 14, { align: 'center', color, shadow: P['0'] });
  }

  down(x: number, y: number): void {
    const s = this.state;
    if (!s) return;
    if (this.ffAvailable() && inRect(x, y, FF_RECT.x, FF_RECT.y, FF_RECT.w, FF_RECT.h)) {
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
      if (this.buttons.up(x, y) === 'ff') {
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
    if (len <= CANCEL_RADIUS) return;
    if (this.app.sim.shoot(s, pull)) {
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
    meterFill: 0, bossKilled: s.bossKilled, shots: s.shots, bestCombo: s.bestCombo, seconds: s.t,
  };
}
