# wavesol — implementation plan

wavesol (from Dutch *weefsel*, "fabric") is a graph-based presentation tool for academic talks and
lectures. Nodes sit on one 2D canvas, and the camera flies between them along the edges of a graph.
A talk is a directory of human-editable files, mostly written by AI, that builds to a static site.

## Decisions

| Topic | Decision |
|---|---|
| Spatial model | One world canvas. The camera pans and zooms. Overview = zoom out. |
| Hierarchy | **Frames** are nodes that contain a subgraph, drawn smaller inside them. Layout runs recursively per frame. |
| Navigation | Directed edges with optional labels. Each node may mark one **default** edge. There is a separate history **back** stack. All outgoing edges are available at any time. |
| Steps | Nodes have internal steps (fragments, Lean tactics, animation sections). `step` advances within the node, and when the node is done it follows the default edge. Taking an edge early skips the remaining steps. |
| Input | Phone controller is primary (step button, one button per edge, back, laser pointer). Keyboard fallback: space or → = step, 1–9 = edge, Backspace = back, `o` = overview. |
| Source format | Directory: `talk.yaml` (graph, layout hints, theme, transitions) + `nodes/*.md` with frontmatter + `lean/` lake project + `figures/`, `refs.bib`, `macros.tex`. |
| Build | `wavesol build` → `dist/` static site, base-path aware. `wavesol dev` = live reload. `wavesol serve` = local presenting from the laptop (phone control still needs internet, e.g. via phone hotspot). |
| Stack | TypeScript + Vite + React for core UI. Single npm package with internal module boundaries (see Architecture). |
| Plugins | Framework-agnostic node plugin API. Built-in plugins only for now (no external loading until the API stabilises). |
| Slides | Own renderer, not reveal.js: Markdown → HTML, KaTeX at build time with shared macros, Shiki code highlighting, reveal-style fragments. |
| Lean | Lake project inside the talk. **SubVerso** extracts highlighting, hovers and goal states at build time. Infoview inside the node. Click-a-tactic exploration + scripted step-through. No live editing, no Lean in the browser. |
| Manim | Not scheduled; under "Later / maybe" (video-with-sections vs JS-native still open). |
| Sync | Fallback chain behind one transport interface. Presenter popout via `BroadcastChannel`. Phone via WebRTC (multi-relay signaling over public MQTT/Nostr/tracker relays, trystero-style, + STUN, optional TURN). If no P2P connection forms within a few seconds, messages are relayed through the signaling channel (end-to-end encrypted). Optional self-hosted Cloudflare Worker for signaling + relay. QR pairing with a room secret. |
| Deploy | One talk per repo. GitHub Pages via an Action template. Must work from any base URL/subpath. |
| Theme | Calm academic, light default (off-white, one accent, thin curved edges, projector-safe) + dark variant. CSS-variable based, overridable in `talk.yaml`. |
| AI authoring | JSON Schema for `talk.yaml` and frontmatter (generated from zod), `wavesol check` with precise errors, bundled `AGENTS.md`/`CLAUDE.md` in the talk template. |
| Figures | Shared LaTeX macros, TikZ/tikz-cd → SVG at build time, BibTeX citations + references node, images (incl. PDF pages). |
| Polls (later) | Seminar scale (<50). The presenter's browser acts as the WebRTC hub (star topology) over the same transport layer, with relay fallback per attendee. |

Technical choices made without a question (revisit if they bite):
- **Rendering:** DOM + CSS transforms on one world container rather than WebGL, so plugins are ordinary
  DOM/React and text stays selectable. `will-change: transform` only while the camera moves (pixel-identical
  to native rendering at rest, confirmed in the camera spike). Flat DOM: frames are a layout concept.
  LOD: off-screen nodes hidden, tiny slides show a title card.
- **Default transition:** van Wijk–Nuij "smooth zoom" (zoom out, pan, zoom in), with duration scaled by
  distance. Per-edge, per-node and global overrides: `fly` (default), `cut`, `fade`, `zoom-through`.
- **Layout:** elkjs (layered by default), hints (`direction`, `near: {left-of: x}`; ELK ignores layer constraints, so no `rank`) and `pin: [x, y]`.
- **Tests:** vitest for unit tests, Playwright for end-to-end and visual regression (see Testing).

