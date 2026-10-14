const hexText = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

// Shared by SQL exports and the grid's clipboard, without Node-only APIs.
export function sqlLiteral(value: unknown, engine: string): string {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("不能导出非有限数值");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Uint8Array) {
    const hex = hexText(value);
    return engine === "postgres" ? `decode('${hex}','hex')` : `X'${hex}'`;
  }
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Hexadecimal text avoids depending on MySQL's NO_BACKSLASH_ESCAPES mode.
  if (engine === "mysql")
    return `CONVERT(X'${hexText(new TextEncoder().encode(text))}' USING utf8mb4)`;
  return `'${text.replaceAll("'", "''")}'`;
}
