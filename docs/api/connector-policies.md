# Connector Policies (iboss agent configuration)

**Console:** Connect Devices & Locations → Connector Policies / Connector Settings ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.policies`, `client.network`

Connector Policies configure the iboss agent (connector) per platform:
Windows, macOS, iOS, Chromebook, Android, Linux. Each platform's default
policy targets that platform's default policy groups.

## Connector policy objects

Created through the same two-step flow as other policies
(`client.policies.createLayerStructure` + `updateLayerSettings`), with
connector-specific fields:

```jsonc
{
  "customCategoryName": "Default Windows Connector Policy",
  "customType": 12,                 // connector policy type (numeric, not the e_custom_* strings)
  "isZeroTrustResourcePolicy": 0,
  "isZtnaPrivateAccessCategory": 0,
  "mappedToOsType": 0,              // platform identification
  "enterpriseOwned": 0,
  "policyEnabled": 1,
  "linkPolicyToAllSubjects": 0,     // connector policies use group association
  "associatedGroups": "2,3,4,5,6",  // platform default groups (see below)
  "enableGroupAssociation": 1
}
```

Platform default policy group associations:

| Platform | associatedGroups |
|---|---|
| Windows / macOS / Linux | `"2,3,4,5,6"` |
| iOS | `"7"` |
| Chromebook | `"8"` |
| Android | `"9"` |

List existing connector policies with
`client.policies.listPolicies({ kind: "connector" })`
(maps to `listLayers({ isZeroTrustLayer: 0 })` plus `customType === 12`).
The legacy `listLayers` path is unchanged.

## Connector general settings (security keys)

Per-policy-group connector settings, including the connector **security
key** the agent registers with:

| Endpoint | SDK method |
|---|---|
| `GET /json/network/mobileClients/settings?currentPolicyBeingEdited=` | `client.network.getMobileClientSettings(policyGroup)` |
| `POST /json/network/mobileClients/settings?currentPolicyBeingEdited=` | `client.network.updateMobileClientSettings(policyGroup, settings)` |

Gotchas:

- Security keys are 16-character alphanumeric values; generate with a CSPRNG
  (`node:crypto`), never hardcode.
- Settings objects are full-echo: GET, modify, POST the whole object back.
- Hardening defaults commonly applied to connector policies:
  `EnableDoH: 0` (disable encrypted DNS so the connector controls
  resolution).
