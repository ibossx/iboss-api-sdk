/**
 * Host-tier model.
 *
 * The iboss platform is distributed: different functional areas are served by
 * different hosts, discovered at connect time from the account's clusters.
 *
 *  - "cloud":    the base API host (config.domain) — /ibcloud/web/... paths
 *  - "gateway":  the primary SWG gateway node — /json/... paths
 *  - "reporter": the primary reporting node — /ibreports/web/... paths
 *  - "rbi":      the primary Browser Isolation node
 *  - "accounts": the authentication host (accounts.<domain>) — login/token APIs
 */

export type HostTier = "cloud" | "gateway" | "reporter" | "rbi" | "accounts";

export type HostMap = Partial<Record<HostTier, string>> & {
  gatewayClusterDns?: string;
};

/**
 * Derive the authentication host from a cloud base domain.
 * Production convention: the accounts host lives at accounts.<apex-domain>,
 * with the special case that the ibosscloud.com cloud is authenticated via
 * accounts.iboss.com.
 */
export function accountsHostFor(cloudDomain: string): string {
  const apex = cloudDomain.replace(/^api\./i, "").toLowerCase();
  if (apex === "ibosscloud.com" || apex.endsWith(".ibosscloud.com")) {
    return "accounts.iboss.com";
  }
  return `accounts.${apex}`;
}

export function baseUrlFor(hosts: HostMap, tier: HostTier): string | undefined {
  const host = hosts[tier];
  return host ? `https://${host}` : undefined;
}
