# talk.yaml

```yaml
title: Fabrics of proofs
subtitle: A wavesol demo
theme: { base: academic-light }
transitions: { default: fly }
head: ../analytics.html  # added to the built page's <head>
nodes:
  intro: {}            # content in nodes/intro.md
  proof: { scale: 0.5, near: { right-of: intro } }
edges:
  - intro -> proof: { default: true }
```

::: notes
An empty node entry {} just points at nodes/<id>.md; the rest are layout and display options.

`head` is HTML (e.g. an analytics script) that `wavesol build` adds to the page; `wavesol dev` leaves it out, so previews aren't counted.
:::
