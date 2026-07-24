# Proxy Users & Devices

**Console:** Resources, Users & Assets ·
**Tier:** gateway (`/json/...`) · **SDK:** `client.directory`

Static proxy **users** (username/password auth to the proxy) and static
**devices** (identified by IP address), each assignable to a policy group.

## Users

| Endpoint | SDK method |
|---|---|
| `GET /json/users` | `listUsers()` — `{ entries, userCount }` envelope |
| `PUT /json/users` | `addUser(user)` |
| `POST /json/users` | `updateUser(user)` — requires `id`, full object |
| `POST /json/users` (+ `password`, `updatePassword: 1`) | `updateUserPassword(user, newPassword)` |
| `DELETE /json/users?id=` | `deleteUser(id)` |

The SDK fills sensible defaults (`userType: 0`, `policyGroup: 0`/"Default",
`sessionTimeout: 300`, daily time limits "86400"). Note the platform wants the
per-day time limits as **strings**.

## Devices

| Endpoint | SDK method |
|---|---|
| `GET /json/computers/static` | `listDevices({ groupNumberFilter? })` |
| `PUT /json/computer` | `addDevice(device)` |
| `POST /json/computer` | `updateDevice(device)` — requires `id`, full object |
| `DELETE /json/computers/static?id=` | `deleteDevice(id)` |

Defaults applied by `addDevice`: `groupNumber: -1` (default group),
`ipBasedNode: 1`, `computerPolicyOverridesUserPolicy: 1`,
`numberOfIpAddresses: 1`.

Gotchas:

- Updates are full-object POSTs — GET the entry first, modify, send it all
  back.
- List/add/delete use **different paths** for devices (`/json/computer` to
  write a single device, `/json/computers/static` to list/delete) — the SDK
  handles it, but mind this with `client.raw()`.
