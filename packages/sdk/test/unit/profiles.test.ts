import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseDotEnv,
  removeProfileAccount,
  resolveProfile,
  upsertProfileAccount,
  type IbossConfigFile,
} from "../../src/config/profiles.js";

// Point the user-global config at an empty temp dir so tests never read a
// developer's real ~/.iboss/config.json.
const isolatedHome = mkdtempSync(join(tmpdir(), "iboss-sdk-home-"));
const noEnv = { IBOSS_CONFIG_HOME: isolatedHome } as NodeJS.ProcessEnv;

describe("parseDotEnv", () => {
  it("parses simple pairs, quotes, and comments", () => {
    const parsed = parseDotEnv(
      ['# comment', "A=1", 'B="two words"', "C='sq'", "", "bad-line", "D=x=y"].join("\n"),
    );
    expect(parsed).toEqual({ A: "1", B: "two words", C: "sq", D: "x=y" });
  });
});

describe("resolveProfile precedence", () => {
  it("uses explicit overrides first", () => {
    const resolved = resolveProfile({
      overrides: { domain: "override.example.invalid", apiKey: "override-key" },
      cwd: mkdtempSync(join(tmpdir(), "iboss-sdk-test-")),
      env: { IBOSS_CLOUD_DOMAIN: "env.example.invalid", IBOSS_API_KEY: "env-key" },
    });
    expect(resolved.source).toBe("override");
    expect(resolved.domain).toBe("override.example.invalid");
  });

  it("uses env vars over project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({ profiles: { p: { domain: "file.example.invalid", apiKey: "file-key" } } }),
    );
    const resolved = resolveProfile({
      cwd,
      env: { IBOSS_CLOUD_DOMAIN: "env.example.invalid", IBOSS_API_KEY: "env-key" },
    });
    expect(resolved.source).toBe("env");
  });

  it("loads .env when real env vars are absent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(join(cwd, ".env"), "IBOSS_CLOUD_DOMAIN=dotenv.example.invalid\nIBOSS_API_KEY=dotenv-key\n");
    const resolved = resolveProfile({ cwd, env: noEnv });
    expect(resolved.source).toBe("env");
    expect(resolved.domain).toBe("dotenv.example.invalid");
  });

  it("ignores placeholder API keys from an unedited .env, falling through to saved profiles", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    // Simulates `cp .env.example .env` with the lines uncommented but unedited.
    writeFileSync(
      join(cwd, ".env"),
      "IBOSS_CLOUD_DOMAIN=api.ibosscloud.com\nIBOSS_API_KEY=your-api-key-here\n",
    );
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        profiles: { saved: { domain: "cloud.example.invalid", apiKey: "key-real-not-a-real-credential" } },
      }),
    );
    const resolved = resolveProfile({ cwd, env: noEnv });
    expect(resolved.source).toBe("project-config");
    expect(resolved.domain).toBe("cloud.example.invalid");
  });

  it("also treats angle-bracket template keys as unset", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(join(cwd, ".env"), "IBOSS_CLOUD_DOMAIN=cloud.example.invalid\nIBOSS_API_KEY=<API_KEY>\n");
    expect(() => resolveProfile({ cwd, env: noEnv })).toThrow(/IBOSS_CLOUD_DOMAIN/);
  });

  it("falls back to project config and honors defaultProfile", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        defaultProfile: "lab",
        profiles: {
          prod: { domain: "prod.example.invalid", apiKey: "k1" },
          lab: { domain: "lab.example.invalid", apiKey: "k2", accountSettingsId: "1001" },
        },
      }),
    );
    const resolved = resolveProfile({ cwd, env: noEnv });
    expect(resolved.source).toBe("project-config");
    expect(resolved.profileName).toBe("lab");
    expect(resolved.accountSettingsId).toBe("1001");
  });

  it("selects a named profile explicitly", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        defaultProfile: "lab",
        profiles: {
          prod: { domain: "prod.example.invalid", apiKey: "k1" },
          lab: { domain: "lab.example.invalid", apiKey: "k2" },
        },
      }),
    );
    const resolved = resolveProfile({ cwd, env: noEnv, profile: "prod" });
    expect(resolved.profileName).toBe("prod");
  });

  it("throws an actionable error when nothing is configured", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    expect(() => resolveProfile({ cwd, env: noEnv })).toThrow(/IBOSS_CLOUD_DOMAIN/);
  });
});

