# Node files

```markdown
---
title: Introduction
notes: Mention the poll.
---

# Introduction

The body is Markdown, rendered as a slide.
```

- A node file = YAML frontmatter + Markdown body.
- The `type` is inferred from the extension: `.md` → `slide`.
- Content defaults to `nodes/<id>.md`.

::: notes
Plugin-specific fields live in the frontmatter; defining the same field in both talk.yaml and frontmatter is an error.
:::
