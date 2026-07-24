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
 * Feature areas are exposed as sub-clients (client.policies, client.dlp, ...).
 * Anything not wrapped yet is reachable via client.raw().
 */
import { AccountApi } from "../api/account.js";
import { AppsApi } from "../api/apps.js";
import { DirectoryApi } from "../api/directory.js";
import { DlpApi } from "../api/dlp.js";
import { FirewallApi } from "../api/firewall.js";
import { GroupsApi } from "../api/groups.js";
import { LocationsApi } from "../api/locations.js";
import { NetworkApi } from "../api/network.js";
import { PoliciesApi } from "../api/policies.js";
import { ReportingApi } from "../api/reporting.js";
import { ResourcesApi } from "../api/resources.js";
import { SslApi } from "../api/ssl.js";
import { DEFAULT_USER_AGENT, type IbossClientConfig } from "./config.js";
import { ApiKeyCredentialProvider } from "./credentials/apiKey.js";
import type { CredentialProvider } from "./credentials/CredentialProvider.js";
import { discover } from "./discovery.js";
import { IbossNotConnectedError, type HttpMethod } from "./errors.js";
import type { HostTier } from "./hosts.js";
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
  }

  /**
   * Validate the credential, select the account, and discover node hosts.
   * Idempotent — concurrent/repeat calls share one discovery.
   */
  async connect(): Promise<SessionState> {
    if (this.sessionState) return this.sessionState;
    this.connectPromise ??= discover(this.layer, {
      accountSettingsId: this.config.accountSettingsId,
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
   * ```ts
   * const data = await client.raw("gateway", "GET", "/json/controls/policyLayers/all");
   * ```
   */
  async raw<T = unknown>(
    tier: HostTier,
    method: HttpMethod,
    path: string,
    opts?: RequestOptions,
  ): Promise<T> {
    await this.connect();
    return this.layer.request<T>(tier, method, path, opts);
  }

  /** @internal Request layer access for sub-clients; ensures connection first. */
  async requestLayer(): Promise<RequestLayer> {
    await this.connect();
    return this.layer;
  }
}
