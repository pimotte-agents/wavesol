---
fragments: lists
title: Transitions
---

# Transitions

- **fly** (default): zoom out, pan, zoom in; duration scales with distance.
- **pan**: straight across, without zooming out.
- **zoom-through**: straight into or out of the target — good for frame ↔ child.
- **fade**: cross-fade at the target camera position.
- **cut**: instant.
- `transitions.local`: used instead of the default between nearby slides, e.g. `local: pan`.
- Precedence: edge `transition` > node `transition` > `transitions.local` > `transitions.default`.

::: notes
Any transition can also be given as { type, duration, easing } with a CSS easing curve.
:::
