/**
 * Rotate the API credential. ⚠ The current key stops working immediately and
 * the new key is printed ONCE — store it right away.
 *
 *   npx tsx examples/04-rotate-api-key.ts --yes
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

if (!process.argv.includes("--yes")) {
  console.error("Refusing to rotate without --yes (the current key is invalidated immediately).");
  process.exit(1);
}

const profile = resolveProfile();
const client = new IbossClient({
  domain: profile.domain,
  credentials: { apiKey: profile.apiKey },
});

const rotated = await client.account.rotateCredential();
console.log("New API key (store it NOW — it will not be shown again):");
console.log(`  ${rotated.opaqueToken}`);
if (rotated.expiresAt) console.log(`  expires ${rotated.expiresAt.toISOString()}`);
console.log("\nUpdate IBOSS_API_KEY in your .env / config before the next run.");
