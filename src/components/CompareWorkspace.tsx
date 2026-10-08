import { t } from "../i18n";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Code2,
  Database,
  FileDown,
  GitCompareArrows,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import { api } from "../api";
import { EngineIcon } from "./ConnectionDialog";
import type {
  Connection,
  DbObject,
  DatabaseScope,
  DatabaseSchemaComparison,
  DatabaseSyncPlan,
  TablePair,
} from "../../shared/types";
const objectKey = (o: DbObject) => JSON.stringify([o.schema ?? "", o.name]);
const objectLabel = (o: DbObject) =>
  `${o.schema ? o.schema + "." : ""}${o.name}`;
function useDatabaseCatalog(
  connection: Connection | undefined,
  preferred = "",
) {
  const [catalog, setCatalog] = useState({
    id: "",
    names: [] as string[],
    database: "",
    loading: false,
    error: "",
  });
  useEffect(() => {
    let current = true;
    if (!connection) return;
    setCatalog({
      id: connection.id,
      names: [],
      database: "",
      loading: true,
      error: "",
    });
    api
      .connect(connection)
      .then(() => api.databases(connection.id))
      .then((result) => {
        if (current)
          setCatalog({
            id: connection.id,
            names: result.names,
            database: result.names.includes(preferred)
              ? preferred
              : result.selected,
            loading: false,
            error: "",
          });
      })
      .catch((error) => {
        if (current)
          setCatalog({
            id: connection.id,
            names: [],
            database: "",
            loading: false,
            error: error.message,
          });
      });
    return () => {
      current = false;
    };
  }, [connection?.id, preferred]);
  return {
    ...catalog,
    error: catalog.id === connection?.id ? catalog.error : "",
    database: catalog.id === connection?.id ? catalog.database : "",
    names: catalog.id === connection?.id ? catalog.names : [],
    loading: !!connection && (catalog.id !== connection.id || catalog.loading),
    select: (database: string) =>
      setCatalog((previous) => ({ ...previous, database })),
  };
}
function schemaDetail(detail: string): string {
  const labels = detail.endsWith("不同") ? detail.slice(0, -2).split("、") : [];
  if (
    labels.length &&
    labels.every((label) =>
      ["数据类型", "允许 NULL", "主键", "默认值"].includes(label),
    )
  )
    return t("{0}不同", [labels.map((label) => t(label)).join(" / ")]);
  return t(detail);
}
function schemaNote(note: string): string {
  const match = /^(.+)：(.+)，未生成自动修改或删除语句。$/.exec(note);
  return match
    ? t("{0}：{1}，未生成自动修改或删除语句。", [
        match[1],
        schemaDetail(match[2]),
      ])
    : t(note);
}
const value = (v: unknown) =>
  v === null
    ? "NULL"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v ?? "—");
