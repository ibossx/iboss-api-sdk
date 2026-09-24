# Agent-friendly APIs — discovery findings & proposed design

**Status:** discovery / proposal only. No runtime API or SDK method
behavior changes in this pass.
**Epic:** [DEVELOP-34912](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34912)
**Audience:** platform + SDK implementers, and agents that consume this
repo.

This document inventories how the iboss API SDK is laid out and consumed,
names the APIs that are painful for agents, and proposes **non-breaking**
remedies. Existing wire APIs stay as they are.

**How to read this doc.**

1. **§1 Product direction** is authoritative from the
   [DEVELOP-34912](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34912)
   epic description: a **dedicated Resource Policy read/update surface**
   (today's settings GET is a Policy Layers URL) plus **UPDATE/patch**
   that get-merge-posts so agents send only what changed.
2. **§2 Ground-truth wire shapes** are redacted Sep 9–10
   request/responses from Bug Replicator. **Treat as ground truth
   over speculation.**
3. **§3 Confirmed findings** map those traces + AI Chat testing onto
   proposed wrappers. They outrank inventory.
4. **§6** is SDK inventory. **§7** is additional inventory that was
   **not** in the traces — useful, not the kickoff.

Child tickets under the epic:

| Ticket | Item |
|---|---|
| [DEVELOP-34918](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34918) / [DEVELOP-34916](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34916) | A — typed destinations |
| [DEVELOP-34914](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34914) | B + C — settings patch + one-shot create |
| [DEVELOP-34915](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34915) | D + E — friendly lists + conversations |
| [DEVELOP-34913](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34913) | F + G — client defaults + `aiRiskEngines` |

Related (Relates on the epic — same failure class, not this SDK's
runtime work):

| Ticket | Why it matters here |
|---|---|
| [DEVELOP-34251](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34251) | Connector-policy **partial** updates: omitted fields flip to bad defaults — same get-merge-post need |
| [DEVELOP-32482](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-32482) | Connector-policy API side effect: Enable Local PAC Server flips on update |
| [DEVELOP-29824](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-29824) | ZT Resource Policy PUT/POST **docs** gap (platform docs; ownership unchanged) |

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

Every remedy is tagged as one of:

| Tag | Meaning | Ships in |
|---|---|---|
| **SDK wrapper** | Compose today's paths so agents never touch the footgun | this repo (`@iboss/sdk`) |
| **New HTTP sibling** | Optional new path; old path unchanged. Wrappers can fall back until it exists | gateway / reporter / cloud, then wrap here |
| **Docs-only** | Record the ritual / lag / sentinels; no new method required to start | `docs/api/*`, this file |

SDK wrappers ship first and later become thin clients of a sibling path.

---

## 1. Product direction (epic — authoritative)

Two requirements from the DEVELOP-34912 description. Treat them as
the shape of the dedicated surface; §2–§3 are why agents cannot use
today's Policy Layers settings URL safely.

### 1.1 Today: settings live on Policy Layers, not Resource Policies

```
GET https://{{gatewayNodeApiDomain}}/json/controls/policyLayers/settings
    ?customCategoryId={{resource_policy_category}}
```

That is the **only** read for a Resource Policy's settings. The
Resource Policy noun already exists for listing
(`GET /json/controls/resourcePolicies` → `listResourcePolicies()`)
and for associating catalog resources
(`GET/PUT /json/controls/resourcePolicy/resources`). There is no
dedicated get/settings/update on that noun. Agents (and the epic)
must know that a Resource Policy *is* a Policy Layer id.

**Design a dedicated Resource Policy surface. Keep every existing
path working.**

| Role | Today (unchanged) | Dedicated sibling (new) | SDK method (new; wrap sibling, fall back to today) |
|---|---|---|---|
| List | `GET /json/controls/resourcePolicies` | — (already the right noun) | keep `listResourcePolicies()`; add `listPolicies({ kind })` |
| Read settings | `GET /json/controls/policyLayers/settings?customCategoryId=` | `GET /json/controls/resourcePolicies/settings?customCategoryId=` | `getResourcePolicySettings(id, { view? })` |
| Replace settings | `POST /json/controls/policyLayers/settings` (full blob) | `POST /json/controls/resourcePolicies/settings` (alias; same full-echo contract) | keep `updateLayerSettings`; do **not** point agents here |
| **Patch / UPDATE** | *does not exist* | `POST /json/controls/resourcePolicies/settings/patch` (or `PATCH` on the same resource) | `patchResourcePolicySettings(id, patch)` |
| Create | `PUT /json/controls/policyLayers` + POST settings | optional `PUT /json/controls/resourcePolicies` (both steps) | `createResourcePolicy({…})` → returns GET settings |
| Destinations | fields on the settings blob | `POST /json/controls/resourcePolicies/settings/destinations` | `setDestination` / `ensureAiSecurityDestination` |

Sibling paths follow existing `/json/controls/…` naming. They are
additive. Gateway handlers may internally call the Policy Layers
settings endpoints; agents never have to.

Until siblings exist, **SDK methods implement the same contracts
against today's paths** so this repo can ship the agent surface
without a platform release.

### 1.2 UPDATE / patch: get → merge → normal POST

Epic text: *Add UPDATE support to existing APIs which then pushes
only what is changed, which pulls the existing JSON, combines with
the patched, and sends it to the normal POST call.*

This is the remedy for the `cat0..cat110` / `prio0..prio110` /
`bypassSslMitm0..bypassSslMitm110` round-trip (confirmed in §2.2 / §3.B).
Agents send **only the fields they intend to change**. The
implementation — SDK first, gateway sibling later — does:

```
1. GET  /json/controls/policyLayers/settings?customCategoryId=<id>
        (or the dedicated GET once it exists)
2. current = parsed JSON
3. next    = deepMerge(current, patch)
             + inject generateCategoryFields() / generatePriorityFields()
               / generateBypassSslMitmFields() / categories bitmap
               unless patch.advanced === true
             + if this is a Resource Policy: dlpPolicyMethod = 2
               unless the patch explicitly sets it
             + if patch.destinations is set: encode bitmap +
               categoriesSelectedType (see §2.2 / §3.A); never require the
               agent to send `categories` / cat* / prio* / bypass*
4. POST /json/controls/policyLayers/settings   body = next
        (or POST …/resourcePolicies/settings — same contract)
5. GET  again. If destinations / dlpPolicyMethod / aiRisk* did not
   persist, throw — do not treat POST success or empty
   saveIgnoredEntries as proof (confirmed in testing).
6. Return the GET body (summary view by default).
```

`updateLayerSettings(fullBlob)` stays a full replace. New code
paths are additive: `patchResourcePolicySettings` and the
`…/settings/patch` sibling.

```ts
// Agent sends only what changed. Families and dlpPolicyMethod: 2
// are filled in. Existing unrelated fields are preserved.
await client.policies.patchResourcePolicySettings(customCategoryId, {
  aiRiskEnabled: 1,
  aiRiskEngines: "all",
  linkPolicyToAllSubjects: 1,
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  aiRiskMonitoringMessage: "AI use is monitored.",
  aiRiskMonitoringMessageEnabled: 1,
  aiRiskMonitoringMessageTitle: "Warning",
});
```

Same merge algorithm on the gateway for
`POST /json/controls/resourcePolicies/settings/patch` so raw HTTP
agents (`npx iboss api`) get the same safety.

### 1.3 Typed destinations sit on that surface

Do not invent a second write path for bitmaps. `setDestination` /
`ensureAiSecurityDestination` are thin callers of
`patchResourcePolicySettings` that only supply `destinations`.
The merge step encodes bit 110 / `categoriesSelectedType: 0` and
re-GETs. Reject allowlist+categories (wrong `customType`; delete
and recreate — §4 recipe).

---

## 2. Ground-truth wire shapes (Sep 9–10 traces)

Primary evidence: redacted Bug Replicator request/responses (Sep 9–10
AI Security repro). Auth on **every** call, gateway and reporter:

```
Authorization: Token <IBOSS_API_KEY>
User-Agent: ibossAPI
```

Placeholders: `{gateway}` = SWG node, `{reporter}` = reporter node.
No secrets below.

### 2.1 Categories-type create is fragile

Intended create — **PUT** (not POST) `{gateway}/json/controls/policyLayers`:

```json
{
  "customCategoryName": "AI Security Policy",
  "customType": "e_custom_category_type_categories",
  "isZtnaPrivateAccessCategory": 0,
  "isZeroTrustResourcePolicy": 1,
  "enterpriseOwned": 0,
  "policyEnabled": 1,
  "placeAtPosition": 0
}
```

Observed failures on Sep 9 recreate attempts:

- PUT body rejected: `{ "message": "Invalid entry type.", "errorCode": 0 }`
- `POST …/policyLayers` (wrong method): `{ "message": "Access denied." }`

Do not treat create as reliable from the string enum alone. Wrappers
must use PUT, the `e_custom_category_type_categories` string, and
verify the GET `customType` is categories-shaped (`3` or, after some
updates, `13` — both still carried a bitmap). Allowlist GET is `1`.

### 2.2 Settings POST that **stuck** (policy 1114, Sep 10)

`POST {gateway}/json/controls/policyLayers/settings`

Fields that persisted (re-GET matched). Full body also has **111**
members each of `cat0..cat110` (typical `3`), `prio0..prio110` (`0`),
`bypassSslMitm0..bypassSslMitm110` (`0`):

| Field | Value that stuck |
|---|---|
| `customCategoryId` | `1114` |
| `customType` / `categoryType` | `13` on this restore (`3` on an earlier good GET) |
| `categoriesSelectedType` | **`0`** (UI “Selected Destinations”) |
| `categories` | 400-char bitmap, **only bit 110** set (AI Services) |
| `isZeroTrustResourcePolicy` | `1` |
| `linkPolicyToAllSubjects` | `1` |
| `dlpPolicyMethod` | **`2`** |
| `policyAction` | `1` |
| `aiRiskEnabled` | `1` |
| `aiRiskEngines` | `"chatgpt"` (free-form string) |
| `aiRiskMonitoringMessage` | `"Monitoring is occuring"` |
| `aiRiskMonitoringMessageEnabled` | `1` |
| `aiRiskMonitoringMessageTitle` | `"Warning"` |
| `aiRiskBlockRiskyBehaviorsEnabled` / `…Secrets…` / `…SourceCodeUploads…` | `0` |

POST response was `{ "message": "Successfully updated Resource Policy 'AI Security Policy'.", "saveIgnoredEntries": [] }`.
**Still re-GET.** Empty `saveIgnoredEntries` is not proof; earlier
attempts “succeeded” without bit 110.

UI mapping: “Selected Destinations → AI Services” ==
`categoriesSelectedType=0` + bit 110 + categories-type create enum.

### 2.3 Allowlist recreate **silently drops** the bitmap

`PUT …/policyLayers` with `customType: "e_custom_category_type_allowlist"`
returned `{ "customCategoryId": 1114, "message": "Successfully added custom category. " }`.

Immediate `GET …/resourcePolicies` and `GET …/policyLayers/settings`:

| Field | After allowlist create |
|---|---|
| `customType` / `categoryType` | **`1`** |
| `categories` | **empty** (`length: 0`, no bits) |
| `aiRiskEnabled` | `0` (later POSTs can flip this to `1` **without** restoring the bitmap) |
| `linkPolicyToAllSubjects` | `0` at create |

AI Services destination is then **unexpressable** until DELETE +
categories-type recreate. Typed helpers **must reject or warn**
allowlist+categories. Do not try to patch a bitmap onto `customType: 1`.

### 2.4 Governance conversations (reporter)

**List**

```
GET {reporter}/ibreports/web/aiSecurityGovernance/conversations
  ?reportingGroup=-1
  &intervalStartTime=<epoch>
  &intervalEndTime=<epoch>
  &filterByIntervalTime=true
  &sortByCriteria=SORT_BY_LAST_MESSAGE_TIME
  &orderAscending=false
  &currentRowNumber=1
  &maxItemsToReturn=50
```

Envelope: `{ result: { conversations: [...], intervalStartTime, intervalEndTime } }`.
List row (`@class`: `com.phantom.ibdao.common.AIRiskStat`) has
`conversationId`, `topic`, `conversationPreview`, `vendor` /
`aiVendor` / `aiVendorDisplayName` (e.g. `PERPLEXITY`), `domain`,
`messageCount`, `blocked`, `reportId`, `filteringGroupNumber`.
**`userRequest` and `aiResponse` are often `null` on list rows.**
Match via `topic` / `conversationPreview` / `vendor`. Prefer
`aiVendor`/`vendor` over parsing `domain`.

**`domain` may embed vendor query strings including `accessToken` —
always redact in SDK summaries and logs.**

**Timestamps are a custom epoch** (observed values ~`1.789e12`, e.g.
`1789012800000`), **not** plain unix-ms wall clock. Wrappers that
accept `since`/`until` as ISO must translate; do not treat the
numbers as `Date.now()`.

**Detail** (bodies + block metadata live here):

```
GET {reporter}/ibreports/web/aiSecurityGovernance/conversations/{conversationId}
  ?reportingGroup=-1&intervalStartTime=<epoch>&intervalEndTime=<epoch>
  &filterByIntervalTime=true
```

Detail has `messages[]` (`user`, `blocked`, `text`, `messageTime`,
`contentAnalysisRule`, `blockDescription`), plus `vendor: "CHAT_GPT"`
(settings used `"chatgpt"` — **two slug systems**). ~15 minute lag
after a chat is common.

### 2.5 Auth (both hosts)

`Authorization: Token <key>` **and** `User-Agent: ibossAPI` on
gateway policy calls **and** reporter conversation calls. Omitting
the UA is an observed agent failure mode.

---

## 3. Confirmed findings (Bug Replicator + AI Chat)

These map §2 traces onto the §1 surface. Prioritize them above the
inventory in §7.

### A. Policy destination encoding — highest priority

| | |
|---|---|
| **Evidence** | §2.1–2.3 traces (DEVELOP-34916 / 34918) |
| **Paths** | `PUT /json/controls/policyLayers` · `GET/POST /json/controls/policyLayers/settings?customCategoryId=` · `GET /json/controls/resourcePolicies` |
| **SDK today** | `createLayer` / `getLayerSettings` / `updateLayerSettings` / `emptyCategoriesBitmap()` — generate the blob, do not interpret it |

**Footguns (ground truth).**

- Categories **create is fragile**: PUT can return
  `Invalid entry type`; POST to `/policyLayers` is `Access denied`.
- Settings that **stuck** used `categoriesSelectedType=0`, 400-char
  `categories` with **bit 110**, ~111 `catN`/`prioN`/`bypassSslMitmN`
  families, `aiRiskEnabled`, `linkPolicyToAllSubjects`,
  `dlpPolicyMethod=2`, plus `aiRiskMonitoringMessage*`.
- Live `customType` after GET is numeric: **`3`** (categories) or
  **`13`** after some updates (still categories + bitmap). Allowlist
  is **`1`**. Create still sends the `e_custom_category_type_*` string.
- **Allowlist-type recreate silently drops the bitmap** — GET shows
  empty `categories`. Later settings POSTs can set `aiRiskEnabled: 1`
  and still leave destinations empty. Agent-hostile; reject/warn
  allowlist+categories.
- Re-GET to verify — do not trust POST success or empty
  `saveIgnoredEntries`. Assert bit 110 and `categoriesSelectedType===0`.

**Proposed shapes (never force an agent to touch the bitmap).**

```ts
type DestinationMode = "selectedWebCategories" | "allWebCategories";
type WebCategory = "AI_SERVICES"; // extend as the catalog is published

client.policies.setDestination(id, {
  mode: "selectedWebCategories",
  categories: ["AI_SERVICES"],
});

client.policies.ensureAiSecurityDestination(id);
// ≡ setDestination(id, { mode: "selectedWebCategories", categories: ["AI_SERVICES"] })
//   plus categoriesSelectedType: 0, and refuse if the layer is an allowlist/blocklist
```

- `setDestination` / `ensureAiSecurityDestination`: **SDK wrapper**.
  Thin callers of `patchResourcePolicySettings` (§1.2 get-merge-post)
  that only supply `destinations`. The merge encodes the bitmap +
  `categoriesSelectedType: 0`, POSTs the full settings blob, re-GETs,
  and throws if bit 110 / type did not stick.
- Reject (or hard-warn) `allowlist`/`blocklist` + categories. Those are
  a different `customType`; the working recipe deletes the wrong-type
  layer and recreates as `e_custom_category_type_categories`.
- Keep `emptyCategoriesBitmap()` as-is.
- **New HTTP sibling (later):**
  `POST /json/controls/resourcePolicies/settings/destinations`
  `{ mode, categories: ["AI_SERVICES"] }` so raw HTTP agents skip the
  bitmap too. Existing settings POST unchanged.
- **Docs-only now:** the bit-index table (110 = AI Services), the
  inverted enum, string-vs-numeric `customType`, and "re-GET after POST".

### B. Enormous brittle settings payloads

| | |
|---|---|
| **Evidence** | Confirmed in testing + epic description (DEVELOP-34914) |
| **Path** | `POST /json/controls/policyLayers/settings` |
| **SDK today** | `updateLayerSettings(fullBlob)` — no merge, no subset type |

**Footguns (observed).**

- POST is a **full replace**. Omitting `cat0..cat110`, `prio0..prio110`,
  or `bypassSslMitm0..bypassSslMitm110` wipes category/priority/MITM
  state. Agents that send "just the AI knobs" destroy the rest.
- Resource Policies **require** `dlpPolicyMethod: 2` in every settings
  payload. Easy to miss; the policy then looks created but is broken.
- Many unrelated / UI-only fields (`showPACUrl`, …) travel with the
  blob. Agents copy-paste Confluence samples and still drop families.
- Combined with A: even a "successful" POST (`saveIgnoredEntries` empty)
  is not proof the fields persisted.

**Proposed shapes** — these *are* the §1 dedicated surface / UPDATE.

```ts
// Dedicated read (not policyLayers/settings in the agent-facing API).
client.policies.getResourcePolicySettings(id, { view: "summary" | "full" });
// summary: id, name, kind, enabled, destinations[], aiRisk, groups
// full: wire blob (same as getLayerSettings)

// Epic UPDATE: agent sends only what changed. Implementation
// GET-merges, injects families unless advanced: true, forces
// dlpPolicyMethod: 2, POSTs the normal settings body, re-GETs.
client.policies.patchResourcePolicySettings(id, {
  aiRiskEnabled: 1,
  aiRiskEngines: "all",          // see G
  linkPolicyToAllSubjects: 1,
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  aiRiskMonitoringMessage: "…",
  aiRiskMonitoringMessageEnabled: 1,
  aiRiskMonitoringMessageTitle: "Warning",
});
```

- `getResourcePolicySettings` / `patchResourcePolicySettings`:
  **SDK wrapper** implementing §1.2 against today's
  `GET/POST /json/controls/policyLayers/settings`. `createLayer`
  already injects families on **create**; this is the missing
  **update**. `updateLayerSettings` stays full-replace.
- **New HTTP sibling (epic's dedicated API):**
  `GET /json/controls/resourcePolicies/settings?customCategoryId=`
  and `POST /json/controls/resourcePolicies/settings/patch` that
  get-merge-posts **on the gateway**. Optional full-echo alias
  `POST /json/controls/resourcePolicies/settings`. Do not change
  `/json/controls/policyLayers/settings`.
- **Docs-only now:** "POST settings is full-echo; `dlpPolicyMethod: 2`
  is mandatory; re-GET after POST."

### C. Fragile two-step create

| | |
|---|---|
| **Evidence** | Confirmed in testing + Confluence "Resource Policies and the API" (DEVELOP-34914) |
| **Paths** | `PUT /json/controls/policyLayers` then `POST /json/controls/policyLayers/settings` |
| **SDK today** | `createLayer()` does both and returns **create ids only** (`customCategoryId`, `customCategoryNumber`). `createLayerStructure()` is step 1 alone. |

**Footguns (observed).**

- Step 1 must be **PUT**; `POST /json/controls/policyLayers` returned
  `Access denied`. PUT can still return `Invalid entry type` — create
  is fragile (§2.1).
- Step 1 alone can return success (`Successfully added custom category`)
  and an id. AI risk, destinations, `dlpPolicyMethod`, and
  `linkPolicyToAllSubjects` live **only** in step 2. Agents stop after
  PUT and believe the policy is done.
- A one-shot PUT of the full settings blob can also return success
  and never appear in the Resource Policy UI (Confluence write-up).
- Wrong `customType` (allowlist/blocklist instead of categories) cannot
  be patched into a destination policy — the working recipe
  **DELETEs** the layer and recreates (see §4).

`createLayer({ isZeroTrustResourcePolicy: 1 })` already does the two
HTTP calls. It does **not** return effective GET settings, does not
set destinations / `aiRiskEnabled`, and does not verify persistence.

**Proposed shape.**

```ts
const policy = await client.policies.createResourcePolicy({
  name: "AI Security",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  aiRiskEnabled: true,
  aiRiskEngines: "all",
  linkPolicyToAllSubjects: true,
  aiRiskMonitoringMessage: "…",
});
// → effective GET settings (summary), not just ids
// asserts bit 110 + categoriesSelectedType === 0 + dlpPolicyMethod === 2
```

- `createResourcePolicy`: **SDK wrapper**. PUT structure with
  `customType: "e_custom_category_type_categories"` +
  `isZeroTrustResourcePolicy: 1`, POST settings with families +
  `dlpPolicyMethod: 2` + destination encoding, re-GET, return the
  GET body. Keep `createLayer` / `createLayerStructure` unchanged.
- **New HTTP sibling (optional):** one
  `PUT /json/controls/resourcePolicies` that performs both steps
  server-side and returns settings. Not required to ship the wrapper.
- **Docs-only now:** "never stop after PUT; AI knobs are settings-only."

### D. Magic-number / overlapping list surfaces

| | |
|---|---|
| **Evidence** | Confirmed in testing (DEVELOP-34915) |
| **Paths** | `GET /json/controls/policyLayers/all?typeFilter=9&isZeroTrustLayer=&…` (empty filter strings **required**) |
| | `GET /json/controls/resourcePolicies` |
| **SDK today** | `listLayers({ isZeroTrustLayer?, typeFilter? })` · `listResourcePolicies()` |

**Footguns (observed).**

- Listing DLP policies is `typeFilter=9` on the Policy Layers `/all`
  endpoint. There is no `listDlpPolicies`.
- `resourcePolicies` and `policyLayers/all?isZeroTrustLayer=&typeFilter=`
  overlap. Agents do not know which list is the source of truth for
  AI Security vs DLP vs internet vs Private Access (`ztnaFlowPeerIds`).
- `isZeroTrustLayer`: −1 all, 0 overlay, 1 resource policies.
  `typeFilter`: −1 all; **9 = DLP**. Connector policies are
  `customType === 12` after the fact.

**Proposed shapes.**

```ts
client.policies.listDlpPolicies();
client.policies.listAiSecurityPolicies();
client.policies.listPolicies({ kind: "dlp" | "aiSecurity" | "resource" | "layer" | "connector" | "privateAccess" });
```

- All three: **SDK wrapper**. Apply the right `typeFilter` /
  `isZeroTrustLayer` / `customType` / `aiRiskEnabled` client-side.
  Keep `listLayers` / `listResourcePolicies` unchanged.
- **New HTTP sibling (optional):**
  `GET /json/controls/resourcePolicies?kind=dlp|aiSecurity|internet|privateAccess`.
  Do not change `/policyLayers/all`.
- **Docs-only now:** publish the `typeFilter` / `customType` integer
  table (9 = DLP; GET `customType` 1 = allowlist, 3 or 13 =
  categories, 12 = connector).

### E. AI Security Governance conversations

| | |
|---|---|
| **Evidence** | §2.4 traces (DEVELOP-34915) |
| **List** | `GET {reporter}/ibreports/web/aiSecurityGovernance/conversations?reportingGroup=-1&intervalStartTime=&intervalEndTime=&filterByIntervalTime=true&sortByCriteria=SORT_BY_LAST_MESSAGE_TIME&orderAscending=false&currentRowNumber=1&maxItemsToReturn=50` |
| **Detail** | `GET {reporter}/ibreports/web/aiSecurityGovernance/conversations/{conversationId}?reportingGroup=-1&intervalStartTime=&intervalEndTime=&filterByIntervalTime=true` |
| **SDK today** | **none** |

**Footguns (ground truth).**

- Long query string as above. **`intervalStartTime` / `intervalEndTime`
  use a custom epoch (~`1.789e12`), not plain unix-ms.** ISO
  `since`/`until` must be translated; `new Date(1789012800000)` is
  wrong.
- **~15 minute** lag after chat is common.
- List rows (`AIRiskStat`) often have **null** `userRequest` /
  `aiResponse`. Match via `topic` / `conversationPreview` / `vendor`.
  Detail is required for `messages[]` and block metadata
  (`contentAnalysisRule`, `blockDescription`).
- `domain` may embed vendor query strings including **`accessToken`**.
  Redact in SDK summaries and logs. Prefer `aiVendor`/`vendor`
  (`PERPLEXITY`, `CHAT_GPT`) over parsing `domain`.

**Proposed shapes.**

```ts
client.reporting.listAiConversations({
  since, until,            // ISO-8601; SDK maps to the custom epoch
  vendor,                  // validated — see G; map chatgpt ↔ CHAT_GPT
  textContains,            // match topic / conversationPreview
});
// summaries only; userRequest/aiResponse may be null; domain redacted

client.reporting.getConversation(id);
// detail path above; redacts accessToken in domain; returns messages[]

client.reporting.waitForConversation({ id, timeoutMs });
// poll through the ~15m lag; do not busy-loop
```

- All three: **SDK wrapper** over the Governance paths, **reporter**
  host, same auth headers as F.
- **New HTTP sibling (later):**
  `GET /ibreports/web/aiConversations` + `/{id}` with ISO times and
  bodies-on-get. Keep the Governance path unchanged.
- **Docs-only now:** custom epoch, ~15m lag, null list bodies, redact
  `accessToken`.

### F. Auth + split-brain hosts

| | |
|---|---|
| **Evidence** | §2.5 traces (DEVELOP-34913) |
| **Need** | `Authorization: Token <key>` **and** `User-Agent: ibossAPI` on **gateway and reporter** (GETs included, plus XSRF cookies) |
| **Routing** | Policy writes → **gateway** (`/json/…`). Conversations → **reporter** (`/ibreports/…`). Cloud (`/ibcloud/web/…`) often `access.denied` with the **same** key that works on gateway. |

**Footguns (observed).**

- Agents hand-rolling `fetch` omit `User-Agent: ibossAPI` or the
  token scheme and get 401/403 that look like "no permission".
- Sending a Resource Policy POST to the cloud host (or a conversation
  GET to gateway/cloud) fails. Same key, wrong tier.
- Library constructor requires explicit `{ domain, credentials }`.
  Env/profile resolution lives only in the CLI
  (`IBOSS_CLOUD_DOMAIN`, `IBOSS_API_KEY`, `iboss.config.json`).

**What the SDK already does** once `IbossClient` is constructed:
headers, cookies, XSRF, `accountSettingsId`, `connect()` host
discovery. Do not re-solve that.

**Proposed shapes.**

```ts
IbossClient.fromEnv();           // IBOSS_API_KEY + IBOSS_CLOUD_DOMAIN
IbossClient.fromProfile(name?);  // same files the CLI uses

// existing constructor unchanged
new IbossClient({ domain, credentials: { apiKey } });

client.raw(method, path, opts);  // infer tier from /json vs /ibreports vs /ibcloud
// keep raw(tier, method, path, opts) — do not remove the 4-arg form
```

- `fromEnv` / `fromProfile` / `raw()` path-prefix inference /
  error text that names "you hit cloud; this path is gateway":
  **SDK wrapper** (constructor + request helpers). No new HTTP.
- **Docs-only now:** the three-tier table and "cloud `access.denied`
  ≠ bad key".

### G. `aiRiskEngines`

| | |
|---|---|
| **Evidence** | §2.2 / §2.4 traces (DEVELOP-34913) |
| **Wire** | Settings: free-form `"chatgpt"`. Conversation list/detail: `"PERPLEXITY"`, `"CHAT_GPT"` (different slug system). |

**Proposed shape.**

```ts
type AiRiskEngine =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "copilot"
  | "perplexity"; // publish the live list; do not guess

aiRiskEngines: "all" | AiRiskEngine[];
```

- Validation + `"all"` expansion: **SDK wrapper** on
  `createResourcePolicy` / `patchResourcePolicySettings`. Unknown
  values throw **before** the POST. Wire still sends the
  platform string (`"chatgpt"` observed).
- Conversation wrappers map `chatgpt` ↔ `CHAT_GPT`, `perplexity` ↔
  `PERPLEXITY` so agents use one enum.
- **New HTTP:** none required.
- **Docs-only now:** do not send display names (`"ChatGPT"`). The
  union above is **not** final — confirm slugs when implementing.

---

## 4. Working recipe (migration / example)

This is the sequence agents eventually used to get an AI Security
Resource Policy that **actually persisted**. Document it so raw-HTTP
and old-path callers can succeed. **Do not change these paths.**
The §1 surface (`createResourcePolicy`, `patchResourcePolicySettings`,
`setDestination`) implements this ritual so agents stop performing it
by hand.

1. **DELETE** the existing AI Security layer if GET `customType` is
   `1` (allowlist) or otherwise not categories-shaped (`3` or `13`).
   Bitmap cannot be patched onto allowlist.
2. **PUT** `/json/controls/policyLayers` (not POST — POST was
   `Access denied`) with
   `customType: "e_custom_category_type_categories"` and
   `isZeroTrustResourcePolicy: 1`. If the body returns
   `Invalid entry type`, do not proceed; retry with the string enum
   above, never a numeric `3`/`13` on create.
3. **POST** `/json/controls/policyLayers/settings` with at least:
   - `dlpPolicyMethod: 2`
   - `aiRiskEnabled: 1`
   - `aiRiskEngines: "chatgpt"` (or the intended slug)
   - `aiRiskMonitoringMessage` / `…Enabled` / `…Title`
   - `linkPolicyToAllSubjects: 1`
   - `categoriesSelectedType: 0`
   - `categories` bitmap with **bit 110** set
   - **111** members each: `cat0..cat110` (typical `3`),
     `prio0..prio110` (`0`), `bypassSslMitm0..bypassSslMitm110` (`0`)
4. **Re-GET** `/json/controls/policyLayers/settings?customCategoryId=`
   and **assert** bit 110 is set, `categoriesSelectedType === 0`,
   and `customType` is `3` or `13` (not `1`). Do **not** trust POST
   success (including empty `saveIgnoredEntries`).

`createResourcePolicy` + `setDestination` + `patchResourcePolicySettings`
are this recipe behind one call each. `createLayer` / `updateLayerSettings`
remain for callers who still want the raw two-step.

---

## 5. Remedy map (confirmed items + epic surface)

| Item | Additive SDK wrapper | New HTTP sibling (optional) | Docs-only |
|---|---|---|---|
| **A** destinations | `setDestination`, `ensureAiSecurityDestination` | `POST …/resourcePolicies/settings/destinations` | bit 110, inverted enum, re-GET |
| **Epic + B** dedicated read + UPDATE | `getResourcePolicySettings`, `patchResourcePolicySettings` (get-merge-post; inject families; agents send only the patch) | `GET …/resourcePolicies/settings`, `POST …/settings/patch` | full-echo + `dlpPolicyMethod: 2` |
| **C** two-step create | `createResourcePolicy` → returns GET settings | `PUT …/resourcePolicies` (both steps) | never stop after PUT |
| **D** lists | `listDlpPolicies`, `listAiSecurityPolicies`, `listPolicies({ kind })` | `GET …/resourcePolicies?kind=` | `typeFilter=9`, `customType` table |
| **E** conversations | `listAiConversations`, `getConversation`, `waitForConversation` | `GET /ibreports/web/aiConversations` + `/{id}` | ~15m lag, null list bodies, redact |
| **F** auth / hosts | `fromEnv`, `fromProfile`, `raw()` tier inference | — | three-tier + `User-Agent: ibossAPI` |
| **G** engines | `aiRiskEngines: "all" \| string[]` validated | — | observed slug `"chatgpt"` |

Existing Policy Layers settings paths and SDK symbols stay. The
dedicated Resource Policy noun is additive (§1).

---

## 6. SDK inventory

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
- Two-step policy **create** (`createLayer()`) — ids only; see C
- Peer-create-then-poll (`createPeerAndFind()`)
- Resource-list filter defaults (the long `anchored=-1&…` query)
- PAC-zone list gotchas (`/pacZones` plural + `requestKey=v2`)
- Pagination of `GET /json/controls/policyLayers/all`
- Typed errors vs raw status codes

Confirmed gaps (A–G) are payload shape, overloaded nouns, missing
verify-after-write, and unwrapped reporter Governance — not transport.

---

## 7. Additional inventory (not confirmed in that test pass)

Useful, lower priority than A–G. Do not start here.

### Full-echo updates outside Resource Policies

Agents that send "just the field I changed" wipe server-generated ids
on other nouns too.

| Current path | SDK symbol | Echo rule |
|---|---|---|
| `PUT /ibcloud/web/pacZone` | `locations.updatePacZone` | GET whole zone; echo `uuid`, watermark, cluster ids |
| `PUT /ibcloud/web/pacZone/default` | `updateDefaultPacZone` | same |
| `POST /ibcloud/web/groups/filtering` | `groups.updateFilteringGroup` | full group + Java `type` discriminator |
| `POST /json/users` | `directory.updateUser` | full user (`id` required) |
| `POST /json/computer` | `directory.updateDevice` | full device |
| `POST /json/network/proxy/settings` | `network.updateProxySettings` | **no GET wrapper** |
| `POST /json/network/sslDecryption/settings` | `ssl.updateSettings` | **no GET wrapper** |
| `POST /json/network/sslDecryption/domains` | `ssl.updateDomainBypass` | **no GET wrapper** |
| `POST /json/network/contentAnalysis/settings?mode=0` | `dlp.updateGeneralSettings` | `mode` selects DLP vs malware |
| `POST /json/controls/apps` | `apps.updateAppControls` | giant per-app flag map |
| `POST /json/network/mobileClients/settings` | `network.updateMobileClientSettings` | includes connector security key |

**Remedy (after A–C).** Shared SDK helper `patchByGetMergePost` used by
new `patch*` methods. Existing `update*` stay full-replace. Highest
leverage after Resource Policies: PAC, proxy, SSL, groups.

### Missing GET wrappers next to POST-only settings

| POST (wrapped) | Missing GET |
|---|---|
| `updateProxySettings` | `GET /json/network/proxy/settings` unwrapped |
| `ssl.updateSettings` | `GET /json/network/sslDecryption/settings` unwrapped |
| `ssl.updateDomainBypass` | no GET |
| `updateZtnaFlowDhcpGateway` | no GET |
| `updateReleaseSettings` / `updateAutoUpdateSettings` | no GET |

**Remedy.** Additive `get*` methods. **SDK wrapper**, no new paths
unless a GET does not exist on the platform.

### Other multi-step rituals

| Current | SDK today | Remedy (wrapper) |
|---|---|---|
| `PUT /json/network/mobileClients/peer` returns no uuid | `createPeerAndFind()` | docs: use that; optional `PUT …/peer/create` sibling |
| `associateResources` needs both ids + field `resourceIds` | as-is | `attachResources(policyId, uuids)` |
| DLP rule then response; id lags | two calls | `createDlpRuleAndResponse` with retry |
| Connector policy `customType: 12` | `createLayerStructure` | `createConnectorPolicy({ platform, groups })` |

### Reporting two-step + paging

`listReports()` then `topBlockedDomains(reportId)`. Reporter
`currentRowNumber` is **1-indexed**; gateway `currentRow` is 0-indexed.
Wrapper: `topBlockedDomains({ month, year })` that resolves `reportId`.

### 422 means subscription *and* bad payload

Always `IbossSubscriptionError`. Additive `error.code`
(`subscription` \| `validation` \| `unknown`); optional later
`IbossValidationError`. Do not change existing `instanceof` behavior.

### Inconsistent envelopes, UI query params, untyped blobs

Gateway `{ entries, totalCount }` vs cloud `{ successful, result }` vs
bare arrays. `currentPolicyBeingEdited` means policy group. `mode=0`
selects DLP vs malware. New helpers return `{ items, total?, nextPage? }`
and take `{ policyGroup }`. Do not change existing return types.

`resources.save` / `firewall.saveRule` are upserts. 403-on-GET is
XSRF/session (`IbossApiError`, not `IbossXsrfError`). Do not reclassify
403-on-GET (breaking). Additive aliases only.

---

## 8. Proposed agent surface (additive)

All names are new. Old symbols remain. Dedicated Resource Policy
read/UPDATE first (epic), then destinations (confirmed), then the rest.

```ts
// Epic — dedicated Resource Policy noun (not policyLayers/settings)
client.policies.getResourcePolicySettings(id, { view?: "summary" | "full" })
client.policies.patchResourcePolicySettings(id, patch)
// patch = only changed fields. Implementation: GET → merge → POST
// today's /json/controls/policyLayers/settings (or the sibling).
client.policies.createResourcePolicy({
  name,
  destinations,
  aiRiskEnabled,
  aiRiskEngines,          // G: "all" | string[]
  linkPolicyToAllSubjects,
  aiRiskMonitoringMessage,
}) // PUT + POST + re-GET; returns effective settings

// A — destinations; implemented as a patch of { destinations }
client.policies.setDestination(id, { mode: "selectedWebCategories", categories: ["AI_SERVICES"] })
client.policies.ensureAiSecurityDestination(id)

// F — construction
IbossClient.fromEnv()
IbossClient.fromProfile(name?: string)

// D — lists
client.policies.listDlpPolicies()
client.policies.listAiSecurityPolicies()
client.policies.listPolicies({ kind: "dlp" | "aiSecurity" | … })

// E — conversations (reporter)
client.reporting.listAiConversations({ since, until, vendor, textContains })
client.reporting.getConversation(id)          // redacted
client.reporting.waitForConversation({ id, timeoutMs })
```

Optional **sibling paths** (platform; existing paths untouched):

```
GET    /json/controls/resourcePolicies/settings?customCategoryId=
POST   /json/controls/resourcePolicies/settings/patch
POST   /json/controls/resourcePolicies/settings/destinations
PUT    /json/controls/resourcePolicies          # optional one-shot create
GET    /json/controls/resourcePolicies?kind=dlp|aiSecurity|internet|privateAccess
GET    /ibreports/web/aiConversations
GET    /ibreports/web/aiConversations/{id}
```

Until those exist, SDK methods call today's paths
(`/json/controls/policyLayers*`,
`/ibreports/web/aiSecurityGovernance/conversations`).

---

## 9. What we will not do in follow-up slices

- Rename or remove `getLayerSettings`, `updateLayerSettings`,
  `createLayer`, `listLayers`, `listResourcePolicies`, `createPeer`,
  `associateResources`, or any existing path.
- Change the working-recipe paths in §4 — wrappers hide them; they stay.
- Require OpenAPI generation as a blocker.
- Put API keys in chat, docs, tests, or examples (placeholders only).
- Change 403-on-GET from `IbossApiError` to `IbossXsrfError`.
- Collapse the four policy types onto one new path; we **split** them
  for agents while the wire family stays shared.
- Treat POST settings success as persistence (wrappers re-GET).
- Replace or remove
  `GET /json/controls/policyLayers/settings?customCategoryId=` —
  the dedicated Resource Policy GET is a **sibling**, not a rename.

---

## 10. Next implementation slices

Kickoff order is the **epic surface** plus the confirmed destination
footgun. Each slice is independently mergeable and non-breaking.

1. **Dedicated Resource Policy read + UPDATE** (epic + DEVELOP-34914) —
   `getResourcePolicySettings` (dedicated noun; fall back to
   `GET /json/controls/policyLayers/settings?customCategoryId=`),
   `patchResourcePolicySettings` (get-merge-post → normal POST; inject
   `cat*`/`prio*`/`bypassSslMitm*`; `dlpPolicyMethod: 2`),
   `createResourcePolicy` that returns effective GET settings.
   Mock-server: a partial patch cannot drop `cat*` / bitmap;
   POST-success-without-persist is a test case. Platform siblings
   (`GET/POST …/resourcePolicies/settings`, `…/settings/patch`) can
   land in parallel (try sibling, fall back).
2. **A — Typed destinations** (DEVELOP-34916) — built **on** the
   patch helper: category name ↔ bit index (110 = AI Services),
   `setDestination` / `ensureAiSecurityDestination`, reject
   allowlist+categories, re-GET assert.
3. **D — Friendly lists** (DEVELOP-34915) —
   `listDlpPolicies` (`typeFilter=9`), `listAiSecurityPolicies`,
   `listPolicies({ kind })`.
4. **E — Governance conversations** (DEVELOP-34915) —
   wrap `/ibreports/web/aiSecurityGovernance/conversations`;
   `listAiConversations` / `getConversation` / `waitForConversation`;
   redact `domain`; document ~15m lag. Later sibling
   `/ibreports/web/aiConversations`.
5. **F + G — Client defaults + engines** (DEVELOP-34913) —
   `fromEnv` / `fromProfile`, `raw()` tier inference, validated
   `aiRiskEngines: "all" | string[]`. Small; can ship beside 1–2.
6. **Inventory follow-ups** (§7) — PAC / proxy / SSL / groups patch
   pairs, `attachResources`, reporting `reportId` resolution. After A–G.
   Connector partial-update side effects are the same class
   ([DEVELOP-34251](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34251),
   [DEVELOP-32482](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-32482)).
7. **Docs pass** — "Agent quick path" on `resource-policies.md`,
   `policy-layers.md`, `reporting-and-logs.md`, `errors-and-gotchas.md`
   once symbols exist. Align with
   [DEVELOP-29824](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-29824)
   (ZT RP docs). This PR is the proposal + the §4 recipe.

Recommended first **code** PR: **slice 1** (dedicated get +
get-merge-post UPDATE) with **slice 2** destinations on top, tests
that a `{ aiRiskEnabled: 1 }` patch cannot drop `cat*` / bitmap and
that allowlist+categories is rejected. Slice 5 is a cheap companion
if agents will live-test.

---

## 11. Sources

- **Epic (authoritative):** DEVELOP-34912 description — settings are
  fetched via `GET /json/controls/policyLayers/settings?customCategoryId=`
  instead of a dedicated Resource Policy API; add UPDATE that pulls
  existing JSON, merges the patch, and sends the normal POST.
- **Ground truth:** redacted Sep 9–10 Bug Replicator traces
  (`DEVELOP-34912-api-shapes-redacted.md`) — categories create
  fragility (`Invalid entry type` / POST `Access denied`), settings
  that stuck (cst=0, bit 110, 111× families, `aiRiskEnabled`,
  `linkPolicyToAllSubjects`, `dlpPolicyMethod=2`), allowlist empty
  bitmap, Governance list/detail query + custom epoch ~`1.789e12` +
  null list bodies + `accessToken` in `domain`, auth headers on both
  hosts.
- **Confirmed:** Bug Replicator + AI Chat testing folded into
  DEVELOP-34912 (comment) and children 34913–34918. Destination bitmap,
  inverted `categoriesSelectedType`, string-vs-numeric `customType`,
  allowlist drop, `saveIgnoredEntries` false success, two-step create,
  `typeFilter=9`, `/ibreports/web/aiSecurityGovernance/conversations`
  lag/null-bodies/token-in-domain, gateway-vs-reporter-vs-cloud,
  `aiRiskEngines: "chatgpt"`.
- **Relates:** DEVELOP-34251, DEVELOP-32482 (partial-update side
  effects), DEVELOP-29824 (ZT RP docs).
- This repo: `packages/sdk/src/api/*`, `packages/sdk/src/client/*`,
  `docs/api/*`, `docs/ARCHITECTURE.md`, `AGENTS.md`.
- [Resource Policies and the API](https://ibosscybersecurity.atlassian.net/wiki/spaces/~649395834/pages/4007690273/Resource+Policies+and+the+API)
  (two-step vs one-shot create).
- [Dashboard Controllers](https://ibosscybersecurity.atlassian.net/wiki/spaces/~628262babdf2f30067d2321a/pages/5046829057/Dashboard+Controllers)
  (`/reports/{id}/web/aiRisk` — related UI, not the Governance path).
- DEVELOP-19593 (`policyLayers/all` filter params including `typeFilter`).
