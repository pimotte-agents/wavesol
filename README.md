# wavesol

Graph-based presentations for academic talks and lectures. Nodes (slides, Lean proofs, figures, …) sit
on one canvas, and the camera flies between them along the edges of a graph. The name is a play on the
Dutch *weefsel*, "fabric".

Status: Phase 0 (foundations and spikes). See [PLAN.md](PLAN.md).

- [spec/FORMAT.md](spec/FORMAT.md): the source format (v0); JSON Schemas in `schema/`
- [spikes/camera](spikes/camera/FINDINGS.md): camera and rendering spike
- [spikes/lean](spikes/lean/FINDINGS.md): Lean / SubVerso extraction spike

## Development

```sh
npm install
npm test              # unit tests
npm run test:e2e      # Playwright (camera spike measurements)
npm run dev:camera    # camera spike in the browser
npm run schema        # regenerate schema/ from src/model/schema.ts
```
