/**
 * Session state produced by connect()/discovery and shared with sub-clients.
 */
import type { HostMap } from "./hosts.js";

export interface AccountInfo {
  /** Account identifier used as the accountSettingsId query param everywhere. */
  accountSettingsId: string;
  accountName?: string;
  /** 0 means this is the primary (parent) account for the credential. */
  delegatedSuperAdminId?: number;
  isPrimary: boolean;
  /**
   * Subscription feature flags from subscriptionFeatureContext.subscriptionSettings —
   * presence of a flag means the module is available (e.g.
   * ENABLE_DLP_POLICIES_DASHBOARD, ENABLE_PRIVATE_ACCESS).
   */
  subscriptionFlags: Record<string, boolean>;
  /** Raw account entry as returned by the platform, for fields not modeled above. */
  raw: Record<string, unknown>;
}

export interface SessionState {
  /** All accounts visible to the credential. */
  accounts: AccountInfo[];
  /** The selected account (all API calls are scoped to it). */
  account: AccountInfo;
  /** The authenticated API user's id (wire field name: ibCloudUserId). */
  ibCloudUserId?: string;
  /** When the API credential expires, if the platform reports it. */
  apiCredentialExpiresAt?: Date;
  /** Discovered host map: cloud, gateway, reporter, rbi, accounts. */
  hosts: HostMap;
}

/**
 * The platform reports credential expiry inconsistently: epoch seconds, epoch
 * milliseconds, or an ISO date string. Normalize defensively.
 */
export function parseIbossExpiry(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === "" || value === 0) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Values below 1e12 are epoch seconds (would be a 1970s date as millis).
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== "") {
      return parseIbossExpiry(numeric);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}
