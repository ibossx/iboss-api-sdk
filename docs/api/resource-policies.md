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

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/resourcePolicies` | `listResourcePolicies()` |
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=1&...` | `listLayers({ isZeroTrustLayer: 1 })` |
| create (two-step) | `createLayer({ isZeroTrustResourcePolicy: 1, ... })` |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` |
| `DELETE /json/controls/policyLayers?customCategoryId=` | `deleteLayer(id)` |
| `GET /json/controls/resourcePolicy/resources?customCategoryId=` | `getResourcePolicyResources(id)` |
| `PUT /json/controls/resourcePolicy/resources?customCategoryId=` | `associateResources({ customCategoryId, customCategoryNumber, resourceIds })` |
| purpose-named destinations (typed) | `getResourcePolicyDestinations(id)` / `putResourcePolicyDestinations(id, spec)` |

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
- CASB-control policies are allowlist-type Resource Policies with
  `enterpriseOwned: 1`.
- Group-targeted policies: `linkPolicyToAllSubjects: 0` +
  `associatedGroups: "2,3"` + `enableGroupAssociation: 1` in settings
  (group numbers from [default-policy-groups.md](default-policy-groups.md)).

## Typed destinations (agents — DEVELOP-34925)

Do **not** invent the 400-char `categories` bitmap or the inverted
`categoriesSelectedType` enum (`0` = Selected Destinations, `1` = all).
Use the purpose-named API:

```ts
// PUT …/resourcePolicies/{id}/destinations
await client.policies.putResourcePolicyDestinations(id, {
  mode: "selectedWebCategories",
  categories: ["AI_SERVICES"],
});

const dest = await client.policies.getResourcePolicyDestinations(id);
// { mode: "selectedWebCategories", categories: ["AI_SERVICES"] }

await client.policies.ensureAiSecurityDestination(id); // same as above
```

`AI_SERVICES` maps to **bit 110** on the legacy `categories` bitmap. The SDK
encodes that plus `categoriesSelectedType: 0` onto a full settings GET/POST
(`GET`/`POST /json/controls/policyLayers/settings`). Old clients can still
send the wire fields; agents should not.

**Allowlist + categories is never a silent drop.** An allowlist recreate
(`customType: 1`) stores an empty `categories` string — AI Services becomes
unexpressable. `putResourcePolicyDestinations` throws `IbossPolicyTypeError`
by default. Pass `onWrongType: "warn"` to skip the write (layer unchanged)
instead of posting a doomed bitmap. Delete the wrong-type layer and recreate
as `type: "categories"` (`e_custom_category_type_categories`). GET
`customType` `3` or `13` still carries a bitmap.

Re-GET is required. POST success / empty `saveIgnoredEntries` is not
persistence — a failed persist throws `IbossVerifyError`.
