---
title: Making room (collapse)
---

# Making room

| Prover | Sentence {.fragment collapse} | Style {.fragment collapse} |
|:--|:--|:--|
| Waterproof | `It holds that (n + 1 is even).` | Rocq, controlled natural language |
| Verbose Lean | `Since n is odd we get that n + 1 is even` | Lean, controlled natural language |

`collapse` on a fragment: it takes no space until it shows. On a table header cell, the fragment is the whole column. The text around it moves to its new place, word by word.

```markdown
| Prover | Sentence {.fragment collapse} | Style {.fragment collapse} |
```

::: notes
With fade-out, collapse gives the space away once the fragment has faded: ::: fragment fade-out collapse.
:::
