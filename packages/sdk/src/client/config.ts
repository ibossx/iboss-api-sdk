import type { CredentialProvider } from "./credentials/CredentialProvider.js";
import type { HostOverrides } from "./hosts.js";
import type { Logger } from "./logger.js";
import type { RetryOptions } from "./retry.js";

export interface IbossClientConfig {
  /** Cloud base API host for your account, e.g. "api.ibosscloud.com". */
  domain: string;
  /**
   * How to authenticate. Pass `{ apiKey }` (recommended) or any
   * CredentialProvider implementation (e.g. UserPasswordCredentialProvider).
   */
  credentials: CredentialProvider | { apiKey: string };
  /**
   * Select a specific account by accountSettingsId. Defaults to the primary
   * account visible to the credential.
   */
  accountSettingsId?: string;
  /**
   * Optional gateway / reporter / rbi host overrides. Normally discovered
   * by `connect()` from the account's clusters. Use for lab pinning or
   * `IBOSS_GATEWAY_HOST` / `IBOSS_REPORTER_HOST` (see `fromEnv()`).
   */
  hosts?: HostOverrides;
  /** Injectable fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Defaults to a silent logger; set IBOSS_DEBUG=1 for redacted console output. */
  logger?: Logger;
  retry?: Partial<RetryOptions>;
  /**
   * The platform expects `ibossAPI` on every call (gateway and reporter).
   * Override only if you know why — omitting it is an observed 401/403 mode.
   */
  userAgent?: string;
}

export const DEFAULT_USER_AGENT = "ibossAPI";

/** Options shared by `IbossClient.fromEnv` / `fromProfile`. */
export interface FromConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Directory used to load `.env` / `iboss.config.json`. Default: cwd. */
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  logger?: Logger;
  retry?: Partial<RetryOptions>;
  userAgent?: string;
  accountSettingsId?: string;
  hosts?: HostOverrides;
}
