/**
 * Per-group web controls: application controls, geolocation blocking, file
 * upload controls, and confidence scores (gateway tier).
 *
 * Console: these live under Secure Access Policies → Default Policies, per
 * policy group (currentPolicyBeingEdited). See
 * docs/api/default-policy-groups.md.
 */
import { SubClient, type SuccessResponse } from "./base.js";

export class AppsApi extends SubClient {
  /** Per-app allow/block controls for a policy group. */
  async getAppControls(opts?: { policyGroup?: number }): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/controls/apps", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
    });
  }

  async updateAppControls(
    settings: Record<string, unknown>,
    opts?: { policyGroup?: number },
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/controls/apps", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
      body: settings,
    });
  }

  async getGeoIpSettings(opts?: { policyGroup?: number }): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/controls/geoIp/settings", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
    });
  }

  async updateGeoIpSettings(
    settings: Record<string, unknown>,
    opts?: { policyGroup?: number },
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/controls/geoIp/settings", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
      body: settings,
    });
  }

  async getFileUploadSettings(opts?: { policyGroup?: number }): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/controls/fileUpload/settings", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
    });
  }

  async updateFileUploadSettings(
    settings: Record<string, unknown>,
    opts?: { policyGroup?: number },
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/controls/fileUpload/settings", {
      query: { currentPolicyBeingEdited: opts?.policyGroup },
      body: settings,
    });
  }

  async getConfidenceScores(): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/controls/confidenceScores");
  }
}
