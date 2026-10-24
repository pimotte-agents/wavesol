---
fragments: lists
title: TikZ
---

# TikZ and tikz-cd

- A ` ```tikzcd ` (or ` ```tikz `) fence in a slide becomes a figure, drawn by LaTeX at build time:

```tikzcd
A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
C \arrow[r, "k"'] & D
```

- Or a whole node: `type: tikz`, with the picture as the file's body.

::: notes
Figures use the talk's macros.tex, and take the theme's ink colour, so they also work on a dark theme.
:::
