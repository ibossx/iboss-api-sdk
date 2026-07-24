import { describe, expect, it } from "vitest";
import { maskValue, redactHeaders, redactValue } from "../../src/client/redact.js";

describe("redact", () => {
  it("masks sensitive headers and keeps others", () => {
    const redacted = redactHeaders({
      Authorization: "Token super-secret-value",
      Cookie: "JSESSIONID=abc",
      "X-XSRF-TOKEN": "xyz",
      "Content-Type": "application/json",
    });
    expect(redacted.Authorization).toBe("[REDACTED]");
    expect(redacted.Cookie).toBe("[REDACTED]");
    expect(redacted["X-XSRF-TOKEN"]).toBe("[REDACTED]");
    expect(redacted["Content-Type"]).toBe("application/json");
  });

  it("masks credential-named fields deep in objects", () => {
    const redacted = redactValue({
      name: "ok",
      apiKey: "abcd1234efgh5678",
      nested: { password: "hunter2hunter2", list: [{ secretValue: "sssssssss" }] },
    }) as Record<string, any>;
    expect(redacted.name).toBe("ok");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.nested.password).toBe("[REDACTED]");
    expect(redacted.nested.list[0].secretValue).toBe("[REDACTED]");
  });

  it("maskValue keeps a short suffix for long values", () => {
    expect(maskValue("shortie")).toBe("[REDACTED]");
    expect(maskValue("abcdefghijklmnop")).toBe("[REDACTED]…mnop");
  });
});
