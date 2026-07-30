# Releasing Hive

This is the maintainer procedure for publishing signed desktop and server artifacts. Releases are
manual, originate from `main`, and stop as drafts for final review.

## Release channels

Use Semantic Versioning:

- beta: `0.2.0-beta.1`, `0.2.0-beta.2`;
- release candidate: `0.2.0-rc.1`;
- stable: `0.2.0`.

GitHub marks versions containing a prerelease suffix as prereleases. They do not replace
`/releases/latest`. Never move or reuse a published tag; fix a bad build with a new version.

Cargo is the canonical source of the full release version. Private npm workspace versions are not
product versions. The macOS bundle uses the numeric core version required by Apple while the app's
embedded provisioning code retains the full Cargo version.

## One-time GitHub and Apple setup

Create a GitHub environment named `release`:

1. restrict deployment branches to `main`;
2. add the maintainer as a required reviewer;
3. leave **Prevent self-review** disabled when there is only one release maintainer;
4. store these environment secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_ISSUER` | App Store Connect team API issuer ID |
| `APPLE_API_KEY` | App Store Connect team API key ID |
| `APPLE_API_PRIVATE_KEY` | Complete contents of the matching `.p8` private key |

Use an App Store Connect **team** API key for notarization, not an individual API key. Keep local
backups of the certificate and private keys in a secure credential store. Anyone who obtains the
certificate and password can sign software as the certificate holder; revoke a compromised API key
immediately and contact Apple about a compromised Developer ID certificate.

The application identifier is permanently `io.419labs.hive`. The distributed desktop supports
Apple Silicon and macOS 14 or later.

After making the repository public, configure a `main` branch ruleset that:

- requires a pull request before merging, with no approving review required;
- requires the `ci`, `desktop`, and `ios` status checks;
- requires branches to be up to date before merging;
- blocks force pushes and branch deletion.

Run the workflows once before selecting their status checks in the ruleset. Also enable private
vulnerability reporting, secret scanning, and push protection in the repository security settings.
Dependabot version updates are configured in the repository and start automatically once enabled by
GitHub.

## Prepare the version

Create a branch from the latest `main`, then update the version:

```bash
git switch -c release/0.1.0-beta.1 main
npm run release:version -- set 0.1.0-beta.1
npm run release:version:check
npm run lint
npm run typecheck
npm test
npm run test:release
npm run test:provision
```

Commit the version through a normal pull request. Merge only after required checks pass. Do not let
the release workflow modify `main`.

## Build the draft

From the repository's **Actions** tab:

1. open the `release` workflow;
2. choose **Run workflow**;
3. select `main`;
4. enter the exact version merged above;
5. approve the `release` environment when the macOS signing job reaches it.

The workflow rejects another branch, a mismatched Cargo version, or an existing tag. It reruns
release-critical checks before producing artifacts.

Expected draft assets:

```text
Hive-<version>-macos-arm64.dmg
Hive-<version>-macos-arm64.dmg.sha256
hive-backend-<version>-linux-x64.tar.gz
hive-backend-<version>-linux-x64.tar.gz.sha256
hive-backend-<version>-linux-arm64.tar.gz
hive-backend-<version>-linux-arm64.tar.gz.sha256
provision.sh
```

GitHub also exposes source `.zip` and `.tar.gz` archives for the release tag.

## Review and publish

Before publishing the draft:

1. confirm the tag and target commit match the intended `main` commit;
2. review the generated notes and labels;
3. confirm all seven assets exist;
4. compare the published checksums with locally calculated SHA-256 values;
5. install the DMG on a clean Apple Silicon Mac;
6. confirm Gatekeeper shows only the normal downloaded-from-Internet confirmation;
7. open Hive and complete a connection;
8. install the backend on clean Linux x64 and arm64 servers;
9. verify unauthenticated access is rejected and authenticated access succeeds;
10. restart each server and confirm Hive reconnects.

For a prerelease test, use its direct tag URLs because `/releases/latest` resolves only to a stable
release. Publish the draft only after the relevant smoke tests pass.

Creating the draft also creates its tag. If a draft is wrong, correct the code through another pull
request and use a new prerelease version. If a published release is wrong, document the issue and
publish a new version. Never replace assets or move an existing tag.
