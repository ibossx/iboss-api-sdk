/**
 * Secret redaction for debug logging. Anything that could carry a credential —
 * auth headers, cookies, or fields whose name suggests a secret — is masked
 * before it can reach a log line.
 */

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-xsrf-token)$/i;
const SENSITIVE_KEY = /token|key|password|secret|credential|session|cookie|auth/i;

const MASK = "[REDACTED]";
const MAX_DEPTH = 8;

/** Mask the value while keeping a short suffix so operators can tell keys apart. */
export function maskValue(value: string): string {
  if (value.length <= 8) return MASK;
  return `${MASK}…${value.slice(-4)}`;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADER.test(name) ? MASK : value;
  }
  return out;
}

/** Deep-clone `input` with any sensitive-named field masked. Safe on cycles via depth cap. */
export function redactValue(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth-limit]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactValue(item, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) && typeof value === "string") {
        out[key] = MASK;
      } else {
        out[key] = redactValue(value, depth + 1);
      }
    }
    return out;
  }
  return String(input);
}
