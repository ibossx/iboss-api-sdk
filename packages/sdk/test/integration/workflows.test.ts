import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AccountCredential } from "../../src/config/profiles.js";
import { defineWorkflow } from "../../src/workflows/define.js";
import { discoverWorkflows } from "../../src/workflows/discover.js";
import { runWorkflow } from "../../src/workflows/runner.js";
import type { WorkflowEvent } from "../../src/workflows/types.js";
import {
  CLOUD_HOST,
  MOCK_API_KEY,
  MOCK_API_KEY_2,
  PRIMARY_ACCOUNT_ID,
  SECOND_ACCOUNT_ID,
} from "../mock-server/fixtures.js";
import { createMockState, mockFetch, type MockState } from "../mock-server/mockIboss.js";

const primaryCred: AccountCredential = { name: "hq", domain: CLOUD_HOST, apiKey: MOCK_API_KEY };
const secondCred: AccountCredential = { name: "branch", domain: CLOUD_HOST, apiKey: MOCK_API_KEY_2 };

const runOpts = (state: MockState, accounts: AccountCredential[]) => ({
  accounts,
  clientOptions: { fetch: mockFetch(state) },
});

describe("runWorkflow", () => {
  it("validates input, connects, runs, and emits lifecycle events", async () => {
    const events: WorkflowEvent[] = [];
    const workflow = defineWorkflow({
      name: "echo",
      description: "Echoes its input.",
      inputs: z.object({ message: z.string() }),
      async run(ctx, input) {
        ctx.log(`got: ${input.message}`);
        ctx.progress("echo", "done");
        return { echoed: input.message, account: ctx.account.accountSettingsId };
      },
    });

    const result = await runWorkflow({
      workflow,
      input: { message: "hello" },
      ...runOpts(createMockState(), [primaryCred]),
      onEvent: (e) => events.push(e),
    });

    expect(result.status).toBe("success");
    expect(result.result).toEqual({ echoed: "hello", account: PRIMARY_ACCOUNT_ID });
    expect(events.some((e) => e.type === "started")).toBe(true);
    expect(events).toContainEqual({ type: "log", message: "got: hello" });
    expect(events.at(-1)).toEqual({ type: "finished", status: "success" });
  });

  it("returns a field-level error for invalid input without connecting", async () => {
    const workflow = defineWorkflow({
      name: "strict",
      description: "Requires a number.",
      inputs: z.object({ count: z.number() }),
      async run() {
        return null;
      },
    });
    const result = await runWorkflow({
      workflow,
      input: { count: "not-a-number" },
      ...runOpts(createMockState(), [primaryCred]),
    });
    expect(result.status).toBe("error");
    expect(result.error?.message).toMatch(/count/);
  });

  it("selects the primary account by name", async () => {
    const workflow = defineWorkflow({
      name: "whoami",
      description: "Reports the primary account.",
      inputs: z.object({}),
      async run(ctx) {
        return ctx.account.accountSettingsId;
      },
    });
    const result = await runWorkflow({
      workflow,
      input: {},
      ...runOpts(createMockState(), [primaryCred, secondCred]),
      account: "branch",
    });
    expect(result.status).toBe("success");
    expect(result.result).toBe(SECOND_ACCOUNT_ID);
  });

  it("forEachAccount runs one key per account with isolated sessions and collects failures", async () => {
    const workflow = defineWorkflow({
      name: "fleet",
      description: "Runs across all configured accounts.",
      inputs: z.object({}),
      multiAccount: true,
      async run(ctx) {
        const results = await ctx.forEachAccount(async (sub) => {
          if (sub.account.accountSettingsId === SECOND_ACCOUNT_ID) {
            throw new Error("branch boom");
          }
          return sub.account.accountSettingsId;
        });
        return Object.fromEntries(
          [...results.entries()].map(([id, v]) => [id, v instanceof Error ? `error: ${v.message}` : v]),
        );
      },
    });

    const state = createMockState();
    const result = await runWorkflow({ workflow, input: {}, ...runOpts(state, [primaryCred, secondCred]) });
    expect(result.status).toBe("success");
    expect(result.result).toEqual({
      [PRIMARY_ACCOUNT_ID]: PRIMARY_ACCOUNT_ID,
      [SECOND_ACCOUNT_ID]: "error: branch boom",
    });
    // Both keys authenticated independently (each sees exactly its account).
    const mySettingsCalls = state.requests.filter((r) => r.includes("mySettings"));
    expect(mySettingsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("visits each account once even when two credentials resolve to the same account", async () => {
    const duplicateCred: AccountCredential = { name: "hq-dup", domain: CLOUD_HOST, apiKey: MOCK_API_KEY };
    let runs = 0;
    const events: WorkflowEvent[] = [];
    const workflow = defineWorkflow({
      name: "fleet-dupes",
      description: "Duplicate entries must not double-process an account.",
      inputs: z.object({}),
      multiAccount: true,
      async run(ctx) {
        const results = await ctx.forEachAccount(async (sub) => {
          runs++;
          return sub.account.accountSettingsId;
        });
        return Object.fromEntries(results);
      },
    });
    const result = await runWorkflow({
      workflow,
      input: {},
      ...runOpts(createMockState(), [primaryCred, duplicateCred, secondCred]),
      onEvent: (e) => events.push(e),
    });
    expect(result.status).toBe("success");
    expect(runs).toBe(2); // hq and branch; hq-dup skipped
    expect(result.result).toEqual({
      [PRIMARY_ACCOUNT_ID]: PRIMARY_ACCOUNT_ID,
      [SECOND_ACCOUNT_ID]: SECOND_ACCOUNT_ID,
    });
    const skip = events.find(
      (e) => e.type === "progress" && e.step === "account:hq-dup" && e.detail?.includes("skipped"),
    );
    expect(skip).toBeDefined();
  });

  it("keys connect failures by the account's configured name", async () => {
    const badCred: AccountCredential = { name: "revoked", domain: CLOUD_HOST, apiKey: "wrong-key" };
    const workflow = defineWorkflow({
      name: "fleet-bad-key",
      description: "One key is invalid.",
      inputs: z.object({}),
      multiAccount: true,
      async run(ctx) {
        const results = await ctx.forEachAccount(async (sub) => sub.account.accountSettingsId);
        return Object.fromEntries(
          [...results.entries()].map(([id, v]) => [id, v instanceof Error ? "error" : v]),
        );
      },
    });
    const result = await runWorkflow({
      workflow,
      input: {},
      ...runOpts(createMockState(), [primaryCred, badCred]),
    });
    expect(result.status).toBe("success");
    expect(result.result).toEqual({
      [PRIMARY_ACCOUNT_ID]: PRIMARY_ACCOUNT_ID,
      revoked: "error",
    });
  });
});

describe("discoverWorkflows", () => {
  it("loads valid workflows and reports broken files as warnings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iboss-workflows-"));

    // Fixtures use a zod-shaped stub so the temp dir needs no node_modules.
    const fakeSchema = `const schema = { parse: (v) => v ?? {}, safeParse: (v) => ({ success: true, data: v }) };`;

    // Valid single-file workflow.
    writeFileSync(
      join(dir, "good.mjs"),
      `${fakeSchema}
export default {
  name: "good-workflow",
  description: "A valid workflow.",
  inputs: schema,
  run: async () => "ok",
};`,
    );

    // Valid folder workflow.
    mkdirSync(join(dir, "folder-flow"));
    writeFileSync(
      join(dir, "folder-flow", "index.mjs"),
      `${fakeSchema}
export default { name: "folder-flow", description: "Folder layout.", inputs: schema, run: async () => 1 };`,
    );

    // Broken: no default export.
    writeFileSync(join(dir, "broken-no-export.mjs"), `export const nope = 1;`);
    // Broken: syntax error.
    writeFileSync(join(dir, "broken-syntax.mjs"), `export default {{{`);
    // Ignored: README.
    writeFileSync(join(dir, "README.md"), "# docs");

    const { workflows, warnings } = await discoverWorkflows(dir);
    expect(workflows.map((w) => w.workflow.name)).toEqual(["folder-flow", "good-workflow"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/default export|Failed to load/);
  });
});
