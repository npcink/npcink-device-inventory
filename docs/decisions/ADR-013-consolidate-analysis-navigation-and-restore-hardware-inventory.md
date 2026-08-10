# ADR-013: Consolidate Analysis Navigation And Restore Hardware Inventory

## Status

Accepted

## Date

2026-08-10

## Context

The legacy admin application included an `资产盘点` surface with switchable CPU, disk, memory, and baseboard tables. That implementation answered a real operational question—what hardware configurations are common—but it depended on the retired pre-v3 data model and used several ambiguous counting rules:

- CPU was primarily grouped by manufacturer instead of useful model;
- memory counted modules rather than whole-device capacity;
- disk capacity buckets hid physical model and media information;
- baseboard aliases depended on broad replacement tables;
- component counts and affected-device counts were not distinguished.

ADR-009 later restored read-only analysis around current v3 assets and latest observations. As more analysis views were added, eight peer tabs accumulated: summary, hardware inventory, compound query, collection health, completeness, hardware changes, renewal candidates, and asset value. The capabilities were useful, but the navigation treated different conceptual levels as peers and became difficult to scan.

## Decision

Restore hardware inventory as a read-only view inside the existing analysis workspace, using current v3 asset facts rather than reviving the legacy application or data model.

The primary analysis navigation is consolidated into four domains:

1. `概览`: management summary and broad distributions;
2. `硬件分析`: model inventory and compound filtering;
3. `数据健康`: collection status, information completeness, and hardware changes;
4. `资产规划`: value overview and renewal candidates.

Domain-local views use compact segmented controls instead of adding more peer tabs. CPU, disk, memory, and baseboard categories are a third-level button group inside hardware inventory, not another global navigation layer.

Hardware inventory uses these semantics:

- scope: unarchived computer assets only;
- source: the current effective hardware context, preferring the latest observation while preserving existing imported-data compatibility;
- CPU: normalized model grouping, counted by affected devices;
- memory: whole-device total capacity grouping, counted by affected devices;
- baseboard: conservative manufacturer/model grouping, counted by affected devices;
- disk: physical model grouping with media, capacity, and interface context; show both disk count and affected-device count;
- missing facts: excluded from model rows and reflected by the difference between scope and collected-device counts;
- interaction: model rows support read-only asset drill-down, search, sorting, pagination, and current-view CSV export.

Hardware changes continue to load observation history only when that local view is active. No new table, REST endpoint, write workflow, or reporting engine is introduced.

## Alternatives Considered

### Restore the legacy `admin-vite` components directly

Rejected because they depend on retired structures and reproduce unclear historical counting semantics.

### Keep all analysis views as peer tabs

Rejected because the growing tab row mixes domains, tasks, and detail views at one level. Adding future views would worsen discoverability.

### Create a separate top-level hardware inventory menu

Rejected because inventory, filtering, completeness, value, and renewal all consume the same current asset facts and shared read-only detail. A second workspace would duplicate navigation and context.

### Add server-side aggregation endpoints immediately

Rejected for the current scale. The analysis asset set is already loaded, and browser-side aggregation remains simple and measurable. Re-evaluate near the existing approximately 1,000-device threshold or when profiling shows interaction degradation.

## Consequences

- Analysis remains broad in capability but has only four stable primary destinations.
- Existing filters, drill-down details, and export behavior remain available within their domain.
- Hardware counts now communicate device counts separately from physical disk counts.
- Historical code remains useful as product evidence, not as an implementation dependency.
- The analysis workspace component remains large; future substantial analysis additions should first extract domain components rather than append more conditional sections to `pages/index.tsx`.
- A manual WordPress admin smoke test remains required before release because build and fixture checks cannot validate final Ant Design layout in the WordPress shell.
