# Architecture

## The iboss platform's API model

The iboss cloud is distributed: different functional areas are served by
different **node types**, each with its own hostname. A client must talk to
the right host per capability:

```
                       ┌───────────────────────────────┐
                       │  accounts.<domain>            │  login/token APIs
                       │  (auth tier)                  │  (only needed for
                       └───────────────────────────────┘   password login)
┌────────────────────────────────────────────────────────────────────────┐
│  cloud base host — config.domain, e.g. api.ibosscloud.com              │
│  /ibcloud/web/...                                                      │
│  accounts, groups, locations/PAC zones, private networks,              │
│  zero-trust resources, cloud preferences, cluster/node inventory       │
└────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────┐  ┌────────────────────────────────┐
│  gateway node (per account)       │  │  reporter node (per account)   │
│  /json/...                        │  │  /ibreports/web/...            │
│  policy layers, resource policies,│  │  reports, URL logs,            │
│  firewall, apps, DLP, SSL, proxy, │  │  incident settings,            │
│  ZTNA peers, users/devices        │  │  AI Governance conversations   │
└───────────────────────────────────┘  └────────────────────────────────┘
```

Gateway/reporter (and Browser Isolation) hostnames are **never hardcoded** —
they are discovered per account at connect time. Agents may pin them via
`IBOSS_GATEWAY_HOST` / `IBOSS_REPORTER_HOST` (or the `*_URL` forms) when
using `IbossClient.fromEnv()`; those override discovery.

## Authentication

The recommended credential is an **API key** generated in the iboss admin
console. The key is the bearer: every request carries

```
Authorization: Token <apiKey>
User-Agent: ibossAPI
```

There is no login exchange for API keys. (Username/password + MFA login is
supported as an alternative via `UserPasswordCredentialProvider`, which mints
a ~4-hour session token from the accounts host and refreshes automatically.)

### connect() — the discovery sequence

`client.connect()` (idempotent, auto-invoked by every API call) performs:

1. `GET /ibcloud/web/users/mySettings` — validates the credential and lists
   the accounts it can manage. The primary account (`delegatedSuperAdminId ===
   0`) is selected unless `accountSettingsId` pins another. Captures the cloud
   host's `XSRF-TOKEN`/`JSESSIONID` cookies.
2. `GET /ibcloud/web/users/me` — resolves the API user's `ibCloudUserId`.
3. `GET /ibcloud/web/users/{id}` — reads `apiCredentialExpiresAt` (best
   effort; the platform reports it as epoch seconds, millis, or ISO — the SDK
   normalizes).
4. `GET /ibcloud/web/account/clusters` — walks the account's clusters and maps
   each `productFamily` (`swg` → gateway, `reports` → reporter, `rbi` →
   browser isolation) to the **primary member's** `cloudNode.adminInterfaceDns`.
   Also captures the SWG `clusterFullDns` (used for PAC-zone proxy hosts).
5. `GET https://<reporter>/ibreports/web/users/me` — primes reporter-host
   cookies so mutating reporter calls have XSRF state.

The result is the `SessionState` (`client.session`): accounts, selected
account with subscription flags, user id, key expiry, host map.

## Cookies and XSRF

The platform's endpoints sit behind Spring-style CSRF protection: mutating
requests need an `X-XSRF-TOKEN` header matching the session state established
via cookies — **per host**. Native `fetch` doesn't persist cookies, so the SDK
keeps its own per-host cookie jar:

- Every response's `Set-Cookie` headers are stored, scoped to the issuing host
  (or its `Domain` attribute). Cookies flow to subdomains of their domain —
  the discovered node hosts are subdomains of the cloud domain and expect the
  cloud session cookies.
- On **every** request (GETs included — the platform requires it), the SDK
  sends the target host's own `XSRF-TOKEN` cookie value as the `X-XSRF-TOKEN`
  header, falling back to the cloud host's token before the target host has
  issued one (gateway nodes accept this and issue their own on first contact).

A 403 on a mutation is therefore almost always XSRF/session state, not
permissions — the SDK raises it as `IbossXsrfError` to make that explicit.

## The request layer

Every call from every sub-client funnels through one choke point
(`packages/sdk/src/client/request.ts`), which handles:

- host-tier resolution (throws `IbossHostUnavailableError` naming the missing
  node type, e.g. an account with no reporting cluster)
- standard headers, per-host cookies, XSRF selection
- `accountSettingsId` query param injection (all tiers except the auth host)
- retries: full-jitter exponential backoff; transport errors retry for all
  methods, 5xx retries only for idempotent methods (POST responses may have
  mutated state); 4xx never retries
- one credential `refresh()` on 401 (only for refreshable providers — a static
  API key fails fast with `IbossAuthError`)
- error mapping to the typed hierarchy; redacted debug logging
  (`IBOSS_DEBUG=1`)

## Multi-account

An **API key is scoped to exactly one account** — `mySettings` returns only
that account for a key. Operating on several accounts therefore means one key
per account, organized in a profile's `accounts` list
(see docs/GETTING_STARTED.md). `ctx.forEachAccount(fn)` iterates those
credentials, building a fresh client per account (own key, own cookie jar),
so sessions never leak between tenants.

Username/password sessions do see every associated account; for that
credential type `client.forAccount(id)` re-scopes the same session to another
account with fresh discovery state.

## Workflow engine

`runWorkflow()` (`packages/sdk/src/workflows/runner.ts`) is the single engine:
it validates input against the workflow's zod schema, builds/connects the
client, and streams `WorkflowEvent`s to a caller-supplied sink. The CLI
renders those events to the terminal; the web UI server buffers them and
relays over SSE. Neither owns any workflow logic.
