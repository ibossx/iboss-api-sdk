/**
 * Create a blocklist policy layer and add domains to it — the SDK wraps the
 * platform's two-step create+settings flow in one call.
 *
 *   npx tsx examples/03-create-blocklist-layer.ts blocked.example.com another.example.com
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

const domains = process.argv.slice(2);
if (domains.length === 0) {
  console.error("Usage: npx tsx examples/03-create-blocklist-layer.ts <domain> [domain...]");
  process.exit(1);
}

const profile = resolveProfile();
const client = new IbossClient({
  domain: profile.domain,
  credentials: { apiKey: profile.apiKey },
});

const LAYER_NAME = "Example Blocklist";

// Idempotent: reuse the layer if a previous run created it.
const layers = await client.policies.listLayers();
let layerId = layers.find((l) => l.customCategoryName === LAYER_NAME)?.customCategoryId;

if (layerId === undefined) {
  const created = await client.policies.createLayer({
    name: LAYER_NAME,
    type: "blocklist",
    settings: { policyAction: 0 }, // block
  });
  layerId = created.customCategoryId;
  console.log(`Created layer "${LAYER_NAME}" (id ${layerId})`);
} else {
  console.log(`Reusing layer "${LAYER_NAME}" (id ${layerId})`);
}

for (const domain of domains) {
  await client.policies.addLayerUrl(layerId, domain);
  console.log(`+ ${domain}`);
}
