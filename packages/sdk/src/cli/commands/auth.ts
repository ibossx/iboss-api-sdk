import type { Command } from "commander";
import { maskValue } from "../../client/redact.js";
import { loadConfigFile, projectConfigPath, userConfigPath } from "../../config/profiles.js";
import { clientForAccount, clientFromProfile, resolveCliProfile, type GlobalCliOptions } from "../context.js";
import { confirm, fail, info, ok, printJson, printTable } from "../render.js";

/** True when a project or user config file has at least one saved profile. */
function hasSavedProfiles(): boolean {
  for (const path of [projectConfigPath(), userConfigPath()]) {
    try {
      const config = loadConfigFile(path);
      if (config && Object.keys(config.profiles).length > 0) return true;
    } catch {
      // Unreadable config: ignore here; profile resolution reports it properly.
    }
  }
  return false;
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("credential management");

  auth
    .command("test")
    .description("verify credentials, show the session (account, hosts, key expiry)")
    .option("--all", "test every account key configured in the profile")
    .action(async (cmdOpts: { all?: boolean }) => {
      const opts = program.opts<GlobalCliOptions>();
      const profile = resolveCliProfile(opts);

      if (cmdOpts.all) {
        const rows = [];
        let failures = 0;
        for (const account of profile.accounts) {
          try {
            const session = await clientForAccount(account).connect();
            rows.push({
              account: account.name,
              status: "ok",
              accountSettingsId: session.account.accountSettingsId,
              keyExpires: session.apiCredentialExpiresAt?.toISOString() ?? "",
            });
          } catch (error) {
            failures++;
            rows.push({
              account: account.name,
              status: `error: ${error instanceof Error ? error.message.slice(0, 60) : String(error)}`,
              accountSettingsId: "",
              keyExpires: "",
            });
          }
        }
        if (opts.json) printJson(rows);
        else {
          printTable(rows);
          if (failures === 0) ok(`All ${rows.length} account key(s) authenticated`);
          else fail(`${failures} of ${rows.length} account key(s) failed`);
        }
        if (failures > 0) process.exitCode = 1;
        return;
      }

      const client = clientFromProfile(profile);
      let session;
      try {
        session = await client.connect();
      } catch (error) {
        // Name exactly what was being tested so failures are self-diagnosing.
        fail(
          `Authentication failed for account "${profile.account.name}" ` +
            `(source: ${profile.source}${profile.profileName ? ` "${profile.profileName}"` : ""}, ` +
            `domain: ${profile.account.domain}, key: ${maskValue(profile.account.apiKey)})`,
        );
        if (profile.source === "env" && hasSavedProfiles()) {
          info(
            "Note: IBOSS_CLOUD_DOMAIN / IBOSS_API_KEY environment variables (or a local .env) take " +
              "precedence over your saved profiles. Unset them to use the saved keys, or pass --profile.",
          );
        }
        throw error;
      }

      const summary = {
        credentialSource: profile.source + (profile.profileName ? ` (${profile.profileName})` : ""),
        accountLabel: profile.account.name,
        domain: profile.account.domain,
        account: session.account.accountName ?? "(unnamed)",
        accountSettingsId: session.account.accountSettingsId,
        accountsInProfile: profile.accounts.length,
        gatewayHost: session.hosts.gateway ?? "(none)",
        reporterHost: session.hosts.reporter ?? "(none)",
        keyExpires: session.apiCredentialExpiresAt?.toISOString() ?? "(not reported)",
      };

      if (opts.json) {
        printJson(summary);
        return;
      }
      ok("Authentication succeeded");
      printTable(Object.entries(summary).map(([key, value]) => ({ field: key, value: String(value) })));
    });

  auth
    .command("rotate-key")
    .description("rotate the API credential — the current key stops working immediately")
    .option("--yes", "skip the confirmation prompt")
    .action(async (cmdOpts: { yes?: boolean }) => {
      const opts = program.opts<GlobalCliOptions>();
      const profile = resolveCliProfile(opts);

      if (!cmdOpts.yes) {
        const confirmed = await confirm(
          `Rotate the API key for account "${profile.account.name}"? ` +
            "The current key is invalidated immediately and the new key is shown ONCE.",
        );
        if (!confirmed) {
          fail("Aborted (pass --yes to skip the prompt).");
          process.exitCode = 1;
          return;
        }
      }

      const client = clientFromProfile(profile);
      const rotated = await client.account.rotateCredential();

      if (opts.json) {
        printJson({ apiKey: rotated.opaqueToken, expiresAt: rotated.expiresAt?.toISOString() });
        return;
      }
      ok("Credential rotated. Store the new key now — it will not be shown again:");
      info(`  New API key: ${rotated.opaqueToken}`);
      if (rotated.expiresAt) info(`  Expires:     ${rotated.expiresAt.toISOString()}`);
      info(`  (old key ${maskValue(profile.apiKey)} is now invalid — update your .env/config)`);
    });
}
