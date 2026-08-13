import { Empty } from "antd";

export interface AnalysisDistributionRow {
  label: string;
  value: number;
  meta?: string;
}

export const analysisDistribution = (values: string[], fallback = "未填写"): AnalysisDistributionRow[] => {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const label = value.trim() || fallback;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
};

export const AnalysisDistribution = ({
  rows,
  emptyText = "暂无数据",
  onSelect,
}: {
  rows: AnalysisDistributionRow[];
  emptyText?: string;
  onSelect?: (row: AnalysisDistributionRow) => void;
}) => {
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <div className="npcink-v3-analysis-distribution">
      {rows.map((row) => (
        <div
          key={row.label}
          className={`npcink-v3-analysis-distribution-row${onSelect ? " is-clickable" : ""}`}
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={() => onSelect?.(row)}
          onKeyDown={(event) => {
            if (onSelect && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onSelect(row);
            }
          }}
        >
          <div>
            <span>{row.label}</span>
            <strong>{row.meta || row.value}</strong>
          </div>
          <div className="npcink-v3-analysis-meter" aria-hidden="true">
            <i style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};
