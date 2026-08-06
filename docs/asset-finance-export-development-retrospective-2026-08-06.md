# Asset finance and configurable export: development retrospective and standard

## Status

Accepted development and maintenance guidance as of 2026-08-06.

## Outcome

This phase delivered one coherent asset-finance workflow:

- separate second-hand market value from financial residual value;
- calculate the effective financial residual value automatically by default;
- allow a manual override for exceptional assets;
- find devices whose purchase price or second-hand market value is missing;
- show a finance-data completion list in read-only analysis;
- export filtered, selected, computer, custom, or all assets to configurable
  Excel and CSV files;
- preserve user-selected column order and apply configurable Excel status
  colors;
- preview a representative table before export without crowding the
  configuration dialog.

The canonical data decision is recorded in
[`ADR-010`](decisions/ADR-010-separate-market-and-financial-residual-values.md).
The export architecture decision is recorded in
[`ADR-011`](decisions/ADR-011-configurable-asset-export.md).

## Requirement history and reasoning

### 1. Start from the work product, not the database

The original request was a practical computer register containing asset number,
owner, department, purchase price, second-hand price, residual value, mainboard,
CPU, and other selectable fields. The correct product surface was therefore an
export action in the asset workspace, not a generic database dump.

The export scope must be explicit:

- current filter means all matching server results, never only the visible page;
- selected means assets explicitly checked in batch mode;
- computer, custom, and all ignore the current list filter as labelled;
- an unavailable scope should be explained, not displayed as a broken control.

### 2. Resolve semantic ambiguity before adding calculations

`residualValue` previously represented both a second-hand market estimate and
an accounting residual value. Adding depreciation on top of that ambiguity
would have produced financially misleading reports.

The model now uses:

- `secondHandMarketValue`: expected current resale price;
- `financialResidualValue`: accounting value used by depreciation and finance
  summaries;
- deprecated `residualValue`: compatibility alias of the second-hand value;
- database `residual_value`: legacy column retained as second-hand value;
- database `financial_residual_value`: distinct accounting value.

Do not populate one field from the other merely because both are missing. Their
sources and meanings are different.

### 3. Automatic calculation is the default; manual values are exceptions

The first interaction concept required users to click an “adopt estimate”
action. That added ceremony without improving correctness. The accepted rule is:

- `auto`: default for assets without a historical positive accounting value;
- `manual`: explicit exception for impairment, early retirement, policy
  adjustment, or preserved historical entries.

The effective value uses straight-line monthly depreciation:

```text
terminal residual = purchase price × residual rate
monthly depreciation = (purchase price − terminal residual) ÷ depreciation months
current residual = max(terminal residual,
                       purchase price − monthly depreciation × elapsed full months)
```

Global settings provide depreciation months and terminal residual rate. The
calculation requires a positive purchase price and a purchase date; creation
date is a documented fallback.

### 4. Missing financial data needs both a filter and a work queue

Users need two ways to find incomplete records:

- a server-side asset-list filter for daily work and export;
- an analysis-page list that explains the missing field and links to details.

The REST filter is `financialDataStatus` with these closed values:

- `missing_purchase_price`;
- `missing_second_hand_market_value`;
- `missing_both`;
- `complete`.

Missing means the stored value is less than or equal to zero. Unknown values are
rejected with HTTP 422 at the controller boundary. The repository applies the
same condition to count and item queries, and the filter participates in the
asset-list cache key.

### 5. Preview must represent the workbook, not compete with configuration

A permanent left/right layout initially appeared efficient, but realistic
registers made the preview too narrow and the configuration unnecessarily long.
The better interaction is two-stage:

1. configure scope, fields, order, format, and colors;
2. optionally open a large preview, return to edit, or confirm export.

The preview is deliberately bounded to 30 rows. It is a visual verification
tool, not a second asset browser. The total count remains visible so users know
the final export scope.

## UI standard for future export work

### Configuration hierarchy

Use this order:

1. file format;
2. export scope;
3. fields and presets;
4. status colors or other format-only settings;
5. preview or export actions.

Keep the primary configuration dialog single-column. Long option groups should
use compact internal grids rather than unequal-height cards.

### Scope controls

- Use clickable option cards with a short title and a secondary explanation.
- Show current-filter counts when known; otherwise say they will be calculated.
- When no rows are selected, replace the selected-scope radio with an
  instructional empty state. Do not show a disabled radio that looks broken.
