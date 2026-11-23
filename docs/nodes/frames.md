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
- `preview: titles` shows the children as title cards, except the current one: a frame as a diagram.
- Visiting a frame shows it whole; `zoom-through` transitions fit well.
- From a frame, every node inside it is an edge: press its number, or click any node in it (also in a nested frame), to go in.
- **↑** goes up from a node to the frame it is in (Back returns).
- A node has at most one parent frame; edges may cross frames.

::: notes
Each topic of these docs is a frame; the Topics slide links to them all.
:::
