/**
 * SSL/HTTPS decryption settings (gateway tier).
 */
import { SubClient, type SuccessResponse } from "./base.js";

export class SslApi extends SubClient {
  /** General decryption settings for a policy group. */
  async updateSettings(
    settings: Record<string, unknown>,
    opts?: { policyGroup?: number },
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/sslDecryption/settings", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
      body: settings,
    });
  }

  async getAdvancedSettings(): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/network/sslDecryption/advanced");
  }

  async updateAdvancedSettings(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/sslDecryption/advanced", {
      body: settings,
    });
  }

  /** Domain-level decryption bypass list. */
  async updateDomainBypass(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/sslDecryption/domains", {
      body: settings,
    });
  }

  /** Applications selected for selective decryption. */
  async getApplications(): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/network/sslDecryption/applications");
  }

  async removeApplication(applicationName: string): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/network/sslDecryption/applications", {
      query: { sslApplicationToRemove: applicationName },
    });
  }
}
