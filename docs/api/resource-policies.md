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

## Agent helpers (DEVELOP-34914 / 34916)

**SDK-only.** There is no native Gateway PATCH and this repo does not
change lockboxLinux / Gateway. `patchResourcePolicySettings` is
get → deep-merge → POST of the **full** settings object on the existing
paths:

```
GET  /json/controls/policyLayers/settings?customCategoryId=…
POST /json/controls/policyLayers/settings    body = merged GET + patch
```

Gateway POST applies defaults for omitted fields (same class as
[DEVELOP-34251](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34251)
and [DEVELOP-32482](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-32482)),
so a partial body would wipe `catN` / `prioN` / `bypassSslMitmN`. Omitted
patch keys **keep prior GET values**. The GET→merge→POST race (TOCTOU) is
accepted for agent v1.

Agents should not send the 400-char `categories` bitmap or invent
`categoriesSelectedType`. Sep 9–10 Bug Replicator traces: the settings POST
that **stuck** used `categoriesSelectedType: 0` (UI “Selected Destinations”)
and a 400-char bitmap with **only bit 110** set (AI Services). Allowlist
recreate (`customType: 1`) **silently drops** that bitmap — later POSTs can
flip `aiRiskEnabled: 1` and still leave destinations empty. POST success
(including empty `saveIgnoredEntries`) is **not** persistence.

```ts
const client = IbossClient.fromEnv(); // IBOSS_API_KEY + IBOSS_CLOUD_DOMAIN

const policy = await client.policies.createResourcePolicy({
  name: "AI Security",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
  aiRiskEnabled: true,
  aiRiskEngines: "chatgpt",
  linkPolicyToAllSubjects: true,
  aiRiskMonitoringMessage: "AI use is monitored.",
});

await client.policies.ensureAiSecurityDestination(policy.customCategoryId);

await client.policies.patchResourcePolicySettings(policy.customCategoryId, {
  aiRiskEnabled: 1,
  aiRiskEngines: "all",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
});
```

| Method | What it does |
|---|---|
| `getResourcePolicySettings(id, { view? })` | Dedicated read. Default `summary` hides the bitmap / catN families. `full` is the wire blob. Today this wraps `GET /json/controls/policyLayers/settings`. |
| `patchResourcePolicySettings(id, patch)` | SDK-only get → deep-merge → **full** POST of today’s settings path. Not a Gateway PATCH. Agents send only changed fields; omitted keys keep prior values including all catN/prioN/bypassSslMitmN. Re-GETs; TOCTOU accepted for agent v1. |
| `setDestination` / `ensureAiSecurityDestination` | Encode bit 110 + `categoriesSelectedType: 0`. Reject allowlist+categories (`IbossPolicyTypeError`); pass `onWrongType: "warn"` to skip encoding. |
| `createResourcePolicy({…})` | PUT categories-type structure + POST settings + re-GET. Returns effective settings, not just ids. |

`updateLayerSettings(fullBlob)` and `createLayer()` are unchanged full-replace / id-returning APIs.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/resourcePolicies` | `listResourcePolicies()` |
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=1&...` | `listLayers({ isZeroTrustLayer: 1 })` |
| create (two-step) | `createLayer({ isZeroTrustResourcePolicy: 1, ... })` |
| create + verify (agent) | `createResourcePolicy({…})` |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` / `getResourcePolicySettings(id)` |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` (full replace) / `patchResourcePolicySettings(id, patch)` (get-merge-post) |
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
- **No native Gateway PATCH.** SDK `patchResourcePolicySettings` is GET →
  deep-merge → full POST. TOCTOU between those calls is accepted for
  agent v1.
- CASB-control policies are allowlist-type Resource Policies with
  `enterpriseOwned: 1`.
- Group-targeted policies: `linkPolicyToAllSubjects: 0` +
  `associatedGroups: "2,3"` + `enableGroupAssociation: 1` in settings
  (group numbers from [default-policy-groups.md](default-policy-groups.md)).
