import { describe, expect, it } from "vitest";
import {
  assertCreateSettingsPatch,
  buildCreateResourcePolicySettings,
  collectCreateVerifyFailures,
  omitGeneratedSettingsFamilies,
  resolveCreateSettingsPatch,
  viewCreatedResourcePolicy,
} from "../../src/api/resourcePolicyCreate.js";
import { AI_SERVICES_BIT, isCategoryBitSet } from "../../src/api/destinations.js";
import { IbossPolicyTypeError } from "../../src/client/errors.js";

describe("createResourcePolicy compose (destinations + settings)", () => {
  it("encodes destinations and merges sparse settings onto families + dlpPolicyMethod 2", () => {
    const { body, verify } = buildCreateResourcePolicySettings({
      customCategoryId: 42,
      customCategoryNumber: 1042,
      name: "AI Security",
      type: "categories",
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      settings: { aiRiskEnabled: true, linkPolicyToAllSubjects: 1 },
    });

    expect(body.customCategoryId).toBe(42);
    expect(body.dlpPolicyMethod).toBe(2);
    expect(body.aiRiskEnabled).toBe(1);
    expect(body.categoriesSelectedType).toBe(0);
    expect(isCategoryBitSet(body.categories as string, AI_SERVICES_BIT)).toBe(true);
    expect(body.cat0).toBe(3);
    expect(body.cat110).toBe(3);
    expect(body.prio7).toBe(0);
    expect(body.bypassSslMitm10).toBe(0);
    expect(verify.destinations?.bits).toEqual([AI_SERVICES_BIT]);
    expect(verify.fields.aiRiskEnabled).toBe(1);
  });

  it("rejects allowlist + destinations before a body is usable", () => {
    expect(() =>
      buildCreateResourcePolicySettings({
        customCategoryId: 1,
        customCategoryNumber: 1001,
        name: "CASB",
        type: "allowlist",
        destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
        settings: {},
      }),
    ).toThrow(IbossPolicyTypeError);
  });

  it("rejects settings that invent the wire bitmap / selected-type", () => {
    expect(() => assertCreateSettingsPatch({ categories: "1".repeat(400) })).toThrow(/destinations/);
    expect(() => assertCreateSettingsPatch({ categoriesSelectedType: 0 })).toThrow(/destinations/);
  });

  it("encodes aiRiskEngines \"all\" and slug lists before the settings POST", () => {
    const base = {
      customCategoryId: 7,
      customCategoryNumber: 1007,
      name: "AI Security",
      type: "categories" as const,
    };
    const all = buildCreateResourcePolicySettings({
      ...base,
      settings: resolveCreateSettingsPatch({ name: "AI Security", aiRiskEngines: "all" }),
    });
    expect(all.body.aiRiskEngines).toBe("chatgpt,claude,gemini,copilot,perplexity");
    expect(all.verify.fields.aiRiskEngines).toBe("chatgpt,claude,gemini,copilot,perplexity");

    const listed = buildCreateResourcePolicySettings({
      ...base,
      settings: { aiRiskEngines: ["chatgpt", "claude"] },
    });
    expect(listed.body.aiRiskEngines).toBe("chatgpt,claude");
    expect(listed.verify.fields.aiRiskEngines).toBe("chatgpt,claude");

    const settingsWin = buildCreateResourcePolicySettings({
      ...base,
      settings: resolveCreateSettingsPatch({
        name: "AI Security",
        aiRiskEngines: ["perplexity"],
        settings: { aiRiskEngines: "all" },
      }),
    });
    expect(settingsWin.body.aiRiskEngines).toBe("chatgpt,claude,gemini,copilot,perplexity");
  });

  it("rejects invalid aiRiskEngines before a create body is posted", () => {
    const base = {
      customCategoryId: 7,
      customCategoryNumber: 1007,
      name: "AI Security",
      type: "categories" as const,
    };
    expect(() =>
      buildCreateResourcePolicySettings({
        ...base,
        settings: { aiRiskEngines: ["ChatGPT"] },
      }),
    ).toThrow(/Unknown aiRiskEngines/);
    expect(() =>
      buildCreateResourcePolicySettings({
        ...base,
        settings: { aiRiskEngines: [] },
      }),
    ).toThrow(/non-empty list/);
  });

  it("lets settings win over top-level aliases", () => {
    const patch = resolveCreateSettingsPatch({
      name: "P",
      linkPolicyToAllSubjects: 1,
      aiRiskEnabled: 0,
      settings: { aiRiskEnabled: 1, linkPolicyToAllSubjects: 0, associatedGroups: "2,3" },
    });
    expect(patch.aiRiskEnabled).toBe(1);
    expect(patch.linkPolicyToAllSubjects).toBe(0);
    expect(patch.associatedGroups).toBe("2,3");
  });

  it("summary view hides generated families and exposes decoded destinations", () => {
    const { body } = buildCreateResourcePolicySettings({
      customCategoryId: 5,
      customCategoryNumber: 1005,
      name: "AI Security",
      type: "categories",
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      settings: { aiRiskEnabled: 1 },
    });
    const viewed = viewCreatedResourcePolicy({ ...body, customType: 13 }, "summary");
    expect(viewed.destinations.categories).toEqual(["AI_SERVICES"]);
    expect(viewed.settings.cat0).toBeUndefined();
    expect(viewed.settings.categories).toBeUndefined();
    expect(viewed.settings.aiRiskEnabled).toBe(1);
    expect(omitGeneratedSettingsFamilies(body).prio0).toBeUndefined();
  });

  it("collectCreateVerifyFailures flags dropped destinations and missing settings", () => {
    const failures = collectCreateVerifyFailures(
      { customType: 13, categories: "", aiRiskEnabled: 0, dlpPolicyMethod: 2 },
      {
        destinations: { categoriesSelectedType: 0, bits: [AI_SERVICES_BIT] },
        fields: { aiRiskEnabled: 1, dlpPolicyMethod: 2 },
      },
    );
    expect(failures.some((f) => f.includes("bitmap"))).toBe(true);
    expect(failures.some((f) => f.includes("aiRiskEnabled"))).toBe(true);
    expect(failures.some((f) => f.includes("dlpPolicyMethod"))).toBe(false);
  });
});
