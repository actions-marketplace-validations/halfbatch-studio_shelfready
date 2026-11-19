# ShelfReady

Get an iOS app ready for the App Store shelf. ShelfReady reads your repo and keeps the non-code parts of a release honest: the privacy policy, support page and Impressum, your App Privacy answers, and a go-live checklist. In CI it fails the build when a new SDK or data type isn't covered by your policy.

It does not upload builds or fill in App Store Connect; use [`asc`](https://github.com/rudrankriyam/App-Store-Connect-CLI) or fastlane for that. ShelfReady covers the legal, privacy and web layer around them, with the EU steps most tools skip.

Website and the full checklist: **[shelfready.dev](https://shelfready.dev)**

## Quick start

```sh
brew install halfbatch-studio/tap/shelfready   # or: npm install -g shelfready   (Node 20+)

cd ~/path/to/your-app
shelf init --country DE --email support@example.com --brand "Your Studio" --voice I --base-url https://example.com/app/
# review shelfready.yaml: add privacy notes and FAQ
shelf pages --swiftui MyApp/LegalView.swift   # privacy, support, Impressum + in-app view
shelf store                                   # fastlane/app_privacy_details.json
shelf check --ci                              # fails on drift
shelf checklist --online                      # what's left before you submit
```

## Commands

| Command | What it does |
|---|---|
| `shelf scan` | Reads bundle IDs, display names, permission texts (Info.plist and `INFOPLIST_KEY_*`), privacy manifests (XML or binary), export compliance, and packages from Package.resolved, Podfile.lock and Cartfile.resolved |
| `shelf init` | Writes `shelfready.yaml` from the scan plus your publisher details; known SDKs add what they collect |
| `shelf pages` | Privacy policy, support page and Impressum (Germany and Austria) as Markdown with Jekyll front matter; `--swiftui` writes a `LegalView` for the in-app Impressum |
| `shelf store` | App Privacy answers in fastlane's `app_privacy_details.json` format; data types without an App Store Connect category are reported, never guessed |
| `shelf check` | Drift between `shelfready.yaml` and the repo, missing manifests, placeholder permission texts, unknown SDKs, trader details, in-app Impressum. `--ci` exits 1 on errors, `--online` checks the published pages, `--format github` annotates pull requests |
| `shelf checklist` | The go-live checklist: automatic items from `check`, manual ones you tick with `--done <id>`; `--markdown` writes it as a file |
| `shelf migrate` | Updates `shelfready.yaml` to the current schema, keeping your comments and style |

## GitHub Action

```yaml
# .github/workflows/shelfready.yml
name: ShelfReady
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: halfbatch-studio/shelfready@v0
        with:
          online: "false"   # "true" also checks the live pages
```

Inputs: `path` (folder with `shelfready.yaml`, default `.`), `online` (default `false`), `fail-on-error` (default `true`). Findings appear as annotations and in the job summary.

## What ShelfReady knows about SDKs

`cli/knowledge/` describes 21 common SDKs (Firebase, RevenueCat, Sentry, Mixpanel, Amplitude, PostHog, Facebook, OneSignal, Bugsnag, Datadog, Segment, TelemetryDeck, Adapty, Superwall, Google Sign-In, Supabase, Alamofire, Kingfisher, SDWebImage, Lottie, Realm). Every entry is generated from the SDK's own privacy manifest and records the commit it came from; `npm run kb:import` refreshes them. Additions are welcome: add the SDK to `cli/knowledge/sources.yaml` and run the import.

## Config: `shelfready.yaml`

One file in your app repo holds the facts behind your pages: app, publisher (`voice: I` or `we`, trader status, Impressum details), collected data, privacy notes, FAQ, page URLs and checklist ticks. It's versioned: when ShelfReady changes the format, `shelf migrate` updates the file and lists what to review. See [`examples/kipple`](examples/kipple) for a real one and its generated output.

## Status and limits

- Version 0.1. Used to ship [kipple](https://halfbatch.studio/kipple/); expect rough edges.
- **Not legal advice.** Page templates are drafts based on § 5 DDG, the GDPR and Apple's rules, not yet reviewed by a lawyer. You're responsible for what your pages say.
- iOS only for now.

## Repository

```
cli/        the `shelf` CLI and its core library (TypeScript), tests, SDK knowledge base
site/       shelfready.dev, generated from the same checklist items as the CLI
examples/   real configs and output
action.yml  the GitHub Action
```

## License

[Apache-2.0](LICENSE) © Half Batch. The license covers the code, not the names: "ShelfReady" and "Half Batch" aren't licensed for use by forks (see [NOTICE](NOTICE)).
