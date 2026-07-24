#!/usr/bin/env node
// CLI entry point. Registers tsx so the TypeScript sources (and workflows)
// run directly with no build step.
import { register } from "tsx/esm/api";

register();

const { main } = await import("../src/cli/main.ts");
await main(process.argv);
