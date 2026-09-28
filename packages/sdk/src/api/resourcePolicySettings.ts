/**
 * GET → deep-merge → full POST for Resource Policy settings when native
 * PATCH is unavailable.
 *
 * Wire path:
 *   GET  /json/controls/policyLayers/settings?customCategoryId=…
 *   POST /json/controls/policyLayers/settings   body = full merged object
 *
 * A plain gateway POST applies defaults for missing fields, so the POST
 * body must round-trip the entire GET blob including catN / prioN /
 * bypassSslMitmN. Omitted patch keys keep prior values. TOCTOU between
 * GET and POST is accepted on this fallback path.
 *
 * POST success (including empty saveIgnoredEntries) is not persistence —
 * callers re-GET and verify.
 */
import { encodeAiRiskEngines, type AiRiskEnginesInput } from "./aiRiskEngines.js";
import {
  AI_SERVICES_BIT,
  CATEGORIES_SELECTED_TYPE,
  decodeDestinations,
  destinationTypeConflict,
  encodeDestinationBits,
  isCategoryBitSet,
  isCategoriesCustomType,
  readCustomType,
  type DestinationSpec,
} from "./destinations.js";
import { IbossPolicyTypeError } from "../client/errors.js";
import { ensureFieldFamilies } from "./policyFields.js";

export type WrongTypeBehavior = "reject" | "warn";

export interface ResourcePolicyPatch {
  /** Typed destinations — never send `categories` / categoriesSelectedType yourself. */
  destinations?: DestinationSpec;
  aiRiskEnabled?: number | boolean;
  aiRiskEngines?: AiRiskEnginesInput;
  aiRiskMonitoringMessage?: string;
  aiRiskMonitoringMessageEnabled?: number | boolean;
  aiRiskMonitoringMessageTitle?: string;
  linkPolicyToAllSubjects?: number | boolean;
  dlpPolicyMethod?: number;
  /**
   * Reserved. Families always round-trip: Gateway POST defaults omitted
   * catN / prioN / bypassSslMitmN, so the SDK never sends a partial blob.
   */
  advanced?: boolean;
  /** Default reject — allowlist+categories is a silent bitmap drop. */
  onWrongType?: WrongTypeBehavior;
  [key: string]: unknown;
}

export interface ResourcePolicySettingsSummary {
  customCategoryId: number;
  customCategoryNumber?: number;
  customCategoryName?: string;
  kind: "resource" | "layer";
  enabled: boolean;
  customType: unknown;
  destinations: ReturnType<typeof decodeDestinations>;
  aiRisk: {
    enabled: boolean;
    engines?: string;
    monitoringMessage?: string;
    monitoringMessageEnabled?: boolean;
    monitoringMessageTitle?: string;
  };
  groups: {
    linkPolicyToAllSubjects: boolean;
    associatedGroups?: string;
  };
  dlpPolicyMethod?: unknown;
}

export type ResourcePolicySettingsView = ResourcePolicySettingsSummary | Record<string, unknown>;

export interface MergeResult {
  next: Record<string, unknown>;
  verify: VerifyExpectation;
  warning?: string;
}

export interface VerifyExpectation {
  categoriesSelectedType?: number;
  bits: number[];
  fields: Record<string, unknown>;
  requireCategoriesType: boolean;
}

const META_KEYS = new Set(["destinations", "advanced", "onWrongType"]);

const FLAG_KEYS = new Set([
  "aiRiskEnabled",
  "aiRiskMonitoringMessageEnabled",
  "linkPolicyToAllSubjects",
  "policyEnabled",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

function asFlag(value: number | boolean): number {
  return value === true || value === 1 ? 1 : 0;
}

function normalizePatchFields(patch: ResourcePolicyPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || META_KEYS.has(key)) continue;
    if (key === "aiRiskEngines" && value !== null) {
      fields.aiRiskEngines = encodeAiRiskEngines(value as AiRiskEnginesInput | string);
      continue;
    }
    if (FLAG_KEYS.has(key) && (typeof value === "boolean" || value === 0 || value === 1)) {
      fields[key] = asFlag(value as number | boolean);
      continue;
    }
    fields[key] = value;
  }
  return fields;
}

function isResourcePolicy(settings: Record<string, unknown>): boolean {
  return settings.isZeroTrustResourcePolicy === 1 || settings.isZeroTrustResourcePolicy === "1";
}

/**
 * Deep-merge `patch` onto the GET blob. Omitted keys keep prior values.
 * Always emits a full object (families included) for the existing POST.
 * Throws on allowlist+categories when onWrongType is reject (the default).
 */
