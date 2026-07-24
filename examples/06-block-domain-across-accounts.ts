/**
 * Library-mode fleet example: block a domain on every account configured in
 * the profile. An API key belongs to exactly one account, so the profile
 * lists one key per account; this script loops over those credentials with
 * an isolated client per account.
 *
 *   npx tsx examples/06-block-domain-across-accounts.ts blocked.example.com
 *
 * (For the same thing as a reusable workflow, see workflows/block-domains-fleet.)
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: npx tsx examples/06-block-domain-across-accounts.ts <domain>");
  process.exit(1);
}

const LAYER_NAME = "SDK Blocklist";
const profile = resolveProfile();
console.log(`Profile has ${profile.accounts.length} account(s).`);

for (const credential of profile.accounts) {
  try {
    const client = new IbossClient({
      domain: credential.domain,
      credentials: { apiKey: credential.apiKey },
      accountSettingsId: credential.accountSettingsId,
    });
    const session = await client.connect();
    const label = `${credential.name} (${session.account.accountSettingsId})`;

    const layers = await client.policies.listLayers();
    let layerId = layers.find((l) => l.customCategoryName === LAYER_NAME)?.customCategoryId;
    if (layerId === undefined) {
      const created = await client.policies.createLayer({
        name: LAYER_NAME,
        type: "blocklist",
        settings: { policyAction: 0 },
      });
      layerId = created.customCategoryId;
      console.log(`${label}: created layer "${LAYER_NAME}"`);
    }

    const existing = (await client.policies.getLayerUrls(layerId)).some((u) => u.url === domain);
    if (existing) {
      console.log(`${label}: ${domain} already blocked`);
    } else {
      await client.policies.addLayerUrl(layerId, domain);
      console.log(`${label}: blocked ${domain}`);
    }
  } catch (error) {
    // One bad key or unsubscribed account should not stop the rest.
    console.error(`${credential.name}: failed - ${error instanceof Error ? error.message : error}`);
  }
}
