---
fragments: walkthrough
---
# Walking through code

```lean
theorem add_zero' (n : Nat) : n + 0 = n := rfl
```

- `fragments: walkthrough`: each item is a step, earlier items grey out {mark="theorem"}
- `{mark="..."}` highlights that text in the code above while the item is current {mark="add_zero'"}
- marks match left to right, each after the previous one {mark="n + 0 = n"}
- a last step shows the slide whole again {mark="rfl"}

::: notes
The code block stays plain Lean; the marks live on the items. A mark that no longer matches is a check error.
:::
