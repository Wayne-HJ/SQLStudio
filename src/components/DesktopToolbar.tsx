import { t } from "../i18n";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Archive,
  BarChart3,
  BookOpen,
  ChevronDown,
  Database,
  FileCode2,
  GitCompareArrows,
  GitBranch,
  History,
  Layers,
  PanelLeft,
  PanelRight,
  PlugZap,
  Plus,
  RefreshCw,
  Settings2,
  Table2,
  UserRound,
  Wrench,
} from "lucide-react";
export default function DesktopToolbar({
  active,
  onNavigate,
  onConnection,
  onBackup,
  onImport,
  onExport,
  onInspector,
  onImportSql,
  onExportSql,
  connected,
  sqlite,
}: {
  active: string;
  onNavigate: (route: string) => void;
  onConnection: () => void;
  onBackup: () => void;
  onImport: () => void;
  onExport: () => void;
  onInspector: () => void;
  onImportSql: () => void;
  onExportSql: () => void;
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
        {item(
          t("其它"),
          <Wrench size={30} />,
          "#478fab",
          () => onNavigate("structure"),
          active === "structure",
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
      <div className="desktop-tool-group sync-tool-group">
        {item(
          t("结构比对"),
          <GitCompareArrows size={29} />,
          "#6681c8",
          () => onNavigate("structure"),
          active === "structure",
        )}
        {item(
          t("数据同步"),
          <ArrowRightLeft size={29} />,
          "#58a98a",
          () => onNavigate("sync"),
          active === "sync",
        )}
      </div>
      <div className="desktop-toolbar-spacer" />
      <div className="desktop-tool-group sql-file-tool-group">
        {item(
          t("导入 SQL"),
          <ArrowUpFromLine size={27} />,
          "#75a99b",
          onImportSql,
          false,
          !connected,
        )}
        {item(
          t("导出 SQL"),
          <ArrowDownToLine size={27} />,
          "#7198bb",
          onExportSql,
          false,
          !connected,
        )}
      </div>
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
