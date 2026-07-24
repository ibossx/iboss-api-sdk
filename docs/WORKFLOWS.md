# Workflow Authoring Reference

Workflows are the SDK's unit of automation: one file in `workflows/`,
runnable from the CLI (`npx iboss run <name>`) and the web UI (as a card with
a generated form). The quick version lives in
[workflows/README.md](../workflows/README.md); this is the full reference.

## Definition

```ts
import { defineWorkflow } from "@iboss/sdk";
import { z } from "zod";

export default defineWorkflow({
  name: "kebab-case-name",     // unique; the CLI/UI identifier
  description: "One sentence.",
  inputs: z.object({ ... }),   // zod schema — the single source of truth
  multiAccount: false,         // optional; enables fleet operations
  async run(ctx, input) { ... }
});
```

Discovery rules (`workflows/` is scanned by CLI and UI):

- `workflows/<name>.ts` or `workflows/<name>/index.ts`
- must **default-export** the `defineWorkflow(...)` result
- `*.test.ts`, `README*`, dotfiles ignored
- a malformed file never breaks discovery — it's listed as a warning with the
  reason (`npx iboss workflows list` shows it)

## Inputs

The zod schema drives everything:

| Schema feature | CLI effect | UI effect |
|---|---|---|
| `.describe("…")` | help text | field label/hint |
| `.default(v)` | optional flag | prefilled field |
| `z.number()` | `--input n=5` coerced | number input |
| `z.boolean()` | `--input x=true` coerced | checkbox |
| `z.array(z.string())` | comma-separated value | comma-separated text input |
| `z.enum([...])` | validated string | select dropdown |

Complex inputs can always be passed as JSON: `--input-json '{"a":1}'` or
`--input-json @inputs.json`.

## The context (`ctx`)

| Member | Purpose |
|---|---|
| `ctx.client` | Connected `IbossClient`, scoped to the selected account |
| `ctx.account` | `AccountInfo` — id, name, `isPrimary`, `subscriptionFlags` |
| `ctx.log(msg)` | Live output line (CLI stdout / UI log pane) |
| `ctx.progress(step, "start"\|"done"\|"fail", detail?)` | Step tracking |
| `ctx.forEachAccount(fn)` | Run `fn` once per account configured in the profile (one API key per account), each with an isolated sub-context |
| `ctx.signal` | `AbortSignal` — fires on Ctrl-C / UI cancel |

The `run()` return value is the workflow's **result**: shown after the CLI
run, rendered as JSON in the UI, and returned by `runWorkflow()` for
programmatic callers.

## Patterns

**Idempotency** — workflows get re-run; look before you create:

```ts
const layers = await ctx.client.policies.listLayers();
let layer = layers.find((l) => l.customCategoryName === input.layerName);
if (!layer) layer = await ctx.client.policies.createLayer({ ... });
```

**Dry run** — for bulk/destructive operations:

```ts
inputs: z.object({ dryRun: z.boolean().default(false).describe("Preview only") }),
// ...
if (input.dryRun) { ctx.log(`would delete ${stale.length} rules`); return { wouldDelete: stale.length }; }
```

**Cancellation** — check the signal in loops:

```ts
for (const item of items) {
  if (ctx.signal.aborted) break;
  await process(item);
}
```

**Multi-account fleets** — an API key belongs to exactly one account, so a
fleet is a profile with one key per account (`profiles.<name>.accounts` in
`iboss.config.json`). `forEachAccount` iterates those credentials with an
isolated client per account; failures are collected per account, never
aborting the rest:

```ts
multiAccount: true,
async run(ctx, input) {
  const results = await ctx.forEachAccount(async (sub) => {
    // sub.client / sub.account use THIS account's own key
    return doWork(sub);
  });
  // results: Map<accountSettingsId, T | Error>
  // (keyed by the account's configured name if its key failed to connect)
}
```

**Subscription-gated modules** — DLP/ZTNA calls throw
`IbossSubscriptionError` (HTTP 422) on unsubscribed accounts:

```ts
import { IbossSubscriptionError } from "@iboss/sdk";

if (!ctx.account.subscriptionFlags["ENABLE_DLP_POLICIES_DASHBOARD"]) {
  ctx.log("DLP not subscribed — skipping");
  return { skipped: true };
}
// or: try { ... } catch (e) { if (e instanceof IbossSubscriptionError) ... }
```

## Running

```sh
npx iboss run <name> \
  --input domains=a.example.com,b.example.com \
  --input dryRun=true \
  --profile lab \            # named profile
  --account 1002 \           # pin an account
  --json                     # machine-readable result
```

Programmatically:

```ts
import { runWorkflow, discoverWorkflows } from "@iboss/sdk";

const { workflows } = await discoverWorkflows("./workflows");
const target = workflows.find((w) => w.workflow.name === "block-domains")!;
const result = await runWorkflow({
  workflow: target.workflow,
  input: { domains: ["x.example.com"] },
  clientConfig: { domain: "...", credentials: { apiKey: "..." } },
  onEvent: (e) => console.log(e),
});
```
