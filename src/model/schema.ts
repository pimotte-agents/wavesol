// Source-format schemas (spec/FORMAT.md). JSON Schemas in schema/ are generated from these.
import { z } from "zod";

export const NODE_ID = /^[a-z0-9][a-z0-9_-]*$/;
export const NodeId = z.string().regex(NODE_ID, "node ids match [a-z0-9][a-z0-9_-]*");

export const TransitionName = z.enum(["fly", "cut", "fade", "zoom-through"]);
export const Transition = z.union([
  TransitionName,
  z.strictObject({
    type: TransitionName,
    duration: z.number().positive().optional().describe("Milliseconds. Default for fly: scaled by distance."),
    easing: z.string().optional().describe("CSS easing keyword or cubic-bezier(...)."),
  }),
], { error: "expected fly, cut, fade, zoom-through, or { type, duration, easing }" });

const Direction = z.enum(["right", "down", "left", "up"]);
export const Layout = z.strictObject({
  algorithm: z.enum(["layered", "force", "grid", "manual"]).optional(),
  direction: Direction.optional(),
  spacing: z.number().positive().optional(),
  wrap: z.boolean().optional().describe("Layered: wrap long chains into rows (default true)."),
});

const Vec2 = z.tuple([z.number(), z.number()]);

export const NodeEntry = z
  .looseObject({
    type: z.string().optional(),
    file: z.string().optional(),
    title: z.string().optional(),
    children: z.array(NodeId).optional(),
    layout: Layout.optional(),
    pin: Vec2.optional(),
    size: Vec2.optional(),
    scale: z.number().positive().optional(),
    near: z
      .union([
        z.strictObject({ "left-of": NodeId }),
        z.strictObject({ "right-of": NodeId }),
        z.strictObject({ above: NodeId }),
        z.strictObject({ below: NodeId }),
      ])
      .optional(),
    transition: Transition.optional(),
  })
  .describe("Graph and placement fields; plugin-specific fields belong in the node file's frontmatter.");

export const EdgeOptions = z.strictObject({
  label: z.string().optional(),
  default: z.boolean().optional(),
  transition: Transition.optional(),
});

const EDGE_KEY = /^\s*[a-z0-9][a-z0-9_-]*(\s*->\s*[a-z0-9][a-z0-9_-]*)+\s*$/;
const EdgeKey = z.string().regex(EDGE_KEY, 'edges look like "a -> b" or "a -> b -> c"');
export const EdgeItem = z.union([
  EdgeKey,
  z.record(EdgeKey, EdgeOptions).refine((r) => Object.keys(r).length === 1, "one edge chain per list item"),
]);

