import type { CredentialProvider } from "./credentials/CredentialProvider.js";
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
  /** Injectable fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Defaults to a silent logger; set IBOSS_DEBUG=1 for redacted console output. */
  logger?: Logger;
  retry?: Partial<RetryOptions>;
  /** The platform expects this UA; override only if you know why. */
  userAgent?: string;
}

export const DEFAULT_USER_AGENT = "ibossAPI";
