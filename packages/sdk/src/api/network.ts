/**
 * Network-side settings (gateway tier) spanning three console sections:
 *
 *  - Network → Proxy & Caching: proxy settings, proxy logging
 *    (docs/api/proxy-and-caching.md)
 *  - Secure Access Policies → Private Access (ZTNA): routed peers, DHCP
 *    gateway/NAT (docs/api/private-access-policies.md)
 *  - Connect Devices & Locations → Connector Settings: per-group connector
 *    settings incl. security keys (docs/api/connector-policies.md)
 *
 * Gotcha: creating a routed peer does NOT return its uuid. Re-list peers and
 * match on your locationUuids/name to find it (createPeerAndFind does this).
 */
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";

export interface ZtnaPeer {
  uuid?: string;
  name?: string;
  aclIpSubnetList?: string;
  locationUuids?: string;
  locationBased?: number;
  [key: string]: unknown;
}

export class NetworkApi extends SubClient {
  async updateProxySettings(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/proxy/settings", { body: settings });
  }

  /**
   * Proxy error/access logging toggles, e.g.
   * { logProxyAccessDeniedErrors: false, logProxyAllOtherErrors: true,
   *   logProxyDnsConnectionFailures: true }.
   */
  async updateProxyLogging(settings: Record<string, boolean>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/preferences/reportSettings/changeProxyLogging", {
      body: settings,
    });
  }

  // --- ZTNA routed peers --------------------------------------------------

  async listPeers(): Promise<ZtnaPeer[]> {
    const result = await this.request<EntriesResponse<ZtnaPeer> | ZtnaPeer[]>(
      "gateway",
      "GET",
      "/json/network/mobileClients/peer",
    );
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  /** Create a routed peer. The response has no uuid — see createPeerAndFind. */
  async createPeer(peer: ZtnaPeer): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/network/mobileClients/peer", { body: peer });
  }

  /**
   * Create a routed peer, then poll the peer list until it appears (location
   * UUID propagation can take a few seconds) and return it with its uuid.
   */
  async createPeerAndFind(
    peer: ZtnaPeer & { name: string },
    opts: { attempts?: number; delayMs?: number } = {},
  ): Promise<ZtnaPeer> {
    await this.createPeer(peer);
    const attempts = opts.attempts ?? 15;
    const delayMs = opts.delayMs ?? 2000;
    for (let i = 0; i < attempts; i++) {
      const peers = await this.listPeers();
      const match = peers.find(
        (p) =>
          (peer.locationUuids && p.locationUuids === peer.locationUuids) ||
          p.name === peer.name,
      );
      if (match?.uuid) return match;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`Routed peer "${peer.name}" was created but never appeared in the peer list.`);
  }

  async deletePeer(uuid: string): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/network/mobileClients/peer", {
      query: { uuid },
    });
  }

  // --- Mobile client / connector group settings ----------------------------

  /** Group settings including the connector security key. */
  async getMobileClientSettings(policyGroup: number): Promise<Record<string, unknown>> {
    return this.request("gateway", "GET", "/json/network/mobileClients/settings", {
      query: { currentPolicyBeingEdited: policyGroup },
    });
  }

  async updateMobileClientSettings(
    policyGroup: number,
    settings: Record<string, unknown>,
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/mobileClients/settings", {
      query: { currentPolicyBeingEdited: policyGroup },
      body: settings,
    });
  }

  /** ZTNA flow DHCP gateway / NAT configuration. */
  async updateZtnaFlowDhcpGateway(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/network/mobileClients/ztnaFlowDhcpGateway", {
      body: settings,
    });
  }
}
