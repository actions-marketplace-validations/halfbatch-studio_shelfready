# SDK knowledge base

What common third-party SDKs collect, so `shelf init` can fill `data.collected`, `shelf pages` can name the services in the privacy policy, and `shelf check` can flag SDKs it doesn't know.

## Source of truth: the SDK's own privacy manifest

Each entry is generated from the `PrivacyInfo.xcprivacy` files in the SDK's public repository, never written from memory:

- `sources.yaml` lists the SDKs: Swift package identity, display name, vendor, GitHub repo, which manifest paths to read, CocoaPods/Carthage aliases and caveats.
- `npm run kb:import -- <clone folder>` clones each repo (metadata only), reads the manifests at `HEAD` and writes `sdks/<identity>.yaml` with the repository, commit, file links and date.
- Re-run it to refresh after SDK releases; the diff shows what changed.

## Reading an entry

- `products`: one per module with its own manifest (Firebase Crashlytics, Firestore, …). An app usually uses only some, so ShelfReady takes the union and you remove what you don't use from `data.collected`.
- `collects`: data type, linked to the user, used for tracking, purposes, exactly as the SDK declares them.
- `notes`: caveats. Analytics and backend SDKs (Mixpanel, Supabase, Segment, TelemetryDeck) often declare nothing or little because what they send depends on your code: `shelf check` warns so you declare it yourself.

## Not covered

- Binary-only SDKs without a manifest in their repo, e.g. Google Analytics for Firebase (GoogleAppMeasurement) and Google Mobile Ads. Check the vendor's data disclosure.
- Configuration: entries describe what the SDK declares by default; features you turn on or off can change it.

## Entries (2026-11-18)

Firebase, RevenueCat, Sentry, Mixpanel, Amplitude, PostHog, Facebook SDK, OneSignal, Bugsnag, Datadog, Segment, TelemetryDeck, Adapty, Superwall, Google Sign-In, Supabase, Alamofire, Kingfisher, SDWebImage, Lottie, Realm.
