# Contributing to Inkeep Agents Optional Local Dev

This repository ships the Docker Compose layer for the [Inkeep Agents](https://github.com/inkeep/agents) framework's optional local-development services (Nango, SigNoz, OTel Collector, Jaeger). It is developed in Inkeep's internal monorepo and mirrored here with Copybara.

## How Public PRs Flow

1. Open a PR against this repository.
2. Automation mirrors the PR into Inkeep's internal monorepo for review and merge.
3. Once merged internally, the change syncs back here and your PR is closed automatically (not merged — the change lands via the mirror sync, not via the public PR).

Review and merge decisions happen in the internal mirror so that public and internal development stay on the same history.

## What to Expect After Opening a PR

- **Within ~1 minute** a bot will post a sticky comment indicating that an internal mirror PR has been opened. The link in that comment points to a private repo and won't be accessible to you; that's expected.
- **Maintainer review happens in the internal mirror.** Reviewer comments are **not auto-mirrored back to your PR**. If you don't hear back within a few business days, please comment on your PR to nudge — that's the right thing to do, not annoying.
- **Your PR will be closed (not merged)** once the change has been merged internally and synced back.

## Scope

This repo is small and focused on Docker Compose service definitions. For broader product contributions, see the [Inkeep Agents repository](https://github.com/inkeep/agents) and its contribution guide.
