# AI Security Governance conversations

**Console:** AI Security Dashboard → Conversations ·
**Tier:** reporter (`/ibreports/web/...`) · **SDK:** `client.governance`

> The reporter node is discovered at `connect()`. Accounts without a reporting
> cluster raise `IbossHostUnavailableError`. Sending these paths to the
> gateway or cloud host fails with the **same** API key — wrong tier, not a
> bad credential.

These methods list and get conversations. Policy-kind lists
(`listPolicies({ kind })`, `listDlpPolicies`, `listAiSecurityPolicies`)
are a separate API.

## Agent API

```ts
await client.governance.listAiConversations({
  since, until, // ISO-8601 or Date — time base is UTC
  vendor,       // "chatgpt" | "perplexity" | … or wire CHAT_GPT / PERPLEXITY
  textContains, // case-insensitive substring, max 256 chars
});
await client.governance.getAiConversation(id);
// optional: poll through reporter lag
await client.governance.waitForAiConversation(id, { timeoutMs, intervalMs });
```

`list` returns `{ items, total, filter, interval }`. **`items` is always an
array** — never `null`, even when the reporter sends a null `conversations`
body. List rows are summaries: `messages` is `[]` because wire
`userRequest` / `aiResponse` are often null. Use `get` for `messages[]`.

## Wire path

The SDK methods wrap the existing reporter search:

```
GET {reporter}/ibreports/web/aiSecurityGovernance/conversations
  ?reportingGroup=-1
  &intervalStartTime=<utc-unix-ms>
  &intervalEndTime=<utc-unix-ms>
  &filterByIntervalTime=true
  &sortByCriteria=SORT_BY_LAST_MESSAGE_TIME
  &orderAscending=false
  &currentRowNumber=1
  &maxItemsToReturn=50

GET {reporter}/ibreports/web/aiSecurityGovernance/conversations/{id}
  ?reportingGroup=-1&intervalStartTime=&intervalEndTime=&filterByIntervalTime=true
```

Envelope (list): `{ result: { conversations: [...], intervalStartTime, intervalEndTime } }`.

`client.raw("reporter", "GET", path, { query })` still accepts that opaque
query. Do not add new raw helpers; the purpose-named methods are the agent
surface.

## Time base (UTC)

`since` / `until` are **UTC**. Pass ISO-8601 (`2026-09-10T04:00:00.000Z`) or
a `Date`. Date-only `YYYY-MM-DD` is UTC midnight. The SDK sends UTC unix
milliseconds as `intervalStartTime` / `intervalEndTime`.

Example: `1789012800000` is `2026-09-10T04:00:00.000Z`. Those values are
UTC milliseconds — not seconds, and not a local wall clock. Do not pass
`Date.now()` as the query param; use `since` / `until`. Default list
window is the last 24 hours UTC; get-by-id defaults to the last 30 days
so an older conversation is still found.

## Eventual consistency (~15 minute lag)

Newly finished chats are often missing from list/get for about **15
minutes**. That is reporter index lag, not a bad id. `waitForAiConversation`
polls `get` on 404 / empty detail and sleeps between attempts (default 15s;
do not busy-loop). Default timeout is 16 minutes.

## Fuzzy match limits

`textContains` is a **case-insensitive substring** on `topic` /
`conversationPreview` only (not `domain` — tokens live there). It is **not**
regex, not Levenshtein, and not a reporter query parameter (applied in the
SDK after the wire list). Maximum length is **256** characters.

`vendor` is exact after slug normalization (`chatgpt` ↔ `CHAT_GPT`,
`perplexity` ↔ `PERPLEXITY`). Prefer `aiVendor` / `vendor` on the row; do
not parse `domain`. Display names such as `ChatGPT Enterprise` are rejected.

## Redaction

`domain` on the wire may embed vendor query strings including `accessToken`.
The SDK redacts tokens and secrets from **domains and bodies** in every
summary it returns:

- URL query names `accessToken`, `token`, `apiKey`, `password`, `secret`, …
- `Bearer …`, `sk-`/`rk-`/`pk-` style keys, JWT-shaped strings
- `token=` / `accessToken=` pairs inside message text

The placeholder is `[REDACTED]`. Debug logs use the same request-layer
redaction as the rest of the SDK.

## Routing

| Do | Don't |
|---|---|
| `client.governance.listAiConversations` / `getAiConversation` | Hand-roll `intervalStartTime` epochs |
| Reporter host (`/ibreports/web/…`) | Gateway `/json/…` or cloud `/ibcloud/web/…` |
| `client.raw("reporter", …)` for the existing query | Invent `GET /aiConversations` |
