/**
 * IbossClient — the SDK's main entry point.
 *
 * ```ts
 * const client = new IbossClient({
 *   domain: process.env.IBOSS_CLOUD_DOMAIN!,
 *   credentials: { apiKey: process.env.IBOSS_API_KEY! },
 * });
 * await client.connect();
 * const layers = await client.policies.listLayers();
 * ```
 *
 * Feature areas are exposed as sub-clients (client.policies, client.dlp,
 * client.governance, ...). Anything not wrapped yet is reachable via client.raw().
 */
import { AccountApi } from "../api/account.js";
import { AppsApi } from "../api/apps.js";
import { DirectoryApi } from "../api/directory.js";
import { DlpApi } from "../api/dlp.js";
import { FirewallApi } from "../api/firewall.js";
import { GovernanceApi } from "../api/governance.js";
import { GroupsApi } from "../api/groups.js";
import { LocationsApi } from "../api/locations.js";
import { NetworkApi } from "../api/network.js";
import { PoliciesApi } from "../api/policies.js";
import { ReportingApi } from "../api/reporting.js";
import { ResourcesApi } from "../api/resources.js";
import { SslApi } from "../api/ssl.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPlaceholderKey, parseDotEnv, resolveProfile } from "../config/profiles.js";
import { DEFAULT_USER_AGENT, type FromConfigOptions, type IbossClientConfig } from "./config.js";
import { ApiKeyCredentialProvider } from "./credentials/apiKey.js";
import type { CredentialProvider } from "./credentials/CredentialProvider.js";
import { discover } from "./discovery.js";
import { IbossNotConnectedError, type HttpMethod } from "./errors.js";
import {
  applyHostOverrides,
  hostOverridesFromEnv,
  inferHostTier,
  isHostTier,
  type HostTier,
} from "./hosts.js";
import { defaultLogger, type Logger } from "./logger.js";
import { RequestLayer, type RequestOptions } from "./request.js";
import type { SessionState } from "./session.js";

export class IbossClient {
  readonly account: AccountApi;
  readonly groups: GroupsApi;
  readonly locations: LocationsApi;
  readonly resources: ResourcesApi;
  readonly policies: PoliciesApi;
  readonly firewall: FirewallApi;
  readonly apps: AppsApi;
  readonly dlp: DlpApi;
  readonly ssl: SslApi;
  readonly network: NetworkApi;
  readonly directory: DirectoryApi;
  readonly reporting: ReportingApi;
  readonly governance: GovernanceApi;

  private readonly config: IbossClientConfig;
  private readonly provider: CredentialProvider;
  private readonly logger: Logger;
  private readonly layer: RequestLayer;
  private sessionState?: SessionState;
  private connectPromise?: Promise<SessionState>;

  constructor(config: IbossClientConfig) {
    if (!config.domain) throw new Error("IbossClient requires a domain (cloud base API host)");
    this.config = config;
    this.provider =
      "apiKey" in config.credentials
        ? new ApiKeyCredentialProvider(config.credentials.apiKey)
        : config.credentials;
    this.logger = config.logger ?? defaultLogger();
    this.layer = new RequestLayer({
      domain: config.domain,
      provider: this.provider,
      fetchImpl: config.fetch ?? globalThis.fetch,
      logger: this.logger,
      retry: config.retry,
      userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    });
    if (config.hosts) applyHostOverrides(this.layer.hosts, config.hosts);

    this.account = new AccountApi(this);
    this.groups = new GroupsApi(this);
    this.locations = new LocationsApi(this);
    this.resources = new ResourcesApi(this);
    this.policies = new PoliciesApi(this);
    this.firewall = new FirewallApi(this);
    this.apps = new AppsApi(this);
    this.dlp = new DlpApi(this);
    this.ssl = new SslApi(this);
    this.network = new NetworkApi(this);
    this.directory = new DirectoryApi(this);
    this.reporting = new ReportingApi(this);
    this.governance = new GovernanceApi(this);
  }

  /**
   * Validate the credential, select the account, and discover node hosts.
   * Idempotent — concurrent/repeat calls share one discovery.
   */
  async connect(): Promise<SessionState> {
    if (this.sessionState) return this.sessionState;
    this.connectPromise ??= discover(this.layer, {
      accountSettingsId: this.config.accountSettingsId,
      hostOverrides: this.config.hosts,
      logger: this.logger,
    })
      .then((session) => {
        this.sessionState = session;
        return session;
      })
      .catch((error) => {
        this.connectPromise = undefined;
        throw error;
      });
    return this.connectPromise;
  }

  /** Session details (accounts, hosts, expiry). Throws if connect() has not completed. */
  get session(): SessionState {
    if (!this.sessionState) throw new IbossNotConnectedError();
    return this.sessionState;
  }

  get isConnected(): boolean {
    return this.sessionState !== undefined;
  }

