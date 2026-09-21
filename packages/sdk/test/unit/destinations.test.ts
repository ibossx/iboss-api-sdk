import { describe, expect, it } from "vitest";
import {
  AI_SERVICES_BIT,
  CATEGORIES_SELECTED_TYPE,
  collectDestinationVerifyFailures,
  decodeDestinations,
  destinationTypeConflict,
  encodeDestinationBits,
  isCategoryBitSet,
} from "../../src/api/destinations.js";
import { IbossPolicyTypeError } from "../../src/client/errors.js";
import { assertDestinationsExpressable } from "../../src/api/destinations.js";

describe("typed destinations encode/decode", () => {
  it("encodes AI Services as bit 110 + categoriesSelectedType 0", () => {
    const encoded = encodeDestinationBits({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(encoded.categoriesSelectedType).toBe(CATEGORIES_SELECTED_TYPE.SELECTED);
    expect(encoded.categories.length).toBe(400);
    expect(isCategoryBitSet(encoded.categories, AI_SERVICES_BIT)).toBe(true);
    expect(encoded.categories.replace(/0/g, "")).toBe("1");
  });

  it("decodes bit 110 back to AI_SERVICES", () => {
    const encoded = encodeDestinationBits({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(decodeDestinations(encoded)).toEqual({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
  });

  it("requires categories when mode is selectedWebCategories", () => {
    expect(() => encodeDestinationBits({ mode: "selectedWebCategories" })).toThrow(/AI_SERVICES/);
  });

  it("rejects allowlist + destinations before any write", () => {
    expect(() =>
      assertDestinationsExpressable(
        { customType: "e_custom_category_type_allowlist" },
        { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      ),
    ).toThrow(IbossPolicyTypeError);
    expect(() =>
      assertDestinationsExpressable(
        { customType: 1 },
        { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      ),
    ).toThrow(IbossPolicyTypeError);
    expect(destinationTypeConflict({ customType: 1 })).toMatch(/silently/);
  });

  it("reports verify failures when GET drops the bitmap", () => {
    const failures = collectDestinationVerifyFailures(
      { customType: 1, categories: "" },
      { categoriesSelectedType: 0, bits: [AI_SERVICES_BIT] },
    );
    expect(failures.some((f) => f.includes("bitmap is empty"))).toBe(true);
    expect(failures.some((f) => f.includes("customType"))).toBe(true);
  });
});
