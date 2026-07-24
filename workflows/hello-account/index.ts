/**
 * The smallest possible workflow — verify connectivity and print session
 * details. A good first run after configuring credentials:
 *
 *   npx iboss run hello-account
 */
import { defineWorkflow } from "@iboss/sdk";
import { z } from "zod";

export default defineWorkflow({
  name: "hello-account",
  description: "Verify credentials and show account, hosts, and API key expiry.",
  inputs: z.object({}),
  async run(ctx) {
    const session = ctx.client.session;

    ctx.log(`Account:  ${ctx.account.accountName ?? "(unnamed)"} (${ctx.account.accountSettingsId})`);
    ctx.log(`Primary:  ${ctx.account.isPrimary ? "yes" : "no"}`);
    ctx.log(`Gateway:  ${session.hosts.gateway ?? "(none discovered)"}`);
    ctx.log(`Reporter: ${session.hosts.reporter ?? "(none discovered)"}`);
    ctx.log(`Key expires: ${session.apiCredentialExpiresAt?.toISOString() ?? "(not reported)"}`);

    const modules = Object.keys(ctx.account.subscriptionFlags);
    ctx.log(`Subscribed modules: ${modules.length ? modules.join(", ") : "(none reported)"}`);

    return {
      accountSettingsId: ctx.account.accountSettingsId,
      accountName: ctx.account.accountName,
      hosts: session.hosts,
      apiCredentialExpiresAt: session.apiCredentialExpiresAt?.toISOString(),
    };
  },
});
