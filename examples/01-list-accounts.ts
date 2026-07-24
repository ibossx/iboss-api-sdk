/**
 * List every account the API key can manage.
 *
 *   npx tsx examples/01-list-accounts.ts
 *
 * Requires IBOSS_CLOUD_DOMAIN and IBOSS_API_KEY (env or .env).
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

const profile = resolveProfile();
const client = new IbossClient({
  domain: profile.domain,
  credentials: { apiKey: profile.apiKey },
});

const session = await client.connect();

console.log(`Connected to ${profile.domain} (credentials from ${profile.source})\n`);
for (const account of session.accounts) {
  const marker = account.accountSettingsId === session.account.accountSettingsId ? "→" : " ";
  console.log(
    `${marker} ${account.accountSettingsId}  ${account.accountName ?? "(unnamed)"}` +
      (account.isPrimary ? "  [primary]" : ""),
  );
}
console.log(`\nAPI key expires: ${session.apiCredentialExpiresAt?.toISOString() ?? "not reported"}`);
