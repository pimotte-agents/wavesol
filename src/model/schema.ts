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
]);

const Direction = z.enum(["right", "down", "left", "up"]);
export const Layout = z.strictObject({
  algorithm: z.enum(["layered", "force", "grid", "manual"]).optional(),
  direction: Direction.optional(),
  spacing: z.number().positive().optional(),
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
    rank: z.int().nonnegative().optional(),
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
      base: z.enum(["academic-light", "academic-dark"]).optional(),
      accent: z.string().optional(),
      vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .optional(),
  transitions: z.strictObject({ default: Transition.optional() }).optional(),
  layout: Layout.optional(),
  math: z.strictObject({ macros: z.string().optional() }).optional(),
  bibliography: z.string().optional(),
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
  fragments: z.enum(["lists"]).optional(),
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

export const frontmatterSchemas = {
  slide: SlideFrontmatter,
  image: ImageFrontmatter,
  lean: LeanFrontmatter,
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
