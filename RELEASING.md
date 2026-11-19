# Releasing

## Every release
1. Bump `version` in `cli/package.json` and add a `## X.Y.Z (date)` section to `CHANGELOG.md`.
2. Commit, then tag and push:
   ```sh
   git tag -a vX.Y.Z -m "ShelfReady X.Y.Z" && git push origin main vX.Y.Z
   ```
3. The **Release** workflow tests and builds, publishes `shelfready` to npm, creates the GitHub release from the changelog, moves the `v0` tag (so `halfbatch-studio/shelfready@v0` gets the new version) and updates the Homebrew formula.

Use the Half Batch identity in your clone so tags don't expose your email:
`git config user.name "Half Batch" && git config user.email "hello@shelfready.dev"`.

## One-time setup
- **npm, first version by hand:** `cd cli && npm publish --access public` (logged in as the Half Batch npm user with 2FA).
- **npm trusted publishing:** npmjs.com › shelfready › Settings › Trusted publisher › GitHub Actions: organization `halfbatch-studio`, repository `shelfready`, workflow `release.yml`. After that, no npm token is stored anywhere; every version shows a verified link to the commit that built it.
- **Homebrew tap:** create the empty public repo `halfbatch-studio/homebrew-tap`. Create a fine-grained token with Contents read/write on that repo only, and save it in this repo as the Actions secret `HOMEBREW_TAP_TOKEN`. Without the secret, the workflow skips the tap.

Users then install with:
```sh
brew install halfbatch-studio/tap/shelfready     # installs `shelf` and `shelfready`
```
