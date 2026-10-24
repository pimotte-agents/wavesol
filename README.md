# wavesol

Graph-based presentations for academic talks and lectures. Nodes (slides, figures, frames, and later
Lean proofs) sit on one canvas, and the camera flies between them along the edges of a graph. The name
is a play on the Dutch *weefsel*, "fabric".

The documentation is itself a wavesol talk: [docs/](docs/), published to GitHub Pages.

## Making a talk

```sh
npx github:pimotte-agents/wavesol new my-talk
cd my-talk && npm install
npm run dev      # live preview
npm run check    # validate, with file:line:col errors
npm run build    # static site in dist/ (works from any URL path)
npm run serve    # build and present from this machine
```

The talk format is described in [spec/FORMAT.md](spec/FORMAT.md); JSON Schemas are in `schema/`.

## Developing wavesol

```sh
npm install
npm test              # unit tests (vitest)
npm run test:e2e      # end-to-end tests on the docs talk + camera spike (Playwright)
npm run docs:dev      # the docs talk with live reload
npm run schema        # regenerate schema/ from src/model/schema.ts
```

Status and roadmap: [PLAN.md](PLAN.md). Spike findings: [camera](spikes/camera/FINDINGS.md),
[Lean](spikes/lean/FINDINGS.md).
