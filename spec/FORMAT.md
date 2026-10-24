# wavesol source format (v0)

A talk is a directory. The machine-readable schemas are generated from `src/model/schema.ts` into
`schema/` (`npm run schema`). This document is the human-readable spec. If the two disagree, the schema
wins and this document is a bug.

```
my-talk/
  talk.yaml          # required: metadata, graph, layout, theme, transitions
  nodes/             # one file per content node
    intro.md
    rev-rev.md
  lean/              # optional lake project for Lean nodes
  figures/           # optional assets referenced by nodes
  macros.tex         # optional LaTeX macros shared by all math
  refs.bib           # optional bibliography
```

All paths are relative to the talk directory unless stated otherwise.

## Node ids

Ids match `[a-z0-9][a-z0-9_-]*` and are unique across the whole talk, including inside frames. Edges may
connect any two nodes, also across frames.

## `talk.yaml`

```yaml
title: Fabrics of proofs           # required
subtitle: A wavesol demo
authors: [Jane Doe]
date: 2026-11-12
venue: Lean Together

start: intro                       # first node; defaults to the first key of `nodes`

theme:
  base: academic-light             # built-in theme: academic-light | academic-dark
  accent: "#2b6cb0"                # shorthand for the --ws-accent variable
  vars:                            # any CSS custom property, without the --ws- prefix
    font-body: "Source Serif 4"

transitions:
  default: fly                     # fly | cut | fade | zoom-through, or { type, duration, easing }

layout:
  algorithm: layered               # layered | force | grid | manual
  direction: right                 # right | down | left | up (layered only)
  spacing: 1                       # multiplier on the theme's default spacing
  wrap: true                       # layered: wrap long chains into rows (default)

math:
  macros: macros.tex               # default: macros.tex if it exists
bibliography: refs.bib             # default: refs.bib if it exists

nodes:
  intro: {}                        # content in nodes/intro.md
  background:
    type: frame                    # frames have no file
    title: Background
    children: [defs, examples]
    layout: { direction: down }
  defs: {}
  examples: { file: nodes/more/examples.md }
  rev-rev:
    pin: [1200, 0]                 # exact world position (top-left), overrides the layout
    scale: 0.5                     # node size relative to normal; frames do this for their children

edges:
  - intro -> background: { label: Background, default: true }
  - intro -> rev-rev: { label: "Skip to the proof" }
  - background -> rev-rev: { default: true, transition: zoom-through }
  - defs -> examples -> defs       # chains: one edge per arrow, options apply to each
  - examples -> rev-rev
```

### Node entries

The key is the node id. The value has these fields, all optional:

| Field | Meaning |
|---|---|
| `type` | Node plugin. Defaults to the frontmatter `type`, else from the file extension (`.md` → `slide`). |
| `file` | Content file. Defaults to `nodes/<id>.md`. Not allowed for `frame`. |
| `title` | Display title (edge buttons, overview, presenter view). Defaults to the frontmatter title, else the first heading, else the id. |
| `children` | `frame` only: ids of the nodes inside it. A node has at most one parent frame. |
| `layout` | `frame` only: layout settings for the frame's children, same shape as the top-level `layout`. |
| `pin` | `[x, y]` position of the top-left corner in the layout space of the node's level. At the top level that is world units. Inside a frame it is the frame's own layout space, which is then scaled to fit the frame. |
| `size` | `[w, h]` in world units. Defaults to the theme's slide size (1600×900). |
| `scale` | Uniform scale of the node on the canvas (default 1). |
| `near` | Layout hint: `{ left-of \| right-of \| above \| below: <id> }`. |
| `transition` | Default transition for edges *into* this node. |

Plugin-specific fields go in the node file's frontmatter. They may also be given in `talk.yaml`, but
defining the same field in both places is an error.

### Edges

`edges` is a list. Each item is either a string `"a -> b"` or a single-key map
`"a -> b": { options }`. Chains `a -> b -> c` create one edge per arrow, all with the same options.

