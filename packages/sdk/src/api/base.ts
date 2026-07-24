/**
 * Base class for feature-area sub-clients (client.policies, client.dlp, ...).
 * Sub-clients are thin: every call funnels through the client's RequestLayer,
 * which handles auth, cookies, XSRF, retries, and error mapping.
 */
import type { IbossClient } from "../client/IbossClient.js";
import type { HttpMethod } from "../client/errors.js";
import type { HostTier } from "../client/hosts.js";
import type { RequestOptions } from "../client/request.js";

/** Common success envelope used by many mutating endpoints. */
export interface SuccessResponse {
  successful?: boolean;
  message?: string;
  [key: string]: unknown;
}

/** Common list envelope used by many gateway endpoints. */
export interface EntriesResponse<T> {
  entries: T[];
  totalCount?: number;
  message?: string;
  [key: string]: unknown;
}

export abstract class SubClient {
  constructor(protected readonly client: IbossClient) {}

  protected async request<T = unknown>(
    tier: HostTier,
    method: HttpMethod,
    path: string,
    opts?: RequestOptions,
  ): Promise<T> {
    const layer = await this.client.requestLayer();
    return layer.request<T>(tier, method, path, opts);
  }
}
