# Default Policy Groups

**Console:** Secure Access Policies → Default Policies ·
**Tiers:** cloud + gateway · **SDK:** `client.groups`, `client.apps`

Default policy groups (the platform's "filtering groups") are the numbered
policy containers that users, devices, and connectors are assigned to. This
covers the group definitions themselves (names, logging, SSL bypass) and the
per-group web controls (application controls, geolocation blocking, file
upload controls). [Policy Layers](policy-layers.md) and group-targeted
[Resource Policies](resource-policies.md) reference these groups by
`groupNumber`.

## Group settings (cloud tier)

| Endpoint | SDK method |
|---|---|
| `GET /ibcloud/web/groups/filtering[?groupNumber=&groupName=&wildcard=]` | `client.groups.listFilteringGroups(filter?)` |
| `POST /ibcloud/web/groups/filtering` | `client.groups.updateFilteringGroup(group)` |
| `PUT /ibcloud/web/groups/filtering/reserve` | `client.groups.reserveFilteringGroup(groupNumber)` |
| `PUT /ibcloud/web/groups/filtering/unreserve` | `client.groups.unreserveFilteringGroup(groupNumber)` |

Group fields include `groupNumber`, `groupName`, `enableWebLogging`,
`priority`, `reportingGroupNumber`, `bypassSslMitm`, `reservedGroup`.

Notes:

- Updates expect the **complete group object** (the SDK injects the required
  `type` discriminator). GET → modify → POST.
- Reserve a group number before assigning it a special purpose so the
  platform won't hand it out elsewhere.
- Well-known platform defaults used by
  [connector policies](connector-policies.md): Windows/macOS/Linux → groups
  2–6, iOS → 7, Chromebook → 8, Android → 9.
- Gateway endpoints reference a group via the `currentPolicyBeingEdited`
  query parameter.

## Per-group web controls (gateway tier)

Each takes `{ policyGroup }` (sent as `currentPolicyBeingEdited`):

| Endpoint | SDK methods |
|---|---|
| `GET/POST /json/controls/apps` | `client.apps.getAppControls()` / `updateAppControls(settings)` |
| `GET/POST /json/controls/geoIp/settings` | `client.apps.getGeoIpSettings()` / `updateGeoIpSettings(settings)` |
| `GET/POST /json/controls/fileUpload/settings` | `client.apps.getFileUploadSettings()` / `updateFileUploadSettings(settings)` |
| `GET /json/controls/confidenceScores` | `client.apps.getConfidenceScores()` |

Settings objects are large per-app/per-country flag maps — **GET first,
modify the flags you care about, POST the whole object back.**

## Reporting groups (cloud tier)

Reporting groups organize report data (console: Reporting). They are
separate from default policy groups; a policy group points at one via
`reportingGroupNumber`.

| Endpoint | SDK method |
|---|---|
| `GET /ibcloud/web/groups/reporting` | `client.groups.listReportingGroups()` |
| `POST /ibcloud/web/groups/reporting` | `client.groups.createReportingGroup({ name, number })` |
| `PUT /ibcloud/web/groups/reporting` | `client.groups.updateReportingGroup({ name, number })` |
| `DELETE /ibcloud/web/groups/reporting?groupNumber=` | `client.groups.deleteReportingGroup(number)` |

Each reporting group carries a platform-assigned 15-char
`groupCloudReportingKey`. `reportGenerationDisabled`: 0 = reports on.
