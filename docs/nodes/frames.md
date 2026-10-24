# Frames

Frames are regions of the fabric, defined in `talk.yaml` (no file):

```yaml
background:
  type: frame
  title: Background
  children: [defs, examples]
  layout: { direction: down }
```

- Children are drawn **smaller**, inside the frame's box.
- Visiting a frame shows it whole; `zoom-through` transitions fit well.
- A node has at most one parent frame; edges may cross frames.

::: notes
This talk uses frames for "Getting around", "Writing a talk" and "Node types".
:::
