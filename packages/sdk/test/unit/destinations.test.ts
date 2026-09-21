import { describe, expect, it } from "vitest";
import { IbossPolicyTypeError } from "../../src/client/errors.js";
import {
  AI_SERVICES_BIT,
  CATEGORIES_BITMAP_LENGTH,
  CATEGORIES_SELECTED_TYPE,
  collectDestinationVerifyFailures,
  decodeDestinations,
  destinationTypeConflict,
  encodeDestinationBits,
  isCategoryBitSet,
  padCategoriesBitmap,
  prepareDestinationWrite,
} from "../../src/api/destinations.js";
import { emptyCategoriesBitmap } from "../../src/api/policies.js";

describe("categories bitmap (DEVELOP-34925 / 34916)", () => {
  it("encodes Selected Destinations → AI Services as bit 110 + type 0", () => {
    const encoded = encodeDestinationBits({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(encoded.categoriesSelectedType).toBe(CATEGORIES_SELECTED_TYPE.SELECTED);
    expect(encoded.categoriesSelectedType).toBe(0);
    expect(encoded.categories).toHaveLength(CATEGORIES_BITMAP_LENGTH);
    expect(isCategoryBitSet(encoded.categories, AI_SERVICES_BIT)).toBe(true);
    expect(encoded.categories[110]).toBe("1");
    expect(encoded.categories.split("").filter((c) => c === "1")).toHaveLength(1);
  });

  it("rejects selected mode without categories", () => {
    expect(() => encodeDestinationBits({ mode: "selectedWebCategories" })).toThrow(/AI_SERVICES/);
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

  it("encodes allWebCategories as empty bitmap + type 1", () => {
    const encoded = encodeDestinationBits({ mode: "allWebCategories" });
    expect(encoded.categoriesSelectedType).toBe(CATEGORIES_SELECTED_TYPE.ALL);
    expect(encoded.categories).toBe(emptyCategoriesBitmap());
    expect(decodeDestinations(encoded)).toEqual({ mode: "allWebCategories", categories: [] });
  });

  it("pads short bitmaps and treats missing bits as unset", () => {
    expect(padCategoriesBitmap("1")).toHaveLength(400);
    expect(isCategoryBitSet("", AI_SERVICES_BIT)).toBe(false);
    expect(isCategoryBitSet(emptyCategoriesBitmap(), AI_SERVICES_BIT)).toBe(false);
  });

  it("flags allowlist customType as the silent-drop conflict", () => {
    expect(destinationTypeConflict({ customType: 1 })).toMatch(/silently drops/);
    expect(destinationTypeConflict({ customType: "e_custom_category_type_allowlist" })).toMatch(
      /allowlist/,
    );
    expect(destinationTypeConflict({ customType: 3 })).toBeUndefined();
    expect(destinationTypeConflict({ customType: 13 })).toBeUndefined();
    expect(destinationTypeConflict({ categoryType: 13 })).toBeUndefined();
  });

  it("rejects allowlist+categories by default (never silent drop)", () => {
    expect(() =>
      prepareDestinationWrite(
        { customCategoryId: 1114, customType: 1 },
        { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      ),
    ).toThrow(IbossPolicyTypeError);
  });

  it("warns and skips encoding on allowlist when onWrongType is warn", () => {
    const prepared = prepareDestinationWrite(
      { customCategoryId: 1114, customType: 1, categories: "" },
      { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      "warn",
    );
    expect(prepared.skipped).toBe(true);
    expect(prepared.warning).toMatch(/silently drops/);
    expect(prepared.next.categories).toBe("");
    expect(prepared.next.categoriesSelectedType).toBeUndefined();
  });

  it("verify failures name bit 110 and inverted type 0", () => {
    const failures = collectDestinationVerifyFailures(
      { customType: 1, categories: "", categoriesSelectedType: 1 },
      { categoriesSelectedType: 0, bits: [AI_SERVICES_BIT] },
    );
    expect(failures.join(" ")).toMatch(/bit 110/);
    expect(failures.join(" ")).toMatch(/0 = Selected Destinations/);
    expect(failures.join(" ")).toMatch(/silently dropped/);
  });
});