export default function CompareWorkspace({
  mode,
  connections,
  activeId,
  activeDatabase,
  initialObject,
  onQuery,
  onRefresh,
}: {
  mode: "structure" | "data";
  connections: Connection[];
  activeId: string;
  activeDatabase: string;
  initialObject?: DbObject;
  onQuery: (target: DatabaseScope, text: string) => void;
  onRefresh: () => void;
}) {
  const relational = connections.filter((c) =>
    ["sqlite", "mysql", "postgres"].includes(c.engine),
  );
  const [sourceId, setSourceId] = useState(
    relational.find((c) => c.id === activeId)?.id ?? relational[0]?.id ?? "",
  );
  const [targetId, setTargetId] = useState(
    relational.find((c) => c.id !== activeId)?.id ?? "",
  );
  const source = relational.find((c) => c.id === sourceId),
    target = relational.find((c) => c.id === targetId);
  const sourceCatalog = useDatabaseCatalog(
    source,
    sourceId === activeId ? activeDatabase : "",
  );
  const targetCatalog = useDatabaseCatalog(target);
  const sourceDatabase = sourceCatalog.database,
    targetDatabase = targetCatalog.database;
  const [sourceObjects, setSourceObjects] = useState<DbObject[]>([]);
  const [targetObjects, setTargetObjects] = useState<DbObject[]>([]);
  const [loadedScope, setLoadedScope] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [schemas, setSchemas] = useState<DatabaseSchemaComparison | null>(null);
  const [batch, setBatch] = useState<DatabaseSyncPlan | null>(null);
  const [resultTable, setResultTable] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteExtra, setDeleteExtra] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState("");
  const [detail, setDetail] = useState(0);
  const scopeKey = JSON.stringify([
    sourceId,
    sourceDatabase,
    targetId,
    targetDatabase,
    mode,
  ]);
  const tablesReady =
    !!sourceDatabase && !!targetDatabase && loadedScope === scopeKey;
  const loading =
    sourceCatalog.loading ||
    targetCatalog.loading ||
    (!!sourceDatabase && !!targetDatabase && !tablesReady);
  const sourceScope: DatabaseScope = {
    connectionId: sourceId,
    database: sourceDatabase,
  };
  const targetScope: DatabaseScope = {
    connectionId: targetId,
    database: targetDatabase,
  };
  const schema = schemas?.tables[resultTable],
    plan = batch?.tables[resultTable];
  const pairs: TablePair[] = sourceObjects
    .filter((o) => selectedNames.includes(objectKey(o)))
    .map((o) => ({
      source: o,
      target: targetObjects.find(
        (item) => objectKey(item) === mappings[objectKey(o)],
      ) ?? {
        name: newNames[objectKey(o)] ?? o.name,
        type: "table",
        schema:
          target?.engine === "mysql"
            ? targetDatabase
            : target?.engine === "postgres"
              ? source?.engine === "postgres"
                ? o.schema
                : "public"
              : undefined,
      },
    }));
  const missingTargets =
    mode === "data" &&
    selectedNames.some(
      (key) => !targetObjects.some((o) => objectKey(o) === mappings[key]),
    );
  const visibleTables = sourceObjects.filter((o) =>
    objectLabel(o).toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    let current = true;
    setSourceObjects([]);
    setTargetObjects([]);
    setLoadedScope("");
    setSelectedNames([]);
    setMappings({});
    setNewNames({});
    setSearch("");
    if (!sourceDatabase || !targetDatabase) return;
    Promise.all([
      api.databaseObjects(sourceScope),
      api.databaseObjects(targetScope),
    ])
      .then(([from, to]) => {
        if (!current) return;
        const sources = from.filter((o) => o.type === "table"),
          targets = to.filter((o) => o.type === "table");
        setSourceObjects(sources);
        setTargetObjects(targets);
        setSelectedNames(
          initialObject &&
            sourceId === activeId &&
            sourceDatabase === activeDatabase
            ? sources
                .filter(
                  (o) =>
                    o.name === initialObject.name &&
                    o.schema === initialObject.schema,
                )
                .map(objectKey)
            : sources.map(objectKey),
        );
        const matches: Record<string, string> = {};
        for (const o of sources) {
          const candidates = targets.filter((item) => item.name === o.name);
          const match =
            candidates.find(
              (item) =>
                source?.engine === "postgres" &&
                target?.engine === "postgres" &&
                item.schema === o.schema,
            ) ?? (candidates.length === 1 ? candidates[0] : undefined);
          matches[objectKey(o)] = match ? objectKey(match) : "";
        }
        setMappings(matches);
        setLoadedScope(scopeKey);
        onRefresh();
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setLoadedScope(scopeKey);
        }
      });
    return () => {
      current = false;
    };
  }, [scopeKey, initialObject?.name, initialObject?.schema]);
  useEffect(() => {
    setSchemas(null);
    setBatch(null);
    setApplied("");
    setError("");
    setConfirm(false);
    setDeleteExtra(false);
    setResultTable(0);
    setDetail(0);
  }, [scopeKey, selectedNames, mappings, newNames]);
  async function compare() {
    if (!tablesReady || !pairs.length) {
      setError(t("请先选择源数据库、目标数据库和数据表。"));
      return;
    }
    if (missingTargets) {
      setError(
        t("部分目标表不存在，请先完成结构比对并创建目标表，或取消选择这些表。"),
      );
      return;
    }
    if (pairs.some((pair) => !pair.target.name.trim())) {
      setError(t("请填写目标表名称"));
      return;
    }
    setBusy(true);
    setError("");
    setApplied("");
    setSchemas(null);
    setBatch(null);
    setResultTable(0);
    setDetail(0);
    try {
      if (mode === "structure")
        setSchemas(
          await api.compareDatabaseSchemas(sourceScope, targetScope, pairs),
        );
      else
        setBatch(
          await api.compareDatabaseData(sourceScope, targetScope, pairs),
        );
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.applyDatabaseSync(batch.id, deleteExtra);
      setApplied(
        t("同步完成：新增 {0} 条、更新 {1} 条、删除 {2} 条。", [
          result.inserted,
          result.updated,
          result.deleted,
        ]),
      );
      setConfirm(false);
      setBatch(null);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const changes = batch?.tables.flatMap((table) => table.changes) ?? [];
  const counts = {
    insert: changes.filter((c) => c.kind === "insert").length,
    update: changes.filter((c) => c.kind === "update").length,
    delete: changes.filter((c) => c.kind === "delete").length,
  };
  const change = plan?.changes[detail];
  return (
    <div className="compare-workspace">
      <div className="compare-header">
        <div>
          <GitCompareArrows size={18} />
          <strong>
            {mode === "structure" ? t("结构比对") : t("数据同步")}
          </strong>
          <span>
            {mode === "structure"
              ? t("字段、主键、默认值、索引和外键")
              : t("源 → 目标 · 按完整主键比对")}
          </span>
        </div>
        <button
          className="button primary"
          onClick={() => void compare()}
          disabled={busy || loading || !tablesReady || !selectedNames.length}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Play size={13} />}
          {t("开始比对")}
        </button>
      </div>
      <div className="compare-selectors">
        <section>
          <h3>
            <Database size={15} />
            {t("源数据库")}
          </h3>
          <select
            aria-label={t("源数据库连接")}
            value={sourceId}
            disabled={busy}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {relational.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("选择源数据库")}
            value={sourceDatabase}
            disabled={busy || sourceCatalog.loading}
            onChange={(e) => sourceCatalog.select(e.target.value)}
          >
            <option value="">{t("请选择数据库")}</option>
            {sourceCatalog.names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </section>
        <div className="compare-direction">
          <ArrowRight size={26} />
          <span>{t("源 → 目标")}</span>
        </div>
        <section>
          <h3>
            <Database size={15} />
            {t("目标数据库")}
          </h3>
          <select
            aria-label={t("目标数据库连接")}
            value={targetId}
            disabled={busy}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">{t("选择目标连接")}</option>
            {relational.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("选择目标数据库")}
            value={targetDatabase}
            disabled={busy || targetCatalog.loading || !targetId}
            onChange={(e) => targetCatalog.select(e.target.value)}
          >
            <option value="">{t("请选择数据库")}</option>
            {targetCatalog.names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </section>
      </div>
      <div className="compare-table-selection">
        <div className="compare-table-toolbar">
          <strong>
            <Table2 size={14} />
            {t("选择数据表")}
          </strong>
          <span>
            {t("已选 {0} / {1} 张表", [
              selectedNames.length,
              sourceObjects.length,
            ])}
          </span>
          <button
            className="button"
            disabled={busy || !tablesReady}
            onClick={() => setSelectedNames(sourceObjects.map(objectKey))}
          >
            {t("全选")}
          </button>
          <button
            className="button"
            disabled={busy || !tablesReady}
            onClick={() => setSelectedNames([])}
          >
            {t("清空选择")}
          </button>
          <input
            aria-label={t("搜索数据表")}
            placeholder={t("搜索数据表")}
            value={search}
            disabled={busy}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <p className="compare-selection-hint">
            <Loader2 size={14} className="spin" />
            {t("正在读取数据库和数据表…")}
          </p>
        ) : tablesReady ? (
          <div className="compare-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("选择")}</th>
                  <th>{t("源表")}</th>
                  <th>{t("目标表")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleTables.map((o) => {
                  const key = objectKey(o),
                    selected = selectedNames.includes(key),
                    mapped = mappings[key] || "";
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t("选择表 {0}", [objectLabel(o)])}
                          checked={selected}
                          disabled={busy}
                          onChange={(e) =>
                            setSelectedNames((previous) =>
                              e.target.checked
                                ? [...previous, key]
                                : previous.filter((name) => name !== key),
                            )
                          }
                        />
                      </td>
                      <td>
                        <code>{objectLabel(o)}</code>
                      </td>
                      <td>
                        <div className="compare-table-mapping">
                          <select
                            aria-label={t("{0} 的目标表", [objectLabel(o)])}
                            value={mapped}
                            disabled={busy || !selected}
                            onChange={(e) =>
                              setMappings((previous) => ({
                                ...previous,
                                [key]: e.target.value,
                              }))
                            }
                          >
                            <option value="">
                              {mode === "structure"
                                ? t("新建目标表")
                                : t("目标表不存在 / 请选择")}
                            </option>
                            {targetObjects.map((item) => (
                              <option
                                key={objectKey(item)}
                                value={objectKey(item)}
                              >
                                {objectLabel(item)}
                              </option>
                            ))}
                          </select>
                          {mode === "structure" && !mapped && (
                            <input
                              aria-label={t("{0} 的新目标表名", [
                                objectLabel(o),
                              ])}
                              value={newNames[key] ?? o.name}
                              disabled={busy || !selected}
                              onChange={(e) =>
                                setNewNames((previous) => ({
                                  ...previous,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleTables.length && (
              <p className="compare-selection-hint">
                {t("没有符合条件的数据表")}
              </p>
            )}
          </div>
        ) : (
          <p className="compare-selection-hint">
            {t("先选择源数据库和目标数据库，再选择其中的数据表。")}
          </p>
        )}
        {missingTargets && (
          <p className="compare-selection-hint warning">
            {t(
              "部分目标表不存在，请先完成结构比对并创建目标表，或取消选择这些表。",
            )}
          </p>
        )}
      </div>
      <div className="compare-policy">
        <ShieldCheck size={14} />
        {mode === "structure"
          ? t(
              "比对只读取数据库。生成的 SQL 先预览，再手动执行；不自动删除字段。",
            )
          : t(
              "支持同类型 MySQL / PostgreSQL / SQLite，每表 ≤ 10,000 行、8 MB。所有选中表先校验，再在同一目标事务中同步。",
            )}
      </div>
      {(error || sourceCatalog.error || targetCatalog.error) && (
        <div className="compare-message error">
          <TriangleAlert size={16} />
          {t(error || sourceCatalog.error || targetCatalog.error)}
        </div>
      )}
      {applied && (
        <div className="compare-message success">
          <Check size={16} />
          {t(applied)}
        </div>
      )}
      {(schemas || batch) && (
        <div className="compare-batch-results">
          <div className="compare-batch-summary">
            <strong>
              {t("已比对 {0} 张表", [
                schemas?.tables.length ?? batch?.tables.length ?? 0,
              ])}
            </strong>
            {schemas && (
              <button
                className="button"
                disabled={busy || !schemas.sql}
                onClick={() => onQuery(targetScope, schemas.sql)}
              >
                <Code2 size={14} />
                {t("在目标查询编辑器打开全部 SQL")}
              </button>
            )}
          </div>
          <div
            className="compare-result-tabs"
            role="tablist"
            aria-label={t("表比对结果")}
          >
            {(schemas?.tables ?? batch?.tables ?? []).map((table, index) => (
              <button
                key={index}
                role="tab"
                aria-selected={resultTable === index}
                disabled={busy}
                className={resultTable === index ? "active" : ""}
                onClick={() => {
                  setResultTable(index);
                  setDetail(0);
                }}
              >
                {objectLabel(table.sourceObject)}{" "}
                <span>
                  {"differences" in table
                    ? table.differences.length
                    : table.changes.length}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {schema ? (
        <div className="structure-comparison">
          <div className="compare-result-heading">
            <strong>
              {schema.differences.length
                ? t("{0} 项结构差异", [schema.differences.length])
                : t("表结构一致")}
            </strong>
            <span>
              {t("源 {0} 字段 · 目标 {1} 字段", [
                schema.source.columns.length,
                schema.target.columns.length,
              ])}
            </span>
            <button
              className="button"
              disabled={!schema.sql || schema.sql.startsWith("--")}
              onClick={() => onQuery(targetScope, schema.sql)}
            >
              <Code2 size={14} />
              {t("在目标查询编辑器打开")}
            </button>
          </div>
          <div className="comparison-grid">
            <table>
              <thead>
                <tr>
                  <th>{t("对象 / 字段")}</th>
                  <th>{t("差异")}</th>
                  <th>{t("源定义")}</th>
                  <th>{t("目标定义")}</th>
                  <th>{t("说明")}</th>
                </tr>
              </thead>
              <tbody>
                {schema.differences.map((difference, i) => (
                  <tr key={i}>
                    <td>
                      {difference.detail === "外键定义不同；需要单独检查" ||
                      difference.detail === "索引定义不同；需要单独检查"
                        ? t(difference.field)
                        : difference.field}
                    </td>
                    <td>
                      <span
                        className={`tag ${difference.kind === "missing" ? "green" : difference.kind === "extra" ? "amber" : "blue"}`}
                      >
                        {difference.kind === "missing"
                          ? t("新增")
                          : difference.kind === "extra"
                            ? t("目标额外")
                            : t("变更")}
                      </span>
                    </td>
                    <td>
                      <code>{difference.source}</code>
                    </td>
                    <td>
                      <code>{difference.target}</code>
                    </td>
                    <td>{schemaDetail(difference.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!schema.differences.length && (
              <p className="compare-equal">
                <Check size={20} />
                {t("没有发现结构差异。")}
              </p>
            )}
          </div>
          <div className="migration-preview">
            <h3>
              <Code2 size={16} />
              {t("结构变更 SQL 预览")}
            </h3>
            <pre>{schema.sql}</pre>
            {schema.notes.length > 0 && (
              <div className="migration-notes">
                {schema.notes.map((note, i) => (
                  <p key={i}>
                    <TriangleAlert size={12} />
                    {schemaNote(note)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : plan ? (
        <div className="data-comparison">
          <div className="sync-summary">
            <span className="green">
              <strong>{counts.insert}</strong>
              {t("新增")}
            </span>
            <span className="blue">
              <strong>{counts.update}</strong>
              {t("更新")}
            </span>
            <span className="amber">
              <strong>{counts.delete}</strong>
              {t("目标额外")}
            </span>
            <span className="gray">
              <strong>
                {batch?.tables.reduce((sum, table) => sum + table.unchanged, 0)}
              </strong>
              {t("相同")}
            </span>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={deleteExtra}
                  onChange={(e) => setDeleteExtra(e.target.checked)}
                />
                {t("删除目标额外记录")}
              </label>
              <small>{t("默认保留 · 方案 10 分钟内有效")}</small>
            </div>
            <button
              className="button primary"
              disabled={
                busy ||
                (!counts.insert &&
                  !counts.update &&
                  (!deleteExtra || !counts.delete))
              }
              onClick={() => setConfirm(true)}
            >
              <ArrowRightLeft size={15} />
              {t("同步全部选中表")}
            </button>
          </div>
          <div className="sync-diff-panels">
            <div className="sync-change-list">
              <div className="sync-list-heading">
                {t("差异记录 ·")}
                {plan.changes.length}
              </div>
              {plan.changes.map((c, i) => (
                <button
                  key={i}
                  className={i === detail ? "active" : ""}
                  onClick={() => setDetail(i)}
                >
                  <span
                    className={`tag ${c.kind === "insert" ? "green" : c.kind === "update" ? "blue" : "amber"}`}
                  >
                    {c.kind === "insert"
                      ? t("新增")
                      : c.kind === "update"
                        ? t("更新")
                        : t("额外")}
                  </span>
                  <code>
                    {Object.entries(c.key)
                      .map(([key, v]) => `${key}=${value(v)}`)
                      .join(", ")}
                  </code>
                  <ChevronRight size={12} />
                </button>
              ))}
              {!plan.changes.length && (
                <p className="compare-equal">
                  <Check size={18} />
                  {t("数据一致")}
                </p>
              )}
            </div>
            <div className="sync-row-detail">
              {change ? (
                <>
                  <h3>
                    {t("记录差异")}{" "}
                    <span>
                      {Object.entries(change.key)
                        .map(([k, v]) => `${k}=${value(v)}`)
                        .join(", ")}
                    </span>
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("字段")}</th>
                        <th>{t("源数据")}</th>
                        <th>{t("目标数据")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.columns.map((column) => (
                        <tr
                          key={column}
                          className={
                            change.fields.includes(column) ? "changed" : ""
                          }
                        >
                          <td>{column}</td>
                          <td>{value(change.source?.[column])}</td>
                          <td>{value(change.target?.[column])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div className="compare-empty">
                  <Check size={27} />
                  <h3>{t("源表与目标表数据一致")}</h3>
                  <p>{t("无须同步。")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        !busy &&
        !applied && (
          <div className="compare-empty">
            <GitCompareArrows size={36} />
            <h3>
              {mode === "structure"
                ? t("先比对结构，再审阅变更。")
                : t("预览每条差异，再执行同步。")}
            </h3>
            <p>
              {t("先选择源数据库和目标数据库，再勾选需要比对或同步的数据表。")}
            </p>
            {relational.length < 2 && (
              <p>{t("可以新建另一个 SQLite 文件连接来体验比对与同步。")}</p>
            )}
          </div>
        )
      )}
      {confirm && batch && (
        <div className="modal-backdrop">
          <section
            className="modal action-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-heading">
              <div className="modal-icon">
                <ArrowRightLeft size={21} />
              </div>
              <div>
                <h2>{t("确认同步到目标数据库")}</h2>
                <p>
                  {source?.name} / {sourceDatabase} → {target?.name} /{" "}
                  {targetDatabase}
                </p>
              </div>
              <button
                className="icon-button close"
                onClick={() => setConfirm(false)}
                disabled={busy}
                aria-label={t("关闭")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="sync-confirm-body">
              <strong>
                {targetDatabase} · {t("{0} 个表", [batch.tables.length])}
              </strong>
              <p>
                {t("将新增 {0} 条、更新 {1} 条{2}。", [
                  counts.insert,
                  counts.update,
                  deleteExtra
                    ? t("、永久删除 {0} 条目标额外记录", [counts.delete])
                    : t("；目标额外记录将保留"),
                ])}
              </p>
              <p>
                {t(
                  "执行前会重新校验所有选中表，变化时取消同步。任一表变更失败会回滚整个批次。",
                )}
              </p>
              {target?.environment === "production" && (
                <p className="danger-text">
                  <TriangleAlert size={14} />
                  {t("目标是生产环境，请核对方向和记录。")}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="button"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                {t("取消")}
              </button>
              <button
                className={`button ${deleteExtra ? "danger" : "primary"}`}
                onClick={() => void apply()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                {t("确认同步")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
