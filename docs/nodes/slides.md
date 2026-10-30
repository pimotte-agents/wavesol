---
fragments: lists
title: Slide nodes
---

# Slide nodes

Slides are CommonMark + GFM, with:

- **Math** — `$x^2$` and `$$...$$`, rendered by KaTeX at build time
- **Code** — fenced blocks highlighted at build time
- **Links to other slides** — `[text](#node-id)`, like [this one to citations](#citations)
- **QR codes** — a ` ```qr ` block with a URL, shown as the code with the link below; ` ```qr {size=9em} ` for another size
- **Images**, speaker notes, and columns:

:::: columns
::: column
**Left column**

Markdown here.
:::
::: column
**Right column**

And here.
:::
::::

::: notes
Columns are a ::: columns block with ::: column children; the outer fence uses four colons.
:::
