import { t } from "../i18n";
import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  KeyRound,
  Braces,
  Hash,
  Type,
  Calendar,
  Check,
  X,
} from "lucide-react";
import type { Column, QueryResult } from "../../shared/types";
import type { CellDraft } from "../../shared/table-editing";
export interface GridEditing {
  editable: (row: number, column: string) => boolean;
  cell: (row: number, column: string) => CellDraft;
  change: (row: number, column: string, cell: CellDraft) => void;
  changed: (row: number, column: string) => boolean;
  isNew: (row: number) => boolean;
  remove: (row: number) => void;
}
export const valueText = (value: unknown) =>
  value === null
    ? "NULL"
    : value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
export function columnIcon(column?: Column) {
  if (column?.primaryKey) return <KeyRound size={12} />;
  if (column?.type.match(/INT|REAL|DECIMAL|numeric|number|double/i))
    return <Hash size={13} />;
  if (column?.type.match(/date|time/i) || column?.name.endsWith("_at"))
    return <Calendar size={12} />;
  if (column?.type.match(/object|array|json/i)) return <Braces size={13} />;
  return <Type size={12} />;
}
export default function DataGrid({
  result,
  columns = [],
  selected,
  onSelect,
  editing,
  sort,
  direction,
  onSort,
  busy,
}: {
  result: QueryResult;
  columns?: Column[];
  selected: number[];
  onSelect: (rows: number[]) => void;
  editing?: GridEditing;
  sort?: string;
  direction?: string;
  onSort?: (column: string) => void;
  busy?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const newCount = result.rows.filter((_, i) => editing?.isNew(i)).length;
  const previousNewCount = useRef(0);
  useEffect(() => {
    if (newCount > previousNewCount.current) {
      const row = scroll.current?.querySelector("tr.draft-row:last-child");
      row?.scrollIntoView({ block: "nearest" });
      row?.querySelector("input")?.focus();
    }
    previousNewCount.current = newCount;
  }, [newCount]);
  const selectable = result.rows
    .map((_, i) => i)
    .filter((i) => !editing?.isNew(i));
  return (
    <div ref={scroll} className={`grid-scroll ${busy ? "grid-busy" : ""}`}>
      <table className="data-grid">
        <thead>
          <tr>
            <th className="checkbox-cell">
              <input
                aria-label={t("选择所有行")}
                type="checkbox"
                checked={
                  !!selectable.length && selected.length === selectable.length
                }
                onChange={(e) => onSelect(e.target.checked ? selectable : [])}
              />
            </th>
            <th className="row-number">#</th>
            {result.columns.map((name) => {
              const column = columns.find((c) => c.name === name);
              return (
                <th
                  key={name}
                  className={column?.primaryKey ? "primary-column" : ""}
                  onClick={() => onSort?.(name)}
                >
                  <div>
                    {columnIcon(column)}
                    <span>{name}</span>
                    {onSort &&
                      (sort === name ? (
                        direction === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon" />
                      ))}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr
              key={i}
              className={`${selected.includes(i) ? "selected" : ""} ${editing?.isNew(i) ? "draft-row" : ""}`}
            >
              <td className="checkbox-cell">
                {editing?.isNew(i) ? (
                  <button
                    className="draft-remove"
                    aria-label={t("移除新增行")}
                    disabled={busy}
                    onClick={() => editing.remove(i)}
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <input
                    type="checkbox"
                    aria-label={t("选择第 {0} 行", [i + 1])}
                    checked={selected.includes(i)}
                    onChange={(e) =>
                      onSelect(
                        e.target.checked
                          ? [...selected, i]
                          : selected.filter((x) => x !== i),
                      )
                    }
                  />
                )}
              </td>
              <td className="row-number">{editing?.isNew(i) ? "+" : i + 1}</td>
              {result.columns.map((name) => (
                <td
                  key={name}
                  title={valueText(row[name])}
                  className={`${name === "id" ? "id-cell" : ""} ${editing?.editable(i, name) ? "editable-cell" : ""} ${editing?.changed(i, name) ? "changed-cell" : ""}`}
                >
                  {editing?.editable(i, name) ? (
                    <GridCellEditor
                      row={i}
                      name={name}
                      cell={editing.cell(i, name)}
                      onChange={(cell) => editing.change(i, name, cell)}
                      isNew={editing.isNew(i)}
                      busy={busy}
                    />
                  ) : editing?.isNew(i) ? (
                    <span className="null-value">{t("自动生成")}</span>
                  ) : row[name] === null ? (
                    <span className="null-value">NULL</span>
                  ) : name === "status" ? (
                    <span
                      className={`status-badge ${["active", "completed"].includes(String(row[name])) ? "green" : ["pending", "processing"].includes(String(row[name])) ? "amber" : "gray"}`}
                    >
                      <i />
                      {valueText(row[name])}
                    </span>
                  ) : name === "plan" ? (
                    <span
                      className={`plan-badge ${row[name] === "Enterprise" ? "purple" : row[name] === "Pro" ? "blue" : "gray"}`}
                    >
                      {valueText(row[name])}
                    </span>
                  ) : typeof row[name] === "boolean" ? (
                    <span className="boolean-value">
                      {row[name] ? <Check size={14} /> : null}
                      {String(row[name])}
                    </span>
                  ) : (
                    valueText(row[name])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!result.rows.length && (
        <div className="empty-grid">
          <Braces size={30} />
          <strong>{t("暂无数据")}</strong>
          <p>
            {result.columns.length
              ? t("试试调整筛选条件，或添加第一条记录。")
              : t("执行查询后，结果将显示在这里。")}
          </p>
        </div>
      )}
    </div>
  );
}

function GridCellEditor({
  row,
  name,
  cell,
  onChange,
  isNew,
  busy,
}: {
  row: number;
  name: string;
  cell: CellDraft;
  onChange: (cell: CellDraft) => void;
  isNew: boolean;
  busy?: boolean;
}) {
  return (
    <div className="grid-cell-editor">
      <input
        aria-label={t("第 {0} 行 · {1}", [row + 1, name])}
        value={cell.mode === "value" ? cell.text : ""}
        placeholder={
          cell.mode === "null"
            ? "NULL"
            : cell.mode === "default"
              ? t("默认值")
              : ""
        }
        title={
          cell.mode === "value"
            ? cell.text
            : cell.mode === "null"
              ? "NULL"
              : t("默认值")
        }
        disabled={busy}
        onChange={(event) =>
          onChange({ mode: "value", text: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <select
        className="cell-value-mode"
        aria-label={t("第 {0} 行 · {1} 的值类型", [row + 1, name])}
        title={t("值 / NULL / 默认值")}
        value={cell.mode}
        disabled={busy}
        onChange={(event) =>
          onChange({ ...cell, mode: event.target.value as CellDraft["mode"] })
        }
      >
        <option value="value">{t("值")}</option>
        <option value="null">NULL</option>
        {isNew && <option value="default">{t("默认值")}</option>}
      </select>
    </div>
  );
}
