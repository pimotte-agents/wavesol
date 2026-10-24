---
fragments: lists
title: Lean nodes
---

# Lean proofs

A Lean node shows a declaration from the talk's `lean/` project, with goals from Lean itself:

```yaml
---
type: lean
source: Proofs/Lists.lean   # relative to lean/
anchor: revRev              # an -- ANCHOR: region, or decl: reverse_reverse
steps: tactics              # tactics | none | [names of -- ^ PROOF_STATE: comments]
---
```

- **Space** steps through the tactics; the infoview shows the goals before and after.
- **Click** any tactic to see its goals; **hover** a name for its type and docstring.

::: notes
The lean/ folder is an ordinary lake project that requires SubVerso; wavesol build runs lake for you.
:::
