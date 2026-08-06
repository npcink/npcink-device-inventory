# ADR-011: Use configurable Excel export with a separate full-width preview

## Status

Accepted

## Date

2026-08-06

## Context

Administrators need to export computer and custom asset registers for finance,
administration, inventory checks, and second-hand valuation. A fixed CSV export
cannot preserve status colors, field order, number formats, or frozen headers.
The export also needs to respect server-side asset filters and include every
matching row rather than only the visible page.

The first configurable UI placed settings and a live preview side by side. That
worked for a few columns but made both areas too narrow for realistic registers
with nine or more fields. A viewport-wide modal also extended underneath the
WordPress admin menu because its width was calculated from the browser viewport
instead of the plugin content area.

## Decision

- Use Excel (`.xlsx`) as the styled export format and CSV as the unstyled,
  broadly compatible fallback.
- Generate Excel files in the browser with ExcelJS. Keep it dynamically
  imported so the large workbook dependency is not part of the initial admin
  bundle.
- Let users choose export scope, fields, and field order. The current-filter
  scope fetches all server-side matches, not only the current page.
- Offer reusable presets for the common computer register, finance register,
  and hardware register.
- Apply configurable status colors either to the complete row or only to the
  status cell. Active assets have no fill by default.
- Store the user's default status-color scheme in local browser storage. This
  is a presentation preference, not canonical asset data.
- Keep the configuration dialog single-column and open preview in a separate,
  near-full-width dialog. The preview dialog measures and avoids the WordPress
  admin menu instead of using an unconditional viewport width.
- Preview at most the first 30 matching rows while showing the total result
  count. Export still includes the full selected scope.
- Preserve the selected field order in both Excel and CSV output.

## Alternatives Considered

### Styled CSV

Rejected because CSV has no portable representation for colors, column widths,
frozen panes, filters, or number formats.

### Server-generated workbook

Rejected for this stage because the admin already has the formatted asset data,
the export is an administrator-triggered operation, and browser generation
avoids new file-storage and cleanup responsibilities on the WordPress server.

### Permanent side-by-side live preview

Rejected because the preview becomes incomplete at normal register widths and
reduces the usable configuration area. A separate preview provides a more
truthful representation of the final workbook.

### Persist colors as global WordPress settings

Deferred. Local storage is sufficient while colors remain a per-browser export
preference. Move them to authenticated server settings only if the product
requires one organization-wide color policy.

## Consequences

- The admin package includes ExcelJS and a transitive dependency override that
  must continue to pass `npm audit --omit=dev`.
- The workbook dependency increases the export chunk size, but dynamic import
  keeps the normal admin startup path unchanged.
- Preview and final export share the same field-order and color configuration,
  reducing mismatch risk.
- UI code must account for WordPress admin CSS and layout rather than assuming
  an isolated application viewport.
- CSV users receive the same data and column order but no styling.
