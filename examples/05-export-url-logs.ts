/**
 * Page through recent URL event logs and write them to a JSON file.
 *
 *   npx tsx examples/05-export-url-logs.ts > url-logs.json
 */
import { IbossClient, resolveProfile } from "@iboss/sdk";

const profile = resolveProfile();
const client = new IbossClient({
  domain: profile.domain,
  credentials: { apiKey: profile.apiKey },
});

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const all: unknown[] = [];
for (let page = 0; page < MAX_PAGES; page++) {
  const batch = await client.reporting.listUrlLogEntries({
    currentRowNumber: page * PAGE_SIZE + 1, // 1-indexed
    maxItemsToReturn: PAGE_SIZE,
  });
  const entries = batch.entries ?? [];
  all.push(...entries);
  if (entries.length < PAGE_SIZE) break;
}

console.log(JSON.stringify(all, null, 2));
console.error(`Exported ${all.length} URL log entries.`);
