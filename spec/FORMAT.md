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

All paths are relative to the talk directory unless stated otherwise. Sections marked *(planned)*
describe syntax that is reserved but not implemented yet.

Editors get autocompletion and validation for `talk.yaml` from the JSON Schema: start the file with
`$schema: ./node_modules/wavesol/schema/talk.schema.json` (the talk template does this).

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
  algorithm: layered               # layered | force | grid | manual (manual: only pins; unpinned nodes go on a grid)
                                   # force: for web-like talks; few edge crossings, filled to 16:9 (levels that are only chains use layered)
  direction: right                 # right | down | left | up (layered only)
  spacing: 1                       # multiplier on the default gap between nodes
  wrap: true                       # layered: wrap long chains into rows (default)

math:
  macros: macros.tex               # default: macros.tex if it exists
bibliography: refs.bib             # BibTeX for [@key] citations; default: refs.bib if it exists
tikz:                              # LaTeX setup for all TikZ pictures; all optional
  packages: [xcolor]
  libraries: [arrows.meta, positioning]
  preamble: \definecolor{accent}{HTML}{2B6CB0}

sync:                              # phone controller; all optional
  phone: true                      # false: no phone control, no relay is ever contacted
  relays:                          # replaces the built-in public relays (see Phone controller)
    - "room:wss://wavesol-relay.example.workers.dev"
  ice:                             # extra WebRTC servers, e.g. TURN; added to the default STUN
    - { urls: "turn:turn.example.com:443", username: "u", credential: "p" }

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
| `title` | Display title (edge buttons, overview title cards, presenter view). Defaults to the frontmatter title, else the slide's first `#` heading, else the id. |
| `children` | `frame` only: ids of the nodes inside it. A node has at most one parent frame. |
| `layout` | `frame` only: layout settings for the frame's children, same shape as the top-level `layout`. |
| `pin` | `[x, y]` position of the top-left corner in the layout space of the node's level. At the top level that is world units. Inside a frame it is the frame's own layout space, which is then scaled to fit the frame. **Drag mode** in `wavesol dev` (key `d`) writes pins: drag a node (a frame takes its children along) and its entry in `talk.yaml` gets `pin`, the rest of the file unchanged; a `near` hint on it is removed. Inside a frame the node keeps its place relative to its siblings, and the frame then re-fits its content. |
| `size` | `[w, h]`: the size the node's content is laid out at, default 1600×900 (16:9). Frames default to 1600×900 × 0.75·√children, between 1× and 2× (4 children: 1.5×). |
| `scale` | Uniform scale of the node on the canvas (default 1); the node takes `size × scale` space. |
| `near` | `{ left-of \| right-of \| above \| below: <id> }`: place the node right next to another node of the same level, overriding the layout. |
| `transition` | Default transition for edges *into* this node. |

Plugin-specific fields go in the node file's frontmatter. They may also be given in `talk.yaml`, but
defining the same field in both places is an error.

### Edges

`edges` is a list. Each item is either a string `"a -> b"` or a single-key map
`"a -> b": { options }`. Chains `a -> b -> c` create one edge per arrow, all with the same options.

| Option | Meaning |
|---|---|
| `label` | Text on the edge's button (edges panel, presenter view, phone). Defaults to the target's title. |
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

### Phone controller

Press `c` on the projector (or "Connect a phone" in the presenter view) and scan the QR code. The
phone gets a Next button, Prev and Back, one button per outgoing edge and a laser pointer pad. In a Lean
node with `steps: tactics`, resting the dot on a tactic (100 ms) selects it, and the step moves there
(see `lean`).

- **Pairing:** the QR code holds the talk's URL with `?phone#k=<room secret>`. The secret is random
  per projector tab (kept across a reload of that tab) and sits in the URL fragment, which browsers
  never send to a server.
- **Encryption:** every message through a relay is sealed (AES-256-GCM) with a key derived from the
  secret; relays see ciphertext and a hashed room name. Messages that do not open with the key are
  ignored, so only phones that scanned the code can control the talk.
