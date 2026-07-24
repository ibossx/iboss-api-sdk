/**
 * Use the raw escape hatch for endpoints without a typed wrapper.
 *
 *   npx tsx examples/02-raw-request.ts
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

const profile = resolveProfile();
const client = new IbossClient({
  domain: profile.domain,
  credentials: { apiKey: profile.apiKey },
});

// Tier is explicit with raw(): "cloud" | "gateway" | "reporter" | "rbi" | "accounts".
// accountSettingsId is appended automatically.
const clusters = await client.raw<unknown[]>("cloud", "GET", "/ibcloud/web/account/clusters");
console.log(JSON.stringify(clusters, null, 2));
