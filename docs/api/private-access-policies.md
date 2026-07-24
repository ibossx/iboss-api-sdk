# Private Access Policies (ZTNA)

**Console:** Secure Access Policies → Private Access Policies ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.network`, `client.policies`

Private Access (ZTNA) replaces VPN access to internal apps and networks.
Three pieces work together:

1. **Routed peers** — the gateways/agents that front private networks
   (console: Manage Peers). Each peer routes subnets/domains and belongs to
   peer locations.
2. **Private Access general settings** — listen port, public key, NAT, peer
   gateways (console: Private Access General Settings).
3. **Routed policies** — the policy rows that grant subjects access through
   those peers (console: the Private Access Routed Policies list).

> Requires the `ENABLE_PRIVATE_ACCESS` subscription flag — check
> `client.session.account.subscriptionFlags` before configuring; calls
> return 422 (`IbossSubscriptionError`) without it.

## Routed peers

| Endpoint | SDK method |
|---|---|
| `GET /json/network/mobileClients/peer` | `client.network.listPeers()` |
| `PUT /json/network/mobileClients/peer` | `client.network.createPeer(peer)` |
| create + poll for UUID | **`client.network.createPeerAndFind(peer)`** ← use this |
| `DELETE /json/network/mobileClients/peer?uuid=` | `client.network.deletePeer(uuid)` |

```ts
const location = await client.locations.createPacZone({ /* see locations-pac.md */ });
const peer = await client.network.createPeerAndFind({
  name: "Main Office Network",
  aclIpSubnetList: "10.0.0.0/24",
  locationUuids: location.result!.uuid!,   // from the location (PAC zone)
  locationBased: 1,
  locationPreference: 1,
  allowAllPortsAndProtocols: true,
});
```

Gotchas:

- **Peer creation returns no UUID** (`{ message: "Success." }` only).
  `createPeerAndFind()` re-lists and matches on `locationUuids`/name,
  retrying while location propagation completes (can take several seconds).
- Peer locations come from [locations-pac.md](locations-pac.md); the console
  shows them in the peer's Peer Locations column.

## Private Access general settings

| Endpoint | SDK method |
|---|---|
| `POST /json/network/mobileClients/ztnaFlowDhcpGateway` | `client.network.updateZtnaFlowDhcpGateway(settings)` — DHCP gateway / NAT configuration |

Other general settings (listen port, public key, peer gateways) are not
wrapped yet — probe with `npx iboss api` and use `client.raw()`, or wrap them
via the `add-api-client` skill.

> Console warning applies to the API too: changing Private Access general
> settings or peers disconnects clients until they re-register. Modify off
> hours.

## Routed policies

A routed policy is created like a [Resource Policy](resource-policies.md)
(two-step, `client.policies.createLayer` with
`isZeroTrustResourcePolicy: 1`), with settings that link it to peers:

```ts
const policy = await client.policies.createLayer({
  name: "Access to Core Office",
  type: "allowlist",
  isZeroTrustResourcePolicy: 1,
  settings: {
    ztnaFlowPeerIds: peer.uuid,        // links the policy to the routed peer
    policyAction: 1,
    linkPolicyToAllSubjects: 0,        // typically scoped to groups/users
  },
});
```

List them with `client.policies.listResourcePolicies()` (routed policies
appear alongside the SaaS & Internet Access Policies; the `ztnaFlowPeerIds`
field distinguishes them).
