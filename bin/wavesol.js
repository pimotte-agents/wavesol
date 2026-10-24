#!/usr/bin/env node
// Runs the TypeScript CLI directly through tsx, so the package works from a git checkout or git
// dependency without a build step.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli/main.ts");
main(process.argv.slice(2)).then((code) => process.exit(code));
