/**
 * Typed error hierarchy for the iboss API client.
 *
 * Every non-2xx response is mapped to one of these so callers (and AI-authored
 * workflows) can branch on error class instead of parsing message strings.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface IbossApiErrorDetails {
  method: HttpMethod;
  url: string;
  status: number;
  /** Raw response body text, truncated for readability. */
  body?: string;
}

/** Base class for all errors raised by the SDK. */
export class IbossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A non-2xx HTTP response from the iboss API. */
export class IbossApiError extends IbossError {
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number;
  readonly body?: string;

  constructor(message: string, details: IbossApiErrorDetails) {
    super(message);
    this.method = details.method;
    this.url = details.url;
    this.status = details.status;
    this.body = details.body;
  }
}

/**
 * 401 — the credential was rejected. With a static API key this is terminal:
 * the key is missing, expired, revoked, or scoped to a different cloud domain.
 */
export class IbossAuthError extends IbossApiError {}

/**
 * 403 on a mutating request — almost always a missing/incorrect X-XSRF-TOKEN
 * or unprimed host session rather than a permissions problem.
 * See docs/api/errors-and-gotchas.md.
 */
export class IbossXsrfError extends IbossApiError {}

/**
 * 422 — the platform rejected the request, commonly because the account lacks
 * a subscription to the module being configured (e.g. DLP, ZTNA).
 */
export class IbossSubscriptionError extends IbossApiError {
  /** Subscription feature flags known for the account, when available. */
  readonly subscriptionFlags?: Record<string, boolean>;

  constructor(
    message: string,
    details: IbossApiErrorDetails,
    subscriptionFlags?: Record<string, boolean>,
  ) {
    super(message, details);
    this.subscriptionFlags = subscriptionFlags;
  }
}

/**
 * The account has no node of the required type (e.g. no reporting cluster),
 * so requests to that host tier cannot be made.
 */
export class IbossHostUnavailableError extends IbossError {
  readonly tier: string;

  constructor(tier: string, message?: string) {
    super(
      message ??
        `No "${tier}" node is available for this account. ` +
          `The account may not have a ${tier} cluster provisioned.`,
    );
    this.tier = tier;
  }
}

/** The client was used before connect() succeeded, or the session is unusable. */
export class IbossNotConnectedError extends IbossError {
  constructor(message = "Client is not connected. Call client.connect() first.") {
    super(message);
  }
}

/** Network-level failure (DNS, TLS, timeout) after retries were exhausted. */
export class IbossNetworkError extends IbossError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * A settings POST reported success but a follow-up GET did not show the
 * intended fields (bitmap bit, categoriesSelectedType, settings keys, …).
 * Empty `saveIgnoredEntries` is not persistence — always re-GET.
 */
export class IbossVerifyError extends IbossError {
  readonly customCategoryId?: number;
  readonly failures: string[];
  readonly actual?: Record<string, unknown>;

  constructor(
    message: string,
    opts?: {
      customCategoryId?: number;
      failures?: string[];
      actual?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.customCategoryId = opts?.customCategoryId;
    this.failures = opts?.failures ?? [];
    this.actual = opts?.actual;
  }
}

/**
 * Typed destinations cannot be expressed on this policy (allowlist/blocklist
 * silently drops the categories bitmap). Delete and recreate as categories-type.
 */
export class IbossPolicyTypeError extends IbossError {
  readonly customCategoryId?: number;
  readonly customType?: unknown;

  constructor(message: string, opts?: { customCategoryId?: number; customType?: unknown }) {
    super(message);
    this.customCategoryId = opts?.customCategoryId;
    this.customType = opts?.customType;
  }
}
