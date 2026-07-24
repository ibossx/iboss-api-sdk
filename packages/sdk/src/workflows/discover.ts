/**
 * Workflow discovery — scans a directory for workflow modules and loads them.
 *
 * Layouts supported:
 *   workflows/<name>.ts          (single file)
 *   workflows/<name>/index.ts    (folder)
 *
 * A malformed workflow never crashes discovery: it is reported as a warning
 * so listing keeps working while someone (or an AI) is mid-edit on a new file.
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { WorkflowDefinition } from "./types.js";

// Duck-typed schema check (rather than instanceof) so workflows keep working
// even if a second copy of zod ends up in the module graph.
function isZodLike(v: unknown): v is z.ZodType {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { parse?: unknown }).parse === "function" &&
    typeof (v as { safeParse?: unknown }).safeParse === "function"
  );
}

const workflowShape = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case"),
  description: z.string().min(1),
  inputs: z.custom<z.ZodType>(isZodLike, "inputs must be a zod schema"),
  multiAccount: z.boolean().optional(),
  run: z.custom<(...args: unknown[]) => unknown>((v) => typeof v === "function", "run must be a function"),
});

export interface DiscoveredWorkflow {
  workflow: WorkflowDefinition;
  /** Absolute path of the module the workflow was loaded from. */
  file: string;
}

export interface DiscoveryWarning {
  file: string;
  message: string;
}

export interface DiscoveryResult {
  workflows: DiscoveredWorkflow[];
  warnings: DiscoveryWarning[];
}

function isWorkflowFile(name: string): boolean {
  return (
    (name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".js") || name.endsWith(".mjs")) &&
    !name.endsWith(".test.ts") &&
    !name.endsWith(".d.ts")
  );
}

function candidateFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      for (const index of ["index.ts", "index.mts", "index.js", "index.mjs"]) {
        try {
          if (statSync(join(full, index)).isFile()) {
            files.push(join(full, index));
            break;
          }
        } catch {
          // try next index candidate
        }
      }
    } else if (st.isFile() && isWorkflowFile(entry) && !/^readme/i.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/** Load and validate every workflow under `dir`. */
export async function discoverWorkflows(dir: string): Promise<DiscoveryResult> {
  const workflows: DiscoveredWorkflow[] = [];
  const warnings: DiscoveryWarning[] = [];
  const seen = new Map<string, string>();

  for (const file of candidateFiles(resolve(dir))) {
    let moduleExports: Record<string, unknown>;
    try {
      moduleExports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error) {
      warnings.push({ file, message: `Failed to load: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const candidate = moduleExports.default;
    if (!candidate) {
      warnings.push({ file, message: "No default export — export default defineWorkflow({...})" });
      continue;
    }
    const parsed = workflowShape.safeParse(candidate);
    if (!parsed.success) {
      warnings.push({
        file,
        message: `Not a valid workflow: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      });
      continue;
    }
    const workflow = candidate as WorkflowDefinition;
    const existing = seen.get(workflow.name);
    if (existing) {
      warnings.push({ file, message: `Duplicate workflow name "${workflow.name}" (already defined in ${existing})` });
      continue;
    }
    seen.set(workflow.name, file);
    workflows.push({ workflow, file });
  }

  workflows.sort((a, b) => a.workflow.name.localeCompare(b.workflow.name));
  return { workflows, warnings };
}
