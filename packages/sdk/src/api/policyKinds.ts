/**
 * Purpose-named policy kinds for agent list/query (DEVELOP-34927 / 34915).
 *
 * Agents must not guess `typeFilter=9` or choose between
 * `resourcePolicies` and `policyLayers/all`. This module is the documented
 * kind → wire-filter map. `listLayers` / `listResourcePolicies` stay as-is.
 */

/** Friendly kinds accepted by `listPolicies({ kind })`. */
export const POLICY_KINDS = [
  "dlp",
  "aiSecurity",
  "resource",
  "layer",
  "connector",
  "privateAccess",
] as const;

export type PolicyKind = (typeof POLICY_KINDS)[number];

/** Optional list that classifies every row instead of filtering to one kind. */
export type PolicyListKind = PolicyKind | "all";

/**
 * Alias used by the optional HTTP sibling
 * `GET /json/controls/resourcePolicies?kind=internet`.
 */
export const POLICY_KIND_ALIASES = {
  internet: "resource",
} as const;

export type PolicyKindInput = PolicyKind | keyof typeof POLICY_KIND_ALIASES | "all";

/** Wire `typeFilter` integers on `GET /json/controls/policyLayers/all`. */
export const POLICY_TYPE_FILTER = {
  all: -1,
  /** DLP policies — the magic number agents used to guess. */
  dlp: 9,
} as const;

/**
 * GET `customType` integers observed on policy list/settings rows.
 * Create still uses the `e_custom_category_type_*` strings for some types.
 */
export const POLICY_CUSTOM_TYPE = {
  blocklist: 0,
  allowlist: 1,
  /** Categories-type; AI Security destinations use this (or 13). */
  categories: 3,
  /** Alternate GET value for categories (Bug Replicator traces). */
  categoriesAlt: 13,
  dlp: 9,
  connector: 12,
} as const;

export interface PolicyKindWireFilter {
  kind: PolicyKind;
  /** Gateway path used for this kind. */
  path: "/json/controls/policyLayers/all" | "/json/controls/resourcePolicies";
  isZeroTrustLayer?: -1 | 0 | 1;
  typeFilter?: number;
  /** What the SDK applies after the wire list (never a second magic number). */
  clientFilter: string;
}

/**
 * Documented kind → wire filter mapping.
 *
 * `isZeroTrustLayer`: −1 all, 0 overlay layers, 1 resource policies.
 * `typeFilter`: −1 all types; **9 = DLP**.
 */
export const POLICY_KIND_FILTERS: Record<PolicyKind, PolicyKindWireFilter> = {
  dlp: {
    kind: "dlp",
    path: "/json/controls/policyLayers/all",
    isZeroTrustLayer: -1,
    typeFilter: POLICY_TYPE_FILTER.dlp,
    clientFilter: "none — typeFilter=9 is the wire filter",
  },
  aiSecurity: {
    kind: "aiSecurity",
    path: "/json/controls/resourcePolicies",
    clientFilter:
      "Zero Trust resource policies with aiRiskEnabled / aiRiskEngines (settings inspect when the list row omits those fields)",
  },
  resource: {
    kind: "resource",
    path: "/json/controls/resourcePolicies",
    clientFilter: "drop Private Access rows (ztnaFlowPeerIds / isZtnaPrivateAccessCategory)",
  },
  layer: {
    kind: "layer",
    path: "/json/controls/policyLayers/all",
    isZeroTrustLayer: 0,
    typeFilter: POLICY_TYPE_FILTER.all,
    clientFilter: "exclude connector (customType 12) and DLP (customType / typeFilter 9)",
  },
  connector: {
    kind: "connector",
    path: "/json/controls/policyLayers/all",
    isZeroTrustLayer: 0,
    typeFilter: POLICY_TYPE_FILTER.all,
    clientFilter: "customType === 12",
  },
  privateAccess: {
    kind: "privateAccess",
    path: "/json/controls/resourcePolicies",
    clientFilter: "ztnaFlowPeerIds or isZtnaPrivateAccessCategory",
  },
};

export const POLICY_KIND_ALL_FILTER = {
  kind: "all" as const,
  path: "/json/controls/policyLayers/all" as const,
  isZeroTrustLayer: -1 as const,
  typeFilter: POLICY_TYPE_FILTER.all,
  clientFilter: "classify each row (dlp / connector / privateAccess / aiSecurity / resource / layer)",
};

/** Stable per-row shape returned by `listPolicies` (not the raw wire blob). */
export interface PolicySummary {
  id: number;
  number: number;
  name: string;
  kind: PolicyKind;
  enabled: boolean;
  customType?: string | number;
  flags: {
    isZeroTrustResourcePolicy: boolean;
    isZtnaPrivateAccess: boolean;
    aiRiskEnabled: boolean;
  };
}

/** Stable list envelope so agents always get kind + the wire filter used. */
export interface PolicyList {
  kind: PolicyListKind;
  items: PolicySummary[];
  total: number;
  filter: PolicyKindWireFilter | typeof POLICY_KIND_ALL_FILTER;
}

