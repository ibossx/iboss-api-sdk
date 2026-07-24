/**
 * Workflow framework types.
 *
 * A workflow is a small TypeScript module in the repo-root `workflows/`
 * directory that default-exports defineWorkflow({...}). Workflows are
 * auto-discovered by the CLI (`iboss workflows list`, `iboss run <name>`) and
 * by the optional web UI — write once, run anywhere.
 */
import type { z } from "zod";
import type { IbossClient } from "../client/IbossClient.js";
import type { AccountInfo } from "../client/session.js";

export interface WorkflowDefinition<S extends z.ZodType = z.ZodType> {
  /** Unique kebab-case id, e.g. "block-domains". Used by the CLI and UI. */
  name: string;
  /** One or two sentences shown in listings and on UI cards. */
  description: string;
  /**
   * Zod object schema describing the workflow's inputs. Use .describe() on
   * each field — descriptions become CLI help and UI form labels.
   */
  inputs: S;
  /**
   * When true, the workflow uses ctx.forEachAccount to run against every
   * account configured in the profile (an API key is scoped to one account,
   * so a multi-account profile holds one key per account).
   */
  multiAccount?: boolean;
  run(ctx: WorkflowContext, input: z.infer<S>): Promise<unknown>;
}

export interface WorkflowContext {
  /** Connected client scoped to the selected account. */
  client: IbossClient;
  account: AccountInfo;
  /** Print a line to the run output (CLI stdout / UI live log). */
  log(message: string): void;
  /** Report a named step's status for progress displays. */
  progress(step: string, status: "start" | "done" | "fail", detail?: string): void;
  /**
   * Run a function once per account configured in the profile (one API key
   * per account), each with its own isolated client/context. Failures are
   * collected per account, never aborting the rest. Returns
   * accountSettingsId (or the account's configured name on connect failure)
   * → result | Error.
   */
  forEachAccount<T>(fn: (ctx: WorkflowContext) => Promise<T>): Promise<Map<string, T | Error>>;
  /** Fires when the user cancels the run (Ctrl-C / UI cancel). */
  signal: AbortSignal;
}

export type WorkflowEvent =
  | { type: "log"; message: string }
  | { type: "progress"; step: string; status: "start" | "done" | "fail"; detail?: string }
  | { type: "started"; workflow: string; account: string }
  | { type: "finished"; status: "success" | "error"; error?: string };

export interface WorkflowRunResult {
  status: "success" | "error";
  result?: unknown;
  error?: Error;
  startedAt: Date;
  finishedAt: Date;
}
