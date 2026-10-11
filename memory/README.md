# Public API memory

Short, reviewed facts about the iboss API and this SDK that customer-facing assistants can load. Each note is one fact that points at the public page stating it; the docs stay the source of truth.

| Folder | Holds |
|---|---|
| `api/` | Behavior of a specific endpoint or SDK method |
| `use-cases/` | A fact about combining calls for a common automation goal |
| `faq/` | A recurring misunderstanding and the correct reading |

Every note is kind `invariant` with this frontmatter: `id`, `kind`, `tier: public`, `area`, `source`, `owner`, `last_verified`, `valid_from`, and optionally `signatures`, `valid_until_version`, `valid_until_date`. Start from `_templates/invariant.md`.

## Adding a note

1. Write the note and run `npm run check:memory`.
2. Open a PR with `?template=memory.md`. The `memory-check` workflow runs the same checks and posts an advisory review against the questions in `.github/memory-review.md`.
3. A maintainer approves and merges.

## Releases

Maintainers publish merged notes by pushing a `memory-v<version>` tag on `main`. The `memory-release` workflow waits for approval on the `memory-release` environment, then attaches `index.json`, a tarball of `memory/`, and `SHA256SUMS` to a GitHub release. Assistants load a pinned release index rather than the branch.

`index.json` is format 1: `{format, tier, version, commit, generated, notes[]}`, where each note carries its frontmatter, `body`, and `path`. Expired notes are left out.
