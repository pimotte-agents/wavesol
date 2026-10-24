// Camera: a view is (cx, cy, w) = world-space center and visible width. Transitions animate between
// views; `fly` follows van Wijk & Nuij's smooth zoom (validated in spikes/camera).
import type { TransitionSpec } from "../model/compiled.ts";

export interface View {
  cx: number;
  cy: number;
  w: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fitBox(b: Box, vw: number, vh: number, margin: number): View {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: Math.max(b.w, (b.h * vw) / vh) / (1 - 2 * margin) };
}

/** Scales the visible width by `factor`, keeping the world point under screen position (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number, vw: number, vh: number): View {
  const w = v.w * factor;
  return { cx: v.cx + ((px - vw / 2) * (v.w - w)) / vw, cy: v.cy + ((py - vh / 2) * (v.w - w)) / vw, w };
}

/** Moves the view so the world follows a screen-space drag of (dx, dy) pixels. */
export function panBy(v: View, dx: number, dy: number, vw: number): View {
  return { cx: v.cx - (dx * v.w) / vw, cy: v.cy - (dy * v.w) / vw, w: v.w };
}

type Path = { at: (t: number) => View; duration: number };

const RHO = Math.SQRT2;

export function smoothZoom(a: View, b: View): Path {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-12 * a.w * a.w) {
    const S = Math.log(b.w / a.w) / RHO;
    return { at: (t) => ({ cx: a.cx + t * dx, cy: a.cy + t * dy, w: a.w * Math.exp(RHO * t * S) }), duration: Math.abs(S) * 1000 };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (b.w * b.w - a.w * a.w + 4 * d2) / (2 * a.w * 2 * d1);
  const b1 = (b.w * b.w - a.w * a.w - 4 * d2) / (2 * b.w * 2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / RHO;
  const coshr0 = Math.cosh(r0);
  return {
    at: (t) => {
      const s = t * S;
      const u = (a.w / (2 * d1)) * (coshr0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return { cx: a.cx + u * dx, cy: a.cy + u * dy, w: (a.w * coshr0) / Math.cosh(RHO * s + r0) };
    },
    duration: S * 1000,
  };
}

/** Straight zoom: the width changes geometrically and the point that stays fixed on screen is the zoom anchor. */
export function directZoom(a: View, b: View): Path {
  const ratio = b.w / a.w;
  const same = Math.abs(1 - ratio) < 1e-6;
  return {
    at: (t) => {
      const w = a.w * ratio ** t;
      const u = same ? t : (a.w - w) / (a.w - b.w);
      return { cx: a.cx + u * (b.cx - a.cx), cy: a.cy + u * (b.cy - a.cy), w };
    },
    duration: 900,
  };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (bez(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return bez(y1, y2, (lo + hi) / 2);
  };
}

const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  "ease-in": cubicBezier(0.42, 0, 1, 1),
  "ease-out": cubicBezier(0, 0, 0.58, 1),
  "ease-in-out": easeInOut,
};

function easing(name?: string): (t: number) => number {
  if (!name) return easeInOut;
  const m = name.match(/^cubic-bezier\(([^)]+)\)$/);
  if (m) {
    const [a, b, c, d] = m[1]!.split(",").map(Number);
    if ([a, b, c, d].every((v) => Number.isFinite(v))) return cubicBezier(a!, b!, c!, d!);
  }
  return EASINGS[name] ?? easeInOut;
}

export interface AnimatorHooks {
  apply(v: View): void;
  setOpacity(o: number): void;
  moving(on: boolean): void;
}

/** Runs one camera transition at a time; starting a new one cancels the running one. */
export class Animator {
  private token = 0;
  constructor(private hooks: AnimatorHooks) {}

  run(from: View, to: View, spec: TransitionSpec, speed = 1): Promise<void> {
    const token = ++this.token;
    const s = typeof spec === "string" ? { type: spec } : spec;
    const ease = easing("easing" in s ? s.easing : undefined);
    const explicit = "duration" in s ? s.duration : undefined;
    this.hooks.setOpacity(1);

    if (s.type === "cut" || speed === 0) {
      this.hooks.apply(to);
      return Promise.resolve();
    }
    if (s.type === "fade") {
      const half = (explicit ?? 600) / 2 / speed;
      return this.frames(token, half, (t) => this.hooks.setOpacity(1 - ease(t)))
        .then((ok) => {
          if (ok) this.hooks.apply(to);
          return ok && this.frames(token, half, (t) => this.hooks.setOpacity(ease(t)));
        })
        .then(() => undefined);
    }
    const path = s.type === "zoom-through" ? directZoom(from, to) : smoothZoom(from, to);
    const natural = s.type === "fly" ? Math.min(2500, Math.max(400, path.duration / 1.2)) : path.duration;
    const duration = (explicit ?? natural) / speed;
    this.hooks.moving(true);
    return this.frames(token, duration, (t) => this.hooks.apply(t >= 1 ? to : path.at(ease(t)))).then((ok) => {
      if (ok) this.hooks.moving(false);
    });
  }

  /** Cancels the running transition, leaving the view where it is. */
  stop(): void {
    this.token++;
    this.hooks.setOpacity(1);
    this.hooks.moving(false);
  }

  private frames(token: number, duration: number, step: (t: number) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (token !== this.token) return resolve(false);
        const t = duration <= 0 ? 1 : Math.min(1, (now - t0) / duration);
        step(t);
        if (t < 1) requestAnimationFrame(tick);
        else resolve(true);
      };
      requestAnimationFrame(tick);
    });
  }
}
