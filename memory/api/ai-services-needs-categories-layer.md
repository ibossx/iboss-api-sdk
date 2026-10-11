---
id: api-ai-services-needs-categories-layer
kind: invariant
tier: public
area: api/policies
source: https://github.com/ibossx/iboss-api-sdk/blob/main/docs/api/agent-footguns.md
owner: ibossx/iboss-api-sdk maintainers
last_verified: 2026-10-10
valid_from: 2026-10-10
signatures: [AI_SERVICES, customType, IbossPolicyTypeError]
---
AI Services destinations only stick on a categories-type policy layer (`customType` 3 or 13). An allowlist or blocklist layer (`customType` 1) silently drops the category bitmap, so the POST succeeds and `GET categories` comes back empty. The SDK raises `IbossPolicyTypeError` instead of writing. Recreate the layer with `client.policies.createResourcePolicy` and `destinations.mode: "selectedWebCategories"` rather than patching the bitmap onto an allowlist.