## Source format sketch

```
my-talk/
  talk.yaml
  nodes/
    intro.md
    main-thm.md        # type: lean
  lean/                # lake project (may depend on Mathlib)
  figures/ refs.bib macros.tex
  AGENTS.md            # agent guide, from template
  .github/workflows/deploy.yml
```

```yaml
# talk.yaml
title: Fabrics of proofs
theme: { base: academic-light, accent: "#2b6cb0" }
transitions: { default: fly }
start: intro
nodes:
  intro: {}                              # nodes/intro.md
  background:
    type: frame
    children: [defs, examples]
    layout: { direction: down }
  main-thm: { pin: [1200, 0] }
edges:
  - intro -> background: { label: "Background", default: true }
  - intro -> main-thm: { label: "Skip to theorem" }
  - background -> main-thm: { default: true, transition: zoom-through }
```

```markdown
---
title: Introduction
notes: |
  Mention the audience poll later.
---
# Why fabrics?

- A first point {.fragment}
- $\Hom(A, B)$ uses a shared macro {.fragment}
```

The final syntax is settled in Phase 0. Node frontmatter is validated by each plugin's schema.

## Architecture (inside the single package)

```
src/
  model/       graph types, parsing, zod schemas → JSON Schema, validation (`check`)
  build/       Vite plugin + build pipeline; per-plugin build hooks; content cache
  layout/      elkjs integration, recursive frames, hints, pins
  runtime/     canvas, camera + transitions, navigation state machine, step engine
  sync/        state protocol + transports (broadcast, webrtc, relay) + fallback chain
  ui/          presenter view, controller (phone) app, overview — React
  plugins/     slide, frame, image, lean, tikz, references, (later) manim, poll
  theme/       CSS variables, default themes
  cli/         new / dev / build / serve / check
docs/          the documentation, written as a wavesol talk (deployed to GitHub Pages)
```

**Node plugin contract** (framework-agnostic), split so build-only dependencies (Shiki, KaTeX, Lean
tooling) never reach the browser bundle. See `src/plugins/types.ts`:

```ts
interface BuildPlugin<Data> {           // src/plugins/<type>/build.ts, runs in Node
  type: string;
  schema: ZodType<Data>;                // frontmatter validation
  hasFile: boolean;
  build(node, ctx): Promise<{ data; steps; notes?; title? }>;   // Markdown, KaTeX, Lean extraction…
}
interface RuntimePlugin {               // src/plugins/<type>/runtime.ts, runs in the browser
  type: string;
  mount(el: HTMLElement, node: CompiledNode, api: NodeApi): NodeInstance;
}
interface NodeInstance {
  setStep(step: number, opts: { animate: boolean }): void;
  setDetail?(level: "overview" | "near" | "active"): void;   // LOD when zoomed out
  unmount?(): void;
}
```

The build compiles a talk into one `CompiledTalk` JSON (layout positions, plugin data, steps), served
to the runtime as the virtual module `virtual:wavesol/talk`.

**State protocol:** the projector page is the single source of truth. State is `{ node, step,
history, pointer }`. Peers (presenter view, phone, later audience) send intents (`step`, `edge:i`,
`back`, `goto`, `pointer`) and receive state snapshots plus the outgoing edges and labels for the
current node. Transports only move JSON messages. Intents carry the state version they were issued
against, so replays after a reconnect are dropped. Peers must prove knowledge of the room secret (from
the QR code) before their intents are accepted.

## Testing

- **Unit (vitest):** all pure logic: parsing and `check` errors, layout, the navigation state machine,
  the camera path, the sync protocol, plugin build hooks.
- **End-to-end (Playwright):** against the built docs talk, served from a subpath, in a real browser.
- **Visual regression:** screenshots of key nodes and steps compared against committed baselines. The
  camera spike's sharpness check (settled camera = native rendering) stays as a permanent test.
- **Rule:** every phase's exit requires its tests to be green in CI. A bug fix comes with a test that
  reproduces it.

## Phases

