# Reporting, URL Logs & Incidents

**Console:** Reporting ·
**Tier:** reporter (`/ibreports/web/...`) · **SDK:** `client.reporting`

> The reporter node is discovered at connect(); accounts without a reporting
> cluster raise `IbossHostUnavailableError` for these calls.

## Incident capture settings

| Endpoint | SDK method |
|---|---|
| `GET /ibreports/web/zerotrust/incident/settings` | `getIncidentSettings()` |
| `POST /ibreports/web/zerotrust/incident/settings` | `saveIncidentSettings(settings)` |

## Drill-down reports

| Endpoint | SDK method |
|---|---|
| `GET /ibreports/web/reports/lite?month=&year=&reportingGroupId=&dailyReport=-1` | `listReports(opts?)` → find the `reportId` |
| `GET /ibreports/web/reports/{reportId}/web/topCategoryHits` | `topCategoryHits(reportId, opts?)` |
| `.../topBlockedDomains` | `topBlockedDomains(reportId, opts?)` |
| `.../topVisitedDomains` | `topVisitedDomains(reportId, opts?)` |
| `.../topUsersOverallWebHits` | `topUsersByHits(reportId, opts?)` |
| `.../topUsersOverallTime` | `topUsersByTime(reportId, opts?)` |

Top-N options: `currentRowNumber` (**1-indexed**), `maxItemsToReturn`,
`startDate`/`endDate` (ISO). Responses use the `{ entries, totalCount }`
envelope.

```ts
const reports = await client.reporting.listReports();       // current month
const blocked = await client.reporting.topBlockedDomains(reports[0]!.reportId, {
  maxItemsToReturn: 25,
});
```

## URL event logs

| Endpoint | SDK method |
|---|---|
| `GET /ibreports/web/log/url/archives` | `listUrlLogArchives()` |
| `GET /ibreports/web/log/url/entries?startDate=&endDate=&...` | `listUrlLogEntries(opts?)` |

Entries include `timestamp`, `userName`, `sourceIp`, `destinationUrl`,
`category`, `action` ("allowed"/"blocked"), `bytesTransferred`. Page with
`currentRowNumber`/`maxItemsToReturn` for exports; for very large pulls use
`client.raw("reporter", "GET", path, { raw: true })` to stream the response.
