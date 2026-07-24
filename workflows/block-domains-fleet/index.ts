/**
 * Fleet workflow: add domains to a blocklist policy layer on EVERY account
 * configured in the profile. An iboss API key belongs to exactly one account,
 * so the profile lists one key per account (see iboss.config.example.json);
 * ctx.forEachAccount iterates them with an isolated client per account.
 *
 *   npx iboss run block-domains-fleet --input domains=bad.example.com,worse.example.com
 *
 * Idempotent: re-runs find the existing layer and skip domains already on it.
 * Accounts that fail (revoked key, missing subscription) are reported in the
 * result without stopping the rest of the fleet.
 */
import { defineWorkflow } from "@iboss/sdk";
import { z } from "zod";

export default defineWorkflow({
  name: "block-domains-fleet",
  description: "Add domains to a blocklist policy layer on every account in the profile.",
  multiAccount: true,
  inputs: z.object({
    domains: z.array(z.string().min(1)).min(1).describe("Domains to block (comma-separated on the CLI)"),
    layerName: z.string().default("SDK Blocklist").describe("Name of the blocklist policy layer"),
  }),
  async run(ctx, input) {
    const results = await ctx.forEachAccount(async (sub) => {
      const label = sub.account.accountName ?? sub.account.accountSettingsId;

      const layers = await sub.client.policies.listLayers();
      let layerId = layers.find((l) => l.customCategoryName === input.layerName)?.customCategoryId;

      if (layerId === undefined) {
        const created = await sub.client.policies.createLayer({
          name: input.layerName,
          type: "blocklist",
          settings: { policyAction: 0 }, // block
        });
        layerId = created.customCategoryId;
        sub.log(`[${label}] created layer "${input.layerName}" (id ${layerId})`);
      }

      const existing = new Set(
        (await sub.client.policies.getLayerUrls(layerId)).map((u) => u.url),
      );

      let added = 0;
      for (const domain of input.domains) {
        if (sub.signal.aborted) break;
        if (existing.has(domain)) {
          sub.log(`[${label}] = ${domain} (already present)`);
          continue;
        }
        await sub.client.policies.addLayerUrl(layerId, domain);
        sub.log(`[${label}] + ${domain}`);
        added++;
      }

      return { layerId, added, skipped: input.domains.length - added };
    });

    // One summary entry per account; failed accounts carry their error.
    return Object.fromEntries(
      [...results.entries()].map(([account, value]) => [
        account,
        value instanceof Error ? { error: value.message } : value,
      ]),
    );
  },
});
