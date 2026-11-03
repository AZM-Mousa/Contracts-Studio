import { inject, Service, signal } from '@angular/core';
import { StorageKey } from '../enums/storage-key.enum';
import { LocalStorageService } from '../storage/local-storage.service';
import { Cue } from '../enums/cue.enum';

export { Cue };

const GAP_MS = 40;

interface Tone {
  f0: number;
  f1: number;
  d: number;
  g: number;
  type?: OscillatorType;
  at?: number;
}

const CUES: Record<Exclude<Cue, 'whoosh'>, Tone[]> = {
  tick: [{ f0: 1250, f1: 820, d: 0.05, g: 0.04 }],
  pop: [{ f0: 460, f1: 780, d: 0.12, g: 0.06 }],
  drop: [{ f0: 620, f1: 410, d: 0.09, g: 0.06, type: 'triangle' }],
  snap: [{ f0: 1600, f1: 1500, d: 0.03, g: 0.025 }],
  remove: [{ f0: 520, f1: 260, d: 0.12, g: 0.05, type: 'triangle' }],
  switch: [{ f0: 700, f1: 1050, d: 0.08, g: 0.045, type: 'triangle' }],
  success: [523.25, 659.25, 783.99].map((f, i) => ({ f0: f, f1: f * 1.004, d: 0.24 + i * 0.05, g: 0.05, at: i * 0.08 })),
  error: [{ f0: 220, f1: 165, d: 0.14, g: 0.08, type: 'triangle' }, { f0: 196, f1: 147, d: 0.18, g: 0.07, type: 'triangle', at: 0.15 }],
};

/** Short UI sounds made with Web Audio; no audio files. Off unless turned on. */
@Service()
export class SoundService {
  readonly #storage = inject(LocalStorageService);
  readonly enabled = signal(this.#storage.get(StorageKey.Sound) === '1');
  #ctx: AudioContext | null = null;
  #out: GainNode | null = null;
  #last = new Map<Cue, number>();

  toggle(on = !this.enabled()): void {
    this.enabled.set(on);
    this.#storage.set(StorageKey.Sound, on ? '1' : '0');
    if (on) {
      this.play(Cue.Pop);
    }
  }

  play(cue: Cue): void {
    if (!this.enabled() || matchMedia('(prefers-reduced-motion: reduce)').matches && cue === 'whoosh') {
      return;
    }
    const now = performance.now();
    if (now - (this.#last.get(cue) ?? 0) < GAP_MS) {
      return;
    }
    this.#last.set(cue, now);
    try {
      const ctx = this.#audio();
      const start = () => (cue === 'whoosh' ? this.#whoosh(ctx) : CUES[cue].forEach(t => this.#tone(ctx, t)));
      if (ctx.state === 'suspended') {
        void ctx.resume().then(start);
      } else {
        start();
      }
    } catch {}
  }

  #audio(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext();
      const lowpass = this.#ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 5200;
      this.#out = this.#ctx.createGain();
      this.#out.gain.value = 0.55;
      this.#out.connect(lowpass).connect(this.#ctx.destination);
    }
    return this.#ctx;
  }

  #tone(ctx: AudioContext, { f0, f1, d, g, type = 'sine', at = 0 }: Tone): void {
    const t = ctx.currentTime + at;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(g, t + Math.min(0.012, d / 3));
    gain.gain.linearRampToValueAtTime(0, t + d);
    gain.connect(this.#out!);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + d);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + d + 0.03);
  }

  #whoosh(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(600, t);
    band.frequency.exponentialRampToValueAtTime(2400, t + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    source.connect(band).connect(gain).connect(this.#out!);
    source.start(t);
  }
}
