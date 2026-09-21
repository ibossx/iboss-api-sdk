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

## Agent snippet — sparse GET/PATCH (DEVELOP-34924)

Purpose-named equivalent of `GET/PATCH …/resourcePolicies/{id}/settings`.
Wire today is still `/json/controls/policyLayers/settings?customCategoryId=<id>`
(`Authorization: Token …`, `User-Agent: ibossAPI`).

Send **only the field you want to change**. Do not invent `catN` / `prioN` /
`bypassSslMitmN` or the 400-char `categories` bitmap.

```ts
const id = 1114; // customCategoryId

// Default view hides generated families so they never enter the prompt.
const current = await client.policies.getResourcePolicySettings(id);
// current.aiRiskEnabled, current.policyAction, … — no cat0..cat110

// Omit-safe: note / allowLargeFiles / families stay as they were.
await client.policies.patchResourcePolicySettings(id, { aiRiskEnabled: 1 });

// Full wire blob only when you truly need it:
const full = await client.policies.getResourcePolicySettings(id, { view: "full" });
```

| Method | What it does |
|---|---|
| `getResourcePolicySettings(id, { view? })` | Dedicated read. Default `summary` omits catN / prioN / bypassSslMitmN / `categories`. `full` is the GET blob. Same wire as `getLayerSettings`. |
| `patchResourcePolicySettings(id, patch)` | Sparse omit-safe update. `auto` (default): native `PATCH` (DEVELOP-34921). If the gateway returns 404/405, DEVELOP-34914 get→deep-merge→**full** POST. Re-GETs and throws `IbossVerifyError` if the patched keys did not persist. |
| `updateLayerSettings(fullBlob)` | Unchanged **full replace**. Sparse bodies wipe omitted families. |

Transport override: `transport: "native-patch" | "merge-post" | "get-merge-post"`.
`merge-post` is POST `?merge=1` (also DEVELOP-34921). **`auto` does not use
it** — a pre-34921 gateway ignores `merge` and wipe-replaces. Prefer PATCH
or the get-merge-post fallback.

TOCTOU on the get-merge-post fallback (GET → merge → POST race) is accepted
for agent v1, same as DEVELOP-34914.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/resourcePolicies` | `listResourcePolicies()` |
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=1&...` | `listLayers({ isZeroTrustLayer: 1 })` |
| create (two-step) | `createLayer({ isZeroTrustResourcePolicy: 1, ... })` |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` / `getResourcePolicySettings(id)` |
| `PATCH /json/controls/policyLayers/settings?customCategoryId=` | `patchResourcePolicySettings(id, patch)` (native merge; DEVELOP-34921) |
| `POST /json/controls/policyLayers/settings?merge=1` | `patchResourcePolicySettings(id, patch, { transport: "merge-post" })` |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` (full replace) / 34914 fallback inside `patchResourcePolicySettings` |
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
  payload; omitting it produces broken policies. `createLayer` and the
  get-merge-post fallback inject it when missing; native PATCH does not
  invent it (omit-safe).
- **Do not sparse-POST settings.** Plain `POST …/policyLayers/settings`
  without `?merge=1` Gateway-defaults omitted `catN` / `prioN` /
  `bypassSslMitmN` (DEVELOP-34251 / DEVELOP-32482). Use
  `patchResourcePolicySettings`.
- CASB-control policies are allowlist-type Resource Policies with
  `enterpriseOwned: 1`.
- Group-targeted policies: `linkPolicyToAllSubjects: 0` +
  `associatedGroups: "2,3"` + `enableGroupAssociation: 1` in settings
  (group numbers from [default-policy-groups.md](default-policy-groups.md)).
