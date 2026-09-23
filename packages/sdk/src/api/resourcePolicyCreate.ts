/**
 * One-shot Resource Policy create + verify (DEVELOP-34926).
 *
 * Agent-facing surface (equivalent of POST …/resourcePolicies):
 *
 *   createResourcePolicy({ name, destinations?, settings?, ... })
 *
 * Internally still the legacy two-step:
 *   PUT  /json/controls/policyLayers
 *   POST /json/controls/policyLayers/settings   (full body, families included)
 *   GET  /json/controls/policyLayers/settings?customCategoryId=  ← effective state
 *
 * POST 200 / empty saveIgnoredEntries is not persistence. Callers return the
 * re-GET and throw if destinations or settings did not stick.
 *
 * Composes the same concepts as the sibling purpose-named surfaces:
 *   destinations — DestinationSpec (DEVELOP-34925 put/getResourcePolicyDestinations)
 *   settings     — sparse ResourcePolicySettingsPatch (DEVELOP-34924
 *                  get/patchResourcePolicySettings)
 *
 * `createLayer` is unchanged and still returns ids only.
 */
import {
  assertDestinationsExpressable,
  collectDestinationVerifyFailures,
  decodeDestinations,
  encodeDestinationBits,
  WEB_CATEGORY_BITS,
  type DestinationSpec,
  type DestinationVerifyExpectation,
  type ResourcePolicyDestinations,
} from "./destinations.js";
import { encodeAiRiskEngines, type AiRiskEnginesInput } from "./aiRiskEngines.js";
import {
  ensureFieldFamilies,
  isGeneratedSettingsFamilyKey,
} from "./policyFields.js";

/** Today's gateway settings path. There is no distinct resourcePolicies POST yet. */
export const RESOURCE_POLICY_SETTINGS_WIRE_PATH = "/json/controls/policyLayers/settings";

/**
 * Sparse settings fields — same idea as `patchResourcePolicySettings`
 * (DEVELOP-34924). Agents send only the fields they care about; the SDK
 * fills families + `dlpPolicyMethod: 2`. Do not put `categories` /
 * `categoriesSelectedType` here — use `destinations`.
 */
export interface ResourcePolicySettingsPatch {
  aiRiskEnabled?: number | boolean;
  /** `"all"` or engine slugs. Encoded to the platform string before POST. */
  aiRiskEngines?: AiRiskEnginesInput;
  aiRiskMonitoringMessage?: string;
  aiRiskMonitoringMessageEnabled?: number | boolean;
  aiRiskMonitoringMessageTitle?: string;
  linkPolicyToAllSubjects?: number | boolean;
  associatedGroups?: string;
  enableGroupAssociation?: number | boolean;
  policyEnabled?: number | boolean;
  policyAction?: number;
  dlpPolicyMethod?: number;
  [key: string]: unknown;
}

export interface CreateResourcePolicyParams {
  name: string;
  /** Typed destinations (DEVELOP-34925). Encoded to bit 110 + type 0 for AI Services. */
  destinations?: DestinationSpec;
  /** Sparse settings (DEVELOP-34924). Merged over create defaults. */
  settings?: ResourcePolicySettingsPatch;
  /**
   * Defaults to `"categories"` so destinations are expressable. Pass
   * `"allowlist"` for CASB-style policies and omit destinations.
   */
  type?: "blocklist" | "allowlist" | "categories";
  enterpriseOwned?: 0 | 1;
  placeAtPosition?: number;
  /** Subject linking; also accepted inside `settings`. Default 1 (everyone). */
  linkPolicyToAllSubjects?: number | boolean;
  associatedGroups?: string;
  enableGroupAssociation?: number | boolean;
  aiRiskEnabled?: number | boolean;
  /** `"all"` or engine slugs. Encoded to the platform string before POST. */
  aiRiskEngines?: AiRiskEnginesInput;
  aiRiskMonitoringMessage?: string;
  aiRiskMonitoringMessageEnabled?: number | boolean;
  aiRiskMonitoringMessageTitle?: string;
  view?: "summary" | "full";
  signal?: AbortSignal;
}

/**
 * Effective create result: ids + decoded destinations + settings from re-GET.
 * Default `settings` hides generated families (same as getResourcePolicySettings
 * summary). `view: "full"` puts the raw GET blob in `settings`.
 */
export interface CreateResourcePolicyResult {
  customCategoryId: number;
  customCategoryNumber: number;
  customCategoryName?: string;
  destinations: ResourcePolicyDestinations;
  settings: Record<string, unknown>;
}

export interface CreateVerifyExpectation {
  destinations?: DestinationVerifyExpectation;
  fields: Record<string, unknown>;
}

const WIRE_DESTINATION_KEYS = new Set(["categories", "categoriesSelectedType", "destinations"]);

