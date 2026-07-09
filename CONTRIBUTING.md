# Contributing to Inkeep Agents Optional Local Dev

This repository ships the Docker Compose layer for the [Inkeep Agents](https://github.com/inkeep/agents) framework's optional local-development services (Nango, SigNoz, OTel Collector, Jaeger). It is maintained by Inkeep and mirrored here with Copybara.

## How Public PRs Flow

1. Open a PR against this repository.
2. Automation mirrors the PR into Inkeep's maintainer review flow.
3. Once accepted, the change syncs back here and your PR is closed automatically (not merged — the change lands via the mirror sync, not via the public PR).

Review and merge decisions happen through the maintainer review flow so mirrored repositories stay on the same history.

## What to Expect After Opening a PR

- The bridge workflow waits for Inkeep to approve its `inkeep-oss-sync` environment deployment before it runs, so the bot comment may not appear immediately.
- **Maintainer review happens after the bridge syncs your PR.** Reviewer comments are **not auto-mirrored back to your PR**. If you don't hear back within a few business days, please comment on your PR to nudge — that's the right thing to do, not annoying.
- **Your PR will be closed (not merged)** once the change has been accepted and synced back. Accepted changes land here with your contribution credited through co-author trailers.

## Scope

This repo is small and focused on Docker Compose service definitions. For broader product contributions, see the [Inkeep Agents repository](https://github.com/inkeep/agents) and its contribution guide.