- Treat WordPress admin styles as an external CSS environment. Verify native
  input styles do not overlap Ant Design radio and checkbox visuals.

### Field controls

- Preserve the exact selected order in preview, CSV, and Excel.
- Provide task-based presets rather than only “select all”. Current presets are
  computer register, finance register, and hardware configuration.
- Provide select/clear actions globally and per group.
- Make selected fields draggable and cap the ordering area's height so a large
  selection does not consume the entire dialog.
- Avoid applying typography helper classes to `Space` or other layout
  components; a `display: block` helper can silently destroy their flex layout.

### Preview controls

- Open preview separately when the selected column count makes an inline
  preview incomplete.
- Use the WordPress content width, not a raw `vw` width. Measure the visible
  admin menu and offset the modal accordingly.
- Keep the header summary readable as one sentence, for example:
  `126 条 · 9 列 · Excel · 整行着色`.
- Freeze the header and first column, allow horizontal scrolling, and show full
  cell text in the `title` attribute.
- Preview a bounded sample and state clearly that export includes all rows in
  scope.

### Excel and CSV behavior

- Excel may include fills, frozen panes, filters, widths, and currency formats.
- CSV must never claim to preserve colors or styles.
- Active assets have no fill by default. Other status colors should be subtle
  enough for printed registers.
- Allow either whole-row fill or status-cell-only fill.
- Store presentation preferences separately from canonical asset facts.

## Backend and contract standard

- Validate every closed query parameter at the REST controller boundary.
- Translate public camelCase REST parameters to repository snake_case once.
- Parameterize SQL and assert placeholder/argument counts in repository
  fixtures when a large prepared query changes.
- Apply every filter identically to total-count and item queries.
- Include every result-affecting argument in cache keys.
- Keep schema migrations idempotent and append revisions instead of replacing
  required historical migrations.
- Preserve downgrade and mixed-version compatibility when a legacy database
  column or REST field is already public.
- Backups, restores, imports, observations, and manual writes must all preserve
  newly added canonical fields.

## Testing standard

At minimum, changes in this area must pass:

```bash
npm run check:fixtures
npm run check:versions
npm run check:release-scope
git diff --check

cd vite-admin
npm run build
npm run lint
npm audit --omit=dev
```

Fixtures should cover:

- schema creation and idempotent upgrade;
- asset create/update normalization;
- backup/restore preservation;
- observation ingestion preservation;
- REST/repository financial-data filtering;
- prepared-query placeholder counts.

Manual browser verification should cover:

- WordPress menu expanded and collapsed;
- selected and unselected export scopes;
- Excel/CSV switching;
- all field presets and drag order;
- row and status-cell colors;
- return-from-preview without losing configuration;
- narrow viewport stacking;
- an exported workbook opened in a real spreadsheet application.

## Review findings and lessons

### What worked

- Clarifying financial semantics before implementation prevented a silent data
  quality problem.
- Additive API and schema changes preserved existing clients and data.
- Server-side filtering made the list, analysis, saved filters, and export use
  one definition of completeness.
- Dynamic ExcelJS import isolated the large dependency from normal page load.
- Repeated screenshot feedback exposed real WordPress-host integration issues
  that build and lint checks cannot detect.

### What needed correction

- The first preview layout optimized for simultaneous visibility but ignored
  realistic column counts.
- A viewport-wide modal ignored the persistent WordPress admin menu.
- A disabled selected-scope radio looked like two circles because WordPress and
  Ant Design styles overlapped.
- Equal-row CSS grids created large empty areas for unequal field groups.
- A generic `display: block` helper applied to an Ant `Space` component broke
  the intended horizontal button layout.
- Refactoring from inline preview to separate preview left unused CSS, which was
  removed during final review.

### Reusable principle

For admin tools, optimize the complete task sequence rather than maximizing the
number of controls visible at once. Configuration, verification, and execution
are different cognitive steps and may deserve separate surfaces.

## Maintenance checklist

Before extending this feature, confirm:

- [ ] the field has one unambiguous business meaning;
- [ ] list, detail, analysis, import, backup, and export use the same meaning;
- [ ] legacy compatibility is intentional and documented;
- [ ] current-filter export fetches all matching pages;
- [ ] field order is preserved end to end;
- [ ] CSV copy does not promise styling;
- [ ] preview stays inside the WordPress content area;
- [ ] empty and disabled states explain the next action;
- [ ] no obsolete styles remain after layout changes;
- [ ] fixtures, build, lint, dependency audit, and release checks pass.
