# Locations (PAC Zones) & Private Networks

**Console:** Connect Devices & Locations → Locations & Geo Zones ·
**Tier:** cloud (`/ibcloud/web/...`) · **SDK:** `client.locations`

Locations (PAC zones) define how traffic from a site/network reaches the
platform; private networks describe internal address space and can be linked
to zones (ZTNA).

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /ibcloud/web/pacZones?currentRowNumber=0&maxItemsToReturn=…&requestKey=v2` | `listPacZones()` |
| `GET /ibcloud/web/pacZone/{pacSettingsId}` | `getPacZone(id)` |
| `GET /ibcloud/web/pacZone/default?requestKey=v2` | `getDefaultPacZone()` |
| `POST /ibcloud/web/pacZone` | `createPacZone(zone)` |
| `PUT /ibcloud/web/pacZone` | `updatePacZone(zone)` |
| `PUT /ibcloud/web/pacZone/default` | `updateDefaultPacZone(zone)` |
| `DELETE /ibcloud/web/pacZone/{pacSettingsId}` | `deletePacZone(id)` |
| `POST /ibcloud/web/pacZone/linkPrivateNetwork` | `linkPrivateNetwork({...})` |
| `DELETE /ibcloud/web/pacZone/{zoneId}/delete/{networkId}` | `unlinkPrivateNetwork(zoneId, networkId)` |
| `GET /ibcloud/web/privateNetwork` | `listPrivateNetworks()` |
| `POST /ibcloud/web/privateNetwork` | `createPrivateNetwork(network)` |
| `DELETE /ibcloud/web/privateNetwork/{id}` | `deletePrivateNetwork(id)` |

## Creating a location

```ts
const session = client.session;
const created = await client.locations.createPacZone({
  name: "Main Office",
  geoZoneType: "subnet",
  geoZoneLocationType: "private_location",
  remoteUserInternetAccess: true,
  defaultAction: "proxy",
  loadBalancingEnabled: true,
  numGateways: 2,
  enablePrivateAccess: true,
  // ⚠ proxy hosts MUST use the discovered cluster DNS, port 80:
  proxyHosts: [`${session.hosts.gatewayClusterDns}:80`],
});
// created.result.uuid — needed when creating a ZTNA routed peer for this location
```

Gotchas:

- **Listing is `pacZones` (plural)** — the singular path 500s for listing.
  `requestKey=v2` and the pagination params are **required** (and the
  platform's `totalRecords` is unreliable, so the SDK requests one large
  page). Reads/creates/updates use the singular `/pacZone` path.
- **Updates are full-echo**: GET the zone, modify, PUT the WHOLE object back.
  Server-generated fields (uuid, watermark, cluster ids) must be echoed or
  they are wiped. The SDK enforces `pacSettingsId` on `updatePacZone`.
- **Never hardcode proxy hosts** — always
  `client.session.hosts.gatewayClusterDns` (the SWG cluster's virtual DNS,
  discovered at connect()).
- The creation response's `result.uuid` is the **location UUID** referenced by
  ZTNA routed peers (`locationUuids`) — see
  [private-access-policies.md](private-access-policies.md).
