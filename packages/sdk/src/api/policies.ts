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
 * Resource Policies should use createResourcePolicy(): same two-step
 * internally, then re-GET so the response is effective settings.
 *
 * Sparse settings updates: getResourcePolicySettings /
 * patchResourcePolicySettings use native PATCH when the node supports it
 * and fall back to get→merge→full POST. Do not POST a partial blob via
 * updateLayerSettings — omitted families are defaulted.
 *
 * Resource Policies MUST include dlpPolicyMethod: 2 in every settings payload
 * (createLayer / createResourcePolicy add it when isZeroTrustResourcePolicy: 1).
 */
import { IbossApiError, IbossError, IbossVerifyError } from "../client/errors.js";
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";
import {
  aiServicesDestination,
  assertCategoriesBitmapExpressable,
  categoriesBitmapSelects,
  collectDestinationVerifyFailures,
  decodeDestinations,
  prepareDestinationWrite,
  readListDestinationMode,
  type DestinationSpec,
  type ResourcePolicyDestinations,
  type WrongTypeBehavior,
} from "./destinations.js";
import {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
} from "./policyFields.js";
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
import {
  buildCreateResourcePolicySettings,
  collectCreateVerifyFailures,
  resolveCreateSettingsPatch,
  viewCreatedResourcePolicy,
  type CreateResourcePolicyParams,
  type CreateResourcePolicyResult,
} from "./resourcePolicyCreate.js";
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
   * Cached after the first auto PATCH attempt. `false` means this gateway
   * rejected PATCH (404/405) so later auto updates skip straight to the
   * get→merge→POST fallback.
   */
  private nativeSettingsPatchSupported?: boolean;

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

  /**
   * Purpose-named list. Prefer this over guessing
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
    const inspect = opts.inspectSettings ?? kind === "aiSecurity";
    const enriched =
      inspect && kind === "aiSecurity"
        ? await this.inspectAiSecuritySignals(rows, opts.signal)
        : rows;
    return toPolicyList(kind, enriched);
  }

  /** Composes `listPolicies({ kind: "dlp" })`. */
  async listDlpPolicies(opts?: {
    inspectSettings?: boolean;
    signal?: AbortSignal;
  }): Promise<PolicyList> {
    return this.listPolicies({ kind: "dlp", ...opts });
  }

  /** Composes `listPolicies({ kind: "aiSecurity" })`. */
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
      return await this.listResourcePolicies({ signal });
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
   *
   * Allowlist (or blocklist) plus a non-empty `categories` bitmap throws
   * `IbossPolicyTypeError` before POST. The gateway returns 200 and silently
   * drops that bitmap (`categories` length 0, including bit 110).
   */
  async updateLayerSettings(settings: {
    customCategoryId: number;
    customCategoryNumber: number;
    customCategoryName: string;
    [key: string]: unknown;
  }): Promise<SuccessResponse> {
    await this.rejectSilentCategoryDrop(settings);
    return this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
      body: settings,
    });
  }

  /**
   * Gateway POST returns 200 and drops a categories bitmap on allowlist /
   * blocklist layers. Throw before that POST. When the body omits the mode,
   * the stored layer type is checked — the drop follows the layer, not only
   * fields the caller repeated.
   */
  private async rejectSilentCategoryDrop(settings: Record<string, unknown>): Promise<void> {
    if (!categoriesBitmapSelects(settings.categories)) return;
    const probe: Record<string, unknown> = { ...settings };
    if (readListDestinationMode(probe) === undefined && settings.customCategoryId != null) {
      try {
        const current = await this.getLayerSettings(Number(settings.customCategoryId));
        const storedMode = readListDestinationMode(current);
        if (storedMode !== undefined) probe.customType = storedMode;
        else if (current.customType !== undefined) probe.customType = current.customType;
        else if (current.categoryType !== undefined) probe.categoryType = current.categoryType;
      } catch {
        // Body-only check. A 404 here means there is no stored mode to drop against.
      }
    }
    assertCategoriesBitmapExpressable(probe);
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
    // Reject allowlist/blocklist + a real categories bitmap before PUT.
    // The all-zero placeholder added below is not a selection.
    if (params.settings) {
      assertCategoriesBitmapExpressable({
        ...params.settings,
        customType: params.settings.customType ?? CUSTOM_TYPE[params.type],
      });
    }

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
   * One-shot Resource Policy create + re-GET verify.
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
   * Composes the purpose-named surfaces: `destinations` is a typed
   * destination body; `settings` is the sparse settings patch.
   * `aiRiskEngines` is `"all"` or a slug list and is encoded to the
   * platform string before POST. `createLayer` is unchanged and still
   * returns ids only.
   *
   * Default `type` is `"categories"` so destinations are expressable.
   * Allowlist/blocklist + destinations throws `IbossPolicyTypeError` before
   * any write. Gateway POST would return 200 and silently drop the bitmap
   * (`categories` length 0); the SDK throw is the guard.
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

  async listResourcePolicies(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>[]> {
    const result = await this.request<EntriesResponse<Record<string, unknown>> | Record<string, unknown>[]>(
      "gateway",
      "GET",
      "/json/controls/resourcePolicies",
      { signal: opts?.signal },
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
   * Purpose-named Resource Policy settings GET.
   *
   * Equivalent of `GET …/resourcePolicies/{id}/settings`. Wire path is
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
   * Purpose-named omit-safe Resource Policy settings PATCH.
   *
   * Equivalent of `PATCH …/resourcePolicies/{id}/settings`. Agents send
   * only changed fields (`{ aiRiskEnabled: 1 }`); omitted keys — including
   * every catN / prioN / bypassSslMitmN member — stay unchanged.
   * `aiRiskEngines: "all" | string[]` is validated and encoded to the
   * platform string before the write.
   *
   * Transport (`opts.transport`, default `auto`):
   * 1. Native `PATCH` on the existing settings path when the node supports it.
   * 2. If PATCH is 404/405, GET → deep-merge → **full** POST
   *    (families filled so a plain POST cannot default omitted fields).
   *
   * POST `?merge=1` is available as `transport: "merge-post"` but is **not**
   * used by `auto`. Older nodes that ignore `?merge=1` will wipe on omit —
   * never send merge unless you know the node supports it; prefer transport
   * auto. `updateLayerSettings(fullBlob)` stays the caller-supplied full replace.
   *
   * Re-GETs after write. TOCTOU on the get-merge-post fallback is accepted.
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
    if (categoriesBitmapSelects(patch.categories) || categoriesBitmapSelects(body.categories)) {
      await this.rejectSilentCategoryDrop({ ...body, customCategoryId });
    }

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
        { customCategoryId, failures, actual: persisted },
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

  /** GET → deep-merge → full POST (never a sparse replace). */
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
    if (categoriesBitmapSelects(patch.categories) || readListDestinationMode(patch) !== undefined) {
      assertCategoriesBitmapExpressable(next);
    }
    await this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
      body: next,
      signal,
    });
  }

  /**
   * Read destinations as a typed list. Agents never see the
   * 400-char `categories` bitmap or inverted `categoriesSelectedType`.
   *
   * Purpose-named equivalent of `GET …/resourcePolicies/{id}/destinations`.
   * Wire path is `GET /json/controls/policyLayers/settings`.
   */
  async getResourcePolicyDestinations(
    customCategoryId: number,
    opts?: { signal?: AbortSignal },
  ): Promise<ResourcePolicyDestinations> {
    const settings = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal: opts?.signal },
    );
    return decodeDestinations(settings);
  }

  /**
   * Purpose-named typed destinations write:
   *
   * ```
   * PUT …/resourcePolicies/{id}/destinations
   * { mode: "selectedWebCategories", categories: ["AI_SERVICES"] }
   * ```
   *
   * Encodes AI Services as **bit 110** + `categoriesSelectedType: 0`
   * (UI “Selected Destinations”). Agents never invent the bitmap or the
   * inverted enum. Legacy wire fields remain on the settings POST for old
   * clients.
   *
   * Allowlist/blocklist + categories **rejects** by default
   * (`IbossPolicyTypeError`) — the platform returns 200 and silently drops
   * the bitmap (`GET categories` length 0, including bit 110). There is no
   * wire reject; this throw happens before POST. Pass `onWrongType: "warn"`
   * to skip the write and leave the layer unchanged.
   *
   * Wire steps:
   * 1. GET `/json/controls/policyLayers/settings?customCategoryId=`
   * 2. Encode destinations onto the full GET blob (families preserved)
   * 3. POST the complete object to the same settings path
   * 4. Re-GET and throw `IbossVerifyError` if bit 110 / type did not persist
   */
  async putResourcePolicyDestinations(
    customCategoryId: number,
    destinations: DestinationSpec,
    opts?: { onWrongType?: WrongTypeBehavior; signal?: AbortSignal },
  ): Promise<ResourcePolicyDestinations> {
    const current = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal: opts?.signal },
    );

    const prepared = prepareDestinationWrite(current, destinations, opts?.onWrongType ?? "reject");
    if (prepared.warning) this.client.warn(prepared.warning, { customCategoryId });
    if (prepared.skipped) return decodeDestinations(current);

    // Prior family values win; fill only gaps so Gateway POST cannot default
    // omitted catN / prioN / bypassSslMitmN.
    const body = {
      ...generateCategoryFields(),
      ...generatePriorityFields(),
      ...generateBypassSslMitmFields(),
      categories: emptyCategoriesBitmap(),
      ...prepared.next,
      customCategoryId,
    };

    assertCategoriesBitmapExpressable(body);
    await this.request("gateway", "POST", RESOURCE_POLICY_SETTINGS_WIRE_PATH, {
      body,
      signal: opts?.signal,
    });

    const persisted = await this.request<Record<string, unknown>>(
      "gateway",
      "GET",
      RESOURCE_POLICY_SETTINGS_WIRE_PATH,
      { query: { customCategoryId }, signal: opts?.signal },
    );
    const failures = collectDestinationVerifyFailures(persisted, prepared.verify);
    if (failures.length > 0) {
      throw new IbossVerifyError(
        `Resource policy ${customCategoryId} destinations POST reported success but GET did not persist: ` +
          `${failures.join("; ")}. Do not trust POST success or empty saveIgnoredEntries.`,
        { customCategoryId, failures, actual: persisted },
      );
    }
    return decodeDestinations(persisted);
  }

  /**
   * Thin alias of `putResourcePolicyDestinations`.
   */
  async setDestination(
    customCategoryId: number,
    destination: DestinationSpec,
    opts?: { onWrongType?: WrongTypeBehavior; signal?: AbortSignal },
  ): Promise<ResourcePolicyDestinations> {
    return this.putResourcePolicyDestinations(customCategoryId, destination, opts);
  }

  /**
   * Ensure Selected Destinations → AI Services (bit 110, categoriesSelectedType 0).
   */
  async ensureAiSecurityDestination(
    customCategoryId: number,
    opts?: { onWrongType?: WrongTypeBehavior; signal?: AbortSignal },
  ): Promise<ResourcePolicyDestinations> {
    return this.putResourcePolicyDestinations(customCategoryId, aiServicesDestination(), opts);
  }
}
