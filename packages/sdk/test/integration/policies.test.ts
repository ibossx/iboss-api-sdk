import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossSubscriptionError } from "../../src/client/errors.js";
import { CLOUD_HOST, MOCK_API_KEY } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

describe("policy layers (gateway tier)", () => {
  it("createLayer performs the two-step create + settings dance with XSRF", async () => {
    const state = createMockState();
    const client = makeClient(state);

    const created = await client.policies.createLayer({
      name: "Test Blocklist",
      type: "blocklist",
      settings: { policyAction: 0 },
    });

    expect(created.customCategoryId).toBeGreaterThan(0);
    expect(created.customCategoryNumber).toBe(created.customCategoryId + 1000);

    // Step 1 payload
    expect(state.policyLayers).toHaveLength(1);
    expect(state.policyLayers[0]).toMatchObject({
      customCategoryName: "Test Blocklist",
      customType: "e_custom_category_type_blacklist",
      isZeroTrustResourcePolicy: 0,
    });

    // Step 2 payload: defaults + generated field families + caller overrides
    expect(state.layerSettings).toHaveLength(1);
    const settings = state.layerSettings[0]!;
    expect(settings.customCategoryId).toBe(created.customCategoryId);
    expect(settings.policyEnabled).toBe(1);
    expect(settings.policyAction).toBe(0);
    expect(settings.cat0).toBe(3);
    expect(settings.cat110).toBe(3);
    expect(settings.prio55).toBe(0);
    expect(settings.bypassSslMitm110).toBe(0);
    expect((settings.categories as string).length).toBe(400);
    // Gateway layers do not get the resource-policy-only field by default.
    expect(settings.dlpPolicyMethod).toBeUndefined();
  });

  it("resource policies include the mandatory dlpPolicyMethod: 2", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await client.policies.createLayer({
      name: "Test Resource Policy",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });
    expect(state.layerSettings[0]!.dlpPolicyMethod).toBe(2);
  });

  it("adds, lists, removes, and bulk-imports layer URLs", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const layer = await client.policies.createLayer({ name: "Blocked Sites", type: "blocklist" });

    await client.policies.addLayerUrl(layer.customCategoryId, "blocked.example.com");
    expect(state.layerUrls).toEqual([{ url: "blocked.example.com" }]);
    expect(await client.policies.getLayerUrls(layer.customCategoryId)).toHaveLength(1);

    await client.policies.removeLayerUrl(layer.customCategoryId, "blocked.example.com");
    expect(state.layerUrls).toEqual([]);

    await client.policies.importLayerUrls({
      customCategoryId: layer.customCategoryId,
      customCategoryNumber: layer.customCategoryNumber,
      urls: ["a.example.com", "b.example.com"],
    });
    expect(state.layerUrls).toHaveLength(2);
    expect(state.layerUrls[0]).toMatchObject({
      url: "a.example.com",
      customCategoryNumber: layer.customCategoryNumber,
      doMalwareScan: 1,
    });
  });

  it("maps 422 to IbossSubscriptionError with the account's flags attached", async () => {
    const client = makeClient();
    try {
      await client.dlp.createPolicyResponse({ name: "Response", action: "block" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IbossSubscriptionError);
      const err = error as IbossSubscriptionError;
      expect(err.status).toBe(422);
      expect(err.subscriptionFlags?.ENABLE_DLP_POLICIES_DASHBOARD).toBe(true);
    }
  });

  it("retries transient 5xx on idempotent requests", async () => {
    const state = createMockState();
    state.failNextGets = { path: "/json/controls/policyLayers/all", remaining: 2 };
    const client = makeClient(state);
    const layers = await client.policies.listLayers();
    expect(layers).toEqual([]);
    const attempts = state.requests.filter((r) => r.endsWith("/json/controls/policyLayers/all"));
    expect(attempts.length).toBe(3); // 2 failures + 1 success
  });

  it("associates resources with the console's wire shape (PUT + resourceIds + both ids)", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const policy = await client.policies.createLayer({
      name: "CASB Policy",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });
    await client.policies.associateResources({
      customCategoryId: policy.customCategoryId,
      customCategoryNumber: policy.customCategoryNumber,
      resourceIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(state.resourceAssociations).toHaveLength(1);
    const assoc = state.resourceAssociations[0]!;
    expect(assoc.customCategoryId).toBe(String(policy.customCategoryId));
    expect(assoc.body).toEqual({
      customCategoryNumber: policy.customCategoryNumber,
      resourceIds: ["00000000-0000-0000-0000-000000000001"],
    });
  });
});
