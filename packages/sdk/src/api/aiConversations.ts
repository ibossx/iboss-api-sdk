/**
 * AI Security Governance conversation helpers (DEVELOP-34930 / 34915 leftover).
 *
 * Purpose-named list/get over today's reporter wire:
 *   GET /ibreports/web/aiSecurityGovernance/conversations
 *   GET /ibreports/web/aiSecurityGovernance/conversations/{id}
 *
 * Agents pass ISO/Date + vendor + textContains. This module translates
 * those into the opaque reporter query and redacts tokens from summaries.
 * The raw reporter path and query names are unchanged — callers that already
 * use client.raw("reporter", …) keep working.
 */

/** Observed reporter list/detail path (do not invent a sibling HTTP route). */
export const AI_GOVERNANCE_CONVERSATIONS_PATH =
  "/ibreports/web/aiSecurityGovernance/conversations";

/** Typical reporter index lag after a chat completes. */
export const AI_CONVERSATION_TYPICAL_LAG_MINUTES = 15;

/** Case-insensitive substring match cap for `textContains`. */
export const AI_CONVERSATION_TEXT_CONTAINS_MAX = 256;

/** Default list window when `since` is omitted (UTC). */
export const AI_CONVERSATION_DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Default get-by-id window — wider so an older conversation is still found. */
export const AI_CONVERSATION_GET_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const AI_CONVERSATION_DEFAULT_PAGE_SIZE = 50;

/**
 * Friendly vendor slugs agents should use. Wire list/detail uses a different
 * system (`CHAT_GPT`, `PERPLEXITY`) than Resource Policy settings (`chatgpt`).
 */
export const AI_CONVERSATION_VENDOR_WIRE: Record<string, string> = {
  chatgpt: "CHAT_GPT",
  chat_gpt: "CHAT_GPT",
  "chat-gpt": "CHAT_GPT",
  perplexity: "PERPLEXITY",
  gemini: "GEMINI",
  claude: "CLAUDE",
  copilot: "COPILOT",
};

const KNOWN_VENDOR_SLUGS = ["chatgpt", "perplexity", "gemini", "claude", "copilot"] as const;

export type AiConversationVendorSlug = (typeof KNOWN_VENDOR_SLUGS)[number];

export type AiConversationTime = string | Date | number;

export interface ListAiConversationsOptions {
  /** Inclusive start. ISO-8601 or Date. Time base is UTC. */
  since?: AiConversationTime;
  /** Inclusive end. ISO-8601 or Date. Time base is UTC. */
  until?: AiConversationTime;
  /** Friendly slug (`chatgpt`) or wire value (`CHAT_GPT`). */
  vendor?: string;
  /**
   * Case-insensitive substring on `topic` / `conversationPreview` only
   * (not `domain` — tokens live there). Max 256 characters. Not regex.
   */
  textContains?: string;
  /** Reporter reporting-group filter. Wire default is `-1` (all). */
  reportingGroup?: number;
  /** 1-indexed, matching the reporter query. */
  currentRowNumber?: number;
  maxItemsToReturn?: number;
}

export interface GetAiConversationOptions {
  since?: AiConversationTime;
  until?: AiConversationTime;
  reportingGroup?: number;
}

export interface WaitForAiConversationOptions extends GetAiConversationOptions {
  /** Default 16 minutes (covers the typical ~15m reporter lag). */
  timeoutMs?: number;
  /** Sleep between polls. Default 15s — do not busy-loop. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** Test hook. Production uses the module sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface AiConversationMessage {
  role?: "user" | "assistant";
  text?: string;
  blocked?: boolean;
  messageTime?: string;
  contentAnalysisRule?: unknown;
  blockDescription?: string;
  [key: string]: unknown;
}

export interface AiConversationSummary {
  id: string;
  topic?: string;
  preview?: string;
  vendor?: string;
  /** Redacted — query tokens such as `accessToken` are stripped. */
  domain?: string;
  messageCount?: number;
  blocked?: boolean;
  lastMessageAt?: string;
  /**
   * Always an array. List rows do not carry bodies (`userRequest` /
   * `aiResponse` are often null on the wire) — use get for messages.
   */
  messages: AiConversationMessage[];
  raw?: Record<string, unknown>;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiConversationMessage[];
}

export interface AiConversationListFilter {
  since: string;
  until: string;
  vendor?: string;
  textContains?: string;
}

