---
id: api-policy-layer-settings-post-full-replace
kind: invariant
tier: public
area: api/policies
source: https://github.com/ibossx/iboss-api-sdk/blob/main/docs/api/agent-footguns.md
owner: ibossx/iboss-api-sdk maintainers
last_verified: 2026-10-10
valid_from: 2026-10-10
signatures: [/json/controls/policyLayers/settings, updateLayerSettings, merge=1]
---
`POST /json/controls/policyLayers/settings` replaces the whole settings blob. Any field left out of the body is reset to the Gateway default, so a one-field POST wipes the rest. Older nodes ignore `?merge=1`, so it isn't a safe way to send a partial update. Use `client.policies.patchResourcePolicySettings`, whose default `transport: "auto"` uses PATCH where supported and otherwise falls back to a GET, merge, and full POST.
