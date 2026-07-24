/**
 * Data Loss Prevention (gateway tier).
 *
 * Gotcha: several DLP endpoints return 422 (IbossSubscriptionError) on
 * accounts without a DLP subscription — check
 * client.session.account.subscriptionFlags["ENABLE_DLP_POLICIES_DASHBOARD"]
 * before configuring, or catch IbossSubscriptionError and treat as expected.
 */
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";

export interface ContentAnalysisRule {
  id?: number;
  uuid?: string;
  name: string;
  description?: string;
  dlpContentRiskLevel?: string;
  dlpFileDirection?: string;
  enabled?: boolean;
  piiEnabled?: boolean;
  ccnEnabled?: boolean;
  emailAddressEnabled?: boolean;
  phoneNumberEnabled?: boolean;
  ssnEnabled?: boolean;
  addressEnabled?: boolean;
  [key: string]: unknown;
}

export interface DlpPolicyResponse {
  id?: number;
  name: string;
  action?: string;
  sendNotification?: boolean;
  notificationEmail?: string;
  [key: string]: unknown;
}

export class DlpApi extends SubClient {
  async listContentAnalysisRules(): Promise<ContentAnalysisRule[]> {
    const result = await this.request<EntriesResponse<ContentAnalysisRule> | ContentAnalysisRule[]>(
      "gateway",
      "GET",
      "/json/contentAnalysisRules",
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  async createContentAnalysisRule(rule: ContentAnalysisRule): Promise<ContentAnalysisRule> {
    return this.request("gateway", "PUT", "/json/contentAnalysisRule", { body: rule });
  }

  async deleteContentAnalysisRule(id: number | string): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/contentAnalysisRule", {
      query: { id },
    });
  }

  async listPolicyResponses(): Promise<DlpPolicyResponse[]> {
    const result = await this.request<EntriesResponse<DlpPolicyResponse> | DlpPolicyResponse[]>(
      "gateway",
      "GET",
      "/json/contentAnalysisRule/dlpPolicyResponses",
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  /** Throws IbossSubscriptionError (422) on accounts without DLP. */
  async createPolicyResponse(response: DlpPolicyResponse): Promise<DlpPolicyResponse> {
    return this.request("gateway", "PUT", "/json/contentAnalysisRule/dlpPolicyResponse", {
      body: response,
    });
  }

  /** Search-pattern converters used by DLP rules. */
  async listConverters(): Promise<Record<string, unknown>[]> {
    const result = await this.request<EntriesResponse<Record<string, unknown>> | Record<string, unknown>[]>(
      "gateway",
      "GET",
      "/json/contentAnalysisRule/dlpConverters",
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  async deleteConverter(id: number | string): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/contentAnalysisRule/dlpConverter", {
      query: { id },
    });
  }

  /** DLP engine general settings. mode=0 selects the DLP settings view. */
  async getGeneralSettings(): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/network/contentAnalysis/settings", {
      query: { mode: 0 },
    });
  }

  async updateGeneralSettings(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/contentAnalysis/settings", {
      query: { mode: 0 },
      body: settings,
    });
  }
}
