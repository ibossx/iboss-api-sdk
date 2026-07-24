/**
 * Showcase workflow: add domains to a blocklist policy layer, creating the
 * layer if it doesn't exist. Demonstrates the two-step policy creation the
 * SDK wraps for you, plus idempotent re-runs.
 *
 *   npx iboss run block-domains --input domains=bad.example.com,worse.example.com
 */
import { defineWorkflow } from "@iboss/sdk";
import { z } from "zod";

export default defineWorkflow({
  name: "block-domains",
  description: "Add domains to a blocklist policy layer (created if missing).",
  inputs: z.object({
    domains: z.array(z.string().min(1)).min(1).describe("Domains to block (comma-separated on the CLI)"),
    layerName: z.string().default("SDK Blocklist").describe("Name of the blocklist policy layer"),
  }),
  async run(ctx, input) {
    ctx.progress("find-layer", "start");
    const layers = await ctx.client.policies.listLayers();
    let layer = layers.find((l) => l.customCategoryName === input.layerName);
    ctx.progress("find-layer", "done", layer ? "found existing layer" : "not found");

    if (!layer) {
      ctx.progress("create-layer", "start");
      const created = await ctx.client.policies.createLayer({
        name: input.layerName,
        type: "blocklist",
        settings: { policyAction: 0 }, // block
      });
      layer = {
        customCategoryId: created.customCategoryId,
        customCategoryNumber: created.customCategoryNumber,
        customCategoryName: input.layerName,
      };
      ctx.progress("create-layer", "done", `id ${created.customCategoryId}`);
    }

    const existing = await ctx.client.policies.getLayerUrls(layer.customCategoryId);
    const existingUrls = new Set(existing.map((u) => u.url));

    let added = 0;
    for (const domain of input.domains) {
      if (ctx.signal.aborted) break;
      if (existingUrls.has(domain)) {
        ctx.log(`= ${domain} (already present)`);
        continue;
      }
      await ctx.client.policies.addLayerUrl(layer.customCategoryId, domain);
      ctx.log(`+ ${domain}`);
      added++;
    }

    return {
      layer: input.layerName,
      customCategoryId: layer.customCategoryId,
      added,
      skipped: input.domains.length - added,
    };
  },
});