export function isPolicyKind(value: string): value is PolicyKind {
  return (POLICY_KINDS as readonly string[]).includes(value);
}

export function resolvePolicyKind(kind: PolicyKindInput): PolicyListKind {
  if (kind === "all") return "all";
  if (kind in POLICY_KIND_ALIASES) {
    return POLICY_KIND_ALIASES[kind as keyof typeof POLICY_KIND_ALIASES];
  }
  if (isPolicyKind(kind)) return kind;
  throw new Error(
    `Unknown policy kind "${kind}". Expected one of: ${POLICY_KINDS.join(", ")}, or alias "internet", or "all".`,
  );
}

export function isTruthyFlag(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function numericCustomType(row: Record<string, unknown>): number | undefined {
  const raw = row.customType;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

export function isDlpRow(row: Record<string, unknown>): boolean {
  const type = numericCustomType(row);
  return type === POLICY_CUSTOM_TYPE.dlp;
}

export function isConnectorRow(row: Record<string, unknown>): boolean {
  return numericCustomType(row) === POLICY_CUSTOM_TYPE.connector;
}

export function isZeroTrustResourceRow(row: Record<string, unknown>): boolean {
  return isTruthyFlag(row.isZeroTrustResourcePolicy);
}

export function isPrivateAccessRow(row: Record<string, unknown>): boolean {
  if (isTruthyFlag(row.isZtnaPrivateAccessCategory) || isTruthyFlag(row.isZtnaPrivateAccess)) {
    return true;
  }
  const peers = row.ztnaFlowPeerIds;
  if (typeof peers === "string") return peers.trim().length > 0;
  if (Array.isArray(peers)) return peers.length > 0;
  return false;
}

export function isAiSecurityRow(row: Record<string, unknown>): boolean {
  if (isTruthyFlag(row.aiRiskEnabled)) return true;
  const engines = row.aiRiskEngines;
  if (typeof engines === "string") return engines.trim().length > 0;
  if (Array.isArray(engines)) return engines.length > 0;
  return false;
}

export function hasAiSecuritySignal(row: Record<string, unknown>): boolean {
  return "aiRiskEnabled" in row || "aiRiskEngines" in row;
}

/**
 * Classify a list/settings row. More specific kinds win: DLP, connector,
 * Private Access, AI Security, then resource vs overlay layer.
 */
export function classifyPolicyKind(row: Record<string, unknown>): PolicyKind {
  if (isDlpRow(row)) return "dlp";
  if (isConnectorRow(row)) return "connector";
  if (isZeroTrustResourceRow(row) && isPrivateAccessRow(row)) return "privateAccess";
  if (isZeroTrustResourceRow(row) && isAiSecurityRow(row)) return "aiSecurity";
  if (isZeroTrustResourceRow(row)) return "resource";
  return "layer";
}

export function matchesPolicyKind(row: Record<string, unknown>, kind: PolicyKind): boolean {
  switch (kind) {
    case "dlp":
      return isDlpRow(row);
    case "connector":
      return isConnectorRow(row);
    case "privateAccess":
      return isZeroTrustResourceRow(row) && isPrivateAccessRow(row);
    case "aiSecurity":
      return isZeroTrustResourceRow(row) && isAiSecurityRow(row);
    case "resource":
      return isZeroTrustResourceRow(row) && !isPrivateAccessRow(row);
    case "layer":
      return !isZeroTrustResourceRow(row) && !isConnectorRow(row) && !isDlpRow(row);
  }
}

export function toPolicySummary(row: Record<string, unknown>, kind?: PolicyKind): PolicySummary {
  const id = Number(row.customCategoryId ?? row.id ?? 0);
  const number = Number(row.customCategoryNumber ?? 0);
  const name = String(row.customCategoryName ?? row.name ?? "");
  return {
    id,
    number,
    name,
    kind: kind ?? classifyPolicyKind(row),
    enabled: isTruthyFlag(row.policyEnabled),
    ...(row.customType !== undefined ? { customType: row.customType as string | number } : {}),
    flags: {
      isZeroTrustResourcePolicy: isZeroTrustResourceRow(row),
      isZtnaPrivateAccess: isPrivateAccessRow(row),
      aiRiskEnabled: isAiSecurityRow(row),
    },
  };
}

export function isFinitePolicyId(row: Record<string, unknown>): boolean {
  const id = Number(row.customCategoryId ?? row.id);
  return Number.isFinite(id) && id > 0;
}

export function toPolicyList(
  kind: PolicyListKind,
  rows: Record<string, unknown>[],
): PolicyList {
  const items =
    kind === "all"
      ? rows.map((row) => toPolicySummary(row))
      : rows.filter((row) => matchesPolicyKind(row, kind)).map((row) => toPolicySummary(row, kind));
  return {
    kind,
    items,
    total: items.length,
    filter: kind === "all" ? POLICY_KIND_ALL_FILTER : POLICY_KIND_FILTERS[kind],
  };
}
