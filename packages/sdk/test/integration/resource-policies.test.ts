import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossPolicyTypeError, IbossVerifyError } from "../../src/client/errors.js";
import { AI_SERVICES_BIT } from "../../src/api/destinations.js";
import { hasFieldFamily, POLICY_FIELD_FAMILY_MAX } from "../../src/api/policyFields.js";
import { CLOUD_HOST, GATEWAY_HOST, MOCK_API_KEY, REPORTER_HOST } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

describe("resource-policy get-merge-post fallback (DEVELOP-34914)", () => {
  it("get-merge-post preserves catN families when the agent sends only aiRiskEnabled", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });

    const summary = await client.policies.patchResourcePolicySettings(
      created.customCategoryId,
      {
        aiRiskEnabled: 1,
        aiRiskEngines: ["chatgpt"],
        linkPolicyToAllSubjects: 1,
      },
      { transport: "get-merge-post" },
    );

    expect(summary.aiRiskEnabled).toBe(1);
    expect(summary.aiRiskEngines).toBe("chatgpt");
    expect(summary.linkPolicyToAllSubjects).toBe(1);
    expect(summary.dlpPolicyMethod).toBe(2);
    expect(summary.cat0).toBeUndefined();

    const posted = state.layerSettings.at(-1)!;
    expect(hasFieldFamily(posted, "cat")).toBe(true);
    expect(hasFieldFamily(posted, "prio")).toBe(true);
    expect(hasFieldFamily(posted, "bypassSslMitm")).toBe(true);
    expect(posted.cat0).toBe(3);
    expect(posted.cat110).toBe(3);
    expect(posted.prio0).toBe(0);
    expect(posted.bypassSslMitm110).toBe(0);
    expect((posted.categories as string).length).toBe(400);
    expect(posted.dlpPolicyMethod).toBe(2);
    expect(state.settingsWrites.at(-1)?.method).toBe("POST");
    expect(state.settingsWrites.at(-1)?.merge).toBeUndefined();

    const full = await client.policies.getResourcePolicySettings(created.customCategoryId, {
      view: "full",
    });
    expect(full.cat7).toBe(3);
    expect(full.aiRiskEnabled).toBe(1);
  });

  it("throws IbossVerifyError when destinations POST succeeds but bits do not persist", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });
    state.dropDestinationsOnPost = true;

    await expect(
      client.policies.putResourcePolicyDestinations(created.customCategoryId, {
        mode: "selectedWebCategories",
        categories: ["AI_SERVICES"],
      }),
    ).rejects.toBeInstanceOf(IbossVerifyError);
  });

  it("omit-safe: distinctive prior family values survive a get-merge-post", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });
    const stored = state.settingsById[created.customCategoryId]!;
    stored.cat7 = 9;
    stored.prio3 = 4;
    stored.bypassSslMitm10 = 1;
    stored.showPACUrl = 1;
    stored.aiRiskMonitoringMessage = "keep me";

    await client.policies.patchResourcePolicySettings(
      created.customCategoryId,
      { aiRiskEnabled: 1 },
      { transport: "get-merge-post" },
    );

    const posted = state.layerSettings.at(-1)!;
    expect(posted.aiRiskEnabled).toBe(1);
    expect(posted.cat7).toBe(9);
    expect(posted.prio3).toBe(4);
    expect(posted.bypassSslMitm10).toBe(1);
    expect(posted.showPACUrl).toBe(1);
    expect(posted.aiRiskMonitoringMessage).toBe("keep me");
    for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) {
      expect(posted[`cat${i}`]).toBeDefined();
      expect(posted[`prio${i}`]).toBeDefined();
      expect(posted[`bypassSslMitm${i}`]).toBeDefined();
    }
  });
});

describe("typed destinations (DEVELOP-34916 / 34925)", () => {
  it("ensureAiSecurityDestination sets bit 110 and categoriesSelectedType 0", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });

    const destinations = await client.policies.ensureAiSecurityDestination(created.customCategoryId);
    expect(destinations).toEqual({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });

    const posted = state.layerSettings.at(-1)!;
    expect(posted.categoriesSelectedType).toBe(0);
    expect((posted.categories as string)[AI_SERVICES_BIT]).toBe("1");
    expect(posted.cat110).toBe(3);
  });

  it("rejects allowlist + categories so the bitmap is not silently dropped", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "Wrong Type",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });

    await expect(
      client.policies.setDestination(created.customCategoryId, {
        mode: "selectedWebCategories",
        categories: ["AI_SERVICES"],
      }),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);

    // No extra settings POST after createLayer's own POST.
    expect(state.layerSettings).toHaveLength(1);
  });

  it("createResourcePolicy returns verified GET settings, not just ids", async () => {
    const client = makeClient();
    const policy = await client.policies.createResourcePolicy({
      name: "AI Security",
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      aiRiskEnabled: true,
      aiRiskEngines: ["chatgpt"],
      aiRiskMonitoringMessage: "AI use is monitored.",
      aiRiskMonitoringMessageEnabled: true,
      aiRiskMonitoringMessageTitle: "Warning",
    });

    expect(policy.customCategoryId).toBeGreaterThan(0);
    expect(policy.destinations.categories).toEqual(["AI_SERVICES"]);
    expect(policy.settings.aiRiskEnabled).toBe(1);
    expect(policy.settings.dlpPolicyMethod).toBe(2);
    expect(policy.settings.cat0).toBeUndefined();
  });
});

describe("raw() tier inference + host routing (DEVELOP-34913)", () => {
  it("sends inferred /json paths to the gateway and /ibreports to the reporter", async () => {
    const state = createMockState();
    const client = makeClient(state);

    await client.raw("GET", "/json/controls/policyLayers/all", {
      query: {
        isZeroTrustLayer: -1,
        typeFilter: -1,
        currentRow: 0,
        maxItems: 100,
        nameFilter: "",
        domainFilter: "",
        groupNameFilter: "",
        groupExcludeNameFilter: "",
        ipInclusionFilter: "",
        ipExclusionFilter: "",
        notesFilter: "",
        portFilter: "",
        usernameFilter: "",
      },
    });
    await client.raw("GET", "/ibreports/web/reports/lite");

    expect(state.requests.some((r) => r === `GET ${GATEWAY_HOST}/json/controls/policyLayers/all`)).toBe(
      true,
    );
    expect(state.requests.some((r) => r === `GET ${REPORTER_HOST}/ibreports/web/reports/lite`)).toBe(
      true,
    );
  });

  it("keeps the existing 4-arg raw(tier, method, path) form", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await client.raw("reporter", "GET", "/ibreports/web/users/me", { withAccountId: false });
    expect(state.requests).toContain(`GET ${REPORTER_HOST}/ibreports/web/users/me`);
  });
});