const FLAG_KEYS = new Set([
  "aiRiskEnabled",
  "aiRiskMonitoringMessageEnabled",
  "linkPolicyToAllSubjects",
  "enableGroupAssociation",
  "policyEnabled",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asFlag(value: number | boolean): number {
  return value === true || value === 1 ? 1 : 0;
}

export function assertCreateSettingsPatch(settings?: ResourcePolicySettingsPatch): void {
  if (settings === undefined) return;
  if (!isPlainObject(settings)) {
    throw new TypeError("createResourcePolicy settings must be a plain object");
  }
  for (const key of WIRE_DESTINATION_KEYS) {
    if (settings[key] !== undefined) {
      throw new TypeError(
        `createResourcePolicy settings must not include ${key}. ` +
          `Pass destinations as the top-level destinations field ` +
          `({ mode: "selectedWebCategories", categories: ["AI_SERVICES"] }).`,
      );
    }
  }
}

function normalizeSettingsFields(patch: ResourcePolicySettingsPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || WIRE_DESTINATION_KEYS.has(key)) continue;
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

/** Merge top-level convenience aliases into the settings patch. `settings` wins. */
export function resolveCreateSettingsPatch(
  params: CreateResourcePolicyParams,
): ResourcePolicySettingsPatch {
  return {
    linkPolicyToAllSubjects: params.linkPolicyToAllSubjects ?? 1,
    associatedGroups: params.associatedGroups,
    enableGroupAssociation: params.enableGroupAssociation,
    aiRiskEnabled: params.aiRiskEnabled,
    aiRiskEngines: params.aiRiskEngines,
    aiRiskMonitoringMessage: params.aiRiskMonitoringMessage,
    aiRiskMonitoringMessageEnabled: params.aiRiskMonitoringMessageEnabled,
    aiRiskMonitoringMessageTitle: params.aiRiskMonitoringMessageTitle,
    ...params.settings,
  };
}

export function omitGeneratedSettingsFamilies(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!isGeneratedSettingsFamilyKey(key)) out[key] = value;
  }
  return out;
}

export function viewCreatedResourcePolicy(
  persisted: Record<string, unknown>,
  view: "summary" | "full" = "summary",
): CreateResourcePolicyResult {
  return {
    customCategoryId: Number(persisted.customCategoryId),
    customCategoryNumber: Number(persisted.customCategoryNumber),
    customCategoryName:
      typeof persisted.customCategoryName === "string" ? persisted.customCategoryName : undefined,
    destinations: decodeDestinations(persisted),
    settings: view === "full" ? persisted : omitGeneratedSettingsFamilies(persisted),
  };
}

export interface BuiltCreateSettings {
  body: Record<string, unknown>;
  verify: CreateVerifyExpectation;
}

/**
 * Build the full settings POST body for create. Families + `dlpPolicyMethod: 2`
 * are always present. Destinations are encoded after the settings merge so
 * agents never invent the bitmap.
 */
export function buildCreateResourcePolicySettings(params: {
  customCategoryId: number;
  customCategoryNumber: number;
  name: string;
  type: "blocklist" | "allowlist" | "categories";
  destinations?: DestinationSpec;
  settings: ResourcePolicySettingsPatch;
}): BuiltCreateSettings {
  const customType =
    params.type === "blocklist"
      ? "e_custom_category_type_blacklist"
      : params.type === "allowlist"
        ? "e_custom_category_type_allowlist"
        : "e_custom_category_type_categories";

  const seed: Record<string, unknown> = {
    customCategoryId: params.customCategoryId,
    customCategoryNumber: params.customCategoryNumber,
    customCategoryName: params.name,
    isZeroTrustResourcePolicy: 1,
    policyEnabled: 1,
    customType,
  };

  assertDestinationsExpressable(seed, params.destinations);
  assertCreateSettingsPatch(params.settings);

  const fieldPatch = normalizeSettingsFields(params.settings);
  let body: Record<string, unknown> = {
    ...seed,
    dlpPolicyMethod: 2,
    ...fieldPatch,
  };

  let destinationVerify: DestinationVerifyExpectation | undefined;
  if (params.destinations) {
    const encoded = encodeDestinationBits(params.destinations);
    body = { ...body, ...encoded };
    const bits: number[] = [];
    if (params.destinations.mode === "selectedWebCategories") {
      for (const name of params.destinations.categories ?? []) {
        bits.push(WEB_CATEGORY_BITS[name]);
      }
    }
    destinationVerify = {
      categoriesSelectedType: encoded.categoriesSelectedType,
      bits,
    };
  }

  body = ensureFieldFamilies(body);
  body.customCategoryId = params.customCategoryId;
  body.customCategoryNumber = params.customCategoryNumber;
  body.customCategoryName = params.name;
  body.isZeroTrustResourcePolicy = 1;
  if (body.dlpPolicyMethod === undefined) body.dlpPolicyMethod = 2;

  const verify: CreateVerifyExpectation = {
    destinations: destinationVerify,
    fields: {
      dlpPolicyMethod: body.dlpPolicyMethod,
      customCategoryName: params.name,
      isZeroTrustResourcePolicy: 1,
      ...fieldPatch,
    },
  };

  return { body, verify };
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof expected === "number" && Number(actual) === expected) return true;
  if (typeof expected === "string" && String(actual) === expected) return true;
  if (typeof expected === "boolean" && Boolean(actual) === expected) return true;
  return false;
}

export function collectCreateVerifyFailures(
  actual: Record<string, unknown>,
  expected: CreateVerifyExpectation,
): string[] {
  const failures: string[] = [];
  if (expected.destinations) {
    failures.push(...collectDestinationVerifyFailures(actual, expected.destinations));
  }
  for (const [key, value] of Object.entries(expected.fields)) {
    if (value === undefined || value === null) continue;
    if (isPlainObject(value)) continue;
    if (!valuesEqual(actual[key], value)) {
      failures.push(`${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(value)}`);
    }
  }
  return failures;
}
