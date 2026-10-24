---
fragments: lists
title: Theming
---

# Theming

- `theme.base`: `academic-light` (default) or `academic-dark`; code, Lean and TikZ follow it.
- `accent`: shorthand for the accent color variable.
- `vars`: any CSS custom property, **without** the `--ws-` prefix:

::: fragment
```yaml
theme:
  base: academic-light
  accent: "#2b6cb0"
  vars: { font-body: "Source Serif 4" }
```
:::

::: notes
vars entries become CSS custom properties on the talk, so you can override any theme detail.
:::
