# shelfready.dev

A single static page: the App Store go-live checklist, generated from the same items as `shelf checklist` (`cli/src/core/checklist.ts`), plus a short intro to the CLI. Self-hosted fonts, no cookies or tracking; visitors' ticks stay in their own browser (localStorage).

## Build
```sh
cd ../cli && npm ci && npm run build
cd ../site && npm ci && npm run build     # writes dist/
```

## Deploy (Cloudflare Workers Builds)
The site is a static-assets-only Worker; `wrangler.jsonc` says what to upload (`dist/`) and attaches `shelfready.dev` as a custom domain.

Settings › Builds:

| Field | Value |
|---|---|
| Root directory | `/site` |
| Build command | `cd ../cli && npm ci && npm run build && cd ../site && npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variable | `NODE_VERSION` = `22` (optional) |

The Worker's name in the dashboard must match `"name"` in `wrangler.jsonc` (`shelfready`). Every push to `main` redeploys, so the checklist on the site always matches the CLI.

Check locally without deploying: `npx wrangler deploy --dry-run`.
