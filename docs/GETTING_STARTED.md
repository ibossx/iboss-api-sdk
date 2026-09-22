# Getting Started

## Prerequisites

- Node.js ≥ 18.14
- An iboss Zero Trust SSE account (platform version 10.1+) with admin access
- An **API key**, generated in the iboss admin console

## 1. Install

```sh
git clone <this-repo> && cd iboss-api-sdk
npm install
```

There is no build step — TypeScript runs directly via `tsx`.

## 2. Configure credentials

Pick one (checked in this order: environment, then project config, then user
config):

**Guided setup (recommended):**

```sh
npx iboss init
```

One paste-safe command: it asks for your cloud domain and one or more
account API keys (input hidden), saves them as a profile, verifies each key,
and prints the next steps. Add `--project` to write the repo-local
`iboss.config.json` instead of `~/.iboss/config.json`.

**Scripted / one-off key management:**

```sh
npx iboss accounts add hq --domain api.ibosscloud.com
# → prompts for the API key with input hidden, saves it to ~/.iboss/config.json
#   (owner-only permissions), and verifies it against the platform

npx iboss accounts add emea          # a NEW name adds another account's key:
                                     # the profile becomes multi-account automatically
npx iboss accounts add hq            # the SAME name updates that account's key
                                     # (e.g. after rotation) — it does not add a duplicate
npx iboss accounts list --verify     # connect with each key, show live status
npx iboss accounts remove emea       # remove a key (does not revoke it on the platform)
```

The name (`hq`, `emea`) labels one account inside the profile: one name per
account, one API key per name. Use `--profile <name>` to keep separate
environments (for example a `prod` profile and a `lab` profile, each with
its own account set).

Options: `--profile <name>` targets a named profile, `--project` writes the
repo-local `iboss.config.json` instead of the user-global file,
`--account-id <id>` pins an accountSettingsId, `--key <apiKey>` skips the
prompt (the prompt is preferred; it keeps keys out of shell history), and
`--no-verify` skips the connectivity check.

**Environment / .env** (for CI, or when you specifically want env-based
credentials):

```sh
cp .env.example .env
# then UNCOMMENT and fill BOTH lines in .env:
#   IBOSS_CLOUD_DOMAIN=api.ibosscloud.com
#   IBOSS_API_KEY=<your key>
# optional node overrides (normally discovered at connect()):
#   IBOSS_GATEWAY_HOST=gateway.node.example.invalid
#   IBOSS_REPORTER_HOST=reporter.node.example.invalid
```

`IbossClient.fromEnv()` reads those variables (and a local `.env`).
`IbossClient.fromProfile()` uses the same files as the CLI.

When both are set they take precedence over saved profiles (so CI can inject
credentials), and `auth test` tells you when that shadowing is happening.
Unedited placeholder values are ignored, so a fresh copy of `.env.example`
is inert.

**By hand** — the same files the CLI writes, if you prefer editing directly:
project-local `iboss.config.json` or user-global `~/.iboss/config.json`:

```jsonc
{
  "defaultProfile": "prod",
  "profiles": {
    "prod": { "domain": "api.ibosscloud.com", "apiKey": "<key>" },
    "fleet": {
      "domain": "api.ibosscloud.com",
      "accounts": [
        { "name": "hq",   "apiKey": "<key for HQ>" },
        { "name": "emea", "apiKey": "<key for EMEA>" }
      ]
    }
  }
}
```

An iboss **API key belongs to exactly one account**, so a profile that spans
several accounts lists one credential per account. Select a profile with
`--profile fleet` and an account within it with `--account emea`; multi-account
workflows iterate all of the profile's accounts. Both files are gitignored /
outside the repo — **credentials are never committed**.

## 3. Verify

```sh
npx iboss auth test
```

This validates the key, selects your primary account, discovers the gateway
and reporter node hosts, and prints the key's expiry.

## 4. First calls

```sh
npx iboss accounts list                       # accounts the key can manage
npx iboss run hello-account                   # first workflow
npx iboss api GET /ibcloud/web/users/mySettings   # raw API escape hatch
```

As a library:

```ts
import { IbossClient } from "@iboss/sdk";

const client = IbossClient.fromEnv(); // or new IbossClient({ domain, credentials: { apiKey } })
await client.connect();
console.log(await client.groups.listFilteringGroups());
```

Runnable scripts live in [examples/](../examples/):
`npx tsx examples/01-list-accounts.ts`.

## 5. Where next

- Build automation → [WORKFLOWS.md](WORKFLOWS.md) and [workflows/README.md](../workflows/README.md)
- Understand the platform's API model → [ARCHITECTURE.md](ARCHITECTURE.md)
- Find endpoints → [api/README.md](api/README.md)
- Prefer clicking → `npm run ui` opens the web UI on `http://127.0.0.1:5173`

## Using an AI editor

Open this repo in Claude Code / Cursor and describe what you want, e.g.
*"Create a workflow that adds a list of domains to the allowlist across all of
our accounts."* The repo ships `AGENTS.md` (read by Cursor and other tools;
imported by `CLAUDE.md` for Claude) and `.claude/skills/` that teach
the AI the SDK's conventions, so it can build, list, and run the workflow for
you.
