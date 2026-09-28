import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossPolicyTypeError, IbossVerifyError } from "../../src/client/errors.js";
import { AI_SERVICES_BIT, isCategoryBitSet } from "../../src/api/destinations.js";
import { CLOUD_HOST, GATEWAY_HOST } from "../mock-server/fixtures.js";
import { MOCK_API_KEY } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

describe("createResourcePolicy", () => {
  it("returns effective re-GET settings, not just ids / POST 200", async () => {
    const state = createMockState();
    const client = makeClient(state);

    const policy = await client.policies.createResourcePolicy({
      name: "AI Security",
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      settings: {
        aiRiskEnabled: 1,
        aiRiskEngines: ["chatgpt"],
        aiRiskMonitoringMessage: "AI use is monitored.",
        linkPolicyToAllSubjects: 1,
      },
    });

    expect(policy.customCategoryId).toBeGreaterThan(0);
    expect(policy.customCategoryNumber).toBe(policy.customCategoryId + 1000);
    expect(policy.destinations).toEqual({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(policy.settings.aiRiskEnabled).toBe(1);
    expect(policy.settings.aiRiskEngines).toBe("chatgpt");
    expect(policy.settings.dlpPolicyMethod).toBe(2);
    expect(policy.settings.cat0).toBeUndefined();
    expect(policy.settings.categories).toBeUndefined();

    const posted = state.layerSettings.at(-1)!;
    expect(posted.dlpPolicyMethod).toBe(2);
    expect(posted.categoriesSelectedType).toBe(0);
    expect(isCategoryBitSet(posted.categories as string, AI_SERVICES_BIT)).toBe(true);
    expect(posted.cat7).toBe(3);
    expect(posted.prio3).toBe(0);
    expect(posted.bypassSslMitm10).toBe(0);

    const gets = state.requests.filter((r) =>
      r.endsWith("/json/controls/policyLayers/settings"),
    );
    expect(gets.some((r) => r.startsWith("POST"))).toBe(true);
    expect(gets.some((r) => r.startsWith("GET"))).toBe(true);
    expect(state.requests.some((r) => r === `PUT ${GATEWAY_HOST}/json/controls/policyLayers`)).toBe(
      true,
    );
  });

  it("createLayer still returns ids only and does not re-GET", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "Legacy",
      type: "blocklist",
      isZeroTrustResourcePolicy: 1,
    });
    expect(created.customCategoryId).toBeGreaterThan(0);
    expect(created).not.toHaveProperty("destinations");
    expect(created).not.toHaveProperty("settings");
    const settingsGets = state.requests.filter(
      (r) => r.startsWith("GET") && r.endsWith("/json/controls/policyLayers/settings"),
    );
    expect(settingsGets).toHaveLength(0);
  });

  it("rejects allowlist + destinations before PUT", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await expect(
      client.policies.createResourcePolicy({
        name: "CASB",
        type: "allowlist",
        destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      }),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);
    expect(state.policyLayers).toHaveLength(0);
    expect(state.layerSettings).toHaveLength(0);
  });

  it("throws IbossVerifyError when POST succeeds but GET drops destinations", async () => {
    const state = createMockState();
    state.dropDestinationsOnPost = true;
    const client = makeClient(state);
    await expect(
      client.policies.createResourcePolicy({
        name: "AI Security",
        destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
        settings: { aiRiskEnabled: 1 },
      }),
    ).rejects.toBeInstanceOf(IbossVerifyError);
  });

  it("view: full returns the wire blob including families", async () => {
    const client = makeClient();
    const policy = await client.policies.createResourcePolicy({
      name: "Full view",
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      settings: { aiRiskEnabled: 1 },
      view: "full",
    });
    expect(policy.settings.cat0).toBe(3);
    expect(typeof policy.settings.categories).toBe("string");
    expect((policy.settings.categories as string).length).toBe(400);
  });

  it("creates an allowlist resource policy without destinations (CASB)", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const policy = await client.policies.createResourcePolicy({
      name: "Approved Apps",
      type: "allowlist",
      enterpriseOwned: 1,
      settings: { policyAction: 1, linkPolicyToAllSubjects: 1 },
    });
    expect(policy.settings.dlpPolicyMethod).toBe(2);
    expect(policy.settings.policyAction).toBe(1);
    expect(state.policyLayers[0]).toMatchObject({
      customType: "e_custom_category_type_allowlist",
      isZeroTrustResourcePolicy: 1,
      enterpriseOwned: 1,
    });
  });
});
