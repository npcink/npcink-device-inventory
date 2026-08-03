# Test Fixtures And Regression Checks

This folder contains lightweight regression checks that can run without a full WordPress browser session.

- `backup-restore-fixtures.php`: JSON backup/restore dry-run and import behavior fixtures.
- `asset-search-fixtures.php`: asset search cost and extended-search guard fixtures.
- `asset-write-fixtures.php`: atomic batch asset updates, validation, audit, and rollback fixtures.
- `device-upload-boundary-fixtures.php`: observation payload size/shape and signed upload rate-limit fixtures.
- `schema-migration-fixtures.php`: ordered, resumable schema revision selection fixtures.
- `identity-contract-fixtures.php`: PHP/Rust hardware identity v2 golden vectors, exclusions, and v1 transition lookup fixtures.
- `identity-claim-fixtures.php`: atomic identity claim, idempotency, conflict, and failure fixtures.
- `observation-ingest-fixtures.php`: transaction rollback, concurrent identity ownership, and audit failure fixtures.
- `fixtures/device-observation-demo.json`: synthetic, sanitized hardware observation sample for documentation and parser experiments.

Run the root package scripts for the supported checks:

```bash
npm run check:backup-restore
npm run check:asset-search
npm run check:asset-writes
npm run check:device-upload
npm run check:schema-migrations
npm run check:identity
```
