# Data Loss Prevention (DLP)

**Console:** DLP · **Tier:** gateway (`/json/...`) · **SDK:** `client.dlp`

> ⚠ **Subscription-gated.** Most DLP configuration returns **422**
> (`IbossSubscriptionError`) on accounts without a DLP subscription. Check
> `client.session.account.subscriptionFlags["ENABLE_DLP_POLICIES_DASHBOARD"]`
> first, or catch the error and treat it as an expected skip.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /json/contentAnalysisRules` | `listContentAnalysisRules()` |
| `PUT /json/contentAnalysisRule` | `createContentAnalysisRule(rule)` |
| `DELETE /json/contentAnalysisRule?id=` | `deleteContentAnalysisRule(id)` |
| `GET /json/contentAnalysisRule/dlpPolicyResponses` | `listPolicyResponses()` |
| `PUT /json/contentAnalysisRule/dlpPolicyResponse` | `createPolicyResponse(response)` — 422 without DLP |
| `GET /json/contentAnalysisRule/dlpConverters` | `listConverters()` |
| `DELETE /json/contentAnalysisRule/dlpConverter?id=` | `deleteConverter(id)` |
| `GET/POST /json/network/contentAnalysis/settings?mode=0` | `getGeneralSettings()` / `updateGeneralSettings(settings)` |

`mode=0` selects the DLP view of the content-analysis settings endpoint
(`mode=1` is the malware-defense view — use `client.raw()` for that).

**DLP policies** (the console policy rows, not content-analysis rules) are
listed with `client.policies.listPolicies({ kind: "dlp" })` or
`listDlpPolicies()`. That sends `typeFilter=9` on
`GET /json/controls/policyLayers/all` — do not pass `typeFilter: 9`
yourself. See [policies-by-kind.md](policies-by-kind.md).

## Creating a rule

```ts
const rule = await client.dlp.createContentAnalysisRule({
  name: "Detect PII",
  description: "Scans uploads/downloads for personal data",
  dlpContentRiskLevel: "high",
  dlpFileDirection: "both",
  enabled: true,
  piiEnabled: true,
  ccnEnabled: true,          // credit card numbers
  emailAddressEnabled: true,
  ssnEnabled: false,
});
```

Gotchas:

- Rule creation can take a few seconds to propagate before dependent objects
  (responses) accept references to it — retry briefly on failure.
- Policies reference DLP via `dlpPolicyMethod` in their settings;
  Resource Policies **require** `dlpPolicyMethod: 2`
  (see [resource-policies.md](resource-policies.md)).
