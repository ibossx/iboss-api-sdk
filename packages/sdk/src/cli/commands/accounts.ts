import type { Command } from "commander";
import { maskValue } from "../../client/redact.js";
import {
  loadConfigFile,
  projectConfigPath,
  removeProfileAccount,
  saveProjectConfig,
  saveUserConfig,
  upsertProfileAccount,
  userConfigPath,
  type IbossConfigFile,
} from "../../config/profiles.js";
import { clientForAccount, resolveCliProfile, type GlobalCliOptions } from "../context.js";
import { fail, info, ok, printJson, printTable, promptSecret } from "../render.js";

function loadConfigFor(project: boolean): { config: IbossConfigFile; path: string } {
  const path = project ? projectConfigPath() : userConfigPath();
  return { config: loadConfigFile(path) ?? { profiles: {} }, path };
}

function saveConfigFor(project: boolean, config: IbossConfigFile): string {
  return project ? saveProjectConfig(config) : saveUserConfig(config);
}

export function registerAccountsCommands(program: Command): void {
  const accounts = program.command("accounts").description("accounts configured in the profile");

  accounts
    .command("list")
    .description("list the profile's configured accounts (one API key per account)")
    .option("--verify", "connect with each key and show live account details")
    .action(async (cmdOpts: { verify?: boolean }) => {
      const opts = program.opts<GlobalCliOptions>();
      const profile = resolveCliProfile(opts);

      if (!cmdOpts.verify) {
        const rows = profile.accounts.map((account) => ({
          name: account.name,
          domain: account.domain,
          apiKey: maskValue(account.apiKey),
          accountSettingsId: account.accountSettingsId ?? "(from key)",
          selected: account.name === profile.account.name ? "→" : "",
        }));
        if (opts.json) printJson(rows);
        else printTable(rows);
        return;
      }

      const rows = [];
      const seen = new Map<string, string>(); // accountSettingsId -> first entry name
      for (const account of profile.accounts) {
        try {
          const session = await clientForAccount(account).connect();
          const id = session.account.accountSettingsId;
          const duplicateOf = seen.get(id);
          if (!duplicateOf) seen.set(id, account.name);
          rows.push({
            name: account.name,
            status: "ok",
            accountSettingsId: id,
            accountName: session.account.accountName ?? "",
            keyExpires: session.apiCredentialExpiresAt?.toISOString() ?? "",
            note: duplicateOf ? `duplicate of "${duplicateOf}" — remove one` : "",
          });
        } catch (error) {
          rows.push({
            name: account.name,
            status: `error: ${error instanceof Error ? error.message.slice(0, 60) : String(error)}`,
            accountSettingsId: "",
            accountName: "",
            keyExpires: "",
            note: "",
          });
        }
      }
      if (opts.json) printJson(rows);
      else {
        printTable(rows);
        const dupes = rows.filter((r) => r.note).length;
        if (dupes > 0) {
          info(
            `\n${dupes} entr${dupes === 1 ? "y points" : "ies point"} at an already-listed account. ` +
              `Fleet runs visit each account once, but consider: iboss accounts remove <name>`,
          );
        }
      }
    });

  accounts
    .command("add <name>")
    .description("add (or update) an account API key in a profile, no file editing needed")
    .option("--key <apiKey>", "the account's API key (omit to be prompted without echo)")
    .option("--domain <host>", "cloud base API host (default: the profile's existing domain)")
    .option("--account-id <id>", "pin the accountSettingsId (optional)")
    .option("--project", "write ./iboss.config.json instead of ~/.iboss/config.json")
    .option("--no-verify", "skip the connectivity check after saving")
    .action(
      async (
        name: string,
        cmdOpts: { key?: string; domain?: string; accountId?: string; project?: boolean; verify: boolean },
      ) => {
        const opts = program.opts<GlobalCliOptions>();
        const { config, path } = loadConfigFor(Boolean(cmdOpts.project));
        const profileName = opts.profile ?? config.defaultProfile ?? "default";

        // Default the domain from the profile being added to, then the environment.
        const existingProfile = config.profiles[profileName];
        const domain =
          cmdOpts.domain ??
          opts.domain ??
          existingProfile?.domain ??
          process.env.IBOSS_CLOUD_DOMAIN;
        if (!domain) {
          fail("No cloud domain known. Pass --domain <host> (e.g. --domain api.ibosscloud.com).");
          process.exitCode = 1;
          return;
        }

        // Prefer the hidden prompt so keys stay out of shell history.
        const apiKey = cmdOpts.key?.trim() || (await promptSecret(`API key for account "${name}":`));
        if (!apiKey) {
          fail("No API key provided.");
          process.exitCode = 1;
          return;
        }
        if (cmdOpts.key) {
          info("Tip: omit --key next time to be prompted, keeping the key out of shell history.");
        }

        const credential = {
          name,
          domain,
          apiKey,
          ...(cmdOpts.accountId ? { accountSettingsId: cmdOpts.accountId } : {}),
        };
        const { added, accountCount } = upsertProfileAccount(config, profileName, credential);
        saveConfigFor(Boolean(cmdOpts.project), config);
        if (added) {
          ok(
            `Added account "${name}" (key ${maskValue(apiKey)}, domain ${domain}) to profile "${profileName}" — ` +
              `the profile now has ${accountCount} account${accountCount === 1 ? "" : "s"} (${path})`,
          );
          if (accountCount === 2) {
            info(
              'Multi-account runs now cover both accounts, e.g. "npx iboss run block-domains-fleet --input domains=…".',
            );
          }
        } else {
          ok(
            `Updated the API key for existing account "${name}" (key ${maskValue(apiKey)}, domain ${domain}) ` +
              `in profile "${profileName}" (${path})`,
          );
          info(`To add a separate account instead, use a different name: iboss accounts add <other-name>`);
        }

        if (cmdOpts.verify) {
          try {
            const session = await clientForAccount(credential).connect();
            ok(
              `Verified: account ${session.account.accountSettingsId}` +
                `${session.account.accountName ? ` (${session.account.accountName})` : ""}` +
                `${session.apiCredentialExpiresAt ? `, key expires ${session.apiCredentialExpiresAt.toISOString()}` : ""}`,
            );
          } catch (error) {
            fail(
              `Saved, but the key failed to verify: ${error instanceof Error ? error.message : String(error)}`,
            );
            info(`Check the key and domain, or re-run: iboss accounts add ${name} --domain <host>`);
            process.exitCode = 1;
          }
        }
      },
    );

  accounts
    .command("remove <name>")
    .description("remove an account's API key from a profile")
    .option("--project", "edit ./iboss.config.json instead of ~/.iboss/config.json")
    .action(async (name: string, cmdOpts: { project?: boolean }) => {
      const opts = program.opts<GlobalCliOptions>();
      const { config, path } = loadConfigFor(Boolean(cmdOpts.project));
      const profileName = opts.profile ?? config.defaultProfile ?? "default";

      const { removedProfile } = removeProfileAccount(config, profileName, name);
      saveConfigFor(Boolean(cmdOpts.project), config);
      if (removedProfile) {
        ok(`Removed account "${name}" — profile "${profileName}" had no accounts left and was removed (${path}).`);
      } else {
        ok(`Removed account "${name}" from profile "${profileName}" (${path}).`);
      }
      info("Note: removing the key here does not revoke it on the platform.");
    });
}
