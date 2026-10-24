# wavesol — implementation plan

wavesol (from Dutch *weefsel*, "fabric") is a graph-based presentation tool for academic talks and
lectures. Nodes sit on one 2D canvas, and the camera flies between them along the edges of a graph.
A talk is a directory of human-editable files, mostly written by AI, that builds to a static site.

## Progress

| Phase | Status |
|---|---|
| 0 — Foundations and spikes | Done. Open: camera check on real hardware. |
| 1 — Core fabric MVP | Done. Docs live at https://pimotte-agents.github.io/wavesol/ |
| 2 — Presenter view | Done |
| 3 — Phone controller | Done; open: real-world runs (eduroam, hotspot) |
| 4 — Lean nodes | Done |
| 5 — Academic content and polish | Done |
| 6 — Audience polls | Done; open: a real seminar-room run |

Where things are documented:
- [`spec/FORMAT.md`](spec/FORMAT.md): the source format (authoritative; schemas in `schema/`).
- [`docs/`](docs/): user documentation, written as a wavesol talk and deployed to Pages.
- [`templates/talk/AGENTS.md`](templates/talk/AGENTS.md): the guide for agents writing talks.
- `spikes/*/FINDINGS.md`: Phase 0 spike results.

## Decisions

| Topic | Decision |
|---|---|
| Spatial model | One world canvas. The camera pans and zooms. Overview = zoom out. |
| Hierarchy | **Frames** are nodes that contain a subgraph, drawn smaller inside them. Layout runs recursively per frame. |
| Navigation | Directed edges with optional labels. Each node may mark one **default** edge. There is a separate history **back** stack. All outgoing edges are available at any time. |
| Steps | Nodes have internal steps (fragments, Lean tactics, animation sections). `step` advances within the node, and when the node is done it follows the default edge. Taking an edge early skips the remaining steps. |
| Input | Phone controller is primary (step button, one button per edge, back, laser pointer). Keyboard fallback (implemented): Space/→/PageDown = step, ←/PageUp = step back, 1–9 = edge, Backspace = back, Home = start, `o` = overview (wheel/pinch/+/− zoom, drag pans), `e` = edges panel, `p` = presenter view, `?` = help, `f` = fullscreen. |
| Source format | Directory: `talk.yaml` (graph, layout hints, theme, transitions) + `nodes/*.md` with frontmatter + `lean/` lake project + `figures/`, `refs.bib`, `macros.tex`. |
| Build | `wavesol build` → `dist/` static site, base-path aware. `wavesol dev` = live reload. `wavesol serve` = local presenting from the laptop; with `--host` it is also the phone relay, so no internet is needed (e.g. laptop on the phone hotspot). |
| Stack | TypeScript + Vite + React for core UI. Single npm package with internal module boundaries (see Architecture). |
| Plugins | Framework-agnostic node plugin API. Built-in plugins only for now (no external loading until the API stabilises). |
| Slides | Own renderer, not reveal.js: Markdown → HTML, KaTeX at build time with shared macros, Shiki code highlighting, reveal-style fragments. |
| Lean | Lake project inside the talk. **SubVerso** extracts highlighting, hovers and goal states at build time. Infoview inside the node. Click-a-tactic exploration + scripted step-through. No live editing, no Lean in the browser. |
| Manim | Not scheduled; under "Later / maybe" (video-with-sections vs JS-native still open). |
| Sync | Fallback chain behind one transport interface. Presenter popout via `BroadcastChannel`. Phone via WebRTC (signaling over public MQTT and Nostr relays in parallel, own small clients, + STUN, optional TURN). Messages go through the relays (end-to-end encrypted) until the direct connection is up, and whenever it is down. Optional self-hosted Cloudflare Worker for signaling + relay. QR pairing with a room secret. |
| Deploy | One talk per repo. GitHub Pages via an Action template. Must work from any base URL/subpath. |
| Theme | Calm academic, light default (off-white, one accent, thin curved edges, projector-safe), with bundled fonts so talks look the same on any machine. Dark variant (`academic-dark`). CSS-variable based, overridable in `talk.yaml`. |
| AI authoring | JSON Schema for `talk.yaml` and frontmatter (generated from zod), `wavesol check` with precise errors, bundled `AGENTS.md`/`CLAUDE.md` in the talk template. |
| Figures | Shared LaTeX macros, TikZ/tikz-cd → SVG at build time, BibTeX citations + references node, images. |
| Polls (later) | Seminar scale (<50). The presenter's browser acts as the WebRTC hub (star topology) over the same transport layer, with relay fallback per attendee. |

