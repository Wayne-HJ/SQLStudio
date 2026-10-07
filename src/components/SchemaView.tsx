import { t } from "../i18n";
import { KeyRound, Link2, Table2, Layers, Check, Minus } from "lucide-react";
import type { DbObject, TableInfo } from "../../shared/types";
export function Structure({ info }: { info: TableInfo }) {
  return (
    <div className="structure-view">
      <div className="section-caption">
        <h3>{t("字段结构")}</h3>
        <span>
          {info.columns.length} {t("个字段")}
        </span>
      </div>
      <table className="structure-table">
        <thead>
          <tr>
            <th>{t("字段名称")}</th>
            <th>{t("数据类型")}</th>
            <th>{t("允许 NULL")}</th>
            <th>{t("默认值")}</th>
            <th>{t("键")}</th>
          </tr>
        </thead>
        <tbody>
          {info.columns.map((c) => (
            <tr key={c.name}>
              <td>
                <span className={c.primaryKey ? "key-color" : ""}>
                  {c.primaryKey ? (
                    <KeyRound size={14} />
                  ) : (
                    <span className="field-dot" />
                  )}
                  {c.name}
                </span>
              </td>
              <td>
                <code>{c.type || "ANY"}</code>
              </td>
              <td>
                {c.nullable ? (
                  <Check size={15} className="green-text" />
                ) : (
                  <Minus size={15} className="muted" />
                )}
              </td>
              <td className="muted">
                {c.defaultValue == null ? "—" : String(c.defaultValue)}
              </td>
              <td>
                {c.primaryKey ? (
                  <span className="tag amber">PRIMARY KEY</span>
                ) : info.foreignKeys.some((f) => f.column === c.name) ? (
                  <span className="tag blue">FOREIGN KEY</span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="schema-panels">
        <section>
          <h3>
            <Link2 size={16} />
            {t("外键关系")}
            <span>{info.foreignKeys.length}</span>
          </h3>
          {info.foreignKeys.length ? (
            info.foreignKeys.map((f) => (
              <div className="schema-item" key={f.column}>
                <code>{f.column}</code>
                <span>→</span>
                <code>
                  {f.table}.{f.foreignColumn}
                </code>
              </div>
            ))
          ) : (
            <p>{t("这个对象没有外键关系。")}</p>
          )}
        </section>
        <section>
          <h3>
            <Layers size={16} />
            {t("索引")}
            <span>{info.indexes.length}</span>
          </h3>
          {info.indexes.length ? (
            info.indexes.map((index) => (
              <div className="schema-item" key={index.name}>
                <code>{index.name}</code>
                <span>{index.columns}</span>
                {index.unique && <span className="tag purple">UNIQUE</span>}
              </div>
            ))
          ) : (
            <p>{t("暂无索引信息。")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
export function RelationGraph({
  objects,
  schemas,
  onOpen,
}: {
  objects: DbObject[];
  schemas: Record<string, TableInfo>;
  onOpen: (o: DbObject) => void;
}) {
  const tables = objects.filter((o) => o.type === "table");
  const width = Math.max(930, Math.ceil(tables.length / 2) * 285 + 60);
  const position = (i: number) => ({
    x: 40 + Math.floor(i / 2) * 285,
    y: 40 + (i % 2) * 360,
  });
  return (
    <div className="relations-scroll">
      <div className="relation-intro">
        <span className="eyebrow">SCHEMA EXPLORER</span>
        <h2>{t("让数据之间的关系，一目了然。")}</h2>
        <p>{t("从真实数据库结构生成 · 点击表名浏览数据")}</p>
      </div>
      <div className="relation-canvas" style={{ width, height: 790 }}>
        <svg width={width} height={790}>
          <defs>
            <marker
              id="arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="#97a5cb" />
            </marker>
          </defs>
          {tables.flatMap((o, i) =>
            (schemas[o.name]?.foreignKeys ?? []).map((f, j) => {
              const target = tables.findIndex((t) => t.name === f.table);
              if (target < 0) return null;
              const from = position(i),
                to = position(target);
              const x1 = from.x + 235,
                y1 = from.y + 90 + j * 32,
                x2 = to.x,
                y2 = to.y + 90;
              return (
                <path
                  key={o.name + f.column}
                  d={`M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}`}
                  stroke="#a3afd1"
                  strokeWidth="1.6"
                  fill="none"
                  markerEnd="url(#arrow)"
                />
              );
            }),
          )}
        </svg>
        {tables.map((o, i) => {
          const p = position(i);
          return (
            <section
              className="relation-table"
              key={(o.schema || "") + o.name}
              style={{ left: p.x, top: p.y }}
            >
              <button onClick={() => onOpen(o)}>
                <Table2 size={16} />
                {o.name}
                <span>{schemas[o.name]?.columns.length ?? 0}</span>
              </button>
              {schemas[o.name]?.columns.map((c) => (
                <div className="relation-field" key={c.name}>
                  {c.primaryKey ? (
                    <KeyRound size={12} className="key-color" />
                  ) : schemas[o.name]?.foreignKeys.some(
                      (f) => f.column === c.name,
                    ) ? (
                    <Link2 size={12} className="blue-text" />
                  ) : (
                    <span className="field-dot" />
                  )}
                  <span>{c.name}</span>
                  <code>{c.type.split("(")[0].toLowerCase()}</code>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
