import { describe, expect, it } from "vitest";
import { IbossPolicyTypeError } from "../../src/client/errors.js";
import {
  buildCreateResourcePolicySettings,
  viewCreatedResourcePolicy,
} from "../../src/api/resourcePolicyCreate.js";
import {
  applyGatewayCreateEcho,
  annotateResourcePolicyKind,
  customTypeMatchesKind,
  resolveResourcePolicyKind,
  RESOURCE_POLICY_KINDS,
  RESOURCE_POLICY_KIND_WIRE,
  type ResourcePolicyKind,
} from "../../src/api/resourcePolicyKinds.js";

const URL_LIST_ENUM = "e_custom_category_url_list";
const URL_LIST_ALIAS = "e_custom_category_type_url_list";

describe("resource policy customType allowlist (DEVELOP-34977)", () => {
  it("maps every allowlisted kind to its numeric and back to the canonical enum", () => {
    for (const kind of RESOURCE_POLICY_KINDS) {
      const wire = RESOURCE_POLICY_KIND_WIRE[kind];
      const fromKind = resolveResourcePolicyKind({ kind });
      const fromEnum = resolveResourcePolicyKind({ customType: wire.customType });
      const fromNumeric = resolveResourcePolicyKind({ customType: wire.numeric });
      const fromNumericString = resolveResourcePolicyKind({ kind: String(wire.numeric) });
      const fromPlusNumeric = resolveResourcePolicyKind({ customType: `+${wire.numeric}` });

      expect(fromKind).toEqual(wire);
      expect(fromEnum).toEqual(wire);
      expect(fromNumeric.kind).toBe(kind);
      expect(fromNumeric.numeric).toBe(wire.numeric);
      expect(fromNumeric.customType).toBe(wire.customType);
      expect(fromNumericString).toEqual(wire);
      expect(fromPlusNumeric).toEqual(wire);
      expect(customTypeMatchesKind(wire.numeric, wire)).toBe(true);
      expect(customTypeMatchesKind(wire.customType, wire)).toBe(true);
      expect(customTypeMatchesKind(String(wire.numeric), wire)).toBe(true);
    }
  });

  it("keeps categories (3) distinct from resourcePoliciesCombined (13)", () => {
    const categories = RESOURCE_POLICY_KIND_WIRE.categories;
    const combined = RESOURCE_POLICY_KIND_WIRE.resourcePoliciesCombined;

    expect(categories.numeric).toBe(3);
    expect(combined.numeric).toBe(13);
    expect(resolveResourcePolicyKind({ customType: 3 }).kind).toBe("categories");
    expect(resolveResourcePolicyKind({ customType: "3" }).kind).toBe("categories");
    expect(resolveResourcePolicyKind({ kind: "categories" }).numeric).toBe(3);
    expect(resolveResourcePolicyKind({ customType: 13 }).kind).toBe("resourcePoliciesCombined");
    expect(resolveResourcePolicyKind({ customType: "13" }).kind).toBe("resourcePoliciesCombined");
    expect(resolveResourcePolicyKind({ kind: "resourcePoliciesCombined" }).customType).toBe(
      "e_custom_category_type_resource_policies_combined",
    );

    expect(customTypeMatchesKind(13, categories)).toBe(false);
    expect(customTypeMatchesKind("13", categories)).toBe(false);
    expect(customTypeMatchesKind(3, combined)).toBe(false);
    expect(customTypeMatchesKind(13, combined)).toBe(true);
    expect(customTypeMatchesKind(undefined, categories)).toBe(true);

    const categoriesBody = buildCreateResourcePolicySettings({
      customCategoryId: 1,
      customCategoryNumber: 1001,
      name: "Categories",
      type: "categories",
      customType: 3,
      settings: {},
    });
    const combinedBody = buildCreateResourcePolicySettings({
      customCategoryId: 1,
      customCategoryNumber: 1001,
      name: "Combined",
      type: "categories",
      customType: 13,
      settings: {},
    });
    expect(categoriesBody.body.customType).toBe("e_custom_category_type_categories");
    expect(categoriesBody.verify.wireKind?.numeric).toBe(3);
    expect(combinedBody.body.customType).toBe("e_custom_category_type_resource_policies_combined");
    expect(combinedBody.verify.wireKind?.numeric).toBe(13);
    expect(JSON.stringify(categoriesBody.body)).not.toContain('"customType":13');
    expect(JSON.stringify(combinedBody.body)).not.toContain('"customType":3');
  });

  it("accepts urlList enum alias and still sends the canonical enum", () => {
    expect(resolveResourcePolicyKind({ customType: URL_LIST_ALIAS }).kind).toBe("urlList");
    expect(resolveResourcePolicyKind({ kind: URL_LIST_ALIAS }).customType).toBe(URL_LIST_ENUM);
    expect(resolveResourcePolicyKind({ kind: "urlList", customType: 6 }).numeric).toBe(6);
    expect(resolveResourcePolicyKind({ customType: URL_LIST_ENUM, kind: "6" }).customType).toBe(
      URL_LIST_ENUM,
    );

    const built = buildCreateResourcePolicySettings({
      customCategoryId: 1,
      customCategoryNumber: 1001,
      name: "URL list",
      type: "categories",
      kind: 6,
      settings: { policyAction: 0 },
    });
    expect(built.body.customType).toBe(URL_LIST_ENUM);
    expect(JSON.stringify(built.body)).not.toContain('"customType":6');
    expect(built.verify.wireKind?.kind).toBe("urlList");
  });

  it("rejects values outside the allowlist and conflicting selectors", () => {
    expect(() => resolveResourcePolicyKind({ customType: 2 })).toThrow(/allowlist/);
    expect(() => resolveResourcePolicyKind({ customType: 9 })).toThrow(/categories is 3/);
    expect(() => resolveResourcePolicyKind({ kind: "youtubelist" })).toThrow(/not on the Resource Policy/);
    expect(() => resolveResourcePolicyKind({ kind: "urlList", type: "categories" })).toThrow(/does not match/);
    expect(() => resolveResourcePolicyKind({ customType: 10, kind: "urlList" })).toThrow(/does not match/);
    expect(resolveResourcePolicyKind({ kind: "allowlist", type: "allowlist" }).kind).toBe("allowlist");
    expect(resolveResourcePolicyKind({}).kind).toBe("categories");
  });

  it("rejects destinations on non-bitmap kinds and still rejects allowlist bitmaps", () => {
    expect(() =>
      buildCreateResourcePolicySettings({
        customCategoryId: 1,
        customCategoryNumber: 1001,
        name: "URL list",
        type: "categories",
        customType: URL_LIST_ENUM,
        destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
        settings: {},
      }),
    ).toThrow(IbossPolicyTypeError);

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

    const combined = buildCreateResourcePolicySettings({
      customCategoryId: 1,
      customCategoryNumber: 1001,
      name: "Combined",
      type: "categories",
      kind: "resourcePoliciesCombined" satisfies ResourcePolicyKind,
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      settings: {},
    });
    expect(combined.body.customType).toBe("e_custom_category_type_resource_policies_combined");
    expect(combined.verify.destinations?.bits).toEqual([110]);
  });

  it("overlays a live PUT echo for any allowlisted numeric", () => {
    const annotation = annotateResourcePolicyKind(RESOURCE_POLICY_KIND_WIRE.aiPolicy);
    expect(annotation.echoedByGateway).toBe(false);
    expect(
      applyGatewayCreateEcho(annotation, {
        customCategoryId: 4,
        customType: 14,
        enum: "e_custom_category_type_ai_policy",
        listKind: "resourcePolicy",
        message: "Successfully added custom category.",
      }),
    ).toEqual({
      kind: "aiPolicy",
      customType: "e_custom_category_type_ai_policy",
      numeric: 14,
      listKind: "resourcePolicy",
      echoedByGateway: true,
    });
    expect(applyGatewayCreateEcho(annotation, { customCategoryId: 4, successful: true })).toEqual(
      annotation,
    );

    const viewed = viewCreatedResourcePolicy(
      { customCategoryId: 5, customCategoryNumber: 1005, customCategoryName: "Combined", customType: 13 },
      "summary",
    );
    expect(viewed.wireKind.kind).toBe("resourcePoliciesCombined");
    expect(viewed.wireKind.numeric).toBe(13);
    expect(viewed.observedCustomType).toBe(13);
  });
});
