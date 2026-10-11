## Memory notes

<!-- Open with ?template=memory.md. One fact per note; procedures belong in docs/ or a workflow. -->

Notes added or changed:

-

## Author checklist

- [ ] Every statement is safe for any iboss customer to read and doesn't describe unreleased features, security weaknesses, or internal systems.
- [ ] No customer, tenant, account, hostname, IP address (except 192.0.2.x, 198.51.100.x, 203.0.113.x), ticket key, internal repository, source path, or employee is named or hinted at.
- [ ] `source` points at a public SDK file on github.com/ibossx/iboss-api-sdk, a docs.iboss.com page, or a `client.*` method, and that source states the fact.
- [ ] The note matches the source and the SDK method it names.
- [ ] One fact, 600 characters at most, in my own words.
- [ ] Version-dependent facts carry `valid_until_version` or `valid_until_date`.
- [ ] `npm run check:memory` passes locally.

## Maintainer review

Read the advisory review comment from the `memory-check` workflow, then answer the same questions yourself. Public memory reaches customers through the next `memory-v*` release, so treat approval as publishing.
