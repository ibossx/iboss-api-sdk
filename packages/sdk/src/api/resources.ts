/**
 * Resources — the Resource catalog (cloud tier).
 *
 * Console: Resources. Resources represent SaaS apps, private
 * apps, and services referenced by Resource Policies. They are either
 * built-in catalog entries or enterprise-owned copies; associate the
 * enterprise-owned copy (enterpriseOwned: true) with policies. The wire
 * paths contain "zeroTrust" but the console name is simply Resources.
 */
import { SubClient, type SuccessResponse } from "./base.js";

export interface ZeroTrustResource {
  uuid: string;
  name?: string;
  displayName?: string;
  enterpriseOwned?: boolean;
  builtIn?: boolean;
  parentUuid?: string;
  domainObjects?: unknown[];
  [key: string]: unknown;
}

export interface ListResourcesOptions {
  /** Free-text search. */
  query?: string;
  /** false (default) = enterprise resources; true = built-in catalog. */
  builtIn?: boolean;
  maxItemsToReturn?: number;
  currentRowNumber?: number;
  tag?: string;
}

export class ResourcesApi extends SubClient {
  async list(opts: ListResourcesOptions = {}): Promise<ZeroTrustResource[]> {
    const result = await this.request<{ successful?: boolean; result?: ZeroTrustResource[] }>(
      "cloud",
      "GET",
      "/ibcloud/web/zeroTrust/resource",
      {
        query: {
          anchored: -1,
          availability: -1,
          builtIn: opts.builtIn ?? false,
          confidentiality: -1,
          currentRowNumber: opts.currentRowNumber ?? 0,
          filterEnterpriseOwned: -1,
          filterImpactLevel: -1,
          filterUdpEnabled: 0,
          includeDomainUrls: true,
          includeGuestSessionUrl: true,
          integrity: -1,
          maxItemsToReturn: opts.maxItemsToReturn ?? 100,
          orderAscending: true,
          query: opts.query ?? "",
          tag: opts.tag ?? "",
          udpEnabled: -1,
          unmanagedDevice: -1,
        },
      },
    );
    return result?.result ?? [];
  }

  /** Find a resource by exact display name or name (case-insensitive). */
  async getByName(name: string, opts: ListResourcesOptions = {}): Promise<ZeroTrustResource | undefined> {
    const matches = await this.list({ ...opts, query: name });
    const lower = name.toLowerCase();
    return matches.find(
      (r) => r.displayName?.toLowerCase() === lower || r.name?.toLowerCase() === lower,
    );
  }

  /**
   * Create or copy a resource. To make an enterprise copy of a built-in
   * catalog resource, pass the catalog entry with enterpriseOwned settings —
   * the platform assigns a new uuid.
   */
  async save(resource: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/zeroTrust/resources/save", {
      body: resource,
    });
  }

  async delete(uuid: string): Promise<SuccessResponse> {
    return this.request("cloud", "DELETE", "/ibcloud/web/zeroTrust/resource/delete", {
      query: { uuid },
    });
  }
}
