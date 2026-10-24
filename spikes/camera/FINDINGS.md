# Camera spike — findings

Setup: `npm run dev:camera` (keys: `n`/`p` next/prev, `o` overview, `f` parent frame, `m` render mode,
`l` LOD). A fabric of 76 nodes (or 304 with `?copies=4`) with frames nested 3 levels deep. Each child
level is drawn at 1/4 size, so a depth-3 slide sits at 1/64 scale. Slides contain KaTeX, SVG and 20px
text. Nodes are absolutely positioned in one flat container; frames are a layout concept, not DOM
nesting. Camera = (center, visible width), with van Wijk–Nuij smooth zoom for `fly`.

Measurements: `npm run test:e2e` (`tests/e2e/camera.spec.ts`) writes `test-results/camera-spike.json`.

Result: **green**, with one item left to check on real hardware (see below).

## Sharpness at rest
A node flown to with margin 0 was compared pixel by pixel to the same node rendered at native size
without any transform:

| Mode | depth 0 | depth 1–3 |
|---|---|---|
| world-toggle (`will-change` only while flying) | identical | identical |
| world-never | identical | identical |
| per-node transforms | identical | identical |
| world-always (`will-change` permanently on) | identical | **blurry** (mean diff 6–9, ~5% of pixels off) |

So the DOM + CSS transform approach renders nested nodes exactly like native rendering once the camera
settles, *provided* `will-change` is removed at rest. Deep nesting (1/64 scale × 64 zoom) causes no
precision problems.

## Main-thread cost while flying
Headless Chromium paces rAF at 60 Hz regardless of load, so frame times were measured as main-thread
time per frame through CDP (style + layout + script + paint recording):

| Nodes | per frame (all modes) |
|---|---|
| 76 | 0.6–1.2 ms |
| 304 | 1.9–4.1 ms |

All far below the 16.7 ms budget. LOD class toggling adds style/layout work (~1 ms at 304 nodes) but
skips painting content for tiny and off-screen nodes. Per-node transforms are the most expensive mode.

**Not measured:** GPU rasterization and compositing, which is where a zoom animation actually gets
expensive (during a fly the world layer is scaled as a bitmap and re-rastered on settle). That needs a
check on real hardware, in particular an average laptop driving a 4K projector: run `npm run
dev:camera`, fly around with `n`/`o` and look for stutter or blank tiles during flights, with LOD on and
off.

## Decisions
- **Rendering:** one world container with a CSS transform. `will-change: transform` is set at the start
  of a camera move and removed when it settles (`world-toggle`). Per-node transforms bring no benefit.
- **Frames:** flat DOM with world coordinates computed from the frame tree, rather than nested DOM.
  This keeps LOD, hit testing and z-order simple.
- **LOD:** keep it. Nodes outside the viewport get `visibility: hidden`, and slides narrower than
  ~160 px on screen show a title card instead of their content. Plugins get this as
  `setDetail("overview" | "near" | "active")`. Revisit the threshold after the hardware check.
- **Transitions:** smooth zoom works well for frame ↔ child moves (it degenerates to a pure zoom) and for
  long pans. Duration = natural path length / 1.2, clamped to 0.4–2.5 s.
