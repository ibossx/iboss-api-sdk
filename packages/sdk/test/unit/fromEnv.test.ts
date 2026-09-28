import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { hostnameFromEnvValue, inferHostTier } from "../../src/client/hosts.js";
import { CLOUD_HOST, GATEWAY_HOST, MOCK_API_KEY, REPORTER_HOST } from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

describe("inferHostTier", () => {
  it("routes /json and /bulk to gateway, /ibreports to reporter", () => {
    expect(inferHostTier("/json/controls/policyLayers/settings")).toBe("gateway");
    expect(inferHostTier("/bulk/controls/policyLayers/urls")).toBe("gateway");
    expect(inferHostTier("/ibreports/web/aiSecurityGovernance/conversations")).toBe("reporter");
    expect(inferHostTier("/ibcloud/web/users/mySettings")).toBe("cloud");
    expect(inferHostTier("/ibossauth/web/tokens")).toBe("accounts");
  });
});

describe("hostnameFromEnvValue", () => {
  it("accepts bare hosts and full URLs", () => {
    expect(hostnameFromEnvValue("gateway.node.example.invalid")).toBe("gateway.node.example.invalid");
    expect(hostnameFromEnvValue("https://reporter.node.example.invalid/")).toBe(
      "reporter.node.example.invalid",
    );
    expect(hostnameFromEnvValue("")).toBeUndefined();
  });
});

describe("IbossClient.fromEnv / fromProfile", () => {
  it("builds a client from IBOSS_API_KEY + IBOSS_CLOUD_DOMAIN + node hosts", async () => {
    const state = createMockState();
    const client = IbossClient.fromEnv({
      env: {
        IBOSS_CLOUD_DOMAIN: CLOUD_HOST,
        IBOSS_API_KEY: MOCK_API_KEY,
        IBOSS_GATEWAY_HOST: "override-gateway.example.invalid",
        IBOSS_REPORTER_URL: `https://${REPORTER_HOST}/`,
      },
      fetch: mockFetch(state),
    });
    const session = await client.connect();
    expect(session.hosts.gateway).toBe("override-gateway.example.invalid");
    expect(session.hosts.reporter).toBe(REPORTER_HOST);

    const auth = state.requestMeta.find((r) => r.path.includes("mySettings"));
    expect(auth?.authorization).toBe(`Token ${MOCK_API_KEY}`);
    expect(auth?.userAgent).toBe("ibossAPI");
  });

  it("loads a local .env without falling through to iboss.config.json", () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-fromenv-"));
    writeFileSync(
      join(cwd, ".env"),
      `IBOSS_CLOUD_DOMAIN=${CLOUD_HOST}\nIBOSS_API_KEY=${MOCK_API_KEY}\n`,
    );
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        profiles: { other: { domain: "file.example.invalid", apiKey: "file-key-not-a-real-credential" } },
      }),
    );
    const isolated = { IBOSS_CONFIG_HOME: mkdtempSync(join(tmpdir(), "iboss-home-")) } as NodeJS.ProcessEnv;
    const client = IbossClient.fromEnv({ cwd, env: isolated, fetch: mockFetch(createMockState()) });
    expect(client).toBeInstanceOf(IbossClient);
  });

  it("throws when env credentials are missing", () => {
    expect(() =>
      IbossClient.fromEnv({
        env: { IBOSS_CONFIG_HOME: mkdtempSync(join(tmpdir(), "iboss-home-")) },
        cwd: mkdtempSync(join(tmpdir(), "iboss-empty-")),
      }),
    ).toThrow(/IBOSS_CLOUD_DOMAIN and IBOSS_API_KEY/);
  });

  it("fromProfile uses the same files as the CLI", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "iboss-profile-"));
    const home = mkdtempSync(join(tmpdir(), "iboss-home-"));
    writeFileSync(
      join(cwd, "iboss.config.json"),
      JSON.stringify({
        defaultProfile: "lab",
        profiles: { lab: { domain: CLOUD_HOST, apiKey: MOCK_API_KEY } },
      }),
    );
    const state = createMockState();
    const client = IbossClient.fromProfile("lab", {
      cwd,
      env: { IBOSS_CONFIG_HOME: home },
      fetch: mockFetch(state),
    });
    const session = await client.connect();
    expect(session.hosts.gateway).toBe(GATEWAY_HOST);
  });
});