| Option | Meaning |
|---|---|
| `label` | Text on the phone/presenter button. Defaults to the target's title. |
| `default` | `true` marks the edge followed by `step` once the source node has no steps left. At most one default per source node. |
| `transition` | Transition for this edge. Overrides the target node's and the global default. |

Edges are directed. To go both ways, write two edges (or a chain `a -> b -> a`). The history "back"
action is separate and does not need edges.

The order of edges in the file is the order of the buttons: the first outgoing edge of a node is button
1, and so on.

### Transitions

Either a name or `{ type, duration, easing }`:

- `fly` (default): smooth zoom, i.e. zoom out, pan, zoom in. Duration scales with distance unless
  `duration` (ms) is given.
- `zoom-through`: zoom straight into or out of the target (good for frame ↔ child).
- `fade`: cross-fade at the target camera position.
- `cut`: instant.

`easing` is a CSS easing keyword or `cubic-bezier(...)`.

Precedence: edge `transition` > target node `transition` > `transitions.default`.

## Node files

A node file is Markdown with a YAML frontmatter block. Fields common to all plugins:

```markdown
---
type: slide          # optional for .md files
title: Introduction  # optional; see node entries
notes: |             # speaker notes (Markdown); alternatively a ::: notes block
  Mention the poll.
---
```

### `slide`

The body is Markdown (CommonMark + GFM tables) with:

- **Math:** `$...$` and `$$...$$`, rendered by KaTeX at build time, with the macros from `macros.tex`
  (`\newcommand` / `\renewcommand` / `\DeclareMathOperator`).
- **Code:** fenced blocks highlighted at build time (` ```lean ` uses the Lean grammar; it is
  highlighting only, not elaborated).
- **Fragments (gradual reveal):** an attribute block `{.fragment}` at the end of a paragraph, list item
  or heading, or a `::: fragment` block around any content (use the block for display math, code and
  images). A fragment comes one step after the previous fragment; `{.fragment step=2}` or
  `::: fragment step=2` puts it in step 2 explicitly, and fragments with the same step appear together. Optional effect:
  `.fade-up`, `.highlight` or `.fade-out` (default: fade in), e.g. `{.fragment .fade-up}` or
  `::: fragment fade-up`.
- **Frontmatter `fragments: lists`:** every top-level list item becomes a fragment.
- **Blocks:** `::: notes` (speaker notes, removed from the slide) and columns. For columns the outer
  fence needs more colons than the inner ones:

  ```markdown
  :::: columns
  ::: column
  Left
  :::
  ::: column
  Right
  :::
  ::::
  ```
- **Citations:** `[@key]` or `[@key, p. 3]` from the bibliography (Phase 5).
- **Images:** standard Markdown images, paths relative to the node file.

Step count = number of distinct fragment steps.

### `frame`

Defined in `talk.yaml` only (no file). It renders its title and draws its children inside its content
box. Visiting a frame shows it whole. It has 0 steps.

### `image`

```markdown
---
type: image
src: ../figures/diagram.svg
caption: The fabric of the proof.   # optional, Markdown
fit: contain                        # contain | cover
---
```

### `lean` (Phase 4)

```markdown
---
type: lean
source: Demo/Basic.lean        # relative to lean/
anchor: revRev                 # an ANCHOR region; or `decl: rev_rev`
steps: tactics                 # tactics | none | [state names from PROOF_STATE comments]
infoview: right                # right | below
---
Optional Markdown caption shown above the code.
```

Exploration (click a tactic to see its goals, hover a token to see its signature) is always available.
`steps` sets what `step` walks through.

## Validation

`wavesol check` reports, with `file:line`:

- schema violations in `talk.yaml` and in frontmatter (per plugin)
- unknown node types, missing node files, files in `nodes/` that no node uses (warning)
- edges to unknown nodes, more than one `default` edge per node
- a node in two frames, frame cycles, `children` on a non-frame
- fields defined in both `talk.yaml` and frontmatter
- unreachable nodes from `start` (warning)
- plugin build checks (e.g. Lean anchor not found)
