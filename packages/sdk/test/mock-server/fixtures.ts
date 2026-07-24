/**
 * 100% synthetic fixtures for the mock iboss server. No real tenant data.
 *
 * Faithful to the platform: an API key is scoped to exactly ONE account —
 * mySettings returns only that key's account. Multi-account operations use
 * one key per account (MOCK_API_KEY → 1001, MOCK_API_KEY_2 → 1002).
 */

export const MOCK_API_KEY = "test-key-not-a-real-credential";
export const MOCK_API_KEY_2 = "test-key2-not-a-real-credential";

export const CLOUD_HOST = "cloud.example.invalid";
export const GATEWAY_HOST = "gateway.node.example.invalid";
export const REPORTER_HOST = "reporter.node.example.invalid";
export const CLUSTER_DNS = "cluster.example.invalid";

export const CLOUD_XSRF = "cloud-xsrf-0001";
export const GATEWAY_XSRF = "gateway-xsrf-0001";
export const REPORTER_XSRF = "reporter-xsrf-0001";

export const PRIMARY_ACCOUNT_ID = "1001";
export const SECOND_ACCOUNT_ID = "1002";

export interface MockKeyScope {
  accountSettingsId: string;
  accountName: string;
  ibCloudUserId: number;
  subscriptionSettings: Record<string, unknown>;
}

/** Which single account each API key can see. */
export const KEY_SCOPES: Record<string, MockKeyScope> = {
  [MOCK_API_KEY]: {
    accountSettingsId: PRIMARY_ACCOUNT_ID,
    accountName: "Example Primary Account",
    ibCloudUserId: 42,
    subscriptionSettings: {
      ENABLE_DLP_POLICIES_DASHBOARD: {},
      ENABLE_PRIVATE_ACCESS: {},
    },
  },
  [MOCK_API_KEY_2]: {
    accountSettingsId: SECOND_ACCOUNT_ID,
    accountName: "Example Second Account",
    ibCloudUserId: 43,
    subscriptionSettings: {},
  },
};

export function mySettingsFor(scope: MockKeyScope) {
  return [
    {
      accountSettingsId: Number(scope.accountSettingsId),
      accountName: scope.accountName,
      // Each key's account presents as the primary for that key.
      delegatedSuperAdminId: 0,
      subscriptionFeatureContext: {
        subscriptionSettings: scope.subscriptionSettings,
      },
    },
  ];
}

export const clustersResponse = [
  {
    productFamily: "swg",
    clusterFullDns: CLUSTER_DNS,
    members: [
      { primary: 0, cloudNode: { adminInterfaceDns: "standby.node.example.invalid" } },
      { primary: 1, cloudNode: { adminInterfaceDns: GATEWAY_HOST } },
    ],
  },
  {
    productFamily: "reports",
    members: [{ primary: 1, cloudNode: { adminInterfaceDns: REPORTER_HOST } }],
  },
];
