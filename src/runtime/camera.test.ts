import { describe, expect, it } from "vitest";
import { directZoom, fitBox, panBy, smoothZoom, zoomAt, type View } from "./camera.ts";

const close = (a: View, b: View) => {
  expect(a.cx).toBeCloseTo(b.cx, 6);
  expect(a.cy).toBeCloseTo(b.cy, 6);
  expect(a.w).toBeCloseTo(b.w, 6);
};

describe("camera paths", () => {
  const a = { cx: 0, cy: 0, w: 1600 };
  const b = { cx: 8000, cy: 3000, w: 400 };

  for (const [name, path] of [["smoothZoom", smoothZoom], ["directZoom", directZoom]] as const) {
    it(`${name} starts and ends at the given views`, () => {
      const p = path(a, b);
      close(p.at(0), a);
      close(p.at(1), b);
      expect(p.duration).toBeGreaterThan(0);
    });
  }

  it("smoothZoom zooms out in the middle of a long pan", () => {
    expect(smoothZoom(a, b).at(0.5).w).toBeGreaterThan(a.w);
  });

  it("smoothZoom handles pure zooms", () => {
    const p = smoothZoom(a, { ...a, w: 100 });
    close(p.at(1), { ...a, w: 100 });
  });

  it("directZoom keeps the zoom anchor fixed on screen", () => {
    // zooming from a frame to a child in its corner: the anchor is where both views coincide
    const frame = { cx: 800, cy: 450, w: 1600 };
    const child = { cx: 200, cy: 112.5, w: 400 };
    const p = directZoom(frame, child);
    // anchor X satisfies (X - cx)/w equal for both views
    const ax = (frame.cx * child.w - child.cx * frame.w) / (child.w - frame.w);
    for (const t of [0.25, 0.5, 0.75]) {
      const v = p.at(t);
      expect((ax - v.cx) / v.w).toBeCloseTo((ax - frame.cx) / frame.w, 6);
    }
  });

  it("fitBox fits by the limiting dimension with margin", () => {
    expect(fitBox({ x: 0, y: 0, w: 1600, h: 900 }, 1600, 900, 0)).toEqual({ cx: 800, cy: 450, w: 1600 });
    expect(fitBox({ x: 0, y: 0, w: 900, h: 900 }, 1600, 900, 0).w).toBe(1600);
    expect(fitBox({ x: 0, y: 0, w: 1600, h: 900 }, 1600, 900, 0.1).w).toBeCloseTo(2000);
  });
});

describe("pan and zoom", () => {
  const v = { cx: 1000, cy: 500, w: 4000 };
  // world point under screen (px, py) for a 1600x900 viewport
  const under = (view: View, px: number, py: number) => [view.cx + ((px - 800) * view.w) / 1600, view.cy + ((py - 450) * view.w) / 1600];

  it("zoomAt keeps the point under the cursor fixed", () => {
    const z = zoomAt(v, 0.5, 300, 700, 1600, 900);
    expect(z.w).toBeCloseTo(2000);
    expect(under(z, 300, 700)[0]).toBeCloseTo(under(v, 300, 700)[0]!);
    expect(under(z, 300, 700)[1]).toBeCloseTo(under(v, 300, 700)[1]!);
  });

  it("panBy moves the world with the drag", () => {
    const p = panBy(v, 160, -90, 1600);
    expect(under(p, 960, 360)).toEqual(under(v, 800, 450));
  });
});
