# Release Candidate Verification

Copy into a dated record. Use `pass`, `fail`, `pending`, or `not applicable`
with evidence; a completed CLI smoke is not a complete release decision.

## Candidate identity

- Date / operator:
- Source commit / clean tracked source:
- Plugin version / tag:
- Agent version / scope (plugin or desktop):
- Previous published plugin / Agent version:
- GitHub draft URL / tag build run:
- `candidate.json` source commit matches the tag:
- `SHA256SUMS` SHA-256:
- Plugin ZIP SHA-256:
- Windows exe / `.sig` SHA-256:
- macOS DMG / updater / `.sig` SHA-256:
- Both manifest SHA-256:
- Distribution: trusted internal / public external:

Do not replace assets after recording these hashes. Local and CI packages have
separate identities; local results do not automatically certify later CI bytes.

## Local and remote gates

- `npm run check:release-tools`:
- `npm run build:release` / `npm run check:release`:
- `npm run check:docker` / final tested ZIP hash:
- `npm run check:submission` (no rebuild after Docker):
- Quality workflow run / result:
- macOS / Windows preview runs (packaging only, no updater signature):
- Signed tag-build run / draft-download checksum and signature checks:
- Read-only working inventory left unchanged:

## Windows collection

- Windows / drivers / hardware / PowerShell version:
- Ordinary user result / report path:
- Administrator result / report path:
- Memory module counts/capacities/brands/part numbers/speed units:
- Known 8GiB DXGI / multi-GPU ambiguity / shared memory:
- Physical disk → partition → volume / per-disk health failures:
- Cold/cache/partial retry timing and byte count:
- Timeouts / descendants cleaned / partial records retained:
- Chinese names/paths / large peripheral lists:
- Skipped / failed-optional / manual report steps:

## Plugin upgrade and upload (isolated HTTPS only)

- Test site / trusted certificate / no redirect:
- Previous real database copy and plugin backup:
- Upgrade / schema / identities / latest pointers / archived and finance fields:
- 3.2.3 export preview → restore / retired identity warnings:
- Signature-v2 matching client upload / old-signature rejection:
- Existing authorization code remains valid:
- Idempotency / replay rejection / conflicts / offline and TLS errors:
- New hardware → detail → export/restore field equality:
- Temporary token disabled / test data cleanup:
- Database + installer recovery rehearsal:

## Exact Windows installer

- Exe hash matches accepted draft:
- Clean install / WebView2 / Chinese path:
- Ordinary-user launch / collection / upload / diagnostic export:
- Previous official Agent 0.4.4 → candidate installer upgrade:
- Version increased / configuration and Credential Manager credentials retained:
- Failed install/update recovery:
- Uninstall retention policy:
- Tauri updater signature verification:
- Windows Authenticode (separate; public external distribution requires it):
- macOS Developer ID/notarization (public external distribution requires it):

## Manual publication decision

- All pre-publication blockers closed:
- Operator / evidence reviewed / date:
- Decision: hold / publish existing draft:
- Draft assets unchanged since acceptance:
- Platform-signing limits and signature-v2 rollout in release notes:

Publishing requires a separate human action in GitHub. Do not rebuild, replace
assets, or reuse a version while promoting the draft.

## After publication, before working-device rollout

Private drafts cannot be discovered through the old official Agent's fixed
latest URL. Keep these pending before publication; do not report an isolated
harness or manual installer upgrade as the official in-app update.

- Published URL:
- `Verify published candidate` run / public hashes and signatures:
- Windows official previous version / settings update check:
- Windows menu update check / download / install / restart / final version:
- Windows retained configuration and credentials:
- macOS official GUI update (if applicable):
- Failure holds rollout; recovery action / previous latest selection:
- Final decision: hold / rollout:
