# A talk is a directory

```
my-talk/
  talk.yaml      # required: metadata, graph, layout, theme
  nodes/         # one file per content node
    intro.md
  figures/       # assets referenced by nodes
  macros.tex     # LaTeX macros shared by all math
```

- `talk.yaml` is the only required file; everything else is optional.
- All paths are relative to the talk directory.

::: notes
Planned extras: a lean/ lake project for Lean nodes and refs.bib for citations.
:::
