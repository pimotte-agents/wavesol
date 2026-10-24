---
title: Equations that move
---

# Equations that move

Tag parts with `\mm{name}{…}`; in a `::: morph` block, parts with the same name glide between steps:

::: morph
$$ \mm{two}{2}\mm{x}{x} + \mm{b}{3} \mm{eq}{=} \mm{c}{7} $$

$$ \mm{two}{2}\mm{x}{x} \mm{eq}{=} \mm{c}{7} - \mm{b}{3} $$

$$ \mm{two}{2}\mm{x}{x} \mm{eq}{=} \mm{c}{4} $$

$$ \mm{x}{x} \mm{eq}{=} \mm{c}{2} $$
:::

::: notes
Each equation after the first is a step; untagged parts (here the signs) fade. Prev plays the move backwards.
:::
