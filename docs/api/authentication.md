# Authentication

## API keys (recommended)

Generate an API key in the iboss admin console. The key is used **directly**
as the bearer on every request — there is no login/exchange step:

```
Authorization: Token <apiKey>
User-Agent: ibossAPI
```

```ts
const client = new IbossClient({
  domain: "api.ibosscloud.com",          // your cloud base API host
  credentials: { apiKey: process.env.IBOSS_API_KEY! },
});
await client.connect();

// Same headers, less boilerplate (DEVELOP-34913):
const fromEnv = IbossClient.fromEnv();
// IBOSS_API_KEY, IBOSS_CLOUD_DOMAIN, optional IBOSS_ACCOUNT_ID,
// IBOSS_GATEWAY_HOST / IBOSS_GATEWAY_URL, IBOSS_REPORTER_HOST / IBOSS_REPORTER_URL

const fromProfile = IbossClient.fromProfile(); // same files as the CLI
```

Every request (gateway **and** reporter, GETs included) sends
`Authorization: Token <key>` and `User-Agent: ibossAPI`. Omitting the UA is
an observed 401/403 mode. Policy writes go to the **gateway** (`/json/...`);
conversations go to the **reporter** (`/ibreports/...`). The same key on the
**cloud** host often returns `access.denied` for those paths — use
`client.raw("GET", "/json/...")` (tier inferred) or the 4-arg
`raw(tier, method, path)` form.

A 401 with an API key is terminal: the key is wrong, expired, revoked, or
scoped to a different cloud domain (`IbossAuthError`).

**An API key belongs to exactly one account.** `mySettings` returns only that
account for a key (username/password sessions see every associated account).
To operate on several accounts with keys, configure one key per account in a
profile (see docs/GETTING_STARTED.md); multi-account workflow runs iterate
those credentials.

## Discovery sequence (what connect() does)

| # | Request | Purpose |
|---|---------|---------|
| 1 | `GET /ibcloud/web/users/mySettings` | Validate key; list manageable accounts; capture cloud XSRF/session cookies |
| 2 | `GET /ibcloud/web/users/me` | The API user's `ibCloudUserId` (note the exact field name) |
| 3 | `GET /ibcloud/web/users/{userId}` | `apiCredentialExpiresAt` — key expiry (epoch s / epoch ms / ISO; SDK normalizes) |
| 4 | `GET /ibcloud/web/account/clusters` | Host map: per cluster take `members[primary===1].cloudNode.adminInterfaceDns`, keyed by `productFamily` (`swg`→gateway, `reports`→reporter, `rbi`→browser isolation); `clusterFullDns` → PAC-zone proxy host |
| 5 | `GET https://<reporter>/ibreports/web/users/me` | Prime reporter-host cookies |

Account selection: the primary account has `delegatedSuperAdminId === 0`.
Pass `accountSettingsId` in the client config (or `--account` on the CLI) to
pin a different one.

Gotchas:

- `primary === 1` is a **number**, not a string.
- Subscription availability comes from
  `subscriptionFeatureContext.subscriptionSettings` on each account — the SDK
  exposes flag presence as `account.subscriptionFlags` (e.g.
  `ENABLE_DLP_POLICIES_DASHBOARD`, `ENABLE_PRIVATE_ACCESS`).

## Key rotation

```
POST /ibcloud/web/users/account/{accountSettingsId}/apiUser/{userId}/rotateCredential?accountSettingsId=...
→ { opaqueToken, expiresAtMillis }
```

`client.account.rotateCredential()` / `npx iboss auth rotate-key`.
**The old key stops working immediately** and the new one is shown once —
persist it before doing anything else.

## Username/password login (alternative)

```
GET https://accounts.<domain>/ibossauth/web/tokens?ignoreAuthModule=true[&totpCode=<mfa>]
Authorization: Basic base64(username:password)
→ { token }        // ~4-hour session token
```

Special case: the production `ibosscloud.com` cloud authenticates via
`accounts.iboss.com` (the SDK's `accountsHostFor()` handles this).

```ts
import { UserPasswordCredentialProvider } from "@iboss/sdk";

const client = new IbossClient({
  domain: "api.ibosscloud.com",
  credentials: new UserPasswordCredentialProvider({
    username: "admin@example.com",
    password: process.env.IBOSS_PASSWORD!,
    totpProvider: async () => promptForMfaCode(),
  }),
});
```

The provider caches the session token and re-authenticates automatically on
expiry or 401.

## XSRF / cookies

Mutating requests need an `X-XSRF-TOKEN` header matching per-host session
cookies. The SDK's cookie jar handles this end to end — see
[errors-and-gotchas.md](errors-and-gotchas.md) if you hit a 403.
