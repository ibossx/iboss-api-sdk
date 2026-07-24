# Workflows

Drop a workflow in this directory and it is automatically available to:

- the CLI — `npx iboss workflows list`, `npx iboss run <name>`
- the optional web UI — it appears as a runnable card with a generated form

## Anatomy

A workflow is a TypeScript file (`workflows/my-flow.ts`) or folder
(`workflows/my-flow/index.ts`) that default-exports `defineWorkflow({...})`:

```ts
import { defineWorkflow } from "@iboss/sdk";
import { z } from "zod";

export default defineWorkflow({
  name: "my-flow",                       // kebab-case, unique
  description: "One line shown in listings and UI cards.",
  inputs: z.object({
    domains: z.array(z.string()).describe("Domains to process"),
    dryRun: z.boolean().default(false).describe("Preview without applying"),
  }),
  async run(ctx, input) {
    ctx.log("starting…");                       // live output
    ctx.progress("create-policy", "start");     // step tracking
    const layers = await ctx.client.policies.listLayers();
    ctx.progress("create-policy", "done");
    return { layerCount: layers.length };       // shown as the result
  },
});
```

- `inputs` is a [zod](https://zod.dev) schema. `.describe()` text becomes CLI
  help and UI form labels. Defaults and optionals work as expected.
- `ctx.client` is a connected `IbossClient` scoped to the selected account —
  see `docs/api/` for everything it can do.
- Set `multiAccount: true` and use `ctx.forEachAccount(fn)` to fan out across
  every account configured in the profile. An API key belongs to exactly one
  account, so a multi-account profile lists one key per account
  (see `iboss.config.example.json`).
- Honor `ctx.signal` in long loops so cancellation works.

## Running

```sh
npx iboss run my-flow --input domains=a.example.com,b.example.com --input dryRun=true
npx iboss run my-flow --input-json '{"domains":["a.example.com"]}'
npx iboss run my-flow --profile lab --account 1002
```

The shipped workflows are worked examples — copy one as a starting point:

- `hello-account` — connectivity check, session details
- `block-domains` — idempotent create-if-missing pattern on one account
- `block-domains-fleet` — the same change applied to every account in the
  profile (`multiAccount` + `ctx.forEachAccount`)
