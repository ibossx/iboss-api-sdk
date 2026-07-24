/**
 * Locations (PAC zones) and private networks (cloud tier).
 *
 * Gotcha: PAC zone proxyHosts should reference the discovered gateway cluster
 * DNS (session.hosts.gatewayClusterDns), typically as "<clusterDns>:80".
 */
import { SubClient, type SuccessResponse } from "./base.js";

export interface PacZone {
  pacSettingsId?: number;
  uuid?: string;
  name: string;
  description?: string;
  geoZoneType?: string;
  geoZoneLocationType?: string;
  remoteUserInternetAccess?: boolean;
  defaultAction?: string;
  loadBalancingEnabled?: boolean;
  numGateways?: number;
  enablePrivateAccess?: boolean;
  proxyHosts?: string[];
  [key: string]: unknown;
}

export interface PrivateNetwork {
  id?: number;
  name?: string;
  [key: string]: unknown;
}

export class LocationsApi extends SubClient {
  /**
   * List locations. Gotchas baked in: the list path is `pacZones` (plural —
   * the singular path 500s for listing), `requestKey=v2` is required, and the
   * pagination params are mandatory. The platform's `totalRecords` is
   * unreliable, so a single large page is requested.
   */
  async listPacZones(opts?: { maxItemsToReturn?: number }): Promise<PacZone[]> {
    const result = await this.request<{ result?: PacZone[] } | PacZone[] | undefined>(
      "cloud",
      "GET",
      "/ibcloud/web/pacZones",
      {
        query: {
          currentRowNumber: 0,
          maxItemsToReturn: opts?.maxItemsToReturn ?? 1000,
          requestKey: "v2",
        },
      },
    );
    if (!result) return [];
    return Array.isArray(result) ? result : (result.result ?? []);
  }

  /** Read one location by id. */
  async getPacZone(pacSettingsId: number): Promise<PacZone> {
    const result = await this.request<{ result?: PacZone } | PacZone>(
      "cloud",
      "GET",
      `/ibcloud/web/pacZone/${pacSettingsId}`,
    );
    return (result as { result?: PacZone })?.result ?? (result as PacZone);
  }

  /** `requestKey=v2` is required for the v2 response shape. */
  async getDefaultPacZone(): Promise<PacZone> {
    const result = await this.request<{ result?: PacZone } | PacZone>(
      "cloud",
      "GET",
      "/ibcloud/web/pacZone/default",
      { query: { requestKey: "v2" } },
    );
    return (result as { result?: PacZone })?.result ?? (result as PacZone);
  }

  /**
   * Create a location. For proxied locations, set proxyHosts to the discovered
   * cluster DNS: `[`${client.session.hosts.gatewayClusterDns}:80`]`.
   */
  async createPacZone(zone: PacZone): Promise<{ successful?: boolean; result?: PacZone }> {
    return this.request("cloud", "POST", "/ibcloud/web/pacZone", { body: zone });
  }

  /**
   * ⚠ Full-echo update: GET the zone first and send the WHOLE object back
   * with your changes — server-generated fields (uuid, watermark, cluster
   * ids, ...) must be echoed or they are wiped.
   */
  async updatePacZone(zone: PacZone & { pacSettingsId: number }): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/pacZone", { body: zone });
  }

  /** Same full-echo rule as updatePacZone — GET → modify → PUT. */
  async updateDefaultPacZone(zone: PacZone): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/pacZone/default", { body: zone });
  }

  async deletePacZone(pacSettingsId: number): Promise<SuccessResponse> {
    return this.request("cloud", "DELETE", `/ibcloud/web/pacZone/${pacSettingsId}`);
  }

  /** Link a private network to a PAC zone. */
  async linkPrivateNetwork(body: {
    pacZoneId: number | string;
    privateNetworkId: number | string;
    [key: string]: unknown;
  }): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/pacZone/linkPrivateNetwork", { body });
  }

  async unlinkPrivateNetwork(
    zoneId: number | string,
    networkId: number | string,
  ): Promise<SuccessResponse> {
    return this.request("cloud", "DELETE", `/ibcloud/web/pacZone/${zoneId}/delete/${networkId}`);
  }

  async listPrivateNetworks(): Promise<PrivateNetwork[]> {
    const result = await this.request<{ result?: PrivateNetwork[] } | PrivateNetwork[]>(
      "cloud",
      "GET",
      "/ibcloud/web/privateNetwork",
    );
    return Array.isArray(result) ? result : (result?.result ?? []);
  }

  async createPrivateNetwork(network: PrivateNetwork): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/privateNetwork", { body: network });
  }

  async deletePrivateNetwork(id: number | string): Promise<SuccessResponse> {
    return this.request("cloud", "DELETE", `/ibcloud/web/privateNetwork/${id}`);
  }
}
