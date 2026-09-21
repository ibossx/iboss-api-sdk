/**
 * Generated settings-field families that the platform expects on every
 * policy-layer / resource-policy settings POST.
 *
 * Gateway POST `/json/controls/policyLayers/settings` applies defaults for
 * omitted fields (same class as DEVELOP-34251 / DEVELOP-32482). Create and
 * get-merge-post paths therefore send a complete blob, including every
 * catN / prioN / bypassSslMitmN member.
 */

/** Inclusive upper bound of catN / prioN / bypassSslMitmN (111 members). */
export const POLICY_FIELD_FAMILY_MAX = 110;

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
  return /^(cat|prio|bypassSslMitm)\d+$/.test(key) || key === "categories";
}

/**
 * Ensure the three generated families and a 400-char bitmap are present.
 * Existing values win — this never overwrites a field the caller or GET
 * already supplied.
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