Technical choices made without a question (revisit if they bite):
- **Rendering:** DOM + CSS transforms on one world container rather than WebGL, so plugins are ordinary
  DOM/React and text stays selectable. `will-change: transform` only while the camera moves (pixel-identical
  to native rendering at rest, confirmed in the camera spike). Flat DOM: frames are a layout concept.
  LOD: off-screen nodes hidden, tiny slides show a title card.
- **Default transition:** van Wijk–Nuij "smooth zoom" (zoom out, pan, zoom in), with duration scaled by
  distance. Per-edge, per-node and global overrides: `fly` (default), `cut`, `fade`, `zoom-through`.
- **Layout:** elkjs at build time (layered by default, long chains wrapped into rows; force = stress
  layout fitted to 16:9, for web-like talks), hints
  (`direction`, `near: {left-of: x}`) and `pin: [x, y]`. ELK ignores layer constraints, so there is no
  `rank` hint.
- **Tests:** vitest for unit tests, Playwright for end-to-end and visual regression (see Testing).

## Source format

The format is specified in [`spec/FORMAT.md`](spec/FORMAT.md). In short: `talk.yaml` holds metadata,
nodes, edges (`a -> b`, chains, `label`/`default`/`transition`), layout, theme and transitions; each
content node is a Markdown file in `nodes/` with YAML frontmatter; frames are declared in `talk.yaml`.

## Architecture (inside the single package)

```
bin/wavesol.js   CLI entry; runs the TypeScript sources through tsx (no build step)
src/
  model/         zod schemas (→ schema/*.json), compiled-talk and diagnostic types
  build/         loader + validation (`check`), YAML positions, macros, compile, Vite plugin
  layout/        elkjs integration, recursive frames, pins, near hints
  plugins/       node types, each with build.ts (Node) and runtime.ts (browser): slide, image, frame,
                 lean (+ subverso.ts, the reader for SubVerso's JSON)
  runtime/       presentation (canvas, edges, LOD), camera + transitions, navigation state machine,
                 keyboard, ui/ (React overlay: edges panel, help), presenter/ (presenter view)
  sync/          state protocol (host/peer, versioned intents), transports (BroadcastChannel; network:
                 relay + WebRTC), room crypto, signals (MQTT, Nostr, room protocol)
  theme/         base.css (structure) + academic-light.css (variables)
  cli/           new / dev / build / serve / check; local relay for serve/dev
relay-worker/    optional self-hosted relay (Cloudflare Worker + Durable Object), with deploy guide
templates/talk/  the starter talk copied by `wavesol new` (incl. AGENTS.md, Pages workflow)
docs/            the documentation, written as a wavesol talk (deployed to GitHub Pages)
tests/           unit/ + fixtures/ (check diagnostics), e2e/ (Playwright, visual baselines)
spikes/          Phase 0 spikes (camera, Lean)
```

Planned additions: plugins `tikz`, `references`, `poll`.

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

