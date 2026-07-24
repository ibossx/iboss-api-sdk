# Proxy & Caching

**Console:** Network → Proxy & Caching ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.network`

Proxy settings (ports, modes, timeouts, file scan limits) and proxy logging
toggles.

| Endpoint | SDK method |
|---|---|
| `POST /json/network/proxy/settings` | `updateProxySettings(settings)` |
| `POST /json/preferences/reportSettings/changeProxyLogging` | `updateProxyLogging({ logProxyAccessDeniedErrors, logProxyAllOtherErrors, logProxyDnsConnectionFailures })` |

Notes:

- Settings objects are full-echo: read the current settings first
  (`client.raw("gateway", "GET", "/json/network/proxy/settings")`), modify,
  POST the whole object back.
- SSL/TLS decryption settings live under Network → SSL Decryption — see
  [ssl-decryption.md](ssl-decryption.md).
- ZTNA Private Access settings (routed peers, DHCP gateway/NAT) are covered
  in [private-access-policies.md](private-access-policies.md); connector
  general settings (security keys) in
  [connector-policies.md](connector-policies.md).
