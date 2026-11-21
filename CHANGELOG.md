# Changelog

## 0.2.1 (2026-11-21)

- `shelf checklist`: live-page items show as "not checked" (`?`) instead of open when you run without `--online`, and the summary says how many weren't checked.
- Listed in the official MCP Registry as `io.github.halfbatch-studio/shelfready`; the release workflow publishes each version there.
- README: setup for Claude Code (from the terminal, so it also works in VS Code), Codex CLI and other MCP clients.
- `shelf agents`, and an offer in `shelf init` (`--agents-note`, `--no-agents-note`; `agentsNote` in the MCP tool): adds a short ShelfReady note to `AGENTS.md`, or `CLAUDE.md` if the repo uses that, so every coding agent in the repo runs the checks before a release.
- shelfready.dev: a page per SDK (what it collects and what to declare in App Privacy), a section for coding agents, `llms.txt`, `sitemap.xml`.

## 0.2.0 (2026-11-20)

- `shelf mcp`: an MCP server on stdio with the CLI's commands as tools (`scan`, `init`, `check`, `checklist`, `tick`, `pages`, `app_privacy`, `sdk_info`, `migrate`). No new dependencies; tested against the official MCP SDK client. Tools only write inside the app repo.
- Claude Code plugin in `plugin/`: a ShelfReady skill plus the MCP server. Install with `/plugin install shelfready --marketplace halfbatch-studio/shelfready`.

## 0.1.1 (2026-11-19)

- Fix: the npm package now includes the built CLI (`dist/`). 0.1.0 on npm was missing it, so `shelf` didn't run.
- Publishing always builds first, and CI checks the package contents before every release.

## 0.1.0 (2026-11-19)

First public version, used to ship [kipple](https://halfbatch.studio/kipple/).

- `shelf scan`, `init`, `pages` (privacy policy, support page, Impressum, SwiftUI `LegalView`), `store --privacy-json`, `check` (`--ci`, `--online`, `--format github`), `checklist`, `migrate`
- Config schema v2 with migrations
- SDK knowledge base: 21 SDKs, generated from their own privacy manifests
- GitHub Action
