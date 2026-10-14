import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
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
  Copy,
  ClipboardPaste,
  FileCode2,
} from "lucide-react";
import type { Column, DbObject, Engine, QueryResult } from "../../shared/types";
import type { CellDraft } from "../../shared/table-editing";
import {
  rowsSql,
  type ClipboardRow,
  type ClipboardRows,
} from "../../shared/row-clipboard";
import {
  readRowsClipboard,
  readRowsContent,
  rowClipboardContent,
  writeRowsClipboard,
} from "../row-clipboard";
import ContextMenu, { type MenuItem } from "./ContextMenu";
export interface GridEditing {
  editable: (row: number, column: string) => boolean;
  cell: (row: number, column: string) => CellDraft;
  change: (row: number, column: string, cell: CellDraft) => void;
  changed: (row: number, column: string) => boolean;
  isNew: (row: number) => boolean;
  remove: (row: number) => void;
  row: (row: number) => ClipboardRow;
  paste: (rows: ClipboardRows) => number;
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
  clipboard,
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
  clipboard?: {
    engine: Engine;
    object?: DbObject;
    notify: (text: string, error?: boolean) => void;
  };
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<number>(0);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    rows: number[];
  } | null>(null);
  const textInput = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest(
      'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]',
    );
  const reportError = (error: unknown) =>
    clipboard?.notify((error as Error).message, true);
  const snapshots = (indices: number[]) =>
    [...new Set(indices)]
      .sort((a, b) => a - b)
      .map(
        (index) =>
          editing?.row(index) ?? {
            values: result.rows[index],
            original: result.rows[index],
          },
      );
  const copiedRows = (indices: number[]): ClipboardRows => ({
    version: 1,
    columns: result.columns,
    rows: snapshots(indices).map((row) => row.values),
  });
  const copied = (count: number) =>
    clipboard?.notify(t("已复制 {0} 行", [count]));
  async function copyRows(indices: number[], mode?: "insert" | "update") {
    try {
      if (mode && clipboard?.object) {
        await navigator.clipboard.writeText(
          rowsSql(
            clipboard.engine,
            clipboard.object,
            columns,
            snapshots(indices),
            mode,
          ),
        );
      } else await writeRowsClipboard(copiedRows(indices));
      copied(indices.length);
    } catch (error) {
      reportError(error);
    }
  }
  function pasteRows(rows: ClipboardRows) {
    if (!editing || busy) return;
    const count = editing.paste(rows);
    if (count) clipboard?.notify(t("已粘贴 {0} 行，请检查后保存", [count]));
  }
  async function pasteClipboard() {
    try {
      pasteRows(await readRowsClipboard(result.columns));
    } catch (error) {
      reportError(error);
    }
  }
  const openMenu = (event: React.MouseEvent, index?: number) => {
    if (
      !clipboard ||
      busy ||
      (event.target instanceof Element &&
        event.target.closest(".context-menu-shield"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const rows =
      index === undefined
        ? selected
        : selected.includes(index)
          ? selected
          : [index];
    if (index !== undefined && !selected.includes(index))
      onSelect(editing?.isNew(index) ? [] : [index]);
    setMenu({ x: event.clientX, y: event.clientY, rows });
  };
  const menuItems: MenuItem[] = [
    {
      label: "复制整行",
      icon: <Copy size={14} />,
      disabled: !menu?.rows.length,
      action: () => void copyRows(menu!.rows),
    },
    ...(clipboard?.object &&
    ["mysql", "postgres", "sqlite"].includes(clipboard.engine)
      ? [
          {
            label: "复制为 INSERT 语句",
            icon: <FileCode2 size={14} />,
            disabled: !menu?.rows.length,
            action: () => void copyRows(menu!.rows, "insert"),
          },
          {
            label: "复制为 UPDATE 语句",
            icon: <FileCode2 size={14} />,
            disabled:
              !menu?.rows.length ||
              !columns.some((c) => c.primaryKey) ||
              menu.rows.some((i) => editing?.isNew(i)),
            action: () => void copyRows(menu!.rows, "update"),
          },
        ]
      : []),
    ...(editing
      ? [
          {
            label: "粘贴为新行",
            icon: <ClipboardPaste size={14} />,
            separator: true,
            action: () => void pasteClipboard(),
          },
        ]
      : []),
  ];
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
    <div
      ref={scroll}
      className={`grid-scroll ${busy ? "grid-busy" : ""}`}
      tabIndex={clipboard ? 0 : undefined}
      aria-label={t("数据表")}
      onContextMenu={(event) => openMenu(event)}
      onCopy={(event) => {
        if (!clipboard || busy || textInput(event.target) || !selected.length)
          return;
        event.preventDefault();
        try {
          const content = rowClipboardContent(copiedRows(selected));
          event.clipboardData.setData("text/plain", content.text);
          event.clipboardData.setData("text/html", content.html);
          copied(selected.length);
        } catch (error) {
          reportError(error);
        }
      }}
      onPaste={(event) => {
        if (!editing || busy || textInput(event.target)) return;
        event.preventDefault();
        try {
          pasteRows(
            readRowsContent(
              event.clipboardData.getData("text/plain"),
              event.clipboardData.getData("text/html"),
              result.columns,
            ),
          );
        } catch (error) {
          reportError(error);
        }
      }}
      onKeyDown={(event) => {
        if (
          clipboard &&
          !busy &&
          !textInput(event.target) &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "a"
        ) {
          event.preventDefault();
          onSelect(selectable);
        }
      }}
    >
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
              onContextMenu={(event) => openMenu(event, i)}
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
              <td
                className="row-number"
                onClick={(event) => {
                  if (busy || editing?.isNew(i)) return;
                  scroll.current?.focus();
                  if (event.shiftKey) {
                    const from = Math.min(anchor.current, i);
                    const to = Math.max(anchor.current, i);
                    onSelect(
                      selectable.filter(
                        (index) => index >= from && index <= to,
                      ),
                    );
                  } else {
                    onSelect(
                      event.ctrlKey || event.metaKey
                        ? selected.includes(i)
                          ? selected.filter((index) => index !== i)
                          : [...selected, i]
                        : [i],
                    );
                    anchor.current = i;
                  }
                }}
              >
                {editing?.isNew(i) ? "+" : i + 1}
              </td>
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => {
            setMenu(null);
            scroll.current?.focus();
          }}
        />
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
