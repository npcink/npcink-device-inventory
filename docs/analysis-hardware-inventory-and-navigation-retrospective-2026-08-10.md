# Hardware Inventory And Analysis Navigation Retrospective

## Purpose

This document records the restoration of hardware model inventory, the consolidation of the analysis navigation, and the reusable development rules learned from the work. The binding product decision is [`ADR-013`](decisions/ADR-013-consolidate-analysis-navigation-and-restore-hardware-inventory.md); the general read-only analysis boundary remains [`ADR-009`](decisions/ADR-009-restore-read-only-analysis.md).

## Historical Lineage

The feature was not invented from scratch. Git history preserved an earlier `资产盘点` implementation under `admin-vite/src/components/tab/`:

- `c69fd7b`: initial implementation;
- `290942e`: component relocation into the later tab structure;
- `b7104ac`: memory calculation refinement;
- `3194720`: baseboard grouping refinement;
- `ac9ed9a`: final legacy file-structure cleanup.

The legacy screen used four switchable categories—CPU, disk, memory, and baseboard—with a summary count above a two-column table. Its product shape was useful, but its implementation assumptions were tied to the old application:

- CPU statistics emphasized brand counts;
- memory statistics emphasized module counts;
- disk statistics emphasized coarse capacity buckets;
- baseboard grouping relied on replacement maps;
- the page did not clearly separate component quantities from device coverage.

The v3 rebuild later removed the legacy screens. `ec14e4d` restored read-only asset analytics on top of the v3 asset and observation model, creating a safe current foundation for restoring the inventory idea without restoring obsolete code.

## Inputs And Synthesis

The solution came from four evidence sources:

1. **User feedback**: administrators still need fast answers about common CPU, disk, memory, and motherboard configurations.
2. **Git history**: the old four-category interaction was understandable and worth preserving in spirit.
3. **Current contracts**: ADR-009 and `admin-read-only-analysis-development-standard.md` require read-only behavior, explicit semantics, shared detail, and bounded data loading.
4. **Practice results**: TypeScript, ESLint, production build, and hardware-audit fixtures passed with the new structure.

The main contradiction was:

> growing analysis capability versus an admin interface that must remain understandable and operationally light.

This was a non-adversarial design contradiction. Removing useful analysis would sacrifice real management value; keeping every view at the same navigation level would sacrifice discoverability. The resolution was to preserve capabilities while grouping them into stable domains.

## Implemented Information Architecture

The analysis workspace now has four primary domains:

```text
概览
硬件分析
├── 型号盘点
│   ├── CPU
│   ├── 硬盘
│   ├── 内存
│   └── 主板
└── 组合筛选
数据健康
├── 采集状态
├── 资料完整度
└── 硬件变化
资产规划
├── 价值概览
└── 更新候选
```

Navigation levels have different responsibilities:

- primary tabs select a management domain;
- segmented buttons select a task inside the domain;
- category buttons only change the statistical dimension of the current task;
- tables, filters, and drill-down modals present results and details.

Do not use a full tab bar for all three levels. Visual weight must decrease as navigation becomes more local.

## Hardware Inventory Semantics

### Shared scope

- Include unarchived computer assets only.
- Use each asset once; never count historical observations as additional devices.
- Prefer the latest observation through the shared hardware context.
- Preserve the established imported/manual hardware fallback for migrated assets.
- Do not infer missing hardware from unrelated fields merely to improve coverage.

### CPU

- Group by conservative normalized display model.
- Remove harmless trademark and whitespace differences from the grouping key.
- Preserve the original representative model for display.
- Count affected devices, not processor threads, cores, or sockets.

### Memory

- The primary inventory dimension is total memory per device.
- `2 × 8 GB` and `1 × 16 GB` belong to the same 16 GB device-capacity group.
- Module count, frequency, type, and part number belong in device detail or a future explicitly named module view.
- Missing memory capacity is not zero and is not a low-memory classification by itself.

### Disk

- Use physical disks, not mounted volumes or partitions.
- Group by physical model and show media type, capacity, and interface as context.
- Show physical disk count and affected-device count separately.
- A device with two identical disks contributes two components but only one affected device.

### Baseboard

