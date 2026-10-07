import { createHash } from "node:crypto";
import type {
  Column,
  TableInfo,
  SchemaDifference,
  SyncChange,
} from "../shared/types.js";
export function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return JSON.stringify(Buffer.from(value).toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable((value as any)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function fingerprint(
  rows: Record<string, unknown>[],
  schema: TableInfo,
) {
  return createHash("sha256")
    .update(stable(schema))
    .update(rows.map(stable).sort().join("\n"))
    .digest("hex");
}
export function typeFamily(type: string) {
  const t = type.toLowerCase();
  if (/int|serial/.test(t)) return "integer";
  if (/numeric|decimal|real|double|float/.test(t)) return "numeric";
  if (/bool/.test(t)) return "boolean";
  if (/date|time/.test(t)) return "datetime";
  if (/blob|binary|bytea/.test(t)) return "binary";
  if (/json/.test(t)) return "json";
  return "text";
}
export function columnDescription(c?: Column) {
  return c
    ? `${c.type}${c.nullable ? " NULL" : " NOT NULL"}${c.primaryKey ? " PRIMARY KEY" : ""}${c.defaultValue != null ? " DEFAULT " + String(c.defaultValue) : ""}`
    : "—";
}
export function schemaDifferences(
  source: TableInfo,
  target: TableInfo,
): SchemaDifference[] {
  const differences: SchemaDifference[] = [];
  for (const column of source.columns) {
    const other = target.columns.find((c) => c.name === column.name);
    const detail: string[] = [];
    if (!other) {
      differences.push({
        field: column.name,
        kind: "missing",
        source: columnDescription(column),
        target: "—",
        detail: "目标缺少字段",
      });
      continue;
    }
    if (column.type.toLowerCase() !== other.type.toLowerCase())
      detail.push("数据类型");
    if (column.nullable !== other.nullable) detail.push("允许 NULL");
    if (column.primaryKey !== other.primaryKey) detail.push("主键");
    if (
      stable(column.defaultValue ?? null) !== stable(other.defaultValue ?? null)
    )
      detail.push("默认值");
    if (detail.length)
      differences.push({
        field: column.name,
        kind: "changed",
        source: columnDescription(column),
        target: columnDescription(other),
        detail: detail.join("、") + "不同",
      });
  }
  for (const column of target.columns)
    if (!source.columns.some((c) => c.name === column.name))
      differences.push({
        field: column.name,
        kind: "extra",
        source: "—",
        target: columnDescription(column),
        detail: "目标额外字段（保留）",
      });
  for (const [label, sourceItems, targetItems] of [
    ["外键", source.foreignKeys, target.foreignKeys],
    ["索引", source.indexes, target.indexes],
  ] as const) {
    if (stable(sourceItems) !== stable(targetItems))
      differences.push({
        field: label,
        kind: "changed",
        source: stable(sourceItems),
        target: stable(targetItems),
        detail: `${label}定义不同；需要单独检查`,
      });
  }
  return differences;
}
export function compareRows(
  source: Record<string, unknown>[],
  target: Record<string, unknown>[],
  primaryKeys: string[],
  columns: Column[],
) {
  const key = (row: Record<string, unknown>) =>
    stable(primaryKeys.map((k) => row[k]));
  const sourceMap = new Map(source.map((row) => [key(row), row]));
  const targetMap = new Map(target.map((row) => [key(row), row]));
  if (
    sourceMap.size !== source.length ||
    targetMap.size !== target.length ||
    [...source, ...target].some((row) =>
      primaryKeys.some((k) => row[k] == null),
    )
  )
    throw new Error("主键不唯一或包含 NULL，无法进行同步");
  const changes: SyncChange[] = [];
  let unchanged = 0;
  for (const row of source) {
    const other = targetMap.get(key(row));
    const primary = Object.fromEntries(primaryKeys.map((k) => [k, row[k]]));
    if (!other) {
      changes.push({
        kind: "insert",
        key: primary,
        source: row,
        fields: columns.map((c) => c.name),
      });
      continue;
    }
    const fields = columns
      .filter(
        (c) =>
          !primaryKeys.includes(c.name) &&
          stable(row[c.name]) !== stable(other[c.name]),
      )
      .map((c) => c.name);
    if (fields.length)
      changes.push({
        kind: "update",
        key: primary,
        source: row,
        target: other,
        fields,
      });
    else unchanged++;
  }
  for (const row of target)
    if (!sourceMap.has(key(row)))
      changes.push({
        kind: "delete",
        key: Object.fromEntries(primaryKeys.map((k) => [k, row[k]])),
        target: row,
        fields: [],
      });
  return { changes, unchanged };
}
