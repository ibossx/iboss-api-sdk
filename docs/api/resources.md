# Resources (the Resource catalog)

**Console:** Resources ·
**Tier:** cloud (`/ibcloud/web/...`) · **SDK:** `client.resources`

Resources represent the SaaS apps, private apps, and services the platform
knows about — corporate email, CRM, cloud consoles, internal tools. The
catalog contains **built-in** definitions; you create **enterprise-owned
copies** to customize and reference from
[Resource Policies](resource-policies.md) and elsewhere in the console.

## Endpoints

| Endpoint | SDK method |
|---|---|
| `GET /ibcloud/web/zeroTrust/resource?builtIn=false&...` | `list(opts?)` — many filter params defaulted by the SDK |
| (client-side match on the list) | `getByName(name)` |
| `POST /ibcloud/web/zeroTrust/resources/save` | `save(resource)` — create/copy/update |
| `DELETE /ibcloud/web/zeroTrust/resource/delete?uuid=` | `delete(uuid)` |

(The wire paths contain `zeroTrust`; in the console these are simply
"Resources".)

Response envelope: `{ successful, result: [...] }`; each resource has `uuid`,
`name`/`displayName`, `enterpriseOwned`, `builtIn`, `parentUuid`,
`domainObjects`.

## Usage

```ts
// Find an enterprise resource (builtIn: false is the default filter)
const resource = await client.resources.getByName("Example SaaS App");

// Browse the built-in catalog instead
const catalog = await client.resources.list({ builtIn: true, query: "mail" });

// Reference it from a Resource Policy (see resource-policies.md)
await client.policies.associateResources({
  customCategoryId: policy.customCategoryId,
  customCategoryNumber: policy.customCategoryNumber,
  resourceIds: [resource!.uuid],
});
```

Gotchas:

- Policies must reference the **enterprise-owned copy**
  (`enterpriseOwned: true`), not the built-in catalog entry. Copy a catalog
  entry via `save()` — the platform assigns the copy a new `uuid` and keeps
  the original in `parentUuid`.
- `list()` paginates (`maxItemsToReturn`, `currentRowNumber`); the SDK default
  is 100 items — raise it or page for large tenants.
- Resource payloads are large and vary by resource type; when creating custom
  ones, GET an existing resource of the same type and use it as a template.
