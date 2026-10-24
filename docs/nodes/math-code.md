# Math and code

Macros from `macros.tex` work in every node: let $f : \R \to \R$, then $\Hom(\N, \R)$ collects all maps.

Display math goes on its own lines:

$$\sum_{n \in \N} \frac{1}{n^2} = \frac{\pi^2}{6}$$

Code blocks are highlighted at build time:

```yaml
math:
  macros: macros.tex   # the default, if the file exists
```

::: notes
KaTeX renders all math at build time; ```lean fences use the Lean grammar — highlighting only, not elaborated.
:::
