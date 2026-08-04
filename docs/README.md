# Documentation Map

This folder keeps the current product contracts, development guardrails, release procedures, verification records, and historical notes for Npcink Device Inventory.

## Start Here

- `development-playbook.md`: the working agreement for new changes: scope, evidence, contracts, testing, and release gates.
- `asset-data-model.md`: v3 asset, identity, observation, and event model contract.
- `identity-contract.md`: current hardware identity v2 upload contract.
- `decisions/ADR-003-pre-ga-scope-reset.md`: current product-scope and data-boundary decision.
- `decisions/ADR-004-hardware-identity-v2.md`: current hardware identity design and v1 transition rule.
- `release-readiness-checklist.md`: release gate and manual smoke-test checklist.
- `github-release.md`: GitHub release workflow notes.

## Release Records

- `release-verification-2026-08-03-v3.1.0.md`: current release verification record for plugin 3.1.0 and Device Agent 0.3.0.
- `release-verification-2026-07-10-v2.8.0.md`: v2.8.0 release verification record.
- `release-verification-2026-07-09-v2.7.9.md`: v2.7.9 release verification record.
- `release-verification-2026-07-07-v2.7.8.md`: v2.7.8 release verification record.
- `release-verification-2026-07-07-v2.7.7.md`: v2.7.7 release verification record.
- `post-v2.7.7-hardening-and-v2.7.8-release-summary-2026-07-07.md`: public query and search hardening release summary.
- `release-candidate-verification-2026-07-07-post-hardening.md`: post-hardening release candidate verification.
- `release-candidate-verification-template.md`: template for future release candidate checks.

## Packaging And Distribution

- `plugin-first-release-strategy-2026-07-09.md`: plugin-first release policy and desktop artifact reuse strategy.
- `wordpress-org-update-index-repair-2026-07-08.md`: WordPress.org update index repair record for the v2.7.8 auto-update issue.
- `release-and-dependency-upgrade-summary-2026-07-04.md`: release and dependency upgrade summary.
- `backup-restore-and-release-packaging-history-2026-07-06.md`: backup/restore and package workflow history.
- `desktop-updater-release-history-2026-07-06.md`: desktop updater release history.
- `admin-latest-and-macos-uploader-history-2026-07-06.md`: admin latest-state and macOS uploader notes.
- `github-transition-summary.md`: transition notes for GitHub-based distribution.

## Historical Context

The files in this section preserve the reasoning behind earlier decisions; they
do not override the current contracts above. In particular, records that refer
to v1-only identity, public queries, or writable analysis workflows are
historical unless a newer ADR explicitly restores them.

- `simple-device-management-analysis-boundary-2026-07-10.md`: superseded product-boundary history from before ADR-003.
- `analysis-remediation-development-notes-2026-07-10.md`: superseded writable-analysis history from before ADR-003.
- `device-data-v2-contract.md`: deprecated uploader identity contract retained for history.
- `project-history-summary-2026-06-30.md`: project-level history summary.
- `device-inventory-product-and-release-history-2026-07-04.md`: product and release history.
- `v3-rebuild-release-summary.md`: v3 rebuild summary.
- `modernization-history.md`: modernization history.
- `admin-ui-reconciliation-history.md`: admin UI reconciliation notes.
- `client-token-package-preset-history.md`: client token and preset packaging notes.
- `data-tools-and-asset-policy-history-2026-07-03.md`: data tools and asset policy notes.
- `ele-rust-phase1.md`: Rust/Tauri uploader phase 1 notes.
- `archive/modernization-ai-notes.md`: early AI-assisted modernization notes; historical only.

## Incidents And Review Follow-Ups

- `asset-list-regexp-incident-2026-07-06.md`: asset list search incident note.
- `plugin-check-db-cache-escaping-follow-up-2026-07-03.md`: Plugin Check and escaping follow-up.
- `desktop-uploader-win11-stabilization-summary-2026-07-03.md`: Windows 11 desktop uploader stabilization summary.
- `wordpress-org-release-audit.md`: WordPress.org release audit.
- `wordpress-org-review-feedback-2026-06-26.md`: WordPress.org review feedback.
