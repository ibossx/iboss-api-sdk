import { describe, expect, it } from "vitest";
import { IbossError } from "../../src/client/errors.js";
import { IbossClient } from "../../src/client/IbossClient.js";
import { POLICY_KIND_FILTERS, POLICY_TYPE_FILTER } from "../../src/api/policyKinds.js";
import { CLOUD_HOST, MOCK_API_KEY } from "../mock-server/fixtures.js";
import { createMockState, mockFetch, type MockState } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState()) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
  });
}

async function seedKinds(state: MockState) {
  const client = makeClient(state);
  await client.policies.createLayer({ name: "Overlay Layer", type: "blocklist" });
  await client.policies.createLayerStructure({
    name: "DLP Policy",
    type: "categories",
    extra: { customType: 9, policyEnabled: 1 },
  });
  await client.policies.createLayerStructure({
    name: "Windows Connector",
    type: "blocklist",
    extra: { customType: 12, policyEnabled: 1 },
  });
  await client.policies.createLayer({
    name: "Internet Access",
    type: "allowlist",
    isZeroTrustResourcePolicy: 1,
  });
  await client.policies.createLayerStructure({
    name: "AI Security",
    type: "categories",
    isZeroTrustResourcePolicy: 1,
    extra: { aiRiskEnabled: 1, policyEnabled: 1, customType: 13 },
  });
  await client.policies.createLayerStructure({
    name: "Core Office ZTNA",
    type: "allowlist",
    isZeroTrustResourcePolicy: 1,
    extra: { ztnaFlowPeerIds: "peer-1", isZtnaPrivateAccessCategory: 1, policyEnabled: 1 },
  });
  return client;
}

describe("listPolicies({ kind })", () => {
  it("lists DLP via typeFilter=9 and returns the stable envelope", async () => {
    const state = createMockState();
    const client = await seedKinds(state);

    const dlp = await client.policies.listPolicies({ kind: "dlp" });
    expect(state.lastPolicyListQuery.typeFilter).toBe(String(POLICY_TYPE_FILTER.dlp));
    expect(dlp).toMatchObject({
      kind: "dlp",
      total: 1,
      filter: POLICY_KIND_FILTERS.dlp,
    });
    expect(dlp.items).toEqual([
      expect.objectContaining({
        name: "DLP Policy",
        kind: "dlp",
        customType: 9,
        flags: expect.objectContaining({ isZeroTrustResourcePolicy: false }),
      }),
    ]);

    const viaHelper = await client.policies.listDlpPolicies();
    expect(viaHelper.items.map((item) => item.name)).toEqual(["DLP Policy"]);
  });

  it("lists AI Security from resourcePolicies and composes listAiSecurityPolicies", async () => {
    const state = createMockState();
    const client = await seedKinds(state);

    const ai = await client.policies.listPolicies({ kind: "aiSecurity" });
    expect(ai.kind).toBe("aiSecurity");
    expect(ai.filter).toEqual(POLICY_KIND_FILTERS.aiSecurity);
    expect(ai.items.map((item) => item.name)).toEqual(["AI Security"]);
    expect(ai.items[0]?.flags.aiRiskEnabled).toBe(true);

    const viaHelper = await client.policies.listAiSecurityPolicies();
    expect(viaHelper.items.map((item) => item.id)).toEqual(ai.items.map((item) => item.id));

    const resourceGets = state.requests.filter((row) =>
      row.endsWith("/json/controls/resourcePolicies"),
    );
    expect(resourceGets.length).toBeGreaterThan(0);
  });

  it("inspects settings when the list row omits aiRisk fields", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const created = await client.policies.createLayer({
      name: "Hidden AI",
      type: "categories",
      isZeroTrustResourcePolicy: 1,
      settings: { aiRiskEnabled: 1, aiRiskEngines: "chatgpt" },
    });

    const skipped = await client.policies.listAiSecurityPolicies({ inspectSettings: false });
    expect(skipped.items).toEqual([]);

    const found = await client.policies.listAiSecurityPolicies();
    expect(found.items).toEqual([
      expect.objectContaining({
        id: created.customCategoryId,
        name: "Hidden AI",
        kind: "aiSecurity",
        flags: expect.objectContaining({ aiRiskEnabled: true }),
      }),
    ]);
    expect(
      state.requests.some((row) => row.endsWith("/json/controls/policyLayers/settings")),
    ).toBe(true);
  });

  it("uses resourcePolicies for resource/internet and drops Private Access", async () => {
    const state = createMockState();
    const client = await seedKinds(state);

    const resource = await client.policies.listPolicies({ kind: "resource" });
    expect(resource.items.map((item) => item.name).sort()).toEqual(["AI Security", "Internet Access"]);

    const internet = await client.policies.listPolicies({ kind: "internet" });
    expect(internet.kind).toBe("resource");
    expect(internet.items.map((item) => item.name).sort()).toEqual(resource.items.map((item) => item.name).sort());

    const privateAccess = await client.policies.listPolicies({ kind: "privateAccess" });
    expect(privateAccess.items.map((item) => item.name)).toEqual(["Core Office ZTNA"]);
  });

  it("lists overlay layers and connector policies from policyLayers/all", async () => {
    const state = createMockState();
    const client = await seedKinds(state);

    const layers = await client.policies.listPolicies({ kind: "layer" });
    expect(state.lastPolicyListQuery.isZeroTrustLayer).toBe("0");
    expect(layers.items.map((item) => item.name)).toEqual(["Overlay Layer"]);

    const connectors = await client.policies.listPolicies({ kind: "connector" });
    expect(connectors.items).toEqual([
      expect.objectContaining({ name: "Windows Connector", kind: "connector", customType: 12 }),
    ]);
  });

  it("classifies every row for kind=all", async () => {
    const state = createMockState();
    const client = await seedKinds(state);
    const all = await client.policies.listPolicies({ kind: "all" });
    expect(all.total).toBe(6);
    expect(all.items.map((item) => item.kind).sort()).toEqual([
      "aiSecurity",
      "connector",
      "dlp",
      "layer",
      "privateAccess",
      "resource",
    ]);
  });

  it("leaves legacy listLayers / listResourcePolicies unfiltered by kind", async () => {
    const state = createMockState();
    const client = await seedKinds(state);

    const layers = await client.policies.listLayers();
    expect(layers).toHaveLength(6);
    expect(layers[0]).toMatchObject({ customCategoryName: "Overlay Layer" });

    const resources = await client.policies.listResourcePolicies();
    expect(resources).toHaveLength(3);
    expect(resources.every((row) => row.isZeroTrustResourcePolicy === 1)).toBe(true);
  });

  it("rejects an unknown kind without calling the gateway", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await expect(client.policies.listPolicies({ kind: "firewall" as never })).rejects.toBeInstanceOf(
      IbossError,
    );
    expect(state.requests.filter((row) => row.includes("/json/controls/"))).toEqual([]);
  });
});
