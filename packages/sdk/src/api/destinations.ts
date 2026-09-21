/**
 * Typed destinations for Resource Policy settings (DEVELOP-34925 / 34916 /
 * 34926).
 *
 * Agents must never invent the 400-char `categories` bitmap or the inverted
 * `categoriesSelectedType` enum. Sep 9–10 Bug Replicator traces: the settings
 * POST that stuck used `categoriesSelectedType: 0` (UI “Selected Destinations”)
 * and a 400-char bitmap with **only bit 110** set (AI Services). Allowlist
 * recreate (`customType: 1`) silently drops the bitmap — GET `categories`
 * length 0 — so typed helpers reject that combination.
 *
 * Purpose-named agent body (same shape as PUT …/resourcePolicies/{id}/destinations
 * in DEVELOP-34925):
 *
 *   { mode: "selectedWebCategories", categories: ["AI_SERVICES"] }
 *
 * Wire today is still GET/POST `/json/controls/policyLayers/settings`. Legacy
 * `categories` / `categoriesSelectedType` fields remain for old clients.
 */
import { IbossPolicyTypeError } from "../client/errors.js";
import { emptyCategoriesBitmap } from "./policyFields.js";

/** Ground-truth bit index for the AI Services web category. */
export const AI_SERVICES_BIT = 110;

/** Platform settings bitmap width. */
export const CATEGORIES_BITMAP_LENGTH = 400;

/**
 * UI “Selected Destinations”. Confirmed: 0, not 1.
 * “All web categories” is the inverted value (1).
 */
export const CATEGORIES_SELECTED_TYPE = {
  SELECTED: 0,
  ALL: 1,
} as const;

/** Named web categories the SDK can encode today. Extend as the catalog is published. */
export const WEB_CATEGORY_BITS = {
  AI_SERVICES: AI_SERVICES_BIT,
} as const;

export type WebCategory = keyof typeof WEB_CATEGORY_BITS;

export type DestinationMode = "selectedWebCategories" | "allWebCategories";

/**
 * Agent-facing destinations body. Same shape as
 * `putResourcePolicyDestinations` (DEVELOP-34925).
 */
export interface DestinationSpec {
  mode: DestinationMode;
  /** Required when mode is selectedWebCategories. */
  categories?: WebCategory[];
}

export type ResourcePolicyDestinations = {
  mode: DestinationMode;
  categories: WebCategory[];
};

/** GET `customType` / `categoryType` values that still carry a bitmap. */
export const CATEGORIES_CUSTOM_TYPES = new Set<string | number>([
  3,
  13,
  "3",
  "13",
  "e_custom_category_type_categories",
]);

/** Allowlist / blocklist types — bitmap is unexpressable (silent drop). */
export const LIST_CUSTOM_TYPES = new Set<string | number>([
  1,
  "1",
  "e_custom_category_type_allowlist",
  "e_custom_category_type_blacklist",
  0,
  "0",
]);

export function padCategoriesBitmap(bitmap: string): string {
  if (bitmap.length >= CATEGORIES_BITMAP_LENGTH) return bitmap.slice(0, CATEGORIES_BITMAP_LENGTH);
  return bitmap.padEnd(CATEGORIES_BITMAP_LENGTH, "0");
}

export function setCategoryBit(bitmap: string, bit: number): string {
  if (bit < 0 || bit >= CATEGORIES_BITMAP_LENGTH) {
    throw new Error(`Category bit ${bit} is out of range (0–${CATEGORIES_BITMAP_LENGTH - 1}).`);
  }
  const chars = padCategoriesBitmap(bitmap).split("");
  chars[bit] = "1";
  return chars.join("");
}

export function isCategoryBitSet(bitmap: string | undefined, bit: number): boolean {
  if (typeof bitmap !== "string" || bitmap.length <= bit) return false;
  return bitmap[bit] === "1";
}

export function isCategoriesCustomType(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "string") {
    return CATEGORIES_CUSTOM_TYPES.has(value);
  }
  return false;
}

export function isListCustomType(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "string") {
    return LIST_CUSTOM_TYPES.has(value);
  }
  return false;
}

/** Prefer `customType`, fall back to `categoryType` (both appear on GET). */
export function readCustomType(settings: Record<string, unknown>): unknown {
  return settings.customType ?? settings.categoryType;
}

/**
 * Allowlist/blocklist + categories is the silent-drop footgun. Returns a
 * human-readable reason, or undefined when destinations are expressable.
 */
