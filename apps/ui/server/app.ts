/**
 * The UI's local API — a thin Hono layer over the same SDK engine the CLI
 * uses. Serves workflow listings (with JSON Schema for form generation),
 * run management with SSE progress, and profile CRUD.
 *
 * Security posture:
 *  - intended to bind 127.0.0.1 only (see main.ts / vite.config.ts)
 *  - stored API keys are never echoed back — reads return a masked suffix
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  accountsOfProfile,
  discoverWorkflows,
  loadConfigFile,
  runWorkflow,
  saveUserConfig,
  userConfigPath,
  IbossClient,
  type AccountCredential,
  type IbossConfigFile,
} from "@iboss/sdk";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, finishRun, getRun, listRuns, pushEvent, serializeRun } from "./runs.js";

function findWorkflowsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "workflows");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../workflows");
}

function maskKey(key: string): string {
  return key.length > 4 ? `••••••••${key.slice(-4)}` : "••••";
}

function loadUserConfig(): IbossConfigFile {
  return loadConfigFile(userConfigPath()) ?? { profiles: {} };
}

// An iboss API key is scoped to exactly one account, so a profile holds one
// credential per account. apiKey is optional on update: a blank key keeps the
// stored one (keys are write-only through this API).
const profileBody = z.object({
  domain: z.string().min(1),
  accounts: z
    .array(
      z.object({
        name: z.string().min(1),
        /** The stored name this row was loaded as — lets a rename keep its key. */
        originalName: z.string().optional(),
        apiKey: z.string().optional(),
        accountSettingsId: z.string().optional(),
        domain: z.string().optional(),
      }),
    )
    .min(1),
  makeDefault: z.boolean().optional(),
});