**State protocol** (`src/sync/protocol.ts`; BroadcastChannel to the presenter window, the network
transport in `src/sync/net.ts` to phones): the projector page is the single source of truth. A snapshot
is `{ node, step, history, overview, outgoing, phone }` (outgoing edges with titles and labels, so peers
without the talk can draw buttons; `phone` = pairing URL and connected phones). Peers send a `hello`
and get the current snapshot; every state change is published with a new version. Peers send intents
(`step`, `prev`, `edge`, `back`, `goto`, `overview`, `pointer`, `pair`) tagged with a unique id and the
(session, version) they were issued against. The host drops intents from an earlier projector session,
replays (an id seen before), and `edge` intents issued against an older version (an edge index only
means something on its node); other stale intents still apply, so quick repeated presses all count.
Transports only move JSON messages. On the network, everything is sealed with the room key from the
QR code; what does not open with it is ignored, which is how only paired phones get in.

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
- **Status: done** (2026-10-24). Format v0 in `spec/FORMAT.md`, both spikes green (`spikes/*/FINDINGS.md`). Open:
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
- **Status: done** (2026-10-24). Docs deployed at https://pimotte-agents.github.io/wavesol/. All items
  above are in place with unit tests (check fixtures, layout, navigation, camera, slide build) and
  end-to-end tests on the docs talk (served from a subpath, incl. visual baselines). Decisions made
  along the way:
  - Plugins are split into a build half (Node) and a runtime half (browser); see the contract above.
  - Layout: ELK ignores layer constraints, so there is no `rank` hint. Layered layouts wrap long
    chains into rows (`wrap: true` by default) so the overview reads as a fabric, not a ribbon.
  - Fragment steps: a fragment comes one step after the previous one unless `step=n` is given;
    `::: fragment` blocks cover display math, code and images.
  - Edges are drawn per nesting depth, so frames hide edges passing behind them but show edges between
    their children.
  - wavesol runs from TypeScript via tsx (no build step); talks depend on it as a git dependency until
    it's published to npm.
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
- **Status: done** (2026-10-24). `p` pops out the presenter view (`?presenter` on the same page): current
  node at its step, a preview of what Space does next, outgoing edges and back, speaker notes, timer
  (starts on the first move, click to pause; survives a presenter reload) and clock, connection status,
  and a clickable mini-map. Keys work in both windows. Unit tests cover the protocol (late join,
  versions, stale and replayed intents, projector reload); end-to-end tests drive both windows (sync
  both ways, edges/back/mini-map, notes and next, waiting for and following a reloaded projector).
  Decisions made along the way:
  - Only `edge` intents need the current version; requiring it for all intents dropped the second of
    two quick Space presses.
  - Previews mount the node's runtime plugin at its real size and scale it down; a frame is shown with
    its descendants as on the canvas.

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
- **Status: done** (2026-10-24), except the exit's real-world runs (eduroam; `serve` on a hotspot),
  which need a phone and are still to do. `c` on the projector or "Connect a phone" in the presenter
  view shows the QR code; the phone page (`?phone#k=<secret>`) has Next/Prev/Back, edge buttons, a
  laser pad (smoothed dot on the projector), connection status and Wake Lock. Unit tests: room
  crypto, protocol (incl. intents without the secret, forged and replayed messages, reload), the
  network transport over an in-memory relay, the local relay server. End-to-end (projector and phone
  in separate browser contexts through the test server's relay): pairing, both directions, presenter
  status, laser, a dropped direct connection (fallback to relay and back), relay-only through a relay
  restart, a wrong key, a projector reload. `scripts/smoke-relays.ts` checks the public relays (all
  six pass) or a deployed Worker; the Worker was checked under `wrangler dev`.
  Decisions made along the way:
  - Own small clients (MQTT 3.1.1 over WebSocket, Nostr) behind one signal interface instead of
    trystero: the same channel carries WebRTC signaling and the encrypted relay fallback, and tests
    use a 30-line local relay. BitTorrent trackers dropped: they can carry only signaling, not the
    fallback, and public ones come and go.
  - Messages use the relay from the start and move to the data channel once it opens (rather than
    waiting a few seconds for P2P first); the protocol's versions and intent ids make the switch safe.
  - Encryption is pure JS (`@noble/ciphers`, AES-256-GCM, HKDF from the secret) because a phone on
    `wavesol serve` loads the page over plain HTTP, where Web Crypto is unavailable.
  - Default relays: three MQTT brokers (ports 8884/8084/8081) and three Nostr relays (port 443, for
    networks that block other ports). Nostr relays reject ephemeral events from a clock more than about
    a minute off, so the client corrects its clock offset when a relay says "expired" or "future".
  - The projector contacts no relay until pairing is started (or the tab was paired before a reload),
    and publishes nothing while no phone is connected.
  - `wavesol serve` and `dev` serve `__wavesol/serve.json` and a local relay; the page uses them when
    present, so a hotspot setup needs no internet.

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
- Exit: a talk with a Lean proof that can be explored and stepped through on the static site (changed
  from "Mathlib-based": a core-Lean proof is enough to show the feature; Mathlib needs nothing extra).
- Tests:
  - Unit: the SubVerso reader against committed fixtures from the pinned version.
  - End-to-end: hover a token, click a tactic, step through a proof.
  - CI: a job with elan that builds the docs talk's Lean project.
- **Status: done** (2026-10-24). `type: lean` nodes show a declaration or ANCHOR region with Lean's
  highlighting, hovers (signature, docstring) and an infoview (goals before/after the selected tactic,
  right of or below the code). Space steps through the tactics (or named PROOF_STATEs); clicking a
  tactic shows its goals. The docs talk has a "Lean proofs" topic with two proofs from `docs/lean`.
  Tests: the reader against fixtures from the pinned SubVerso (`tests/fixtures/lean`, incl. anchors
  inside proofs, nested `by`, bullets, namespaces); the build through real lake (steps, named states,
  missing source/anchor/state, Lean errors at their file:line; skipped without elan unless
  `REQUIRE_LEAN=1`, which CI sets); end-to-end: step through a proof, click a tactic, hover a constant.
  CI installs elan and caches the toolchain and SubVerso builds; the talk template's workflow does so
  only when the talk has `lean/` (and runs `lake exe cache get` with Mathlib).
  Decisions made along the way:
  - Lean runs at build time (not committed output): `lake build +Mod:highlighted` per module, memoised
    in-process on a hash of the Lean sources, lake config and toolchain; across runs lake's own traces
    make a no-op build take ~0.4 s. Pinned: Lean v4.35.0, SubVerso `verso-v4.35.0`.
  - Before-states: SubVerso records only after-states, flat in source order (case arms and bullets as
    their own entries, `rw` rules nested). Before = the previous entry's after-state at the same level,
    or the parent's before for a first nested entry; case arms and bullets have no before (they open a
    goal). Steps are the innermost entries except `by`, so `rw [a, b]` steps rule by rule.
  - Hovers on brackets, `=>` and commas are dropped (their docstrings are noise).
  - Code and infoview shrink their font to fit the node rather than scrolling or wrapping.