export function mergeResourcePolicySettings(
  current: Record<string, unknown>,
  patch: ResourcePolicyPatch,
): MergeResult {
  const onWrongType = patch.onWrongType ?? "reject";
  let warning: string | undefined;

  if (patch.destinations) {
    const conflict = destinationTypeConflict(current);
    if (conflict) {
      if (onWrongType === "reject") {
        throw new IbossPolicyTypeError(conflict, {
          customCategoryId:
            current.customCategoryId === undefined ? undefined : Number(current.customCategoryId),
          customType: readCustomType(current),
        });
      }
      warning = conflict;
    }
  }

  const fieldPatch = normalizePatchFields(patch);
  let next = deepMerge(current, fieldPatch);

  if (patch.destinations && !warning) {
    const encoded = encodeDestinationBits(patch.destinations);
    next = { ...next, ...encoded };
  }

  // Always POST a complete blob. Prior family values win; fill only gaps.
  next = ensureFieldFamilies(next);

  // Fill dlpPolicyMethod only when GET+patch both omitted it — do not
  // overwrite a prior value (omit-safe).
  if (isResourcePolicy(next) && next.dlpPolicyMethod === undefined) {
    next.dlpPolicyMethod = 2;
  }

  const verify: VerifyExpectation = {
    bits: [],
    fields: { ...fieldPatch },
    requireCategoriesType: Boolean(patch.destinations && !warning),
  };

  if (patch.destinations && !warning) {
    const encoded = encodeDestinationBits(patch.destinations);
    verify.categoriesSelectedType = encoded.categoriesSelectedType;
    if (patch.destinations.mode === "selectedWebCategories") {
      for (const name of patch.destinations.categories ?? []) {
        if (name === "AI_SERVICES") verify.bits.push(AI_SERVICES_BIT);
      }
    }
    verify.fields.categoriesSelectedType = encoded.categoriesSelectedType;
  }

  if (isResourcePolicy(next) && fieldPatch.dlpPolicyMethod === undefined && next.dlpPolicyMethod === 2) {
    verify.fields.dlpPolicyMethod = 2;
  }

  return { next, verify, warning };
}

export function collectVerifyFailures(
  actual: Record<string, unknown>,
  expected: VerifyExpectation,
): string[] {
  const failures: string[] = [];
  if (expected.requireCategoriesType) {
    const customType = readCustomType(actual);
    if (!isCategoriesCustomType(customType)) {
      failures.push(
        `customType is ${JSON.stringify(customType)}, expected categories-shaped 3 or 13 ` +
          `(allowlist is 1 — the bitmap is silently dropped)`,
      );
    }
  }
  if (expected.categoriesSelectedType !== undefined) {
    if (Number(actual.categoriesSelectedType) !== expected.categoriesSelectedType) {
      failures.push(
        `categoriesSelectedType is ${JSON.stringify(actual.categoriesSelectedType)}, ` +
          `expected ${expected.categoriesSelectedType}` +
          (expected.categoriesSelectedType === CATEGORIES_SELECTED_TYPE.SELECTED
            ? " (0 = Selected Destinations)"
            : ""),
      );
    }
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
  for (const [key, value] of Object.entries(expected.fields)) {
    if (key === "categories" || key === "destinations") continue;
    if (!valuesEqual(actual[key], value)) {
      failures.push(
        `${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(value)}`,
      );
    }
  }
  return failures;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof expected === "number" && Number(actual) === expected) return true;
  if (typeof expected === "string" && String(actual) === expected) return true;
  return false;
}

export function summarizeResourcePolicySettings(
  settings: Record<string, unknown>,
): ResourcePolicySettingsSummary {
  const id = Number(settings.customCategoryId);
  return {
    customCategoryId: id,
    customCategoryNumber:
      settings.customCategoryNumber === undefined ? undefined : Number(settings.customCategoryNumber),
    customCategoryName:
      typeof settings.customCategoryName === "string" ? settings.customCategoryName : undefined,
    kind: isResourcePolicy(settings) ? "resource" : "layer",
    enabled: settings.policyEnabled === 1 || settings.policyEnabled === "1",
    customType: readCustomType(settings),
    destinations: decodeDestinations(settings),
    aiRisk: {
      enabled: settings.aiRiskEnabled === 1 || settings.aiRiskEnabled === true,
      engines: typeof settings.aiRiskEngines === "string" ? settings.aiRiskEngines : undefined,
      monitoringMessage:
        typeof settings.aiRiskMonitoringMessage === "string"
          ? settings.aiRiskMonitoringMessage
          : undefined,
      monitoringMessageEnabled:
        settings.aiRiskMonitoringMessageEnabled === 1 ||
        settings.aiRiskMonitoringMessageEnabled === true,
      monitoringMessageTitle:
        typeof settings.aiRiskMonitoringMessageTitle === "string"
          ? settings.aiRiskMonitoringMessageTitle
          : undefined,
    },
    groups: {
      linkPolicyToAllSubjects:
        settings.linkPolicyToAllSubjects === 1 || settings.linkPolicyToAllSubjects === true,
      associatedGroups:
        typeof settings.associatedGroups === "string" ? settings.associatedGroups : undefined,
    },
    dlpPolicyMethod: settings.dlpPolicyMethod,
  };
}

export function viewResourcePolicySettings(
  settings: Record<string, unknown>,
  view: "summary" | "full" = "summary",
): ResourcePolicySettingsView {
  return view === "full" ? settings : summarizeResourcePolicySettings(settings);
}