const IceServer = z.strictObject({
  urls: z.union([z.string(), z.array(z.string())]).describe("stun:… or turn:… URL(s)"),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const TikzOptions = z.strictObject({
  packages: z.array(z.string()).optional().describe("Extra LaTeX packages (tikz-cd is added when a picture uses it)."),
  libraries: z.array(z.string()).optional().describe("TikZ libraries, as for \\usetikzlibrary."),
  preamble: z.string().optional().describe("Raw LaTeX preamble lines, e.g. \\definecolor."),
});

export const Sync = z.strictObject({
  phone: z.boolean().optional().describe("Phone controller (default true). false: no relay is ever contacted."),
  relays: z
    .array(z.string().regex(/^(mqtt|nostr|room):wss?:\/\/.+$/, "expected mqtt:, nostr: or room: followed by a ws:// or wss:// URL"))
    .optional()
    .describe("Relays for pairing a phone and as fallback, replacing the built-in public ones. `room:` is a self-hosted relay (Cloudflare Worker)."),
  ice: z.array(IceServer).optional().describe("Extra ICE servers for WebRTC, e.g. a TURN server; added to the default STUN servers."),
});

export const Talk = z.strictObject({
  $schema: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()).optional(),
  date: z.union([z.string(), z.date()]).optional(),
  venue: z.string().optional(),
  start: NodeId.optional(),
  theme: z
    .strictObject({
      base: z.enum(["academic-light", "academic-dark"]).optional().describe("Built-in theme."),
      accent: z.string().optional(),
      vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .optional(),
  transitions: z.strictObject({ default: Transition.optional() }).optional(),
  layout: Layout.optional(),
  math: z.strictObject({ macros: z.string().optional() }).optional(),
  bibliography: z.string().optional().describe("BibTeX file for [@key] citations; default refs.bib if it exists."),
  head: z
    .string()
    .optional()
    .describe("HTML file that wavesol build adds to the page's <head>, e.g. an analytics script; wavesol dev leaves it out."),
  sync: Sync.optional(),
  pdf: z
    .union([
      z.boolean(),
      z.strictObject({
        file: z.string().regex(/^[\w.-]+\.pdf$/, "a file name ending in .pdf").optional().describe("default: talk.pdf"),
        steps: z.enum(["last", "all"]).optional().describe("last (default): a page per node; all: a page per step"),
      }),
    ])
    .optional()
    .describe("wavesol build also writes a PDF next to the site (needs Playwright with Chromium)."),
  tikz: TikzOptions.optional().describe("LaTeX setup for all TikZ pictures (tikz nodes and ```tikz fences)."),
  nodes: z.record(NodeId, NodeEntry.nullable()).refine((r) => Object.keys(r).length > 0, "at least one node"),
  edges: z.array(EdgeItem).default([]),
});
export type Talk = z.infer<typeof Talk>;

// Frontmatter. Each plugin extends the common fields.
export const CommonFrontmatter = z.strictObject({
  type: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

export const SlideFrontmatter = CommonFrontmatter.extend({
  type: z.literal("slide").optional(),
  fragments: z.enum(["lists", "walkthrough"]).optional(),
});

export const ImageFrontmatter = CommonFrontmatter.extend({
  type: z.literal("image"),
  src: z.string(),
  caption: z.string().optional(),
  fit: z.enum(["contain", "cover"]).optional(),
});

export const LeanFrontmatter = CommonFrontmatter.extend({
  type: z.literal("lean"),
  source: z.string().describe("Path relative to lean/."),
  anchor: z.string().optional(),
  decl: z.string().optional(),
  steps: z.union([z.enum(["tactics", "none"]), z.array(z.string())]).optional(),
  infoview: z.enum(["right", "below"]).optional(),
}).refine((f) => (f.anchor === undefined) !== (f.decl === undefined), "give exactly one of anchor or decl");

export const FrameFrontmatter = CommonFrontmatter.extend({ type: z.literal("frame") });

export const PollFrontmatter = CommonFrontmatter.extend({
  type: z.literal("poll"),
  options: z.array(z.string()).min(2, "a poll needs at least two options").max(9, "at most 9 options").describe("The answers (Markdown)."),
  results: z.enum(["reveal", "live"]).optional().describe("reveal (default): Space shows the results; live: shown from the start."),
});

export const ReferencesFrontmatter = CommonFrontmatter.extend({ type: z.literal("references") });

export const TikzFrontmatter = CommonFrontmatter.extend({
  type: z.literal("tikz"),
  caption: z.string().optional(),
  ...TikzOptions.shape,
});

export const frontmatterSchemas = {
  slide: SlideFrontmatter,
  frame: FrameFrontmatter,
  image: ImageFrontmatter,
  lean: LeanFrontmatter,
  tikz: TikzFrontmatter,
  references: ReferencesFrontmatter,
  poll: PollFrontmatter,
} as const;

export interface Edge {
  from: string;
  to: string;
  label?: string;
  default?: boolean;
  transition?: z.infer<typeof Transition>;
}

/** Expand one `edges` list item (already schema-validated) into individual edges. */
export function expandEdgeItem(item: z.infer<typeof EdgeItem>): Edge[] {
  const [key, opts] = typeof item === "string" ? [item, {}] : Object.entries(item)[0]!;
  const ids = key.split("->").map((s) => s.trim());
  return ids.slice(1).map((to, i) => ({ from: ids[i]!, to, ...opts }));
}
