# Kito Harness release and operations runbook

English | [中文](kito-harness-release.zh.md)

This is the operational source of truth for Kito Harness: upstream synchronization, native macOS and Windows builds, GitHub Releases, `kito.ktai.im`, acceptance, and recurring failures. Read this before releasing or debugging Kito customizations instead of relying on a prior chat session.

## Scope and release boundaries

Kito Harness is the KT fork of `deepseek-ai/deepseek-harness`. The production source of truth is `main` in `kt-aihub/deepseek-harness`; upstream follows `master` and `dsh-v*` tags in `deepseek-ai/deepseek-harness`.

Kito Harness numbers its releases apart from upstream. Every `package.json` keeps the dsh version of the merged upstream release, and `kt/kito-harness/version.json` holds the Kito Harness release version that installers, the application, and the update feed carry. The fork does not run `pnpm release:dsh` for a release and does not push `dsh-v*` tags.

Current distribution:

- macOS Apple Silicon: PKG (recommended) and DMG.
- Windows x64: NSIS EXE.
- Installers are unsigned internal builds. The download page must keep its security notice and must not claim Apple notarization or Windows signing.
- `kito.ktai.im` is served by the Cloudflare Worker in `kt-aihub/kito-download-page`. Normal releases update the Release and `kito-harness-latest/latest.json`, not Worker code.

Never publish a development `.app` as a release. Release bytes must come from a traceable commit through `Release · Desktop`, or from equivalent local packaging and smoke verification on the same commit.

## Custom feature map

| Capability | Owner / key path | Failure when lost |
|---|---|---|
| Kito brand, account, balance, language | `packages/client/ui-brand-kito/`; dependency required in `packages/bundle/web-app/package.json` | Username, USD balance, and language selector disappear |
| Model picker and vendor groups | `packages/client/ui-model-selection/` | Small menu, clipped names, missing vendor icons or aliases |
| Live model catalog and reasoning levels | `packages/llm/llm-pi-ai/src/live-catalog.ts`, `adapter.ts`; NewAPI `/v1/models` `reasoning` metadata | Fabricated or missing levels, or protocol errors |
| Account launcher and version button | `packages/client/ui-settings-account/src/client/AccountMenu.tsx` | The former feedback button shows `v${DSH_CLIENT_VERSION}` and still opens the feedback form |
| Kito identity and desktop keepalive | `apps/desktop/src/kito-identity-keepalive.ts`, `kito-wallet-window.ts`, `main.ts` | Login redirects, balance refresh, or shutdown cleanup failures |
| Desktop recovery | `apps/desktop/src/main.ts`, `tests/main-startup.spec.ts` | First two renderer crashes reload; the third enters fatal recovery. Tests must trigger three crashes |
| Kito build | Root `build:kito`, `DSH_BUILD_CLIENT_PROFILE=kito`, `cc.ktapi.harness` | Missing script, wrong product name, or wrong bundle ID |

During upstream merges, review not only source conflicts but also manifests, resource exports, dependency declarations, and test assumptions. Dependency consistency between `packages/bundle/web-app/package.json` and `cordis.patch.yml` is a required acceptance check.

## Standard release flow

### 1. Synchronize upstream and verify custom behavior

Prefer an upstream release tag over an unreleased HEAD. After resolving conflicts, run at least:

```sh
pnpm run typecheck
pnpm exec vitest run packages/client/ui-settings-account/tests/account.client.spec.tsx
pnpm exec vitest run packages/client/ui-brand-kito/tests/browser-plugin.client.spec.tsx
pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts
```

Do not replace Kito interaction tests with upstream's old menu model. The current picker is a page-sized dialog, the account launcher is Kito-owned, and desktop recovery has three-crash semantics.

### 2. Bump the version and merge into main

```sh
VERSION=1.0.0-rc.1
git checkout -b release/kito-$VERSION
printf '{\n  "version": "%s"\n}\n' "$VERSION" > kt/kito-harness/version.json
git commit -am "release(kito): $VERSION"
git push -u ktaiorg "release/kito-$VERSION"
```

Merge through a PR into `main`. The version commit must exist before building. Never create a production package from uncommitted source. The new version must be greater than every released one, because installed applications only update upward. Leave the `package.json` versions unchanged.

### 3. Build natively on both platforms

Dispatch `.github/workflows/release-desktop.yml` after the merge:

```sh
kt gh --owner kt-aihub --repo deepseek-harness api \
  -X POST repos/kt-aihub/deepseek-harness/actions/workflows/release-desktop.yml/dispatches \
  -f ref=main
```

macOS builds DMG/PKG on a macOS Runner; Windows builds EXE on a Windows Runner. Never claim a Windows package was built on macOS, and do not replace CI artifacts with bytes from a different commit.

After the run succeeds, download and extract its artifacts with the checked-in helper:

```sh
RUN_ID=<actions-run-id>
python3 scripts/release/github_release_artifacts.py download "$RUN_ID" "/tmp/kito-$VERSION"
```

### 4. Create the Release and upload immutable assets

Create the tag and Release against the full merged commit SHA:

```sh
TAG="kito-harness-v$VERSION"
kt gh --owner kt-aihub --repo deepseek-harness release create "$TAG" \
  --target <full-main-commit-sha> \
  --title "Kito Harness $VERSION" \
  --notes "Kito Harness $VERSION, based on DeepSeek Harness $(node -p "require('./package.json').version"). Apple Silicon PKG/DMG and Windows EXE, unsigned internal builds."
```

