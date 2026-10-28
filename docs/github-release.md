# GitHub release candidates and publication

Tag builds create **draft candidates**, never a public Release. Existing draft or
published versions are immutable: the workflow fails rather than replacing their
assets. Preview builds remain unsigned packaging checks, not updater acceptance.

## Versions and source

Current development candidate: plugin **3.2.4**, Device Agent **0.4.5**. The previous
formal release is plugin 3.2.3 with Agent 0.4.4. Do not reuse either old version.

Commit all intended source and record the candidate commit before tagging. The
workflow reads the latest published release as its baseline, checks strictly
increasing plugin/desktop versions, and compares changed paths against that
published tag. Unpublished candidate tags do not become the release baseline.

This release changes both ends of the upload contract: request signature v2 is
mandatory. Install the matching Agent and plugin together; old Agent signatures
are rejected, while existing authorization codes remain valid. Use HTTPS without
redirects. Back up the actual database before updating, and rehearse restore and
upgrade using a copy of the previous site's data in an isolated environment.

## Local checks

```bash
npm run build:release
npm run check:release
```

For the final isolated WordPress/MariaDB and WordPress.org submission gate:

```bash
npm run check:docker
npm run check:submission
```

Docker builds the final synchronized release/submission ZIPs. Do not rebuild
after these checks without verifying the new hashes and rerunning the affected
gates. Record `sj/package-manifest.json` and the final package SHA-256. The local
package is not automatically byte-identical to a later CI build: each candidate
must be identified and accepted by its own hash.

## Preview build

`Build preview packages` supports `plugin`, `macos`, `windows`, `desktop`, and
`all`; artifacts expire after seven days. It uses Node 24, plugin PHP checks,
admin lint/build and package checks, and both Rust crates' fmt/Clippy/tests before
building desktop installers. Preview does not enable Tauri updater artifacts or
produce the signed update manifests. It cannot certify automatic updates.

## Signed draft candidate

Only after source and local gates are ready, create the new plugin version tag
(for example `v3.2.4`) and push it. Tag creation/push is a separate release action;
these documentation commands are not automatically executed by local checks.

`Build release packages` selects plugin-only or full desktop scope. Desktop
source/release-tool changes require a full build with a higher desktop version.
Pure plugin releases keep the previously published desktop manifests unchanged.

Desktop tag builds require `TAURI_SIGNING_PRIVATE_KEY`; the password secret is
optional for an unencrypted key. Never print keys or commit them. The generated
`.sig` files must verify against the updater public key in Tauri configuration.
Tauri signatures do not provide Windows Authenticode or Apple Developer ID
signing/notarization. Unsigned platform packages are for trusted internal testing.
Public external distribution requires the relevant platform signing first.

Candidate assets include the plugin ZIP, desktop installers/updater packages and
signatures when applicable, `latest.json`, `latest-desktop.json`, `candidate.json`
(source tag, commit, versions and scope), and `SHA256SUMS`. The workflow downloads
the uploaded draft with authenticated `gh`, checks the complete file set and
hashes, and verifies desktop updater signatures. Drafts are not served by the
public `releases/latest/download/` endpoint.

The build also saves `candidate.json` and `SHA256SUMS` as an independent Actions
artifact for 90 days. The post-publication verifier requires the original
successful tag build and compares both files with that proof, so replacing both
a Release asset and its own checksum does not satisfy verification. Complete
acceptance within that retention window and archive the evidence; an expired
candidate needs a new version/build. Local download verification requires `gh`
authentication with repository/actions read access.

To inspect a draft locally, use an empty output directory and a checkout of the
candidate tag:

```bash
TAG_NAME=v3.2.4 npm run check:published-release -- candidate-assets --draft
npm run check:desktop-manifests -- candidate-assets
npm run check:release-assets -- candidate-assets
```

The last two commands apply to full desktop candidates. Copy the verification
template, record candidate commit, hashes, run links, Windows collection and
installer/upgrade evidence. Do not replace draft assets after acceptance; source
or artifact changes require a new candidate version/tag.

## Windows acceptance and final publication

Run the [Windows collection matrix](windows-collection-acceptance-2026-10-27.md),
then install the exact candidate exe on a clean machine. Test ordinary/admin
permissions, WebView2, Chinese paths, Credential Manager/configuration retention,
previous Agent 0.4.4 installation → candidate installer upgrade, failure recovery,
and uninstall retention policy. Verify plugin upgrade/backup restoration and
signature-v2 uploads on an isolated HTTPS site, never on `device.local`.

The installed 0.4.4 Agent has a fixed official latest endpoint. A private draft
cannot complete its real in-app automatic update. Before publication, verify the
signed bytes/manifests and manual installer upgrade; an isolated updater harness
may provide additional evidence, but is not the old official GUI. Keep the real
settings/menu automatic-update smoke explicitly pending until the accepted draft
is published. Since the project has one user, run that smoke on the designated
test installation before announcing the release or upgrading the working device.

Once pre-publication blockers are closed, the operator reviews the evidence and
publishes the **existing** draft in GitHub (no rebuild/reupload). Publication is a
manual action. `Verify published candidate` runs afterward and independently
downloads/checks public assets and desktop signatures. Then finish the official
GUI update smoke and record the result. Failure holds rollout; retain previous
installers/database backups and restore the previous latest release selection if
needed under an explicit release recovery action, rather than replacing signed
assets under an existing version.

## Local end-to-end script

`.github/scripts/verify-local-e2e.sh` writes a temporary token and an asset,
submits a signature-v2/schema-5 observation, verifies storage, and cleans up its
own test data. Run only against an **isolated HTTPS acceptance site** with a
backup, not an existing working inventory:

```bash
WP_PATH="/path/to/isolated/wordpress" \
SITE_URL="https://acceptance.example.test" \
DEVICE_NOTE="验收设备" \
bash .github/scripts/verify-local-e2e.sh
```

## WordPress package boundary

The plugin ZIP includes `admin/`, `includes/`, `languages/`, `vite-admin/dist/`,
the corresponding `vite-admin/src/` and build configuration/lockfile required for
source review, and plugin bootstrap/readme/license files. It excludes Rust/Tauri
source, docs, local caches, `node_modules`, `vendor` and Rust targets. Do not remove
the reviewable frontend source merely to shrink the ZIP.
