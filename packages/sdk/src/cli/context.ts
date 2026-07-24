/**
 * Shared CLI plumbing: resolve credentials and build a client from the
 * global --profile/--domain/--api-key/--account options.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IbossClient } from "../client/IbossClient.js";
import { resolveProfile, type AccountCredential, type ResolvedProfile } from "../config/profiles.js";

export interface GlobalCliOptions {
  profile?: string;
  domain?: string;
  apiKey?: string;
  /** Account name from the profile (or an accountSettingsId). */
  account?: string;
  json?: boolean;
}

export function resolveCliProfile(opts: GlobalCliOptions): ResolvedProfile {
  return resolveProfile({
    profile: opts.profile,
    account: opts.account,
    overrides: {
      ...(opts.domain ? { domain: opts.domain } : {}),
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    },
  });
}

export function clientForAccount(credential: AccountCredential): IbossClient {
  return new IbossClient({
    domain: credential.domain,
    credentials: { apiKey: credential.apiKey },
    accountSettingsId: credential.accountSettingsId,
  });
}

/** Client for the profile's selected account. */
export function clientFromProfile(profile: ResolvedProfile): IbossClient {
  return clientForAccount(profile.account);
}

/**
 * Locate the repo-root workflows/ directory: walk up from cwd looking for a
 * `workflows` folder; fall back to the SDK's own repo layout.
 */
export function findWorkflowsDir(startDir = process.cwd()): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "workflows");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: <repo>/packages/sdk/src/cli/context.ts → <repo>/workflows
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../../workflows");
}