export function destinationTypeConflict(settings: Record<string, unknown>): string | undefined {
  const customType = readCustomType(settings);
  if (customType === undefined || customType === null) return undefined;
  if (isCategoriesCustomType(customType)) return undefined;
  if (isListCustomType(customType)) {
    return (
      `This policy is customType ${JSON.stringify(customType)} (allowlist/blocklist). ` +
      `AI Services destinations require a categories-type layer (GET customType 3 or 13) ` +
      `and a 400-char bitmap with bit ${AI_SERVICES_BIT} set. Allowlist recreate silently ` +
      `drops that bitmap (GET categories length 0). Delete this layer and recreate with ` +
      `customType "e_custom_category_type_categories" — do not try to patch the bitmap onto an allowlist.`
    );
  }
  return undefined;
}

export function encodeDestinationBits(spec: DestinationSpec): {
  categories: string;
  categoriesSelectedType: number;
} {
  if (spec.mode === "allWebCategories") {
    return {
      categories: emptyCategoriesBitmap(),
      categoriesSelectedType: CATEGORIES_SELECTED_TYPE.ALL,
    };
  }

  const names = spec.categories ?? [];
  if (names.length === 0) {
    throw new Error(
      'destinations ({ mode: "selectedWebCategories" }) requires categories, e.g. ["AI_SERVICES"].',
    );
  }
  let bitmap = emptyCategoriesBitmap();
  for (const name of names) {
    const bit = WEB_CATEGORY_BITS[name];
    if (bit === undefined) {
      throw new Error(
        `Unknown web category ${JSON.stringify(name)}. Known: ${Object.keys(WEB_CATEGORY_BITS).join(", ")}.`,
      );
    }
    bitmap = setCategoryBit(bitmap, bit);
  }
  return {
    categories: bitmap,
    categoriesSelectedType: CATEGORIES_SELECTED_TYPE.SELECTED,
  };
}

export function decodeDestinations(settings: Record<string, unknown>): ResourcePolicyDestinations {
  const selectedType = Number(settings.categoriesSelectedType);
  const bitmap = typeof settings.categories === "string" ? settings.categories : "";
  const categories = (Object.entries(WEB_CATEGORY_BITS) as [WebCategory, number][])
    .filter(([, bit]) => isCategoryBitSet(bitmap, bit))
    .map(([name]) => name);
  return {
    mode: selectedType === CATEGORIES_SELECTED_TYPE.ALL ? "allWebCategories" : "selectedWebCategories",
    categories,
  };
}

export function aiServicesDestination(): DestinationSpec {
  return { mode: "selectedWebCategories", categories: ["AI_SERVICES"] };
}

export interface DestinationVerifyExpectation {
  categoriesSelectedType: number;
  bits: number[];
}

export function collectDestinationVerifyFailures(
  actual: Record<string, unknown>,
  expected: DestinationVerifyExpectation,
): string[] {
  const failures: string[] = [];
  const customType = readCustomType(actual);
  if (customType !== undefined && customType !== null && !isCategoriesCustomType(customType)) {
    failures.push(
      `customType is ${JSON.stringify(customType)}, expected categories-shaped 3 or 13 ` +
        `(allowlist is 1 — the bitmap is silently dropped)`,
    );
  }
  if (Number(actual.categoriesSelectedType) !== expected.categoriesSelectedType) {
    failures.push(
      `categoriesSelectedType is ${JSON.stringify(actual.categoriesSelectedType)}, ` +
        `expected ${expected.categoriesSelectedType}` +
        (expected.categoriesSelectedType === CATEGORIES_SELECTED_TYPE.SELECTED
          ? " (0 = Selected Destinations)"
          : ""),
    );
  }
  const bitmap = typeof actual.categories === "string" ? actual.categories : "";
  for (const bit of expected.bits) {
    if (!isCategoryBitSet(bitmap, bit)) {
      failures.push(
        `categories bitmap bit ${bit} is not set` +
          (bit === AI_SERVICES_BIT ? " (AI Services)" : "") +
          (bitmap.length === 0 ? " — bitmap is empty (silent drop)" : ` (length ${bitmap.length})`),
      );
    }
  }
  return failures;
}

/** Throw before any write when destinations cannot be expressed on this type. */
export function assertDestinationsExpressable(
  settings: Record<string, unknown>,
  spec: DestinationSpec | undefined,
): void {
  if (!spec) return;
  const conflict = destinationTypeConflict(settings);
  if (!conflict) return;
  throw new IbossPolicyTypeError(conflict, {
    customCategoryId:
      settings.customCategoryId === undefined ? undefined : Number(settings.customCategoryId),
    customType: readCustomType(settings),
  });
}
