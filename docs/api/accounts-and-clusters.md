# Accounts, Credentials & Cloud Preferences

**Console:** Account settings, Cloud Health ·
**Tier:** cloud (`/ibcloud/web/...`) · **SDK:** `client.account`

## Accounts & session

| Endpoint | SDK method |
|---|---|
| `GET /ibcloud/web/users/mySettings` | done by `connect()`; results on `client.session.accounts` / `account.listAccounts()` |
| `GET /ibcloud/web/users/me` | done by `connect()` → `session.ibCloudUserId` |
| `GET /ibcloud/web/users/{userId}` | done by `connect()` → `session.apiCredentialExpiresAt` / `account.credentialExpiry()` |
| `POST /ibcloud/web/users/account/{acct}/apiUser/{user}/rotateCredential` | `account.rotateCredential()` — returns the NEW key once; old key dies immediately |
| `GET /ibcloud/web/account/clusters` | `account.listClusters()` (also done by `connect()` for host discovery) |
| `GET /ibcloud/web/cloudNodes` | `account.listCloudNodes()` |

Account entries include `delegatedSuperAdminId` (0 = primary) and
`subscriptionFeatureContext.subscriptionSettings` (module availability —
surfaced as `account.subscriptionFlags`).

## Preferences

| Endpoint | SDK method | Notes |
|---|---|---|
| `GET/POST /ibcloud/web/preferences/generalSettings` | `getGeneralSettings()` / `updateGeneralSettings()` | alert/exception/maintenance emails, `communicationType` |
| `GET/POST /ibcloud/web/preferences/ntpSettings` | `getNtpSettings()` / `updateNtpSettings()` | `ntpServer`, IANA `timezone`, `dateFormat` (0=MM/DD/YYYY) |
| `POST /ibcloud/web/preferences/updateReleaseSettings` | `updateReleaseSettings({ updateReleaseLevel })` | 5 = Generally Available channel |
| `POST /ibcloud/web/preferences/autoUpdateSettings` | `updateAutoUpdateSettings(...)` | update windows/days |
| `GET/PUT /ibcloud/web/releaseNotes/recipients` | `getReleaseNotesRecipients()` / `setReleaseNotesRecipients(emails)` | body is a bare string array |
| `GET/PUT /ibcloud/web/cloudStatus/recipients` | `getCloudStatusRecipients()` / `setCloudStatusRecipients(emails)` | maintenance notifications |

Update endpoints generally expect the **full settings object** — GET, modify,
POST.
