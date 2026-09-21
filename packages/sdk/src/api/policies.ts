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
 *
 * Sparse settings updates (DEVELOP-34924): use getResourcePolicySettings /
 * patchResourcePolicySettings. Those prefer native Gateway PATCH (34921)
 * and fall back to get→merge→full POST (34914). Do not POST a partial
 * blob via updateLayerSettings — omitted families are Gateway-defaulted.
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
  assertSparsePatch,
  collectSparseVerifyFailures,
  isNativePatchUnsupported,
  mergeResourcePolicySettingsForFallback,
  RESOURCE_POLICY_SETTINGS_WIRE_PATH,
  sparseSettingsBody,
  viewResourcePolicySettings,
  type ResourcePolicySettingsPatch,
  type ResourcePolicySettingsTransport,
} from "./resourcePolicySparse.js";

export {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
} from "./policyFields.js";

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
   * Cached after the first auto PATCH attempt. `false` means this gateway
   * rejected PATCH (404/405) so later auto updates skip straight to the
   * 34914 get→merge→POST fallback.
   */
  private nativeSettingsPatchSupported?: boolean;

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
    return this.request("gateway", "GET", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
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

  /**
   * Step 2 only: apply a **full** settings payload to an existing layer.
   * This is a replace: omitted catN / prioN / bypassSslMitmN are
   * Gateway-defaulted (wipe-on-omit). Agents must use
   * `patchResourcePolicySettings` for one-field updates.
   */
  async updateLayerSettings(settings: {
    customCategoryId: number;
    customCategoryNumber: number;
    customCategoryName: string;
    [key: string]: unknown;
  }): Promise<SuccessResponse> {
    return this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
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

  /**
   * Purpose-named Resource Policy settings GET (DEVELOP-34924).
   *
   * Equivalent of `GET …/resourcePolicies/{id}/settings`. Wire today is
   * `GET /json/controls/policyLayers/settings?customCategoryId=`.
   *
   * `view: "summary"` (default) hides catN / prioN / bypassSslMitmN and
   * the 400-char `categories` bitmap so agents do not invent those
   * families. `view: "full"` returns the wire blob.
   */
  async getResourcePolicySettings(
    customCategoryId: number,
    opts?: { view?: "summary" | "full"; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const full = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal: opts?.signal },
    );
    return viewResourcePolicySettings(full, opts?.view ?? "summary");
  }

  /**
   * Purpose-named omit-safe Resource Policy settings PATCH (DEVELOP-34924).
   *
   * Equivalent of `PATCH …/resourcePolicies/{id}/settings`. Agents send
   * only changed fields (`{ aiRiskEnabled: 1 }`); omitted keys — including
   * every catN / prioN / bypassSslMitmN member — stay unchanged.
   *
   * Transport (`opts.transport`, default `auto`):
   * 1. Native `PATCH` on the existing settings path (DEVELOP-34921).
   * 2. If PATCH is 404/405, DEVELOP-34914 get→deep-merge→**full** POST
   *    (families filled so Gateway POST cannot default omitted fields).
   *
   * POST `?merge=1` is available as `transport: "merge-post"` but is **not**
   * used by `auto`: a pre-34921 gateway would ignore `merge` and wipe.
   * `updateLayerSettings(fullBlob)` stays the caller-supplied full replace.
   *
   * Re-GETs after write. TOCTOU on the get-merge-post fallback is accepted
   * for agent v1 (same as DEVELOP-34914).
   */
  async patchResourcePolicySettings(
    customCategoryId: number,
    patch: ResourcePolicySettingsPatch,
    opts?: {
      view?: "summary" | "full";
      signal?: AbortSignal;
      transport?: ResourcePolicySettingsTransport;
    },
  ): Promise<Record<string, unknown>> {
    assertSparsePatch(patch);
    const transport = opts?.transport ?? "auto";
    const body = sparseSettingsBody(customCategoryId, patch);

    if (transport === "native-patch") {
      await this.request("gateway", "PATCH", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
        query: { customCategoryId },
        body,
        signal: opts?.signal,
      });
    } else if (transport === "merge-post") {
      await this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
        query: { customCategoryId, merge: 1 },
        body,
        signal: opts?.signal,
      });
    } else if (transport === "get-merge-post") {
      await this.patchViaGetMergePost(customCategoryId, patch, opts?.signal);
    } else {
      await this.patchAuto(customCategoryId, patch, body, opts?.signal);
    }

    const persisted = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal: opts?.signal },
    );
    const failures = collectSparseVerifyFailures(persisted, patch);
    if (failures.length > 0) {
      throw new IbossVerifyError(
        `Resource policy ${customCategoryId} write reported success but GET did not persist: ` +
          `${failures.join("; ")}. Do not trust POST/PATCH success alone.`,
        { customCategoryId, failures },
      );
    }
    return viewResourcePolicySettings(persisted, opts?.view ?? "summary");
  }

  private async patchAuto(
    customCategoryId: number,
    patch: ResourcePolicySettingsPatch,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.nativeSettingsPatchSupported === false) {
      await this.patchViaGetMergePost(customCategoryId, patch, signal);
      return;
    }
    try {
      await this.request("gateway", "PATCH", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
        query: { customCategoryId },
        body,
        signal,
      });
      this.nativeSettingsPatchSupported = true;
    } catch (error) {
      if (!isNativePatchUnsupported(error)) throw error;
      this.nativeSettingsPatchSupported = false;
      await this.patchViaGetMergePost(customCategoryId, patch, signal);
    }
  }

  /** DEVELOP-34914: GET → deep-merge → full POST (never a sparse replace). */
  private async patchViaGetMergePost(
    customCategoryId: number,
    patch: ResourcePolicySettingsPatch,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal },
    );
    const next = mergeResourcePolicySettingsForFallback(current, patch);
    await this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
      body: next,
      signal,
    });
  }
}
