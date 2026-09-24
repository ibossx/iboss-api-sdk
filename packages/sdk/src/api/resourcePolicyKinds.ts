/**
 * Purpose-named Resource Policy customType values (DEVELOP-34958 / 34977).
 *
 * `createResourcePolicy` accepts a purpose kind, the gateway enum string, or
 * the matching numeric in the same `kind` / `customType` field. Every value
 * on the Resource Policy allowlist resolves both ways. The SDK still sends
 * the canonical enum string so older nodes that reject numerics keep working.
 *
 * `categories` is numeric 3. `resourcePoliciesCombined` is numeric 13.
 * Those are different kinds — 13 is not an alias of categories.
 *
 * | kind                      | enum                                              | numeric |
 * | ------------------------- | ------------------------------------------------- | ------- |
 * | blocklist                 | e_custom_category_type_blacklist                  | 0       |
 * | allowlist                 | e_custom_category_type_allowlist                  | 1       |
 * | categories                | e_custom_category_type_categories                 | 3       |
 * | msTenantRestrictions      | e_custom_category_type_ms_tenant_restrictions     | 5       |
 * | urlList                   | e_custom_category_url_list                        | 6       |
 * | parent                    | e_custom_category_type_parent                     | 10      |
 * | casb                      | e_custom_category_type_casb                       | 11      |
 * | casbParent                | e_custom_category_type_casb_parent                | 12      |
 * | resourcePoliciesCombined  | e_custom_category_type_resource_policies_combined | 13      |
 * | aiPolicy                  | e_custom_category_type_ai_policy                   | 14      |
 * | aiPolicyParent            | e_custom_category_type_ai_policy_parent           | 15      |
 *
 * `e_custom_category_type_url_list` is accepted as an alias of `urlList` and
 * still sends `e_custom_category_url_list`.
 */
import { IbossPolicyTypeError } from "../client/errors.js";

export const RESOURCE_POLICY_KINDS = [
  "blocklist",
  "allowlist",
  "categories",
  "msTenantRestrictions",
  "urlList",
  "parent",
  "casb",
  "casbParent",
  "resourcePoliciesCombined",
  "aiPolicy",
  "aiPolicyParent",
] as const;

export type ResourcePolicyKind = (typeof RESOURCE_POLICY_KINDS)[number];

/** Purpose kind, gateway enum (including the url-list alias), or numeric. */
export type ResourcePolicyCustomTypeInput = string | number;

export interface ResourcePolicyKindWire {
  kind: ResourcePolicyKind;
  /** Canonical enum string sent on PUT/POST. */
  customType: string;
  /** Matching gateway numeric. Accepted as input; not sent by the SDK. */
  numeric: number;
  /** `createLayer` type, when this kind is also a policy-layer type. */
  layerType: "blocklist" | "allowlist" | "categories" | null;
  /**
   * `bitmap` — categories-shaped destinations.
   * `list` — allowlist/blocklist; the silent-drop guard rejects destinations.
   * `none` — this kind has no categories bitmap.
   */
  destinations: "bitmap" | "list" | "none";
}

interface ResourcePolicyKindSpec extends ResourcePolicyKindWire {
  /** Extra enum strings that resolve to this kind. */
  aliases?: readonly string[];
}

const RESOURCE_POLICY_KIND_SPECS: readonly ResourcePolicyKindSpec[] = [
  {
    kind: "blocklist",
    customType: "e_custom_category_type_blacklist",
    numeric: 0,
    layerType: "blocklist",
    destinations: "list",
  },
  {
    kind: "allowlist",
    customType: "e_custom_category_type_allowlist",
    numeric: 1,
    layerType: "allowlist",
    destinations: "list",
  },
  {
    kind: "categories",
    customType: "e_custom_category_type_categories",
    numeric: 3,
    layerType: "categories",
    destinations: "bitmap",
  },
  {
    kind: "msTenantRestrictions",
    customType: "e_custom_category_type_ms_tenant_restrictions",
    numeric: 5,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "urlList",
    customType: "e_custom_category_url_list",
    aliases: ["e_custom_category_type_url_list"],
    numeric: 6,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "parent",
    customType: "e_custom_category_type_parent",
    numeric: 10,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "casb",
    customType: "e_custom_category_type_casb",
    numeric: 11,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "casbParent",
    customType: "e_custom_category_type_casb_parent",
    numeric: 12,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "resourcePoliciesCombined",
    customType: "e_custom_category_type_resource_policies_combined",
    numeric: 13,
    layerType: null,
    destinations: "bitmap",
  },
  {
    kind: "aiPolicy",
    customType: "e_custom_category_type_ai_policy",
    numeric: 14,
    layerType: null,
    destinations: "none",
  },
  {
    kind: "aiPolicyParent",
    customType: "e_custom_category_type_ai_policy_parent",
    numeric: 15,
    layerType: null,
    destinations: "none",
  },
];

