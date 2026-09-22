import { describe, expect, it } from "vitest";
import { accountsHostFor, baseUrlFor, inferHostTier } from "../../src/client/hosts.js";

describe("accountsHostFor", () => {
  it("maps the production cloud to accounts.iboss.com", () => {
    expect(accountsHostFor("api.ibosscloud.com")).toBe("accounts.iboss.com");
    expect(accountsHostFor("ibosscloud.com")).toBe("accounts.iboss.com");
  });

  it("prefixes accounts. for other domains, stripping an api. prefix", () => {
    expect(accountsHostFor("api.example.invalid")).toBe("accounts.example.invalid");
    expect(accountsHostFor("example.invalid")).toBe("accounts.example.invalid");
  });
});

describe("baseUrlFor", () => {
  it("returns https URLs for known tiers and undefined otherwise", () => {
    const hosts = { cloud: "cloud.example.invalid" };
    expect(baseUrlFor(hosts, "cloud")).toBe("https://cloud.example.invalid");
    expect(baseUrlFor(hosts, "gateway")).toBeUndefined();
  });
});

describe("inferHostTier", () => {
  it("maps path prefixes to gateway / reporter / cloud / accounts", () => {
    expect(inferHostTier("/json/controls/policyLayers/settings")).toBe("gateway");
    expect(inferHostTier("/ibreports/web/reports/lite")).toBe("reporter");
    expect(inferHostTier("/ibcloud/web/users/mySettings")).toBe("cloud");
    expect(inferHostTier("/ibossauth/web/tokens")).toBe("accounts");
  });
});
