import { describe, expect, it } from "vitest";
import { IbossClient } from "../../src/client/IbossClient.js";
import { IbossAuthError } from "../../src/client/errors.js";
import {
  CLOUD_HOST,
  GATEWAY_HOST,
  MOCK_API_KEY,
  MOCK_API_KEY_2,
  PRIMARY_ACCOUNT_ID,
  REPORTER_HOST,
  SECOND_ACCOUNT_ID,
} from "../mock-server/fixtures.js";
import { createMockState, mockFetch } from "../mock-server/mockIboss.js";

function makeClient(state = createMockState(), overrides: Record<string, unknown> = {}) {
  return new IbossClient({
    domain: CLOUD_HOST,
    credentials: { apiKey: MOCK_API_KEY },
    fetch: mockFetch(state),
    ...overrides,
  });
}

describe("connect() discovery", () => {
  it("runs the full discovery sequence and builds the session", async () => {
    const state = createMockState();
    const client = makeClient(state);
    const session = await client.connect();

    // An API key is scoped to exactly one account.
    expect(session.accounts).toHaveLength(1);
    expect(session.account.accountSettingsId).toBe(PRIMARY_ACCOUNT_ID);
    expect(session.account.isPrimary).toBe(true);
    expect(session.account.subscriptionFlags.ENABLE_DLP_POLICIES_DASHBOARD).toBe(true);

    // Resolved the API user and credential expiry (epoch seconds → 2100).
    expect(session.ibCloudUserId).toBe("42");
    expect(session.apiCredentialExpiresAt?.getUTCFullYear()).toBe(2100);

    // Discovered node hosts from clusters (primary members only).
    expect(session.hosts.gateway).toBe(GATEWAY_HOST);
    expect(session.hosts.reporter).toBe(REPORTER_HOST);
    expect(session.hosts.gatewayClusterDns).toBe("cluster.example.invalid");

    // Reporter session was primed as the final step.
    expect(state.requests).toContain(`GET ${REPORTER_HOST}/ibreports/web/users/me`);
  });

  it("is idempotent — concurrent connects share one discovery", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    const mySettingsCalls = state.requests.filter((r) => r.includes("mySettings"));
    expect(mySettingsCalls).toHaveLength(1);
  });

  it("a different key sees only its own account", async () => {
    const state = createMockState();
    const client = new IbossClient({
      domain: CLOUD_HOST,
      credentials: { apiKey: MOCK_API_KEY_2 },
      fetch: mockFetch(state),
    });
    const session = await client.connect();
    expect(session.accounts).toHaveLength(1);
    expect(session.account.accountSettingsId).toBe(SECOND_ACCOUNT_ID);
    expect(session.ibCloudUserId).toBe("43");
  });

  it("pinning an account the key cannot see fails with one-key-per-account guidance", async () => {
    const client = makeClient(createMockState(), { accountSettingsId: SECOND_ACCOUNT_ID });
    await expect(client.connect()).rejects.toThrow(/scoped to exactly one account/);
  });

  it("throws IbossAuthError for a bad API key", async () => {
    const state = createMockState();
    const client = new IbossClient({
      domain: CLOUD_HOST,
      credentials: { apiKey: "wrong-key" },
      fetch: mockFetch(state),
    });
    await expect(client.connect()).rejects.toBeInstanceOf(IbossAuthError);
  });

  it("appends accountSettingsId to scoped requests", async () => {
    const state = createMockState();
    const client = makeClient(state);
    await client.connect();
    const clustersCall = state.requests.find((r) => r.includes("clusters"));
    expect(clustersCall).toBeDefined();
    // The mock rejects /clusters without accountSettingsId, so reaching here
    // proves the param was attached. Double-check groups listing too:
    await client.groups.listFilteringGroups();
  });
});
