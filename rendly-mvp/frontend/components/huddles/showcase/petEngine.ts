/**
 * Cursor "pet" for the Huddles showcase: a small black ball that flies slowly along curved
 * paths. While it moves it stretches into a short pill that bends with its path like a worm;
 * when it stops it eases back into a circle. A click is a grow-then-shrink pulse.
 * Imperative and rAF-driven so it never re-renders React.
 */

export interface PetStep {
  /** data-sc key of an element to fly to; its centre is the target. */
  el?: string;
  /** Fixed point in composition coordinates. */
  pt?: [number, number];
  /** Layer depth while travelling this leg: in front of the phones or behind them. */
  z?: 'front' | 'back';
  /** Jump straight there (used for the start of the loop). */
  instant?: boolean;
  /** Click here and run this action. */
  action?: string;
  /** Rest here for this many ms after arriving / acting. */
  pause?: number;
}

export interface PetOptions {
  comp: HTMLElement;
  layer: HTMLElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  getScale: () => number;
  steps: PetStep[];
  onAction: (action: string) => Promise<void> | void;
}

interface Point {
  x: number;
  y: number;
}

/** Body thickness (design px); the pill is this wide and a resting ball this round. */
const BODY = 26;
/** Longest the pill gets while flying (design px, centre line). */
const MAX_LEN = 78;
const MIN_LEG_MS = 900;
const MAX_LEG_MS = 2400;
const PX_PER_MS = 0.32;
const PULSE_MS = 420;
const HISTORY = 90;
const FRONT_Z = '20';
const BACK_Z = '1';

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Grow then shrink then settle: 1 → 1.4 → 0.82 → 1. */
function pulseScale(t: number): number {
  if (t <= 0 || t >= 1) return 1;
  if (t < 0.35) return 1 + 0.4 * Math.sin((t / 0.35) * (Math.PI / 2));
  if (t < 0.7) return 1.4 - 0.58 * ((t - 0.35) / 0.35);
  return 0.82 + 0.18 * ((t - 0.7) / 0.3);
}

export function runPet(o: PetOptions): () => void {
  let alive = true;
  let x = o.width + 40;
  let y = 40;
  let depth: 'front' | 'back' = 'front';
  let curveSign = 1;
  let len = 0;
  let pulseStart = -1;
  let lastHead: Point = { x, y };
  let frame = 0;
  const history: Point[] = [];
  const ctx = o.canvas.getContext('2d');

  const sizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = o.getScale() || 1;
    o.canvas.width = Math.round(o.width * s * dpr);
    o.canvas.height = Math.round(o.height * s * dpr);
    ctx?.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  };
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const targetOf = (step: PetStep): [number, number] => {
    if (step.pt) return step.pt;
    const el = step.el ? (o.comp.querySelector(`[data-sc="${step.el}"]`) as HTMLElement | null) : null;
    if (!el) return [x, y];
    const s = o.getScale() || 1;
    const c = o.comp.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [(r.left + r.width / 2 - c.left) / s, (r.top + r.height / 2 - c.top) / s];
  };

  const setDepth = (d: 'front' | 'back') => {
    depth = d;
    o.layer.style.zIndex = d === 'front' ? FRONT_Z : BACK_Z;
  };

  /** Points from the head back along the recent path, covering `want` px. */
  const body = (want: number): Point[] => {
    const pts: Point[] = [{ x, y }];
    let acc = 0;
    for (let i = history.length - 1; i >= 0 && acc < want; i--) {
      const prev = pts[pts.length - 1];
      const p = history[i];
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (d < 0.01) continue;
      if (acc + d > want) {
        const f = (want - acc) / d;
        pts.push({ x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f });
        break;
      }
      acc += d;
      pts.push(p);
    }
    return pts;
  };

  const render = (now: number) => {
    if (!alive) return;
    const speed = Math.hypot(x - lastHead.x, y - lastHead.y);
    lastHead = { x, y };
    if (speed > 0.01) {
      history.push({ x, y });
      if (history.length > HISTORY) history.shift();
    }
    // Ease the length toward a speed-based target: stretch while moving, round when still.
    const target = Math.min(MAX_LEN, speed * 16);
    len += (target - len) * (target > len ? 0.12 : 0.18);
    if (len < 0.2) len = 0;

    const pulse = pulseStart < 0 ? 1 : pulseScale((now - pulseStart) / PULSE_MS);
    if (pulseStart >= 0 && now - pulseStart > PULSE_MS) pulseStart = -1;
    const back = depth === 'back' ? 0.82 : 1;
    const width = BODY * pulse * back;

    if (ctx) {
      ctx.clearRect(0, 0, o.width, o.height);
      ctx.globalAlpha = depth === 'back' ? 0.75 : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = len > 0 ? body(len) : [{ x, y }];
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      };
      // Thin light rim so the black body still reads over the dark page.
      path();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = width + 3;
      ctx.stroke();
      path();
      ctx.strokeStyle = '#111113';
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  const fly = (tx: number, ty: number) =>
    new Promise<void>((resolve) => {
      const sx = x;
      const sy = y;
      const dist = Math.hypot(tx - sx, ty - sy);
      if (dist < 1) {
        resolve();
        return;
      }
      const dur = Math.min(MAX_LEG_MS, Math.max(MIN_LEG_MS, dist / PX_PER_MS));
      // Control point off to one side of the chord gives a soft arc; sides alternate.
      curveSign = -curveSign;
      const mx = (sx + tx) / 2 + (-(ty - sy) / dist) * dist * 0.22 * curveSign;
      const my = (sy + ty) / 2 + ((tx - sx) / dist) * dist * 0.22 * curveSign;
      const start = performance.now();
      const step = (now: number) => {
        if (!alive) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / dur);
        const e = easeInOut(t);
        x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * tx;
        y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * ty;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  const click = async () => {
    // Settle back into a circle, then pulse.
    await sleep(160);
    pulseStart = performance.now();
    const ripple = document.createElement('span');
    ripple.className = 'scp-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    o.layer.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 700);
    await sleep(PULSE_MS * 0.5);
  };

  const loop = async () => {
    while (alive) {
      for (const step of o.steps) {
        if (!alive) return;
        setDepth(step.z ?? 'front');
        const [tx, ty] = targetOf(step);
        if (step.instant) {
          x = tx;
          y = ty;
          lastHead = { x, y };
          history.length = 0;
        } else {
          await fly(tx, ty);
        }
        if (!alive) return;
        if (step.action) {
          await click();
          await o.onAction(step.action);
        }
        if (step.pause) await sleep(step.pause);
      }
    }
  };
  void loop();

  return () => {
    alive = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', sizeCanvas);
  };
}
