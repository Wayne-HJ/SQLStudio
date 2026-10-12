import { t } from "../i18n";
import {
  Archive,
  BarChart3,
  FileCode2,
  GitBranch,
  History,
  Layers,
  PanelLeft,
  PanelRight,
  PlugZap,
  Plus,
  Table2,
  Terminal,
} from "lucide-react";
export default function DesktopToolbar({
  active,
  onNavigate,
  onConnection,
  onBackup,
  onInspector,
  connected,
  sqlite,
}: {
  active: string;
  onNavigate: (route: string) => void;
  onConnection: () => void;
  onBackup: () => void;
  onInspector: () => void;
  connected: boolean;
  sqlite: boolean;
}) {
  const item = (
    label: string,
    icon: React.ReactNode,
    color: string,
    action: () => void,
    selected = false,
    disabled = false,
  ) => (
    <button
      className={`desktop-tool ${selected ? "selected" : ""}`}
      onClick={action}
      disabled={disabled}
      title={disabled ? t("{0}（后续版本）", [label]) : label}
    >
      <span className="desktop-tool-icon" style={{ color }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="desktop-toolbar">
      <div className="desktop-tool-group">
        {item(t("连接"), <PlugZap size={31} />, "#8b999f", onConnection)}
        {item(
          t("新建查询"),
          <span className="layered-tables">
            <Table2 size={28} />
            <Plus size={11} />
          </span>,
          "#55b1e9",
          () => onNavigate("query"),
          false,
          !connected,
        )}
        {item(
          t("命令行"),
          <Terminal size={29} />,
          "#58a98a",
          () => onNavigate("console"),
          active === "console",
          !connected,
        )}
        {item(
          t("操作日志"),
          <History size={29} />,
          "#9b82b8",
          () => onNavigate("operations"),
          active === "operations",
        )}
      </div>
      <div className="desktop-tool-group">
        {item(
          t("表"),
          <Table2 size={31} />,
          "#1999dd",
          () => onNavigate("objects"),
          active === "objects",
        )}
        {item(
          t("视图"),
          <Layers size={31} />,
          "#7dbdea",
          () => onNavigate("views"),
          active === "views",
        )}
        {item(
          t("函数"),
          <span className="function-icon">ƒ(x)</span>,
          "#38a7e0",
          () => {},
          false,
          true,
        )}
      </div>
      <div className="desktop-tool-group">
        {item(
          t("查询"),
          <FileCode2 size={31} />,
          "#559de0",
          () => onNavigate("saved"),
          active === "saved",
        )}
        {item(
          t("备份"),
          <Archive size={30} />,
          "#969d9e",
          onBackup,
          false,
          !connected || !sqlite,
        )}
        {item(
          t("自动运行"),
          <History size={30} />,
          "#55afbd",
          () => {},
          false,
          true,
        )}
        {item(
          t("模型"),
          <GitBranch size={31} />,
          "#ee9937",
          () => onNavigate("model"),
          active === "model",
        )}
        {item("BI", <BarChart3 size={31} />, "#b44cdb", () => {}, false, true)}
      </div>
      <div className="desktop-toolbar-spacer" />
      <div className="desktop-view-tools">
        <div>
          <button title={t("连接导航栏")} onClick={() => onNavigate("objects")}>
            <PanelLeft size={20} />
          </button>
          <button title={t("显示 / 隐藏对象详情")} onClick={onInspector}>
            <PanelRight size={20} />
          </button>
        </div>
        <span>{t("查看")}</span>
      </div>
    </div>
  );
}
