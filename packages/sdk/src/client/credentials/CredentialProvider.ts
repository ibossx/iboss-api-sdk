/**
 * Pluggable authentication.
 *
 * Every iboss API request carries `Authorization: Token <token>`. Where that
 * token comes from is the provider's job:
 *
 *  - ApiKeyCredentialProvider: the API key IS the token (recommended).
 *  - UserPasswordCredentialProvider: exchanges username/password (+ optional
 *    MFA) for a short-lived session token via the accounts host.
 */
import type { Logger } from "../logger.js";

export interface Credential {
  /** Value used as `Authorization: Token <token>`. */
  token: string;
  /** When the token/key expires, if known. */
  expiresAt?: Date;
}

export interface CredentialContext {
  /** Cloud base API host, e.g. "api.ibosscloud.com". */
  domain: string;
  fetch: typeof globalThis.fetch;
  logger: Logger;
}

export interface CredentialProvider {
  /** Return a credential. Called lazily; providers may cache. */
  getCredential(ctx: CredentialContext): Promise<Credential>;
  /**
   * Invalidate any cache and acquire a fresh credential. Called at most once
   * after a 401 before the request fails with IbossAuthError. Providers with
   * non-renewable credentials (static API keys) omit this.
   */
  refresh?(ctx: CredentialContext): Promise<Credential>;
}
