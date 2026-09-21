import { describe, expect, it } from "vitest";
import { IbossPolicyTypeError } from "../../src/client/errors.js";
import { AI_SERVICES_BIT } from "../../src/api/destinations.js";
import {
  collectVerifyFailures,
  mergeResourcePolicySettings,
} from "../../src/api/resourcePolicySettings.js";
import {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
} from "../../src/api/policyFields.js";

function currentSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customCategoryId: 1114,
    customCategoryNumber: 2114,
    customCategoryName: "AI Security Policy",
    isZeroTrustResourcePolicy: 1,
    customType: 3,
    policyEnabled: 1,
    showPACUrl: 1,
    ...generateCategoryFields(),
    ...generatePriorityFields(),
    ...generateBypassSslMitmFields(),
    categories: emptyCategoriesBitmap(),
    dlpPolicyMethod: 2,
    ...overrides,
  };
}

describe("mergeResourcePolicySettings (DEVELOP-34914)", () => {
  it("lets agents send only changed fields and keeps unrelated GET fields", () => {
    const current = currentSettings({ showPACUrl: 1, cat7: 9 });
    const { next } = mergeResourcePolicySettings(current, { aiRiskEnabled: 1 });
    expect(next.aiRiskEnabled).toBe(1);
    expect(next.showPACUrl).toBe(1);
    expect(next.cat7).toBe(9);
    expect(next.cat0).toBe(3);
    expect(next.cat110).toBe(3);
    expect(next.prio55).toBe(0);
    expect(next.bypassSslMitm110).toBe(0);
    expect(next.dlpPolicyMethod).toBe(2);
  });

  it("injects missing catN / prioN / bypassSslMitmN families", () => {
    const { next } = mergeResourcePolicySettings(
      { customCategoryId: 1, isZeroTrustResourcePolicy: 1 },
      { linkPolicyToAllSubjects: true },
    );
    expect(next.cat0).toBe(3);
    expect(next.cat110).toBe(3);
    expect(next.prio0).toBe(0);
    expect(next.bypassSslMitm110).toBe(0);
    expect(typeof next.categories).toBe("string");
    expect((next.categories as string).length).toBe(400);
    expect(next.linkPolicyToAllSubjects).toBe(1);
    expect(next.dlpPolicyMethod).toBe(2);
  });

  it("encodes destinations without the agent sending a bitmap", () => {
    const { next, verify } = mergeResourcePolicySettings(currentSettings(), {
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
    });
    expect(next.categoriesSelectedType).toBe(0);
    expect((next.categories as string)[AI_SERVICES_BIT]).toBe("1");
    expect(verify.bits).toEqual([AI_SERVICES_BIT]);
    expect(verify.categoriesSelectedType).toBe(0);
  });

  it("rejects allowlist + categories (silent bitmap drop)", () => {
    expect(() =>
      mergeResourcePolicySettings(currentSettings({ customType: 1 }), {
        destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      }),
    ).toThrow(IbossPolicyTypeError);
  });

  it("warns instead of encoding when onWrongType is warn", () => {
    const { next, warning, verify } = mergeResourcePolicySettings(currentSettings({ customType: 1 }), {
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      onWrongType: "warn",
      aiRiskEnabled: 1,
    });
    expect(warning).toMatch(/silently drops/);
    expect(next.categoriesSelectedType).toBeUndefined();
    expect(verify.bits).toEqual([]);
    expect(next.aiRiskEnabled).toBe(1);
  });

  it("skips family injection in advanced mode", () => {
    const { next } = mergeResourcePolicySettings(
      { customCategoryId: 1, isZeroTrustResourcePolicy: 1 },
      { aiRiskEnabled: 1, advanced: true },
    );
    expect(next.cat0).toBeUndefined();
    expect(next.aiRiskEnabled).toBe(1);
  });

  it("validates aiRiskEngines before POST", () => {
    expect(() =>
      mergeResourcePolicySettings(currentSettings(), { aiRiskEngines: "ChatGPT" }),
    ).toThrow(/Unknown aiRiskEngines/);
    const { next } = mergeResourcePolicySettings(currentSettings(), { aiRiskEngines: "all" });
    expect(next.aiRiskEngines).toBe("chatgpt,claude,gemini,copilot,perplexity");
  });
});

describe("collectVerifyFailures", () => {
  it("treats a successful POST with an empty bitmap as a failure", () => {
    const failures = collectVerifyFailures(
      { customType: 1, categories: "", categoriesSelectedType: undefined, aiRiskEnabled: 1 },
      {
        requireCategoriesType: true,
        categoriesSelectedType: 0,
        bits: [AI_SERVICES_BIT],
        fields: { aiRiskEnabled: 1 },
      },
    );
    expect(failures.some((f) => f.includes("bit 110"))).toBe(true);
    expect(failures.some((f) => f.includes("customType"))).toBe(true);
  });

  it("passes when bit 110, type 0, and patched fields persist", () => {
    const bitmap = emptyCategoriesBitmap().split("");
    bitmap[AI_SERVICES_BIT] = "1";
    const failures = collectVerifyFailures(
      {
        customType: 13,
        categories: bitmap.join(""),
        categoriesSelectedType: 0,
        aiRiskEnabled: 1,
        dlpPolicyMethod: 2,
      },
      {
        requireCategoriesType: true,
        categoriesSelectedType: 0,
        bits: [AI_SERVICES_BIT],
        fields: { aiRiskEnabled: 1, dlpPolicyMethod: 2 },
      },
    );
    expect(failures).toEqual([]);
  });
});
