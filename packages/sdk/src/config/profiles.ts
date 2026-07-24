/**
 * Credential/profile resolution shared by the CLI and the UI server.
 *
 * Precedence (first match wins):
 *   1. explicit overrides (CLI flags)
 *   2. environment variables IBOSS_CLOUD_DOMAIN / IBOSS_API_KEY / IBOSS_ACCOUNT_ID
 *      (a local .env file is auto-loaded without overriding real env vars)
 *   3. ./iboss.config.json           (project-local, gitignored)
 *   4. ~/.iboss/config.json          (user-global, written 0600)
 *
 * An iboss API key is scoped to exactly one account. A profile therefore
 * either holds a single key (one account) or a list of accounts, each with
 * its own key. resolveProfile() normalizes both shapes into
 * `accounts: AccountCredential[]`; multi-account workflow runs iterate that
 * list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  configFileSchema,
  isMultiAccountProfile,
  type IbossConfigFile,
  type Profile,
} from "./schema.js";

export type { IbossConfigFile, Profile } from "./schema.js";

/** One account's credential: an API key plus the host it authenticates to. */
export interface AccountCredential {
  /** Label used for selection (--account <name>) and result maps. */
  name: string;
  /** Cloud base API host for this account. */
  domain: string;
  apiKey: string;
  /** Optional pinned accountSettingsId. */
  accountSettingsId?: string;
}

export interface ResolvedProfile {
  /** Where the credentials came from, for display/debugging. */
  source: "override" | "env" | "project-config" | "user-config";
  profileName?: string;
  /** Every account configured in the profile (length 1 for single-key profiles). */
  accounts: AccountCredential[];
  /** The selected account (defaults to the first). */
  account: AccountCredential;
  /** Convenience mirrors of the selected account (back-compat). */
  domain: string;
  apiKey: string;
  accountSettingsId?: string;
}

export interface ResolveProfileOptions {
  /** Explicit values (e.g. CLI flags) — highest precedence. */
  overrides?: { domain?: string; apiKey?: string; accountSettingsId?: string };
  /** Named profile to select from the config files. */
  profile?: string;
  /** Select an account within the profile by name (or accountSettingsId). */
  account?: string;
  /** Directory to search for .env and iboss.config.json. Default: cwd. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Directory for the user-global config. Override with IBOSS_CONFIG_HOME (used by tests). */
export function userConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.IBOSS_CONFIG_HOME ?? join(homedir(), ".iboss");
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(userConfigDir(env), "config.json");
}

export function projectConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, "iboss.config.json");
}

export function loadConfigFile(path: string): IbossConfigFile | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = configFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid config file ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

