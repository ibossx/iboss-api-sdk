/**
 * Firewall rules (gateway tier).
 */
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";

export interface FirewallRule {
  id?: number;
  name?: string;
  [key: string]: unknown;
}

export class FirewallApi extends SubClient {
  async listRules(opts?: { policyGroup?: number }): Promise<FirewallRule[]> {
    const result = await this.request<EntriesResponse<FirewallRule> | FirewallRule[]>(
      "gateway",
      "GET",
      "/json/controls/firewallRules/all",
      { query: { currentPolicyBeingEdited: opts?.policyGroup } },
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  async saveRule(rule: FirewallRule): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/controls/firewallRules", { body: rule });
  }

  async deleteRule(id: number): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/controls/firewallRules", {
      query: { id },
    });
  }

  /** Enable or disable firewall rule processing. */
  async setEnabled(enabled: boolean, extra?: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/controls/firewallRules/enable", {
      body: { enabled: enabled ? 1 : 0, ...extra },
    });
  }
}
