# Policies by kind (agent list/query)

**SDK:** `client.policies.listPolicies({ kind })` ·
**Tickets:** DEVELOP-34927, DEVELOP-34915 ·
**Non-breaking:** `listLayers` and `listResourcePolicies` are unchanged.

Agents must not guess `typeFilter=9` (DLP) or choose between
`GET /json/controls/resourcePolicies` and
`GET /json/controls/policyLayers/all`. Use a purpose-named `kind`.

```ts
const dlp = await client.policies.listPolicies({ kind: "dlp" });
const ai = await client.policies.listPolicies({ kind: "aiSecurity" });
// dlp.items[0] = { id, number, name, kind, enabled, customType?, flags }
// dlp.filter documents the wire mapping that produced the list
```

`listDlpPolicies()` and `listAiSecurityPolicies()` compose
`listPolicies({ kind })` — same envelope, no second implementation.

There is no Gateway `GET /policies?kind=` yet. The SDK wraps today's
paths (optional sibling later: `GET /json/controls/resourcePolicies?kind=`).

## Kind enum → wire filter

| `kind` | Wire path | Wire filters | Client filter after the list |
|---|---|---|---|
| `dlp` | `GET /json/controls/policyLayers/all` | `typeFilter=9`, `isZeroTrustLayer=-1` | none |
| `aiSecurity` | `GET /json/controls/resourcePolicies` | — | `aiRiskEnabled` / `aiRiskEngines` (GET settings when the list row omits them) |
| `resource` | `GET /json/controls/resourcePolicies` | — | drop Private Access rows |
| `internet` | alias of `resource` | same | same |
| `layer` | `GET /json/controls/policyLayers/all` | `isZeroTrustLayer=0`, `typeFilter=-1` | exclude connector (`customType` 12) and DLP (9) |
| `connector` | `GET /json/controls/policyLayers/all` | `isZeroTrustLayer=0`, `typeFilter=-1` | `customType === 12` |
| `privateAccess` | `GET /json/controls/resourcePolicies` | — | `ztnaFlowPeerIds` or `isZtnaPrivateAccessCategory` |
| `all` | `GET /json/controls/policyLayers/all` | `isZeroTrustLayer=-1`, `typeFilter=-1` | classify each row |

`isZeroTrustLayer`: −1 all, 0 overlay layers, 1 resource policies.
`typeFilter`: −1 all types; **9 = DLP**.

GET `customType` integers: `0` blocklist, `1` allowlist, `3` or `13`
categories, `9` DLP, `12` connector. Create still uses
`e_custom_category_type_*` strings for some types.

If `GET /json/controls/resourcePolicies` returns 404/405, resource-noun
kinds fall back to `policyLayers/all?isZeroTrustLayer=1`.

The table is also exported as `POLICY_KIND_FILTERS` /
`POLICY_TYPE_FILTER` / `POLICY_CUSTOM_TYPE` from `@iboss/sdk`.

## Stable response shape

```ts
{
  kind: "dlp" | "aiSecurity" | "resource" | "layer" | "connector" | "privateAccess" | "all",
  items: Array<{
    id: number;       // customCategoryId
    number: number;   // customCategoryNumber
    name: string;
    kind: /* classified or requested kind */;
    enabled: boolean;
    customType?: string | number;
    flags: {
      isZeroTrustResourcePolicy: boolean;
      isZtnaPrivateAccess: boolean;
      aiRiskEnabled: boolean;
    };
  }>,
  total: number,
  filter: { kind, path, isZeroTrustLayer?, typeFilter?, clientFilter },
}
```

`kind: "resource"` includes AI Security policies (they are resource
policies) and excludes Private Access. Use `kind: "aiSecurity"` when you
only want the AI subset.

## Legacy APIs (do not change callers)

| Method | Still does |
|---|---|
| `listLayers({ isZeroTrustLayer?, typeFilter? })` | paginated `/policyLayers/all`; raw `PolicyLayer[]` |
| `listResourcePolicies()` | `GET /json/controls/resourcePolicies`; raw records |

Prefer `listPolicies` in new agent workflows.
