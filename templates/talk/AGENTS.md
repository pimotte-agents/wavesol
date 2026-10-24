# Guide for editing this talk (wavesol)

## What this is

A wavesol talk is a **graph of nodes** on one canvas: each node is a slide (a Markdown file in
`nodes/`), an image, or a frame (a group drawn around its children); directed **edges** connect the
nodes and are shown as buttons. The audience follows the *default* edges with Space; other edges are
labeled detours. Lean nodes (interactive proofs) and bibliography citations are planned but not
available yet — do not use `type: lean` or `[@key]`.

Commands (run from this talk directory):

- `npm run check` — validate the talk. **Run it after EVERY change** and fix all errors *and*
  warnings. Output is `file:line:col`.
- `npm run dev` — live preview in the browser.
- `npm run build` — production build.

## Workflow for agents

1. **Plan the graph first.** Sketch the main line: a chain of nodes connected by `default: true`
   edges from `start`, plus detour edges (labeled, non-default) to side content that loops back or
   merges into the main line. Group related slides into frames if they form a section.
2. **Write the node files** in `nodes/` (one Markdown file per slide), then declare everything in
   `talk.yaml`: metadata, `nodes`, `edges`.
3. **Run `npm run check` until clean** — no errors, no warnings. Re-run after each change.

## `talk.yaml` reference

Top-level keys:

- `title` (required), `subtitle`, `authors`, `date`, `venue`
- `start`: first node id; defaults to the first key of `nodes`.
- `theme`: `{ base: academic-light, accent: "#hex", vars: { ... } }` — `vars` are CSS custom
  properties without the `--ws-` prefix. (A dark theme is planned.)
- `transitions.default`: `fly` (default) | `cut` | `fade` | `zoom-through`, or
  `{ type, duration, easing }`.
- `layout`: `{ algorithm: layered | force | grid | manual, direction: right | down | left | up,
  spacing: <number>, wrap: <bool> }`. Use `layered` (default) for a talk with a main line and detours,
  `force` for a web of topics without one main path. Layered layouts wrap long chains into rows unless
  `wrap: false`; `direction` applies to layered only.
- `math.macros`: path to a LaTeX macros file (default `macros.tex` if it exists).
- `sync` (optional, phone controller): `{ phone: <bool>, relays: ["mqtt:wss://…" | "nostr:wss://…" |
  "room:wss://…"], ice: [{ urls, username, credential }] }`. Leave it out unless asked: the defaults
  (public relays, STUN) work.
- `nodes`: map of node id → entry. The key is the id; the value may be `{}` (content then comes from
  `nodes/<id>.md`). Entry fields (all optional):
  - `type` — defaults to frontmatter `type`, else the file extension (`.md` → `slide`)
  - `file` — content file, default `nodes/<id>.md`; **not allowed for frames**
  - `title` — display title; defaults to frontmatter title, first heading, then id
  - `children` — frame only: ids of the nodes inside it (a node has at most one parent frame)
  - `layout` — frame only: layout for its children (same shape as top-level `layout`)
  - `pin: [x, y]` — exact position, overrides the layout; `size: [w, h]` (default 1600×900; frames
    default to 1×–2× that, growing with their children); `scale: <number>`
  - `near`: `{ left-of | right-of | above | below: <id> }` layout hint
  - `transition` — default transition for edges *into* this node
- `edges`: list of `"a -> b"`, `"a -> b": { options }`, or chains `a -> b -> c` (one edge per arrow,
  same options on each). Options: `label` (button text; defaults to target title), `default: true`
  (followed by Space when the node has no steps left; **at most one per node**), `transition`. Edge
  order in the file = button order. Edges are directed; write two edges for both ways.

Node ids match `[a-z0-9][a-z0-9_-]*` and are unique across the talk, including inside frames. Edges
may connect any two nodes, also across frames. Plugin-specific fields (e.g. `src`, `caption`) go in
the node file's frontmatter — a field may be set in `talk.yaml` **or** frontmatter, not both.

Complete example:

