# Release Verification: Plugin 3.1.2 / Agent 0.3.3

Date: 2026-08-05

## Scope

- Return `409 duplicate_number` for asset-number conflicts, including archived assets and database duplicate-key races.
- Add Windows monitor, chassis, physical disk, real route, DNS, DHCP, CPU specification and battery collection.
- Add macOS physical NVMe/SATA disk, real route, DNS, DHCP, Apple core-type and battery-health collection.
- Display monitor identity, physical disk, network configuration and battery information in the WordPress admin asset details.
- Keep replaceable hardware outside the unique-device identity contract.

## Versions

- WordPress plugin: `3.1.2`
- Desktop Agent: `0.3.3`
- Observation schema: `5`

## Verification

- Version and release-scope contracts passed.
- Frontend lint, TypeScript production builds and hardware-audit fixtures passed.
- PHP fixtures, PHPStan and PHPCS passed.
- Collector: 25 Rust tests, formatting and strict Clippy passed.
- Tauri desktop: 10 Rust tests, formatting and strict Clippy passed.
- macOS live collection verified physical NVMe disk, default route, DNS, DHCP, Apple performance/efficiency cores and battery health.
- Release and submission package structure and WordPress.org review-rule checks passed.
- Isolated Docker verification passed with WordPress 7.0.2, PHP 8.3 and MariaDB 11.
- Official Plugin Check 2.0.0 completed with no errors.
- Real JSON backup restore rehearsal passed.

## Artifacts

- `release/npcink-device-inventory.zip`
- `sj/npcink-device-inventory.zip`
- Synchronized package SHA-256: `16596a44e32fa5213366e22574deac7a85fc318eee89c8356b87c7fd2d78824e`

Desktop installers and signed updater manifests are produced by the `v3.1.2` GitHub tag release workflow. Windows collection still requires final smoke validation on representative physical devices after the workflow artifact is installed.
