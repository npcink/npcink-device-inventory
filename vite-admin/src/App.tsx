import Index from "@/pages/index";
import { ConfigProvider } from "antd";
import "./App.css";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { message } from "antd";

dayjs.locale("zh-cn");

message.config({
  top: 50,
  duration: 2,
  maxCount: 3,
  prefixCls: "my-message",
});

const App = () => {
  return (
    <>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: "#2563eb",
            colorInfo: "#2563eb",
            colorSuccess: "#15803d",
            colorWarning: "#b45309",
            colorError: "#dc2626",
            colorText: "#1f2328",
            colorTextSecondary: "#667085",
            colorBgLayout: "#f6f7f9",
            colorBorder: "#d9dee7",
            borderRadius: 8,
            controlHeight: 36,
            fontSize: 14,
          },
          components: {
            Button: {
              borderRadius: 8,
              controlHeight: 36,
              fontWeight: 600,
            },
            Table: {
              headerBg: "#f3f6fb",
              headerColor: "#344054",
              rowHoverBg: "#f8fbff",
            },
            Tag: {
              borderRadiusSM: 999,
            },
          },
        }}
      >
        <Index />
      </ConfigProvider>
    </>
  );
};

export default App;
