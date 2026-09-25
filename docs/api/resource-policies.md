# Resource Policies (SaaS & Internet Access Policies)

**Console:** Secure Access Policies → SaaS & Internet Access Policies ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.policies`

Resource Policies control access to internet and SaaS destinations: default
internet access, restricted categories, global blocklists/allowlists,
approved apps, and CASB controls. They are the policies you see as numbered
rows in the SaaS & Internet Access Policies screen, and they can be
associated with [Resources](resources.md) from the catalog.

On the wire, a Resource Policy is a policy object with
**`isZeroTrustResourcePolicy: 1`** and a mandatory **`dlpPolicyMethod: 2`**
in its settings payload. (Overlay [Policy Layers](policy-layers.md) share the
same endpoints but have `isZeroTrustResourcePolicy: 0`.)

## Creation is two-step

1. **Create structure** — `PUT /json/controls/policyLayers`

   ```json
   {
     "customCategoryName": "Approved Apps",
     "customType": "e_custom_category_type_allowlist",
     "isZtnaPrivateAccessCategory": 0,
     "isZeroTrustResourcePolicy": 1,
     "enterpriseOwned": 0,
     "policyEnabled": 1,
     "placeAtPosition": 0
   }
   ```
   → `{ customCategoryId, customCategoryNumber, id, successful }`

2. **Apply settings** — `POST /json/controls/policyLayers/settings` with the
   ids from step 1, **`dlpPolicyMethod: 2`**, `policyAction` (1=allow,
   0=block), `linkPolicyToAllSubjects`, and the generated field families
   (`cat0..cat110`, `prio0..prio110`, `bypassSslMitm0..bypassSslMitm110`,
   400-char `categories` bitmap).

`client.policies.createLayer({ isZeroTrustResourcePolicy: 1, ... })` performs
both steps and injects `dlpPolicyMethod: 2` and the field families for you.

## Agent helpers

`patchResourcePolicySettings` default `transport: "auto"` uses native
PATCH when the node supports it. If PATCH is 404/405 it falls back to
get → deep-merge → **full** POST:

```
PATCH /json/controls/policyLayers/settings?customCategoryId=…
GET   /json/controls/policyLayers/settings?customCategoryId=…   ↘ fallback
POST  /json/controls/policyLayers/settings    body = merged GET + patch
```

POST `?merge=1` is `transport: "merge-post"` **opt-in only**. Older nodes
that ignore `?merge=1` will wipe on omit — never send merge unless you
know the node supports it; prefer transport auto.

A plain gateway POST applies defaults for omitted fields, so a partial
body via `updateLayerSettings` would wipe `catN` / `prioN` /
`bypassSslMitmN`. Omitted patch keys **keep prior values**. The
GET→merge→POST race (TOCTOU) is accepted on the fallback path.

Agents should not send the 400-char `categories` bitmap or invent
`categoriesSelectedType`. The settings POST that persists destinations
uses `categoriesSelectedType: 0` (UI “Selected Destinations”) and a
400-char bitmap with **only bit 110** set (AI Services). Allowlist
recreate (`customType: 1`) **silently drops** that bitmap — later POSTs
can flip `aiRiskEnabled: 1` and still leave destinations empty. The SDK
**rejects** (or `onWrongType: "warn"`) that combination. POST success
(including empty `saveIgnoredEntries`) is **not** persistence.

```ts
const client = IbossClient.fromEnv(); // IBOSS_API_KEY + IBOSS_CLOUD_DOMAIN

const policy = await client.policies.createResourcePolicy({
  name: "AI Security",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  settings: { aiRiskEnabled: 1, aiRiskEngines: ["chatgpt"], linkPolicyToAllSubjects: 1 },
});
// policy.settings is the re-GET (effective), not the POST 200 / ids

await client.policies.putResourcePolicyDestinations(policy.customCategoryId, {
  mode: "selectedWebCategories",
  categories: ["AI_SERVICES"],
});

