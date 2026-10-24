---
fragments: lists
title: Transitions
---

# Transitions

- **fly** (default): zoom out, pan, zoom in; duration scales with distance.
- **zoom-through**: straight into or out of the target — good for frame ↔ child.
- **fade**: cross-fade at the target camera position.
- **cut**: instant.
- Precedence: edge `transition` > node `transition` > `transitions.default`.

::: notes
Any transition can also be given as { type, duration, easing } with a CSS easing curve.
:::
