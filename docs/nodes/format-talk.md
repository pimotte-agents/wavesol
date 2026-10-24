# talk.yaml

```yaml
title: Fabrics of proofs
subtitle: A wavesol demo
theme: { base: academic-light }
transitions: { default: fly }
nodes:
  intro: {}            # content in nodes/intro.md
  proof: { scale: 0.5, near: { right-of: intro } }
edges:
  - intro -> proof: { default: true }
```

::: notes
An empty node entry {} just points at nodes/<id>.md; the rest are layout and display options.
:::
