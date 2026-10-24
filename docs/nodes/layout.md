---
fragments: lists
title: Layout
---

# Automatic layout

- `algorithm`: `layered` (default) for talks with a main line, `force` for web-like talks, `grid` or `manual`.
- `direction`: `right | down | left | up` — the flow, for layered.
- Long chains wrap into rows, so the overview stays compact (`wrap: false` turns it off).
- **`pin: [x, y]`** fixes a node's exact position; overrides the layout.
- **`near: { right-of: intro }`** places a node right next to another one.
- **`scale`** and **`size: [w, h]`** control how big a node is drawn.

::: notes
Force keeps edge crossings low and fills the 16:9 screen; levels that are just chains still get layered rows.
Frames are drawn larger than a slide by default (up to 2×, growing with their children).
Inside a frame, pin and near work in the frame's own layout space, which is then scaled to fit the frame.
:::
