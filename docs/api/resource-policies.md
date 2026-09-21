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
It still returns **ids only**. Trusting the settings POST 200 (or empty
`saveIgnoredEntries`) is wrong — the write can succeed while destinations
silently drop.

## One-shot create + verify (DEVELOP-34926)

Agent-facing equivalent of `POST …/resourcePolicies`. Internally still PUT
policyLayers + POST settings; the method then **re-GETs** and returns
effective settings (not ids / POST success).

Composes the sibling purpose-named surfaces:

- `destinations` — same body as `putResourcePolicyDestinations` (DEVELOP-34925)
- `settings` — same sparse patch as `patchResourcePolicySettings` (DEVELOP-34924)

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
// policy.destinations.categories === ["AI_SERVICES"]
// policy.settings is the re-GET (families hidden by default)
```

Default `type` is `"categories"` so destinations are expressable. Allowlist
+ destinations throws `IbossPolicyTypeError` **before any write** (allowlist
recreate silently drops the bitmap). CASB-style allowlist create omits
destinations and passes `type: "allowlist"`.

`createLayer` / `createLayerStructure` / `updateLayerSettings` are unchanged.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/resourcePolicies` | `listResourcePolicies()` |
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=1&...` | `listLayers({ isZeroTrustLayer: 1 })` |
| create (two-step, ids only) | `createLayer({ isZeroTrustResourcePolicy: 1, ... })` |
| create + verify (agent) | `createResourcePolicy({ name, destinations?, settings? })` |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` |
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
  payload; omitting it produces broken policies. `createResourcePolicy`
  always injects it.
- **Do not trust POST success.** `createResourcePolicy` re-GETs and throws
  `IbossVerifyError` if destinations or settings did not persist. Empty
  `saveIgnoredEntries` is not proof.
- Agents should not invent the 400-char `categories` bitmap or
  `categoriesSelectedType`. Pass `destinations: { mode: "selectedWebCategories",
  categories: ["AI_SERVICES"] }` (bit 110 + type 0).
- CASB-control policies are allowlist-type Resource Policies with
  `enterpriseOwned: 1`.
- Group-targeted policies: `linkPolicyToAllSubjects: 0` +
  `associatedGroups: "2,3"` + `enableGroupAssociation: 1` in settings
  (group numbers from [default-policy-groups.md](default-policy-groups.md)).
