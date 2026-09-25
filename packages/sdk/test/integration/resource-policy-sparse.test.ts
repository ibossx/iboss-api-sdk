import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossVerifyError } from "../../src/client/errors.js";
import { hasFieldFamily, POLICY_FIELD_FAMILY_MAX } from "../../src/api/policyFields.js";
import { CLOUD_HOST, MOCK_API_KEY } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

async function createPolicy(client: IbossClient) {
  return client.policies.createLayer({
    name: "AI Security Policy",
    type: "categories",
    isZeroTrustResourcePolicy: 1,
  });
}

function stampDistinctiveFamilies(stored: Record<string, unknown>) {
  stored.cat7 = 9;
  stored.prio3 = 4;
  stored.bypassSslMitm10 = 1;
  stored.showPACUrl = 1;
  stored.allowLargeFiles = 1;
  stored.note = "keep me";
}

describe("sparse resource-policy settings", () => {
  it("GET summary hides generated families; full view keeps them", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    stampDistinctiveFamilies(state.settingsById[created.customCategoryId]!);

    const summary = await client.policies.getResourcePolicySettings(created.customCategoryId);
    expect(summary.customCategoryId).toBe(created.customCategoryId);
    expect(summary.note).toBe("keep me");
    expect(summary.cat7).toBeUndefined();
    expect(summary.categories).toBeUndefined();
    expect(Object.keys(summary).some((key) => /^(cat|prio|bypassSslMitm)\d+$/.test(key))).toBe(
      false,
    );

    const full = await client.policies.getResourcePolicySettings(created.customCategoryId, {
      view: "full",
    });
    expect(full.cat7).toBe(9);
    expect(full.prio3).toBe(4);
    expect((full.categories as string).length).toBe(400);
  });

  it("native PATCH sends only the changed field and preserves families", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    stampDistinctiveFamilies(state.settingsById[created.customCategoryId]!);

    const summary = await client.policies.patchResourcePolicySettings(created.customCategoryId, {
      aiRiskEnabled: 1,
    });

    expect(summary.aiRiskEnabled).toBe(1);
    expect(summary.note).toBe("keep me");
    expect(summary.cat7).toBeUndefined();

    const write = state.settingsWrites.at(-1)!;
    expect(write.method).toBe("PATCH");
    expect(write.body).toEqual({ customCategoryId: created.customCategoryId, aiRiskEnabled: 1 });
    expect(write.body.cat0).toBeUndefined();
    expect(write.body.prio0).toBeUndefined();
    expect(write.body.categories).toBeUndefined();

    const stored = state.settingsById[created.customCategoryId]!;
    expect(stored.aiRiskEnabled).toBe(1);
    expect(stored.cat7).toBe(9);
    expect(stored.prio3).toBe(4);
    expect(stored.bypassSslMitm10).toBe(1);
    expect(stored.allowLargeFiles).toBe(1);
    expect(stored.note).toBe("keep me");
    expect(hasFieldFamily(stored, "cat")).toBe(true);
  });

  it("POST ?merge=1 is omit-safe when the caller opts in", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    stampDistinctiveFamilies(state.settingsById[created.customCategoryId]!);

    await client.policies.patchResourcePolicySettings(
      created.customCategoryId,
      { aiRiskEnabled: 1 },
      { transport: "merge-post" },
    );

    const write = state.settingsWrites.at(-1)!;
    expect(write.method).toBe("POST");
    expect(write.merge).toBe("1");
    expect(write.body).toEqual({ customCategoryId: created.customCategoryId, aiRiskEnabled: 1 });
    expect(state.settingsById[created.customCategoryId]!.cat7).toBe(9);
    expect(state.requests.some((r) => r.startsWith("PATCH "))).toBe(false);
  });

  it("auto falls back to get-merge-post when PATCH is 405", async () => {
    const state = createMockState();
    state.nativeSettingsPatch = false;
    const client = makeClient(state);
    const created = await createPolicy(client);
    stampDistinctiveFamilies(state.settingsById[created.customCategoryId]!);

    await client.policies.patchResourcePolicySettings(created.customCategoryId, {
      aiRiskEnabled: 1,
    });

    const write = state.settingsWrites.at(-1)!;
    expect(write.method).toBe("POST");
    expect(write.merge).toBeUndefined();
    expect(write.body.aiRiskEnabled).toBe(1);
    expect(write.body.cat7).toBe(9);
    expect(write.body.prio3).toBe(4);
    expect(hasFieldFamily(write.body, "cat")).toBe(true);
    expect(hasFieldFamily(write.body, "prio")).toBe(true);
    expect(hasFieldFamily(write.body, "bypassSslMitm")).toBe(true);
    for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) {
      expect(write.body[`cat${i}`]).toBeDefined();
    }
    expect(state.settingsById[created.customCategoryId]!.note).toBe("keep me");
    expect(state.requests.filter((r) => r.includes("/policyLayers/settings")).some((r) => r.startsWith("PATCH "))).toBe(
      true,
    );
  });

  it("negative: sparse updateLayerSettings without merge wipes omitted families", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    stampDistinctiveFamilies(state.settingsById[created.customCategoryId]!);

    await client.policies.updateLayerSettings({
      customCategoryId: created.customCategoryId,
      customCategoryNumber: created.customCategoryNumber,
      customCategoryName: "AI Security Policy",
      aiRiskEnabled: 1,
    });

    const stored = state.settingsById[created.customCategoryId]!;
    expect(stored.aiRiskEnabled).toBe(1);
    expect(stored.cat7).toBeUndefined();
    expect(stored.prio3).toBeUndefined();
    expect(stored.note).toBeUndefined();
    expect(hasFieldFamily(stored, "cat")).toBe(false);
  });

  it("throws IbossVerifyError when the write succeeds but GET does not persist", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    state.dropPatchFieldsOnRead = true;

    await expect(
      client.policies.patchResourcePolicySettings(created.customCategoryId, { aiRiskEnabled: 1 }),
    ).rejects.toBeInstanceOf(IbossVerifyError);
  });

  it("existing getLayerSettings / updateLayerSettings names are unchanged", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await createPolicy(client);
    const full = await client.policies.getLayerSettings(created.customCategoryId);
    expect(full.customCategoryId).toBe(created.customCategoryId);
    expect(full.cat0).toBe(3);
  });
});
