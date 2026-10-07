import { t } from "../i18n";
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
} from "lucide-react";
import type { Column, QueryResult } from "../../shared/types";
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
  onEdit,
  sort,
  direction,
  onSort,
  busy,
}: {
  result: QueryResult;
  columns?: Column[];
  selected: number[];
  onSelect: (rows: number[]) => void;
  onEdit?: (row: number, column: string) => void;
  sort?: string;
  direction?: string;
  onSort?: (column: string) => void;
  busy?: boolean;
}) {
  return (
    <div className={`grid-scroll ${busy ? "grid-busy" : ""}`}>
      <table className="data-grid">
        <thead>
          <tr>
            <th className="checkbox-cell">
              <input
                aria-label={t("选择所有行")}
                type="checkbox"
                checked={
                  !!result.rows.length && selected.length === result.rows.length
                }
                onChange={(e) =>
                  onSelect(e.target.checked ? result.rows.map((_, i) => i) : [])
                }
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
            <tr key={i} className={selected.includes(i) ? "selected" : ""}>
              <td className="checkbox-cell">
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
              </td>
              <td className="row-number">{i + 1}</td>
              {result.columns.map((name) => (
                <td
                  key={name}
                  onDoubleClick={() => onEdit?.(i, name)}
                  title={valueText(row[name])}
                  className={name === "id" ? "id-cell" : ""}
                >
                  {row[name] === null ? (
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