### Phase 0 — Foundations and spikes
- Repo setup: TS, Vite, React, vitest, Playwright, lint, CI.
- Pin down the source format and write the zod schemas. Generate JSON Schema.
- **Spike: camera.** A DOM canvas with ~50 nodes, smooth-zoom fly, text crispness at rest, frame nesting
  at 3 levels. Decide on the LOD strategy.
- **Spike: Lean.** Run SubVerso on a small lake project (core Lean only, no Mathlib) and confirm the
  JSON has goal states per tactic and hovers. Check toolchain coupling.
- Exit: format spec written, both spikes green or risks re-planned.
- **Status: done.** Format v0 in `spec/FORMAT.md`, both spikes green (`spikes/*/FINDINGS.md`). Open:
  check camera flights on real hardware (GPU raster cost is not measurable headless).

### Phase 1 — Core fabric MVP (presentable with keyboard)
- Parser + `wavesol check` (dangling edges, unknown types, missing files, schema errors with file:line).
- Plugins: `slide` (Markdown, KaTeX + `macros.tex`, Shiki, fragments), `frame`, `image`.
- Layout: elkjs, recursive frames, hints, pins.
- Runtime: camera, transitions (fly/cut/fade/zoom-through, configurable), navigation state machine
  (step, default edge, edge by index, back history, overview + click-to-fly).
- Default academic-light theme + theme overrides.
- CLI: `new`, `dev`, `build`, `serve`. Base-path-safe static output.
- Talk template with GitHub Pages workflow and `AGENTS.md` v0.
- **Docs talk:** the public documentation of wavesol is itself a wavesol talk, in `docs/` in this repo,
  built and deployed to GitHub Pages by the repo's CI. It covers the source format, node types,
  navigation, layout, theming and the CLI, and doubles as the end-to-end test fixture. Every later
  phase extends it with that phase's features.
- Exit: the docs talk (~15+ nodes) is deployed and can be presented from the Pages site.
- **Status: implemented, not yet deployed.** All items above are in place with unit tests (check
  fixtures, layout, navigation, camera, slide build) and end-to-end tests on the docs talk (served
  from a subpath, incl. visual baselines). Decisions made along the way:
  - Plugins are split into a build half (Node) and a runtime half (browser); see the contract above.
  - Layout: ELK ignores layer constraints, so there is no `rank` hint. Layered layouts wrap long
    chains into rows (`wrap: true` by default) so the overview reads as a fabric, not a ribbon.
  - Fragment steps: a fragment comes one step after the previous one unless `step=n` is given;
    `::: fragment` blocks cover display math, code and images.
  - Edges are drawn per nesting depth, so frames hide edges passing behind them but show edges between
    their children.
  - wavesol runs from TypeScript via tsx (no build step); talks depend on it as a git dependency until
    it's published to npm.
  - Remaining: push, enable GitHub Pages for the repo, confirm the deployed docs.
- Tests:
  - Unit: a fixture talk per `check` error, with the expected messages and `file:line`. Layout
    snapshots. Navigation sequences: step, default edge, edge by index, back, leaving a node early.
  - End-to-end: present the docs talk with the keyboard; overview and fly to a node.

### Phase 2 — Presenter view
- Sync state protocol + `BroadcastChannel` transport.
- Pop-out presenter window: current node at current step, outgoing edges (clickable), speaker notes,
  timer/clock, mini-map of the fabric.
- Exit: present with the popped-out presenter view on a second screen.
- Tests: end-to-end with the presenter view as a second window; state stays in sync both ways.

### Phase 3 — Phone controller
- Transport adapters and fallback chain:
  1. WebRTC data channel. Signaling over several public relays in parallel (MQTT/Nostr/trackers,
     trystero-style). STUN by default. TURN configurable in `talk.yaml`, with a free-tier provider
     documented.
  2. Relay fallback: if no P2P connection forms within a few seconds, send messages through the
     signaling relay, end-to-end encrypted with the room secret.
  3. Optional self-hosted Cloudflare Worker (+ Durable Object) for signaling and relay, with a deploy
     guide.
- QR pairing with a per-session room secret. Message authentication. Versioned intents.
- Robustness: Wake Lock on the phone, automatic reconnect, full state snapshot on (re)connect.
  Connection status shown on the phone and in the presenter view.