/** Persist the user-global config with owner-only permissions. */
export function saveUserConfig(config: IbossConfigFile, env: NodeJS.ProcessEnv = process.env): string {
  const path = userConfigPath(env);
  mkdirSync(userConfigDir(env), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Persist the project-local config (gitignored) with owner-only permissions. */
export function saveProjectConfig(config: IbossConfigFile, cwd = process.cwd()): string {
  const path = projectConfigPath(cwd);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/**
 * Choose the stored shape for a profile: the simple single-key shape when it
 * holds one account named after the profile, otherwise the accounts list.
 */
function buildProfile(profileName: string, accounts: AccountCredential[]): Profile {
  const first = accounts[0]!;
  if (accounts.length === 1 && first.name === profileName) {
    return {
      domain: first.domain,
      apiKey: first.apiKey,
      ...(first.accountSettingsId ? { accountSettingsId: first.accountSettingsId } : {}),
    };
  }
  const domain = first.domain;
  return {
    domain,
    accounts: accounts.map((account) => ({
      name: account.name,
      apiKey: account.apiKey,
      ...(account.accountSettingsId ? { accountSettingsId: account.accountSettingsId } : {}),
      ...(account.domain !== domain ? { domain: account.domain } : {}),
    })),
  };
}

/**
 * Add or update one account credential in a profile (created if missing).
 * The account name is the upsert key: a repeat with the same name updates
 * that account's credential (e.g. after key rotation); a new name grows the
 * profile's account set. Mutates `config`; returns what happened.
 */
export function upsertProfileAccount(
  config: IbossConfigFile,
  profileName: string,
  account: AccountCredential,
): { added: boolean; accountCount: number } {
  const existing = config.profiles[profileName];
  const accounts = existing ? accountsOfProfile(existing, profileName) : [];
  const index = accounts.findIndex((a) => a.name === account.name);
  const added = index < 0;
  if (added) accounts.push(account);
  else accounts[index] = account;
  config.profiles[profileName] = buildProfile(profileName, accounts);
  config.defaultProfile ??= profileName;
  return { added, accountCount: accounts.length };
}

/**
 * Remove one account credential from a profile. Removing the last account
 * removes the profile itself. Mutates `config`; returns what happened.
 */
export function removeProfileAccount(
  config: IbossConfigFile,
  profileName: string,
  accountName: string,
): { removedProfile: boolean } {
  const existing = config.profiles[profileName];
  if (!existing) throw new Error(`Profile "${profileName}" not found.`);
  const accounts = accountsOfProfile(existing, profileName);
  const remaining = accounts.filter((a) => a.name !== accountName);
  if (remaining.length === accounts.length) {
    throw new Error(
      `Account "${accountName}" not found in profile "${profileName}". ` +
        `Available: ${accounts.map((a) => a.name).join(", ")}`,
    );
  }
  if (remaining.length === 0) {
    delete config.profiles[profileName];
    if (config.defaultProfile === profileName) {
      config.defaultProfile = Object.keys(config.profiles)[0];
    }
    return { removedProfile: true };
  }
  config.profiles[profileName] = buildProfile(profileName, remaining);
  return { removedProfile: false };
}

/** Minimal .env parser — KEY=value lines, # comments, optional quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * An unedited .env (copied from .env.example) must never act as a credential:
 * the documented placeholder and angle-bracket templates are treated as unset,
 * so saved profiles keep working underneath.
 */
export function isPlaceholderKey(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    trimmed === "your-api-key-here" ||
    (trimmed.startsWith("<") && trimmed.endsWith(">"))
  );
}

function envWithDotEnv(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dotEnvPath = resolve(cwd, ".env");
  if (!existsSync(dotEnvPath)) return env;
  const fileVars = parseDotEnv(readFileSync(dotEnvPath, "utf8"));
  // Real environment variables win over .env file entries.
  return { ...fileVars, ...env };
}

/** Normalize either profile shape into the credential list. */
export function accountsOfProfile(profile: Profile, profileName: string): AccountCredential[] {
  if (isMultiAccountProfile(profile)) {
    return profile.accounts.map((account) => ({
      name: account.name,
      domain: account.domain ?? profile.domain,
      apiKey: account.apiKey,
      ...(account.accountSettingsId ? { accountSettingsId: account.accountSettingsId } : {}),
    }));
  }
  return [
    {
      name: profileName,
      domain: profile.domain,
      apiKey: profile.apiKey,
      ...(profile.accountSettingsId ? { accountSettingsId: profile.accountSettingsId } : {}),
    },
  ];
}

function fromNamedProfile(
  file: IbossConfigFile | undefined,
  name: string | undefined,
  source: ResolvedProfile["source"],
): { accounts: AccountCredential[]; profileName: string } | undefined {
  if (!file) return undefined;
  const profileName = name ?? file.defaultProfile ?? Object.keys(file.profiles)[0];
  if (!profileName) return undefined;
  const profile = file.profiles[profileName];
  if (!profile) return undefined;
  return { accounts: accountsOfProfile(profile, profileName), profileName };
}

function selectAccount(accounts: AccountCredential[], requested: string | undefined): AccountCredential {
  if (!requested) return accounts[0]!;
  const byName = accounts.find((a) => a.name === requested);
  if (byName) return byName;
  const byId = accounts.find((a) => a.accountSettingsId === requested);
  if (byId) return byId;
  // Single-account profiles keep the old behavior: an unmatched value is
  // treated as an accountSettingsId pin on that account.
  if (accounts.length === 1) {
    return { ...accounts[0]!, accountSettingsId: requested };
  }
  throw new Error(
    `Account "${requested}" is not configured in this profile. ` +
      `Available accounts: ${accounts.map((a) => a.name).join(", ")}`,
  );
}

function finalize(
  accounts: AccountCredential[],
  source: ResolvedProfile["source"],
  opts: ResolveProfileOptions,
  profileName?: string,
): ResolvedProfile {
  const withOverrides = accounts.map((account) => ({
    ...account,
    ...(opts.overrides?.domain ? { domain: opts.overrides.domain } : {}),
    ...(opts.overrides?.apiKey ? { apiKey: opts.overrides.apiKey } : {}),
  }));
  const account = selectAccount(withOverrides, opts.account ?? opts.overrides?.accountSettingsId);
  return {
    source,
    profileName,
    accounts: withOverrides,
    account,
    domain: account.domain,
    apiKey: account.apiKey,
    accountSettingsId: account.accountSettingsId,
  };
}

/**
 * Resolve credentials for a client. Throws with actionable guidance when
 * nothing is configured.
 */
export function resolveProfile(opts: ResolveProfileOptions = {}): ResolvedProfile {
  const cwd = opts.cwd ?? process.cwd();
  const env = envWithDotEnv(cwd, opts.env ?? process.env);

  if (opts.overrides?.domain && opts.overrides?.apiKey) {
    const account: AccountCredential = {
      name: "override",
      domain: opts.overrides.domain,
      apiKey: opts.overrides.apiKey,
      ...(opts.overrides.accountSettingsId
        ? { accountSettingsId: opts.overrides.accountSettingsId }
        : {}),
    };
    return { source: "override", accounts: [account], account, ...account };
  }

  // A named profile was explicitly requested — config files take priority.
  if (opts.profile) {
    const fromProject = fromNamedProfile(
      loadConfigFile(projectConfigPath(cwd)),
      opts.profile,
      "project-config",
    );
    const named =
      fromProject ?? fromNamedProfile(loadConfigFile(userConfigPath(env)), opts.profile, "user-config");
    if (!named) {
      throw new Error(
        `Profile "${opts.profile}" not found in ${projectConfigPath(cwd)} or ${userConfigPath(env)}.`,
      );
    }
    return finalize(named.accounts, fromProject ? "project-config" : "user-config", opts, named.profileName);
  }

  if (env.IBOSS_CLOUD_DOMAIN && env.IBOSS_API_KEY && !isPlaceholderKey(env.IBOSS_API_KEY)) {
    const account: AccountCredential = {
      name: "default",
      domain: env.IBOSS_CLOUD_DOMAIN,
      apiKey: env.IBOSS_API_KEY,
      ...(env.IBOSS_ACCOUNT_ID ? { accountSettingsId: env.IBOSS_ACCOUNT_ID } : {}),
    };
    return finalize([account], "env", opts);
  }

  const project = fromNamedProfile(loadConfigFile(projectConfigPath(cwd)), undefined, "project-config");
  if (project) return finalize(project.accounts, "project-config", opts, project.profileName);
  const user = fromNamedProfile(loadConfigFile(userConfigPath(env)), undefined, "user-config");
  if (user) return finalize(user.accounts, "user-config", opts, user.profileName);

  throw new Error(
    "No iboss credentials configured. Run the guided setup:\n\n" +
      "  npx iboss init\n\n" +
      "(alternatives: `npx iboss accounts add <name>`, IBOSS_CLOUD_DOMAIN + " +
      "IBOSS_API_KEY env vars or a .env file, or edit iboss.config.json / " +
      "~/.iboss/config.json — see iboss.config.example.json)",
  );
}
