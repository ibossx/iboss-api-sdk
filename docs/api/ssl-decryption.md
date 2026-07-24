# SSL / HTTPS Decryption

**Console:** Network → SSL Decryption ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.ssl`

Controls HTTPS inspection: global/per-group decryption settings, domain-level
bypasses, and per-application selective decryption.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `POST /json/network/sslDecryption/settings[?currentPolicyBeingEdited=]` | `updateSettings(settings, { policyGroup? })` |
| `GET/POST /json/network/sslDecryption/advanced` | `getAdvancedSettings()` / `updateAdvancedSettings(settings)` |
| `POST /json/network/sslDecryption/domains` | `updateDomainBypass(settings)` — domain MITM bypass list |
| `GET /json/network/sslDecryption/applications` | `getApplications()` — selective decryption by app |
| `DELETE /json/network/sslDecryption/applications?sslApplicationToRemove=` | `removeApplication(name)` |

Notes:

- Settings objects are large — GET (via `getAdvancedSettings()` /
  `client.raw("gateway", "GET", "/json/network/sslDecryption/settings")`),
  modify, POST back whole.
- Per-policy-group decryption toggles also appear in policy layer settings as
  the `bypassSslMitm0..110` field family
  (see [policy-layers.md](policy-layers.md)).
- Decryption behavior interacts with default policy groups' `bypassSslMitm`
  flag ([default-policy-groups.md](default-policy-groups.md)).
