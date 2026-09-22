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

const HOST_TIERS = new Set<HostTier>(["cloud", "gateway", "reporter", "rbi", "accounts"]);

export function isHostTier(value: string): value is HostTier {
  return HOST_TIERS.has(value as HostTier);
}

/**
 * Infer the host tier from a path prefix so agents can call
 * `client.raw("GET", "/json/...")` without naming the tier.
 *
 *   /json/... and /bulk/...  → gateway
 *   /ibreports/...           → reporter
 *   /ibossauth/...           → accounts
 *   /ibcloud/... (default)   → cloud
 */
export function inferHostTier(path: string): HostTier {
  const pathname = path.startsWith("http://") || path.startsWith("https://")
    ? new URL(path).pathname
    : path.startsWith("/")
      ? path
      : `/${path}`;
  if (pathname.startsWith("/json/") || pathname.startsWith("/bulk/")) return "gateway";
  if (pathname.startsWith("/ibreports/")) return "reporter";
  if (pathname.startsWith("/ibossauth/")) return "accounts";
  return "cloud";
}

/** Pull a hostname out of `host.example.invalid` or `https://host.example.invalid/`. */
export function hostnameFromEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return new URL(trimmed).hostname || undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed.replace(/\/+$/, "");
}

/** Optional gateway / reporter / rbi host overrides (normally discovered). */
export type HostOverrides = Pick<HostMap, "gateway" | "reporter" | "rbi">;

export function hostOverridesFromEnv(env: NodeJS.ProcessEnv = process.env): HostOverrides {
  const gateway =
    hostnameFromEnvValue(env.IBOSS_GATEWAY_HOST) ?? hostnameFromEnvValue(env.IBOSS_GATEWAY_URL);
  const reporter =
    hostnameFromEnvValue(env.IBOSS_REPORTER_HOST) ?? hostnameFromEnvValue(env.IBOSS_REPORTER_URL);
  const rbi = hostnameFromEnvValue(env.IBOSS_RBI_HOST) ?? hostnameFromEnvValue(env.IBOSS_RBI_URL);
  return {
    ...(gateway ? { gateway } : {}),
    ...(reporter ? { reporter } : {}),
    ...(rbi ? { rbi } : {}),
  };
}

export function applyHostOverrides(hosts: HostMap, overrides?: HostOverrides): HostMap {
  if (!overrides) return hosts;
  if (overrides.gateway) hosts.gateway = overrides.gateway;
  if (overrides.reporter) hosts.reporter = overrides.reporter;
  if (overrides.rbi) hosts.rbi = overrides.rbi;
  return hosts;
}
