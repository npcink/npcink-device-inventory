# Release verification: plugin 3.1.3

## Outcome

The 3.1.3 WordPress plugin package was built and verified on 2026-08-06.
Both the daily release ZIP and the WordPress.org submission ZIP contain the
same bytes and pass the official Plugin Check gate.

## Package identity

- Plugin version: `3.1.3`
- WordPress tested in Docker: `7.0.2`
- PHP tested in Docker: `8.3`
- Plugin Check: `2.0.0`
- Package entry count: `80`
- SHA-256: `b590964483858c8cc685f41f45b95a820ccf76f0bf547b274c5700dc067023d2`
- Release package: `release/npcink-device-inventory.zip`
- Submission package: `sj/npcink-device-inventory.zip`

## Feature scope included

- Separate `secondHandMarketValue` and `financialResidualValue` fields with the
  legacy `residualValue` compatibility alias.
- Idempotent `financial_residual_value` schema migration.
- Straight-line monthly depreciation with configurable depreciation period and
  terminal residual rate.
- Automatic financial residual mode by default, with manual exceptions.
- Asset-list financial completeness filters and an analysis-page completion
  queue.
- Configurable Excel/CSV export with field presets, ordered columns, status
  colors, and a separate WordPress-aware full-width preview.

## Automated verification

The following checks passed:

```text
php -l on all changed PHP files
npm run check:submission
npm run check:docker
```

`npm run check:submission` passed version, release-scope, frontend build and
lint, hardware audit, PHP fixtures, PHPStan, PHPCS, desktop quality, package
structure, WordPress.org review rules, and submission manifest consistency.

`npm run check:docker` passed all of the following in a disposable Compose
environment:

1. Install and activate the release ZIP on a clean WordPress site.
2. Install and activate official Plugin Check 2.0.0.
3. Run `wp plugin check npcink-device-inventory`.
4. Confirm: `Checks complete. No errors found.`
5. Execute the real backup/restore rehearsal.
6. Remove the containers, network, and data volumes after completion.

## Packaging rules confirmed

- The ZIP includes runtime PHP files, language files, README/license files, and
  the built `vite-admin/dist` assets.
- It excludes `node_modules`, Rust `target`, local release staging, source-only
  local data, and unrelated desktop artifacts.
- Release and submission ZIPs are byte-identical.
- The plugin header, `NPCINK_DEVICE_INVENTORY_VERSION`, and `README.txt` stable
  tag all report `3.1.3`.

## Remaining release responsibility

Plugin Check is a static and runtime compatibility gate, not a replacement for
WordPress.org human review. Before public distribution, retain the package
hash, run the release checklist, and perform a clean admin smoke test against
the exact ZIP that will be uploaded.