export interface AiConversationList {
  /** Never null. Empty search → `[]`. */
  items: AiConversationSummary[];
  total: number;
  filter: AiConversationListFilter;
  /** UTC unix-ms sent as `intervalStartTime` / `intervalEndTime`. */
  interval: { startMs: number; endMs: number };
}

export interface ReporterConversationQuery {
  reportingGroup: number;
  intervalStartTime: number;
  intervalEndTime: number;
  filterByIntervalTime: true;
  sortByCriteria: "SORT_BY_LAST_MESSAGE_TIME";
  orderAscending: false;
  currentRowNumber: number;
  maxItemsToReturn: number;
}

const REDACTED = "[REDACTED]";
const QUERY_SECRET =
  /^(access[_-]?token|token|api[_-]?key|key|password|secret|credential|session|auth|authorization|jwt)$/i;
const QUERY_PAIR =
  /([?&](?:access[_-]?token|token|api[_-]?key|key|password|secret|credential|session|auth|authorization|jwt)=)[^&\s#]+/gi;
const BARE_SECRET_PAIR =
  /\b((?:access[_-]?token|token|api[_-]?key|password|secret|credential|authorization)=)[^\s&#]+/gi;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SK_LIKE = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._\-+=/]{8,}/gi;

/**
 * Convert agent `since`/`until` to the reporter interval time.
 *
 * Time base is **UTC**. Observed Sep 9–10 2026 traces used 13-digit values
 * around `1789012800000` (2026-09-10T04:00:00.000Z). Those are UTC unix
 * milliseconds — not seconds, and not a local wall clock. Do not pass
 * `Date.now()` as a raw query param; use ISO/Date here.
 *
 * - `Date` → `getTime()` (UTC instant)
 * - ISO-8601 string → parsed as written (`Z` / offset honored; date-only
 *   `YYYY-MM-DD` is UTC midnight)
 * - number already in unix-ms (≥ 1e12) is passed through; seconds are
 *   multiplied by 1000
 */
export function toReporterIntervalMs(value: AiConversationTime, label: string): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new Error(`Invalid ${label}: invalid Date`);
    return ms;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: ${value}`);
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Invalid ${label}: empty string`);
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return toReporterIntervalMs(Number(trimmed), label);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: "${value}" is not ISO-8601 or Date`);
  }
  return parsed.getTime();
}

export function intervalMsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function resolveListInterval(opts?: ListAiConversationsOptions): { startMs: number; endMs: number } {
  const endMs = opts?.until !== undefined ? toReporterIntervalMs(opts.until, "until") : Date.now();
  const startMs =
    opts?.since !== undefined
      ? toReporterIntervalMs(opts.since, "since")
      : endMs - AI_CONVERSATION_DEFAULT_LOOKBACK_MS;
  if (startMs > endMs) {
    throw new Error(`since (${intervalMsToIso(startMs)}) is after until (${intervalMsToIso(endMs)})`);
  }
  return { startMs, endMs };
}

export function resolveGetInterval(opts?: GetAiConversationOptions): { startMs: number; endMs: number } {
  const endMs = opts?.until !== undefined ? toReporterIntervalMs(opts.until, "until") : Date.now();
  const startMs =
    opts?.since !== undefined ? toReporterIntervalMs(opts.since, "since") : endMs - AI_CONVERSATION_GET_LOOKBACK_MS;
  if (startMs > endMs) {
    throw new Error(`since (${intervalMsToIso(startMs)}) is after until (${intervalMsToIso(endMs)})`);
  }
  return { startMs, endMs };
}

/** Build the opaque reporter query (legacy helpers, if any, stay on this shape). */
export function buildReporterConversationQuery(
  interval: { startMs: number; endMs: number },
  opts?: { reportingGroup?: number; currentRowNumber?: number; maxItemsToReturn?: number },
): ReporterConversationQuery {
  return {
    reportingGroup: opts?.reportingGroup ?? -1,
    intervalStartTime: interval.startMs,
    intervalEndTime: interval.endMs,
    filterByIntervalTime: true,
    sortByCriteria: "SORT_BY_LAST_MESSAGE_TIME",
    orderAscending: false,
    currentRowNumber: opts?.currentRowNumber ?? 1,
    maxItemsToReturn: opts?.maxItemsToReturn ?? AI_CONVERSATION_DEFAULT_PAGE_SIZE,
  };
}

export function aiConversationDetailPath(id: string): string {
  if (!id || !String(id).trim()) throw new Error("conversation id is required");
  return `${AI_GOVERNANCE_CONVERSATIONS_PATH}/${encodeURIComponent(String(id).trim())}`;
}

/**
 * Map a friendly slug or wire token onto the reporter `vendor` / `aiVendor`
 * values (`CHAT_GPT`, `PERPLEXITY`, …). Display names (`ChatGPT`) are rejected.
 */
export function normalizeConversationVendor(vendor: string): string {
  const trimmed = vendor.trim();
  if (!trimmed) throw new Error("vendor must be a non-empty string");
  const compact = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (compact === "chatgpt" || compact === "chat_gpt") return "CHAT_GPT";
  const mapped = AI_CONVERSATION_VENDOR_WIRE[compact];
  if (mapped) return mapped;
  const asWire = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (asWire === "CHAT_GPT" || Object.values(AI_CONVERSATION_VENDOR_WIRE).includes(asWire)) {
    return asWire;
  }
  throw new Error(
    `Unknown AI conversation vendor "${vendor}". Use one of: ${KNOWN_VENDOR_SLUGS.join(", ")} ` +
      `(wire values CHAT_GPT, PERPLEXITY, GEMINI, CLAUDE, COPILOT are also accepted). ` +
      `Do not send display names such as "ChatGPT Enterprise".`,
  );
}

export function vendorMatches(row: Record<string, unknown>, wanted: string): boolean {
  const wire = normalizeConversationVendor(wanted);
  const candidates = [row.vendor, row.aiVendor, row.aiVendorDisplayName];
  return candidates.some((value) => {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      return normalizeConversationVendor(value) === wire;
    } catch {
      return value.trim().toUpperCase().replace(/[\s-]+/g, "_") === wire;
    }
  });
}

export function normalizeTextContains(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("textContains must be a non-empty string when provided");
  if (trimmed.length > AI_CONVERSATION_TEXT_CONTAINS_MAX) {
    throw new Error(
      `textContains is limited to ${AI_CONVERSATION_TEXT_CONTAINS_MAX} characters ` +
        `(fuzzy/substring match, not regex). Got ${trimmed.length}.`,
    );
  }
  return trimmed;
}

export function textMatches(row: Record<string, unknown>, needle: string): boolean {
  const target = needle.toLowerCase();
  const fields = [row.topic, row.conversationPreview, row.preview, row.title];
  return fields.some((value) => typeof value === "string" && value.toLowerCase().includes(target));
}

/** Redact tokens/secrets from a URL or URL-like domain string. */
export function redactConversationUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (QUERY_SECRET.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return value.replace(QUERY_PAIR, `$1${REDACTED}`);
  }
}

/** Redact tokens/secrets from conversation bodies and domains. */
export function redactConversationText(value: string): string {
  return redactConversationUrl(value)
    .replace(BARE_SECRET_PAIR, `$1${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SK_LIKE, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`);
}

export function redactMaybeString(value: unknown): unknown {
  return typeof value === "string" ? redactConversationText(value) : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Pull a conversation array out of any of the envelopes the reporter has used. */
export function unwrapConversationRows(payload: unknown): Record<string, unknown>[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => !!asRecord(row));
  }
  const root = asRecord(payload);
  if (!root) return [];
  const result = asRecord(root.result) ?? root;
  const raw =
    result.conversations ?? result.entries ?? result.items ?? root.conversations ?? root.entries ?? root.items;
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is Record<string, unknown> => !!asRecord(row));
}

export function unwrapConversationDetail(payload: unknown): Record<string, unknown> | undefined {
  if (payload == null) return undefined;
  const root = asRecord(payload);
  if (!root) return undefined;
  const result = asRecord(root.result);
  const nested = result ? (asRecord(result.conversation) ?? result) : undefined;
  const top = asRecord(root.conversation) ?? root;
  const row = nested && (nested.conversationId != null || nested.id != null || Array.isArray(nested.messages))
    ? nested
    : top;
  if (row.conversationId == null && row.id == null && !Array.isArray(row.messages)) {
    return undefined;
  }
  if (result && Array.isArray(result.messages) && !Array.isArray(row.messages)) {
    return { ...row, messages: result.messages };
  }
  if (Array.isArray(root.messages) && !Array.isArray(row.messages)) {
    return { ...row, messages: root.messages };
  }
  return row;
}

function pickVendor(row: Record<string, unknown>): string | undefined {
  for (const key of ["aiVendor", "vendor", "aiVendorDisplayName"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      try {
        return normalizeConversationVendor(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

function pickId(row: Record<string, unknown>): string | undefined {
  const value = row.conversationId ?? row.id;
  if (value == null) return undefined;
  return String(value);
}

function pickTime(row: Record<string, unknown>): string | undefined {
  for (const key of ["lastMessageTime", "messageTime", "intervalEndTime", "timestamp"] as const) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return intervalMsToIso(ms);
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && value.trim() !== "") {
        const ms = numeric < 1e12 ? numeric * 1000 : numeric;
        return intervalMsToIso(ms);
      }
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return undefined;
}

function summarizeMessage(raw: unknown): AiConversationMessage {
  const row = asRecord(raw) ?? {};
  const textSource =
    (typeof row.text === "string" && row.text) ||
    (typeof row.userRequest === "string" && row.userRequest) ||
    (typeof row.aiResponse === "string" && row.aiResponse) ||
    undefined;
  const role: AiConversationMessage["role"] =
    row.role === "user" || row.user === true || typeof row.userRequest === "string"
      ? "user"
      : row.role === "assistant" || typeof row.aiResponse === "string"
        ? "assistant"
        : undefined;
  const messageTime =
    typeof row.messageTime === "number"
      ? intervalMsToIso(row.messageTime < 1e12 ? row.messageTime * 1000 : row.messageTime)
      : typeof row.messageTime === "string"
        ? row.messageTime
        : undefined;
  return {
    role,
    text: textSource !== undefined ? redactConversationText(textSource) : undefined,
    blocked: row.blocked === true || row.blocked === 1 || row.blocked === "1",
    messageTime,
    contentAnalysisRule: row.contentAnalysisRule,
    blockDescription: typeof row.blockDescription === "string" ? row.blockDescription : undefined,
  };
}

export function toConversationSummary(row: Record<string, unknown>, includeMessages: boolean): AiConversationSummary {
  const id = pickId(row) ?? "";
  const domainRaw = typeof row.domain === "string" ? row.domain : undefined;
  const previewRaw =
    (typeof row.conversationPreview === "string" && row.conversationPreview) ||
    (typeof row.preview === "string" && row.preview) ||
    undefined;
  const topicRaw = (typeof row.topic === "string" && row.topic) || (typeof row.title === "string" && row.title) || undefined;

  let messages: AiConversationMessage[] = [];
  if (includeMessages) {
    const rawMessages = Array.isArray(row.messages) ? row.messages : [];
    messages = rawMessages.map(summarizeMessage);
    // Detail sometimes only has userRequest / aiResponse on the row itself.
    if (messages.length === 0) {
      if (typeof row.userRequest === "string" && row.userRequest) {
        messages.push({ role: "user", text: redactConversationText(row.userRequest) });
      }
      if (typeof row.aiResponse === "string" && row.aiResponse) {
        messages.push({ role: "assistant", text: redactConversationText(row.aiResponse) });
      }
    }
  }

  return {
    id,
    topic: topicRaw !== undefined ? redactConversationText(topicRaw) : undefined,
    preview: previewRaw !== undefined ? redactConversationText(previewRaw) : undefined,
    vendor: pickVendor(row),
    domain: domainRaw !== undefined ? redactConversationUrl(domainRaw) : undefined,
    messageCount: typeof row.messageCount === "number" ? row.messageCount : messages.length || undefined,
    blocked: row.blocked === true || row.blocked === 1 || row.blocked === "1",
    lastMessageAt: pickTime(row),
    messages,
  };
}

export function toConversationDetail(row: Record<string, unknown>): AiConversationDetail {
  return toConversationSummary(row, true);
}

export function filterConversationRows(
  rows: Record<string, unknown>[],
  opts?: { vendor?: string; textContains?: string },
): Record<string, unknown>[] {
  let out = rows;
  if (opts?.vendor) {
    const vendor = opts.vendor;
    out = out.filter((row) => vendorMatches(row, vendor));
  }
  if (opts?.textContains) {
    const needle = normalizeTextContains(opts.textContains);
    out = out.filter((row) => textMatches(row, needle));
  }
  return out;
}

export function emptyConversationList(filter: AiConversationListFilter, interval: { startMs: number; endMs: number }): AiConversationList {
  return { items: [], total: 0, filter, interval };
}
