// Generate schema/*.schema.json from src/model/schema.ts. `--check` fails if they are out of date.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { Talk, frontmatterSchemas } from "../src/model/schema.ts";

const outputs: Record<string, z.ZodType> = {
  "talk.schema.json": Talk,
  ...Object.fromEntries(Object.entries(frontmatterSchemas).map(([k, s]) => [`frontmatter-${k}.schema.json`, s])),
};

const check = process.argv.includes("--check");
let stale = false;
mkdirSync("schema", { recursive: true });
for (const [file, schema] of Object.entries(outputs)) {
  const json = JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }), null, 2) + "\n";
  const path = `schema/${file}`;
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== json) {
      console.error(`${path} is out of date; run npm run schema`);
      stale = true;
    }
  } else writeFileSync(path, json);
}
if (stale) process.exit(1);
