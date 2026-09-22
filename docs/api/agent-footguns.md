# Agent API footguns (negative paths)

Five ways agents lose data or query the wrong thing. **SDK-only** — this
repo does not change lockboxLinux / Gateway / reporter. Positive
copy-paste: [agent-quickstart.md](agent-quickstart.md).

## 1. Sparse POST without merge/PATCH still wipes

Gateway `POST /json/controls/policyLayers/settings` is a **full replace**.
Omitted `catN` / `prioN` / `bypassSslMitmN` / `categories` are defaulted
(DEVELOP-34251 / DEVELOP-32482). A one-field POST is a wipe.

POST `?merge=1` is **not** safe by default. A pre-34921 gateway ignores
`merge` and still wipe-on-omits. That is why `patchResourcePolicySettings`
default `transport: "auto"` uses native PATCH, then 404/405
get-merge-**full**-POST. `transport: "merge-post"` is opt-in only.

**Don't**

```ts
await client.policies.updateLayerSettings({
  customCategoryId,
  customCategoryNumber,
  customCategoryName: "AI Security",
  aiRiskEnabled: 1, // omitted families reset to Gateway defaults
});

await client.raw("gateway", "POST", "/json/controls/policyLayers/settings", {
  query: { customCategoryId, merge: 1 }, // ignored on pre-34921 → wipe
  body: { aiRiskEnabled: 1 },
});
```

**Do**

```ts
await client.policies.patchResourcePolicySettings(customCategoryId, {
  aiRiskEnabled: 1,
});
// transport: "auto" — do not pass "merge-post" unless you know the node
```

## 2. Allowlist/blocklist + categories must not silently drop

AI Services destinations need a **categories-type** layer (GET
`customType` 3 or 13) plus a 400-char bitmap with **bit 110** set and
`categoriesSelectedType: 0`. Allowlist recreate (`customType: 1`)
**silently drops** that bitmap — later POSTs can set `aiRiskEnabled: 1`
and still leave destinations empty (`GET categories` length 0).

The SDK **rejects** (or `onWrongType: "warn"` skips the write). Never
invent the bitmap or swallow the conflict.

**Don't**

```ts
const layer = await client.policies.createLayer({
  name: "AI Security",
  type: "allowlist", // customType 1 — bitmap will not stick
  isZeroTrustResourcePolicy: 1,
  settings: { categories: "0".repeat(110) + "1" + "0".repeat(289) },
});
// POST 200, empty saveIgnoredEntries, GET categories === ""
```

**Do**

```ts
const policy = await client.policies.createResourcePolicy({
  name: "AI Security",
  destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
});
// throws IbossPolicyTypeError if the layer is allowlist/blocklist
await client.policies.putResourcePolicyDestinations(policy.customCategoryId, {
  mode: "selectedWebCategories",
  categories: ["AI_SERVICES"],
});
```

Delete and recreate as `type: "categories"` — do not patch the bitmap
onto an allowlist.

## 3. Trusting POST 200 / empty `saveIgnoredEntries` without re-GET

Settings POST can return **200** with `saveIgnoredEntries: []` and still
drop the bitmap, `categoriesSelectedType`, `dlpPolicyMethod`, or
`aiRisk*`. Empty ignore-list is **not** persistence.

**Don't**

```ts
const res = await client.policies.updateLayerSettings(fullBlob);
if (res.successful && (res.saveIgnoredEntries ?? []).length === 0) {
  return; // fields may still be missing on GET
}
```

**Do**

```ts
const policy = await client.policies.createResourcePolicy({ name, destinations, settings });
// policy.settings is the re-GET (effective), not the POST 200 / ids

await client.policies.patchResourcePolicySettings(id, { aiRiskEnabled: 1 });
await client.policies.putResourcePolicyDestinations(id, destinations);
// both re-GET; missing fields throw IbossVerifyError
```

## 4. Magic `typeFilter=9` vs `listPolicies({ kind: "dlp" })`

`9` is DLP on `GET /json/controls/policyLayers/all`. Agents must not
guess that integer or choose between `resourcePolicies` and
`policyLayers/all`. Use a purpose-named `kind`.

**Don't**

```ts
await client.policies.listLayers({ typeFilter: 9 });
await client.raw("gateway", "GET", "/json/controls/policyLayers/all", {
  query: { typeFilter: 9, isZeroTrustLayer: -1 },
});
const maybeDlp = await client.policies.listResourcePolicies(); // wrong list
```

**Do**

```ts
const dlp = await client.policies.listPolicies({ kind: "dlp" });
const same = await client.policies.listDlpPolicies();
const ai = await client.policies.listPolicies({ kind: "aiSecurity" });
// also: "resource" | "layer" | "connector" | "privateAccess" | "all"
```

Kind → wire map: [policies-by-kind.md](policies-by-kind.md).

## 5. Opaque governance query / epoch vs `listAiConversations`

AI Governance conversations are a **reporter** search
(`/ibreports/web/aiSecurityGovernance/conversations`), not a policy-kind
list. The wire query is opaque (`intervalStartTime` / `intervalEndTime`
as UTC unix **milliseconds**, plus paging/sort flags). Newly finished
chats are often missing for ~**15 minutes** (reporter index lag, not a
bad id).

**Don't**

```ts
await client.raw("reporter", "GET", "/ibreports/web/aiSecurityGovernance/conversations", {
  query: { intervalStartTime: Date.now(), intervalEndTime: Date.now() }, // empty window; seconds vs ms
});
await client.raw("gateway", "GET", "/aiGovernance/conversations"); // wrong tier, invented path
if (!found) throw new Error("bad conversation id"); // first ~15m is lag
```

**Do**

```ts
const listed = await client.governance.listAiConversations({
  since: "2026-09-10T04:00:00.000Z", // ISO or Date; YYYY-MM-DD = UTC midnight
  until: new Date(),
  vendor: "chatgpt", // slug or CHAT_GPT — not "ChatGPT Enterprise"
  textContains: "payroll",
});
await client.governance.waitForAiConversation(listed.items[0].id);
```

Do not hand-roll epochs. `vendor` / `textContains` are SDK-side filters.
Domains and bodies come back redacted (`[REDACTED]`).
