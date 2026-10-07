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
  SchemaComparison,
  SyncPlan,
} from "../../shared/types";
const objectKey = (o: DbObject) => `${o.schema ?? ""}.${o.name}`;
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
  initialObject,
  onQuery,
  onRefresh,
}: {
  mode: "structure" | "data";
  connections: Connection[];
  activeId: string;
  initialObject?: DbObject;
  onQuery: (targetId: string, text: string) => void;
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
  const [sourceObjects, setSourceObjects] = useState<DbObject[]>([]);
  const [targetObjects, setTargetObjects] = useState<DbObject[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [targetNew, setTargetNew] = useState("");
  const [schema, setSchema] = useState<SchemaComparison | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteExtra, setDeleteExtra] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState("");
  const [detail, setDetail] = useState(0);
  const source = relational.find((c) => c.id === sourceId),
    target = relational.find((c) => c.id === targetId);
  const sourceObject = sourceObjects.find((o) => objectKey(o) === sourceName),
    targetObject =
      targetObjects.find((o) => objectKey(o) === targetName) ??
      (targetNew
        ? {
            name: targetNew,
            type: "table" as const,
            schema: target?.engine === "postgres" ? "public" : undefined,
          }
        : undefined);
  useEffect(() => {
    let current = true;
    setSourceObjects([]);
    setSourceName("");
    if (source)
      api
        .connect(source)
        .then(() => api.objects(source.id))
        .then((list) => {
          if (current) {
            const tables = list.filter((o) => o.type === "table");
            setSourceObjects(tables);
            setSourceName(
              objectKey(
                tables.find(
                  (o) =>
                    o.name === initialObject?.name &&
                    o.schema === initialObject.schema,
                ) ??
                  tables.find((o) => o.name === "customers") ??
                  tables[0] ?? { name: "", type: "table" },
              ),
            );
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [sourceId, initialObject?.name, initialObject?.schema]);
  useEffect(() => {
    let current = true;
    setTargetObjects([]);
    setTargetName("");
    if (target)
      api
        .connect(target)
        .then(() => api.objects(target.id))
        .then((list) => {
          if (current) {
            const tables = list.filter((o) => o.type === "table");
            setTargetObjects(tables);
            setTargetName(
              objectKey(
                tables.find((o) => o.name === sourceObject?.name) ??
                  tables.find((o) => o.name === "customers") ??
                  tables[0] ?? { name: "", type: "table" },
              ),
            );
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [targetId]);
  useEffect(() => {
    setSchema(null);
    setPlan(null);
    setApplied("");
    setError("");
    setConfirm(false);
    setDeleteExtra(false);
  }, [sourceId, targetId, sourceName, targetName, targetNew, mode]);
  async function compare() {
    if (!sourceObject || !targetObject) {
      setError(
        t("请选择源表和目标表。目标连接不存在时，请先使用顶部“连接”添加。"),
      );
      return;
    }
    setBusy(true);
    setError("");
    setApplied("");
    setSchema(null);
    setPlan(null);
    try {
      if (mode === "structure")
        setSchema(
          await api.compareSchemas(
            sourceId,
            targetId,
            sourceObject,
            targetObject,
          ),
        );
      else {
        setPlan(
          await api.compareData(sourceId, targetId, sourceObject, targetObject),
        );
        setDetail(0);
      }
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.applySync(plan.id, deleteExtra);
      setApplied(
        t("同步完成：新增 {0} 条、更新 {1} 条、删除 {2} 条。", [
          result.inserted,
          result.updated,
          result.deleted,
        ]),
      );
      setConfirm(false);
      setPlan(null);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const counts = {
    insert: plan?.changes.filter((c) => c.kind === "insert").length ?? 0,
    update: plan?.changes.filter((c) => c.kind === "update").length ?? 0,
    delete: plan?.changes.filter((c) => c.kind === "delete").length ?? 0,
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
          disabled={busy || !sourceId || !targetId}
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
            onChange={(e) => setSourceId(e.target.value)}
          >
            {relational.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.database}
              </option>
            ))}
          </select>
          <select
            aria-label={t("源表")}
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
          >
            <option value="">{t("选择源表")}</option>
            {sourceObjects.map((o) => (
              <option key={objectKey(o)} value={objectKey(o)}>
                {o.schema ? o.schema + "." : ""}
                {o.name}
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
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">{t("选择目标连接")}</option>
            {relational.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.database}
              </option>
            ))}
          </select>
          <select
            aria-label={t("目标表")}
            value={targetName}
            onChange={(e) => {
              setTargetName(e.target.value);
              setTargetNew("");
            }}
          >
            <option value="">
              {mode === "structure"
                ? t("选择已有表，或在下方填写新表名")
                : t("选择目标表")}
            </option>
            {targetObjects.map((o) => (
              <option key={objectKey(o)} value={objectKey(o)}>
                {o.schema ? o.schema + "." : ""}
                {o.name}
              </option>
            ))}
          </select>
          {mode === "structure" && !targetName && targetId && (
            <input
              aria-label={t("新目标表名")}
              value={targetNew}
              onChange={(e) => setTargetNew(e.target.value)}
              placeholder={t("目标表不存在时，填写新表名称")}
            />
          )}
        </section>
      </div>
      <div className="compare-policy">
        <ShieldCheck size={14} />
        {mode === "structure"
          ? t(
              "比对只读取数据库。生成的 SQL 先预览，再手动执行；不自动删除字段。",
            )
          : t(
              "首版支持同类型 MySQL / PostgreSQL / SQLite，单表 ≤ 10,000 行、8 MB。同步前重检差异，目标库事务执行。",
            )}
      </div>
      {error && (
        <div className="compare-message error">
          <TriangleAlert size={16} />
          {t(error)}
        </div>
      )}
      {applied && (
        <div className="compare-message success">
          <Check size={16} />
          {t(applied)}
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
              onClick={() => onQuery(targetId, schema.sql)}
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
              <strong>{plan.unchanged}</strong>
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
                !counts.insert &&
                !counts.update &&
                (!deleteExtra || !counts.delete)
              }
              onClick={() => setConfirm(true)}
            >
              <ArrowRightLeft size={15} />
              {t("执行同步")}
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
            <p>{t("选择源连接和目标连接，点击“开始比对”。")}</p>
            {relational.length < 2 && (
              <p>{t("可以新建另一个 SQLite 文件连接来体验比对与同步。")}</p>
            )}
          </div>
        )
      )}
      {confirm && plan && (
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
                  {source?.name} → {target?.name}
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
                {target?.database} / {targetObject?.name}
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
                  "执行前会重新校验源表和目标表，变化时取消同步。任一数据变更失败会回滚目标事务。",
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
