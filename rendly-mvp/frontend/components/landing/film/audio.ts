/**
 * The film's sound. Everything is silent until the viewer unmutes (browsers
 * block autoplaying audio anyway). Then:
 *  - music: /audio/film/music.mp3 if it exists, kept in sync with the film
 *    clock and faded at the loop seam; if the file is missing, a quiet
 *    synthesized 120 BPM bed plays instead;
 *  - effects: synthesized with the Web Audio API and fired from the cue
 *    sheet in timeline.ts as the clock crosses each cue.
 */

import { CUES, cuesBetween, type Cue, type CueName } from './cues';
import { BEAT, DURATION, env, storyTime } from './timeline';

export const MUSIC_SRC = '/audio/film/music.mp3';

/** Music sits low under everything. */
const MUSIC_LEVEL = 0.45;
const SFX_LEVEL = 0.75;
const BED_LEVEL = 0.32;
const LOOKAHEAD = 0.3;
/** Seconds of drift tolerated before the music is re-seeked to the film clock. */
const MUSIC_RESYNC = 1.5;

type MusicState = 'idle' | 'loading' | 'ok' | 'missing';

/** A, F, C, G (vi–IV–I–V in C): chord roots and voicings in Hz. */
const CHORDS: ReadonlyArray<{ root: number; notes: number[] }> = [
  { root: 110.0, notes: [220.0, 261.63, 329.63, 440.0] },
  { root: 87.31, notes: [174.61, 220.0, 261.63, 349.23] },
  { root: 130.81, notes: [196.0, 261.63, 329.63, 392.0] },
  { root: 98.0, notes: [196.0, 246.94, 293.66, 392.0] },
];

