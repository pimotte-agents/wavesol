# Lean spike — findings

Setup: lake project on `leanprover/lean4:v4.31.0` (core Lean, no Mathlib) requiring SubVerso `main`.
`lake build subverso-extract-mod`, then `lake exe subverso-extract-mod Demo.Basic out.json`.
`decode.ts` reads the output and prints every declaration with its tactics and goals.

Result: **green.**

## What the data contains
- Full highlighted source per command (`items[]` with `kind`, `defines`, `code`).
- **Hovers:** tokens carry a `kind`. For constants this includes the name, pretty-printed signature,
  docstring and `isDef`. Variables, keywords and similar get their own kinds.
- **Goal states per tactic:** `tactics` nodes cover a source range (`startPos`/`endPos`), and their goals
  include the case name, hypotheses (names + type) and conclusion, all as highlighted code (so goals can
  have hovers too). Nested tactics (e.g. each `rw` rule) get their own entries.
- Extraction is fast (~0.5 s for a small module once built). The one-off SubVerso build takes a few
  minutes.

## Caveats
1. **The format is not a stable API.** The README says so explicitly: "use SubVerso itself to read and
   write the data". The JSON is also deduplicated into tables (`code`, `tokens`, `goals`) referenced by
   id.
2. **Goals are the state *after* a tactic** (for `by` it is the initial state). For step-through we want
   before/after. Before = the after-state of the preceding tactic at the same level, or of the enclosing
   one.
3. **Anchor comments stay in the text.** `-- ANCHOR:` comments are leading trivia of the next command,
   so `subverso-extract-mod` keeps them. SubVerso's anchor support (`SubVerso.Highlighting.Anchors`) is
   a Lean API only, not exposed by the CLI or the lake facet.
4. **Toolchain coupling.** SubVerso `main` requires Lean ≥ 4.25 (older versions need the `no-modules`
   branch). SubVerso is compiled with the *talk's* toolchain.

## Decision for Phase 4
Use SubVerso as is, no wavesol-specific Lean code. The talk's lake project requires SubVerso (pinned per
wavesol release), and the build runs `lake build :highlighted` (SubVerso's library facet, which runs
`subverso-extract-mod` per module into `.lake/build/highlighted`).

A TypeScript reader is the only code that knows SubVerso's JSON. It grows out of `decode.ts`:
- resolve the dedup tables into a tree;
- select by declaration (`defines`) or by `ANCHOR` region. `subverso-extract-mod` has no anchor
  option, so the reader slices on the anchor comments and drops anchor/`PROOF_STATE` markers;
- derive before-states from the recorded after-states.

Since the format can change between SubVerso versions, the reader gets fixture tests generated with the
pinned version, and a SubVerso bump means regenerating fixtures and fixing the reader.
