/**
 * Generated settings-field families that the platform expects on every
 * **full-replace** policy-layer / resource-policy settings POST.
 *
 * Plain POST `/json/controls/policyLayers/settings` applies gateway defaults
 * for omitted fields. Sparse native PATCH and POST `?merge=1` do **not**
 * need these families — only the get→merge→full-POST fallback does.
 */

/** Inclusive upper bound of catN / prioN / bypassSslMitmN (111 members). */
export const POLICY_FIELD_FAMILY_MAX = 110;

const FAMILY_KEY = /^(cat|prio|bypassSslMitm)\d+$/;

/** The 400-character all-zeros categories bitmap used in settings payloads. */
export function emptyCategoriesBitmap(): string {
  return "0".repeat(400);
}

/** Fields cat0..cat110 = 3 (category action defaults). */
export function generateCategoryFields(value = 3): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) fields[`cat${i}`] = value;
  return fields;
}

/** Fields prio0..prio110 = 0. */
export function generatePriorityFields(value = 0): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) fields[`prio${i}`] = value;
  return fields;
}

/** Fields bypassSslMitm0..bypassSslMitm110 = 0. */
export function generateBypassSslMitmFields(value = 0): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) fields[`bypassSslMitm${i}`] = value;
  return fields;
}

export function isGeneratedSettingsFamilyKey(key: string): boolean {
  return FAMILY_KEY.test(key) || key === "categories";
}

export function hasFieldFamily(
  settings: Record<string, unknown>,
  prefix: "cat" | "prio" | "bypassSslMitm",
): boolean {
  for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) {
    if (settings[`${prefix}${i}`] === undefined) return false;
  }
  return true;
}

/**
 * Ensure the three generated families and a 400-char bitmap are present.
 * Existing values win — this never overwrites a field the caller or GET
 * already supplied. Used only for full-replace POST bodies.
 */
export function ensureFieldFamilies(settings: Record<string, unknown>): Record<string, unknown> {
  const categories =
    typeof settings.categories === "string" ? settings.categories : emptyCategoriesBitmap();
  return {
    ...generateCategoryFields(),
    ...generatePriorityFields(),
    ...generateBypassSslMitmFields(),
    ...settings,
    categories,
  };
}