export const RESOURCE_POLICY_KIND_WIRE: Record<ResourcePolicyKind, ResourcePolicyKindWire> =
  Object.fromEntries(
    RESOURCE_POLICY_KIND_SPECS.map((spec) => {
      const wire: ResourcePolicyKindWire = {
        kind: spec.kind,
        customType: spec.customType,
        numeric: spec.numeric,
        layerType: spec.layerType,
        destinations: spec.destinations,
      };
      return [spec.kind, wire];
    }),
  ) as Record<ResourcePolicyKind, ResourcePolicyKindWire>;

const BY_NUMERIC = new Map<number, ResourcePolicyKindWire>(
  RESOURCE_POLICY_KIND_SPECS.map((spec) => [spec.numeric, RESOURCE_POLICY_KIND_WIRE[spec.kind]]),
);

const BY_TOKEN = new Map<string, ResourcePolicyKindWire>();
for (const spec of RESOURCE_POLICY_KIND_SPECS) {
  const wire = RESOURCE_POLICY_KIND_WIRE[spec.kind];
  BY_TOKEN.set(spec.kind, wire);
  BY_TOKEN.set(spec.customType, wire);
  for (const alias of spec.aliases ?? []) BY_TOKEN.set(alias, wire);
}

/**
 * Kind attached to a create result. `echoedByGateway` is false when the SDK
 * filled the fields itself (older nodes omit the echo).
 */
export interface ResourcePolicyWireKindAnnotation {
  kind: ResourcePolicyKind;
  customType: string;
  numeric: number;
  listKind: "resourcePolicy" | "policyLayer";
  echoedByGateway: boolean;
}

export function annotateResourcePolicyKind(wire: ResourcePolicyKindWire): ResourcePolicyWireKindAnnotation {
  return {
    kind: wire.kind,
    customType: wire.customType,
    numeric: wire.numeric,
    listKind: "resourcePolicy",
    echoedByGateway: false,
  };
}

export function isResourcePolicyKind(value: string): value is ResourcePolicyKind {
  return (RESOURCE_POLICY_KINDS as readonly string[]).includes(value);
}

export function formatResourcePolicyCustomTypeAllowlist(): string {
  return RESOURCE_POLICY_KINDS.map((kind) => {
    const wire = RESOURCE_POLICY_KIND_WIRE[kind];
    return `${kind}=${wire.numeric} (${wire.customType})`;
  }).join(", ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\+?\d+$/.test(trimmed)) return Number(trimmed);
  }
  return undefined;
}

/**
 * Map one allowlisted token to its kind. Returns undefined for values outside
 * the Resource Policy allowlist (policy-layer-only numerics included).
 */
export function parseResourcePolicyCustomType(value: unknown): ResourcePolicyKindWire | undefined {
  const numeric = finiteInteger(value);
  if (numeric !== undefined) return BY_NUMERIC.get(numeric);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return BY_TOKEN.get(trimmed);
}

export function unknownResourcePolicyCustomTypeMessage(where: string, value: unknown): string {
  return (
    `${where} ${JSON.stringify(value)} is not on the Resource Policy customType allowlist. ` +
    `Pass a purpose kind, enum string, or matching numeric: ${formatResourcePolicyCustomTypeAllowlist()}. ` +
    `categories is 3 (${RESOURCE_POLICY_KIND_WIRE.categories.customType}); ` +
    `resourcePoliciesCombined is 13 (${RESOURCE_POLICY_KIND_WIRE.resourcePoliciesCombined.customType}).`
  );
}

