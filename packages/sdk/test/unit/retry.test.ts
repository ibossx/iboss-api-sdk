import { describe, expect, it } from "vitest";
import { backoffDelay, DEFAULT_RETRY, isIdempotent, shouldRetryStatus } from "../../src/client/retry.js";

describe("retry policy", () => {
  it("treats GET/PUT/DELETE as idempotent, POST as not", () => {
    expect(isIdempotent("GET")).toBe(true);
    expect(isIdempotent("PUT")).toBe(true);
    expect(isIdempotent("DELETE")).toBe(true);
    expect(isIdempotent("POST")).toBe(false);
  });

  it("retries 5xx only for idempotent methods", () => {
    expect(shouldRetryStatus("GET", 502)).toBe(true);
    expect(shouldRetryStatus("POST", 502)).toBe(false);
    expect(shouldRetryStatus("GET", 404)).toBe(false);
    expect(shouldRetryStatus("GET", 422)).toBe(false);
  });

  it("backoff grows exponentially and respects the cap with full jitter", () => {
    const opts = { ...DEFAULT_RETRY, baseDelayMs: 100, maxDelayMs: 1000 };
    // random() = 1 → the full exponential value
    expect(backoffDelay(0, opts, () => 1)).toBe(100);
    expect(backoffDelay(1, opts, () => 1)).toBe(200);
    expect(backoffDelay(5, opts, () => 1)).toBe(1000); // capped
    // random() = 0 → jitter can shrink to zero
    expect(backoffDelay(3, opts, () => 0)).toBe(0);
  });
});
