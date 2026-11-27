import { getComparisonObservations } from "./v3";
import type { ComparisonObservation } from "@/type/v3";

export const fetchComparisonObservations = async (signal?: AbortSignal): Promise<ComparisonObservation[]> => {
  const observations: ComparisonObservation[] = [];
  let afterAssetId = 0;
  let throughAssetId = 0;
  for (;;) {
    const page = await getComparisonObservations(afterAssetId, throughAssetId, signal);
    observations.push(...page.data);
    throughAssetId = page.pagination.throughAssetId;
    const next = page.pagination.nextAfterAssetId;
    if (next === null) return observations;
    if (!Number.isSafeInteger(next) || next <= afterAssetId || next > throughAssetId) {
      throw new Error("历史采集分页游标无效，请刷新后重试");
    }
    afterAssetId = next;
  }
};