- Controller UI: big step button, edge buttons (labels or target titles), back, laser pointer (touchpad
  area → normalised pointer drawn on the projector, throttled and smoothed).
- Exit: run a talk from the phone on eduroam (P2P or relay), and from `wavesol serve` with the laptop
  on a phone hotspot.
- Tests:
  - Unit: the protocol, including version checks, rejected intents without the room secret, and
    replays after reconnect.
  - End-to-end: two browser contexts (projector and phone) connected through a local signaling/relay
    stub, including a dropped connection and the switch to relaying. Real public relays only get a
    manual or nightly smoke test, so CI doesn't depend on them.

### Phase 4 — Lean nodes
- Use SubVerso as is: the talk's lake project requires SubVerso (version pinned per wavesol release),
  and the build hook runs `lake build :highlighted`, producing SubVerso's JSON per module.
- TypeScript reader (`plugins/lean/subverso.ts`), the only code that knows SubVerso's JSON: resolves
  the dedup tables, selects declarations (`defines`) or `ANCHOR` regions, drops anchor/`PROOF_STATE`
  marker comments, and derives goals *before* each tactic from the recorded after-states. SubVerso's
  format is not a stable API, so this reader is tested against the pinned version and updated with it.
- Cache keyed on file hashes and toolchain.
- Renderer: highlighted code with hovers (types, docstrings), infoview panel inside the node, click a
  tactic → its goal state.
- Step-through mode: the node's steps follow the tactics (or an explicit list in frontmatter),
  highlighting each one and updating the goal.
- CI: elan + Mathlib cache in the template workflow.
- Exit: a talk with a Mathlib-based proof that can be explored and stepped through on the static site.
- Tests:
  - Unit: the SubVerso reader against committed fixtures from the pinned version.
  - End-to-end: hover a token, click a tactic, step through a proof.
  - CI: a job with elan that builds the docs talk's Lean project.

### Phase 5 — Academic content and polish
- `tikz` plugin (and inline tikz-cd in slides): latex → dvisvgm → SVG, cached; TeX in CI.
- Citations: `\cite{key}` from `refs.bib` (citation-js), auto `references` node.
- PDF page figures (pdf.js or build-time pdftocairo → SVG).
- Dark theme variant, theme docs. Transition fine-tuning.
- Layout drag mode in `wavesol dev` that writes pins back to `talk.yaml`.
- `AGENTS.md` v1 with idioms and complete examples for every node type.
- Tests: unit tests for TikZ and citation rendering, skipped with a clear message when TeX is missing;
  CI installs TeX.

### Phase 6 — Audience polls
- Audience join page via QR. The presenter's browser is the hub over the existing transport.
- `poll` node plugin: multiple choice, live histogram on the projector, results in the presenter view.
- Exit: run a poll with ~30 phones in a seminar room.
- Tests: end-to-end with ~30 simulated audience connections answering a poll.

### Later / maybe
- Animations: choose between manim pre-rendered video with `next_section()` steps (+ alpha video for
  overlays) and a JS-native animation plugin, possibly both (video first). Includes overlays: a node or
  layer drawn on top of another node (e.g. an animation over a slide).
- External plugin loading (per-talk `plugins/`, then npm).
- `wavesol shoot` headless screenshots for AI visual feedback.
- Scaffold commands (`wavesol add node`).
- Annotation/drawing layer.

## Risks
- **SubVerso/Lean coupling:** SubVerso compiles with the talk's toolchain (≥ 4.25 on `main`) and its JSON
  is unstable. Pin SubVerso per wavesol release; keep all format knowledge in the one TS reader.
- **Mathlib in CI:** build time and cache size. Use `lake exe cache get` and cache `.lake` in Actions.
- **Venue networks block WebRTC:** relay fallback through the signaling channel, configurable TURN,
  phone hotspot as the documented last resort.
- **Public relays have no SLA:** use several in parallel; offer the self-hosted Worker.
- **DOM zoom performance on weak GPUs:** main-thread cost is low (< 4 ms/frame at 300 nodes); GPU
  raster cost still to be checked on real hardware.
- **TeX dependency** for TikZ: optional at build time, with a clear `check` error when missing.
