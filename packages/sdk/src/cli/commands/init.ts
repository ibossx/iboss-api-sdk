/**
 * `iboss init` — guided first-time setup. Asks for the cloud domain and one
 * or more account API keys (hidden input), saves them as a profile, verifies
 * each key, and prints the next steps. Replaces the "copy a file and edit
 * the comments" ritual with one paste-safe command.
 *
 * Non-interactive mode (piped stdin) reads answers line by line:
 *   line 1: cloud domain (blank = default)
 *   then repeating pairs: account label, API key — until EOF.
 */
import type { Command } from "commander";
import { maskValue } from "../../client/redact.js";
import {
  loadConfigFile,
  projectConfigPath,
  saveProjectConfig,
  saveUserConfig,
  upsertProfileAccount,
  userConfigPath,
  type IbossConfigFile,
} from "../../config/profiles.js";
import { clientForAccount, type GlobalCliOptions } from "../context.js";
import { confirm, fail, info, ok, promptLine, promptSecret } from "../render.js";

const DEFAULT_DOMAIN = "api.ibosscloud.com";

async function readAllStdinLines(): Promise<string[]> {
  let data = "";
  for await (const chunk of process.stdin) data += String(chunk);
  return data.split("\n").map((line) => line.trim());
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("guided setup: store account API key(s) and verify connectivity")
    .option("--project", "write ./iboss.config.json instead of ~/.iboss/config.json")
    .option("--no-verify", "skip the connectivity check for each key")
    .action(async (cmdOpts: { project?: boolean; verify: boolean }) => {
      const opts = program.opts<GlobalCliOptions>();
      const interactive = Boolean(process.stdin.isTTY);
      const answers = interactive ? [] : await readAllStdinLines();
      const nextAnswer = () => answers.shift();

      const configPath = cmdOpts.project ? projectConfigPath() : userConfigPath();
      const config: IbossConfigFile = loadConfigFile(configPath) ?? { profiles: {} };
      const profileName = opts.profile ?? config.defaultProfile ?? "default";
      const existingDomain = config.profiles[profileName]?.domain;

      if (interactive) {
        info("iboss SDK setup — an API key belongs to exactly one account;");
        info("add one key per account you want to automate. Keys are stored");
        info(`with owner-only permissions in ${configPath} (never in the repo).\n`);
      }

      const domainDefault = opts.domain ?? existingDomain ?? DEFAULT_DOMAIN;
      const domainAnswer = interactive
        ? await promptLine(`Cloud base API host [${domainDefault}]:`)
        : (nextAnswer() ?? "");
      const domain = domainAnswer || domainDefault;

      const saved: { name: string; okVerify?: boolean }[] = [];
      let failures = 0;

      for (;;) {
        const suggested = saved.length === 0 ? "primary" : "";
        let name: string;
        let apiKey: string;
        if (interactive) {
          name =
            (await promptLine(`Account label${suggested ? ` [${suggested}]` : ""}:`)) || suggested;
          if (!name) {
            fail("A label is required (e.g. hq, emea).");
            continue;
          }
          apiKey = await promptSecret(`API key for "${name}" (input hidden):`);
          if (!apiKey) {
            fail("No key entered.");
            continue;
          }
        } else {
          name = nextAnswer() ?? "";
          apiKey = nextAnswer() ?? "";
          if (!name || !apiKey) break; // EOF ends the non-interactive loop
        }

        const credential = { name, domain, apiKey };
        const { added, accountCount } = upsertProfileAccount(config, profileName, credential);
        if (cmdOpts.project) saveProjectConfig(config);
        else saveUserConfig(config);
        ok(
          `${added ? "Added" : "Updated"} account "${name}" (key ${maskValue(apiKey)}) — ` +
            `profile "${profileName}" now has ${accountCount} account${accountCount === 1 ? "" : "s"}`,
        );

        let okVerify: boolean | undefined;
        if (cmdOpts.verify) {
          try {
            const session = await clientForAccount(credential).connect();
            okVerify = true;
            ok(
              `Verified: account ${session.account.accountSettingsId}` +
                `${session.apiCredentialExpiresAt ? `, key expires ${session.apiCredentialExpiresAt.toISOString()}` : ""}`,
            );
          } catch (error) {
            okVerify = false;
            failures++;
            fail(`Key failed to verify: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        saved.push({ name, okVerify });

        if (interactive) {
          const more = await confirm("Add another account key?");
          if (!more) break;
        }
      }

      if (saved.length === 0) {
        fail("No accounts configured.");
        process.exitCode = 1;
        return;
      }

      info("\nSetup complete. Next steps:");
      info("  npx iboss auth test               verify the selected account");
      info("  npx iboss workflows list          see available workflows");
      info("  npx iboss run hello-account       run your first workflow");
      if (saved.length > 1) {
        info("  npx iboss run block-domains-fleet --input domains=example.com");
        info("                                    apply a change across ALL accounts");
      }
      info("  npm run ui                        optional web UI (localhost)");
      if (failures > 0) {
        fail(`${failures} key(s) failed verification — fix with: npx iboss accounts add <name>`);
        process.exitCode = 1;
      }
    });
}
