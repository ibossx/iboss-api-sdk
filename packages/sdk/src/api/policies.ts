/**
 * Policy management (gateway tier). Four console policy types share these
 * wire endpoints (/json/controls/policyLayers):
 *
 *  - Resource Policies (SaaS & Internet Access Policies):
 *    isZeroTrustResourcePolicy: 1 — docs/api/resource-policies.md
 *  - Private Access routed policies (ZTNA): resource-policy shape +
 *    ztnaFlowPeerIds — docs/api/private-access-policies.md
 *  - Policy Layers (overlays linked to default policy groups):
 *    isZeroTrustResourcePolicy: 0 — docs/api/policy-layers.md
 *  - Connector Policies (iboss agent config): customType 12 —
 *    docs/api/connector-policies.md
 *
 * CRITICAL GOTCHA — policy creation is a TWO-STEP process:
 *   1. PUT  /json/controls/policyLayers          → returns customCategoryId + customCategoryNumber
 *   2. POST /json/controls/policyLayers/settings → applies the full settings payload
 * createLayer() wraps both steps; the raw steps are exposed as
 * createLayerStructure() and updateLayerSettings() for advanced use.
 *
 * Resource Policies MUST include dlpPolicyMethod: 2 in every settings payload
 * (createLayer adds it when isZeroTrustResourcePolicy: 1).
 */
import { IbossApiError, IbossError } from "../client/errors.js";
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";
import {
  hasAiSecuritySignal,
  isFinitePolicyId,
  POLICY_KIND_FILTERS,
  POLICY_TYPE_FILTER,
  resolvePolicyKind,
  toPolicyList,
  type PolicyKindInput,
  type PolicyList,
} from "./policyKinds.js";

export type PolicyLayerType = "blocklist" | "allowlist" | "categories";

const CUSTOM_TYPE: Record<PolicyLayerType, string> = {
  blocklist: "e_custom_category_type_blacklist",
  allowlist: "e_custom_category_type_allowlist",
  categories: "e_custom_category_type_categories",
};

export interface PolicyLayer {
  customCategoryId: number;
  customCategoryNumber: number;
  customCategoryName: string;
  customType?: string | number;
  policyEnabled?: number;
  isZeroTrustResourcePolicy?: number;
  isZtnaPrivateAccessCategory?: number;
  placeAtPosition?: number;
  [key: string]: unknown;
}

export interface CreateLayerResult {
  customCategoryId: number;
  customCategoryNumber: number;
  id?: number;
  [key: string]: unknown;
}

export interface PolicyLayerUrl {
  url: string;
  [key: string]: unknown;
}

/** Fields cat0..cat110 = 3 (category action defaults). */
export function generateCategoryFields(value = 3): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= 110; i++) fields[`cat${i}`] = value;
  return fields;
}

/** Fields prio0..prio110 = 0. */
export function generatePriorityFields(value = 0): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= 110; i++) fields[`prio${i}`] = value;
  return fields;
}

/** Fields bypassSslMitm0..bypassSslMitm110 = 0. */
export function generateBypassSslMitmFields(value = 0): Record<string, number> {
  const fields: Record<string, number> = {};
  for (let i = 0; i <= 110; i++) fields[`bypassSslMitm${i}`] = value;
  return fields;
}

/** The 400-character all-zeros categories bitmap used in settings payloads. */
export function emptyCategoriesBitmap(): string {
  return "0".repeat(400);
}

export class PoliciesApi extends SubClient {
  /**
   * List policy layers via the paginated `/all` endpoint (the platform's
   * actual listing mechanism — there is no single-page "all" response).
   *
   * Filters: `isZeroTrustLayer` -1 = both, 0 = gateway layers only, 1 =
   * resource policies only; `typeFilter` -1 = all types (**9 = DLP**).
   * Agents should prefer `listPolicies({ kind })` over these integers.
   */
  async listLayers(opts?: {
    isZeroTrustLayer?: -1 | 0 | 1;
    typeFilter?: number;
    signal?: AbortSignal;
  }): Promise<PolicyLayer[]> {
    const pageSize = 100;
    const all: PolicyLayer[] = [];
    for (let currentRow = 0; ; currentRow += pageSize) {
      const result = await this.request<EntriesResponse<PolicyLayer>>(
        "gateway",
        "GET",
        "/json/controls/policyLayers/all",
        {
          query: {
            isZeroTrustLayer: opts?.isZeroTrustLayer ?? -1,
            typeFilter: opts?.typeFilter ?? -1,
            currentRow,
            maxItems: pageSize,
            // Empty filter params are required by the endpoint.
            nameFilter: "",
            domainFilter: "",
            groupNameFilter: "",
            groupExcludeNameFilter: "",
            ipInclusionFilter: "",
            ipExclusionFilter: "",
            notesFilter: "",
            portFilter: "",
            usernameFilter: "",
          },
          signal: opts?.signal,
        },
      );
      const entries = result?.entries ?? [];
      all.push(...entries);
      if (entries.length < pageSize) break;
    }
    return all;
  }

