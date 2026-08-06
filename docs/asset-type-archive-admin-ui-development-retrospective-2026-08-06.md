# Device type, archive boundary, and admin UI: development retrospective and standard

## Status

Accepted development and maintenance guidance as of 2026-08-06.

## Outcome

This iteration completed one connected asset-administration improvement:

- computer assets can record a practical device type such as laptop, desktop,
  Apple computer, or all-in-one;
- the type is included by default in configurable asset-table exports;
- archived assets are treated as retained historical records outside all daily
  business calculations and exports;
- uploads to archived devices fail explicitly instead of silently extending or
  restoring them;
- archive actions use consistent, irreversible-business-action wording;
- the computer settings form uses balanced three-column rows, compact help, and
  a localized date picker;
- the detail header shows only core financial facts and moves calculation mode
  into a small label;
- the exact release ZIP passes the repository release gate and official Plugin
  Check 2.0.0 in an isolated WordPress/PHP environment.

The archive decision is recorded in
[`ADR-012`](decisions/ADR-012-treat-archived-assets-as-business-excluded-records.md).
The export decision remains governed by
[`ADR-011`](decisions/ADR-011-configurable-asset-export.md).

## Requirement history and reasoning

### 1. Reuse a field when the meaning already fits

The v3 asset model already has two levels:

- `asset_type`: closed top-level family, `computer` or `custom`;
- `category`: the practical subtype inside that family.

Laptop, desktop, Apple computer, and all-in-one are computer subtypes, not new
top-level asset families. Reusing `category` avoided a schema migration, REST
contract expansion, backup migration, import compatibility work, and duplicate
filter semantics. The UI can call the field “设备类型” for computer assets and
“分类” for custom assets while preserving one canonical stored field.

Development rule: before adding a database column, inspect the current runtime
contract and determine whether the requested concept is a new fact or only a
better presentation of an existing fact.

### 2. A status is not harmless if calculations can still see it

Filtering archived rows only in the visible asset list is insufficient. Global
observation queries and collection trends can continue counting historical
uploads unless they join the asset table and apply the same business predicate.

The accepted rule is:

```text
business asset = status != deleted
archived record = status == deleted
```

Apply it consistently to:

- normal asset lists and searches;
- finance and residual summaries;
- completeness and hardware analysis;
- collection health and daily collection trends;
- renewal candidates and analysis exports;
- Excel and CSV asset registers.

Complete JSON backup is the deliberate exception because it preserves state; it
is not a business report.

### 3. Enforce critical boundaries twice when the failure is expensive

The asset repository excludes archived rows by default, but export also filters
the final in-memory row set. This covers selected rows and future callers that
could explicitly request archived results.

This is intentional defense in depth, not accidental duplication:

- server query: canonical scope and correct totals;
- export boundary: final guarantee about file contents.

Use this pattern only for important product invariants such as authorization,
archive exclusion, or secret removal. Do not duplicate ordinary transformations
without a stated reason.

### 4. Background collection must not reverse business decisions

Hardware identities remain attached to archived assets so historical ownership
is auditable and duplicate devices are not created. Therefore a later upload can
still resolve to an archived record. The ingest service must reject it before
starting a transaction with `409 asset_archived`.

Automatic restoration was rejected because a device client cannot know why an
administrator archived the asset. If restore is ever added, it must be explicit,
authorized, audited, and separately designed.

### 5. Archive is a product action, not a synonym for delete

The previous interface mixed “移除设备”, “删除/归档”, and “已归档”. Mixed words
create uncertainty about recoverability and physical deletion. The accepted copy
uses “归档设备” for the action and “已归档” for the state.

The confirmation must explain all consequences before the write:

- leaves daily asset management;
- does not enter lists, statistics, analysis, or asset-table exports;
- historical data and asset number remain;
- self-service restoration is not currently available.

Do not add a permanent-delete control merely to make the archive metaphor feel
complete. Destructive capabilities require a demonstrated operational need.

### 6. Compact forms by removing explanation weight, not information

The computer settings form originally left two fields on the first row, four on
the next grid, and a long department help paragraph that increased the row
height. The improved layout uses two three-column rows:

1. owner, asset number, IP address;
2. department, status, device type.

The department rule remains available through a keyboard-focusable information
tooltip. This keeps necessary guidance without allowing helper text to distort
the complete form.

UI rule: helper text that prevents a likely error may remain visible; stable
reference information may move to an accessible tooltip. Never hide validation
errors or required consequences behind an icon.

### 7. Use native task controls and preserve the stored contract

Purchase date is a date, so a date picker is more appropriate than an
unstructured text box. The UI now provides calendar selection, keyboard input,
and clearing while continuing to store `YYYY-MM-DD`.

Ant Design localization requires both the ConfigProvider locale and the Day.js
runtime locale. Importing `dayjs/locale/zh-cn` registers the language but does
not activate it; call `dayjs.locale("zh-cn")` once before rendering.

Control upgrades must preserve:

- existing stored values;
- API payload shape;
- calculations that watch the form field;
- invalid historical value handling;
- keyboard and mobile use.

### 8. A summary should show decisions, not every derivable number

The computer detail header initially displayed purchase date, purchase price,
second-hand price, financial residual value, calculation mode, known
depreciation, and residual rate. The last three consumed equal visual weight even
though two are simple derivations and one is metadata about the highlighted
value.

The accepted summary keeps four core facts:

- purchase date;
- purchase price;
- second-hand market value;
- financial residual value.

