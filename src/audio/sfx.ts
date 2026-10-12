// Procedural WebAudio sfx. No audio files. At most one of each sound per animation frame.
import type { FxEvent, TargetKind } from '../core/types';

const HIT_PITCH: Record<TargetKind, number> = {
  grunt: 520, skirmisher: 760, bouncer: 700, bomber: 330, broodmother: 400, grub: 820, thornback: 900, brute: 260, cleric: 600, hive: 360, boss: 170, frost: 800, cadre: 600, cog: 640, tinker: 560, goblin: 880,
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

  /** An enemy became staggered (dizzy blip). */
  stagger(): void {
    if (!this.gate('stagger')) return;
    this.tone(880, 0.05, 'square', 0.1, 1200);
    this.tone(1200, 0.05, 'square', 0.1, 800, 0.06);
    this.tone(880, 0.06, 'square', 0.08, 1100, 0.12);
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
      switch (e.t) {
        case 'boardClear':
          if (!this.gate('clear')) break;
          [659, 784, 988, 1319].forEach((f, i) => this.tone(f, i === 3 ? 0.4 : 0.1, 'triangle', 0.18, 0, i * 0.07));
          this.tone(1976, 0.5, 'sine', 0.06, 0, 0.25);
          break;
        case 'heroHit':
          if (!this.gate('hurt')) break;
          this.tone(95, 0.22, 'sine', 0.5, 45);
          this.noise(0.1, 0.2, 'lowpass', 400);
          break;
        case 'heroHeal':
          if (e.amount <= 0 || !this.gate('refill')) break;
          this.tone(880, 0.25, 'sine', 0.12);
          this.tone(1320, 0.3, 'sine', 0.08, 0, 0.05);
          break;
        case 'launch':
          if (!this.gate('launch')) break;
          this.noise(0.18, 0.12, 'bandpass', 900);
          this.tone(260, 0.16, 'triangle', 0.1, 520);
          break;
        case 'blocked':
          if (!this.gate('block')) break;
          this.tone(1250, 0.09, 'square', 0.12, 900);
          this.tone(1870, 0.06, 'square', 0.07, 1500, 0.01);
          this.noise(0.04, 0.1, 'highpass', 3500);
          break;
        case 'tracer':
          if (!this.gate('tracer')) break;
          this.tone(1800, 0.12, 'sawtooth', 0.08, 500);
          break;
        case 'stagger':
          this.stagger();
          break;
        case 'enrage':
          if (!this.gate('enrage')) break;
          this.tone(70, 0.18, 'sine', 0.45, 45);
          this.tone(70, 0.18, 'sine', 0.45, 45, 0.22);
          this.noise(0.15, 0.15, 'lowpass', 300);
          break;
        case 'hit':
          if (e.killed) break;
          if (e.dmg <= 0) {
            if (!this.gate('deflect')) break;
            this.tone(1500, 0.04, 'square', 0.08, 1100);
            this.noise(0.03, 0.06, 'highpass', 4000);
            break;
          }
          if (!this.gate('hit')) break;
          if (e.targetKind === 'brute') {
            this.tone(900, 0.07, 'square', 0.12, 700);
            this.tone(1350, 0.05, 'square', 0.08);
          } else if (e.targetKind === 'boss') {
            this.tone(170, 0.12, 'sine', 0.3, 110);
            this.tone(340, 0.05, 'square', 0.08);
          } else {
            const f = HIT_PITCH[e.targetKind] ?? 500;
            this.tone(f, 0.05, e.targetKind === 'bomber' ? 'sawtooth' : 'square', 0.14, f * (e.targetKind === 'bouncer' ? 1.4 : 0.8));
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
        case 'blast':
          if (!this.gate('explode')) break;
          this.noise(0.3, 0.35, 'lowpass', 1600);
          this.tone(110, 0.28, 'sine', 0.3, 40);
          break;
        case 'poisonTick':
          if (!this.gate('poison')) break;
          this.noise(0.12, 0.07, 'bandpass', 2600);
          this.tone(520, 0.08, 'sine', 0.05, 340);
          break;
        case 'mirror':
          if (!this.gate('mirror')) break;
          this.tone(1568, 0.14, 'sine', 0.14);
          this.tone(2093, 0.18, 'sine', 0.08, 0, 0.04);
          break;
        case 'trick':
          if (!this.gate('trick')) break;
          [523, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, 0, i * 0.06));
          this.tone(1568, 0.3, 'sine', 0.07, 0, 0.18);
          break;
        case 'shard':
          if (!this.gate('shard')) break;
          this.tone(2400, 0.04, 'square', 0.04, 1800);
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
          [392, 330, 262, 196, 147].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.22, f * 0.85, i * 0.16));
          this.noise(0.5, 0.12, 'lowpass', 250, 0.3);
          break;
        case 'belt':
          if (!this.gate('belt')) break;
          this.noise(0.14, 0.09, 'bandpass', 500);
          this.tone(110, 0.14, 'sawtooth', 0.07, 80);
          this.tone(150, 0.04, 'square', 0.06, 0, 0.07);
          break;
        case 'gearSpin':
          if (!this.gate('gear')) break;
          this.tone(1240, 0.18, 'square', 0.1, 1180);
          this.tone(1870, 0.12, 'triangle', 0.08, 1700, 0.01);
          this.noise(0.05, 0.1, 'highpass', 3000);
          break;
        case 'repair':
          if (!this.gate('repair')) break;
          this.tone(1047, 0.12, 'sine', 0.1);
          this.tone(1568, 0.22, 'sine', 0.08, 0, 0.07);
          break;
        case 'beltReverse':
          if (!this.gate('beltRev')) break;
          this.tone(260, 0.5, 'sawtooth', 0.14, 60);
          this.noise(0.5, 0.12, 'bandpass', 700);
          this.tone(130, 0.4, 'square', 0.06, 45, 0.1);
          break;
        case 'shoot': // played locally on a successful shoot() call
        case 'shimmer':
          break;
      }
    }
  }
}