- **Connection:** messages go through the relays at once; meanwhile the phone sets up a direct WebRTC
  connection to the projector, and once it is up messages go direct. If it drops (or never forms, e.g.
  on networks that block UDP) the relay carries on.
- **Relays:** on a static host (e.g. GitHub Pages), public relays on two independent networks: MQTT
  brokers and Nostr relays. `sync.relays` replaces them; each entry is `mqtt:`, `nostr:` or `room:`
  followed by a `ws(s)://` URL. `room:` is the self-hosted relay in `relay-worker/` (a Cloudflare
  Worker, deploy guide in its README). Under `wavesol serve --host` (or `dev`) the laptop itself is
  the relay: no internet needed, e.g. with the laptop on the phone's hotspot. The projector contacts
  no relay until pairing is started.
- **TURN** (`sync.ice`) is optional: it only makes the direct connection work on more networks, and
  the relay covers the rest. A free tier exists at e.g. Metered (metered.ca, "Open Relay"); note that
  credentials in `talk.yaml` are public once the talk is deployed.

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
  `::: fragment step=2` puts it in step 2 explicitly, and fragments with the same step appear
  together. Optional effect: `.fade-up`, `.highlight` or `.fade-out` (default: fade in), e.g.
  `{.fragment .fade-up}` or `::: fragment fade-up`.
- **Frontmatter `fragments: lists`:** every top-level list item becomes a fragment.
- **Blocks:** `::: notes` (speaker notes, removed from the slide and shown in the presenter view) and columns. For columns the outer
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
- **TikZ:** a ` ```tikzcd ` fence holds a tikz-cd diagram, a ` ```tikz ` fence TikZ commands (either may
  also contain the whole `tikzpicture`/`tikzcd` environment). LaTeX draws them at build time
  (`pdflatex`, then `pdftocairo` to SVG; cached in `.wavesol/cache/`), with `macros.tex` and the talk's
  `tikz` setup. 10pt in TikZ is the size of the slide's text, and black is drawn in the theme's ink.
  LaTeX errors are reported at their line.
- **Citations:** `[@key]`, `[@key, p. 3]` (also `pp.`, `chap.`, `sec.`, `fig.`, `eq.`, `vol.`; other
  text is appended as is) and `[@a; @b]`, from the bibliography, in author–year style:
  (Knuth, 1984, p. 3). Hovering shows the full reference; clicking flies to the talk's `references`
  node (if it has one) with the cited works highlighted, and Back returns.
- **Images:** standard Markdown images, paths relative to the node file.

Step count = number of distinct fragment steps.

### `frame`

Defined in `talk.yaml` only (no file). It renders its title and draws its children inside its content
box. Visiting a frame shows it whole. It has 0 steps.

A frame has an edge to every node inside it, so from the frame you can go straight to any child (edge
buttons, `1`–`9`, the phone). These come after the frame's own edges in `children` order, use
`zoom-through` unless the child sets a transition, are not drawn, and are never the default edge.
List an edge explicitly to give it a label, a position or `default: true`.

### `tikz`

A TikZ picture filling the node: the file's body is the picture (TikZ commands, or a whole
`tikzpicture` / `tikzcd` environment).

```markdown
---
type: tikz
caption: "The square commutes."   # optional, Markdown
libraries: [arrows.meta]          # optional: added to the talk's tikz setup, as are
packages: [xcolor]                #   packages and preamble
---
\begin{tikzcd} A \arrow[r] & B \end{tikzcd}
```

### `poll`

A question the audience answers from their phones. The body is the question (Markdown):

```markdown
---
type: poll
options:                          # 2–9 answers (Markdown)
  - Induction
  - Contradiction
  - "Something else: tell me after"
results: reveal                   # reveal (default): Space shows the results | live: shown from the start
---
# Which proof technique do you use most?
```

The slide shows the options (A, B, …), the number of votes, a join QR code in the corner and, once
revealed, a bar per option. Audience phones join with the QR code (or with `j`, which shows it
full-size) and see the poll while it is on screen: one vote per phone, and tapping another answer moves
it. Phones show only their own vote; the presenter view always shows the results. Votes survive a
reload of the projector tab.

