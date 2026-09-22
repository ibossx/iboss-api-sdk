/**
 * AI Security Governance (reporter tier).
 *
 * Purpose-named conversation list/get (DEVELOP-34930). Wraps today's
 * reporter search — agents must not hand-roll the opaque query string.
 *
 * ```ts
 * await client.governance.listAiConversations({
 *   since, until, // ISO or Date — UTC
 *   vendor,
 *   textContains,
 * });
 * await client.governance.getAiConversation(id);
 * ```
 */
import { IbossApiError, IbossError } from "../client/errors.js";
import { sleep as defaultSleep } from "../client/retry.js";
import { SubClient } from "./base.js";
import {
  AI_CONVERSATION_TYPICAL_LAG_MINUTES,
  AI_GOVERNANCE_CONVERSATIONS_PATH,
  aiConversationDetailPath,
  buildReporterConversationQuery,
  filterConversationRows,
  intervalMsToIso,
  normalizeTextContains,
  resolveGetInterval,
  resolveListInterval,
  toConversationDetail,
  toConversationSummary,
  normalizeConversationVendor,
  unwrapConversationDetail,
  unwrapConversationRows,
  type AiConversationDetail,
  type AiConversationList,
  type GetAiConversationOptions,
  type ListAiConversationsOptions,
  type WaitForAiConversationOptions,
} from "./aiConversations.js";

export class GovernanceApi extends SubClient {
  /**
   * List AI Governance conversation summaries.
   *
   * Wire: `GET /ibreports/web/aiSecurityGovernance/conversations` with
   * `intervalStartTime` / `intervalEndTime` as UTC unix milliseconds.
   * `vendor` and `textContains` are applied in the SDK (the reporter query
   * has no equivalent plain parameters).
   *
   * Eventual consistency: newly finished chats are often missing for ~15
   * minutes. `items` is always an array (never null), even when the reporter
   * returns a null `conversations` body. Domains and any leaked bodies are
   * redacted.
   */
  async listAiConversations(opts?: ListAiConversationsOptions): Promise<AiConversationList> {
    if (opts?.textContains !== undefined) normalizeTextContains(opts.textContains);
    if (opts?.vendor !== undefined) normalizeConversationVendor(opts.vendor);
    const interval = resolveListInterval(opts);
    const query = buildReporterConversationQuery(interval, opts);
    const payload = await this.request<unknown>("reporter", "GET", AI_GOVERNANCE_CONVERSATIONS_PATH, {
      query,
    });
    const filter = {
      since: intervalMsToIso(interval.startMs),
      until: intervalMsToIso(interval.endMs),
      ...(opts?.vendor ? { vendor: opts.vendor } : {}),
      ...(opts?.textContains ? { textContains: opts.textContains } : {}),
    };
    const rows = filterConversationRows(unwrapConversationRows(payload), opts);
    const items = rows
      .map((row) => toConversationSummary(row, false))
      .filter((row) => row.id);
    return { items, total: items.length, filter, interval };
  }

  /**
   * Get one conversation, including `messages[]` (bodies live here, not on
   * the list). Tokens in `domain` and message text are redacted.
   *
   * Wire: `GET /ibreports/web/aiSecurityGovernance/conversations/{id}`.
   * A 404 often means the reporter has not indexed the chat yet (~15m lag)
   * rather than a bad id — see `waitForAiConversation`.
   */
  async getAiConversation(id: string, opts?: GetAiConversationOptions): Promise<AiConversationDetail> {
    const interval = resolveGetInterval(opts);
    const query = buildReporterConversationQuery(interval, {
      reportingGroup: opts?.reportingGroup,
      currentRowNumber: 1,
      maxItemsToReturn: 1,
    });
    const payload = await this.request<unknown>("reporter", "GET", aiConversationDetailPath(id), {
      query,
    });
    const row = unwrapConversationDetail(payload);
    if (!row) {
      throw new IbossError(
        `AI conversation ${id} was not in the reporter response. ` +
          `Governance search is eventually consistent (~${AI_CONVERSATION_TYPICAL_LAG_MINUTES}m lag).`,
      );
    }
    const detail = toConversationDetail(row);
    if (!detail.id) detail.id = String(id);
    return detail;
  }

  /**
   * Poll `getAiConversation` through the typical ~15 minute reporter lag.
   * 404 and an empty detail body are treated as "not yet indexed".
   * Does not busy-loop — sleeps `intervalMs` (default 15s) between attempts.
   */
  async waitForAiConversation(
    id: string,
    opts?: WaitForAiConversationOptions,
  ): Promise<AiConversationDetail> {
    const timeoutMs = opts?.timeoutMs ?? (AI_CONVERSATION_TYPICAL_LAG_MINUTES + 1) * 60_000;
    const intervalMs = opts?.intervalMs ?? 15_000;
    const sleeper = opts?.sleep ?? defaultSleep;
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(intervalMs, 1)));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (opts?.signal?.aborted) {
        throw opts.signal.reason ?? new Error("Aborted");
      }
      try {
        return await this.getAiConversation(id, opts);
      } catch (error) {
        const retryable =
          (error instanceof IbossApiError && error.status === 404) ||
          (error instanceof IbossError && !(error instanceof IbossApiError));
        if (!retryable) throw error;
        if (attempt >= maxAttempts - 1) {
          throw new IbossError(
            `AI conversation ${id} was not available after ${timeoutMs}ms ` +
              `(${attempt + 1} attempt(s)). Reporter Governance search is eventually ` +
              `consistent (~${AI_CONVERSATION_TYPICAL_LAG_MINUTES} minutes lag).`,
          );
        }
        await sleeper(intervalMs, opts?.signal);
      }
    }
    throw new IbossError(
      `AI conversation ${id} was not available after ${timeoutMs}ms. ` +
        `Reporter Governance search is eventually consistent ` +
        `(~${AI_CONVERSATION_TYPICAL_LAG_MINUTES} minutes lag).`,
    );
  }
}

export {
  AI_CONVERSATION_DEFAULT_LOOKBACK_MS,
  AI_CONVERSATION_DEFAULT_PAGE_SIZE,
  AI_CONVERSATION_GET_LOOKBACK_MS,
  AI_CONVERSATION_TEXT_CONTAINS_MAX,
  AI_CONVERSATION_TYPICAL_LAG_MINUTES,
  AI_CONVERSATION_VENDOR_WIRE,
  AI_GOVERNANCE_CONVERSATIONS_PATH,
} from "./aiConversations.js";
export type {
  AiConversationDetail,
  AiConversationList,
  AiConversationListFilter,
  AiConversationMessage,
  AiConversationSummary,
  AiConversationTime,
  GetAiConversationOptions,
  ListAiConversationsOptions,
  ReporterConversationQuery,
  WaitForAiConversationOptions,
} from "./aiConversations.js";
