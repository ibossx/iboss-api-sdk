# Errors & Gotchas

## Status-code semantics

| Status | SDK error | Meaning | What to do |
|--------|-----------|---------|------------|
| 401 | `IbossAuthError` | Key missing/expired/revoked/wrong cloud domain | Check the key and `IBOSS_CLOUD_DOMAIN`; rotate/regenerate if needed |
| 403 (on mutation) | `IbossXsrfError` | XSRF token didn't match the target host's session — almost never a permissions issue | Usually a bug in custom request code; the SDK's request layer handles XSRF automatically |
| 403 (on GET) | `IbossApiError` | Gateway/reporter nodes require the `X-XSRF-TOKEN` header and session cookies on **all** requests, GETs included | The SDK sends them on every request; with hand-rolled fetch, copy the SDK's header set |
| 404 | `IbossApiError` | Wrong path or wrong **host tier** | Confirm the tier: `/json/...`→gateway, `/ibcloud/web/...`→cloud, `/ibreports/...`→reporter |
| 422 | `IbossSubscriptionError` | Account lacks the module's subscription, or payload shape invalid | Check `session.account.subscriptionFlags`; for DLP/ZTNA treat as an expected skip |
| 5xx / network | retried, then `IbossApiError` / `IbossNetworkError` | Transient platform/network issue | The SDK already retried (idempotent methods) |
| n/a | `IbossVerifyError` | Settings POST succeeded but re-GET did not show the intended fields (bitmap / `categoriesSelectedType` / `dlpPolicyMethod` / `aiRisk*`) | Do not trust POST success or empty `saveIgnoredEntries`; fix the payload or recreate as categories-type |
| n/a | `IbossPolicyTypeError` | Allowlist/blocklist + categories destinations | Bitmap would be silently dropped. Delete and recreate with `e_custom_category_type_categories` |

All API errors carry `method`, `url`, `status`, and a truncated response
`body` for diagnostics.

## Host routing table

| Path prefix | Tier | Example capability |
|---|---|---|
| `/ibcloud/web/...` | cloud (config.domain) | accounts, groups, PAC zones, resources, preferences |
| `/json/...` | gateway node (discovered) | policy layers, firewall, DLP, SSL, ZTNA, users/devices |
| `/ibreports/web/...` | reporter node (discovered) | reports, URL logs, incidents |
| `/ibossauth/web/...` | accounts host | login/token APIs |

`IbossHostUnavailableError` means the account has no node of that type (e.g.
no reporting cluster provisioned).

## Platform gotchas (hard-won)

- **Four policy types share one wire shape.** Resource Policies, Private
  Access routed policies, Policy Layers, and Connector Policies are all
  created through `/json/controls/policyLayers` — see the type table in
  [README.md](README.md) for the distinguishing fields.
- **Two-step policy creation.** Creating any of them is
  `PUT /json/controls/policyLayers` (structure) then
  `POST /json/controls/policyLayers/settings` (full settings). A policy
  created without the settings step is incomplete. Use
  `client.policies.createLayer()` which does both.
- **`dlpPolicyMethod: 2` is mandatory** in every *Resource Policy* settings
  payload. `createLayer({ isZeroTrustResourcePolicy: 1 })` adds it.
- **Settings payloads carry generated field families**: `cat0..cat110` (=3),
  `prio0..prio110` (=0), `bypassSslMitm0..bypassSslMitm110` (=0), and a
  400-char `categories` bitmap. Helpers: `generateCategoryFields()` etc.
  Gateway POST **defaults omitted fields** (DEVELOP-34251 / DEVELOP-32482) —
  never POST a partial settings blob. `patchResourcePolicySettings` GETs
  the full object, deep-merges, and POSTs the complete merge. There is no
  native Gateway PATCH. TOCTOU on that GET→POST is accepted for agent v1.
- **AI Services destination** is bit **110** of the bitmap plus
  `categoriesSelectedType: 0` (Selected Destinations — inverted enum). Use
  `ensureAiSecurityDestination` / `setDestination`. Allowlist recreate
  (`customType: 1`) silently drops the bitmap.
- **Always re-GET after a settings POST.** Empty `saveIgnoredEntries` is not
  proof the fields persisted.
- **Routed peer creation returns no UUID.** After
  `PUT /json/network/mobileClients/peer`, re-list peers and match on
  `locationUuids`/name; propagation can take seconds. Use
  `client.network.createPeerAndFind()`.
- **PAC zone listing is `/pacZones` (plural) + `requestKey=v2` + pagination
  params** — all required; the singular path 500s for listing. PAC zone
  updates are full-echo (GET → modify → PUT the whole object).
- **Resource-policy association** is `PUT
  /json/controls/resourcePolicy/resources?customCategoryId=` with body
  `{ customCategoryNumber, resourceIds }` — both ids, and the field is
  `resourceIds`.
- **PAC zone proxy hosts** must use the discovered cluster DNS:
  `` `${client.session.hosts.gatewayClusterDns}:80` `` — never a node
  hostname.
- **`ibCloudUserId`** is the exact wire field name for the API user id (not
  `userId`).
- **`mySettings` returns exactly one account per API key.** A key cannot see
  or operate on sibling accounts; multi-account automation uses one key per
  account (a profile's `accounts` list).
- **Expiry timestamps are inconsistent** (epoch seconds, epoch millis, or ISO
  strings). `parseIbossExpiry()` normalizes.
- **Full-object updates.** Several update endpoints (filtering groups, proxy
  users/devices) expect the complete object back, not a patch — GET first,
  modify, POST.
- **DLP endpoints 422 without a DLP subscription** — expected behavior, not
  an error in your code.

## Debug logging

```sh
IBOSS_DEBUG=1 npx iboss auth test
```

Prints every request/attempt with **redacted** credentials, cookies, and
tokens. The SDK never logs secret values.
