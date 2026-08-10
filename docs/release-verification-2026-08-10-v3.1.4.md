# Release verification: Npcink Device Inventory 3.1.4

## Scope

- Computer device type across edit, batch, filter, import, and export workflows.
- Desktop-computer default normalization for new and historical computer assets.
- Archived-asset exclusion from operational calculations and asset-table exports.
- Retired-asset policy: preserve purchase cost and zero market/carrying values.
- Estimated carrying amount terminology and straight-line calculation behavior.
- Compact localized admin forms, date-only list/card labels, and full detail timestamps.
- Virtual graphics filtering and conservative fallback-driver summaries.

## Automated verification

The release candidate passed:

```text
npm run check:fixtures
vite-admin: npm run lint
vite-admin: npm run build
npm run build:release
npm run check:release
npm run check:docker
git diff --check
```

`check:release` included version-contract checks, frontend hardware fixtures,
frontend production build, WordPress.org review rules, PHP fixtures, PHPStan,
PHPCS, Rust formatting, Clippy, Rust tests, dependency audits, package structure,
and release-asset comparison.

## Isolated plugin verification

The Docker gate installed the generated ZIP in a clean environment using
WordPress 7.0.2, PHP 8.3, and MariaDB 11. Official Plugin Check 2.0.0 reported:

```text
Success: Checks complete. No errors found.
```

The real backup/restore rehearsal completed and the gate reported:

```text
Isolated Docker verification passed.
```

## Package

The final package is generated at:

```text
release/npcink-device-inventory.zip
```

The release and synchronized WordPress.org submission packages are byte-identical:

```text
SHA-256: 131d49ac998fc31cc865bef86ff37930c8eb6485324b8ce55093bc7ca4bdd5ee
```

## Known non-blocking output

- The Vite admin build reports the existing large-chunk advisory for the main
  bundle and dynamically loaded ExcelJS asset.
- Cargo audit reports the repository's explicitly allowed upstream GTK3 and
  related maintenance/security warnings.

Neither changed the gate result; both remain visible for future dependency and
bundle work rather than being silently suppressed.
