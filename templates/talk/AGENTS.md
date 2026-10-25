# Guide for editing this talk (wavesol)

## What this is

A wavesol talk is a **graph of nodes** on one canvas: each node is a slide (a Markdown file in
`nodes/`), an image, a TikZ figure, a Lean proof, an audience poll, a references list, or a frame (a group drawn around
its children); directed **edges** connect the nodes and are shown as buttons. The audience follows the
*default* edges with Space; other edges are labeled detours. Slides can cite works from `refs.bib` with
`[@key]` and draw diagrams in ` ```tikzcd ` fences.

Commands (run from this talk directory):

- `npm run check` — validate the talk. **Run it after EVERY change** and fix all errors *and*
  warnings. Output is `file:line:col`.
- `npm run check:render` — also renders every node at every step and warns about content that
  overflows its slide or images that don't load. Run it before you finish; `npx wavesol check --shots
  shots/` saves screenshots of every node and step to look at. (Needs Playwright: `npm install
  --save-dev playwright && npx playwright install chromium`.)
- `npm run dev` — live preview in the browser.
- `npm run build` — production build.

## Workflow for agents

1. **Plan the graph first.** Sketch the main line: a chain of nodes connected by `default: true`
   edges from `start`, plus detour edges (labeled, non-default) to side content that loops back or
   merges into the main line. Group related slides into frames if they form a section.
2. **Write the node files** in `nodes/` (one Markdown file per slide), then declare everything in
   `talk.yaml`: metadata, `nodes`, `edges`.
3. **Run `npm run check` until clean** — no errors, no warnings. Re-run after each change.
4. **Then `npm run check:render` until clean**: the slides fit and the images load.

## `talk.yaml` reference

Top-level keys:

- `title` (required), `subtitle`, `authors`, `date`, `venue`
- `start`: first node id; defaults to the first key of `nodes`.
- `theme`: `{ base: academic-light, accent: "#hex", vars: { ... } }` — `vars` are CSS custom
  properties without the `--ws-` prefix. `base` is `academic-light` (default) or `academic-dark`.
- `transitions.default`: `fly` (default) | `cut` | `fade` | `zoom-through`, or
  `{ type, duration, easing }`.
- `layout`: `{ algorithm: layered | force | grid | manual, direction: right | down | left | up,
  spacing: <number>, wrap: <bool> }`. Use `layered` (default) for a talk with a main line and detours,
  `force` for a web of topics without one main path. Layered layouts wrap long chains into rows unless
  `wrap: false`; `direction` applies to layered only.
- `math.macros`: path to a LaTeX macros file (default `macros.tex` if it exists).
- `pdf`: `true` (or `{ file: slides.pdf, steps: last | all }`) — `npm run build` also writes a PDF.
- `bibliography`: BibTeX file for `[@key]` citations (default `refs.bib` if it exists).
- `tikz`: `{ packages: [...], libraries: [...], preamble: "..." }` — LaTeX setup for all TikZ
  pictures (optional).
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
fragments: lists   # optional: every top-level list item becomes a fragment (or: walkthrough)
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

### `lean`

```markdown
---
type: lean
source: Proofs/Lists.lean   # relative to lean/
anchor: revRev              # "-- ANCHOR: revRev" … "-- ANCHOR_END: revRev"; or decl: <name>
steps: tactics              # tactics | none | [names of "-- ^ PROOF_STATE: name" comments]
infoview: right             # right | below
---
Optional caption (Markdown).
```

Needs a `lean/` lake project requiring SubVerso (see the format spec); `npm run check` runs Lean and
reports Lean errors in the `.lean` file. Keep shown declarations short (about 15 lines): long lines
shrink to fit. Put each proof you show in an ANCHOR region; Space then steps through its tactics.

### `tikz`

```markdown
---
type: tikz
caption: "The square commutes."   # optional, Markdown; quote it
libraries: [arrows.meta]          # optional; also packages, preamble
---
\begin{tikzcd}
A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
C \arrow[r, "k"'] & D
\end{tikzcd}
```

The body is the picture: TikZ commands, or a whole `tikzpicture` / `tikzcd` environment. LaTeX draws
it at build time (needs TeX Live and poppler); `npm run check` reports LaTeX errors at their line.
Black becomes the theme's ink colour, so don't hard-code `black`/`white` for strokes or text.

### `poll`

```markdown
---
type: poll
options: [Induction, Contradiction, "Something else: tell me after"]
results: reveal   # reveal (default): Space shows the results | live
---
# Which proof technique do you use most?
```

The audience votes from their phones (QR code on the slide; `j` shows it full-size). Keep options
short (2–9). A poll has one step when results are revealed: give it a default edge onwards as usual.

### `references`

Defined in `talk.yaml` only — **no file**: `refs: { type: references, title: References }`. Lists
every work cited with `[@key]` anywhere in the talk; clicking a citation flies there. Add one whenever the talk cites anything (the
checker warns otherwise) and link it from the end of the talk.

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
- **`fragments: walkthrough`** in frontmatter: like `lists`, but while an item is current the earlier
  items are greyed out, and one extra step at the end shows the whole slide normally again.
- **Code marks:** `{mark="text"}` on a fragment highlights `text` in the nearest code block above it
  while that fragment is the current step (the code itself stays plain). Each mark matches the first
  occurrence *after the previous mark* in that block, whitespace matches any whitespace (so a mark can
  span lines), and identifiers only match whole (`f` does not match inside `def`). One mark per
  fragment; a mark that does not match is an error. Pairs well with `fragments: walkthrough`:

  ````markdown
  ```lean
  theorem foo (n : Nat) : n + 0 = n := rfl
  ```

  - the name {mark="foo"}
  - the statement {mark="n + 0 = n"}
  - the proof {mark="rfl"}
  ````
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
- **Links to other nodes:** `[text](#node-id)`, e.g. `(see [the proof](#proof))`: a click flies to that
  node and Back returns. No edge needed; an unknown id is a check error.
- **Moving equations:** `::: morph` around display equations (blank line between them): each next
  equation is a step, and parts tagged `\mm{name}{…}` move from one equation to the next. Tag numbers,
  variables and subexpressions that carry over, never bare operators; untagged parts fade.

  ```markdown
  ::: morph
  $$ \mm{a}{(x+1)}^2 $$

  $$ \mm{a}{(x+1)}\mm{b}{(x+1)} $$
  :::
  ```
- **Diagrams:** a ` ```tikzcd ` fence holds a tikz-cd diagram (rows `\\`, columns `&`), a ` ```tikz `
  fence TikZ commands; drawn as figures at build time. 10pt in TikZ = the slide's text size.
- **Citations:** `[@key]`, `[@key, p. 3]`, `[@a; @b]` → (Author, 2020, p. 3), from `refs.bib`. Every key
  must exist in the bibliography.

Step count of a slide = number of distinct fragment steps (+1 for the summary step of a walkthrough).

## Idioms (complete examples)

**A small complete talk:** a main line, a detour that comes back, a frame, a citation, references.

```yaml
# talk.yaml
title: Fixed points
authors: [A. Author]
nodes:
  intro: {}
  theorem: {}
  proof:
    type: frame
    title: The proof
    children: [proof-idea, proof-details]
  proof-idea: {}
  proof-details: {}
  history: {}
  refs: { type: references, title: References }
edges:
  - intro -> theorem -> proof: { default: true }
  - proof -> proof-idea: { default: true, transition: zoom-through }
  - proof-idea -> proof-details: { default: true }
  - proof-details -> refs: { default: true }
  - theorem -> history: { label: "Where does this come from?" }
  - history -> proof: { default: true }
```

```markdown
<!-- nodes/theorem.md -->
---
fragments: lists
---
# The theorem

- Every contraction $f \colon X \to X$ of a complete metric space has a unique fixed point [@banach1922].
- The proof is constructive: iterate $f$.

::: notes
Pause here; the detour button is "Where does this come from?".
:::
```

**A hub of topics** (for a lecture or a Q&A): one slide lists the topics, with an edge to each in the
same order as its list, so the numbers on the slide match the keys 1–9. Space walks the topics in
order; each topic's last node also links back.

```yaml
edges:
  - overview -> topic-a: { default: true }
  - overview -> topic-b
  - overview -> topic-c
  - topic-a -> topic-b: { default: true }
  - topic-a -> overview: { label: "Back to the topics" }
```

**A proof, step by step:** the statement on a slide, then the Lean node; Space walks the tactics.

```lean
-- lean/Proofs/Basic.lean
-- ANCHOR: addZero
theorem add_zero' (n : Nat) : n + 0 = n := by
  induction n with
  | zero => rfl
  | succ k ih => rfl
-- ANCHOR_END: addZero
```

```markdown
<!-- nodes/add-zero.md -->
---
type: lean
title: Adding zero
source: Proofs/Basic.lean
anchor: addZero
---
By induction on $n$.
```

**A definition with a diagram:**

````markdown
# Pullbacks

A square is a *pullback* if every other cone factors through it uniquely:

```tikzcd
W \arrow[dr, dashed, "\exists!"] \arrow[drr, bend left] \arrow[ddr, bend right] \\
& P \arrow[r] \arrow[d] & B \arrow[d] \\
& A \arrow[r] & C
```
````

**Reveal side by side:** columns with a fragment in each.

```markdown
:::: columns
::: column
**Before** {.fragment}
:::
::: column
**After** {.fragment}
:::
::::
```

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
- **Citations need a bibliography and a references node:** add the entry to `refs.bib` before citing
  it, and a `type: references` node to `talk.yaml`.
- **TikZ in YAML:** put pictures in the node file's body or a fence, never in frontmatter (backslashes
  and `:` would need escaping).
- **Pins** (`pin: [x, y]`) are best set by dragging in `npm run dev` (key `d`), not by hand.
