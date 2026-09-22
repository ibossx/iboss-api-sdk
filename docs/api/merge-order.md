# Agent API evening stack — merge / review order

Recommended merge and review order for the DEVELOP-34912 Agent API
evening stack. **Docs-only in this repo** — do not treat this page as
permission to deploy lockboxLinux / Gateway / reporter.

Copy-paste surfaces: [agent-quickstart.md](agent-quickstart.md).
Negative paths: [agent-footguns.md](agent-footguns.md).

## Gateway (lockboxLinux)

Land **DEVELOP-34921** first, then **DEVELOP-34923**. 34923 generalizes
the 34921 merge-patch pattern; it is not a substitute for it.

| Order | Ticket | lockboxLinux PR | What it is |
|---|---|---|---|
| 1 | [DEVELOP-34921](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34921) | [#6340](https://ibossrepo.com/iboss/lockboxLinux/pull/6340) | Native HTTP `PATCH` + POST `?merge=1` on `policyLayers/settings` (omit-safe settings) |
| 2 | [DEVELOP-34923](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34923) | [#6344](https://ibossrepo.com/iboss/lockboxLinux/pull/6344) | Shared Gateway Merge Patch plumbing beyond that one endpoint |

Keep existing full POST replace/default semantics. SDK `transport: "auto"`
already falls back to get-merge-full-POST on 404/405 so pre-34921 nodes
stay usable; native PATCH still needs 34921 on the node for a true
sparse write.

## SDK (this repo)

Prefer [PR #8](https://github.com/ibossx/iboss-api-sdk/pull/8)
(`cursor/agent-api-reconcile-34912`) as the **integration branch**.

Per-ticket drafts **#2–#7 stay review surfaces**. Do not close or merge
them until recon lands (or is abandoned). After #8 merges, close those
branches as stacked-into-main — not before.

Docs stack onto reconcile in this order (sibling drafts; unique commit
each):

| Order | PR | What it is |
|---|---|---|
| 1 | [#9](https://github.com/ibossx/iboss-api-sdk/pull/9) | [agent-quickstart.md](agent-quickstart.md) — purpose-named copy-paste |
| 2 | [#10](https://github.com/ibossx/iboss-api-sdk/pull/10) | [agent-footguns.md](agent-footguns.md) — negative paths |

This page is the next sibling on that docs stack. Do not close #8–#10
when it lands.

## Clash winners (recon #8)

When source drafts overlapped, #8 kept these winners. Review comments
still belong on the per-ticket PR.

| Surface | Winner | Ticket | What won |
|---|---|---|---|
| Client defaults | **#2** | 34913 / 34914 | `fromEnv()` / `fromProfile()`, 3-arg `raw()`, host overrides |
| Settings patch | **#3** | 34924 | `transport: "auto"` = native PATCH → 404/405 get-merge-full-POST. POST `?merge=1` is `transport: "merge-post"` opt-in only |
| Destinations | **#4** | 34925 | One `destinations.ts`. `AI_SERVICES` → bit 110. Allowlist+categories reject/warn — never silent drop |
| Create | **#5** | 34926 | `createResourcePolicy` returns verified re-GET `{ customCategoryId, customCategoryNumber, destinations, settings }` |
| `listPolicies` | **#6** | 34927 | `listPolicies({ kind })` (+ `listDlpPolicies` / `listAiSecurityPolicies`) |
| Governance | **#7** | 34930 | `client.governance.list/getAiConversations` (reporter; UTC; ~15m lag; redaction) |

Existing main APIs (`createLayer`, `updateLayerSettings`, `listLayers`,
`listResourcePolicies`, 4-arg `raw`) stay unchanged.

## Live QA hold

**Live QA is blocked** while **test-gateway-14800** is held for
[DEVELOP-34920](https://ibosscybersecurity.atlassian.net/browse/DEVELOP-34920)
(large policy layers load slowly / may timeout).

Do not deploy this evening stack (Gateway 34921/34923 or SDK recon) onto
that node until the hold lifts. Unit tests (167) and typecheck are the
local gate; they do not replace Gateway/reporter smoke on a free lab
node.