export class FilmAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private bed: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: HTMLAudioElement | null = null;
  private musicState: MusicState = 'idle';
  private enabled = false;
  private loops = 0;
  private bedCursor = -1;
  /** Fixed clock for offline rendering; null when live. */
  private clockAt: number | null = null;

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Call from a user gesture (the unmute button). */
  async enable(): Promise<void> {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) this.build(new Ctor());
    this.enabled = true;
    try {
      await this.ctx?.resume();
    } catch {
      /* resume can reject outside a gesture; the next gesture retries */
    }
    const now = this.ctx?.currentTime ?? 0;
    this.master?.gain.cancelScheduledValues(now);
    this.master?.gain.setTargetAtTime(0.9, now, 0.08);
    this.loadMusic();
    this.bedCursor = -1;
  }

  disable(): void {
    this.enabled = false;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.music?.pause();
  }

  dispose(): void {
    this.enabled = false;
    if (this.music) {
      this.music.pause();
      this.music.removeAttribute('src');
      this.music.load();
      this.music = null;
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  /**
   * Called every frame. `prev` → `t` is the clock step; `seeked` means a jump
   * (scrub, chapter click) that must not fire the cues in between.
   */
  frame(prev: number, t: number, playing: boolean, seeked: boolean): void {
    if (!this.enabled || !this.ctx) return;
    if (playing && !seeked && t < prev) this.loops++;
    if (playing && !seeked) for (const cue of cuesBetween(prev, t)) this.play(cue);
    this.syncMusic(t, playing, seeked);
    if (this.musicState === 'missing') this.scheduleBed(t, playing, seeked);
  }

  /**
   * Renders the whole film's soundtrack (music + every cue) offline, with the
   * same levels and envelopes as live playback. For exporting the film as a file.
   */
  async renderOffline(sampleRate = 48000): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * DURATION), sampleRate);
    this.build(ctx as unknown as AudioContext);
    if (!this.master || !this.musicGain) throw new Error('audio graph not built');
    this.master.gain.value = 0.9;
    const res = await fetch(MUSIC_SRC);
    if (!res.ok) throw new Error(`music fetch failed: ${res.status}`);
    const music = await ctx.decodeAudioData(await res.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.connect(this.musicGain);
    src.start(0);
    const step = 0.02;
    for (let t = 0; t < DURATION; t += step) {
      const level = MUSIC_LEVEL * env(t, 0, DURATION, 1.2, 1.4) * (1 - 0.35 * env(storyTime(t), 45.0, 46.0, 0.1, 0.6));
      this.musicGain.gain.setValueAtTime(level, t);
    }
    for (const cue of CUES) {
      if (cue.t < 0 || cue.t >= DURATION) continue;
      this.clockAt = cue.t;
      this.play(cue);
    }
    this.clockAt = null;
    const out = await ctx.startRendering();
    this.ctx = null;
    return out;
  }

  /* ---------------- graph ---------------- */

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_LEVEL;
    this.sfx.connect(this.master);
    this.bed = ctx.createGain();
    this.bed.gain.value = BED_LEVEL;
    this.bed.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // A short generated plate reverb for the bells and the impact tail.
    const irLen = Math.round(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.verb.connect(wet).connect(this.master);
  }

  private loadMusic() {
    if (this.musicState !== 'idle' || !this.ctx || !this.musicGain) return;
    this.musicState = 'loading';
    const el = new Audio();
    el.preload = 'auto';
    el.loop = true;
    el.crossOrigin = 'anonymous';
    el.addEventListener('canplay', () => {
      if (this.musicState === 'loading') this.musicState = 'ok';
    });
    el.addEventListener('error', () => {
      this.musicState = 'missing';
      this.bedCursor = -1;
    });
    el.src = MUSIC_SRC;
    try {
      this.ctx.createMediaElementSource(el).connect(this.musicGain);
    } catch {
      this.musicState = 'missing';
      return;
    }
    this.music = el;
  }

  private syncMusic(t: number, playing: boolean, seeked: boolean) {
    const el = this.music;
    const ctx = this.ctx;
    if (!el || !ctx || !this.musicGain || this.musicState !== 'ok') return;
    if (!playing) {
      if (!el.paused) el.pause();
      this.musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      return;
    }
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : DURATION;
    const want = t % dur;
    // Let the track play on its own clock: re-seeking every small drift makes it stutter.
    // Only jump on a user seek, a film loop, or a real desync (tab was hidden, buffering).
    if (seeked || Math.abs(el.currentTime - want) > MUSIC_RESYNC) el.currentTime = want;
    if (el.paused) void el.play().catch(() => undefined);
    // Fade in from the top, out into the loop seam; dip under the collapse into the Rendly mark.
    const level = MUSIC_LEVEL * env(t, 0, DURATION, 1.2, 1.4) * (1 - 0.35 * env(storyTime(t), 45.0, 46.0, 0.1, 0.6));
    this.musicGain.gain.setTargetAtTime(level, ctx.currentTime, 0.06);
  }

  /* ---------------- synthesized bed (fallback when music.mp3 is missing) ---------------- */

  private scheduleBed(t: number, playing: boolean, seeked: boolean) {
    const abs = this.loops * DURATION + t;
    if (!playing || seeked || this.bedCursor < 0 || abs < this.bedCursor - 1) {
      this.bedCursor = abs;
      if (!playing) return;
    }
    const until = abs + LOOKAHEAD;
    let beat = Math.floor(this.bedCursor / (BEAT / 2)) + 1;
    for (; beat * (BEAT / 2) <= until; beat++) {
      const at = beat * (BEAT / 2);
      const when = this.now() + Math.max(0, at - abs);
      this.bedStep(beat, at % DURATION, when);
    }
    this.bedCursor = until;
  }

  /** One eighth-note step of the bed. */
  private bedStep(step: number, ft: number, when: number) {
    const cycle = Math.round(DURATION / (BEAT / 2));
    const eighth = ((step % cycle) + cycle) % cycle;
    const isBeat = eighth % 2 === 0;
    const beatInBar = (eighth / 2) % 4;
    const bar = Math.floor(eighth / 8);
    const chord = CHORDS[bar % 4];
    const st = storyTime(ft);
    const riser = st >= 44.25 && st < 45.1;
    const drums = ft >= 0.6 && st < 117 && !riser;
    if (isBeat && beatInBar === 0) this.pad(chord.notes, when, riser ? 0.6 : 1);
    if (drums && isBeat) this.kick(when, beatInBar === 0 ? 1 : 0.8);
    if (drums && !isBeat && ft > 5) this.hat(when);
    if (drums && (beatInBar === 0 || beatInBar === 2) && isBeat) this.bass(chord.root, when);
    if (st >= 49 && st < 104 && !riser) this.pluck(chord.notes[(eighth * 3) % 4] * 2, when);
  }

  private pad(notes: number[], when: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed) return;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, when);
    lp.frequency.linearRampToValueAtTime(1400, when + 1);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.05 * level, when + 0.35);
    g.gain.setValueAtTime(0.05 * level, when + 1.6);
    g.gain.linearRampToValueAtTime(0, when + 2.3);
    lp.connect(g).connect(this.bed);
    for (const f of notes) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(lp);
        o.start(when);
        o.stop(when + 2.4);
      }
    }
  }

  private kick(when: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.14);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.55 * level, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.38);
    o.connect(g).connect(this.bed);
    o.start(when);
    o.stop(when + 0.4);
  }

  private hat(when: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp).connect(g).connect(this.bed);
    src.start(when, Math.random() * 0.5, 0.06);
  }

  private bass(root: number, when: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = root;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.45);
    o.connect(g).connect(this.bed);
    o.start(when);
    o.stop(when + 0.5);
  }

  private pluck(freq: number, when: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.035, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    o.connect(g).connect(this.bed);
    if (this.verb) g.connect(this.verb);
    o.start(when);
    o.stop(when + 0.32);
  }

  /* ---------------- effects ---------------- */

  private now(): number {
    return this.clockAt ?? this.ctx?.currentTime ?? 0;
  }

  private out(pan = 0, send = 0): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    if (send > 0 && this.verb) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(this.verb);
    }
    return p;
  }

  private tone(freq: number, dur: number, peak: number, dest: AudioNode, type: OscillatorType = 'sine', to?: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = this.now() + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private hiss(dur: number, peak: number, dest: AudioNode, filter: BiquadFilterType, f0: number, f1: number, q = 1, attack = 0.3) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t0 = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t0);
    bq.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + dur * attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  private play(cue: Cue) {
    const g = cue.gain ?? 1;
    const name: CueName = cue.name;
    const pan = cue.pan ?? 0;
    switch (name) {
      case 'whoosh': {
        const d = this.out(pan, 0.15);
        if (d) this.hiss(0.65, 0.32 * g, d, 'bandpass', 280, 2600, 1.1, 0.55);
        break;
      }
      case 'whip': {
        const d = this.out(pan, 0.1);
        if (d) this.hiss(0.34, 0.42 * g, d, 'bandpass', 700, 6500, 1.4, 0.5);
        break;
      }
      case 'tick': {
        const d = this.out(pan);
        if (d) this.tone(1900, 0.05, 0.07 * g, d);
        break;
      }
      case 'pop': {
        const d = this.out(pan);
        if (d) this.tone(520, 0.09, 0.12 * g, d, 'sine', 1150);
        break;
      }
      case 'click': {
        const d = this.out(pan);
        if (!d) break;
        this.hiss(0.025, 0.28 * g, d, 'highpass', 2500, 2600, 0.7, 0.2);
        this.tone(2400, 0.03, 0.08 * g, d);
        break;
      }
      case 'type': {
        const d = this.out(pan);
        if (d) this.hiss(0.03, 0.07 * g, d, 'highpass', 3200, 3400, 0.7, 0.2);
        break;
      }
      case 'blip': {
        const d = this.out(pan, 0.25);
        if (d) this.tone(880, 0.16, 0.07 * g, d, 'sine', 1320);
        break;
      }
      case 'chime': {
        const d = this.out(pan, 0.5);
        if (!d) break;
        this.tone(1046.5, 1.2, 0.09 * g, d);
        this.tone(1568, 1.1, 0.06 * g, d, 'sine', undefined, 0.08);
        break;
      }
      case 'riser': {
        const d = this.out(0, 0.2);
        if (!d) break;
        this.hiss(2.5, 0.3 * g, d, 'bandpass', 200, 6000, 2, 0.97);
        this.tone(110, 2.5, 0.05 * g, d, 'sawtooth', 880);
        break;
      }
      case 'impact': {
        const d = this.out(0, 0.6);
        if (!d) break;
        this.tone(95, 1.1, 0.9 * g, d, 'sine', 34);
        this.hiss(0.6, 0.45 * g, d, 'lowpass', 2400, 300, 0.7, 0.02);
        break;
      }
      case 'shimmer': {
        const d = this.out(pan, 0.7);
        if (!d) break;
        [1318.5, 1568, 1760, 2093, 2637, 3136].forEach((f, i) => this.tone(f, 0.95, 0.028 * g, d, 'sine', undefined, i * 0.05));
        break;
      }
      case 'connect': {
        const d = this.out(pan, 0.3);
        if (!d) break;
        this.tone(659.3, 0.18, 0.09 * g, d);
        this.tone(987.8, 0.3, 0.09 * g, d, 'sine', undefined, 0.13);
        break;
      }
      case 'ping': {
        const d = this.out(pan, 0.45);
        if (!d) break;
        this.tone(1568, 0.6, 0.08 * g, d);
        this.tone(2349, 0.45, 0.04 * g, d);
        break;
      }
      case 'send': {
        const d = this.out(pan, 0.1);
        if (d) this.hiss(0.22, 0.14 * g, d, 'bandpass', 1500, 4500, 1.2, 0.4);
        break;
      }
      case 'thump': {
        const d = this.out(0, 0.3);
        if (!d) break;
        this.tone(72, 0.45, 0.5 * g, d, 'sine', 40);
        break;
      }
    }
  }
}
