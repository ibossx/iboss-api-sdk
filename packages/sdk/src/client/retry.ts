/**
 * Retry policy: full-jitter exponential backoff.
 *
 * Retried: network/transport errors (all methods) and 5xx responses for
 * idempotent methods (GET/PUT/DELETE). POST is retried on transport errors
 * only — a 5xx response to a POST may have already mutated state.
 * 4xx responses are never retried.
 */
import type { HttpMethod } from "./errors.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
};

export function backoffDelay(attempt: number, opts: RetryOptions, random = Math.random): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  return Math.floor(exp * random());
}

export function isIdempotent(method: HttpMethod): boolean {
  // PATCH of policyLayers/settings is RFC 7396 merge (DEVELOP-34921) — repeating
  // the same sparse body is safe.
  return method === "GET" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

export function shouldRetryStatus(method: HttpMethod, status: number): boolean {
  return status >= 500 && isIdempotent(method);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
