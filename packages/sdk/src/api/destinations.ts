/**
 * Typed destinations for Resource Policy settings (DEVELOP-34925 / 34916).
 *
 * Agents must never invent the 400-char `categories` bitmap or the inverted
 * `categoriesSelectedType` enum. Sep 9–10 Bug Replicator traces: the settings
 * POST that stuck used `categoriesSelectedType: 0` (UI “Selected Destinations”)
 * and a 400-char bitmap with **only bit 110** set (AI Services). Allowlist
 * recreate (`customType: 1`) silently drops the bitmap — GET `categories`
 * length 0 — so typed helpers reject that combination.
 *
 * Purpose-named agent API:
 *   PUT …/resourcePolicies/{id}/destinations
 *   { mode: "selectedWebCategories", categories: ["AI_SERVICES"] }
 *
 * Wire today is still GET/POST `/json/controls/policyLayers/settings`. Legacy
 * `categories` / `categoriesSelectedType` fields remain for old clients.
 *
 * Allowlist (customType 1 / `e_custom_category_type_allowlist`, and the same
 * mode under `destinationMode` or `categoryType`) plus a non-empty categories
 * bitmap does **not** fail on the wire. Gateway POST returns 200 and silently
 * drops the bitmap (`categories` length 0), including AI Services bit 110.
 * Confirmed on test-gateway-14800 (2026-09-22). `assertCategoriesBitmapExpressable`
 * is the guard — it throws `IbossPolicyTypeError` before send.
 */
import { IbossPolicyTypeError } from "../client/errors.js";

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

/** Agent-facing body for PUT …/resourcePolicies/{id}/destinations. */
export interface DestinationSpec {
  mode: DestinationMode;
  /** Required when mode is selectedWebCategories. */
  categories?: WebCategory[];
}

export type ResourcePolicyDestinations = {
  mode: DestinationMode;
  categories: WebCategory[];
};

export type WrongTypeBehavior = "reject" | "warn";

/** GET `customType` / `categoryType` values that still carry a bitmap. */
export const CATEGORIES_CUSTOM_TYPES = new Set<string | number>([
  3,
  13,
  "3",
  "13",
  "e_custom_category_type_categories",
  "categories",
]);

/**
 * Allowlist / blocklist destination modes — a categories bitmap is unexpressable.
 * Gateway POST does not reject; it returns 200 and drops the bitmap.
 * Friendly names (`allowlist`) are included because agents send those as the mode.
 */
export const LIST_CUSTOM_TYPES = new Set<string | number>([
  1,
  "1",
  "e_custom_category_type_allowlist",
  "allowlist",
  "e_custom_category_type_blacklist",
  "blocklist",
  "blacklist",
  0,
  "0",
]);

export function emptyDestinationBitmap(): string {
  return "0".repeat(CATEGORIES_BITMAP_LENGTH);
}

export function padCategoriesBitmap(bitmap: string): string {
  if (bitmap.length >= CATEGORIES_BITMAP_LENGTH) return bitmap.slice(0, CATEGORIES_BITMAP_LENGTH);
  return bitmap.padEnd(CATEGORIES_BITMAP_LENGTH, "0");
}

export function setCategoryBit(bitmap: string, bit: number): string {
  if (bit < 0 || bit >= CATEGORIES_BITMAP_LENGTH) {
    throw new Error(
      `Category bit ${bit} is out of range (0–${CATEGORIES_BITMAP_LENGTH - 1}).`,
    );
  }
  const chars = padCategoriesBitmap(bitmap).split("");
  chars[bit] = "1";
  return chars.join("");
}

export function isCategoryBitSet(bitmap: string | undefined, bit: number): boolean {
  if (typeof bitmap !== "string" || bitmap.length <= bit) return false;
  return bitmap[bit] === "1";
}

