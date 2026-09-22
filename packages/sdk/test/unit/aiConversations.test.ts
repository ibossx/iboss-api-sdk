import { describe, expect, it } from "vitest";
import {
  AI_CONVERSATION_TEXT_CONTAINS_MAX,
  aiConversationDetailPath,
  buildReporterConversationQuery,
  filterConversationRows,
  normalizeConversationVendor,
  normalizeTextContains,
  redactConversationText,
  redactConversationUrl,
  resolveListInterval,
  toConversationDetail,
  toConversationSummary,
  toReporterIntervalMs,
  unwrapConversationDetail,
  unwrapConversationRows,
} from "../../src/api/aiConversations.js";

describe("toReporterIntervalMs (UTC time base)", () => {
  it("accepts ISO-8601 and Date as UTC, not a guessed custom epoch", () => {
    const iso = toReporterIntervalMs("2026-09-10T04:00:00.000Z", "since");
    expect(iso).toBe(1_789_012_800_000);
    expect(toReporterIntervalMs(new Date("2026-09-10T04:00:00.000Z"), "since")).toBe(iso);
    // Observed Sep 9–10 2026 trace value — UTC unix-ms, not seconds.
    expect(new Date(iso).toISOString()).toBe("2026-09-10T04:00:00.000Z");
  });

  it("treats date-only ISO as UTC midnight and scales epoch seconds", () => {
    expect(toReporterIntervalMs("2026-09-10", "since")).toBe(Date.parse("2026-09-10T00:00:00.000Z"));
    expect(toReporterIntervalMs(1_789_012_800, "since")).toBe(1_789_012_800_000);
  });

  it("rejects an inverted since/until window", () => {
    expect(() =>
      resolveListInterval({
        since: "2026-09-11T00:00:00.000Z",
        until: "2026-09-10T00:00:00.000Z",
      }),
    ).toThrow(/since .* is after until/);
  });
});

describe("reporter query", () => {
  it("sends the documented opaque query, not agent-facing names", () => {
    const query = buildReporterConversationQuery(
      { startMs: 1_789_012_800_000, endMs: 1_789_016_400_000 },
      { reportingGroup: -1, currentRowNumber: 1, maxItemsToReturn: 50 },
    );
    expect(query).toEqual({
      reportingGroup: -1,
      intervalStartTime: 1_789_012_800_000,
      intervalEndTime: 1_789_016_400_000,
      filterByIntervalTime: true,
      sortByCriteria: "SORT_BY_LAST_MESSAGE_TIME",
      orderAscending: false,
      currentRowNumber: 1,
      maxItemsToReturn: 50,
    });
    expect(aiConversationDetailPath("abc/def")).toBe(
      "/ibreports/web/aiSecurityGovernance/conversations/abc%2Fdef",
    );
  });
});

describe("vendor slugs", () => {
  it("maps chatgpt ↔ CHAT_GPT and rejects display names", () => {
    expect(normalizeConversationVendor("chatgpt")).toBe("CHAT_GPT");
    expect(normalizeConversationVendor("CHAT_GPT")).toBe("CHAT_GPT");
    expect(normalizeConversationVendor("ChatGPT")).toBe("CHAT_GPT");
    expect(normalizeConversationVendor("perplexity")).toBe("PERPLEXITY");
    expect(() => normalizeConversationVendor("ChatGPT Enterprise")).toThrow(/display names/i);
  });
});

describe("textContains fuzzy limits", () => {
  it("is a case-insensitive substring on topic/preview, not regex, capped at 256", () => {
    expect(normalizeTextContains("  secret sauce  ")).toBe("secret sauce");
    expect(() => normalizeTextContains("x".repeat(AI_CONVERSATION_TEXT_CONTAINS_MAX + 1))).toThrow(
      /256/,
    );
    const rows = filterConversationRows(
      [
        { conversationId: "1", topic: "Payroll Bot", conversationPreview: "Q3 numbers" },
        { conversationId: "2", topic: "Weather", conversationPreview: "rain" },
      ],
      { textContains: "payroll" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversationId).toBe("1");
    const vendorOnly = filterConversationRows(
      [
        { conversationId: "1", aiVendor: "CHAT_GPT" },
        { conversationId: "2", vendor: "PERPLEXITY" },
      ],
      { vendor: "chatgpt" },
    );
    expect(vendorOnly.map((row) => row.conversationId)).toEqual(["1"]);
  });
});

describe("redaction", () => {
  it("strips accessToken and other secrets from domains and bodies", () => {
    const domain =
      "https://www.perplexity.ai/search?q=hello&accessToken=not-a-real-access-token-value";
    expect(redactConversationUrl(domain)).toContain("accessToken=[REDACTED]");
    expect(redactConversationUrl(domain)).not.toContain("not-a-real-access-token-value");
    expect(redactConversationText("Bearer not-a-real-session-token-value")).toBe("Bearer [REDACTED]");
    expect(redactConversationText("key=sk-notarealplaceholderkey12")).toContain("[REDACTED]");
  });

  it("redacts summary domain and message bodies", () => {
    const summary = toConversationSummary(
      {
        conversationId: "c1",
        topic: "hello",
        domain: "https://chatgpt.com/c/abc?accessToken=not-a-real-access-token-value",
        userRequest: "here is Bearer not-a-real-session-token-value",
        aiResponse: null,
      },
      false,
    );
    expect(summary.messages).toEqual([]);
    expect(summary.domain).toContain("[REDACTED]");
    expect(summary.domain).not.toContain("not-a-real-access-token-value");

    const detail = toConversationDetail({
      conversationId: "c1",
      messages: [
        { user: true, text: "token=not-a-real-access-token-value", messageTime: 1_789_012_800_000 },
      ],
    });
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]!.text).toContain("[REDACTED]");
    expect(detail.messages[0]!.text).not.toContain("not-a-real-access-token-value");
  });
});

describe("stable empty-list unwrap", () => {
  it("never returns a null conversations body", () => {
    expect(unwrapConversationRows(null)).toEqual([]);
    expect(unwrapConversationRows({ result: { conversations: null } })).toEqual([]);
    expect(unwrapConversationRows({ result: { conversations: undefined } })).toEqual([]);
    expect(unwrapConversationRows({ entries: [] })).toEqual([]);
    expect(unwrapConversationRows({ result: { conversations: [{ conversationId: "a" }] } })).toHaveLength(
      1,
    );
  });

  it("unwraps detail envelopes", () => {
    expect(unwrapConversationDetail({ result: { conversation: { conversationId: "z" }, messages: [] } })).toMatchObject(
      { conversationId: "z", messages: [] },
    );
    expect(unwrapConversationDetail({})).toBeUndefined();
  });
});
