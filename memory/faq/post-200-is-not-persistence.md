---
id: faq-post-200-is-not-persistence
kind: invariant
tier: public
area: faq/policies
source: https://github.com/ibossx/iboss-api-sdk/blob/main/docs/api/agent-footguns.md
owner: ibossx/iboss-api-sdk maintainers
last_verified: 2026-10-10
valid_from: 2026-10-10
signatures: [saveIgnoredEntries, IbossVerifyError]
---
A policy settings POST can return 200 with an empty `saveIgnoredEntries` list and still have dropped fields such as the category bitmap, `categoriesSelectedType`, `dlpPolicyMethod`, or `aiRisk*`. An empty ignore list doesn't prove the write persisted. The SDK's create, patch, and destination helpers re-read the policy afterwards and throw `IbossVerifyError` when a field is missing, so their return value is the effective state.
