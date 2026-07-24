/**
 * The `iboss` CLI.
 *
 *   iboss auth test                     Verify credentials & show the session
 *   iboss auth rotate-key               Rotate the API credential (confirm required)
 *   iboss accounts list                 Accounts visible to the credential
 *   iboss workflows list                Discovered workflows
 *   iboss run <workflow> [--input k=v]  Run a workflow
 *   iboss api <method> <path>           Raw API escape hatch
 *
 * Global options: --profile, --domain, --api-key, --account, --json
 */
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerAccountsCommands } from "./commands/accounts.js";
import { registerApiCommand } from "./commands/api.js";
import { registerInitCommand } from "./commands/init.js";
import { registerRunCommand } from "./commands/run.js";
import { registerWorkflowsCommands } from "./commands/workflows.js";

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("iboss")
    .description("iboss Zero Trust SSE SDK — run API workflows from the terminal")
    .option("--profile <name>", "named profile from iboss.config.json / ~/.iboss/config.json")
    .option("--domain <host>", "cloud base API host (overrides profile/env)")
    .option("--api-key <key>", "API key (overrides profile/env; prefer env or config files)")
    .option("--account <id>", "accountSettingsId to operate on")
    .option("--json", "machine-readable JSON output");

  registerInitCommand(program);
  registerAuthCommands(program);
  registerAccountsCommands(program);
  registerWorkflowsCommands(program);
  registerRunCommand(program);
  registerApiCommand(program);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✖ ${message}`);
    process.exitCode = 1;
  }
}
