// Camera state is (cx, cy, w): world-space center and visible width. Smooth zoom follows
// van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003), as in d3-interpolate.
export interface View {
  cx: number;
  cy: number;
  w: number;
}

const RHO = Math.SQRT2;
const RHO2 = 2;
const RHO4 = 4;

/** Returns the interpolator and its natural duration in ms (for speed factor 1). */
export function smoothZoom(a: View, b: View): { at: (t: number) => View; duration: number } {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) {
    const S = Math.log(b.w / a.w) / RHO;
    return {
      at: (t) => ({ cx: a.cx + t * dx, cy: a.cy + t * dy, w: a.w * Math.exp(RHO * t * S) }),
      duration: Math.abs(S) * 1000,
    };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (b.w * b.w - a.w * a.w + RHO4 * d2) / (2 * a.w * RHO2 * d1);
  const b1 = (b.w * b.w - a.w * a.w - RHO4 * d2) / (2 * b.w * RHO2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / RHO;
  const coshr0 = Math.cosh(r0);
  return {
    at: (t) => {
      const s = t * S;
      const u = (a.w / (RHO2 * d1)) * (coshr0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return { cx: a.cx + u * dx, cy: a.cy + u * dy, w: (a.w * coshr0) / Math.cosh(RHO * s + r0) };
    },
    duration: S * 1000,
  };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
