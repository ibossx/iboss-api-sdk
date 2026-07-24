/**
 * RequestLayer — the single choke point every API call goes through.
 *
 * Responsibilities:
 *  - resolve the target host from the tier (cloud / gateway / reporter / rbi / accounts)
 *  - attach standard headers (Authorization: Token, User-Agent, Content-Type)
 *  - per-host cookies and X-XSRF-TOKEN selection (host-specific cookie first,
 *    falling back to the cloud host's XSRF token — mirrors platform behavior)
 *  - retry with full-jitter backoff (POST retries transport errors only)
 *  - map error statuses to the typed error hierarchy
 *  - redacted debug logging
 */
import { CookieJar } from "./cookies.js";
import type { Credential, CredentialProvider } from "./credentials/CredentialProvider.js";
import {
  IbossApiError,
  IbossAuthError,
  IbossHostUnavailableError,
  IbossNetworkError,
  IbossSubscriptionError,
  IbossXsrfError,
  type HttpMethod,
} from "./errors.js";
import { accountsHostFor, baseUrlFor, type HostMap, type HostTier } from "./hosts.js";
import type { Logger } from "./logger.js";
import { redactHeaders } from "./redact.js";
import { backoffDelay, DEFAULT_RETRY, shouldRetryStatus, sleep, type RetryOptions } from "./retry.js";

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Append accountSettingsId=<selected account> to the query string.
   * Defaults to true for all tiers except "accounts" once an account is
   * selected (cloud, gateway, and reporter endpoints all expect it).
   */
  withAccountId?: boolean;
  /** Return the raw Response instead of parsed JSON (streaming/exports). */
  raw?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface RequestLayerInit {
  domain: string;
  provider: CredentialProvider;
  fetchImpl: typeof globalThis.fetch;
  logger: Logger;
  retry?: Partial<RetryOptions>;
  userAgent: string;
}

const MUTATING = new Set<HttpMethod>(["POST", "PUT", "DELETE", "PATCH"]);
const BODY_SNIPPET = 1000;

export class RequestLayer {
  readonly jar = new CookieJar();
  readonly hosts: HostMap;
  /** Set after discovery selects an account. */
  accountSettingsId?: string;
  /** Set after discovery; used to enrich 422 subscription errors. */
  subscriptionFlags?: Record<string, boolean>;

  private readonly domain: string;
  private readonly provider: CredentialProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly logger: Logger;
  private readonly retry: RetryOptions;
  private readonly userAgent: string;
  private credential?: Credential;

  constructor(init: RequestLayerInit) {
    this.domain = init.domain;
    this.provider = init.provider;
    this.fetchImpl = init.fetchImpl;
    this.logger = init.logger;
    this.retry = { ...DEFAULT_RETRY, ...init.retry };
    this.userAgent = init.userAgent;
    this.hosts = {
      cloud: init.domain,
      accounts: accountsHostFor(init.domain),
    };
  }

  /** Resolve the absolute base URL for a tier, or throw a descriptive error. */
  baseUrl(tier: HostTier): string {
    const url = baseUrlFor(this.hosts, tier);
    if (!url) throw new IbossHostUnavailableError(tier);
    return url;
  }

  async request<T = unknown>(
    tier: HostTier,
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(tier, path, opts);
    const response = await this.execute(method, url, opts, /* allowAuthRefresh */ true);

    if (opts.raw) return response as unknown as T;

    const text = await response.text();
    if (!text) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json") || looksLikeJson(text)) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // fall through to raw text
      }
    }
    return text as unknown as T;
  }

  private buildUrl(tier: HostTier, path: string, opts: RequestOptions): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl(tier));
    const withAccountId = opts.withAccountId ?? tier !== "accounts";
    if (withAccountId && this.accountSettingsId && !url.searchParams.has("accountSettingsId")) {
      url.searchParams.set("accountSettingsId", this.accountSettingsId);
    }
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async buildHeaders(method: HttpMethod, url: string, opts: RequestOptions): Promise<Record<string, string>> {
    if (!this.credential) {
      this.credential = await this.provider.getCredential(this.credentialContext());
    }
    const headers: Record<string, string> = {
      Authorization: `Token ${this.credential.token}`,
      "User-Agent": this.userAgent,
      Accept: "application/json, text/plain, */*",
      ...opts.headers,
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] ??= "application/json;charset=UTF-8";
    }
    const cookies = this.jar.cookieHeaderFor(url);
    if (cookies) headers["Cookie"] = cookies;

    // The platform expects X-XSRF-TOKEN on every request (GETs included).
    // Prefer the token the target host issued; fall back to the cloud host's
    // token (accepted by gateway/reporter nodes before they issue their own).
    const xsrf = this.jar.get("XSRF-TOKEN", url) ?? this.jar.get("XSRF-TOKEN", this.baseUrl("cloud"));
    if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
    return headers;
  }

  private credentialContext() {
    return { domain: this.domain, fetch: this.fetchImpl, logger: this.logger };
  }

  private async execute(
    method: HttpMethod,
    url: string,
    opts: RequestOptions,
    allowAuthRefresh: boolean,
  ): Promise<Response> {
    let lastNetworkError: unknown;

    for (let attempt = 0; attempt < this.retry.maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt - 1, this.retry), opts.signal);
      }

      const headers = await this.buildHeaders(method, url, opts);
      this.logger.debug(`${method} ${url}`, { attempt, headers: redactHeaders(headers) });

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal,
        });
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        lastNetworkError = error;
        this.logger.warn(`Network error on ${method} ${url} (attempt ${attempt + 1})`, {
          error: String(error),
        });
        continue; // transport errors are retried for all methods
      }

      this.jar.storeFromResponse(url, response);

      if (response.ok) return response;

      if (response.status === 401 && allowAuthRefresh && this.provider.refresh) {
        this.logger.debug("401 received — refreshing credential and retrying once");
        this.credential = await this.provider.refresh(this.credentialContext());
        return this.execute(method, url, opts, false);
      }

      if (shouldRetryStatus(method, response.status) && attempt < this.retry.maxAttempts - 1) {
        this.logger.warn(`HTTP ${response.status} on ${method} ${url} — retrying`);
        continue;
      }

      throw await this.toError(method, url, response);
    }

    throw new IbossNetworkError(
      `Request failed after ${this.retry.maxAttempts} attempts: ${method} ${url}`,
      lastNetworkError,
    );
  }

  private async toError(method: HttpMethod, url: string, response: Response): Promise<IbossApiError> {
    const body = (await response.text().catch(() => "")).slice(0, BODY_SNIPPET);
    const details = { method, url, status: response.status, body };

    if (response.status === 401) {
      return new IbossAuthError(
        "Authentication failed (401). The API key/token is missing, expired, revoked, " +
          "or not valid for this cloud domain.",
        details,
      );
    }
    if (response.status === 403 && MUTATING.has(method)) {
      return new IbossXsrfError(
        "Request forbidden (403). This usually means the X-XSRF-TOKEN header did not match " +
          "the session cookie for the target host. See docs/api/errors-and-gotchas.md.",
        details,
      );
    }
    if (response.status === 422) {
      return new IbossSubscriptionError(
        "The platform rejected the request (422). This often means the account is not " +
          "subscribed to the module being configured, or the payload shape is invalid.",
        details,
        this.subscriptionFlags,
      );
    }
    return new IbossApiError(`HTTP ${response.status} from ${method} ${url}`, details);
  }
}

function looksLikeJson(text: string): boolean {
  const first = text.trimStart()[0];
  return first === "{" || first === "[" || first === '"';
}