/** Lowercase wire/agent token for a policy destination mode (`1` → `"1"`). */
export function policyTypeToken(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isCategoriesCustomType(value: unknown): boolean {
  const token = policyTypeToken(value);
  if (token === undefined) return false;
  return (
    CATEGORIES_CUSTOM_TYPES.has(token) ||
    CATEGORIES_CUSTOM_TYPES.has(value as string | number) ||
    token === "e_custom_category_type_categories" ||
    token === "categories"
  );
}

export function isListCustomType(value: unknown): boolean {
  const token = policyTypeToken(value);
  if (token === undefined) return false;
  return (
    LIST_CUSTOM_TYPES.has(token) ||
    LIST_CUSTOM_TYPES.has(value as string | number) ||
    token === "allowlist" ||
    token === "blocklist" ||
    token === "blacklist" ||
    token === "e_custom_category_type_allowlist" ||
    token === "e_custom_category_type_blacklist"
  );
}

/**
 * Allowlist, blocklist, or the same mode on `destinationMode` / `categoryType`.
 * Any one list token is enough — the gateway drops the bitmap for that layer.
 */
export function readListDestinationMode(settings: Record<string, unknown>): unknown {
  for (const value of [settings.customType, settings.categoryType, settings.destinationMode]) {
    if (isListCustomType(value)) return value;
  }
  return undefined;
}

/**
 * True when `categories` would ask the gateway to keep a selection.
 * A 400-char all-zero bitmap is the settings default and is not a selection.
 * Any other non-empty bitmap — including AI Services bit 110 — is.
 * Agent arrays such as `["AI_SERVICES"]` count too.
 */
export function categoriesBitmapSelects(categories: unknown): boolean {
  if (Array.isArray(categories)) {
    return categories.some((entry) => entry != null && String(entry).trim() !== "");
  }
  if (typeof categories !== "string") return false;
  const trimmed = categories.trim();
  if (trimmed.length === 0) return false;
  return !/^0+$/.test(trimmed);
}

/** Prefer `customType`, fall back to `categoryType` (both appear on GET). */
export function readCustomType(settings: Record<string, unknown>): unknown {
  return settings.customType ?? settings.categoryType;
}

/**
 * Allowlist/blocklist + categories is the silent-drop footgun. Returns a
 * human-readable reason, or undefined when destinations are expressable.
 *
 * The gateway does not reject this combination. POST
 * `/json/controls/policyLayers/settings` returns 200 and the following GET
 * has `categories` length 0 (bit 110 included). Confirmed 2026-09-22 on
 * test-gateway-14800. Callers must throw before send.
 */
export function destinationTypeConflict(settings: Record<string, unknown>): string | undefined {
  const listMode = readListDestinationMode(settings);
  if (listMode === undefined) return undefined;
  return (
    `This policy is destination mode ${JSON.stringify(listMode)} (allowlist/blocklist). ` +
    `Gateway POST /json/controls/policyLayers/settings returns 200 and silently drops a ` +
    `categories bitmap (GET categories length 0), including AI Services bit ${AI_SERVICES_BIT}. ` +
    `There is no wire reject — the SDK throws before send. Delete this layer and recreate ` +
    `with customType "e_custom_category_type_categories" — do not patch the bitmap onto an allowlist.`
  );
}

/**
 * Throw `IbossPolicyTypeError` before POST when an allowlist (or blocklist /
 * equivalent list destination mode) is combined with a non-empty categories
 * bitmap or AI Services bit 110.
 *
 * All-zero bitmaps are allowed: full settings POSTs always carry that
 * placeholder. The gateway silent-drops real selections (200, `categories`
 * length 0) — this function is the guard.
 */
export function assertCategoriesBitmapExpressable(settings: Record<string, unknown>): void {
  if (!categoriesBitmapSelects(settings.categories)) return;
  const conflict = destinationTypeConflict(settings);
  if (!conflict) return;
  const customCategoryId =
    settings.customCategoryId === undefined || settings.customCategoryId === null
      ? undefined
      : Number(settings.customCategoryId);
  throw new IbossPolicyTypeError(conflict, {
    customCategoryId: Number.isFinite(customCategoryId) ? customCategoryId : undefined,
    customType: readListDestinationMode(settings) ?? readCustomType(settings),
  });
}

export function encodeDestinationBits(spec: DestinationSpec): {
  categories: string;
  categoriesSelectedType: number;
} {
  if (spec.mode === "allWebCategories") {
    return {
      categories: emptyDestinationBitmap(),
      categoriesSelectedType: CATEGORIES_SELECTED_TYPE.ALL,
    };
  }

  const names = spec.categories ?? [];
  if (names.length === 0) {
    throw new Error(
      'putResourcePolicyDestinations({ mode: "selectedWebCategories" }) requires categories, e.g. ["AI_SERVICES"].',
    );
  }
  let bitmap = emptyDestinationBitmap();
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

export interface PreparedDestinationWrite {
  next: Record<string, unknown>;
  verify: DestinationVerifyExpectation;
  warning?: string;
  skipped: boolean;
}

/**
 * Overlay typed destinations onto a GET settings blob. Encodes bit 110 +
 * `categoriesSelectedType: 0` for AI Services. Never silent-drops: reject
 * (default) or warn+skip when the layer is allowlist/blocklist.
 */
export function prepareDestinationWrite(
  current: Record<string, unknown>,
  spec: DestinationSpec,
  onWrongType: WrongTypeBehavior = "reject",
): PreparedDestinationWrite {
  const conflict = destinationTypeConflict(current);
  if (conflict) {
    if (onWrongType === "reject") {
      throw new IbossPolicyTypeError(conflict, {
        customCategoryId:
          current.customCategoryId === undefined ? undefined : Number(current.customCategoryId),
        customType: readCustomType(current),
      });
    }
    return {
      next: current,
      verify: { categoriesSelectedType: CATEGORIES_SELECTED_TYPE.SELECTED, bits: [] },
      warning: conflict,
      skipped: true,
    };
  }

  const encoded = encodeDestinationBits(spec);
  const bits: number[] = [];
  if (spec.mode === "selectedWebCategories") {
    for (const name of spec.categories ?? []) {
      bits.push(WEB_CATEGORY_BITS[name]);
    }
  }
  return {
    next: { ...current, ...encoded },
    verify: {
      categoriesSelectedType: encoded.categoriesSelectedType,
      bits,
    },
    skipped: false,
  };
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
