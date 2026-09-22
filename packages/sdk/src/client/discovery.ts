/**
 * Connect-time discovery — turns a { domain, credential } pair into a full
 * session: validated credential, selected account, API user id, credential
 * expiry, and the host map for all node tiers.
 *
 * Sequence (every step uses `Authorization: Token <credential>`):
 *  1. GET /ibcloud/web/users/mySettings      — validate credential, list accounts,
 *                                              capture cloud XSRF/session cookies
 *  2. GET /ibcloud/web/users/me              — the API user's ibCloudUserId
 *  3. GET /ibcloud/web/users/{id}            — credential expiry (best effort)
 *  4. GET /ibcloud/web/account/clusters      — discover gateway/reporter/rbi hosts
 *  5. GET /ibreports/web/users/me            — prime reporter-host cookies
 */
import { IbossAuthError, IbossError } from "./errors.js";
import { applyHostOverrides, type HostOverrides } from "./hosts.js";
import type { Logger } from "./logger.js";
import type { RequestLayer } from "./request.js";
import { parseIbossExpiry, type AccountInfo, type SessionState } from "./session.js";

interface RawAccount {
  accountSettingsId?: number | string;
  accountName?: string;
  customAccountName?: string;
  delegatedSuperAdminId?: number;
  subscriptionFeatureContext?: {
    subscriptionSettings?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

interface RawClusterMember {
  primary?: number;
  cloudNode?: { adminInterfaceDns?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface RawCluster {
  productFamily?: string;
  clusterFullDns?: string;
  members?: RawClusterMember[];
  [key: string]: unknown;
}

export interface DiscoverOptions {
  /** Pin a specific account; defaults to the primary account. */
  accountSettingsId?: string;
  /** Win over cluster discovery (IBOSS_GATEWAY_HOST / constructor `hosts`). */
  hostOverrides?: HostOverrides;
  logger: Logger;
}

export async function discover(layer: RequestLayer, opts: DiscoverOptions): Promise<SessionState> {
  const { logger } = opts;

  // Step 1 — validate credential and list accounts.
  const rawAccounts = await layer.request<RawAccount[]>("cloud", "GET", "/ibcloud/web/users/mySettings", {
    withAccountId: false,
  });
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    throw new IbossAuthError("Credential accepted but no accounts are visible to it.", {
      method: "GET",
      url: `${layer.baseUrl("cloud")}/ibcloud/web/users/mySettings`,
      status: 200,
    });
  }
  const accounts = rawAccounts.map(toAccountInfo);
  const account = selectAccount(accounts, opts.accountSettingsId);
  logger.debug("Selected account", {
    accountSettingsId: account.accountSettingsId,
    isPrimary: account.isPrimary,
    totalAccounts: accounts.length,
  });

  // Scope all subsequent requests to the selected account.
  layer.accountSettingsId = account.accountSettingsId;
  layer.subscriptionFlags = account.subscriptionFlags;

  // Step 2 — resolve the API user's id (wire field: ibCloudUserId).
  let ibCloudUserId: string | undefined;
  try {
    const me = await layer.request<{ ibCloudUserId?: number | string }>("cloud", "GET", "/ibcloud/web/users/me", {
      withAccountId: false,
    });
    if (me?.ibCloudUserId !== undefined) ibCloudUserId = String(me.ibCloudUserId);
  } catch (error) {
    logger.warn("Could not resolve API user id (non-fatal)", { error: String(error) });
  }

  // Step 3 — credential expiry (best effort; not all credential types report it).
  let apiCredentialExpiresAt: Date | undefined;
  if (ibCloudUserId) {
    try {
      const user = await layer.request<{ apiCredentialExpiresAt?: unknown }>(
        "cloud",
        "GET",
        `/ibcloud/web/users/${ibCloudUserId}`,
      );
      apiCredentialExpiresAt = parseIbossExpiry(user?.apiCredentialExpiresAt);
    } catch (error) {
      logger.warn("Could not read credential expiry (non-fatal)", { error: String(error) });
    }
  }

  // Step 4 — discover node hosts from the account's clusters.
  const clusters = await layer.request<RawCluster[]>("cloud", "GET", "/ibcloud/web/account/clusters");
  if (Array.isArray(clusters)) {
    for (const cluster of clusters) {
      const primary = cluster.members?.find((m) => m.primary === 1);
      const dns = primary?.cloudNode?.adminInterfaceDns;
      if (!dns) continue;
      switch (cluster.productFamily) {
        case "swg":
          layer.hosts.gateway = dns;
          if (cluster.clusterFullDns) layer.hosts.gatewayClusterDns = cluster.clusterFullDns;
          break;
        case "reports":
          layer.hosts.reporter = dns;
          break;
        case "rbi":
          layer.hosts.rbi = dns;
          break;
      }
    }
  }
  if (opts.hostOverrides) applyHostOverrides(layer.hosts, opts.hostOverrides);
  logger.debug("Discovered hosts", { hosts: { ...layer.hosts } });

  // Step 5 — prime reporter-host cookies so mutating reporter calls have XSRF state.
  if (layer.hosts.reporter) {
    try {
      await layer.request("reporter", "GET", "/ibreports/web/users/me", { withAccountId: false });
    } catch (error) {
      logger.warn("Could not prime reporter session (non-fatal)", { error: String(error) });
    }
  }

  return {
    accounts,
    account,
    ibCloudUserId,
    apiCredentialExpiresAt,
    hosts: layer.hosts,
  };
}

function toAccountInfo(raw: RawAccount): AccountInfo {
  const flagsSource = raw.subscriptionFeatureContext?.subscriptionSettings ?? {};
  const subscriptionFlags: Record<string, boolean> = {};
  for (const key of Object.keys(flagsSource)) subscriptionFlags[key] = true;
  return {
    accountSettingsId: String(raw.accountSettingsId ?? ""),
    accountName: raw.accountName ?? raw.customAccountName,
    delegatedSuperAdminId: raw.delegatedSuperAdminId,
    isPrimary: raw.delegatedSuperAdminId === 0,
    subscriptionFlags,
    raw: raw as Record<string, unknown>,
  };
}

function selectAccount(accounts: AccountInfo[], requestedId?: string): AccountInfo {
  if (requestedId) {
    const match = accounts.find((a) => a.accountSettingsId === requestedId);
    if (!match) {
      throw new IbossError(
        `Account ${requestedId} is not visible to this credential. ` +
          `Available: ${accounts.map((a) => a.accountSettingsId).join(", ")}. ` +
          `Note: an API key is scoped to exactly one account. To operate on ` +
          `multiple accounts, configure one key per account in a profile ` +
          `(see docs/GETTING_STARTED.md).`,
      );
    }
    return match;
  }
  return accounts.find((a) => a.isPrimary) ?? accounts[0]!;
}
