---
fragments: lists
title: Layout
---

# Automatic layout

- `algorithm`: `layered` (default), `force`, `grid` or `manual`.
- `direction`: `right | down | left | up` — the flow, for layered.
- **`pin: [x, y]`** fixes a node's exact position; overrides the layout.
- **`near: { right-of: intro }`** places a node right next to another one.
- **`scale`** and **`size: [w, h]`** control how big a node is drawn.

::: notes
Inside a frame, pin and near work in the frame's own layout space, which is then scaled to fit the frame.
:::