  /**
   * A new client scoped to a different account visible to the same credential.
   * The clone has its own cookie jar and discovery state, so sessions never
   * leak across accounts.
   *
   * Only meaningful for credentials that can see multiple accounts —
   * username/password sessions. An API key is scoped to exactly one account;
   * to operate on multiple accounts with keys, configure one key per account
   * in a profile and use ctx.forEachAccount / the profile's accounts list.
   */
  forAccount(accountSettingsId: string): IbossClient {
    return new IbossClient({ ...this.config, credentials: this.provider, accountSettingsId });
  }

  /**
   * Escape hatch for endpoints without a typed wrapper. Auto-connects.
   *
   * The 4-arg form is unchanged. The 3-arg form infers the host tier from
   * the path prefix (`/json` and `/bulk` → gateway, `/ibreports` → reporter,
   * `/ibcloud` → cloud) so agents do not send a Resource Policy POST to the
   * cloud host.
   *
   * ```ts
   * const data = await client.raw("gateway", "GET", "/json/controls/policyLayers/all");
   * const same = await client.raw("GET", "/json/controls/policyLayers/all");
   * ```
   */
  async raw<T = unknown>(
    tier: HostTier,
    method: HttpMethod,
    path: string,
    opts?: RequestOptions,
  ): Promise<T>;
  async raw<T = unknown>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>;
  async raw<T = unknown>(
    tierOrMethod: HostTier | HttpMethod,
    methodOrPath: HttpMethod | string,
    pathOrOpts?: string | RequestOptions,
    opts?: RequestOptions,
  ): Promise<T> {
    await this.connect();
    if (isHostTier(tierOrMethod)) {
      return this.layer.request<T>(
        tierOrMethod,
        methodOrPath as HttpMethod,
        pathOrOpts as string,
        opts,
      );
    }
    return this.layer.request<T>(
      inferHostTier(methodOrPath),
      tierOrMethod,
      methodOrPath,
      pathOrOpts as RequestOptions | undefined,
    );
  }

  /**
   * Build a client from `IBOSS_API_KEY` + `IBOSS_CLOUD_DOMAIN` (and optional
   * `IBOSS_ACCOUNT_ID`, `IBOSS_GATEWAY_HOST` / `IBOSS_GATEWAY_URL`,
   * `IBOSS_REPORTER_HOST` / `IBOSS_REPORTER_URL`). Loads a local `.env`
   * without overriding real environment variables. Does **not** fall through
   * to `iboss.config.json` — use `fromProfile()` for that.
   *
   * Every request still sends `Authorization: Token <key>` and
   * `User-Agent: ibossAPI`.
   */
  static fromEnv(opts: FromConfigOptions = {}): IbossClient {
    const env = withDotEnv(opts.cwd ?? process.cwd(), opts.env ?? process.env);
    const domain = env.IBOSS_CLOUD_DOMAIN?.trim();
    const apiKey = env.IBOSS_API_KEY?.trim();
    if (!domain || !apiKey || isPlaceholderKey(apiKey)) {
      throw new Error(
        "IbossClient.fromEnv() requires IBOSS_CLOUD_DOMAIN and IBOSS_API_KEY. " +
          "Set them in the environment or a local .env, or use IbossClient.fromProfile() / npx iboss init.",
      );
    }
    const hosts = { ...hostOverridesFromEnv(env), ...opts.hosts };
    return new IbossClient({
      domain,
      credentials: { apiKey },
      accountSettingsId: opts.accountSettingsId ?? env.IBOSS_ACCOUNT_ID,
      hosts: Object.keys(hosts).length > 0 ? hosts : undefined,
      fetch: opts.fetch,
      logger: opts.logger,
      retry: opts.retry,
      userAgent: opts.userAgent,
    });
  }

  /**
   * Build a client from the same profile files the CLI uses
   * (`iboss.config.json`, `~/.iboss/config.json`, then env). Optional
   * gateway/reporter env hosts still apply as overrides.
   */
  static fromProfile(name?: string, opts: FromConfigOptions = {}): IbossClient {
    const env = opts.env ?? process.env;
    const profile = resolveProfile({
      profile: name,
      cwd: opts.cwd,
      env,
      overrides: opts.accountSettingsId ? { accountSettingsId: opts.accountSettingsId } : undefined,
    });
    const hosts = { ...hostOverridesFromEnv(env), ...opts.hosts };
    return new IbossClient({
      domain: profile.domain,
      credentials: { apiKey: profile.apiKey },
      accountSettingsId: opts.accountSettingsId ?? profile.accountSettingsId,
      hosts: Object.keys(hosts).length > 0 ? hosts : undefined,
      fetch: opts.fetch,
      logger: opts.logger,
      retry: opts.retry,
      userAgent: opts.userAgent,
    });
  }

  /** @internal Request layer access for sub-clients; ensures connection first. */
  async requestLayer(): Promise<RequestLayer> {
    await this.connect();
    return this.layer;
  }

  /** @internal Logger for sub-client warnings (allowlist+categories, etc.). */
  warn(message: string, data?: unknown): void {
    this.logger.warn(message, data);
  }
}

/** Merge a local `.env` under real env vars (real env wins). */
function withDotEnv(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return env;
  return { ...parseDotEnv(readFileSync(path, "utf8")), ...env };
}