describe("multi-account profiles (one API key per account)", () => {
  function writeFleetConfig(cwd: string) {
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        defaultProfile: "fleet",
        profiles: {
          fleet: {
            domain: "cloud.example.invalid",
            accounts: [
              { name: "hq", apiKey: "key-hq-not-a-real-credential" },
              {
                name: "emea",
                apiKey: "key-emea-not-a-real-credential",
                domain: "cloud-eu.example.invalid",
                accountSettingsId: "2002",
              },
            ],
          },
        },
      }),
    );
  }

  it("normalizes the accounts list and selects the first account by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFleetConfig(cwd);
    const resolved = resolveProfile({ cwd, env: noEnv });
    expect(resolved.accounts).toHaveLength(2);
    expect(resolved.account.name).toBe("hq");
    // Convenience mirrors follow the selected account.
    expect(resolved.domain).toBe("cloud.example.invalid");
    // Per-account domain override applies.
    expect(resolved.accounts[1]).toMatchObject({
      name: "emea",
      domain: "cloud-eu.example.invalid",
      accountSettingsId: "2002",
    });
  });

  it("selects an account by name or by accountSettingsId", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFleetConfig(cwd);
    expect(resolveProfile({ cwd, env: noEnv, account: "emea" }).account.name).toBe("emea");
    expect(resolveProfile({ cwd, env: noEnv, account: "2002" }).account.name).toBe("emea");
  });

  it("rejects an unknown account with the available names", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFleetConfig(cwd);
    expect(() => resolveProfile({ cwd, env: noEnv, account: "apac" })).toThrow(/hq, emea/);
  });

  it("single-key profiles normalize to a one-entry account list named after the profile", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        profiles: { solo: { domain: "cloud.example.invalid", apiKey: "key-solo-not-a-real-credential" } },
      }),
    );
    const resolved = resolveProfile({ cwd, env: noEnv });
    expect(resolved.accounts).toHaveLength(1);
    expect(resolved.account.name).toBe("solo");
  });

  it("on a single-account profile, an unmatched --account pins the accountSettingsId (legacy behavior)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        profiles: { solo: { domain: "cloud.example.invalid", apiKey: "key-solo-not-a-real-credential" } },
      }),
    );
    const resolved = resolveProfile({ cwd, env: noEnv, account: "9999" });
    expect(resolved.account.accountSettingsId).toBe("9999");
  });

  it("rejects duplicate account names in a profile", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-sdk-test-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        profiles: {
          fleet: {
            domain: "cloud.example.invalid",
            accounts: [
              { name: "dup", apiKey: "key-a-not-a-real-credential" },
              { name: "dup", apiKey: "key-b-not-a-real-credential" },
            ],
          },
        },
      }),
    );
    expect(() => resolveProfile({ cwd, env: noEnv })).toThrow(/unique/);
  });
});

