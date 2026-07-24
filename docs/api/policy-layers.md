# Policy Layers

**Console:** Secure Access Policies → Policy Layers ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.policies`

Policy Layers are **overlay policies** — blocklists, allowlists, and
category-based filters that can be layered on top of, and linked to,
[default policy groups](default-policy-groups.md). They are separate from
[Resource Policies](resource-policies.md) (SaaS & Internet Access Policies),
which share the same wire endpoints but carry `isZeroTrustResourcePolicy: 1`.

## Creation is two-step

1. **Create structure** — `PUT /json/controls/policyLayers`

   ```json
   {
     "customCategoryName": "SDK Blocklist",
     "customType": "e_custom_category_type_blacklist",
     "isZtnaPrivateAccessCategory": 0,
     "isZeroTrustResourcePolicy": 0,
     "placeAtPosition": 0
   }
   ```
   → `{ customCategoryId, customCategoryNumber, id, successful }`

2. **Apply settings** — `POST /json/controls/policyLayers/settings` with the
   ids from step 1 plus `policyEnabled`, `policyAction` (1=allow, 0=block),
   `linkPolicyToAllSubjects`, and the generated field families.

`client.policies.createLayer()` does both steps with correct defaults:

```ts
const layer = await client.policies.createLayer({
  name: "SDK Blocklist",
  type: "blocklist",                       // "blocklist" | "allowlist" | "categories"
  settings: { policyAction: 0 },           // merged over the defaults
});
await client.policies.addLayerUrl(layer.customCategoryId, "blocked.example.com");
```

`customType` wire values: blocklist = `e_custom_category_type_blacklist`,
allowlist = `e_custom_category_type_allowlist`, categories =
`e_custom_category_type_categories`.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/policyLayers/all?isZeroTrustLayer=0&typeFilter=&currentRow=&maxItems=&…` | `listLayers({ isZeroTrustLayer: 0 })` — paginated; the SDK pages for you; the empty filter params are required |
| `GET /json/controls/policyLayers/settings?customCategoryId=` | `getLayerSettings(id)` |
| `PUT /json/controls/policyLayers` | `createLayerStructure(...)` (step 1 only) |
| `POST /json/controls/policyLayers/settings` | `updateLayerSettings(...)` (step 2 only) |
| both steps | **`createLayer(...)`** ← use this |
| `DELETE /json/controls/policyLayers?customCategoryId=` | `deleteLayer(id)` |
| `GET /json/controls/policyLayers/urls?customCategoryId=` | `getLayerUrls(id)` |
| `PUT /json/controls/policyLayers/urls` | `addLayerUrl(id, url)` |
| `DELETE /json/controls/policyLayers/urls?customCategoryId=&url=` | `removeLayerUrl(id, url)` |
| `PUT /bulk/controls/policyLayers/urls` | `importLayerUrls({ customCategoryId, customCategoryNumber, urls })` — bulk import, much faster than add in a loop |

`listLayers` filters: `isZeroTrustLayer` −1 = all policy types (default),
0 = overlay layers only, 1 = resource policies only; `typeFilter` −1 = all
types.

## Linking to default policy groups

Layers apply either to everyone (`linkPolicyToAllSubjects: 1`) or to
specific default policy groups: `linkPolicyToAllSubjects: 0` with
`associatedGroups: "<comma-separated group numbers>"` and
`enableGroupAssociation: 1` in the settings payload. Group numbers come from
[default-policy-groups.md](default-policy-groups.md).

## Field-family helpers

Settings payloads carry generated field families. `createLayer()` includes
them automatically; use the helpers when hand-building a payload for
`updateLayerSettings()` or `raw()`:

```ts
import {
  generateCategoryFields,     // { cat0: 3, ..., cat110: 3 }
  generatePriorityFields,     // { prio0: 0, ..., prio110: 0 }
  generateBypassSslMitmFields,// { bypassSslMitm0: 0, ... }
  emptyCategoriesBitmap,      // "000...0" (400 chars)
} from "@iboss/sdk";
```
