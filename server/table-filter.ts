import {
  filterOperators,
  type Column,
  type Engine,
  type TableFilter,
} from "../shared/types.js";

export function buildTableFilter(
  filter: TableFilter,
  columns: Column[],
  engine: Engine,
  offset = 0,
) {
  if (!["and", "or"].includes(filter.mode) || filter.conditions.length > 20)
    throw new Error("筛选条件格式不正确，最多支持 20 条条件");
  const params: string[] = [];
  const bind = (value: string | undefined) => {
    if (typeof value !== "string" || value.length > 10000)
      throw new Error("请输入有效的筛选值");
    params.push(value);
    return engine === "postgres" ? `$${offset + params.length}` : "?";
  };
  const predicates = filter.conditions.map((condition) => {
    const column = columns.find((c) => c.name === condition.column);
    if (!column) throw new Error(`筛选列不存在：${condition.column}`);
    if (!filterOperators.includes(condition.operator))
      throw new Error("不支持此筛选条件");
    const quote = engine === "mysql" ? "`" : '"';
    const name = quote + column.name.replaceAll(quote, quote + quote) + quote;
    if (condition.operator === "is_null") return `${name} IS NULL`;
    if (condition.operator === "is_not_null") return `${name} IS NOT NULL`;
    const operators = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    if (condition.operator in operators)
      return `${name} ${operators[condition.operator as keyof typeof operators]} ${bind(condition.value)}`;
    if (condition.operator === "between")
      return `${name} BETWEEN ${bind(condition.value)} AND ${bind(condition.valueTo)}`;
    if (typeof condition.value !== "string") throw new Error("请输入筛选值");
    const escaped = condition.value
      .replaceAll("!", "!!")
      .replaceAll("%", "!%")
      .replaceAll("_", "!_");
    const pattern =
      condition.operator === "starts_with"
        ? `${escaped}%`
        : condition.operator === "ends_with"
          ? `%${escaped}`
          : `%${escaped}%`;
    return `CAST(${name} AS ${engine === "mysql" ? "CHAR" : "TEXT"}) ${condition.operator === "not_contains" ? "NOT LIKE" : "LIKE"} ${bind(pattern)} ESCAPE '!'`;
  });
  return {
    clause: predicates.join(filter.mode === "and" ? " AND " : " OR "),
    params,
  };
}
