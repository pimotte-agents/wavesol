# Fragments: reveal in steps

This paragraph is the first step. {.fragment}

- These two items share a step, {.fragment step=2}
- because both say `step=2`. {.fragment step=2}

::: fragment fade-up
A `::: fragment` block wraps anything (math, code, images) and can take an effect: `fade-up`,
`highlight` or `fade-out`.
:::

```markdown
Text {.fragment}            one step after the previous fragment
Text {.fragment step=2}     explicitly in step 2
```

::: notes
Without a number, a fragment comes one step after the previous one. Fragments with the same step appear together.
:::
