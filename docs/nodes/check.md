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

::: fragment
```yaml
title: Example
nodes: { a: {}, b: {}, c: {} }
edges:
  - a -> b: { default: true }
  - a -> c: { default: true }    # a second default edge from a
```

```console
$ npx wavesol check
talk.yaml:5:5: error: "a" already has a default edge (edges item 1)
```
:::

::: notes
The position points at the second default edge. Errors stop `wavesol build`; warnings don't.
:::
