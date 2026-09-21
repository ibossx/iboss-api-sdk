# Agent-friendly APIs — discovery findings & proposed design

**Status:** discovery / proposal only. No runtime API or SDK method
behavior changes in this pass.
**Epic:** [DEVELOP-34912](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34912)
**Audience:** platform + SDK implementers, and agents that consume this
repo.

This document inventories how the iboss API SDK is laid out and consumed,
names the APIs that are painful for agents, and proposes **non-breaking**
remedies (new sibling paths, split APIs, additive fields, or SDK wrapper
helpers). Existing wire APIs stay as they are.

Child tickets already filed under the epic:

| Ticket | Slice |
|---|---|
| [DEVELOP-34913](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34913) | Client defaults — auth, gateway/reporter routing, `aiRiskEngines` |
| [DEVELOP-34914](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34914) | Resource-policy dedicated get + patch UPDATE |
| [DEVELOP-34915](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34915) | Friendly list/query — DLP/AI policies + Governance conversations |
| [DEVELOP-34916](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34916) | Typed destinations — hide `categories` bitmap / `categoriesSelectedType` |

---

## Constraints (must hold for every recommendation)

1. **No breaking changes** to existing paths, methods, request shapes, or
   SDK symbols.
2. If a rename is needed without an additive change, **create a new API**
   (path and/or SDK method) and leave the old one in place.
3. Prefer **splitting** overloaded endpoints into clearer new ones.
4. Keep existing **path naming conventions** (`/json/controls/…`,
   `/ibcloud/web/…`, `/ibreports/web/…`). New endpoints should be siblings
   of the current ones, not a parallel namespace.

Two layers of remedy are used throughout:

| Layer | When to use | Ships in |
|---|---|---|
| **SDK wrapper** | The platform already has the data; agents just cannot assemble the ritual safely | this repo (`@iboss/sdk`) |
| **New sibling path** | The existing path is the wrong noun, is overloaded, or cannot express a patch/filter without a giant blob | gateway / reporter / cloud, then wrapped here |

SDK wrappers can ship first and later become thin clients of a sibling
path. That is the intended sequence.

---

## 1. SDK inventory

### What this repo is

A **TypeScript** monorepo (`iboss-api-sdk`, package `@iboss/sdk`, Node
≥ 18.14, ESM, `"type": "module"`). There is **no build step** — the
package export is `./src/index.ts` and the CLI runs via `tsx`. APIs are
**hand-written wrappers**, not generated from OpenAPI. Documentation is
hand-written markdown under `docs/api/`, organized to match the admin
console, not a generated spec.

```
packages/sdk/src/client/    IbossClient, auth, discovery, request, errors
packages/sdk/src/api/       12 feature-area sub-clients (hand-written)
packages/sdk/src/workflows/ defineWorkflow, discovery, runner
packages/sdk/src/cli/       the `iboss` CLI
packages/sdk/src/config/    profiles / iboss.config.json
workflows/                  user automations (auto-discovered)
docs/api/                   per-feature endpoint docs + gotchas
apps/ui/                    optional web UI (not required)
examples/                   small library scripts
```

Feature-area sub-clients on `IbossClient`:

| Property | File | Tier(s) |
|---|---|---|
| `account` | `api/account.ts` | cloud |
| `groups` | `api/groups.ts` | cloud |
| `locations` | `api/locations.ts` | cloud |
| `resources` | `api/resources.ts` | cloud |
| `policies` | `api/policies.ts` | gateway |
| `firewall` | `api/firewall.ts` | gateway |
| `apps` | `api/apps.ts` | gateway |
| `dlp` | `api/dlp.ts` | gateway |
| `ssl` | `api/ssl.ts` | gateway |
| `network` | `api/network.ts` | gateway |
| `directory` | `api/directory.ts` | gateway |
| `reporting` | `api/reporting.ts` | reporter |

Unwrapped endpoints go through `client.raw(tier, method, path, opts)` or
`npx iboss api <METHOD> <path>`.

### How APIs are defined (not generated)

