import type { Column } from "./types.js";

export interface CellDraft {
  mode: "value" | "null" | "default";
  text: string;
}
export interface RowDraft {
  id: string;
  original?: Record<string, unknown>;
  cells: Record<string, CellDraft>;
}
export function cellDraft(value: unknown): CellDraft {
  return {
    mode: value === null ? "null" : value === undefined ? "default" : "value",
    text:
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
  };
}
export function rowKey(columns: Column[], row: Record<string, unknown>) {
  return Object.fromEntries(
    columns.filter((c) => c.primaryKey).map((c) => [c.name, row[c.name]]),
  );
}
export function generatedColumn(column: Column) {
  return !!column.generationExpression || column.identity === "ALWAYS";
}
export function draftValues(draft: RowDraft, columns: Column[]) {
  const entries: [string, unknown][] = [];
  for (const column of columns) {
    const cell = draft.cells[column.name];
    if (!cell || cell.mode === "default" || generatedColumn(column)) continue;
    if (cell.mode === "null") {
      entries.push([column.name, null]);
      continue;
    }
    const text = cell.text;
    let value: unknown = text;
    if (/\b(json|jsonb)\b/i.test(column.type)) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`字段 {0} 需要有效的 JSON`);
      }
      // SQL drivers accept JSON text; JSON null must remain distinct from SQL NULL.
      value = JSON.stringify(value);
    } else if (/^(bool|boolean)$/i.test(column.type)) {
      if (!/^(true|false|1|0)$/i.test(text.trim()))
        throw new Error("字段 {0} 需要布尔值 true / false");
      value = /^(true|1)$/i.test(text.trim());
    } else if (
      /^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|real|float|double|decimal|numeric|number)\b/i.test(
        column.type,
      )
    ) {
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) ||
        !Number.isFinite(Number(text))
      )
        throw new Error("字段 {0} 需要有效的数字");
      if (
        /^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8)\b/i.test(
          column.type,
        ) &&
        !/^[+-]?\d+$/.test(text.trim())
      )
        throw new Error("字段 {0} 需要整数");
      // Bind the entered text to preserve BIGINT and DECIMAL precision.
      value = text.trim();
    }
    entries.push([column.name, value]);
  }
  return Object.fromEntries(entries);
}
