import { useEffect, useState, type FormEvent } from "react";
import { Check, Database, Loader2, X } from "lucide-react";
import type {
  Connection,
  DatabaseDefinition,
  DatabaseSettings,
} from "../../shared/types";
import { api } from "../api";
import { t } from "../i18n";

export default function DatabaseDialog({
  connection,
  database,
  onClose,
  onSaved,
}: {
  connection: Connection;
  database?: string;
  onClose: () => void;
  onSaved: (definition: DatabaseDefinition) => void;
}) {
  const editing = database !== undefined;
  const mysql = connection.engine === "mysql";
  const [name, setName] = useState(database ?? "");
  const [charset, setCharset] = useState("");
  const [collation, setCollation] = useState("");
  const [settings, setSettings] = useState<DatabaseSettings>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await api.connect(connection);
        const result = await api.databaseSettings(connection.id, database);
        if (cancelled) return;
        setSettings(result);
        setCharset(result.charset ?? "");
        setCollation(result.collation ?? "");
      } catch (error) {
        if (!cancelled) setError((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, database]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (loading || busy || !settings) return;
    const definition: DatabaseDefinition = {
      name: name.trim(),
      ...(mysql && charset ? { charset } : {}),
      ...(mysql && collation ? { collation } : {}),
    };
    if (!definition.name) {
      setError(t("请输入有效的数据库名称"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editing)
        await api.updateDatabase(connection.id, database!, definition);
      else await api.createDatabase(connection.id, definition);
      onSaved(definition);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }

  const title = editing ? t("修改数据库") : t("新建数据库");
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-dialog-title"
        onSubmit={(event) => void save(event)}
      >
        <div className="modal-heading">
          <div className="modal-icon">
            <Database size={20} />
          </div>
          <div>
            <h2 id="database-dialog-title">{title}</h2>
            <p>
              {connection.name} · {connection.host}:{connection.port}
            </p>
          </div>
          <button
            type="button"
            className="icon-button close"
            onClick={onClose}
            disabled={busy}
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="connection-form">
          <label>
            {t("数据库名称")}
            <input
              autoFocus
              required
              value={name}
              readOnly={editing && mysql}
              disabled={loading || busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {mysql ? (
            <>
              <label>
                {t("字符集")}
                <select
                  value={charset}
                  disabled={loading || busy || !settings}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCharset(next);
                    setCollation(
                      settings?.charsets.find((item) => item.name === next)
                        ?.defaultCollation ?? "",
                    );
                  }}
                >
                  {!editing && (
                    <option value="">{t("使用服务器默认值")}</option>
                  )}
                  {settings?.charsets.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("排序规则")}
                <select
                  value={collation}
                  disabled={loading || busy || !settings}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCollation(next);
                    if (next)
                      setCharset(
                        settings?.collations.find((item) => item.name === next)
                          ?.charset ?? "",
                      );
                  }}
                >
                  {!editing && (
                    <option value="">{t("使用服务器默认值")}</option>
                  )}
                  {settings?.collations
                    .filter((item) => !charset || item.charset === charset)
                    .map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              {editing && (
                <small>
                  {t(
                    "修改默认字符集和排序规则仅影响后续新建的表，不会转换已有表的数据。MySQL 不支持直接重命名数据库。",
                  )}
                </small>
              )}
            </>
          ) : editing ? (
            <>
              <label>
                {t("编码")}
                <input readOnly value={settings?.encoding ?? ""} />
              </label>
              <small>
                {t(
                  "重命名会断开此数据库在应用内的连接，并更新连接配置。外部连接占用时可能无法重命名。",
                )}
              </small>
            </>
          ) : (
            <small>
              {t("新数据库使用 PostgreSQL 默认模板的编码和排序规则。")}
            </small>
          )}
          {loading && (
            <div className="form-message">
              <Loader2 size={14} className="spin" />
              {t("正在读取数据库设置…")}
            </div>
          )}
          {error && (
            <div className="form-message error" role="alert">
              {t(error)}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            {t("取消")}
          </button>
          <button
            className="button primary"
            disabled={loading || busy || !settings || !name.trim()}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            {editing ? t("保存") : t("创建")}
          </button>
        </footer>
      </form>
    </div>
  );
}
