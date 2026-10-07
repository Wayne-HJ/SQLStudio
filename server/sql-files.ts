// Statement splitting for ordinary SQL dumps, including PostgreSQL dollar quotes
// and SQLite trigger bodies. MySQL DELIMITER / routines are explicitly unsupported.
export function splitSql(script: string, backslashEscapes = false): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote = "";
  let quoteEscape = false;
  let dollar = "";
  let lineComment = false;
  let blockComment = false;
  let trigger = false;
  let triggerDepth = 0;
  let word = "";
  let prefix = "";
  function finishWord() {
    if (!word) return;
    const upper = word.toUpperCase();
    prefix += (prefix ? " " : "") + upper;
    if (/^CREATE(?: TEMP(?:ORARY)?)? TRIGGER\b/.test(prefix)) trigger = true;
    if (trigger) {
      if (upper === "BEGIN" || upper === "CASE") triggerDepth++;
      if (upper === "END") triggerDepth = Math.max(0, triggerDepth - 1);
    }
    word = "";
  }
  for (let i = 0; i < script.length; i++) {
    const char = script[i],
      next = script[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (script.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = "";
      }
      continue;
    }
    if (quote) {
      if (char === "\\" && quoteEscape) {
        i++;
        continue;
      }
      if (char === quote) {
        if (next === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      finishWord();
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      finishWord();
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      finishWord();
      quoteEscape =
        backslashEscapes ||
        (char === "'" &&
          /[Ee]/.test(script[i - 1] ?? "") &&
          !/[A-Za-z_]/.test(script[i - 2] ?? ""));
      quote = char;
      continue;
    }
    if (char === "$") {
      const match = script.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        finishWord();
        dollar = match[0];
        i += dollar.length - 1;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(char)) {
      word += char;
      continue;
    }
    finishWord();
    if (char === ";" && (!trigger || triggerDepth === 0)) {
      const statement = script.slice(start, i).trim();
      if (stripComments(statement).trim()) statements.push(statement);
      start = i + 1;
      prefix = "";
      trigger = false;
      triggerDepth = 0;
    }
  }
  finishWord();
  if (quote || dollar || blockComment)
    throw new Error("SQL 文件包含未闭合的字符串、美元引号或注释");
  const last = script.slice(start).trim();
  if (stripComments(last).trim()) statements.push(last);
  return statements;
}
export function stripComments(text: string) {
  return text
    .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*/, "")
    .trim();
}
export function sqlLiteral(value: unknown, engine: string): string {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("不能导出非有限数值");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const hex = Buffer.from(value).toString("hex");
    return engine === "postgres" ? `decode('${hex}','hex')` : `X'${hex}'`;
  }
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // MySQL escape behavior may vary with sql_mode; hexadecimal avoids ambiguity.
  if (engine === "mysql")
    return `CONVERT(X'${Buffer.from(text).toString("hex")}' USING utf8mb4)`;
  return `'${text.replaceAll("'", "''")}'`;
}
