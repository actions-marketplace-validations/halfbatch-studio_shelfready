# Changelog

## 0.1.1 (2026-11-19)

- Fix: the npm package now includes the built CLI (`dist/`). 0.1.0 on npm was missing it, so `shelf` didn't run.
- Publishing always builds first, and CI checks the package contents before every release.

## 0.1.0 (2026-11-19)

First public version, used to ship [kipple](https://halfbatch.studio/kipple/).

- `shelf scan`, `init`, `pages` (privacy policy, support page, Impressum, SwiftUI `LegalView`), `store --privacy-json`, `check` (`--ci`, `--online`, `--format github`), `checklist`, `migrate`
- Config schema v2 with migrations
- SDK knowledge base: 21 SDKs, generated from their own privacy manifests
- GitHub Action
