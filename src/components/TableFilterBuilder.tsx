import { t } from "../i18n";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  Column,
  Engine,
  FilterCondition,
  TableFilter,
} from "../../shared/types";

const operators: { value: FilterCondition["operator"]; label: string }[] = [
  { value: "eq", label: "等于 =" },
  { value: "neq", label: "不等于 ≠" },
  { value: "gt", label: "大于 >" },
  { value: "gte", label: "大于等于 ≥" },
  { value: "lt", label: "小于 <" },
  { value: "lte", label: "小于等于 ≤" },
  { value: "contains", label: "包含" },
  { value: "not_contains", label: "不包含" },
  { value: "starts_with", label: "开头是" },
  { value: "ends_with", label: "结尾是" },
  { value: "between", label: "介于（含边界）" },
  { value: "is_null", label: "为 NULL" },
  { value: "is_not_null", label: "不为 NULL" },
];
const noValue = (operator: FilterCondition["operator"]) =>
  ["is_null", "is_not_null"].includes(operator);

export default function TableFilterBuilder({
  columns,
  engine,
  value,
  expanded,
  busy,
  onApply,
}: {
  columns: Column[];
  engine: Engine;
  value?: TableFilter;
  expanded: boolean;
  busy: boolean;
  onApply: (value?: TableFilter) => void;
}) {
  const [draft, setDraft] = useState<TableFilter>(
    value ?? { mode: "and", conditions: [] },
  );
  useEffect(() => {
    setDraft(value ?? { mode: "and", conditions: [] });
  }, [value]);
  useEffect(() => {
    if (columns.length)
      setDraft((current) =>
        current.conditions.length
          ? {
              ...current,
              conditions: current.conditions.map((condition) =>
                columns.some((column) => column.name === condition.column)
                  ? condition
                  : { ...condition, column: columns[0].name },
              ),
            }
          : {
              ...current,
              conditions: [
                { column: columns[0].name, operator: "eq", value: "" },
              ],
            },
      );
  }, [columns]);
  const update = (index: number, patch: Partial<FilterCondition>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));
  const apply = () =>
    onApply(
      draft.conditions.length
        ? { ...draft, conditions: draft.conditions.map((c) => ({ ...c })) }
        : undefined,
    );
  const quote = engine === "mysql" ? "`" : '"';
  const preview = draft.conditions
    .map((c) => {
      const column = quote + c.column.replaceAll(quote, quote + quote) + quote;
      const literal = (v = "") => "'" + v.replaceAll("'", "''") + "'";
      const comparisons = {
        eq: "=",
        neq: "<>",
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
      };
      if (c.operator === "is_null") return `${column} IS NULL`;
      if (c.operator === "is_not_null") return `${column} IS NOT NULL`;
      if (c.operator === "between")
        return `${column} BETWEEN ${literal(c.value)} AND ${literal(c.valueTo)}`;
      if (c.operator in comparisons)
        return `${column} ${comparisons[c.operator as keyof typeof comparisons]} ${literal(c.value)}`;
      return `${column} ${t(operators.find((op) => op.value === c.operator)?.label ?? c.operator)} ${literal(c.value)}`;
    })
    .join(draft.mode === "and" ? " AND " : " OR ");
  return (
    <form
      className="condition-builder"
      aria-label={t("按列筛选条件")}
      hidden={!expanded}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <div className="condition-builder-header">
        <strong>{t("筛选条件")}</strong>
        <label>
          {t("条件关系")}
          <select
            aria-label={t("条件关系")}
            value={draft.mode}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                mode: e.target.value as TableFilter["mode"],
              }))
            }
          >
            <option value="and">{t("全部满足（AND / 且）")}</option>
            <option value="or">{t("任意满足（OR / 或）")}</option>
          </select>
        </label>
        <span>
          {value?.conditions.length
            ? t("已应用 {0} 条条件", [value.conditions.length])
            : t("选择列名并添加条件")}
        </span>
      </div>
      <div className="condition-rows">
        {draft.conditions.map((condition, index) => (
          <div className="condition-row" key={index}>
            <span className="condition-number">{index + 1}</span>
            <select
              aria-label={t("条件 {0} 列名", [index + 1])}
              value={condition.column}
              onChange={(e) => update(index, { column: e.target.value })}
              required
            >
              {!columns.length && (
                <option value="">{t("正在加载字段…")}</option>
              )}
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name} · {column.type}
                </option>
              ))}
            </select>
            <select
              aria-label={t("条件 {0} 运算符", [index + 1])}
              value={condition.operator}
              onChange={(e) =>
                update(index, {
                  operator: e.target.value as FilterCondition["operator"],
                })
              }
            >
              {operators.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {t(operator.label)}
                </option>
              ))}
            </select>
            <div className="condition-value">
              <input
                aria-label={t("条件 {0} 值", [index + 1])}
                disabled={noValue(condition.operator)}
                value={condition.value ?? ""}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder={
                  noValue(condition.operator)
                    ? t("无需填写值")
                    : t("比较值（空字符串可留空）")
                }
                maxLength={10000}
              />
              {condition.operator === "between" && (
                <>
                  <span>{t("至")}</span>
                  <input
                    aria-label={t("条件 {0} 结束值", [index + 1])}
                    value={condition.valueTo ?? ""}
                    onChange={(e) => update(index, { valueTo: e.target.value })}
                    placeholder={t("结束值")}
                    maxLength={10000}
                  />
                </>
              )}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t("移除条件 {0}", [index + 1])}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  conditions: d.conditions.filter((_, i) => i !== index),
                }))
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="condition-builder-footer">
        <button
          type="button"
          className="button"
          disabled={!columns.length || draft.conditions.length >= 20}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              conditions: [
                ...d.conditions,
                { column: columns[0].name, operator: "eq", value: "" },
              ],
            }))
          }
        >
          <Plus size={14} />
          {t("添加条件")}
        </button>
        <code aria-label={t("条件预览")} title={preview}>
          {preview || t("未设置条件")}
        </code>
        <button
          type="button"
          className="button"
          onClick={() => {
            setDraft({
              mode: "and",
              conditions: columns.length
                ? [{ column: columns[0].name, operator: "eq", value: "" }]
                : [],
            });
            onApply(undefined);
          }}
        >
          {t("清除条件")}
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={busy || !columns.length}
        >
          {t("应用筛选")}
        </button>
      </div>
    </form>
  );
}
