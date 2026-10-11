// Procedural WebAudio sfx. No audio files. At most one of each sound per animation frame.
import type { FxEvent, TargetKind } from '../core/types';

const HIT_PITCH: Record<TargetKind, number> = {
  basic: 520, armored: 900, bouncy: 700, moving: 470, splitting: 400, volatile: 330, mini: 820, boss: 170, cadre: 600, warden: 760, hive: 360, spore: 1000, frost: 1100,
};

type Wave = OscillatorType;

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private played = new Set<string>();

  /** Call from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* audio unavailable */ }
  }

  beginFrame(): void {
    this.played.clear();
  }

  private gate(key: string): boolean {
    if (!this.enabled || !this.ctx || !this.master) return false;
    if (this.played.has(key)) return false;
    this.played.add(key);
    return true;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, slideTo = 0, delay = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filt: BiquadFilterType, freq: number, delay = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filt;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  shoot(power: number): void {
    if (!this.gate('shoot')) return;
    this.tone(350 + power * 300, 0.12, 'triangle', 0.25, 1300);
    this.noise(0.08, 0.08, 'highpass', 2500);
  }

  ui(): void {
    if (!this.gate('ui')) return;
    this.tone(660, 0.05, 'square', 0.12, 880);
  }

  buy(): void {
    if (!this.gate('buy')) return;
    this.tone(784, 0.08, 'square', 0.12);
    this.tone(1175, 0.14, 'square', 0.12, 0, 0.07);
  }

  handle(events: FxEvent[]): void {
    for (const e of events) {
      if ((e as { t: string }).t === 'boardClear') {
        if (!this.gate('clear')) continue;
        [659, 784, 988, 1319].forEach((f, i) => this.tone(f, i === 3 ? 0.4 : 0.1, 'triangle', 0.18, 0, i * 0.07));
        this.tone(1976, 0.5, 'sine', 0.06, 0, 0.25);
        continue;
      }
      switch (e.t) {
        case 'hit':
          if (e.killed) break;
          if (e.dmg <= 0) {
            if (!this.gate('deflect')) break;
            this.tone(1500, 0.04, 'square', 0.08, 1100);
            this.noise(0.03, 0.06, 'highpass', 4000);
            break;
          }
          if (!this.gate('hit')) break;
          if (e.targetKind === 'armored') {
            this.tone(900, 0.07, 'square', 0.12, 700);
            this.tone(1350, 0.05, 'square', 0.08);
          } else if (e.targetKind === 'boss') {
            this.tone(170, 0.12, 'sine', 0.3, 110);
            this.tone(340, 0.05, 'square', 0.08);
          } else {
            const f = HIT_PITCH[e.targetKind] ?? 500;
            this.tone(f, 0.05, e.targetKind === 'volatile' ? 'sawtooth' : 'square', 0.14, f * (e.targetKind === 'bouncy' ? 1.4 : 0.8));
          }
          break;
        case 'kill':
          if (!this.gate('kill')) break;
          this.tone(320, 0.09, 'square', 0.18, 140);
          this.tone(500, 0.09, 'triangle', 0.16, 1000, 0.05);
          break;
        case 'wall':
          if (!this.gate('wall')) break;
          this.tone(130, 0.07, 'sine', Math.min(0.3, 0.08 + e.speed / 1500), 80);
          this.noise(0.04, 0.05, 'lowpass', 500);
          break;
        case 'bumper':
          if (!this.gate('bumper')) break;
          this.tone(200, 0.09, 'sine', 0.25, 560);
          this.tone(560, 0.12, 'sine', 0.2, 300, 0.08);
          break;
        case 'ballClack':
          if (!this.gate('clack')) break;
          this.noise(0.025, 0.12, 'highpass', 3000);
          this.tone(1800, 0.025, 'square', 0.06);
          break;
        case 'explode':
          if (!this.gate('explode')) break;
          this.noise(0.4, 0.4, 'lowpass', 1400);
          this.tone(100, 0.35, 'sine', 0.35, 35);
          break;
        case 'lightning':
          if (!this.gate('lightning')) break;
          for (let i = 0; i < 5; i++) this.noise(0.03, 0.14, 'highpass', 2200 + i * 400, i * 0.025);
          this.tone(1400, 0.12, 'sawtooth', 0.06, 300);
          break;
        case 'combo':
          if (!this.gate('combo')) break;
          for (let i = 0; i < 4; i++) {
            const f = [523, 659, 784, 1047][i] * Math.pow(2, Math.min(6, e.mult - 1) / 12);
            this.tone(f, 0.09, 'triangle', 0.18, 0, i * 0.06);
          }
          break;
        case 'bossArrive':
          if (!this.gate('boss')) break;
          this.tone(55, 0.9, 'sawtooth', 0.3, 40);
          this.tone(82, 0.7, 'square', 0.1, 48);
          this.noise(0.5, 0.18, 'lowpass', 180);
          break;
        case 'bossPhase':
          if (!this.gate('phase')) break;
          this.tone(110, 0.4, 'sawtooth', 0.3, 50);
          this.noise(0.3, 0.2, 'lowpass', 600);
          break;
        case 'bossDead':
          if (!this.gate('bossdead')) break;
          [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 4 ? 0.6 : 0.14, 'square', 0.16, 0, i * 0.11));
          this.noise(0.5, 0.25, 'lowpass', 1500);
          break;
        case 'energy':
          if (e.amount <= 0 || !this.gate('refill')) break;
          this.tone(880, 0.25, 'sine', 0.12);
          this.tone(1320, 0.3, 'sine', 0.08, 0, 0.05);
          break;
        case 'emerald':
          if (!this.gate('emerald')) break;
          this.tone(1200, 0.15, 'sine', 0.14);
          this.tone(1800, 0.25, 'sine', 0.1, 0, 0.08);
          break;
        case 'chest':
          if (!this.gate('chest')) break;
          this.tone(988, 0.08, 'square', 0.12);
          this.tone(1319, 0.2, 'square', 0.12, 0, 0.07);
          break;
        case 'shrine':
          if (!this.gate('shrine')) break;
          this.tone(600, 0.4, 'sine', 0.14, 1200);
          break;
        case 'split':
        case 'spit':
          if (!this.gate('split')) break;
          this.tone(900, 0.05, 'triangle', 0.1, 1400);
          break;
        case 'telegraph':
          if (!this.gate('telegraph')) break;
          this.tone(e.kind === 'spawn' ? 500 : 1000, 0.05, 'sine', 0.07, e.kind === 'spawn' ? 700 : 1300);
          break;
        case 'shieldUp':
          if (!this.gate('shieldUp')) break;
          this.tone(1047, 0.18, 'sine', 0.1);
          this.tone(1568, 0.3, 'sine', 0.08, 0, 0.07);
          break;
        case 'shieldBreak':
          if (!this.gate('shieldBreak')) break;
          this.tone(2200, 0.06, 'square', 0.1, 1400);
          this.noise(0.1, 0.12, 'highpass', 5000);
          this.tone(3000, 0.08, 'triangle', 0.06, 0, 0.04);
          break;
        case 'freeze':
          if (!this.gate('freeze')) break;
          for (let i = 0; i < 4; i++) this.noise(0.03, 0.1, 'highpass', 4500 + i * 600, i * 0.035);
          this.tone(1800, 0.25, 'sine', 0.07, 900);
          break;
        case 'thaw':
          if (!this.gate('thaw')) break;
          this.tone(700, 0.06, 'sine', 0.08, 400);
          this.tone(520, 0.06, 'sine', 0.06, 300, 0.07);
          break;
        case 'shatter':
          if (!this.gate('shatter')) break;
          this.noise(0.22, 0.3, 'highpass', 3500);
          this.tone(2400, 0.1, 'square', 0.1, 600);
          this.tone(140, 0.2, 'sine', 0.25, 60);
          break;
        case 'runOver':
          if (!this.gate('over')) break;
          [330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.2, f * 0.9, i * 0.2));
          break;
        case 'shoot': // played locally on a successful shoot() call
        case 'shimmer':
          break;
      }
    }
  }
}
