import type { Asset } from "@/type/v3";
import { assetHardwareContext } from "@/utils/hardwareAudit";
import { Checkbox } from "antd";
import { cardBaseboardLabel, cardCpuLabel, cardGraphicsLabel, customAssetInfo } from "@/pages/shared/assets";
import { assetUpdateDateText, isComputerAsset } from "@/pages/shared/finance";
import {
  PlatformMark,
  computerDeviceType,
  fieldText,
  formatDate,
  formatMemoryDiskText,
  highlightText,
  resolvePlatformVisual,
  statusLabel,
} from "@/pages/shared/presentation";

export interface AssetCardProps {
  asset: Asset;
  onOpen: () => void;
  searchKeyword?: string;
  selectable?: boolean;
  selected?: boolean;
  compact?: boolean;
  onSelect?: () => void;
}

export const AssetCard = ({
  asset,
  onOpen,
  searchKeyword = "",
  selectable = false,
  selected = false,
  compact = false,
  onSelect,
}: AssetCardProps) => {
  const { summary, manualHardware, extracted } = assetHardwareContext(asset);
  const title = asset.ownerName || asset.name || "未命名资产";
  const isPc = isComputerAsset(asset);
  const customInfo = !isPc ? customAssetInfo(asset) : null;
  const baseboardLabel = cardBaseboardLabel(extracted.baseboard || extracted.deviceModel);
  const cpuLabel = cardCpuLabel(extracted.cpu);
  const graphicsLabel = cardGraphicsLabel(extracted.graphics, extracted.cpu);
  const platformVisual = resolvePlatformVisual(extracted.platform, extracted.cpu, extracted.deviceModel);
  const handleOpen = () => {
    if (selectable) {
      onSelect?.();
      return;
    }
    onOpen();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`npcink-v3-asset-card${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpen();
        }
      }}
    >
      {selectable ? (
        <div className="npcink-v3-card-check" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onChange={() => onSelect?.()} />
        </div>
      ) : null}
      {customInfo ? (
        <div className="npcink-v3-asset-card-body npcink-v3-custom-card-body">
          <h3>{highlightText(customInfo.title, searchKeyword)}</h3>
          <dl>
            <div>
              <dt>编号：</dt>
              <dd>{highlightText(customInfo.number, searchKeyword, true)}</dd>
            </div>
            <div>
              <dt>分类：</dt>
              <dd>{highlightText(customInfo.category, searchKeyword)}</dd>
            </div>
            <div>
              <dt>使用：</dt>
              <dd>{highlightText(customInfo.usage, searchKeyword)}</dd>
            </div>
            <div>
              <dt>价格：</dt>
              <dd>{customInfo.priceText}</dd>
            </div>
            <div>
              <dt>状态：</dt>
              <dd>{customInfo.status || "-"}</dd>
            </div>
            <div>
              <dt>购置：</dt>
              <dd>{formatDate(customInfo.orderTime || customInfo.createdAt)}</dd>
            </div>
            <div>
              <dt>更新：</dt>
              <dd>{assetUpdateDateText(asset)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <>
          <div className="npcink-v3-asset-card-brand">
            <PlatformMark visual={platformVisual} variant="card" />
            <strong>{platformVisual.label}</strong>
          </div>
          <div className="npcink-v3-asset-card-body">
            <h3>{highlightText(title, searchKeyword)}</h3>
            <p title={fieldText(extracted.baseboard || extracted.deviceModel)}>
              {highlightText(baseboardLabel, searchKeyword)}
            </p>
            <p title={fieldText(extracted.cpu)}>{highlightText(cpuLabel, searchKeyword)}</p>
            <p title={fieldText(extracted.graphics)}>{highlightText(graphicsLabel, searchKeyword)}</p>
            <dl>
              <div>
                <dt>配置：</dt>
                <dd>{formatMemoryDiskText(summary, manualHardware)}</dd>
              </div>
              <div>
                <dt>编号：</dt>
                <dd>{highlightText(asset.assetNumber, searchKeyword, true)}</dd>
              </div>
              <div>
                <dt>状态：</dt>
                <dd>{statusLabel(asset.status)}</dd>
              </div>
              <div>
                <dt>类型：</dt>
                <dd>{computerDeviceType(asset.category)}</dd>
              </div>
              <div>
                <dt>部门：</dt>
                <dd>{highlightText(asset.department, searchKeyword)}</dd>
              </div>
              <div>
                <dt>更新：</dt>
                <dd>{assetUpdateDateText(asset)}</dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </div>
  );
};