  /** Read the full settings of one policy layer. */
  async getLayerSettings(customCategoryId: number): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/controls/policyLayers/settings", {
      query: { customCategoryId },
    });
  }

  /**
   * Step 1 only: create the policy layer structure. Most callers should use
   * createLayer() which also applies settings.
   */
  async createLayerStructure(params: {
    name: string;
    type: PolicyLayerType;
    /** Set 1 to create a Zero Trust resource policy instead of a gateway layer. */
    isZeroTrustResourcePolicy?: 0 | 1;
    enterpriseOwned?: 0 | 1;
    placeAtPosition?: number;
    extra?: Record<string, unknown>;
  }): Promise<CreateLayerResult> {
    return this.request("gateway", "PUT", "/json/controls/policyLayers", {
      body: {
        customCategoryName: params.name,
        customType: CUSTOM_TYPE[params.type],
        isZtnaPrivateAccessCategory: 0,
        isZeroTrustResourcePolicy: params.isZeroTrustResourcePolicy ?? 0,
        ...(params.enterpriseOwned !== undefined ? { enterpriseOwned: params.enterpriseOwned } : {}),
        placeAtPosition: params.placeAtPosition ?? 0,
        ...params.extra,
      },
    });
  }

  /** Step 2 only: apply a full settings payload to an existing layer. */
  async updateLayerSettings(settings: {
    customCategoryId: number;
    customCategoryNumber: number;
    customCategoryName: string;
    [key: string]: unknown;
  }): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/controls/policyLayers/settings", {
      body: settings,
    });
  }

  /**
   * Create a policy layer and apply its settings (the two-step dance) in one
   * call. Returns the ids from step 1.
   *
   * ```ts
   * const layer = await client.policies.createLayer({
   *   name: "Global Blocklist",
   *   type: "blocklist",
   *   settings: { policyAction: 0, linkPolicyToAllSubjects: 1 },
   * });
   * await client.policies.addLayerUrl(layer.customCategoryId, "example.com");
   * ```
   */
  async createLayer(params: {
    name: string;
    type: PolicyLayerType;
    isZeroTrustResourcePolicy?: 0 | 1;
    enterpriseOwned?: 0 | 1;
    placeAtPosition?: number;
    /** Merged over sensible defaults (enabled, all-users, default category fields). */
    settings?: Record<string, unknown>;
  }): Promise<CreateLayerResult> {
    const created = await this.createLayerStructure(params);

    const isResourcePolicy = params.isZeroTrustResourcePolicy === 1;
    const settings: Record<string, unknown> = {
      customCategoryId: created.customCategoryId,
      customCategoryNumber: created.customCategoryNumber,
      customCategoryName: params.name,
      policyEnabled: 1,
      linkPolicyToAllSubjects: 1,
      ...generateCategoryFields(),
      ...generatePriorityFields(),
      ...generateBypassSslMitmFields(),
      categories: emptyCategoriesBitmap(),
      // Mandatory for resource policies; harmless default otherwise omitted.
      ...(isResourcePolicy ? { dlpPolicyMethod: 2 } : {}),
      ...params.settings,
    };
    await this.updateLayerSettings(settings as Parameters<PoliciesApi["updateLayerSettings"]>[0]);
    return created;
  }

  async deleteLayer(customCategoryId: number): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/controls/policyLayers", {
      query: { customCategoryId },
    });
  }

  /** URLs/domains attached to a blocklist/allowlist layer. */
  async getLayerUrls(customCategoryId: number): Promise<PolicyLayerUrl[]> {
    const result = await this.request<EntriesResponse<PolicyLayerUrl> | PolicyLayerUrl[]>(
      "gateway",
      "GET",
      "/json/controls/policyLayers/urls",
      { query: { customCategoryId } },
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  /** Add one URL/domain to a layer's list. */
  async addLayerUrl(
    customCategoryId: number,
    url: string,
    extra?: Record<string, unknown>,
  ): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/controls/policyLayers/urls", {
      query: { customCategoryId },
      body: { url, ...extra },
    });
  }

  /** Remove one URL/domain from a layer's list. */
  async removeLayerUrl(customCategoryId: number, url: string): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/controls/policyLayers/urls", {
      query: { customCategoryId, url },
    });
  }

  /**
   * Bulk-import URLs into a layer in one request (the console's import
   * mechanism) — much faster than addLayerUrl in a loop for large lists.
   */
  async importLayerUrls(params: {
    customCategoryId: number;
    customCategoryNumber: number;
    urls: string[];
    /** Merged into every imported entry (e.g. { isRegex: "1" }). */
    entryDefaults?: Record<string, unknown>;
  }): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/bulk/controls/policyLayers/urls", {
      body: {
        importList: params.urls.map((url) => ({
          url,
          applyKeyword: "0",
          isRegex: "0",
          note: "",
          timedUrl: "",
          doMalwareScan: 1,
          doDlpScan: 1,
          doFileChecks: 1,
          overrideZeroTrust: 0,
          applyKeywordAndSafeSearch: "0",
          ...params.entryDefaults,
        })),
        defaults: {
          customCategoryId: params.customCategoryId,
          customCategoryNumber: params.customCategoryNumber,
        },
      },
    });
  }

  /**
   * Purpose-named list (DEVELOP-34927 / 34915). Prefer this over guessing
   * `typeFilter=9` or choosing between `listResourcePolicies` and
   * `listLayers`. Legacy list methods are unchanged.
   *
   * ```ts
   * const dlp = await client.policies.listPolicies({ kind: "dlp" });
   * const ai = await client.policies.listPolicies({ kind: "aiSecurity" });
   * ```
   *
   * Returns a stable `{ kind, items, total, filter }` envelope. See
   * `POLICY_KIND_FILTERS` / docs/api/policies-by-kind.md for the kind →
   * wire mapping.
   */
  async listPolicies(opts: {
    kind: PolicyKindInput;
    /**
     * When listing `aiSecurity`, GET settings for rows that omit
     * `aiRiskEnabled` / `aiRiskEngines`. Default true for that kind only.
     */
    inspectSettings?: boolean;
    signal?: AbortSignal;
  }): Promise<PolicyList> {
    let kind: ReturnType<typeof resolvePolicyKind>;
    try {
      kind = resolvePolicyKind(opts.kind);
    } catch (error) {
      throw new IbossError(error instanceof Error ? error.message : String(error));
    }

    const rows = await this.collectPoliciesForKind(kind, opts.signal);
    const inspect =
      opts.inspectSettings ?? kind === "aiSecurity";
    const enriched =
      inspect && kind === "aiSecurity"
        ? await this.inspectAiSecuritySignals(rows, opts.signal)
        : rows;
    return toPolicyList(kind, enriched);
  }

  /** DEVELOP-34915 helper — composes `listPolicies({ kind: "dlp" })`. */
  async listDlpPolicies(opts?: {
    inspectSettings?: boolean;
    signal?: AbortSignal;
  }): Promise<PolicyList> {
    return this.listPolicies({ kind: "dlp", ...opts });
  }

  /** DEVELOP-34915 helper — composes `listPolicies({ kind: "aiSecurity" })`. */
  async listAiSecurityPolicies(opts?: {
    inspectSettings?: boolean;
    signal?: AbortSignal;
  }): Promise<PolicyList> {
    return this.listPolicies({ kind: "aiSecurity", ...opts });
  }

  /**
   * Fetch the raw rows for a kind using the documented wire mapping.
   * Resource-noun kinds fall back to `policyLayers/all?isZeroTrustLayer=1`
   * when `/json/controls/resourcePolicies` is missing (404/405).
   */
  private async collectPoliciesForKind(
    kind: ReturnType<typeof resolvePolicyKind>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    if (kind === "all") {
      return this.listLayers({
        isZeroTrustLayer: -1,
        typeFilter: POLICY_TYPE_FILTER.all,
        signal,
      });
    }
    const filter = POLICY_KIND_FILTERS[kind];
    if (filter.path === "/json/controls/policyLayers/all") {
      return this.listLayers({
        isZeroTrustLayer: filter.isZeroTrustLayer,
        typeFilter: filter.typeFilter,
        signal,
      });
    }
    return this.listZeroTrustPolicies(signal);
  }

  private async listZeroTrustPolicies(signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    try {
      return await this.listResourcePolicies();
    } catch (error) {
      if (error instanceof IbossApiError && (error.status === 404 || error.status === 405)) {
        return this.listLayers({ isZeroTrustLayer: 1, signal });
      }
      throw error;
    }
  }

  private async inspectAiSecuritySignals(
    rows: Record<string, unknown>[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      if (hasAiSecuritySignal(row) || !isFinitePolicyId(row)) {
        out.push(row);
        continue;
      }
      try {
        const settings = await this.getLayerSettings(Number(row.customCategoryId ?? row.id));
        out.push({ ...row, ...settings });
      } catch {
        out.push(row);
      }
    }
    return out;
  }

  // --- Zero Trust resource policies -------------------------------------

  async listResourcePolicies(): Promise<Record<string, unknown>[]> {
    const result = await this.request<EntriesResponse<Record<string, unknown>> | Record<string, unknown>[]>(
      "gateway",
      "GET",
      "/json/controls/resourcePolicies",
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  /** Resources currently associated with a resource policy. */
  async getResourcePolicyResources(customCategoryId: number): Promise<Record<string, unknown>[]> {
    const result = await this.request<EntriesResponse<Record<string, unknown>> | Record<string, unknown>[]>(
      "gateway",
      "GET",
      "/json/controls/resourcePolicy/resources",
      { query: { customCategoryId } },
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  /**
   * Associate enterprise resource UUIDs with a resource policy.
   *
   * Wire shape (matches the platform console): PUT with the policy's
   * customCategoryId as a query param and { customCategoryNumber,
   * resourceIds } as the body — note both ids are required and the body
   * field is `resourceIds`.
   */
  async associateResources(params: {
    customCategoryId: number;
    customCategoryNumber: number;
    resourceIds: string[];
  }): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/controls/resourcePolicy/resources", {
      query: { customCategoryId: params.customCategoryId },
      body: {
        customCategoryNumber: params.customCategoryNumber,
        resourceIds: params.resourceIds,
      },
    });
  }
}