### Phase 5 — Academic content and polish
- `tikz` plugin (and inline tikz-cd in slides): latex → dvisvgm → SVG, cached; TeX in CI.
- Citations: `\cite{key}` from `refs.bib` (citation-js), auto `references` node.
- Dark theme variant, theme docs. Transition fine-tuning.
- Layout drag mode in `wavesol dev` that writes pins back to `talk.yaml`.
- `AGENTS.md` v1 with idioms and complete examples for every node type.
- Tests: unit tests for TikZ and citation rendering, skipped with a clear message when TeX is missing;
  CI installs TeX.
- **Status: done** (2026-10-24), without PDF page figures (dropped: not needed). TikZ: ` ```tikz ` /
  ` ```tikzcd ` fences in slides and `type: tikz` nodes, drawn by `pdflatex` + `pdftocairo` at build time
  and cached in `<talk>/.wavesol/cache/`. Citations: `[@key]`, `[@key, p. 3]`, `[@a; @b]` from
  `refs.bib` in author–year (APA) style via citation-js, with the full reference as a tooltip, and a
  `references` node placed in `talk.yaml`. `academic-dark` theme (Shiki dual themes, Lean token colours
  as variables, TikZ in the theme's ink). Drag mode in `wavesol dev` (`d`) writes `pin` into
  `talk.yaml`. AGENTS.md v1 with idioms and complete, checked examples. Tests: TikZ document/SVG/error
  parsing and real LaTeX runs (skipped without TeX unless `REQUIRE_TEX=1`, set in CI), citation syntax
  and formatting, check fixtures (unknown keys, missing bibliography, no references node), pin writing
  and the world → layout-space inverse; end-to-end: TikZ and citations in the docs, the dark theme,
  drag mode against a real dev server. Transitions were left as they are: nothing concrete to tune.
  Decisions made along the way:
  - `pdftocairo` instead of `dvisvgm` (not installed here, so its route could not be tested). The SVG
    is post-processed for inlining: black → `currentColor`, ids prefixed per figure (glyph ids clash
    otherwise), size in em with 10pt = 1em so TikZ text matches the slide.
  - Citation syntax `[@key]` (Pandoc's, already in the spec), not `\cite{}`; the references node is
    placed by the author, not added automatically.
  - Pins are written by editing only the node's entry text in talk.yaml (comments and alignment kept).
    Inside a frame, a dragged node keeps its place relative to its siblings; the frame re-fits.

### Phase 6 — Audience polls
- Audience join page via QR. The presenter's browser is the hub over the existing transport.
- `poll` node plugin: multiple choice, live histogram on the projector, results in the presenter view.
- Exit: run a poll with ~30 phones in a seminar room.
- Tests: end-to-end with ~30 simulated audience connections answering a poll.
- **Status: done** (2026-10-24), except the exit's run with ~30 real phones in a seminar room.
  `type: poll` nodes: question (body) and options; step 0 shows the options and the number of votes,
  Space reveals a bar per option (`results: live`: from the start). A join QR code on the poll slide,
  `j` for a full-size one; the audience page (`?audience#k=…`) shows the poll on screen, one vote per
  phone (voter id kept in localStorage), changeable. The presenter view always shows the results; votes
  survive a projector reload (sessionStorage). Tests: unit (votes per voter, changing votes, only the
  poll on screen and valid options, closing/reopening, a phone and the projector reloading); end to end
  with 30 simulated phones (network clients through the test server's relay) plus two browser phones:
  counts, changed votes, presenter before the reveal, reveal, closing; and that the audience's code
  cannot drive the talk.
  Decisions made along the way:
  - The audience has its own room (secret, topic), separate from the controller's: its QR code is
    public, and in that room the projector only takes votes. Same transport (relay, WebRTC upgrade);
    the network layer became generic over its message type.
  - Results are revealed with Space by default, so early votes don't sway later ones.

### Later / maybe
- Animations: choose between manim pre-rendered video with `next_section()` steps (+ alpha video for
  overlays) and a JS-native animation plugin, possibly both (video first). Includes overlays: a node or
  layer drawn on top of another node (e.g. an animation over a slide).
- External plugin loading (per-talk `plugins/`, then npm).
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
- **Running TypeScript via tsx:** keeps the package build-free, but every CLI start compiles on the
  fly and talks depend on a git dependency. Publish compiled JS to npm once the format stabilises.