Each sub-client extends `SubClient` (`api/base.ts`) and calls
`this.request(tier, method, path, { query, body })`. That funnels through
one `RequestLayer` which:

- resolves the host for `cloud` / `gateway` / `reporter` / `rbi` /
  `accounts`
- injects `Authorization: Token <key>`, `User-Agent: ibossAPI` (default),
  `Content-Type`, per-host cookies, and `X-XSRF-TOKEN` (required on
  **GETs too**)
- appends `accountSettingsId` automatically
- retries transport errors (and 5xx on idempotent methods)
- maps 401 → `IbossAuthError`, 403-on-mutation → `IbossXsrfError`,
  422 → `IbossSubscriptionError`, missing node →
  `IbossHostUnavailableError`

Types are TypeScript interfaces with large `[key: string]: unknown`
index signatures. There is no JSON Schema / OpenAPI artifact for agents
to load. Zod is used for **workflow inputs**, not for API payloads.

### Packaging and how a consumer (especially an agent) calls them

Three equivalent surfaces, one engine:

1. **Library** — `import { IbossClient } from "@iboss/sdk"` then
   `new IbossClient({ domain, credentials: { apiKey } })` →
   `await client.connect()` → `client.policies.listLayers()`.
2. **CLI** — `npx iboss run <workflow> --input k=v --json`,
   `npx iboss api GET /json/…`, `npx iboss auth test --json`. Global
   `--json` is the agent-friendly output mode.
3. **Workflow file** — `workflows/<kebab-name>/index.ts` default-exports
   `defineWorkflow({ name, inputs: z.object({…}), run })`. Discovery is
   automatic. This is the intended agent authoring path (`AGENTS.md`).

Credentials: an API key **is** the bearer. The library constructor
requires an explicit `domain` + `credentials`. The CLI resolves
`IBOSS_CLOUD_DOMAIN` / `IBOSS_API_KEY`, then `iboss.config.json`, then
`~/.iboss/config.json`. An API key sees exactly one account; fleets use
one key per account in a profile.

What the SDK already hides well (do not re-solve these):

- Host discovery (`connect()` walks clusters; never hardcode node DNS)
- XSRF / cookie jar per host
- Two-step policy **create** (`createLayer()`)
- Peer-create-then-poll (`createPeerAndFind()`)
- Resource-list filter defaults (the long `anchored=-1&…` query)
- PAC-zone list gotchas (`/pacZones` plural + `requestKey=v2`)
- Pagination of `GET /json/controls/policyLayers/all`
- Typed errors vs raw status codes

What remains agent-hostile lives mostly in **payload shape, overloaded
nouns, missing reads, and missing patch**.

---

## 2. Prioritized findings

Priority:

- **P0** — agents silently destroy state or cannot complete a common
  intent (create / update / target a resource policy) without tribal
  knowledge.
- **P1** — agents can get there, but only via overloaded filters,
  unwrapped reporter endpoints, or guesswork.
- **P2** — inconsistency and docs-for-humans that waste context and
  cause retries.

Each item names the current path / method / SDK symbol, why it hurts,
and a non-breaking remedy.

### P0-1 — Resource Policy settings live on the Policy Layers path

| | |
|---|---|
| **Current** | `GET /json/controls/policyLayers/settings?customCategoryId=` · `POST /json/controls/policyLayers/settings` |
| **SDK** | `client.policies.getLayerSettings(id)` · `updateLayerSettings(fullBlob)` |
| **Also listed as** | `GET /json/controls/resourcePolicies` (`listResourcePolicies`) — list only; no get/settings/update on that noun |

