# API Reference — Index

Endpoint documentation for the iboss Zero Trust SSE API as wrapped by this
SDK, organized to match the sections of the iboss admin console. Each doc
lists the endpoints, the SDK methods that wrap them, payload notes, and
gotchas.

| Doc | Admin console section | SDK methods | Covers |
|---|---|---|---|
| [authentication.md](authentication.md) | (API keys: admin console key management) | — | API keys, connect()/discovery, rotation, password login |
| [accounts-and-clusters.md](accounts-and-clusters.md) | Account settings, Cloud Health | `client.account` | accounts, key expiry/rotation, preferences, clusters/nodes |
| [resource-policies.md](resource-policies.md) | Secure Access Policies → SaaS & Internet Access Policies | `client.policies` | Resource Policies: internet/SaaS access control, CASB, resource association |
| [private-access-policies.md](private-access-policies.md) | Secure Access Policies → Private Access Policies | `client.network`, `client.policies` | ZTNA: routed policies, routed peers, private access general settings |
| [policy-layers.md](policy-layers.md) | Secure Access Policies → Policy Layers | `client.policies` | overlay policy layers linked to default policy groups |
| [default-policy-groups.md](default-policy-groups.md) | Secure Access Policies → Default Policies | `client.groups`, `client.apps` | default policy groups (names, settings) and per-group web controls |
| [connector-policies.md](connector-policies.md) | Connect Devices & Locations → Connector Policies / Settings | `client.policies`, `client.network` | iboss agent (connector) configuration policies and general settings |
| [resources.md](resources.md) | Resources | `client.resources` | the Resource catalog: SaaS apps, private apps/services used by Resource Policies |
| [locations-pac.md](locations-pac.md) | Connect Devices & Locations → Locations & Geo Zones | `client.locations` | locations (PAC zones), private networks |
| [firewall.md](firewall.md) | Secure Access Policies → Firewall | `client.firewall` | firewall rules and firewall settings |
| [proxy-and-caching.md](proxy-and-caching.md) | Network → Proxy & Caching | `client.network` | proxy settings and proxy logging |
| [ssl-decryption.md](ssl-decryption.md) | Network → SSL Decryption | `client.ssl` | HTTPS decryption settings and bypasses |
| [dlp.md](dlp.md) | DLP | `client.dlp` | content analysis rules, DLP responses, converters |
| [users-and-devices.md](users-and-devices.md) | Resources, Users & Assets | `client.directory` | static proxy users and devices |
| [reporting-and-logs.md](reporting-and-logs.md) | Reporting | `client.reporting` | drill-down reports, URL logs, incident settings |
| [errors-and-gotchas.md](errors-and-gotchas.md) | — | — | status-code semantics, XSRF, host routing |

Cross-cutting proposal (discovery only; no runtime changes yet):
[Agent-friendly APIs](../agent-apis.md) — epic dedicated Resource
Policy read/UPDATE, Sep 9–10 ground-truth shapes, confirmed
footguns, and non-breaking wrappers for
[DEVELOP-34912](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34912).

## The four policy types (they look similar on the wire)

All four are created through the same gateway endpoints
(`/json/controls/policyLayers`), but they are different things in the
console. The distinguishing fields:

| Console section | Doc | Distinguishing fields |
|---|---|---|
| SaaS & Internet Access Policies | [resource-policies.md](resource-policies.md) | `isZeroTrustResourcePolicy: 1` (+ mandatory `dlpPolicyMethod: 2` in settings) |
| Private Access Policies | [private-access-policies.md](private-access-policies.md) | resource-policy shape + `ztnaFlowPeerIds` linking to routed peers |
| Policy Layers | [policy-layers.md](policy-layers.md) | `isZeroTrustResourcePolicy: 0`, overlay layers linked to default policy groups |
| Connector Policies | [connector-policies.md](connector-policies.md) | `customType: 12`, platform group association |

## Conventions (apply everywhere)

- **Headers** (the SDK sets these automatically):
  `Authorization: Token <apiKey>`, `User-Agent: ibossAPI`,
  `Content-Type: application/json;charset=UTF-8` on bodied requests, per-host
  `Cookie` + `X-XSRF-TOKEN` on every request.
- **`accountSettingsId`** — required as a query param by nearly every
  endpoint; the SDK appends the selected account's id automatically. Never add
  it manually.
- **Host tiers** — cloud (`/ibcloud/web/...`), gateway (`/json/...`),
  reporter (`/ibreports/web/...`). Sub-clients route automatically; with
  `client.raw()` you name the tier.
- **Per-policy-group endpoints** (gateway) take the group number as
  `currentPolicyBeingEdited`.
- **List envelopes** — gateway lists usually return
  `{ entries: [...], totalCount }`; cloud lists return bare arrays or
  `{ successful, result }`. Sub-clients normalize to plain arrays.
- **Escape hatch** — `client.raw(tier, method, path, { query, body })` or
  `npx iboss api <METHOD> <path> [--host tier]` for anything not wrapped.
