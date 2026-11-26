# Npcink Device Inventory

Npcink Device Inventory is a WordPress plugin for small-team device asset management. It tracks assets, observation snapshots, identity matching signals, and event timelines.

See the [development playbook](docs/development-playbook.md) for current scope and release verification. The current source recommends Device Agent **0.4.7** and supports **0.4.6** as the minimum compatible version; these are compatibility values, not a release announcement.

## Project Layout

- `npcink-device-inventory.php`: WordPress plugin bootstrap.
- `admin/`: WordPress admin entry points and lifecycle helpers.
- `includes/`: plugin loader, activation, current database schema, and v3 REST controllers and repositories.
- `vite-admin/`: React admin app loaded by the WordPress admin page.
- `ele-rs/`: Rust/Tauri hardware collector and uploader.
- `docs/`: data contracts, release workflows, verification records, and historical notes.
- `scripts/`: release packaging, desktop update manifest, and local backup/restore verification scripts.
- `tests/`: offline fixtures and regression checks.
- `sj/`: WordPress.org submission materials, directory assets, and review-response archive.

New uploader work should use `ele-rs/`.

## Data Model

v3 uses a unified asset model. See `docs/asset-data-model.md` for the contract. Runtime tables use the active WordPress database prefix:

- `npcink_assets`: canonical asset records.
- `npcink_asset_identities`: asset identity and matching signals.
- `npcink_asset_observations`: client, import, or manual observation snapshots.
- `npcink_asset_events`: unified event and audit timeline.

Plugin settings are stored in `npcink_device_inventory_v3_options`. Upload tokens are stored in a separate option with autoload disabled; this does not encrypt them. The plugin's own JSON backup excludes the tokens and upload base URL. Protect full database and options backups separately. During uninstall, data deletion follows each site's setting.

## API And Auth

The REST namespace is `npcink-device-inventory/v1`.

- Admin endpoints require `manage_options` plus a valid WordPress REST nonce.
- Device upload uses `/device-observations` and `/device-observations/verify` under the namespace and requires an authorization code from the admin UI. Signature v2 binds the method, route, token ID, timestamp, nonce, and raw body hash. Uploads use schema 5 hardware facts; the server recalculates v2 identity evidence and returns `409` when evidence points to different assets. See the [identity contract](docs/identity-contract.md).
- The desktop client may receive the site home URL, `/wp-json`, `/wp-json/npcink-device-inventory/v1`, or the full upload endpoint. It normalizes these inputs to the v3 observation endpoint.
- The default `GET /assets` projection omits full hardware snapshots. Use `includeHardware=true` only when required; individual asset details and backup still include full hardware.
- CSV preflight uses `POST /assets/import/lookup` for up to 100 exact asset numbers per request, including soft-deleted records. `POST /assets/import` remains the separate transactional write step.
- `GET /analysis/collection-trends` groups observations by the site's configured calendar timezone. For the complete list of management and backup routes, see the [primary README](README.md#数据模型).

## Local Verification

PHP and plugin checks:

```bash
composer install
composer run phpstan
composer run phpcs
npm run check:fixtures
npm run check:versions
npm run check:docker
```

Admin app:

```bash
cd vite-admin
npm ci
npm run build
```

Rust/Tauri uploader:

```bash
cd ele-rs
npm ci
cargo test
npm run build
```

Local HMAC end-to-end verification requires a WordPress site with this plugin installed and active:

```bash
WP_PATH="/path/to/wordpress" \
SITE_URL="https://example.local" \
DEVICE_NOTE="verification-device" \
bash .github/scripts/verify-local-e2e.sh
```

## Release Packaging

Build the WordPress plugin zip:

```bash
cd /path/to/npcink-device-inventory
npm ci --prefix vite-admin
npm run build:release
npm run check:release
```

Output:

```text
release/npcink-device-inventory.zip
```

The plugin zip contains only WordPress runtime files, language files, licenses/readmes, and built `vite-admin/dist` assets. It excludes `ele-rs/`, `node_modules`, Rust `target`, and local release caches.

For a WordPress.org submission package, run the explicit submission workflow:

```bash
npm run build:submission
npm run check:submission
```

Use the `Build preview packages` GitHub Actions workflow for preview artifacts. Pushing a `v*` tag triggers the release workflow.
