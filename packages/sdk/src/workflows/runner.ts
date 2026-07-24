/**
 * Workflow runner — the single engine behind both the CLI and the web UI.
 * Each surface supplies its own event sink (console renderer vs SSE stream).
 *
 * Multi-account: an iboss API key is scoped to exactly one account, so a
 * fleet is a list of AccountCredential entries (one key per account).
 * ctx.forEachAccount iterates that list with an isolated client per account.
 */
import type { z } from "zod";
import { IbossClient } from "../client/IbossClient.js";
import type { IbossClientConfig } from "../client/config.js";
import type { AccountInfo } from "../client/session.js";
import type { AccountCredential } from "../config/profiles.js";
import type { WorkflowContext, WorkflowDefinition, WorkflowEvent, WorkflowRunResult } from "./types.js";

export interface RunWorkflowOptions {
  workflow: WorkflowDefinition;
  /** Raw input — validated against workflow.inputs before run() is called. */
  input: unknown;
  /**
   * The profile's accounts (one credential per account). The first entry —
   * or the one named by `account` — is the primary the workflow runs against;
   * ctx.forEachAccount iterates all of them.
   */
  accounts: AccountCredential[];
  /** Select the primary account by name (or accountSettingsId). */
  account?: string;
  /** Extra client options applied to every account's client (fetch, logger, retry). */
  clientOptions?: Partial<Omit<IbossClientConfig, "domain" | "credentials" | "accountSettingsId">>;
  /** Receives log/progress/lifecycle events as the run executes. */
  onEvent?: (event: WorkflowEvent) => void;
  signal?: AbortSignal;
}

function clientFor(credential: AccountCredential, opts: RunWorkflowOptions): IbossClient {
  return new IbossClient({
    domain: credential.domain,
    credentials: { apiKey: credential.apiKey },
    accountSettingsId: credential.accountSettingsId,
    ...opts.clientOptions,
  });
}

function pickPrimary(accounts: AccountCredential[], requested?: string): AccountCredential {
  if (!requested) return accounts[0]!;
  const match =
    accounts.find((a) => a.name === requested) ??
    accounts.find((a) => a.accountSettingsId === requested);
  if (!match) {
    throw new Error(
      `Account "${requested}" is not configured. Available: ${accounts.map((a) => a.name).join(", ")}`,
    );
  }
  return match;
}

export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const startedAt = new Date();
  const emit = opts.onEvent ?? (() => {});
  const signal = opts.signal ?? new AbortController().signal;

  try {
    if (!opts.accounts.length) throw new Error("No accounts configured for this run.");
    const input = (opts.workflow.inputs as z.ZodType).parse(opts.input ?? {});

    const primary = pickPrimary(opts.accounts, opts.account);
    const client = clientFor(primary, opts);
    const session = await client.connect();

    emit({
      type: "started",
      workflow: opts.workflow.name,
      account: session.account.accountName ?? primary.name,
    });

    const ctx = buildContext(client, session.account, emit, signal, opts);
    const result = await opts.workflow.run(ctx, input);

    emit({ type: "finished", status: "success" });
    return { status: "success", result, startedAt, finishedAt: new Date() };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    emit({ type: "finished", status: "error", error: err.message });
    return { status: "error", error: err, startedAt, finishedAt: new Date() };
  }
}

function buildContext(
  client: IbossClient,
  account: AccountInfo,
  emit: (event: WorkflowEvent) => void,
  signal: AbortSignal,
  opts: RunWorkflowOptions,
): WorkflowContext {
  return {
    client,
    account,
    signal,
    log: (message) => emit({ type: "log", message }),
    progress: (step, status, detail) => emit({ type: "progress", step, status, detail }),
    async forEachAccount<T>(fn: (ctx: WorkflowContext) => Promise<T>): Promise<Map<string, T | Error>> {
      const results = new Map<string, T | Error>();
      // Two credentials can resolve to the same account (duplicate profile
      // entries, or two valid keys for one account). Visit each account once.
      const visited = new Map<string, string>(); // accountSettingsId -> credential name
      for (const credential of opts.accounts) {
        if (signal.aborted) break;
        emit({ type: "progress", step: `account:${credential.name}`, status: "start" });
        // Keyed by accountSettingsId once known; the configured name is the
        // fallback when connect itself fails.
        let resultKey = credential.name;
        try {
          // A fresh client per credential: separate key, separate cookie jar.
          const scoped = clientFor(credential, opts);
          const session = await scoped.connect();
          resultKey = session.account.accountSettingsId || credential.name;
          const duplicateOf = visited.get(session.account.accountSettingsId);
          if (duplicateOf) {
            emit({
              type: "progress",
              step: `account:${credential.name}`,
              status: "done",
              detail: `skipped: same account (${session.account.accountSettingsId}) as "${duplicateOf}"`,
            });
            continue;
          }
          visited.set(session.account.accountSettingsId, credential.name);
          const subCtx = buildContext(scoped, session.account, emit, signal, opts);
          const value = await fn(subCtx);
          results.set(resultKey, value);
          emit({ type: "progress", step: `account:${credential.name}`, status: "done" });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          results.set(resultKey, err);
          emit({
            type: "progress",
            step: `account:${credential.name}`,
            status: "fail",
            detail: err.message,
          });
        }
      }
      return results;
    },
  };
}
