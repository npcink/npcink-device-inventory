import { InfoCircleOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

interface HelpLabelProps {
  label: string;
  description: string;
}

export const HelpLabel = ({ label, description }: HelpLabelProps) => (
  <span className="npcink-v3-form-label-with-help">
    {label}
    <Tooltip title={description} trigger={["hover", "focus", "click"]} classNames={{ root: "npcink-v3-help-tooltip" }}>
      <button
        type="button"
        className="npcink-v3-help-trigger"
        aria-label={`${label}说明`}
        onClick={(event) => event.preventDefault()}
      >
        <InfoCircleOutlined aria-hidden />
      </button>
    </Tooltip>
  </span>
);
