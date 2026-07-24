import type { z } from "zod";
import type { WorkflowDefinition } from "./types.js";

/**
 * Identity helper that gives workflow authors full type inference:
 *
 * ```ts
 * import { defineWorkflow } from "@iboss/sdk";
 * import { z } from "zod";
 *
 * export default defineWorkflow({
 *   name: "block-domains",
 *   description: "Add domains to a blocklist policy layer.",
 *   inputs: z.object({
 *     domains: z.array(z.string()).describe("Domains to block"),
 *   }),
 *   async run(ctx, input) {
 *     // input is fully typed from the schema
 *   },
 * });
 * ```
 */
export function defineWorkflow<S extends z.ZodType>(
  definition: WorkflowDefinition<S>,
): WorkflowDefinition<S> {
  return definition;
}