**Why it's painful.** The epic's example is exact: reading a Resource
Policy is a Policy Layers URL plus an opaque `customCategoryId`. Four
console objects (Resource Policies, Private Access routed policies,
Policy Layers, Connector Policies) share `/json/controls/policyLayers`.
Agents pick the wrong list (`listLayers` vs `listResourcePolicies`),
omit `isZeroTrustResourcePolicy: 1` / `dlpPolicyMethod: 2`, or POST a
partial body and wipe `cat0..cat110`, `prio0..prio110`,
`bypassSslMitm0..bypassSslMitm110`, and the 400-char `categories`
bitmap. Internal write-up
[Resource Policies and the API](https://ibosscybersecurity.atlassian.net/wiki/spaces/~649395834/pages/4007690273/Resource+Policies+and+the+API)
shows a one-shot PUT that returns success but never appears in the UI —
the two-step ritual is mandatory.

`createLayer()` already wraps create. **Update does not.** There is no
patch. There is no dedicated get that returns a Resource Policy as a
Resource Policy.

**Remedy (non-breaking).**

1. **SDK wrappers now** (DEVELOP-34914):
   - `getResourcePolicySettings(id)` → existing GET, typed/normalized.
   - `patchResourcePolicySettings(id, patch)` → GET current, deep-merge
     `patch`, re-inject generated field families unless `advanced: true`,
     POST the full blob to the existing settings path.
   - `createResourcePolicy({…})` → `createLayer({ isZeroTrustResourcePolicy: 1 })`
     then `getResourcePolicySettings` so the agent sees effective state.
2. **New sibling paths** (same `/json/controls/` convention):
   - `GET /json/controls/resourcePolicies/settings?customCategoryId=`
     (or `/json/controls/resourcePolicies/{id}/settings`)
   - `POST /json/controls/resourcePolicies/settings` as a documented
     alias of today's POST, plus
   - `POST /json/controls/resourcePolicies/settings/patch` (or `PATCH`
     on the same resource) that performs get-merge-post **on the
     gateway** so raw HTTP agents do not have to.

Do not change `/json/controls/policyLayers/settings`.

### P0-2 — Destinations are a bitmap + inverted enum

| | |
|---|---|
| **Current** | Settings fields `categories` (≈400-char `0`/`1` string), `categoriesSelectedType`, `cat0..cat110`, `customType` |
| **SDK** | `emptyCategoriesBitmap()`, `generateCategoryFields()` — generate the blob, do not interpret it |
| **Wire quirk** | Create takes `customType: "e_custom_category_type_*"` (string); GET returns `customType: 3` (number). `categoriesSelectedType: 0` means **Selected Destinations** (inverted vs the English). Bit 110 is AI Services. Recreating an allowlist without echoing `categories` silently drops the bitmap. |

**Why it's painful.** Agents invent the bitmap, flip the enum the wrong
way, or POST an allowlist recreate that drops AI-Services targeting.
This showed up in Bug Replicator / AI Chat testing (DEVELOP-34916).

**Remedy (non-breaking).**

- **SDK:** typed helpers, e.g.
  `setDestination({ mode: "selectedWebCategories", categories: ["AI_SERVICES"] })`,
  `ensureAiSecurityDestination(settings)`,
  `decodeCategoriesBitmap(bitmap) → string[]`. Reject or warn when
  `type: "allowlist"` is combined with a categories bitmap (those are
  different policy kinds). Keep `emptyCategoriesBitmap()` as-is.
- **New sibling (optional, later):**
  `POST /json/controls/resourcePolicies/settings/destinations` with
  `{ mode, categories: ["AI_SERVICES", …] }` that writes the bitmap
  server-side. Existing settings POST unchanged.

### P0-3 — Almost every update is full-echo (GET → mutate → POST whole object)

Applies beyond Resource Policies. Agents that send "just the field I
changed" wipe server-generated ids, watermarks, and unrelated flags.

| Current path | SDK symbol | Echo rule |
|---|---|---|
| `PUT /ibcloud/web/pacZone` | `locations.updatePacZone` | GET whole zone; echo `uuid`, watermark, cluster ids |
| `PUT /ibcloud/web/pacZone/default` | `updateDefaultPacZone` | same |
| `POST /ibcloud/web/groups/filtering` | `groups.updateFilteringGroup` | full group + Java `type` discriminator |
| `POST /json/users` | `directory.updateUser` | full user (`id` required) |
| `POST /json/computer` | `directory.updateDevice` | full device |
| `POST /json/network/proxy/settings` | `network.updateProxySettings` | **no GET wrapper** — agents must `raw()` first |
| `POST /json/network/sslDecryption/settings` | `ssl.updateSettings` | **no GET wrapper** |
| `POST /json/network/sslDecryption/domains` | `ssl.updateDomainBypass` | **no GET wrapper** |
| `POST /json/network/contentAnalysis/settings?mode=0` | `dlp.updateGeneralSettings` | full settings; `mode` selects DLP vs malware |
| `POST /json/controls/apps` | `apps.updateAppControls` | giant per-app flag map |
| `POST /json/network/mobileClients/settings` | `network.updateMobileClientSettings` | includes connector security key |

**Remedy.** Shared SDK helper `patchByGetMergePost(read, write, patch)`
used by new `patch*` methods on each sub-client. Existing `update*`
methods stay full-replace. Platform later: additive `PATCH` or
`…/settings/patch` siblings that do the merge server-side (DEVELOP-34912
description: "UPDATE support … pulls the existing JSON, combines with
the patched, and sends it to the normal POST").

Highest leverage after Resource Policies: PAC zones, proxy settings,
SSL settings, default policy groups.

### P0-4 — Library constructor has no env/profile defaults

| | |
|---|---|
| **Current** | `new IbossClient({ domain, credentials: { apiKey } })` — both required. CLI/profile resolution lives in `cli/context.ts`, not the client. |
| **Raw HTTP** | Every call needs `Authorization: Token …`, `User-Agent: ibossAPI`, cookies, `X-XSRF-TOKEN`, and the correct host. Cloud paths often `access.denied` with a key that works on gateway. Policy writes are gateway; conversations are reporter. |

**Why it's painful.** Agents that skip the SDK (or call `client.raw`
with the wrong `tier`) fail in ways that look like auth. `aiRiskEngines`
is free-form wherever it appears; unknown vendor strings fail late or
silently. DEVELOP-34913.

**Note:** the SDK request layer already injects headers, cookies, XSRF,
`accountSettingsId`, and host routing **once you use `IbossClient`**.
The gap is (a) constructing the client, (b) `raw()` tier selection,
(c) anything not wrapped (AI Risk / conversations).

**Remedy (non-breaking).**

- Additive `IbossClient.fromEnv()` / `fromProfile(name?)` that reads
  `IBOSS_CLOUD_DOMAIN` + `IBOSS_API_KEY` the same way the CLI does.
  Constructor stays explicit.
- `client.raw`: infer tier from path prefix (CLI `api` already does
  this) so `raw("GET", "/json/…")` cannot hit cloud.
- Clearer `IbossHostUnavailableError` / 403-on-GET messages that name
  the tier the path needed vs the tier used.
- `aiRiskEngines: "all" | KnownVendor[]` validated against a published
  vendor list (ChatGPT, Claude, Gemini, Copilot, Perplexity, …). Unknown
  values throw before the request.

No change to existing constructor signatures or header names.

---

### P1-1 — Policy lists are overloaded and filtered by magic integers

| | |
|---|---|
| **Current** | `GET /json/controls/policyLayers/all?isZeroTrustLayer=&typeFilter=&currentRow=&maxItems=&nameFilter=&…` (empty filter strings are **required**) |
| **SDK** | `listLayers({ isZeroTrustLayer?: -1\|0\|1, typeFilter?: number })` |
| **Overlap** | `GET /json/controls/resourcePolicies` → `listResourcePolicies()` — a second list of "resource-shaped" rows, including Private Access routed policies (`ztnaFlowPeerIds`) |
| **Magic** | `isZeroTrustLayer`: −1 all, 0 overlay layers, 1 resource policies. `typeFilter`: −1 all; agents have been using **`typeFilter=9` for DLP**. Connector policies are `customType === 12` after the fact. DLP *rules* are a different tree (`/json/contentAnalysisRules`). |

**Why it's painful.** "List DLP policies" and "list AI security
policies" are not nouns on the wire. Agents grep `listLayers` output or
guess `typeFilter`. Routed ZTNA policies appear in
`listResourcePolicies()` beside SaaS/Internet policies. DEVELOP-34915.

**Remedy.**

- **SDK:** `listPolicies({ kind: "resource" \| "layer" \| "connector" \| "privateAccess" \| "dlp" \| "aiSecurity" })` plus
  dedicated `listDlpPolicies()` / `listAiSecurityPolicies()` that apply
  the correct filter and distinguish `ztnaFlowPeerIds`. Keep
  `listLayers` / `listResourcePolicies` unchanged.
- **Sibling (optional):**
  `GET /json/controls/resourcePolicies?kind=dlp|aiSecurity|internet|privateAccess`
  with a stable `kind` enum. Do not change `/policyLayers/all`.

Document `typeFilter` values in `docs/api/policy-layers.md` even before
code lands (additive docs).

### P1-2 — Governance / AI conversations are unwrapped reporter UI endpoints

| | |
|---|---|
| **Current** | `GET /ibreports/web/reports/{reportId}/web/aiRisk` (stats + conversation list; `statType=CONVERSATION_STAT\|USER_STAT`, long query string) |
| | `GET /ibreports/web/reports/{reportId}/web/aiRisk/conversation` (one thread) |
| **SDK** | **none.** `client.reporting` wraps incidents, drill-down top-N, and URL logs only. |
| **UI source** | [Dashboard Controllers](https://ibosscybersecurity.atlassian.net/wiki/spaces/~628262babdf2f30067d2321a/pages/5046829057/Dashboard+Controllers) |

**Why it's painful.** Agents must first `GET /ibreports/web/reports/lite`
to learn `reportId`, then reproduce the dashboard query (time base
unclear, ~15 minute ingest lag, fuzzy match, list rows with **null
message bodies**, vendor tokens sometimes stuffed into `domain`). Hitting
cloud with the same key looks like permission failure. DEVELOP-34915.

**Remedy.**

- **SDK wrappers:** `reporting.listAiConversations({ since, until, vendor, textContains, reportId? })`,
  `reporting.getConversation(id, { reportId? })` (redact secrets in
  returned bodies), `waitForConversation({ id, timeoutMs })` that polls
  through the lag window. Resolve `reportId` internally via `listReports`.
- **Sibling (preferred for agents):**
  `GET /ibreports/web/aiConversations` and
  `GET /ibreports/web/aiConversations/{id}` that do not require a
  drill-down `reportId`, accept ISO `since`/`until`, and return message
  bodies on get (list may stay summary-only). Document eventual
  consistency (~15m) on both.
- Keep `/reports/{id}/web/aiRisk*` unchanged.

### P1-3 — Missing GET wrappers next to POST-only settings

Agents cannot read-before-write without `client.raw` and guessing the
path.

| POST (wrapped) | Missing GET |
|---|---|
| `POST /json/network/proxy/settings` (`updateProxySettings`) | `GET` same path — unwrapped |
| `POST /json/network/sslDecryption/settings` (`ssl.updateSettings`) | `GET` same path — unwrapped (docs already tell agents to `raw()`) |
| `POST /json/network/sslDecryption/domains` | no GET |
| `POST /json/network/mobileClients/ztnaFlowDhcpGateway` | no GET |
| `POST /ibcloud/web/preferences/updateReleaseSettings` | no GET |
| `POST /ibcloud/web/preferences/autoUpdateSettings` | no GET |

**Remedy.** Additive `getProxySettings()`, `ssl.getSettings()`,
`getDomainBypass()`, `getZtnaFlowDhcpGateway()`, etc., calling the
existing GET paths. Then the P0-3 `patch*` helpers can use them.
No new paths required unless a GET does not exist on the platform
(confirm per endpoint during implementation).

### P1-4 — Create rituals that are not one call (beyond policies)

| Current | SDK today | Remaining pain | Remedy |
|---|---|---|---|
| `PUT /json/network/mobileClients/peer` returns `{ message: "Success." }` — **no uuid** | `createPeerAndFind()` polls list | Agents still call `createPeer` from docs / raw | Document "use `createPeerAndFind`"; optional sibling `PUT …/peer` that returns `{ uuid }` (new response field is additive if old clients ignore it — prefer a new path `PUT …/peer/create` if the empty body must stay) |
| Resource: copy catalog → new uuid → associate | `resources.save` + `policies.associateResources` | Association needs **both** `customCategoryId` (query) and `customCategoryNumber` (body) and field name `resourceIds` | `policies.attachResources(policyId, uuids)` that looks up the number; keep `associateResources` |
| DLP rule then response | `createContentAnalysisRule` + `createPolicyResponse` | Rule id not visible for a few seconds | `createDlpRuleAndResponse` with retry; document 422 vs lag |
| Connector policy | `createLayerStructure` with `customType: 12` + group map | Not a first-class method; `customType` numeric vs string | `createConnectorPolicy({ platform, groups })` |

### P1-5 — Reporting is a two-step "find reportId, then metric"

| | |
|---|---|
| **Current** | `GET /ibreports/web/reports/lite?month=&year=&dailyReport=-1&reportingGroupId=-1` then `GET /ibreports/web/reports/{reportId}/web/{metric}` |
| **SDK** | `listReports()` + `topBlockedDomains(reportId, …)` etc. |
| **Paging** | `currentRowNumber` is **1-indexed** here; gateway lists use `currentRow` **0-indexed** |

**Remedy.** `reporting.topBlockedDomains({ month, year, … })` that
resolves the current report internally. Keep the `reportId` overloads.
Normalize paging in new helpers (`page` / `pageSize`, 0-based) without
changing the raw query names.

### P1-6 — 422 means both "no subscription" and "bad payload"

| | |
|---|---|
| **Current** | HTTP 422 → `IbossSubscriptionError` always, with optional `subscriptionFlags` |
| **Examples** | DLP without `ENABLE_DLP_POLICIES_DASHBOARD`; ZTNA without `ENABLE_PRIVATE_ACCESS`; also malformed settings |

**Remedy.** Do not change the class of existing throws. Add
`IbossValidationError extends IbossApiError` for 422 bodies that are
clearly schema/payload (when the platform later distinguishes, or when
the SDK can parse the body). Additive `error.code` field
(`subscription` \| `validation` \| `unknown`) on 422s. Docs: treat
subscription 422 as an expected skip, not a bug.

---

### P2-1 — Inconsistent list envelopes and identity names

Gateway lists usually `{ entries, totalCount }`; cloud lists are bare
arrays or `{ successful, result }`. Sub-clients normalize **some**
methods to arrays (`listLayers`, `listPacZones`, `resources.list`) and
**not others** (`reporting.listUrlLogEntries` returns the envelope;
`listReports` returns an array). Identity fields: `customCategoryId` /
`customCategoryNumber` (policies), `pacSettingsId` (locations),
`uuid` (resources, peers), `groupNumber` (filtering groups), `id`
(users, firewall). Console says "Resources"; paths say `zeroTrust`.
Console says "Default Policies"; API says `groups/filtering`. Devices
write `/json/computer` and list `/json/computers/static`.

**Remedy.** Additive docs table (below). New list helpers always return
`{ items, total?, nextPage? }`. Do not change existing return types.
Alias fields on new Resource Policy views: `{ id: customCategoryId, name: customCategoryName, … }`
**in addition to** the wire names.

### P2-2 — Query parameters that exist for the UI, not for agents

| Parameter | Where | Issue |
|---|---|---|
| `currentPolicyBeingEdited` | firewall, apps, SSL, mobile-client settings | Means "policy group number" |
| `mode=0` on content-analysis settings | DLP vs malware view | Integer selects product area |
| Required empty `nameFilter`, `domainFilter`, … | `policyLayers/all` | Omitted → platform error; SDK already sends `""` |
| `requestKey=v2` | PAC zones | Required; singular list path 500s |
| `dailyReport=-1`, `reportingGroupId=-1` | reports/lite | Sentinel "all" |
| `includeAllRecord=false` | URL log archives | Boolean-as-query, easy to invert |
| Resource list: `anchored`, `availability`, `confidentiality`, … all `-1` | `GET /ibcloud/web/zeroTrust/resource` | SDK defaults them; raw agents must copy the set |

**Remedy.** Wrappers already hide most of these. New methods take
`{ policyGroup }`, `{ view: "dlp" \| "malware" }`, `{ includeAll }`.
Document sentinels in `errors-and-gotchas.md`. No path changes.

### P2-3 — Giant untyped blobs and console-oriented docs

Settings objects (policy layer, app controls, geo-IP, SSL, resource
catalog entries) are `Record<string, unknown>` plus tens of unused
`show*` UI flags (see the Confluence payload: `showRegistrationInterval`,
`showPACUrl`, …). Docs are titled by **admin-console section** and tell
you to "GET first, modify, POST whole" — correct for humans, expensive
for an agent's context window.

**Remedy.** New agent views: `summary` (id, name, kind, enabled, action,
destinations, groups) vs `full` (wire blob). `getResourcePolicySettings`
defaults to `view: "summary"` and accepts `view: "full"`. Keep returning
the full blob from `getLayerSettings`. Add this proposal to the docs
index (done in this PR); later, per-feature docs get an "Agent quick
path" section pointing at the new symbols.

### P2-4 — Pagination and time bases are not one convention

| API | Cursor | Notes |
|---|---|---|
| `policyLayers/all` | `currentRow` + `maxItems`, 0-based | SDK pages internally; no caller-visible page token |
| PAC zones | `currentRowNumber` + `maxItemsToReturn`; `totalRecords` **unreliable** | SDK requests one large page (1000) |
| Resources | `currentRowNumber` + `maxItemsToReturn` (default 100) | Easy to silently truncate |
| URL logs / top-N | `currentRowNumber` **1-based** | Easy off-by-one vs gateway |
| AI Risk conversations | dashboard query + report clock | Unclear timezone / lag |

**Remedy.** New helpers use `{ page, pageSize }` or opaque `pageToken`.
Warn in logs when `items.length === pageSize`. Document reporter lag.
Do not change existing query parameter names.

### P2-5 — Side effects and "read-shaped" writes

Not many GETs mutate, but several **names** lie:

- `resources.save` is POST create-or-update (`/zeroTrust/resources/save`).
- `firewall.saveRule` is PUT create-or-update.
- `ssl.updateSettings` has no read pair.
- `connect()` issues five GETs including a reporter prime — fine, but
  agents that "just GET mySettings" never discover gateway/reporter.
- 403 on GET is session/XSRF, not permissions (`IbossApiError`, not
  `IbossXsrfError` — that class is mutations only). Agents mis-handle
  this.

**Remedy.** Additive aliases `createOrUpdateResource` / `upsertFirewallRule`.
Keep `save`. Document 403-on-GET in the agent quick path. Optional:
classify 403-on-GET as `IbossXsrfError` only if we can do it without
breaking `instanceof` checks — **do not**, unless we add a new subclass
used by new code paths.

---

## 3. Proposed agent surface (additive)

Target shape for agents. All names are new. Old symbols remain.

```ts
// Construction (P0-4)
IbossClient.fromEnv()
IbossClient.fromProfile(name?: string)

// Policies by kind (P1-1)
client.policies.listPolicies({ kind })
client.policies.listDlpPolicies()
client.policies.listAiSecurityPolicies()

// Resource Policy as its own noun (P0-1)
client.policies.getResourcePolicySettings(id, { view?: "summary" | "full" })
client.policies.patchResourcePolicySettings(id, patch)
client.policies.createResourcePolicy({ name, type, settings, destinations })
client.policies.attachResources(policyId, resourceUuids)

// Destinations without a bitmap (P0-2)
client.policies.setDestination(id, { mode, categories: ["AI_SERVICES"] })
decodeCategoriesBitmap / encodeCategoriesBitmap
ensureAiSecurityDestination(settings)

// Conversations (P1-2)
client.reporting.listAiConversations({ since, until, vendor, textContains })
client.reporting.getConversation(id)
client.reporting.waitForConversation({ id, timeoutMs })

// Generic patch (P0-3) — used by the methods above
// get → merge → post; never exposed as a replacement for update*
```

Proposed **sibling paths** (platform, existing paths untouched):

```
GET    /json/controls/resourcePolicies/settings?customCategoryId=
POST   /json/controls/resourcePolicies/settings/patch
GET    /json/controls/resourcePolicies?kind=dlp|aiSecurity|internet|privateAccess
POST   /json/controls/resourcePolicies/settings/destinations
GET    /ibreports/web/aiConversations
GET    /ibreports/web/aiConversations/{id}
```

Until those exist, SDK methods call today's paths.

---

## 4. What we will not do in follow-up slices

- Rename or remove `getLayerSettings`, `updateLayerSettings`,
  `createLayer`, `listLayers`, `listResourcePolicies`, `createPeer`,
  `associateResources`, or any existing path.
- Require OpenAPI generation as a blocker (hand-written wrappers stay;
  a later additive spec export is welcome).
- Put API keys in chat, docs, tests, or examples (placeholders only).
- Change 403-on-GET from `IbossApiError` to `IbossXsrfError` (breaking
  for `instanceof` callers).
- Collapse the four policy types onto one new path; we **split** them
  for agents while the wire family stays shared.

---

## 5. Next implementation slices

Suggested kickoff order. Each slice is independently mergeable and
non-breaking. Tickets in parentheses already exist.

1. **Resource Policy get + patch UPDATE** (DEVELOP-34914) —
   `getResourcePolicySettings` / `patchResourcePolicySettings` /
   `createResourcePolicy` in `policies.ts`; mock-server coverage that
   a partial patch cannot drop `cat*` / bitmap / `dlpPolicyMethod`.
   Platform sibling paths can land in parallel and the wrappers switch
   when present (try sibling, fall back to policyLayers).
2. **Typed destinations** (DEVELOP-34916) — category name ↔ bit index
   table (bit 110 = AI Services), `setDestination`, reject
   allowlist+bitmap. Depends on slice 1's get/patch.
3. **Friendly policy lists** (DEVELOP-34915, first half) —
   `listPolicies({ kind })`, `listDlpPolicies`, `listAiSecurityPolicies`;
   document `typeFilter` / `customType` integers.
4. **Governance conversations** (DEVELOP-34915, second half) — wrap
   `…/web/aiRisk` + `…/aiRisk/conversation`; `listAiConversations` /
   `getConversation` / lag poll; redact. Then propose
   `/ibreports/web/aiConversations` as the reporter sibling.
5. **Client defaults** (DEVELOP-34913) — `fromEnv` / `fromProfile`,
   `raw()` tier inference, `aiRiskEngines` validation. Smallest code
   change; can ship anytime, even first, if we want a quick win.
6. **Read + patch pairs for PAC / proxy / SSL / groups** (P0-3, P1-3) —
   shared merge helper; no platform change required to start.
7. **Docs pass** — "Agent quick path" section on
   `resource-policies.md`, `policy-layers.md`, `reporting-and-logs.md`,
   `errors-and-gotchas.md` once symbols exist. This PR only adds *this*
   proposal.

Recommended first implementation PR after this doc: **slice 1 + tests**,
optionally bundled with slice 5 if the client factory is needed to
exercise live agent flows.

---

## 6. Sources

- This repo: `packages/sdk/src/api/*`, `packages/sdk/src/client/*`,
  `docs/api/*`, `docs/ARCHITECTURE.md`, `AGENTS.md`.
- Epic + children: DEVELOP-34912 … 34916 (intake from Bug Replicator
  and AI Chat testing).
- [Resource Policies and the API](https://ibosscybersecurity.atlassian.net/wiki/spaces/~649395834/pages/4007690273/Resource+Policies+and+the+API)
  (two-step vs one-shot create).
- [Dashboard Controllers](https://ibosscybersecurity.atlassian.net/wiki/spaces/~628262babdf2f30067d2321a/pages/5046829057/Dashboard+Controllers)
  (`/ibreports/web/reports/{id}/web/aiRisk` and `/conversation`).
- DEVELOP-19593 (`policyLayers/all` filter params including `typeFilter`).
