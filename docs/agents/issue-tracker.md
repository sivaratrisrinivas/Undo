# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create, read, list, comment on, label, and close issues with `gh issue`.
- Infer the repository from `git remote -v`.
- Use GitHub issues whenever a skill says to publish to the issue tracker.
- Fetch relevant tickets with `gh issue view <number> --comments`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

PRs are not included in the triage queue. GitHub's shared issue/PR number space should still be considered when resolving ambiguous references such as `#42`.

## Wayfinding operations

The `wayfinder` skill uses a labelled GitHub issue as its map and linked sub-issues as tickets. It uses native GitHub dependencies and assignments where available, with task-list and `Blocked by:` fallbacks where necessary.
