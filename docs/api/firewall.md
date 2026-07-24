# Firewall

**Console:** Secure Access Policies → Firewall ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.firewall`

Firewall rules and firewall settings.

| Endpoint | SDK method |
|---|---|
| `GET /json/controls/firewallRules/all[?currentPolicyBeingEdited=]` | `listRules({ policyGroup? })` |
| `PUT /json/controls/firewallRules` | `saveRule(rule)` |
| `DELETE /json/controls/firewallRules?id=` | `deleteRule(id)` |
| `POST /json/controls/firewallRules/enable` | `setEnabled(bool)` |

Firewall port policies also appear as Block List entries in the
[Policy Layers](policy-layers.md) list (e.g. a "Firewall Ports" layer) —
list them with `client.policies.listLayers({ isZeroTrustLayer: 0 })`.