The audience has its own room, separate from the phone controller's: its code is public, so in that
room the projector only accepts votes for the poll on screen. It uses the same relays and direct
connections as the phone controller (see Phone controller), and contacts them only when a poll is
shown or `j` is pressed.

### `references`

Defined in `talk.yaml` only (no file): `refs: { type: references, title: References }`. Lists every
work cited anywhere in the talk, in the bibliography's style. `check` warns when a talk cites works but
has no references node.

### `image`

```markdown
---
type: image
src: ../figures/diagram.svg
caption: "The fabric of the proof."  # optional, Markdown; quote it if it contains ": "
fit: contain                        # contain | cover
---
```

Set `title` too: without it, the overview and edge buttons show the node id.

### `lean`

A declaration or region of a module in the talk's `lean/` project, highlighted by Lean itself, with
hovers (signatures, docstrings) and the proof's goal states:

```markdown
---
type: lean
source: Proofs/Lists.lean      # relative to lean/
anchor: revRev                 # a region between "-- ANCHOR: revRev" and "-- ANCHOR_END: revRev"
                               # or: decl: reverse_reverse (a declaration; a short name is enough)
steps: tactics                 # tactics (default) | none | [names of "-- ^ PROOF_STATE: name" comments]
infoview: right                # right (default) | below
---
Optional Markdown caption shown above the code.
```

- **Exploring** is always possible: click a tactic to see its goals before and after it, hover a name
  for its type and docstring.
- **Steps:** with `tactics`, each step highlights the next tactic and shows its goals, in source order;
  a tactic with parts (e.g. `rw [a, b]`) steps through the parts, and case arms and bullets show the
  goal they focus on. Step 0 shows the starting goal. With a list of names, step *k* shows the state at
  the *k*-th named `-- ^ PROOF_STATE:` comment (the state after the tactic before it).
- **Laser** (phone controller): with `steps: tactics`, the dot resting on a tactic for 100 ms selects
  the innermost tactic under it and makes it the current step, so Space continues after it. A tactic
  that is not a step itself (the `rw` around its rules) is shown with its own goals, and Space goes on
  to its first part; `by` is the start. Sweeping across selects nothing; the selection stays until the
  next step. The presenter view shows the same. With `none` or named steps the laser selects nothing.
- Marker comments (`ANCHOR`, `ANCHOR_END`, `PROOF_STATE`) are not shown, and the code is dedented.

**The `lean/` project** is an ordinary lake project that requires SubVerso, which extracts the
highlighting and goals:

```lean
-- lean/lakefile.lean
import Lake
open Lake DSL

require subverso from git "https://github.com/leanprover/subverso.git" @ "verso-v4.35.0"

package proofs

@[default_target]
lean_lib Proofs
```

`wavesol build`, `dev` and `check` run `lake build +<Module>:highlighted` in `lean/` (so they need
elan), and only when the Lean sources changed. Lean's errors are reported at their place in the `.lean`
file. Mathlib works as in any project: require it, and run `lake exe cache get` once (the talk
template's Pages workflow does this). wavesol is tested with SubVerso `verso-v4.35.0` and Lean v4.35.0.

## Validation

`wavesol check` reports problems as `file:line:col: error|warning: message`:

- YAML syntax errors and schema violations in `talk.yaml` and in frontmatter (per node type), including
  unknown fields
- unknown node types, missing node files, files in `nodes/` that no node uses (warning)
- edges to unknown nodes, more than one `default` edge per node, an unknown `start`
- a node in two frames, frame cycles, `children` or `layout` on a non-frame, a `file` on a frame
- fields defined in both `talk.yaml` and frontmatter
- nodes that cannot be reached from `start` along edges (warning)
- content errors from the node builds: invalid math, broken `macros.tex` definitions, missing images,
  unknown code-block languages (warning)

`wavesol build` refuses to build a talk with errors; `wavesol dev` shows them in the browser.