/** Test one account credential and summarize the session. */
async function testCredential(credential: AccountCredential) {
  try {
    const client = new IbossClient({
      domain: credential.domain,
      credentials: { apiKey: credential.apiKey },
      accountSettingsId: credential.accountSettingsId,
    });
    const session = await client.connect();
    return {
      name: credential.name,
      ok: true as const,
      account: session.account.accountName,
      accountSettingsId: session.account.accountSettingsId,
      gatewayHost: session.hosts.gateway,
      reporterHost: session.hosts.reporter,
      keyExpires: session.apiCredentialExpiresAt?.toISOString(),
    };
  } catch (error) {
    return {
      name: credential.name,
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createApiApp(): Hono {
  const app = new Hono();

  // --- workflows -----------------------------------------------------------

  app.get("/workflows", async (c) => {
    const dir = findWorkflowsDir();
    const { workflows, warnings } = await discoverWorkflows(dir);
    return c.json({
      dir,
      warnings,
      workflows: workflows.map(({ workflow, file }) => ({
        name: workflow.name,
        description: workflow.description,
        multiAccount: workflow.multiAccount ?? false,
        file,
        inputSchema: z.toJSONSchema(workflow.inputs as z.ZodType, { io: "input" }),
      })),
    });
  });

  // --- runs ------------------------------------------------------------------

  app.post("/runs", async (c) => {
    const body = await c.req.json<{
      workflow: string;
      input?: unknown;
      profile?: string;
      /** Account name within the profile (an API key maps to one account). */
      account?: string;
    }>();

    const { workflows } = await discoverWorkflows(findWorkflowsDir());
    const discovered = workflows.find((w) => w.workflow.name === body.workflow);
    if (!discovered) return c.json({ error: `Unknown workflow "${body.workflow}"` }, 404);

    const config = loadUserConfig();
    const profileName = body.profile ?? config.defaultProfile ?? Object.keys(config.profiles)[0];
    const profile = profileName ? config.profiles[profileName] : undefined;
    if (!profile || !profileName) {
      return c.json({ error: "No profile configured. Add one in Settings first." }, 400);
    }

    const run = createRun(discovered.workflow.name);

    void runWorkflow({
      workflow: discovered.workflow,
      input: body.input ?? {},
      accounts: accountsOfProfile(profile, profileName),
      account: body.account,
      signal: run.controller.signal,
      onEvent: (event) => pushEvent(run, event),
    }).then((result) => {
      finishRun(run, result.status, result.result, result.error?.message);
    });

    return c.json({ runId: run.id }, 201);
  });

  app.get("/runs", (c) => c.json(listRuns().map((run) => serializeRun(run))));

  app.get("/runs/:id", (c) => {
    const run = getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    return c.json(serializeRun(run, true));
  });

  app.post("/runs/:id/cancel", (c) => {
    const run = getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    run.controller.abort(new Error("Cancelled from UI"));
    return c.json({ ok: true });
  });

  /** SSE stream: replays buffered events then follows live ones. */
  app.get("/runs/:id/events", (c) => {
    const run = getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Run not found" }, 404);

    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });

      for (const stored of run.events) {
        await stream.writeSSE({ id: String(stored.seq), data: JSON.stringify(stored) });
      }

      if (run.status !== "running") {
        await stream.writeSSE({ event: "done", data: JSON.stringify(serializeRun(run)) });
        return;
      }

      await new Promise<void>((resolveWait) => {
        const listener = (stored: (typeof run.events)[number]) => {
          void stream
            .writeSSE({ id: String(stored.seq), data: JSON.stringify(stored) })
            .then(() => {
              if (stored.event.type === "finished") done();
            });
        };
        const done = () => {
          run.listeners.delete(listener);
          void stream
            .writeSSE({ event: "done", data: JSON.stringify(serializeRun(run)) })
            .then(() => resolveWait());
        };
        run.listeners.add(listener);
        const poll = setInterval(() => {
          if (closed || run.status !== "running") {
            clearInterval(poll);
            if (!closed) done();
            else {
              run.listeners.delete(listener);
              resolveWait();
            }
          }
        }, 1000);
      });
    });
  });

  // --- profiles ---------------------------------------------------------------

  app.get("/profiles", (c) => {
    const config = loadUserConfig();
    return c.json({
      configPath: userConfigPath(),
      defaultProfile: config.defaultProfile,
      profiles: Object.entries(config.profiles).map(([name, profile]) => {
        const accounts = accountsOfProfile(profile, name);
        return {
          name,
          domain: profile.domain,
          accounts: accounts.map((account) => ({
            name: account.name,
            domain: account.domain,
            accountSettingsId: account.accountSettingsId,
            apiKeyMasked: maskKey(account.apiKey),
          })),
        };
      }),
    });
  });

  app.put("/profiles/:name", async (c) => {
    const name = c.req.param("name");
    const parsed = profileBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const config = loadUserConfig();
    const existing = config.profiles[name];
    const existingAccounts = existing ? accountsOfProfile(existing, name) : [];

    // A blank apiKey keeps the stored key. Rows loaded from the existing
    // profile carry originalName, so a renamed account still finds its key.
    const accounts = [];
    for (const account of parsed.data.accounts) {
      const stored = existingAccounts.find(
        (a) => a.name === (account.originalName ?? account.name),
      );
      const apiKey = account.apiKey?.trim() || stored?.apiKey;
      if (!apiKey) {
        return c.json({ error: `Account "${account.name}" needs an API key` }, 400);
      }
      accounts.push({
        name: account.name,
        apiKey,
        ...(account.accountSettingsId ? { accountSettingsId: account.accountSettingsId } : {}),
        ...(account.domain && account.domain !== parsed.data.domain ? { domain: account.domain } : {}),
      });
    }

    config.profiles[name] =
      accounts.length === 1 && accounts[0]!.name === name && !accounts[0]!.domain
        ? {
            // Single account named after the profile: keep the simple shape.
            domain: parsed.data.domain,
            apiKey: accounts[0]!.apiKey,
            ...(accounts[0]!.accountSettingsId
              ? { accountSettingsId: accounts[0]!.accountSettingsId }
              : {}),
          }
        : { domain: parsed.data.domain, accounts };
    if (parsed.data.makeDefault || !config.defaultProfile) config.defaultProfile = name;
    saveUserConfig(config);
    return c.json({ ok: true });
  });

  app.delete("/profiles/:name", (c) => {
    const name = c.req.param("name");
    const config = loadUserConfig();
    if (!config.profiles[name]) return c.json({ error: "Profile not found" }, 404);
    delete config.profiles[name];
    if (config.defaultProfile === name) config.defaultProfile = Object.keys(config.profiles)[0];
    saveUserConfig(config);
    return c.json({ ok: true });
  });

  /**
   * Test a stored profile's credentials. `?account=<name>` tests one account;
   * without it, every account key in the profile is tested.
   */
  app.post("/profiles/:name/test", async (c) => {
    const name = c.req.param("name");
    const accountName = c.req.query("account");
    const config = loadUserConfig();
    const profile = config.profiles[name];
    if (!profile) return c.json({ error: "Profile not found" }, 404);

    const accounts = accountsOfProfile(profile, name);
    const targets = accountName ? accounts.filter((a) => a.name === accountName) : accounts;
    if (targets.length === 0) return c.json({ error: `Account "${accountName}" not found` }, 404);

    const results = [];
    for (const target of targets) results.push(await testCredential(target));
    const ok = results.every((r) => r.ok);
    return c.json({ ok, results }, ok ? 200 : 502);
  });

  return app;
}
