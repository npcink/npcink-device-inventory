# Asset Data Model

## Status

Accepted direction for new development.

This model is the runtime contract for v3. Old export files are treated as
one-time migration inputs, not as runtime compatibility storage.

## Core Concepts

- Asset: the managed item, such as a computer, monitor, peripheral, account, or
  custom business device.
- Identity: a stable signal used to decide whether incoming data belongs to the
  same asset.
- Observation: a collected or imported snapshot of facts about an asset.
- Event: a human or system action that changed, explained, imported, or observed
  asset state.

## Tables

### `npcink_assets`

Canonical asset row.

Important fields:

- `uuid`: public asset identifier.
- `asset_type`: closed top-level family: `computer` or `custom`.
- `asset_number`: human-facing asset number, unique across all assets, including
  archived rows. Creating or updating an asset with a number owned by another
  row returns `409 duplicate_number`; archiving alone does not release it.
- `name`, `owner_name`, `department`, `status`, `category`: normal list and
  filter fields.
- `purchase_price`, `residual_value`: financial summary fields.
- `metadata_json`: JSON-encoded asset-type-specific fields that do not justify
  new columns. Stored as `LONGTEXT` for broad MySQL/MariaDB compatibility.

### `npcink_asset_identities`

Identity claims for matching uploads and imports to assets.

Current automatic identity types are defined in
[`identity-contract.md`](identity-contract.md):

- `system_uuid_v2` (valid SMBIOS/system UUID)
- `baseboard_serial_v2` (manufacturer, model, and valid baseboard serial)
- `pci_permanent_mac_v2` (permanent address of a physical, non-virtual PCI
  adapter, guarded by baseboard and CPU model facts)

One upload may claim multiple v2 signals. The server recomputes every claim
from the observation facts; client-provided hashes have no authority. If the
signals resolve to different assets, ingestion fails with 409 instead of
guessing or merging. `device_uuid_v1` and `fallback_device_v1` remain stored
only for the one-time upgrade lookup described by the identity contract; new
assets never receive them.

`identity_type + identity_value` is globally unique so one physical identity
cannot silently point to two different assets.

### `npcink_asset_observations`

Collected snapshots. The current asset row should stay small and searchable;
large hardware data belongs here.

Typical sources:

- `uploader`
- `admin_import`
- `manual_entry`

`summary_json` keeps normalized display summaries, `hardware_json` keeps
structured hardware detail, and `raw_json` preserves source payloads for
debugging. These JSON-encoded fields are stored as `LONGTEXT` for broad
MySQL/MariaDB compatibility.

Current uploader hardware observations may contain CPU, memory modules,
physical disks, network interfaces and route configuration, graphics
controllers, displays, battery health, mainboard, BIOS and system information.
Physical disks and mounted filesystems are separate concepts: physical disk
inventory belongs in `hardware_json.disks`, while volumes and mount points stay
in `raw_json.filesystems`. Replaceable parts and peripherals are observation
facts only and never participate in unique device identity.

### `npcink_asset_events`

Unified timeline and audit log.

This table replaces the conceptual split between manual and automatic change
records. Use:

- `event_source`: `manual`, `system`, `upload`, `import`.
- `event_type`: `created`, `updated`, `field_changed`, `observation_received`,
  `merged`, `deleted`, or a narrower product event.
- `field_name`, `old_value`, `new_value`: field-level change data when relevant.
- `message`: human-readable note.
- `payload_json`: JSON-encoded structured event-specific detail, stored as
  `LONGTEXT` for broad MySQL/MariaDB compatibility.

## Extension Rule

Do not add a new asset category by creating another asset table or extending
`asset_type`. Use `category` on a `custom` asset, plus observations and events
where needed.

Old data should be converted into this model before import.
