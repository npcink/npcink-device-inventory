# ADR-012: Treat archived assets as business-excluded retained records

## Status

Accepted

## Date

2026-08-06

## Context

The asset status `deleted` historically meant that an administrator had removed
an asset from daily management, but different surfaces could still interpret it
as an ordinary status. This created a risk that archived devices would continue
to affect collection trends, finance totals, renewal candidates, exports, or
other future calculations.

The product does not currently need a recycle-bin workspace, self-service
restore, or permanent deletion. Adding those workflows would introduce more
states, permissions, conflict handling, and destructive operations without a
demonstrated daily need. At the same time, archived records must remain available
for audit history, backup/restore, and asset-number uniqueness.

## Decision

- Keep the stored status value `deleted` for compatibility, but present it as
  “已归档” in the administrator interface.
- Define an active business asset as `status <> 'deleted'`.
- Exclude archived assets from normal lists, search results, statistics,
  analysis, collection trends, renewal candidates, finance calculations, and
  asset-table exports.
- Apply the exclusion at the server query boundary where possible and keep a
  final export-side guard so selected or specially filtered rows cannot leak
  into Excel or CSV output.
- Reject new device observations that resolve to an archived asset with
  `409 asset_archived`. Uploads must never silently restore an asset or continue
  its operational timeline.
- Preserve archived assets, identities, observations, events, and asset numbers
  in the database and complete JSON backups.
- Keep archived asset numbers reserved. A new asset cannot reuse the number
  merely because the previous record was archived.
- Do not provide a recycle-bin page, self-service restore, or permanent-delete
  action at this stage.
- Keep archive separate from `retired`: archiving changes business visibility
  but does not rewrite purchase, market, or carrying values. Retirement remains
  visible in the retained business ledger and follows the zero-current-value
  rule defined by ADR-010.
- Require an explicit destructive-style confirmation before archiving. The
  confirmation states that the asset leaves daily management, remains in
  history, retains its number, and cannot currently be restored by the user.

## Alternatives Considered

### Treat archived as an ordinary filterable status

Rejected because every new calculation would have to remember to remove it.
That makes omissions likely and produces inconsistent totals between screens.

### Build a recycle bin with restore and permanent deletion

Deferred because there is no repeated operational demand. Restore requires a
defined target status and conflict behavior; permanent deletion can break audit,
identity, and observation history.

### Physically delete assets immediately

Rejected because it would remove audit evidence, break references, permit
accidental asset-number reuse, and make backup reconciliation harder.

### Automatically reactivate an archived asset on the next upload

Rejected because a background client must not reverse an administrator's
business decision. Restoration, if introduced later, must be an explicit
administrator action.

## Consequences

- Business totals have one stable definition across current and future features.
- Backup exports intentionally contain archived data even though asset-table
  exports do not.
- Observation queries that join assets must include the archive predicate, and
  archive writes must invalidate observation-derived caches.
- Tests must cover upload rejection and query exclusion, not only UI filtering.
- If restore is added later, it requires a new ADR covering target status,
  number conflicts, permissions, audit events, cache invalidation, and upload
  behavior.
