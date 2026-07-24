import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { z } from "zod";
import { runWorkflow } from "../../workflows/runner.js";
import { discoverWorkflows } from "../../workflows/discover.js";
import type { WorkflowEvent } from "../../workflows/types.js";
import { findWorkflowsDir, resolveCliProfile, type GlobalCliOptions } from "../context.js";
import { fail, info, ok, printJson } from "../render.js";

/**
 * Coerce `--input key=value` pairs through the workflow's zod schema:
 * numbers/booleans/arrays are parsed from the string form when the schema
 * expects them (comma-separated for arrays).
 */
function coerceInputs(schema: z.ZodType, pairs: Record<string, string>): Record<string, unknown> {
  const shape =
    schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodType>) : undefined;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(pairs)) {
    out[key] = coerceOne(shape?.[key], raw);
  }
  return out;
}

function unwrap(schema: z.ZodType | undefined): z.ZodType | undefined {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = (current as z.ZodOptional<z.ZodType>).unwrap() as z.ZodType;
  }
  return current;
}

function coerceOne(schema: z.ZodType | undefined, raw: string): unknown {
  const target = unwrap(schema);
  if (target instanceof z.ZodNumber) return Number(raw);
  if (target instanceof z.ZodBoolean) return raw === "true" || raw === "1" || raw === "yes";
  if (target instanceof z.ZodArray) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => coerceOne((target as z.ZodArray<z.ZodType>).element as z.ZodType, item));
  }
  return raw;
}

function renderEvent(event: WorkflowEvent): void {
  switch (event.type) {
    case "started":
      info(`▶ ${event.workflow} — account: ${event.account}`);
      break;
    case "log":
      info(`  ${event.message}`);
      break;
    case "progress": {
      const icon = event.status === "start" ? "…" : event.status === "done" ? "✔" : "✖";
      info(`  ${icon} ${event.step}${event.detail ? ` — ${event.detail}` : ""}`);
      break;
    }
    case "finished":
      break;
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command("run <workflow>")
    .description("run a workflow by name")
    .option("--input <key=value...>", "workflow input (repeatable)", collectPairs, {})
    .option("--input-json <json>", "workflow inputs as a JSON object (or @file.json)")
    .option("--dir <path>", "workflows directory (default: auto-detected)")
    .action(
      async (
        workflowName: string,
        cmdOpts: { input: Record<string, string>; inputJson?: string; dir?: string },
      ) => {
        const opts = program.opts<GlobalCliOptions>();
        const dir = cmdOpts.dir ?? findWorkflowsDir();
        const { workflows } = await discoverWorkflows(dir);
        const discovered = workflows.find((w) => w.workflow.name === workflowName);
        if (!discovered) {
          fail(
            `Workflow "${workflowName}" not found in ${dir}. ` +
              `Available: ${workflows.map((w) => w.workflow.name).join(", ") || "(none)"}`,
          );
          process.exitCode = 1;
          return;
        }
        const { workflow } = discovered;

        let input: unknown;
        if (cmdOpts.inputJson) {
          const text = cmdOpts.inputJson.startsWith("@")
            ? readFileSync(cmdOpts.inputJson.slice(1), "utf8")
            : cmdOpts.inputJson;
          input = JSON.parse(text);
        } else {
          input = coerceInputs(workflow.inputs, cmdOpts.input);
        }

        const profile = resolveCliProfile(opts);
        const controller = new AbortController();
        process.once("SIGINT", () => controller.abort(new Error("Cancelled")));

        const result = await runWorkflow({
          workflow,
          input,
          accounts: profile.accounts,
          account: profile.account.name,
          onEvent: opts.json ? undefined : renderEvent,
          signal: controller.signal,
        });

        if (opts.json) {
          printJson({
            workflow: workflow.name,
            status: result.status,
            result: result.result,
            error: result.error?.message,
            durationMs: result.finishedAt.getTime() - result.startedAt.getTime(),
          });
        } else if (result.status === "success") {
          ok(`${workflow.name} finished`);
          if (result.result !== undefined && result.result !== null) printJson(result.result);
        } else {
          fail(`${workflow.name} failed: ${result.error?.message}`);
        }
        if (result.status === "error") process.exitCode = 1;
      },
    );
}

function collectPairs(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) throw new Error(`--input expects key=value, got "${value}"`);
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}
