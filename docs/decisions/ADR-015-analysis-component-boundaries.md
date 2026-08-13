# ADR-015: 分析页按业务域拆分组件并保持单一渲染责任

## Status

Accepted

## Date

2026-08-13

## Context

分析页最初集中在 `vite-admin/src/pages/index.tsx`。随着概览、硬件盘点、组合查询、采集状态、资料完整度、硬件变化、资产价值和更新候选陆续恢复，页面同时承担了状态管理、数据聚合、导出、筛选和全部 JSX 渲染。

这带来三个实际问题：页面入口难以审查，业务域边界不清晰；同一视图的 JSX 可能在旧位置和新组件中各保留一份，最终出现用户端重复渲染；数据规则和展示结构混在一起，后续修改更容易产生统计口径漂移。

## Decision

将分析页拆分为稳定的业务域组件，并由 `AnalysisWorkspace` 保留跨视图编排职责：

- `HardwareInventoryView`：CPU、硬盘、内存、主板盘点；
- `HardwareQueryView`：组合筛选与结果展示；
- `CollectionHealthView`：采集状态与覆盖率；
- `DataQualityView`：资料完整度、问题分组和问题清单；
- `HardwareChangesView`：硬件变化；
- `AssetPlanningViews`：价值概览与更新候选；
- `AnalysisDistribution`：共享分布展示；
- `analysisData.ts`：纯聚合、规范化和过滤函数；
- `analysisTypes.ts`：分析视图的类型和常量契约。

每个用户可见区域必须只有一个渲染所有者。父页面只负责查询、派生数据、状态和事件回调，不再保留同一视图的旧 JSX 副本。

## Alternatives Considered

### 继续把所有分析 JSX 留在页面入口

改动最少，但会继续放大重复渲染、边界漂移和回归审查成本。拒绝。

### 每个分析视图都建立独立路由和数据请求

能进一步隔离代码，但会改变当前后台导航、缓存和用户上下文，超出本次问题范围。暂不采用。

### 立即引入通用报表引擎

抽象层和数据模型成本过高，当前分析问题是固定、只读、可解释的。拒绝。

## Consequences

正面影响：业务域边界清晰，页面入口更易审查；资料完整度等区域不会因旧 JSX 遗留而重复渲染；聚合逻辑可独立 fixture 测试，展示组件可按用户流程验收。

代价与约束：props 接口需要维护，跨域状态仍由页面编排；本次拆分不等于服务端聚合，当前规模继续使用浏览器端派生数据；每次新增分析域都必须同步更新导出、空态、错误态和文档验收矩阵。

## Verification

本次变更通过：

- `npm --prefix vite-admin run lint`
- `npm --prefix vite-admin run check:hardware-audit`
- `npm --prefix vite-admin run build`
- `npm run check:docker`
- `git diff --check`

并通过文本复核确认“操作系统分布”“问题分组”“问题清单”只由 `DataQualityView.tsx` 渲染。
