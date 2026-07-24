import type { Command } from "commander";
import { discoverWorkflows } from "../../workflows/discover.js";
import { findWorkflowsDir } from "../context.js";
import { printJson, printTable } from "../render.js";

export function registerWorkflowsCommands(program: Command): void {
  const workflows = program.command("workflows").description("workflow discovery");

  workflows
    .command("list")
    .description("list workflows found in the workflows/ directory")
    .option("--dir <path>", "workflows directory (default: auto-detected)")
    .action(async (cmdOpts: { dir?: string }) => {
      const opts = program.opts<{ json?: boolean }>();
      const dir = cmdOpts.dir ?? findWorkflowsDir();
      const { workflows: found, warnings } = await discoverWorkflows(dir);

      if (opts.json) {
        printJson({
          dir,
          workflows: found.map(({ workflow, file }) => ({
            name: workflow.name,
            description: workflow.description,
            multiAccount: workflow.multiAccount ?? false,
            file,
          })),
          warnings,
        });
        return;
      }

      console.log(`Workflows in ${dir}:\n`);
      printTable(
        found.map(({ workflow }) => ({
          name: workflow.name,
          description: workflow.description,
          multiAccount: workflow.multiAccount ? "yes" : "",
        })),
      );
      for (const warning of warnings) {
        console.error(`\n⚠ ${warning.file}\n  ${warning.message}`);
      }
    });
}
