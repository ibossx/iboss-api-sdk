import { readFileSync } from "node:fs";
import type { Command } from "commander";
import type { HttpMethod } from "../../client/errors.js";
import { inferHostTier, isHostTier, type HostTier } from "../../client/hosts.js";
import { clientFromProfile, resolveCliProfile, type GlobalCliOptions } from "../context.js";
import { printJson } from "../render.js";

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "DELETE", "PATCH"]);

export function registerApiCommand(program: Command): void {
  program
    .command("api <method> <path>")
    .description("raw API escape hatch, e.g.: iboss api GET /ibcloud/web/users/mySettings")
    .option("--host <tier>", "cloud | gateway | reporter | rbi | accounts (default: inferred from path)")
    .option("--body <json>", "request body as JSON (or @file.json)")
    .option("--query <key=value...>", "query parameter (repeatable)", collectPairs, {})
    .action(
      async (
        method: string,
        path: string,
        cmdOpts: { host?: string; body?: string; query: Record<string, string> },
      ) => {
        const opts = program.opts<GlobalCliOptions>();
        const httpMethod = method.toUpperCase() as HttpMethod;
        if (!METHODS.has(httpMethod)) throw new Error(`Unsupported method "${method}"`);

        const tier = (cmdOpts.host as HostTier | undefined) ?? inferHostTier(path);
        if (!isHostTier(tier)) throw new Error(`Unknown host tier "${cmdOpts.host}"`);

        let body: unknown;
        if (cmdOpts.body) {
          const text = cmdOpts.body.startsWith("@")
            ? readFileSync(cmdOpts.body.slice(1), "utf8")
            : cmdOpts.body;
          body = JSON.parse(text);
        }

        const client = clientFromProfile(resolveCliProfile(opts));
        const result = await client.raw(tier, httpMethod, path, { body, query: cmdOpts.query });
        printJson(result);
      },
    );
}

function collectPairs(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) throw new Error(`--query expects key=value, got "${value}"`);
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}