Automatic/manual mode appears as a small label beside financial residual value.
Known depreciation and residual rate remain available to analysis logic but do
not occupy the top detail summary.

UI rule: give equal-size summary cells only to facts of equal decision value.
Derived values belong in analysis or drill-down surfaces unless users repeatedly
need them for the immediate task.

## Implementation standard

### Data and API

- Keep `asset_type` closed to `computer` and `custom`.
- Use `category` for device subtype; change labels by asset context rather than
  forking the storage model.
- Keep archive compatibility value `deleted`; do not introduce parallel archive
  flags.
- Reject uploads to archived identities before transactional writes.
- Invalidate caches whose results depend on asset status after archive commits.
- Keep archived records and number uniqueness intact in backup/restore.

### Queries and exports

- Apply `status <> 'deleted'` to both item and count queries.
- Join observations to assets before using them in global operational reports.
- Add every result-affecting argument or state revision to cache keys.
- Exclude archived rows again immediately before Excel/CSV generation.
- Empty export scopes should explain that there are no unarchived assets rather
  than downloading an empty file.

### Admin UI

- Use stable vocabulary: 归档设备 / 已归档.
- Use explicit confirmation copy for irreversible business actions.
- Prefer balanced grids at desktop widths and retain the existing single-column
  responsive fallback.
- Tooltips used as form help must be focusable and have an accessible label.
- Initialize third-party locale state explicitly; do not assume importing a
  locale file activates it.
- Keep summary surfaces focused on primary facts and compress metadata into
  tags or help text.

### Tests

At minimum, changes to archive or device observation behavior must verify:

- normal asset queries exclude archived rows;
- collection lists and trends exclude archived assets;
- an archived identity upload returns `asset_archived` before a transaction;
- archive writes invalidate observation-derived caches;
- selected and filtered exports cannot include archived rows;
- final build output matches the packaged ZIP.

## Verification and release closure

The final 3.1.3 candidate completed:

```text
npm run build:release
npm run check:release
npm run check:docker
```

The Docker gate installed and activated the exact release ZIP on WordPress 7.0.2
with PHP 8.3, installed official Plugin Check 2.0.0, reported
`Checks complete. No errors found.`, and passed the real backup/restore rehearsal.

## Reusable lessons

1. Clarify semantic ownership before changing schemas.
2. Define business sets once and make all calculations consume that definition.
3. Treat export files as product outputs with their own final safety boundary.
4. Never let an automated client undo an administrator's state decision.
5. Reduce UI density by ranking information, not by deleting explanations.
6. Localization has runtime state; imports alone may be insufficient.
7. Validate the exact ZIP in a clean WordPress environment, not only source code.
8. Record both the decision and the failed alternatives so future work does not
   reopen the same debate without new evidence.

## Work review report

### Original goal

Add a computer device subtype, export it, exclude archived assets from business
outputs, improve the related admin UI, produce a verified plugin package, and
leave enough reasoning for future maintainers to preserve the same boundaries.

### Completion

- [x] Computer subtype is editable and exported through the existing category
  contract.
- [x] Archived assets are excluded from operational queries, analysis, trends,
  and asset-table exports.
- [x] Archived identities reject new observations before transaction start.
- [x] Archive wording and confirmation consequences are consistent.
- [x] Form layout, help density, date input, localization, and finance summary
  were improved without changing stored contracts.
- [x] Regression, static, package, Docker, Plugin Check, and backup/restore gates
  passed against the final candidate.
- [x] ADR, retrospective, playbook, documentation map, and release record were
  updated.

### Problems found and corrected

| Severity | Specific problem | Root cause | Correction |
| --- | --- | --- | --- |
| Required | The first archive implementation changed observation queries and cache invalidation but did not directly assert those two behaviors in fixtures. | Verification initially followed the visible user flow more closely than the hidden cache/query boundary. | Added repository-query assertions for archive predicates and successful single/batch archive cache-invalidation assertions. |
| Required | Importing the Day.js Chinese locale did not make the date picker Chinese. | Registration of a locale was incorrectly treated as runtime activation. | Added explicit `dayjs.locale("zh-cn")` before rendering and retained Ant Design `zhCN` configuration. |
| Should improve | The first conceptual response considered adding a dedicated device-type field before fully recognizing that `category` already represented the subtype layer. | The UI request was initially interpreted before the existing data model was used as the primary constraint. | Reused `category`, documented contextual labels, and made “inspect the current contract before adding schema” an explicit rule. |
| Should improve | The initial finance summary accumulated every available derived value and produced an uneven second row. | Information availability was treated as equal to decision importance. | Kept four primary facts and compressed calculation mode into a small label; moved derived values out of the header. |

### What worked well

- User screenshots exposed layout and wording problems that static code review
  would not have revealed.
- Existing repository defaults and release scripts provided strong foundations;
  the change extended them instead of creating parallel mechanisms.
- Defense in depth at query and export boundaries made the no-archived-export
  requirement explicit and testable.
- Running official Plugin Check against the exact ZIP caught packaging/runtime
  risks that source-only checks cannot cover.

### Next-time focus

- Start every field request by mapping it to the current data model and public
  contract before discussing a migration.
- When a status changes business membership, enumerate all aggregate sources and
  cache dependencies before editing UI code.
- Add regression assertions at the same time as server-boundary changes, not
  only during final review.
- For third-party localization, verify registration, activation, provider
  propagation, and portal rendering as separate concerns.
- Use screenshots or browser smoke tests for density, alignment, tooltips,
  calendars, and confirmation copy before packaging.
