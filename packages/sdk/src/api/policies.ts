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
 * createLayer() wraps both steps and still returns ids only. Agents creating
 * Resource Policies should use createResourcePolicy() (DEVELOP-34926): same
 * two-step internally, then re-GET so the response is effective settings.
 * The raw steps stay exposed as createLayerStructure() and
 * updateLayerSettings() for advanced use.
 *
 * Resource Policies MUST include dlpPolicyMethod: 2 in every settings payload
 * (createLayer / createResourcePolicy add it when isZeroTrustResourcePolicy: 1).
 */
import { IbossVerifyError } from "../client/errors.js";
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";
import {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
} from "./policyFields.js";
import {
  buildCreateResourcePolicySettings,
  collectCreateVerifyFailures,
  resolveCreateSettingsPatch,
  RESOURCE_POLICY_SETTINGS_WIRE_PATH,
  viewCreatedResourcePolicy,
  type CreateResourcePolicyParams,
  type CreateResourcePolicyResult,
} from "./resourcePolicyCreate.js";

export {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
} from "./policyFields.js";

export type { CreateResourcePolicyParams, CreateResourcePolicyResult } from "./resourcePolicyCreate.js";

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

export class PoliciesApi extends SubClient {
  /**
   * List policy layers via the paginated `/all` endpoint (the platform's
   * actual listing mechanism — there is no single-page "all" response).
   *
   * Filters: `isZeroTrustLayer` -1 = both, 0 = gateway layers only, 1 =
   * resource policies only; `typeFilter` -1 = all types.
   */
  async listLayers(opts?: {
    isZeroTrustLayer?: -1 | 0 | 1;
    typeFilter?: number;
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

  /**
   * One-shot Resource Policy create + verify (DEVELOP-34926).
   *
   * Agent-facing equivalent of `POST …/resourcePolicies`:
   *
   * ```ts
   * const policy = await client.policies.createResourcePolicy({
   *   name: "AI Security",
   *   destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
   *   settings: { aiRiskEnabled: 1, linkPolicyToAllSubjects: 1 },
   * });
   * // policy.settings is the re-GET (effective), not the POST 200 / ids
   * ```
   *
   * Internally still PUT policyLayers + POST settings (legacy two-step). The
   * method then re-GETs and throws `IbossVerifyError` if destinations or
   * settings did not persist. Do not trust POST success or empty
   * `saveIgnoredEntries`.
   *
   * Composes the sibling purpose-named surfaces: `destinations` is the
   * DEVELOP-34925 body; `settings` is the DEVELOP-34924 sparse patch.
   * `createLayer` is unchanged and still returns ids only.
   *
   * Default `type` is `"categories"` so destinations are expressable.
   * Allowlist/blocklist + destinations throws `IbossPolicyTypeError` before
   * any write (allowlist recreate silently drops the bitmap).
   */
  async createResourcePolicy(params: CreateResourcePolicyParams): Promise<CreateResourcePolicyResult> {
    const type = params.type ?? "categories";
    const settingsPatch = resolveCreateSettingsPatch(params);

    // Reject before PUT so a doomed allowlist+destinations combo never creates
    // a half-finished layer.
    buildCreateResourcePolicySettings({
      customCategoryId: 0,
      customCategoryNumber: 0,
      name: params.name,
      type,
      destinations: params.destinations,
      settings: settingsPatch,
    });

    const created = await this.createLayerStructure({
      name: params.name,
      type,
      isZeroTrustResourcePolicy: 1,
      enterpriseOwned: params.enterpriseOwned,
      placeAtPosition: params.placeAtPosition,
    });

    const { body, verify } = buildCreateResourcePolicySettings({
      customCategoryId: created.customCategoryId,
      customCategoryNumber: created.customCategoryNumber,
      name: params.name,
      type,
      destinations: params.destinations,
      settings: settingsPatch,
    });

    await this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
      body,
      signal: params.signal,
    });

    const persisted = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId: created.customCategoryId }, signal: params.signal },
    );
    const failures = collectCreateVerifyFailures(persisted, verify);
    if (failures.length > 0) {
      throw new IbossVerifyError(
        `Resource policy ${created.customCategoryId} create POST reported success but GET did not persist: ` +
          `${failures.join("; ")}. Do not trust POST success or empty saveIgnoredEntries.`,
        { customCategoryId: created.customCategoryId, failures, actual: persisted },
      );
    }
    return viewCreatedResourcePolicy(persisted, params.view ?? "summary");
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
