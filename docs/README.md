# Documentation Map

This folder keeps the current product contracts, development guardrails, release procedures, verification records, and historical notes for Npcink Device Inventory.

## Start Here

- `development-playbook.md`: the working agreement for new changes: scope, evidence, contracts, testing, and release gates.
- `v3.1.4-asset-lifecycle-admin-quality-retrospective-2026-08-10.md`: consolidated 3.1.4 lifecycle, device-type, finance, hardware-summary, admin-UI, full-chain, and release standards.
- `admin-read-only-analysis-development-standard.md`: implementation, data-semantics, UI, permission, and verification rules for read-only admin analytics.
- `analysis-hardware-inventory-and-navigation-retrospective-2026-08-10.md`: legacy hardware-inventory history, restored v3 counting semantics, consolidated analysis navigation, review findings, and future development rules.
- `asset-data-model.md`: v3 asset, identity, observation, and event model contract.
- `asset-finance-export-development-retrospective-2026-08-06.md`: consolidated finance-field, depreciation, missing-data, configurable export, UI iteration, and verification standard.
- `asset-type-archive-admin-ui-development-retrospective-2026-08-06.md`: device subtype reuse, archive-as-business-exclusion, compact admin forms, date localization, summary hierarchy, and final PCP lessons.
- `identity-contract.md`: current hardware identity v2 upload contract.
- `device-upload-troubleshooting-and-operations.md`: production upload troubleshooting, evidence, and recovery runbook.
- `decisions/ADR-003-pre-ga-scope-reset.md`: pre-GA scope reset; its analysis restriction is partially superseded by ADR-009.
- `decisions/ADR-004-hardware-identity-v2.md`: current hardware identity design and v1 transition rule.
- `decisions/ADR-006-guard-legacy-identity-migration.md`: evidence-continuity guard for legacy identity migration.
- `decisions/ADR-007-keep-production-diagnostics-lightweight.md`: decision to keep production diagnostics lightweight.
- `decisions/ADR-008-separate-asset-number-identity-and-observation.md`: boundary between business asset numbers, hardware identity, and replaceable hardware observations.
- `decisions/ADR-009-restore-read-only-analysis.md`: current boundary for read-only trends, distributions, value summaries, and excluded writable analysis workflows.
- `decisions/ADR-010-separate-market-and-financial-residual-values.md`: separates second-hand market value from accounting residual value while preserving legacy compatibility.
- `decisions/ADR-011-configurable-asset-export.md`: configurable Excel/CSV export, status colors, ordered fields, and separate WordPress-aware preview.
- `decisions/ADR-012-treat-archived-assets-as-business-excluded-records.md`: archived assets remain auditable but are excluded from operational lists, calculations, uploads, and asset-table exports.
- `decisions/ADR-013-consolidate-analysis-navigation-and-restore-hardware-inventory.md`: restores CPU/disk/memory/baseboard inventory on current facts and groups analysis into four stable management domains.
- `device-identity-collection-release-retrospective-2026-08-05.md`: consolidated incident, collection, operating, and release lessons from the 3.1.2/0.3.3 phase.
- `read-only-analysis-restoration-retrospective-2026-08-06.md`: history, real-data findings, UI iterations, and reusable lessons from restoring read-only analytics and multi-factor queries.
- `release-readiness-checklist.md`: release gate and manual smoke-test checklist.
- `github-release.md`: GitHub release workflow notes.

## Release Records

- `release-verification-2026-08-10-v3.1.4.md`: release verification record for plugin 3.1.4, including lifecycle invariants, official Plugin Check, and isolated backup/restore validation.
- `release-verification-2026-08-05-v3.1.2.md`: current release verification record for plugin 3.1.2 and Device Agent 0.3.3.
- `release-verification-2026-08-06-v3.1.3.md`: release verification record for plugin 3.1.3, including the official Plugin Check 2.0.0 result and package hash.
- `release-verification-2026-08-05-v3.1.1.md`: previous release verification record for plugin 3.1.1 and Device Agent 0.3.2.
- `release-verification-2026-08-03-v3.1.0.md`: previous release verification record for plugin 3.1.0 and Device Agent 0.3.0.
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

- `windows-identity-and-asset-reconciliation-incident-2026-08-05.md`: Windows collection failure and 32/35 identity reconciliation incident.
- `asset-list-regexp-incident-2026-07-06.md`: asset list search incident note.
- `plugin-check-db-cache-escaping-follow-up-2026-07-03.md`: Plugin Check and escaping follow-up.
- `desktop-uploader-win11-stabilization-summary-2026-07-03.md`: Windows 11 desktop uploader stabilization summary.
- `wordpress-org-release-audit.md`: WordPress.org release audit.
- `wordpress-org-review-feedback-2026-06-26.md`: WordPress.org review feedback.
