import { t, getLanguage } from "../i18n";
import { useEffect, useState } from "react";
import {
  Database,
  FolderOpen,
  Grid2X2,
  Layers,
  List,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { api } from "../api";
import type { Connection, DbObject, TableInfo } from "../../shared/types";
export default function ObjectBrowser({
  connection,
  objects,
  views,
  onOpen,
  onDesign,
  onNew,
  onRefresh,
  inspector,
}: {
  connection: Connection;
  objects: DbObject[];
  views: boolean;
  onOpen: (object: DbObject) => void;
  onDesign: (object: DbObject) => void;
  onNew: () => void;
  onRefresh: () => void;
  inspector: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DbObject | null>(null);
  const [grid, setGrid] = useState(false);
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const list = objects.filter(
    (o) =>
      (views ? o.type === "view" : o.type !== "view") &&
      `${o.schema ?? ""}${o.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    setSelected(null);
    setCount(null);
    setInfo(null);
  }, [connection.id, views]);
  useEffect(() => {
    let mounted = true;
    setInfo(null);
    setCount(null);
    if (selected && inspector)
      Promise.all([
        api.schema(connection.id, selected),
        api.table(connection.id, selected, 1, 1, undefined, "asc", ""),
      ])
        .then(([schema, page]) => {
          if (mounted) {
            setInfo(schema);
            setCount(page.total);
          }
        })
        .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [selected, connection.id, inspector]);
  return (
    <div className="object-browser">
      <div className="object-list-toolbar">
        <div>
          <button
            className="object-action"
            title={t("打开对象")}
            disabled={!selected}
            onClick={() => selected && onOpen(selected)}
          >
            <FolderOpen size={20} />
          </button>
          <button
            className="object-action"
            title={t("查看表结构")}
            disabled={!selected}
            onClick={() => selected && onDesign(selected)}
          >
            <Pencil size={20} />
          </button>
          <button
            className="object-action add-object"
            title={t("新建表")}
            onClick={onNew}
            disabled={
              !["sqlite", "mysql", "postgres"].includes(connection.engine)
            }
          >
            <Plus size={20} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="object-action"
            title={t("刷新")}
            onClick={onRefresh}
          >
            <RefreshCw size={20} />
          </button>
        </div>
        <div>
          <button
            className={`object-action ${!grid ? "active" : ""}`}
            title={t("列表视图")}
            onClick={() => setGrid(false)}
          >
            <List size={20} />
          </button>
          <button
            className={`object-action ${grid ? "active" : ""}`}
            title={t("图标视图")}
            onClick={() => setGrid(true)}
          >
            <Grid2X2 size={20} />
          </button>
          <span className="toolbar-divider" />
          <div className="object-list-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("搜索")}
              aria-label={t("搜索对象列表")}
            />
          </div>
        </div>
      </div>
      <div className="object-list-body">
        <div className="object-list-scroll">
          {grid ? (
            <div className="object-icon-grid">
              {list.map((o) => (
                <button
                  key={(o.schema ?? "") + o.name}
                  className={selected?.name === o.name ? "selected" : ""}
                  onClick={() => setSelected(o)}
                  onDoubleClick={() => onOpen(o)}
                >
                  <Table2 size={35} />
                  <span>{o.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <table className="object-list-table">
              <thead>
                <tr>
                  <th>{t("名称")}</th>
                  <th>{t("行")}</th>
                  <th>{t("数据长度")}</th>
                  <th>{t("引擎")}</th>
                  <th>{t("创建日期")}</th>
                  <th>{t("修改日期")}</th>
                  <th>{t("排序规则")}</th>
                  <th>{t("注释")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr
                    key={(o.schema ?? "") + o.name}
                    className={
                      selected?.name === o.name && selected?.schema === o.schema
                        ? "selected"
                        : ""
                    }
                    onClick={() => setSelected(o)}
                    onDoubleClick={() => onOpen(o)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpen(o);
                    }}
                  >
                    <td>
                      {o.type === "view" ? (
                        <Layers size={16} />
                      ) : o.type === "key" ? (
                        <Database size={16} />
                      ) : (
                        <Table2 size={16} />
                      )}
                      <span>{o.name}</span>
                      {o.schema && o.schema !== "public" && (
                        <small>{o.schema}</small>
                      )}
                    </td>
                    <td
                      title={o.estimated ? t("数据库统计估计值") : t("记录数")}
                    >
                      {o.rowCount?.toLocaleString(getLanguage()) ?? "—"}
                    </td>
                    <td>
                      {o.dataLength != null
                        ? `${(o.dataLength / 1024).toFixed(1)} KB`
                        : "—"}
                    </td>
                    <td>{o.engine ?? connection.engine.toUpperCase()}</td>
                    <td>{o.createdAt?.slice(0, 19) || "—"}</td>
                    <td>{o.modifiedAt?.slice(0, 19) || "—"}</td>
                    <td>{o.collation ?? "—"}</td>
                    <td>{o.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!list.length && (
            <div className="object-list-empty">
              {views ? t("没有视图") : t("没有对象")}
              {search ? t("符合搜索条件") : ""}
            </div>
          )}
        </div>
        {inspector && (
          <aside className="object-properties">
            <h3>{t("对象信息")}</h3>
            {selected ? (
              <>
                <div className="object-properties-title">
                  <Table2 size={31} />
                  <strong>{selected.name}</strong>
                </div>
                <dl>
                  <dt>{t("数据库")}</dt>
                  <dd>{connection.database}</dd>
                  <dt>{t("行数")}</dt>
                  <dd>{count ?? selected.rowCount ?? "—"}</dd>
                  <dt>{t("字段数")}</dt>
                  <dd>{info?.columns.length ?? "—"}</dd>
                  <dt>{t("主键")}</dt>
                  <dd>
                    {info?.columns
                      .filter((c) => c.primaryKey)
                      .map((c) => c.name)
                      .join(", ") || "—"}
                  </dd>
                  <dt>{t("索引")}</dt>
                  <dd>{info?.indexes.length ?? "—"}</dd>
                  <dt>{t("外键")}</dt>
                  <dd>{info?.foreignKeys.length ?? "—"}</dd>
                </dl>
                <button className="button" onClick={() => onOpen(selected)}>
                  {t("打开对象")}
                </button>
              </>
            ) : (
              <p>{t("选择一个对象查看信息。")}</p>
            )}
          </aside>
        )}
      </div>
      <div className="object-list-status">
        {t("{0} 个{1}", [
          list.length,
          views
            ? t("视图")
            : connection.engine === "mongodb"
              ? t("集合")
              : connection.engine === "redis"
                ? t("键")
                : t("表"),
        ])}{" "}
        <span>{selected ? selected.name : t("双击对象打开")}</span>
      </div>
    </div>
  );
}
