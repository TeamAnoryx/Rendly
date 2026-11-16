/**
 * Disconnect grace: when someone's last socket drops (tab closed, app switched, network blip),
 * their seat in a huddle, Spark match or call is held for GRACE_MS. Reconnecting within that
 * time resumes it; only after it runs out does the normal leave/end path run.
 */

/** How long a dropped seat is held before the person counts as gone (2 minutes). */
export const GRACE_MS = 120_000;

export class GraceTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ms: number = GRACE_MS) {}

  /** Start (or restart) the hold for `key`; `onExpire` runs once if it is not resumed in time. */
  hold(key: string, onExpire: () => void): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      try {
        onExpire();
      } catch (err) {
        console.error("[grace] expiry handler failed:", err instanceof Error ? err.message : "unknown");
      }
    }, this.ms);
    // Never keep the process alive just for a held seat.
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(key, timer);
  }

  /** Clear a running hold. Returns true when one was running (the person came back in time). */
  cancel(key: string): boolean {
    const timer = this.timers.get(key);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(key);
    return true;
  }

  isHeld(key: string): boolean {
    return this.timers.has(key);
  }
}