```yaml
title: Fabrics of proofs
subtitle: A wavesol demo
authors: [Jane Doe]
start: intro

transitions:
  default: fly

nodes:
  intro: {}
  background:
    type: frame                    # frames have no file
    title: Background
    children: [defs, examples]
    layout: { direction: down }
  defs: {}
  examples: {}
  proof: {}

edges:
  - intro -> background: { label: Background, default: true }
  - intro -> proof: { label: "Skip to the proof" }   # detour
  - background -> defs: { default: true, transition: zoom-through }
  - defs -> examples -> defs      # chains: one edge per arrow
  - examples -> proof: { default: true }
```

## Node files

A node file is Markdown with a YAML frontmatter block. Fields common to all plugins: `type`
(optional for `.md`), `title`, `notes` (speaker notes; alternatively a `::: notes` block in the body).

### `slide` (the default for `.md` files)

```markdown
---
fragments: lists   # optional: every top-level list item becomes a fragment
---
# The idea

- A first point, with math: $f \colon \R \to \R$
- A second point
```

### `image`

```markdown
---
type: image
src: ../figures/diagram.svg        # path relative to the node file
caption: "The fabric of the proof."  # optional, Markdown; quote it
fit: contain                       # contain | cover
---
```

### `frame`

Defined in `talk.yaml` only — **it has no file**. It renders its title and draws its children inside
its box; visiting a frame shows it whole (0 steps). A frame automatically has an edge to each of its
children (after its own edges), so only add `frame -> child` edges for a label or `default: true`.

## Slide Markdown

CommonMark + GFM tables, plus:

- **Math:** `$...$` and `$$...$$`, rendered by KaTeX at build time. Shared macros come from
  `macros.tex` (`\newcommand`, `\renewcommand`, `\DeclareMathOperator`).
- **Code:** fenced blocks highlighted at build time (```` ```lean ```` uses the Lean grammar;
  highlighting only, not elaborated).
- **Fragments** (gradual reveal), two forms:
  - an attribute block `{.fragment}` at the end of a paragraph, list item or heading;
  - a `::: fragment` block around any content — use it for display math, code and images.

  Step rule: a fragment without a number comes **one step after the previous fragment**;
  `{.fragment step=2}` / `::: fragment step=2` puts it in step 2 explicitly; fragments with the same
  step appear together. Optional effect: `.fade-up`, `.highlight`, `.fade-out` (default: fade in),
  e.g. `{.fragment .fade-up}` or `::: fragment fade-up`.
- **`fragments: lists`** in frontmatter: every top-level list item becomes a fragment.
- **`::: notes ... :::`**: speaker notes, removed from the slide and shown in the presenter view (`p`).
- **Columns:** the outer fence needs *four* colons (one more than the inner ones):

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

- **Images:** standard Markdown images, paths relative to the node file.

Step count of a slide = number of distinct fragment steps.

## Writing good slides

Slides are 1600×900 with ~36px text: fit at most **~6 bullets or ~60 words** per slide; if it does
not fit, split the slide.

- One idea per slide.
- Every slide starts with `# Title` (this is also its default node title).
- Put anything the audience should not see in `::: notes` speaker notes.
- Every node must be reachable along edges from `start` (the checker warns otherwise).
- Every node with outgoing edges should normally have **exactly one** default edge, so Space walks a
  single main line end to end.
- Label detour edges — the label becomes the button text (e.g. "Skip to the proof").
- Use frames to group related slides into sections; `zoom-through` transitions suit frame ↔ child
  edges.

## Pitfalls

- **YAML quoting:** quote values containing `: ` or starting with special characters — captions in
  particular (`caption: "A fabric: nodes and edges"`).
- **Display math + fragments:** `$$...$$` cannot take `{.fragment}`; wrap it in a `::: fragment`
  block instead.
- **Columns:** the outer fence needs four colons (`:::: columns`), inner fences three.
- **Node ids:** lowercase `[a-z0-9_-]`, starting with a letter or digit — no uppercase, no dots.
- **Default edges:** at most one `default: true` edge per source node; Space follows it only when the
  node has no steps left.
- **Field in two places:** a field may be set in `talk.yaml` *or* in frontmatter, not both — that is
  an error.
- **Frames have no file:** never create `nodes/<frame-id>.md` or give a frame a `file`.
- **Image paths** are relative to the node file: use `../figures/x.svg`, not `/figures/x.svg`.
