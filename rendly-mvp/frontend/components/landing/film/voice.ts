/**
 * The film's sound: one mixed track (voice-over, music and effects) that plays
 * in step with the film clock. While it plays it is the clock: the film reads
 * its position, so picture and narration cannot drift apart.
 */

import { withBasePath } from '@/lib/basePath';

const SRC = withBasePath('/sounds/RendlyVedioVoiceOver.mp3');
/** Re-seek the track when it is further than this from the film. */
const DRIFT = 0.25;

export class VoiceTrack {
  private el: HTMLAudioElement | null = null;
  private enabled = false;

  private audio(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio();
      el.preload = 'auto';
      el.src = SRC;
      this.el = el;
    }
    return this.el;
  }

  /** Turns sound on. Rejects when the track cannot load. */
  async enable(): Promise<void> {
    this.enabled = true;
    const el = this.audio();
    el.muted = false;
    if (el.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        const ok = () => {
          el.removeEventListener('error', bad);
          resolve();
        };
        const bad = () => {
          el.removeEventListener('loadedmetadata', ok);
          reject(new Error('Film sound failed to load'));
        };
        el.addEventListener('loadedmetadata', ok, { once: true });
        el.addEventListener('error', bad, { once: true });
        el.load();
      });
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.el && !this.el.paused) this.el.pause();
  }

  /** The track position while it is audibly playing, else null (the film keeps its own clock). */
  clock(): number | null {
    const el = this.el;
    if (!this.enabled || !el || el.paused || el.seeking || el.readyState < 3) return null;
    return el.currentTime;
  }

  /** Called every painted frame with the film's played time. */
  frame(t: number, playing: boolean): void {
    if (!this.enabled) return;
    const el = this.audio();
    if (!playing) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.readyState >= 1 && Math.abs(el.currentTime - t) > DRIFT) {
      try {
        el.currentTime = t;
      } catch {
        // Not seekable yet: the next frame retries.
      }
    }
    if (el.paused) {
      el.play().catch(() => {
        // Autoplay refused: stay silent until the viewer turns sound on.
        this.enabled = false;
      });
    }
  }

  dispose(): void {
    this.disable();
    if (this.el) {
      this.el.removeAttribute('src');
      this.el.load();
      this.el = null;
    }
  }
}