Resolve the release id and upload all three installers:

```sh
RELEASE_ID=$(curl -s "https://api.github.com/repositories/1334176894/releases/tags/$TAG" -H 'User-Agent: kito' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
python3 scripts/release/github_release_artifacts.py upload "$RELEASE_ID" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-mac-arm64-unsigned.pkg" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-mac-arm64-unsigned.dmg" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-win-x64-unsigned.exe"
```

The helper uses a short-lived kt-ci-bot installation token. Private keys and tokens remain in memory and are never printed or saved. Do not use the GitHub web attachment form for large installers (25 MB limit), and do not rely on `kt gh release upload` for large files.

Verify HTTP 201, asset size, and public URL for every upload. Update `SHA256SUMS.txt`, then hash the publicly downloaded bytes again; local hashes alone do not verify the published bytes.

### 5. Update latest.json

The fixed metadata URL is `https://github.com/kt-aihub/deepseek-harness/releases/download/kito-harness-latest/latest.json`. For each release, update only the version, URLs, sizes, and SHA256 values:

```json
{
  "name": "kito-harness-desktop",
  "version": "1.0.0-rc.1",
  "downloads": {
    "windows-x64": { "versionedUrl": "<exe-url>", "filename": "<exe>", "sha256": "<sha256>", "size": 0 },
    "macos-arm64": { "versionedUrl": "<pkg-url>", "filename": "<pkg>", "sha256": "<sha256>", "size": 0 },
    "macos-arm64-dmg": { "versionedUrl": "<dmg-url>", "filename": "<dmg>", "sha256": "<sha256>", "size": 0 }
  }
}
```

Find the old `latest.json` asset ID in the `kito-harness-latest` Release asset list, delete that asset, and upload the new JSON. Never reuse an asset ID from memory. RC suffixes are valid. Windows, PKG, and DMG are shown only when the corresponding assets actually exist.

### 6. Production acceptance

```sh
curl -s https://kito.ktai.im/ | grep -E 'Kito Harness|1.0.0-rc.1|unsigned.(pkg|dmg|exe)'
```

Verify all of the following:

- The target version is displayed; Windows x64 and Apple Silicon rows are visible and unpublished platforms are hidden.
- The primary button downloads PKG; DMG and EXE URLs also return HTTP 200.
- Public download hashes match the local artifacts byte for byte.
- The launched build shows the account name/balance, language selector, version button, and model dialog.
- A new session asked to “reply OK only, no tools” receives a real model response without errors.

## Recurring failures and their fixes

| Symptom / error | Cause and required action |
|---|---|
| Username, balance, and language selector disappear | `packages/bundle/web-app/package.json` is missing `@deepseek-ai/dsh-client-ui-brand-kito`; restore the dependency and rebuild instead of editing CSS |
| `Command "build:kito" not found` | Root `build:kito` was lost during a merge; restore `tsx scripts/build.ts --profile kito` |
| `Could not resolve "./assets/...svg"` | `ui-model-selection/package.json` lacks the `"./assets/*": "./lib/assets/*"` export and `lib/assets` in `files` |
| `dsh release members must share one version`, or `package.json version must match root version` | A fork-owned package kept the previous dsh version after an upstream merge; set the `version` of `packages/llm/llm-ktapi` and `packages/client/ui-brand-kito` to the root `package.json` version. Do not use `pnpm release:dsh` to number a Kito release |
| `Node-API headers missing` | The selected Codex/DSH Node runtime lacks headers; use Node 24 with `include/node/node_api.h` |
| Electron download timeout | Set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` and rerun the same build |
| `DSH_CLIENT_COMMIT_HASH must match` | A commit raced the build; let the commit settle and package again |
| Windows `MANDATORY_UPDATE_CONFIG must be valid JSON` | PowerShell escaping wrote invalid JSON; use single-quoted literal JSON, not `\"` |
| macOS CI `No files were found` | `upload-artifact` does not support `*.{dmg,pkg}`; use separate `*.dmg` and `*.pkg` path lines |
| GitHub API cannot resolve the release version | Repository migration returns 301; use immutable repository id `1334176894` or the fixed `kito-harness-latest/latest.json` |
| Large upload fails / web form 25 MB limit | Stream with `scripts/release/github_release_artifacts.py` and a short-lived App token; retry over HTTP/1.1 when needed |
| `Issue policy` queries upstream and returns 404 | The upstream script hardcodes the source repository name, an existing fork CI issue; do not misclassify it as a product test failure |

## Rollback

Keep old Releases. Restore the previous verified version in `kito-harness-latest/latest.json`, then recheck after the 10-second manifest cache and 30-second page cache expire. Revert code through a new PR; do not rewrite tag history or overwrite public bytes for the same version.

## Handoff checklist

- [ ] `kt/kito-harness/version.json`, the `kito-harness-v*` tag, and the build commit on `main` agree; no `dsh-v*` tag was pushed.
- [ ] macOS and Windows artifacts come from one CI run, and only that run's bytes are uploaded.
- [ ] Release, SHA256SUMS, and latest.json agree on version, size, and hash.
- [ ] The download page, public downloads, and a real application launch all pass acceptance.
- [ ] This runbook covers any new custom capability or failure; add new findings here instead of leaving them in chat.
