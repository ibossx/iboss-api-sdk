/**
 * Account, credential, and cloud-preference APIs (cloud + accounts tiers).
 */
import type { AccountInfo } from "../client/session.js";
import { parseIbossExpiry } from "../client/session.js";
import { IbossError } from "../client/errors.js";
import { SubClient, type SuccessResponse } from "./base.js";

export interface RotateCredentialResult {
  /** The NEW API key. The old key stops working immediately — store this one. */
  opaqueToken: string;
  expiresAt?: Date;
}

export interface GeneralSettings {
  alertEmail?: string;
  urlExceptionEmail?: string;
  releaseNotesEmail?: string;
  maintenanceEmail?: string;
  communicationType?: string;
  [key: string]: unknown;
}

export interface NtpSettings {
  ntpServer?: string;
  /** IANA timezone, e.g. "America/New_York". */
  timezone?: string;
  /** 0 = MM/DD/YYYY, 1 = DD/MM/YYYY. */
  dateFormat?: number;
  daylightSaving?: number;
  [key: string]: unknown;
}

export class AccountApi extends SubClient {
  /** All accounts visible to the credential (from the connect() session). */
  async listAccounts(): Promise<AccountInfo[]> {
    const session = await this.client.connect();
    return session.accounts;
  }

  /** The currently selected account. */
  async currentAccount(): Promise<AccountInfo> {
    const session = await this.client.connect();
    return session.account;
  }

  /** When the API credential expires, if reported by the platform. */
  async credentialExpiry(): Promise<Date | undefined> {
    const session = await this.client.connect();
    return session.apiCredentialExpiresAt;
  }

  /**
   * Rotate the API credential. The response contains the NEW key; the current
   * key is invalidated immediately. Persist the new key before doing anything
   * else — losing it means generating a fresh key in the admin console.
   */
  async rotateCredential(): Promise<RotateCredentialResult> {
    const session = await this.client.connect();
    if (!session.ibCloudUserId) {
      throw new IbossError("Cannot rotate credential: the API user id could not be resolved.");
    }
    const result = await this.request<{ opaqueToken?: string; expiresAtMillis?: number }>(
      "cloud",
      "POST",
      `/ibcloud/web/users/account/${session.account.accountSettingsId}/apiUser/${session.ibCloudUserId}/rotateCredential`,
    );
    if (!result?.opaqueToken) {
      throw new IbossError("Credential rotation did not return a new token.");
    }
    return {
      opaqueToken: result.opaqueToken,
      expiresAt: parseIbossExpiry(result.expiresAtMillis),
    };
  }

  /** Raw cluster objects for the account (node discovery data). */
  async listClusters(): Promise<Record<string, unknown>[]> {
    return this.request("cloud", "GET", "/ibcloud/web/account/clusters");
  }

  /** Cloud nodes for the account. */
  async listCloudNodes(): Promise<Record<string, unknown>[]> {
    return this.request("cloud", "GET", "/ibcloud/web/cloudNodes");
  }

  async getGeneralSettings(): Promise<GeneralSettings> {
    return this.request("cloud", "GET", "/ibcloud/web/preferences/generalSettings");
  }

  async updateGeneralSettings(settings: GeneralSettings): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/preferences/generalSettings", {
      body: settings,
    });
  }

  async getNtpSettings(): Promise<NtpSettings> {
    return this.request("cloud", "GET", "/ibcloud/web/preferences/ntpSettings");
  }

  async updateNtpSettings(settings: NtpSettings): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/preferences/ntpSettings", {
      body: settings,
    });
  }

  /** Firmware release channel, e.g. { updateReleaseLevel: 5 } = Generally Available. */
  async updateReleaseSettings(settings: { updateReleaseLevel: number } & Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/preferences/updateReleaseSettings", {
      body: settings,
    });
  }

  async updateAutoUpdateSettings(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/preferences/autoUpdateSettings", {
      body: settings,
    });
  }

  async getReleaseNotesRecipients(): Promise<string[]> {
    return this.request("cloud", "GET", "/ibcloud/web/releaseNotes/recipients");
  }

  async setReleaseNotesRecipients(emails: string[]): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/releaseNotes/recipients", { body: emails });
  }

  async getCloudStatusRecipients(): Promise<string[]> {
    return this.request("cloud", "GET", "/ibcloud/web/cloudStatus/recipients");
  }

  async setCloudStatusRecipients(emails: string[]): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/cloudStatus/recipients", { body: emails });
  }
}
