# iboss API SDK — AI Assistant Guide

This repo is a TypeScript SDK for the iboss Zero Trust SSE platform. Users
clone it and ask you to build **workflows** (automation against the iboss API).
Everything runs directly with `tsx` — there is **no build step**.

## The golden path: "build me a workflow"

When the user describes an automation they want:

0. **Check setup first.** Run `npm install` if `node_modules/` is missing,
   then `npx iboss auth test --json`. If it fails because no credentials are
   configured, pause and get setup done before building:
   - The user must provide their API key via `npx iboss init` — never
     through the chat (the key must not enter the conversation or its logs).
   - You MAY run credential-hygiene commands yourself — `npx iboss accounts
     list --verify`, `npx iboss accounts remove <name>` (e.g. to clean up a
     duplicate entry) — they never expose or require key values. Only
     entering a key is the user's step.
   - If your environment has an interactive terminal the user can type into
     (Cursor's terminal, Claude Cowork's terminal), ask permission and then
     launch `npx iboss init` there so the user only has to type the key at
     the hidden prompt.
   - Otherwise, give them this to paste into their own terminal, then
     continue once they say it's done:

     ```sh
     cd <repo-directory>
     npx iboss init
     ```

1. **Find the right APIs.** Check [docs/api/README.md](docs/api/README.md) —
   the index maps each doc to its admin-console section — then read the
   specific doc (e.g.
   [docs/api/resource-policies.md](docs/api/resource-policies.md)). The
   sub-client sources in `packages/sdk/src/api/` are the ground truth for
   method signatures. Note the platform has four policy types that share one
   wire shape (Resource Policies, Private Access, Policy Layers, Connector
   Policies) — the index's type table disambiguates.
2. **Create `workflows/<kebab-name>/index.ts`** that default-exports
   `defineWorkflow({...})`. Copy the shape from
   [workflows/block-domains/index.ts](workflows/block-domains/index.ts).
   - `inputs` is a zod schema; put `.describe()` on every field (it becomes CLI
     help and UI form labels). Use `.default()` where sensible.
   - Use `ctx.log()` / `ctx.progress()` for output, honor `ctx.signal` in loops.
   - For fleet-wide operations set `multiAccount: true` and use
     `ctx.forEachAccount()`. An API key belongs to exactly one account, so
     fleets need a profile with one key per account (`profiles.<name>.accounts`
     in iboss.config.json — see iboss.config.example.json).
3. **Verify and run it yourself:** `npx iboss workflows list` (it appears,
   no warnings), then `npx iboss run <name> --input k=v` (add `--json` when
   you need to parse the result). The user should not have to open a
   terminal for work you can execute.
   - If the user did not provide required inputs (e.g. the actual domains),
     dry-run with placeholders if the workflow supports it, then ASK for the
     real inputs and run it yourself when they answer. Never end by telling
     the user to run a command — offer to run it and wait for their inputs
     or their go-ahead.
   - For mutations across many accounts, a one-line confirmation of what
     will change (and where) before the real run is good practice.
4. **Credentials are the one step the USER does in their own terminal.** If
   `npx iboss auth test` fails with no credentials configured, ask the user
   to run `npx iboss init` themselves. Never ask the user to paste an API
   key into the chat, and never write keys into files — the hidden prompt in
   their terminal keeps the key out of the conversation and its logs.

## Repo map

```
packages/sdk/src/client/   IbossClient, auth, discovery, request layer, errors
packages/sdk/src/api/      feature-area sub-clients (policies, dlp, ssl, ...)
packages/sdk/src/workflows/ defineWorkflow, discovery, runner
packages/sdk/src/cli/      the `iboss` CLI
workflows/                 user workflows (auto-discovered) ← new workflows go HERE
docs/api/                  per-feature endpoint docs with payload shapes & gotchas
apps/ui/                   optional web UI (never required by library/CLI)
examples/                  small runnable library scripts
```

## Platform knowledge you need

- **Auth:** the API key IS the bearer — `Authorization: Token <key>` on every
  request. `client.connect()` validates it and discovers the per-account hosts.
- **Three host tiers** (the SDK routes automatically): cloud
  (`/ibcloud/web/...`), gateway node (`/json/...`), reporter node
  (`/ibreports/web/...`). Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Policy creation is two-step** (create structure → apply settings).
  `client.policies.createLayer()` wraps it — don't hand-roll it.
- **Typed errors:** `IbossAuthError` (bad key), `IbossXsrfError` (403 —
  usually XSRF, not permissions), `IbossSubscriptionError` (422 — account
  lacks the module; check `ctx.account.subscriptionFlags`). See
  [docs/api/errors-and-gotchas.md](docs/api/errors-and-gotchas.md).
- **Unwrapped endpoints:** use `client.raw(tier, method, path, opts)` or
  `client.raw(method, path)` (tier inferred from `/json` vs `/ibreports`
  vs `/ibcloud`). To wrap a new endpoint properly, follow the
  `add-api-client` skill.
- **Agent Resource Policy helpers:** `IbossClient.fromEnv()` /
  `fromProfile()`; `patchResourcePolicySettings` (get-merge-post, re-GET);
  `setDestination` / `ensureAiSecurityDestination` (bit 110, type 0 —
  never send the categories bitmap). See docs/api/resource-policies.md.
- **Repeatable org procedures:** when the user describes a recurring runbook
  (not a one-off automation), package it with the `create-skill` skill so it
  becomes a reusable recipe in `.claude/skills/`.

## Commands

```sh
npm test                          # secret scan + full test suite (mock iboss)
npm run typecheck                 # strict TS across packages
npx iboss init                    # guided credential setup (use for first-time users)
npx iboss auth test               # verify user credentials
npx iboss accounts add <name>     # store an account API key (prompted, hidden input)
npx iboss accounts list --verify  # connect with each configured key
npx iboss workflows list          # discovery check
npx iboss run <name> --input k=v  # run a workflow
npx iboss api GET <path>          # raw API escape hatch
npm run ui                        # optional web UI (127.0.0.1:5173)
```

## Hard rules

- **Never commit credentials** — no API keys, tokens, or session values in any
  file, test, doc, or example. `.env` and `iboss.config.json` are gitignored;
  keep it that way. `npm test` runs a secret scan that must stay green.
- Use placeholders in docs/examples: `<API_KEY>`, `api.ibosscloud.com`,
  `admin@example.com`, hosts like `gateway.node.example.invalid`.
- Never hardcode gateway/reporter node hostnames — they are discovered at
  runtime via `client.connect()`.
- Workflows must default-export `defineWorkflow({...})` with a kebab-case
  `name` unique across `workflows/`.
- Don't print raw API keys; if you must show one (e.g. after rotation), tell
  the user to store it immediately.
