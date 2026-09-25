import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossPolicyTypeError, IbossVerifyError } from "../../src/client/errors.js";
import {
  AI_SERVICES_BIT,
  emptyDestinationBitmap,
  isCategoryBitSet,
  setCategoryBit,
} from "../../src/api/destinations.js";
import { CLOUD_HOST, MOCK_API_KEY } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  const warnings: Array<{ message: string; data?: unknown }> = [];
  const client = new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
    logger: {
      debug() {},
      info() {},
      warn(message, data) {
        warnings.push({ message, data });
      },
      error() {},
    },
  });
  return { client, state, warnings };
}

describe("PUT resourcePolicies/{id}/destinations", () => {
  it("sets AI Services without the agent inventing a bitmap or inverted type", async () => {
    const { client, state } = makeClient();
    const layer = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
      settings: { policyAction: 1, cat7: 9, prio3: 4, bypassSslMitm10: 1 },
    });

    const result = await client.policies.putResourcePolicyDestinations(layer.customCategoryId, {
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });

    expect(result).toEqual({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(await client.policies.getResourcePolicyDestinations(layer.customCategoryId)).toEqual(
      result,
    );

    const posted = state.layerSettings.at(-1)!;
    expect(posted.categoriesSelectedType).toBe(0);
    expect(isCategoryBitSet(posted.categories as string, AI_SERVICES_BIT)).toBe(true);
    expect((posted.categories as string).length).toBe(400);
    // Distinctive prior family values survive the destinations write.
    expect(posted.cat7).toBe(9);
    expect(posted.prio3).toBe(4);
    expect(posted.bypassSslMitm10).toBe(1);
    expect(posted.dlpPolicyMethod).toBe(2);
  });

  it("ensureAiSecurityDestination is the AI Services shortcut", async () => {
    const { client } = makeClient();
    const layer = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });
    const result = await client.policies.ensureAiSecurityDestination(layer.customCategoryId);
    expect(result.categories).toEqual(["AI_SERVICES"]);
    expect(result.mode).toBe("selectedWebCategories");
  });

  it("rejects allowlist + categories (never silent drop)", async () => {
    const { client, state } = makeClient();
    const layer = await client.policies.createLayer({
      name: "Allowlist recreate",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });
    const postsBefore = state.layerSettings.length;

    await expect(
      client.policies.putResourcePolicyDestinations(layer.customCategoryId, {
        mode: "selectedWebCategories",
        categories: ["AI_SERVICES"],
      }),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);

    expect(state.layerSettings).toHaveLength(postsBefore);
    expect(await client.policies.getResourcePolicyDestinations(layer.customCategoryId)).toEqual({
      mode: "selectedWebCategories",
      categories: [],
    });
  });

  it("warns and skips the write when onWrongType is warn", async () => {
    const { client, state, warnings } = makeClient();
    const layer = await client.policies.createLayer({
      name: "Allowlist recreate",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });
    const postsBefore = state.layerSettings.length;

    const result = await client.policies.setDestination(
      layer.customCategoryId,
      { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      { onWrongType: "warn" },
    );

    expect(result.categories).toEqual([]);
    expect(state.layerSettings).toHaveLength(postsBefore);
    expect(warnings.some((w) => /silently drops/.test(w.message))).toBe(true);
  });

  it("throws before settings POST when allowlist is combined with bit 110", async () => {
    const { client, state } = makeClient();
    const bitmap = setCategoryBit(emptyDestinationBitmap(), AI_SERVICES_BIT);

    await expect(
      client.policies.createLayer({
        name: "Doomed allowlist",
        type: "allowlist",
        isZeroTrustResourcePolicy: 1,
        settings: { categories: bitmap, categoriesSelectedType: 0 },
      }),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);
    expect(state.policyLayers).toHaveLength(0);
    expect(state.layerSettings).toHaveLength(0);

    const layer = await client.policies.createLayer({
      name: "Existing allowlist",
      type: "allowlist",
      isZeroTrustResourcePolicy: 1,
    });
    const postsBefore = state.layerSettings.length;
    await expect(
      client.policies.updateLayerSettings({
        customCategoryId: layer.customCategoryId,
        customCategoryNumber: layer.customCategoryNumber,
        customCategoryName: "Existing allowlist",
        categories: bitmap,
        categoriesSelectedType: 0,
      }),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);
    expect(state.layerSettings).toHaveLength(postsBefore);

    await expect(
      client.policies.patchResourcePolicySettings(
        layer.customCategoryId,
        { categories: bitmap, categoriesSelectedType: 0 },
        { transport: "get-merge-post" },
      ),
    ).rejects.toBeInstanceOf(IbossPolicyTypeError);
    expect(state.layerSettings).toHaveLength(postsBefore);
  });

  it("throws IbossVerifyError when POST succeeds but bit 110 does not persist", async () => {
    const { client, state } = makeClient();
    state.dropDestinationsOnPost = true;
    const layer = await client.policies.createLayer({
      name: "AI Security Policy",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
    });

    await expect(
      client.policies.putResourcePolicyDestinations(layer.customCategoryId, {
        mode: "selectedWebCategories",
        categories: ["AI_SERVICES"],
      }),
    ).rejects.toBeInstanceOf(IbossVerifyError);
  });
});
