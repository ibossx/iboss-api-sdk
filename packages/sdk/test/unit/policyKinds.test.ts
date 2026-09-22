import { describe, expect, it } from "vitest";
import {
  classifyPolicyKind,
  matchesPolicyKind,
  POLICY_CUSTOM_TYPE,
  POLICY_KIND_FILTERS,
  POLICY_KINDS,
  POLICY_TYPE_FILTER,
  resolvePolicyKind,
  toPolicyList,
  toPolicySummary,
} from "../../src/api/policyKinds.js";

describe("policy kind mapping", () => {
  it("documents typeFilter=9 as DLP and customType 12 as connector", () => {
    expect(POLICY_TYPE_FILTER.dlp).toBe(9);
    expect(POLICY_KIND_FILTERS.dlp).toMatchObject({
      path: "/json/controls/policyLayers/all",
      typeFilter: 9,
      isZeroTrustLayer: -1,
    });
    expect(POLICY_KIND_FILTERS.resource.path).toBe("/json/controls/resourcePolicies");
    expect(POLICY_KIND_FILTERS.aiSecurity.path).toBe("/json/controls/resourcePolicies");
    expect(POLICY_KIND_FILTERS.privateAccess.path).toBe("/json/controls/resourcePolicies");
    expect(POLICY_KIND_FILTERS.layer).toMatchObject({
      path: "/json/controls/policyLayers/all",
      isZeroTrustLayer: 0,
    });
    expect(POLICY_KIND_FILTERS.connector.clientFilter).toContain("12");
    expect(POLICY_CUSTOM_TYPE.connector).toBe(12);
    expect(POLICY_KINDS).toEqual([
      "dlp",
      "aiSecurity",
      "resource",
      "layer",
      "connector",
      "privateAccess",
    ]);
  });

  it("resolves the internet alias to resource and rejects unknown kinds", () => {
    expect(resolvePolicyKind("internet")).toBe("resource");
    expect(resolvePolicyKind("dlp")).toBe("dlp");
    expect(resolvePolicyKind("all")).toBe("all");
    expect(() => resolvePolicyKind("firewall" as never)).toThrow(/Unknown policy kind/);
  });

  it("classifies rows with specific kinds winning over resource/layer", () => {
    expect(classifyPolicyKind({ customType: 9 })).toBe("dlp");
    expect(classifyPolicyKind({ customType: "12" })).toBe("connector");
    expect(
      classifyPolicyKind({
        isZeroTrustResourcePolicy: 1,
        ztnaFlowPeerIds: "peer-1",
        aiRiskEnabled: 1,
      }),
    ).toBe("privateAccess");
    expect(classifyPolicyKind({ isZeroTrustResourcePolicy: 1, aiRiskEnabled: 1 })).toBe(
      "aiSecurity",
    );
    expect(classifyPolicyKind({ isZeroTrustResourcePolicy: 1 })).toBe("resource");
    expect(classifyPolicyKind({ isZeroTrustResourcePolicy: 0, customType: 1 })).toBe("layer");
  });

  it("keeps resource distinct from privateAccess and layer distinct from connector/dlp", () => {
    const resource = { isZeroTrustResourcePolicy: 1, aiRiskEnabled: 1 };
    expect(matchesPolicyKind(resource, "resource")).toBe(true);
    expect(matchesPolicyKind(resource, "privateAccess")).toBe(false);
    expect(matchesPolicyKind({ customType: 12 }, "layer")).toBe(false);
    expect(matchesPolicyKind({ customType: 9 }, "layer")).toBe(false);
  });

  it("normalizes a stable summary shape", () => {
    const summary = toPolicySummary({
      customCategoryId: 42,
      customCategoryNumber: 1042,
      customCategoryName: "AI Services",
      policyEnabled: 1,
      customType: 13,
      isZeroTrustResourcePolicy: 1,
      aiRiskEnabled: 1,
    });
    expect(summary).toEqual({
      id: 42,
      number: 1042,
      name: "AI Services",
      kind: "aiSecurity",
      enabled: true,
      customType: 13,
      flags: {
        isZeroTrustResourcePolicy: true,
        isZtnaPrivateAccess: false,
        aiRiskEnabled: true,
      },
    });
  });

  it("builds a list envelope with the documented filter", () => {
    const list = toPolicyList("dlp", [
      { customCategoryId: 1, customCategoryName: "DLP", customType: 9, policyEnabled: 1 },
      { customCategoryId: 2, customCategoryName: "Layer", customType: 1 },
    ]);
    expect(list.kind).toBe("dlp");
    expect(list.total).toBe(1);
    expect(list.items[0]?.name).toBe("DLP");
    expect(list.filter).toEqual(POLICY_KIND_FILTERS.dlp);
  });
});
