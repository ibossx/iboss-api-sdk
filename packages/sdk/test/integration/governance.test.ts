import { describe, expect, it } from "vitest";
import { IbossApiError } from "../../src/client/errors.js";
import { IbossClient } from "../../src/client/IbossClient.js";
import { CLOUD_HOST, MOCK_API_KEY, REPORTER_HOST } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

const SINCE = "2026-09-09T00:00:00.000Z";
const UNTIL = "2026-09-11T00:00:00.000Z";

function sampleConversation(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv-1",
    topic: "Q3 forecast",
    conversationPreview: "help me with payroll numbers",
    aiVendor: "CHAT_GPT",
    domain: "https://chatgpt.com/c/abc?accessToken=not-a-real-access-token-value",
    userRequest: null,
    aiResponse: null,
    messageCount: 2,
    blocked: 0,
    lastMessageTime: 1_789_012_800_000,
    messages: [
      { user: true, text: "help me with payroll numbers" },
      { user: false, text: "here is Bearer not-a-real-session-token-value" },
    ],
    ...overrides,
  };
}

describe("client.governance conversations (reporter)", () => {
  it("lists with plain since/until/vendor/textContains and a stable empty shape", async () => {
    const state = createMockState();
    state.aiConversations.push(
      sampleConversation(),
      sampleConversation({
        conversationId: "conv-2",
        topic: "Weather",
        conversationPreview: "rain",
        aiVendor: "PERPLEXITY",
        domain: "https://www.perplexity.ai/search?q=rain",
      }),
    );
    const client = makeClient(state);

    const listed = await client.governance.listAiConversations({
      since: SINCE,
      until: UNTIL,
      vendor: "chatgpt",
      textContains: "payroll",
    });

    expect(listed.items).toHaveLength(1);
    expect(listed.total).toBe(1);
    expect(listed.items).not.toBeNull();
    expect(listed.items[0]!.id).toBe("conv-1");
    expect(listed.items[0]!.vendor).toBe("CHAT_GPT");
    expect(listed.items[0]!.messages).toEqual([]);
    expect(listed.items[0]!.domain).toContain("[REDACTED]");
    expect(listed.items[0]!.domain).not.toContain("not-a-real-access-token-value");
    expect(listed.filter.since).toBe(SINCE);
    expect(listed.interval.startMs).toBe(Date.parse(SINCE));
    expect(state.lastAiConversationQuery?.since).toBeUndefined();
    expect(state.lastAiConversationQuery?.until).toBeUndefined();
    expect(state.lastAiConversationQuery?.intervalStartTime).toBe(String(Date.parse(SINCE)));
    expect(state.lastAiConversationQuery?.intervalEndTime).toBe(String(Date.parse(UNTIL)));
    expect(state.lastAiConversationQuery?.filterByIntervalTime).toBe("true");

    const listCall = state.requests.find((r) =>
      r.includes("/ibreports/web/aiSecurityGovernance/conversations"),
    );
    expect(listCall).toBe(`GET ${REPORTER_HOST}/ibreports/web/aiSecurityGovernance/conversations`);

    state.aiConversationListNull = true;
    const empty = await client.governance.listAiConversations({ since: SINCE, until: UNTIL });
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
    expect(Array.isArray(empty.items)).toBe(true);
  });

  it("gets by id with redacted bodies and never-null messages", async () => {
    const state = createMockState();
    state.aiConversations.push(sampleConversation());
    const client = makeClient(state);

    const detail = await client.governance.getAiConversation("conv-1", { since: SINCE, until: UNTIL });
    expect(detail.id).toBe("conv-1");
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]!.text).toContain("[REDACTED]");
    expect(detail.messages[1]!.text).not.toContain("not-a-real-session-token-value");
    expect(detail.domain).toContain("[REDACTED]");

    await expect(client.governance.getAiConversation("missing")).rejects.toBeInstanceOf(IbossApiError);
  });

  it("does not change reporting helpers or the raw reporter path", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const reports = await client.reporting.listReports();
    expect(reports[0]!.reportId).toBe(9);

    const raw = await client.raw(
      "reporter",
      "GET",
      "/ibreports/web/aiSecurityGovernance/conversations",
      {
        query: {
          reportingGroup: -1,
          intervalStartTime: Date.parse(SINCE),
          intervalEndTime: Date.parse(UNTIL),
          filterByIntervalTime: true,
          sortByCriteria: "SORT_BY_LAST_MESSAGE_TIME",
          orderAscending: false,
          currentRowNumber: 1,
          maxItemsToReturn: 50,
        },
      },
    );
    expect(raw).toMatchObject({ result: { conversations: [] } });
  });

  it("waitForAiConversation polls through 404 lag without busy-looping", async () => {
    const state = createMockState();
    state.aiConversations.push(sampleConversation());
    state.aiConversationVisibleAfterGets = 2;
    const client = makeClient(state);
    const sleeps: number[] = [];

    const detail = await client.governance.waitForAiConversation("conv-1", {
      since: SINCE,
      until: UNTIL,
      timeoutMs: 5_000,
      intervalMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(detail.id).toBe("conv-1");
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps.every((ms) => ms === 25)).toBe(true);
  });

  it("waitForAiConversation times out with a lag message", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await expect(
      client.governance.waitForAiConversation("never", {
        timeoutMs: 30,
        intervalMs: 10,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/15 minutes lag/i);
  });

  it("rewrites Date and unix-ms since/until onto interval params", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const sinceMs = Date.parse("2026-09-10T04:00:00.000Z");
    const until = new Date("2026-09-11T04:00:00.000Z");
    await client.governance.listAiConversations({ since: sinceMs, until });
    expect(state.lastAiConversationQuery?.since).toBeUndefined();
    expect(state.lastAiConversationQuery?.until).toBeUndefined();
    expect(state.lastAiConversationQuery?.intervalStartTime).toBe(String(sinceMs));
    expect(state.lastAiConversationQuery?.intervalEndTime).toBe(String(until.getTime()));
    expect(state.lastAiConversationQuery?.filterByIntervalTime).toBe("true");
  });

  it("passes intervalStartTime/intervalEndTime through and rejects raw since on the wire", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await client.governance.listAiConversations({
      intervalStartTime: 1_789_012_800_000,
      intervalEndTime: 1_789_099_200_000,
      filterByIntervalTime: true,
    });
    expect(state.lastAiConversationQuery?.intervalStartTime).toBe("1789012800000");
    expect(state.lastAiConversationQuery?.intervalEndTime).toBe("1789099200000");
    expect(state.lastAiConversationQuery?.since).toBeUndefined();

    await expect(
      client.raw("reporter", "GET", "/ibreports/web/aiSecurityGovernance/conversations", {
        query: { since: "2026-09-10T04:00:00.000Z", until: 1_789_012_800_000 },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects unknown vendors before calling the reporter", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await expect(
      client.governance.listAiConversations({ vendor: "ChatGPT Enterprise", since: SINCE, until: UNTIL }),
    ).rejects.toThrow(/display names/i);
    expect(state.requests.some((r) => r.includes("aiSecurityGovernance"))).toBe(false);
  });
});

describe("legacy reporting surface", () => {
  it("ReportingApi still has no conversation methods", () => {
    const client = makeClient();
    expect("listAiConversations" in client.reporting).toBe(false);
    expect("getAiConversation" in client.reporting).toBe(false);
  });
});
