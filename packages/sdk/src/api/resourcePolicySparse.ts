/**
 * Purpose-named sparse GET/PATCH for Resource Policy settings
 * (DEVELOP-34924).
 *
 * Agent-facing surface (equivalent of GET/PATCH
 * `…/resourcePolicies/{id}/settings`):
 *   GET  /json/controls/policyLayers/settings?customCategoryId=
 *   PATCH /json/controls/policyLayers/settings?customCategoryId=   (DEVELOP-34921)
 *   POST  /json/controls/policyLayers/settings?merge=1             (same)
 *
 * Agents send only changed fields. Omitted keys stay unchanged — callers
 * never invent catN / prioN / bypassSslMitmN families or the 400-char
 * bitmap. Native Gateway merge (DEVELOP-34921, live on lab gateways) is
 * preferred. Auto mode does **not** send a sparse POST `?merge=1` on
 * unknown gateways (an old node would treat it as wipe-on-omit). If PATCH
 * is 404/405, fall back to the DEVELOP-34914 get→deep-merge→full POST.
 *
 * `updateLayerSettings(fullBlob)` remains the full-replace API.
 */
import { IbossApiError } from "../client/errors.js";
import {
  ensureFieldFamilies,
  isGeneratedSettingsFamilyKey,
} from "./policyFields.js";

/** Today's gateway wire path. There is no distinct resourcePolicies/{id}/settings route yet. */
export const RESOURCE_POLICY_SETTINGS_WIRE_PATH = "/json/controls/policyLayers/settings";

/**
 * How a sparse update is sent.
 *
 * - `auto` — PATCH (34921); on 404/405, get→merge→full POST (34914)
 * - `native-patch` — HTTP PATCH only
 * - `merge-post` — POST `?merge=1` (opt-in; unsafe on pre-34921 gateways)
 * - `get-merge-post` — GET, deep-merge, full POST (34914 fallback)
 */
export type ResourcePolicySettingsTransport =
  | "auto"
  | "native-patch"
  | "merge-post"
  | "get-merge-post";

export interface ResourcePolicySettingsPatch {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC 7396 JSON Merge Patch. `null` removes a key. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergePatch(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Shallow/deep merge used by the 34914 fallback. `undefined` is skipped; `null` is kept. */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Default GET view: drop generated families so agents never round-trip
 * catN / prioN / bypassSslMitmN or the 400-char bitmap.
 */
export function omitGeneratedSettingsFamilies(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!isGeneratedSettingsFamilyKey(key)) out[key] = value;
  }
  return out;
}

export function viewResourcePolicySettings(
  settings: Record<string, unknown>,
  view: "summary" | "full" = "summary",
): Record<string, unknown> {
  return view === "full" ? settings : omitGeneratedSettingsFamilies(settings);
}

/**
 * Build the sparse body. `undefined` keys are dropped. Generated families
 * are allowed only when the caller set them explicitly — they are never
 * invented here.
 */
export function sparseSettingsBody(
  customCategoryId: number,
  patch: ResourcePolicySettingsPatch,
): Record<string, unknown> {
  const body: Record<string, unknown> = { customCategoryId };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === "customCategoryId") continue;
    body[key] = value;
  }
  return body;
}

export function assertSparsePatch(patch: ResourcePolicySettingsPatch): void {
  if (!isPlainObject(patch)) {
    throw new TypeError("patchResourcePolicySettings requires a plain object patch");
  }
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (keys.length === 0) {
    throw new TypeError(
      "patchResourcePolicySettings requires at least one field to change. " +
        "Do not POST a full settings blob — use updateLayerSettings() for full replace.",
    );
  }
}

export function isNativePatchUnsupported(error: unknown): boolean {
  return error instanceof IbossApiError && (error.status === 404 || error.status === 405);
}

function isResourcePolicy(settings: Record<string, unknown>): boolean {
  return settings.isZeroTrustResourcePolicy === 1 || settings.isZeroTrustResourcePolicy === "1";
}

/**
 * DEVELOP-34914 fallback body: GET blob + patch, families filled so a
 * full-replace POST cannot Gateway-default omitted catN / prioN / bypassSslMitmN.
 */
export function mergeResourcePolicySettingsForFallback(
  current: Record<string, unknown>,
  patch: ResourcePolicySettingsPatch,
): Record<string, unknown> {
  let next = deepMerge(current, sparseSettingsBody(Number(current.customCategoryId) || 0, patch));
  next = ensureFieldFamilies(next);
  if (isResourcePolicy(next) && next.dlpPolicyMethod === undefined) {
    next.dlpPolicyMethod = 2;
  }
  return next;
}

export function collectSparseVerifyFailures(
  actual: Record<string, unknown>,
  patch: ResourcePolicySettingsPatch,
): string[] {
  const failures: string[] = [];
  for (const [key, expected] of Object.entries(patch)) {
    if (expected === undefined || expected === null) continue;
    if (isPlainObject(expected)) continue;
    if (!valuesEqual(actual[key], expected)) {
      failures.push(`${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(expected)}`);
    }
  }
  return failures;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof expected === "number" && Number(actual) === expected) return true;
  if (typeof expected === "string" && String(actual) === expected) return true;
  if (typeof expected === "boolean" && Boolean(actual) === expected) return true;
  return false;
}