- Combine manufacturer and model conservatively.
- Avoid duplicating the manufacturer when the collected model already contains it.
- Do not use broad marketing-name removal or replacement dictionaries without real-data evidence.
- Board model is a display and filtering fact, never a unique device identity.

### Percentages and missing data

- Device percentage uses all in-scope computers as the denominator.
- The difference between total scope and collected-device count communicates missing coverage.
- Do not create a fake `0 GB`, `unknown model`, or guessed-model bucket unless the view explicitly presents missing-data analysis.

## UI And Interaction Standard

Future changes to this area should follow these rules:

1. Keep no more than roughly four or five primary analysis domains.
2. Group views by the administrator's task, not by implementation type or data source.
3. Use tables or horizontal rankings for hardware Top N data; avoid pie charts for long model lists.
4. Every count must state whether it represents assets, devices, observations, or physical components.
5. Search should filter the currently selected category and reset when switching categories if retaining it would be misleading.
6. Clicking a model or count should open the shared read-only asset drill-down without losing the surrounding view state.
7. CSV export must follow the visible local view and active search/filter state.
8. Loading, empty, error, and no-match states must remain distinct.
9. Long hardware models may wrap inside the table; the WordPress page itself must not gain horizontal overflow.
10. Historical observations should load only for views that require them.

## Architecture And Performance Rules

- Reuse `assetHardwareContext`, `hardwareMemoryBytes`, `hardwareDiskBytes`, and shared detail components instead of creating a second hardware parser.
- Keep aggregation pure and deterministic so it can be extracted and fixture-tested when complexity grows.
- Browser-side aggregation is acceptable while the full current asset list is already loaded and interaction remains measurable.
- Re-evaluate server aggregation around 1,000 devices or after profiling demonstrates a real regression.
- Do not add a general report engine, new custom table, or arbitrary JSON-path query for a fixed inventory question.
- If another substantial analysis domain is added, first split the analysis workspace into domain components. The current single-file organization should not grow indefinitely.

## Verification Standard

Minimum automated verification for changes in this area:

```bash
git diff --check
npm --prefix vite-admin run lint
npm --prefix vite-admin run check:hardware-audit
npm --prefix vite-admin run build
```

Before release, also perform a WordPress admin smoke test covering:

- four primary analysis tabs;
- every local segmented view;
- CPU, disk, memory, and baseboard switching;
- long model wrapping and table horizontal scrolling;
- search, sorting, pagination, CSV export, and asset drill-down;
- 390 px viewport overflow;
- hardware-change lazy loading;
- empty and partially collected datasets.

## Work Review

### Completed

- Restored the useful legacy hardware-inventory capability on the v3 model.
- Replaced ambiguous old counts with explicit device/component semantics.
- Consolidated eight peer views into four primary domains.
- Preserved read-only boundaries, local state, drill-down, export, and lazy history loading.
- Added an ADR and this reusable implementation standard.

### Corrections made during development

| Severity | Observation | Cause | Correction |
| --- | --- | --- | --- |
| Required | Baseboard manufacturer could be repeated when the model already included it. | Composition was applied before checking collected text. | Detect an existing manufacturer prefix before composing the display label. |
| Required | Eight restored and existing views would have remained at one navigation level. | Features had accumulated by implementation sequence. | Reclassify them into four management domains and local task views. |
| Future improvement | The analysis workspace remains concentrated in one large page component. | The existing analysis architecture is monolithic and this change followed its local pattern. | Extract domain components before the next substantial analysis expansion. |
| Release gate | Automated checks cannot prove final WordPress-shell layout quality. | Build and fixtures do not render the real admin environment. | Keep a manual responsive admin smoke test in the release gate. |

## Reusable Lessons

1. Git history is product evidence, not automatically reusable architecture.
2. Restore the user question and interaction shape; re-derive data semantics from the current model.
3. Similar-looking numbers may represent different entities. Name the counted entity explicitly.
4. Navigation debt appears when every new capability becomes a peer tab. Consolidate by task domain before adding more tabs.
5. Read-only analysis should explain uncertainty instead of hiding missing data with guesses.
6. Verification should follow the actual risk: pure aggregation needs fixtures and build checks; layout still needs a rendered admin smoke test.
