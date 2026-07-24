import { describe, expect, it } from "vitest";
import { parseIbossExpiry } from "../../src/client/session.js";

describe("parseIbossExpiry", () => {
  it("parses epoch seconds", () => {
    expect(parseIbossExpiry(4102444800)?.getUTCFullYear()).toBe(2100);
  });

  it("parses epoch milliseconds", () => {
    expect(parseIbossExpiry(4102444800000)?.getUTCFullYear()).toBe(2100);
  });

  it("parses numeric strings", () => {
    expect(parseIbossExpiry("4102444800")?.getUTCFullYear()).toBe(2100);
  });

  it("parses ISO strings", () => {
    expect(parseIbossExpiry("2100-01-01T00:00:00Z")?.getUTCFullYear()).toBe(2100);
  });

  it("returns undefined for empty/invalid values", () => {
    expect(parseIbossExpiry(undefined)).toBeUndefined();
    expect(parseIbossExpiry(null)).toBeUndefined();
    expect(parseIbossExpiry("")).toBeUndefined();
    expect(parseIbossExpiry(0)).toBeUndefined();
    expect(parseIbossExpiry("not-a-date")).toBeUndefined();
    expect(parseIbossExpiry({})).toBeUndefined();
  });
});
