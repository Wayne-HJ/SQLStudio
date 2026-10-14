import type { Column, DbObject, Engine } from "./types.js";
import { cellDraft, generatedColumn, type RowDraft } from "./table-editing.js";
import { sqlLiteral } from "./sql-literal.js";

export interface ClipboardRows {
  version: 1;
  columns: string[];
  rows: Record<string, unknown>[];
}
export interface ClipboardRow {
  values: Record<string, unknown>;
  original?: Record<string, unknown>;
}

export function rowsText(data: ClipboardRows) {
  const field = (value: unknown) => {
    if (value === null) return "NULL";
    if (value === undefined) return "DEFAULT";
    const text =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    return !text || /[\t\r\n"]/.test(text) || /^(NULL|DEFAULT)$/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };
  return data.rows
    .map((row) => data.columns.map((name) => field(row[name])).join("\t"))
    .join("\n");
}

export function parseRowsPayload(text: string): ClipboardRows {
  const data = JSON.parse(text) as ClipboardRows;
  if (
    data?.version !== 1 ||
    !Array.isArray(data.columns) ||
    !data.columns.length ||
    !data.columns.every((name) => typeof name === "string") ||
    new Set(data.columns).size !== data.columns.length ||
    !Array.isArray(data.rows) ||
    !data.rows.length ||
    !data.rows.every(
      (row) => row && typeof row === "object" && !Array.isArray(row),
    )
  )
    throw new Error("剪贴板中的行数据格式无效");
  return data;
}

// Preserve quoted tabs/newlines and distinguish SQL NULL from the text "NULL".
export function parseRowsText(text: string, columns: string[]): ClipboardRows {
  if (!text) throw new Error("剪贴板中没有行数据");
  const records: { text: string; quoted: boolean }[][] = [];
  let record: { text: string; quoted: boolean }[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let closed = false;
  const finishField = () => {
    record.push({ text: field, quoted });
    field = "";
    quoted = false;
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "\t" || char === "\r" || char === "\n") {
      finishField();
      if (char !== "\t") {
        records.push(record);
        record = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !field && !closed) {
      inQuotes = true;
      quoted = true;
    } else {
      if (closed) throw new Error("剪贴板中的行数据格式无效");
      field += char;
    }
  }
  if (inQuotes) throw new Error("剪贴板中的行数据格式无效");
  if (field || quoted || record.length || !records.length) {
    finishField();
    records.push(record);
  }
  const header = records[0].map((cell) => cell.text);
  if (
    records.length > 1 &&
    header.every((name) => columns.includes(name)) &&
    new Set(header).size === header.length
  ) {
    columns = header;
    records.shift();
  }
  if (!records.length) throw new Error("剪贴板中没有行数据");
  if (records.some((row) => row.length !== columns.length))
    throw new Error("粘贴数据的列数与当前表不匹配");
  return {
    version: 1,
    columns,
    rows: records.map((row) =>
      Object.fromEntries(
        row.map((cell, i) => [
          columns[i],
          !cell.quoted && cell.text === "NULL"
            ? null
            : !cell.quoted && cell.text === "DEFAULT"
              ? undefined
              : cell.text,
        ]),
      ),
    ),
  };
}

export function pastedDrafts(
  data: ClipboardRows,
  columns: Column[],
): RowDraft[] {
  const writable = columns.filter(
    (column) => !generatedColumn(column) && data.columns.includes(column.name),
  );
  if (!writable.length) throw new Error("粘贴数据没有与当前表匹配的可写字段");
  return data.rows.map((row) => ({
    id: crypto.randomUUID(),
    cells: Object.fromEntries(
      writable.map((column) => [column.name, cellDraft(row[column.name])]),
    ),
  }));
}

export function rowsSql(
  engine: Engine,
  object: DbObject,
  columns: Column[],
  rows: ClipboardRow[],
  mode: "insert" | "update",
) {
  if (!["mysql", "postgres", "sqlite"].includes(engine))
    throw new Error("复制 SQL 适用于关系型数据表");
  const quote = (name: string) => {
    const q = engine === "mysql" ? "`" : '"';
    return q + name.replaceAll(q, q + q) + q;
  };
  const table =
    object.schema && engine !== "sqlite"
      ? `${quote(object.schema)}.${quote(object.name)}`
      : quote(object.name);
  const keys = columns.filter((column) => column.primaryKey);
  return rows
    .map(({ values, original }) => {
      const fields = columns.filter(
        (column) =>
          !(mode === "insert"
            ? column.generationExpression
            : generatedColumn(column)) &&
          Object.hasOwn(values, column.name) &&
          values[column.name] !== undefined,
      );
      if (mode === "insert") {
        if (!fields.length)
          return `INSERT INTO ${table} ${engine === "mysql" ? "() VALUES ()" : "DEFAULT VALUES"};`;
        const overriding =
          engine === "postgres" && fields.some((c) => c.identity === "ALWAYS")
            ? " OVERRIDING SYSTEM VALUE"
            : "";
        return `INSERT INTO ${table} (${fields.map((c) => quote(c.name)).join(", ")})${overriding} VALUES (${fields.map((c) => sqlLiteral(values[c.name], engine)).join(", ")});`;
      }
      if (
        !original ||
        !keys.length ||
        keys.some((column) => original[column.name] === undefined)
      )
        throw new Error("复制 UPDATE 需要已有记录和完整主键");
      if (!fields.length) throw new Error("当前记录没有可更新字段");
      const where = keys
        .map((column) => {
          const value = original[column.name];
          return value === null
            ? `${quote(column.name)} IS NULL`
            : `${quote(column.name)} = ${sqlLiteral(value, engine)}`;
        })
        .join(" AND ");
      return `UPDATE ${table} SET ${fields.map((c) => `${quote(c.name)} = ${sqlLiteral(values[c.name], engine)}`).join(", ")} WHERE ${where};`;
    })
    .join("\n");
}
