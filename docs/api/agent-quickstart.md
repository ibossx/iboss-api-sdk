# Agent API quickstart

Copy-paste TypeScript for the purpose-named SDK surfaces. **SDK-only** —
this repo does not change lockboxLinux / Gateway / reporter. Wire paths
today are still `/json/controls/policyLayers*` and
`/ibreports/web/aiSecurityGovernance/conversations`.

Deep dives: [resource-policies.md](resource-policies.md) (settings,
destinations, create), [policies-by-kind.md](policies-by-kind.md),
[ai-governance-conversations.md](ai-governance-conversations.md),
[errors-and-gotchas.md](errors-and-gotchas.md).

```ts
import { IbossClient } from "@iboss/sdk";

const client = IbossClient.fromEnv(); // IBOSS_API_KEY + IBOSS_CLOUD_DOMAIN
// or: IbossClient.fromProfile()
await client.connect();
```

Never put an API key in a script, chat, or commit. Use `fromEnv()` /
`fromProfile()` / `npx iboss init`. Placeholders only:
`<API_KEY>`, `api.ibosscloud.com`, `admin@example.com`.

## Create + verify

`createResourcePolicy` is PUT structure → POST settings → **re-GET**.
The return value is the effective GET, not the POST 200 / ids.
`createLayer()` still returns ids only — do not hand-roll the two-step.

Default `type` is `"categories"` so destinations are expressable.
Allowlist/blocklist + destinations throws `IbossPolicyTypeError` before
any write (allowlist recreate silently drops the bitmap).

```ts
const policy = await client.policies.createResourcePolicy({
  name: "AI Security",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  settings: {
    aiRiskEnabled: 1,
    aiRiskEngines: "chatgpt",
    linkPolicyToAllSubjects: 1,
  },
});
// policy = { customCategoryId, customCategoryNumber, destinations, settings }
```

POST success (including empty `saveIgnoredEntries`) is **not** persistence.
A failed re-GET throws `IbossVerifyError`.

## Destinations (`AI_SERVICES`)

Agents never invent the 400-char `categories` bitmap or
`categoriesSelectedType`. `AI_SERVICES` is **bit 110** + type `0`
(UI “Selected Destinations”). Allowlist + categories **rejects** by
default (`onWrongType: "warn"` skips the write — never silent drop).

```ts
await client.policies.putResourcePolicyDestinations(policy.customCategoryId, {
  mode: "selectedWebCategories",
  categories: ["AI_SERVICES"],
});

// same body:
await client.policies.ensureAiSecurityDestination(policy.customCategoryId);

const destinations = await client.policies.getResourcePolicyDestinations(
  policy.customCategoryId,
);
// { mode: "selectedWebCategories", categories: ["AI_SERVICES"] }
```

`setDestination` is an alias of `putResourcePolicyDestinations`.

## Settings patch (`transport: "auto"`)

Send only changed fields. Omitted keys — including every `catN` /
`prioN` / `bypassSslMitmN` member and the bitmap — keep prior values.

Default `transport: "auto"`:

1. Native `PATCH` (DEVELOP-34921, live on lab gateways).
2. If PATCH is 404/405, GET → deep-merge → **full** POST (DEVELOP-34914).

POST `?merge=1` is `transport: "merge-post"` **opt-in only**. `auto`
must not send it: a pre-34921 gateway ignores `merge` and wipe-on-omits.

```ts
const settings = await client.policies.patchResourcePolicySettings(
  policy.customCategoryId,
  { aiRiskEnabled: 1, aiRiskEngines: "all" },
  // transport: "auto" is the default
);

const summary = await client.policies.getResourcePolicySettings(
  policy.customCategoryId,
); // hides generated families; pass { view: "full" } for the wire blob
```

`updateLayerSettings(fullBlob)` remains the full-replace API. Do not
use it for one-field updates.

## List policies by kind

Do not guess `typeFilter=9` or choose between `resourcePolicies` and
`policyLayers/all`. Use a purpose-named `kind`.

```ts
const dlp = await client.policies.listPolicies({ kind: "dlp" });
const ai = await client.policies.listPolicies({ kind: "aiSecurity" });
const resource = await client.policies.listPolicies({ kind: "resource" });
// also: "layer" | "connector" | "privateAccess" | "all"
// "internet" is an alias of "resource"

// dlp.items[0] = { id, number, name, kind, enabled, customType?, flags }
// dlp.filter documents the wire mapping that produced the list

const sameDlp = await client.policies.listDlpPolicies();
const sameAi = await client.policies.listAiSecurityPolicies();
```

`kind: "resource"` includes AI Security policies and excludes Private
Access. Use `kind: "aiSecurity"` for the AI subset only.

`listLayers` and `listResourcePolicies` are unchanged raw lists.

## Governance conversations

Reporter tier, discovered at `connect()`. Separate from policy-kind
lists. Time base is **UTC**. Newly finished chats are often missing
for ~**15 minutes** (reporter lag, not a bad id). `items` is always an
array. List rows have `messages: []` — use `get` for bodies. Domains
and bodies are redacted (`[REDACTED]`).

```ts
const listed = await client.governance.listAiConversations({
  since: "2026-09-10T04:00:00.000Z", // or Date; YYYY-MM-DD = UTC midnight
  until: new Date(),
  vendor: "chatgpt", // slug or wire CHAT_GPT — not "ChatGPT Enterprise"
  textContains: "payroll", // substring on topic/preview only, max 256
});

const detail = await client.governance.getAiConversation(listed.items[0].id);
// detail.messages[] lives here

await client.governance.waitForAiConversation(listed.items[0].id, {
  timeoutMs: 16 * 60 * 1000,
  intervalMs: 15_000, // do not busy-loop
});
```

Default list window is the last 24 hours UTC; get-by-id defaults to the
last 30 days. Do not hand-roll `intervalStartTime` epochs or send this
path to the gateway/cloud host.

## Don't

| Don't | Do |
|---|---|
| Invent the 400-char `categories` bitmap or `categoriesSelectedType` | `destinations: { mode, categories: ["AI_SERVICES"] }` |
| Patch destinations onto an allowlist/blocklist | Recreate as `type: "categories"` (GET `customType` 3 or 13) |
| Trust POST/PATCH 200 or empty `saveIgnoredEntries` | Use create/patch/put — they re-GET or throw `IbossVerifyError` |
| `updateLayerSettings` with a partial body | `patchResourcePolicySettings` (`auto`) |
| Guess `typeFilter=9` / pick a list endpoint | `listPolicies({ kind })` |
| Hand-roll reporter `intervalStartTime` | `listAiConversations({ since, until })` |
| Treat conversation 404 as a bad id in the first ~15m | `waitForAiConversation` |
| Print or commit API keys | `fromEnv()` / `fromProfile()` / `npx iboss init` |
