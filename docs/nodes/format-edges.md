# Edges

```yaml
edges:
  - a -> b                             # plain string
  - a -> c: { label: "Skip to the proof" }
  - a -> d: { default: true, transition: zoom-through }
  - defs -> examples -> defs           # chains: one edge per arrow
```

- Edges are **directed**; for both ways, write two edges.
- File order = button order; at most one `default` edge per node.

::: notes
The default edge is where Space takes you once the node has no more fragments.
:::