function describeInput(value: string | number): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * `kind` and `customType` accept a purpose name, an enum string, or the
 * matching numeric. `type` remains the legacy blocklist / allowlist /
 * categories alias. Passing more than one is allowed only when they name
 * the same kind. Omitted selectors default to categories.
 */
export function resolveResourcePolicyKind(params: {
  type?: "blocklist" | "allowlist" | "categories";
  kind?: ResourcePolicyCustomTypeInput;
  customType?: ResourcePolicyCustomTypeInput;
}): ResourcePolicyKindWire {
  const specs: { label: string; value: ResourcePolicyCustomTypeInput }[] = [];
  if (params.kind !== undefined) specs.push({ label: "kind", value: params.kind });
  if (params.customType !== undefined) specs.push({ label: "customType", value: params.customType });
  if (params.type !== undefined) specs.push({ label: "type", value: params.type });
  if (specs.length === 0) return RESOURCE_POLICY_KIND_WIRE.categories;

  const resolved = specs.map((spec) => {
    const wire = parseResourcePolicyCustomType(spec.value);
    if (!wire) {
      throw new TypeError(unknownResourcePolicyCustomTypeMessage(`createResourcePolicy ${spec.label}`, spec.value));
    }
    return { label: spec.label, value: spec.value, wire };
  });
  const first = resolved[0]!;
  for (const other of resolved.slice(1)) {
    if (other.wire.kind !== first.wire.kind) {
      throw new TypeError(
        `createResourcePolicy ${first.label} "${describeInput(first.value)}" does not match ` +
          `${other.label} "${describeInput(other.value)}". Pass one customType.`,
      );
    }
  }
  return first.wire;
}

export function wireKindFromCustomType(customType: unknown): ResourcePolicyKindWire | undefined {
  return parseResourcePolicyCustomType(customType);
}

/**
 * True when GET `customType` / `categoryType` is the enum we sent or the
 * matching numeric (including the url-list enum alias). Missing values match
 * — some reads omit the field. Numeric 13 matches only
 * `resourcePoliciesCombined`, never `categories`.
 */
export function customTypeMatchesKind(actual: unknown, wire: ResourcePolicyKindWire): boolean {
  if (actual === undefined || actual === null || actual === "") return true;
  const parsed = parseResourcePolicyCustomType(actual);
  return parsed?.kind === wire.kind;
}

/**
 * Throw when `value` is present and not on the Resource Policy allowlist.
 * Allowlisted numerics and enum strings both pass (DEVELOP-34977).
 */
export function assertResourcePolicyCustomType(value: unknown, where: string): void {
  if (value === undefined || value === null || value === "") return;
  if (!parseResourcePolicyCustomType(value)) {
    throw new TypeError(unknownResourcePolicyCustomTypeMessage(where, value));
  }
}

export function assertKindCanCarryDestinations(wire: ResourcePolicyKindWire): void {
  if (wire.destinations !== "none") return;
  throw new IbossPolicyTypeError(
    `kind "${wire.kind}" cannot carry categories destinations. ` +
      `Omit destinations, or use kind "categories" for AI Services. ` +
      `${wire.kind} sends "${wire.customType}" (numeric ${wire.numeric}).`,
    { customType: wire.customType },
  );
}

/**
 * Overlay a live PUT `/json/controls/policyLayers` echo onto the SDK annotation.
 * The live body is flat: `{ customCategoryId, customType: <numeric>, enum, listKind, message }`.
 * Missing any of numeric `customType`, `enum`, or `listKind` leaves the annotation unchanged.
 */
export function applyGatewayCreateEcho(
  annotation: ResourcePolicyWireKindAnnotation,
  createResponse: unknown,
): ResourcePolicyWireKindAnnotation {
  if (!isPlainObject(createResponse)) return annotation;
  const enumName = typeof createResponse.enum === "string" ? createResponse.enum.trim() : "";
  const listKind = createResponse.listKind;
  const numeric = finiteInteger(createResponse.customType);
  if (!enumName || numeric === undefined) return annotation;
  if (listKind !== "resourcePolicy" && listKind !== "policyLayer") return annotation;
  const fromEnum = parseResourcePolicyCustomType(enumName);
  return {
    kind: fromEnum?.kind ?? annotation.kind,
    customType: fromEnum?.customType ?? enumName,
    numeric,
    listKind,
    echoedByGateway: true,
  };
}