await client.policies.patchResourcePolicySettings(policy.customCategoryId, {
  aiRiskEnabled: 1,
  aiRiskEngines: "all",
});
```

| Method | What it does |
|---|---|
| `getResourcePolicySettings(id, { view? })` | Dedicated read. Default `summary` hides the bitmap / catN families. `full` is the wire blob. Today this wraps `GET /json/controls/policyLayers/settings`. |
| `patchResourcePolicySettings(id, patch, { transport? })` | Sparse update. Default `auto`: native PATCH, then 404/405 get-merge-full-POST. `merge-post` is opt-in. Agents send only changed fields. Re-GETs. |
| `getResourcePolicyDestinations` / `putResourcePolicyDestinations` | Typed destinations. AI_SERVICES → bit 110 + `categoriesSelectedType: 0`. Reject/warn allowlist+categories — never silent drop. |
| `setDestination` / `ensureAiSecurityDestination` | Aliases of `putResourcePolicyDestinations` (AI Services shortcut). |
| `createResourcePolicy({…})` | PUT structure + POST settings + re-GET. Returns `{ customCategoryId, customCategoryNumber, destinations, settings }`. |
| `listPolicies({ kind })` | Purpose-named list. Prefer over `typeFilter=9` / choosing list endpoints. |

`updateLayerSettings(fullBlob)` and `createLayer()` are unchanged full-replace / id-returning APIs.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/resourcePolicies` | `listResourcePolicies()` / prefer `listPolicies({ kind: "resource" \| "aiSecurity" })` |
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=1&...` | `listLayers({ isZeroTrustLayer: 1 })` / prefer `listPolicies({ kind })` |
| create (two-step) | `createLayer({ isZeroTrustResourcePolicy: 1, ... })` |
| create + verify (agent) | `createResourcePolicy({…})` |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` / `getResourcePolicySettings(id)` |
| `PATCH /json/controls/policyLayers/settings` | `patchResourcePolicySettings(id, patch)` (`transport: "auto"` / `"native-patch"`) |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` (full replace) / `patchResourcePolicySettings` fallback / destinations write |
| `DELETE /json/controls/policyLayers?customCategoryId=` | `deleteLayer(id)` |
| `GET /json/controls/resourcePolicy/resources?customCategoryId=` | `getResourcePolicyResources(id)` |
| `PUT /json/controls/resourcePolicy/resources?customCategoryId=` | `associateResources({ customCategoryId, customCategoryNumber, resourceIds })` |

## Associating Resources

Resource Policies act on entries from the [Resource catalog](resources.md).
Associate the **enterprise-owned** copy of a resource:

```ts
const policy = await client.policies.createLayer({
  name: "Approved Apps",
  type: "allowlist",
  isZeroTrustResourcePolicy: 1,
  settings: { policyAction: 1, linkPolicyToAllSubjects: 1 },
});

const resource = await client.resources.getByName("Example SaaS App");
await client.policies.associateResources({
  customCategoryId: policy.customCategoryId,
  customCategoryNumber: policy.customCategoryNumber,
  resourceIds: [resource!.uuid],
});
```

Gotchas:

- Association is a **PUT** with `customCategoryId` as a query param and the
  body field named **`resourceIds`** — both ids are required.
- `dlpPolicyMethod: 2` is mandatory in every Resource Policy settings
  payload; omitting it produces broken policies.
- **`patchResourcePolicySettings` default `auto`:** native PATCH when the
  node supports it; 404/405 falls back to get-merge-full-POST. POST
  `?merge=1` is opt-in (`transport: "merge-post"`) only. Older nodes
  that ignore `?merge=1` will wipe on omit. TOCTOU on the fallback is
  accepted.
- CASB-control policies are allowlist-type Resource Policies with
  `enterpriseOwned: 1`.
- Group-targeted policies: `linkPolicyToAllSubjects: 0` +
  `associatedGroups: "2,3"` + `enableGroupAssociation: 1` in settings
  (group numbers from [default-policy-groups.md](default-policy-groups.md)).
