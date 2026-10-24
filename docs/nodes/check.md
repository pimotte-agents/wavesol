---
fragments: lists
title: wavesol check
---

# `wavesol check`

Validates the talk and prints errors as `file:line:col`:

- schema violations in `talk.yaml` and in frontmatter
- unknown node types, missing files, unused files (warning)
- edges to unknown nodes, more than one `default` edge per node
- frame mistakes and unreachable nodes (warning)

```
talk.yaml:14:5: error: "a" already has a default edge (edges item 1)
```

::: notes
It also runs plugin build checks, for example a Lean anchor that was not found.
:::
