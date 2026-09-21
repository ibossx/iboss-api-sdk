import { describe, expect, it } from "vitest";
import {
  AI_SERVICES_BIT,
  CATEGORIES_BITMAP_LENGTH,
  CATEGORIES_SELECTED_TYPE,
  decodeDestinations,
  destinationTypeConflict,
  encodeDestinationBits,
  isCategoryBitSet,
  padCategoriesBitmap,
} from "../../src/api/destinations.js";
import { emptyCategoriesBitmap } from "../../src/api/policyFields.js";

describe("categories bitmap (DEVELOP-34916)", () => {
  it("encodes Selected Destinations → AI Services as bit 110 + type 0", () => {
    const encoded = encodeDestinationBits({
      mode: "selectedWebCategories",
      categories: ["AI_SERVICES"],
    });
    expect(encoded.categoriesSelectedType).toBe(CATEGORIES_SELECTED_TYPE.SELECTED);
    expect(encoded.categoriesSelectedType).toBe(0);
    expect(encoded.categories).toHaveLength(CATEGORIES_BITMAP_LENGTH);
    expect(isCategoryBitSet(encoded.categories, AI_SERVICES_BIT)).toBe(true);
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
});