describe("upsertProfileAccount / removeProfileAccount (iboss accounts add/remove)", () => {
  const key = (suffix: string) => `key-${suffix}-not-a-real-credential`;

  it("creates the profile with the simple shape when the account is named after it", () => {
    const config: IbossConfigFile = { profiles: {} };
    const result = upsertProfileAccount(config, "default", {
      name: "default",
      domain: "cloud.example.invalid",
      apiKey: key("a"),
    });
    expect(result).toEqual({ added: true, accountCount: 1 });
    expect(config.profiles.default).toEqual({ domain: "cloud.example.invalid", apiKey: key("a") });
    expect(config.defaultProfile).toBe("default");
  });

  it("reports add vs update: same name updates the key, new name grows the set", () => {
    const config: IbossConfigFile = { profiles: {} };
    expect(
      upsertProfileAccount(config, "default", { name: "hq", domain: "cloud.example.invalid", apiKey: key("v1") }),
    ).toEqual({ added: true, accountCount: 1 });
    // Same name again: update, not a duplicate.
    expect(
      upsertProfileAccount(config, "default", { name: "hq", domain: "cloud.example.invalid", apiKey: key("v2") }),
    ).toEqual({ added: false, accountCount: 1 });
    // Different name: the set grows.
    expect(
      upsertProfileAccount(config, "default", { name: "emea", domain: "cloud.example.invalid", apiKey: key("e") }),
    ).toEqual({ added: true, accountCount: 2 });
  });

  it("converts a single-key profile to the accounts shape when a second key is added", () => {
    const config: IbossConfigFile = {
      profiles: { prod: { domain: "cloud.example.invalid", apiKey: key("hq") } },
    };
    upsertProfileAccount(config, "prod", { name: "emea", domain: "cloud.example.invalid", apiKey: key("emea") });
    expect(config.profiles.prod).toEqual({
      domain: "cloud.example.invalid",
      accounts: [
        { name: "prod", apiKey: key("hq") },
        { name: "emea", apiKey: key("emea") },
      ],
    });
  });

  it("updates an existing account in place and records per-account domain overrides", () => {
    const config: IbossConfigFile = { profiles: {} };
    upsertProfileAccount(config, "fleet", { name: "hq", domain: "cloud.example.invalid", apiKey: key("v1") });
    upsertProfileAccount(config, "fleet", { name: "lab", domain: "lab.example.invalid", apiKey: key("lab") });
    upsertProfileAccount(config, "fleet", { name: "hq", domain: "cloud.example.invalid", apiKey: key("v2") });
    const profile = config.profiles.fleet as { accounts: { name: string; apiKey: string; domain?: string }[] };
    expect(profile.accounts).toHaveLength(2);
    expect(profile.accounts[0]).toEqual({ name: "hq", apiKey: key("v2") });
    expect(profile.accounts[1]).toEqual({ name: "lab", apiKey: key("lab"), domain: "lab.example.invalid" });
  });

  it("removes an account and collapses back to the simple shape when appropriate", () => {
    const config: IbossConfigFile = { profiles: {} };
    upsertProfileAccount(config, "prod", { name: "prod", domain: "cloud.example.invalid", apiKey: key("hq") });
    upsertProfileAccount(config, "prod", { name: "emea", domain: "cloud.example.invalid", apiKey: key("emea") });
    const result = removeProfileAccount(config, "prod", "emea");
    expect(result.removedProfile).toBe(false);
    expect(config.profiles.prod).toEqual({ domain: "cloud.example.invalid", apiKey: key("hq") });
  });

  it("removing the last account removes the profile and reassigns the default", () => {
    const config: IbossConfigFile = { profiles: {} };
    upsertProfileAccount(config, "solo", { name: "solo", domain: "cloud.example.invalid", apiKey: key("a") });
    upsertProfileAccount(config, "other", { name: "other", domain: "cloud.example.invalid", apiKey: key("b") });
    config.defaultProfile = "solo";
    const result = removeProfileAccount(config, "solo", "solo");
    expect(result.removedProfile).toBe(true);
    expect(config.profiles.solo).toBeUndefined();
    expect(config.defaultProfile).toBe("other");
  });

  it("rejects removing an unknown account with the available names", () => {
    const config: IbossConfigFile = { profiles: {} };
    upsertProfileAccount(config, "prod", { name: "hq", domain: "cloud.example.invalid", apiKey: key("a") });
    expect(() => removeProfileAccount(config, "prod", "nope")).toThrow(/hq/);
    expect(() => removeProfileAccount(config, "ghost", "hq")).toThrow(/not found/);
  });
});
